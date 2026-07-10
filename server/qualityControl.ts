import type {
  ConversationCurationEvidence,
  ConversationCurationEvidenceMap,
  ConversationPickOutcome,
  ConversationQualityVerdict,
  FinalTextAuditReport,
  LlmExchange,
  PickerConfidence,
  PracticeConversation,
  QualityControlFailure,
  QualityStageAudit,
  QualityVersionSource,
  TextModelInfo,
  VocabItem,
  WorkflowAuditCallKind,
  WorkflowAuditNodeOutput
} from '../shared/types.ts';
import type { AiCurationLibraryContext } from './aiCuration.ts';
import { normalizeGeneratedConversations } from './normalize.ts';
import {
  buildBalancedRepairPrompt,
  buildPickerPrompt,
  buildQualityTriagePrompt,
  type BalancedRepairFinding,
  type PickerPromptSet
} from './prompt.ts';
import { invokeStructuredJson, type StructuredJsonInvoker } from './structuredText.ts';
import { analyzeConversationsWithVocabulary } from './vocabAudit.ts';

export const INITIAL_REGENERATE_FAILURE_RATE = 0.30;
export const SHORTFALL_PAUSE_RATE = 0.20;
export const SHORTFALL_PAUSE_MIN_COUNT = 2;
export const BALANCE_POST_REROLL_DROP_PAUSE_MIN_COUNT = 1;

const QUALITY_REVIEW_INSTRUCTIONS = 'Review JLPT listening conversations. Return only valid JSON matching the requested shape. Treat deterministic vocabulary evidence as authoritative.';
const QUALITY_REPAIR_INSTRUCTIONS = 'Repair the supplied JLPT listening conversations. Return only valid JSON with the requested conversations array.';

type UnknownRecord = Record<string, unknown>;

export type QualityConversationGenerator = (
  prompt: string,
  textModel: TextModelInfo
) => Promise<{ parsed: unknown; output: string; stats?: unknown }>;

export interface QualityNodeEvent {
  id: string;
  callKind: WorkflowAuditCallKind;
  stage: 'initial' | 'balance';
  pass: 1 | 2;
  candidateIndex?: 1 | 2;
  status: 'processing' | 'done' | 'repairWarning' | 'error' | 'skipped';
  title: string;
  input?: unknown;
  output?: WorkflowAuditNodeOutput;
  error?: string;
}

export interface RunQualityControlOptions {
  stage: 'initial' | 'balance';
  textModel: TextModelInfo;
  originalPrompt: string;
  setNumber: number;
  expectedCount: number;
  allowedVocabulary: VocabItem[];
  knownVocabulary: VocabItem[];
  conversations: PracticeConversation[];
  libraryContext?: AiCurationLibraryContext;
  invoker?: StructuredJsonInvoker;
  conversationGenerator: QualityConversationGenerator;
  onNode?: (event: QualityNodeEvent) => void | Promise<void>;
}

export interface QualityControlResult {
  conversations: PracticeConversation[];
  exchanges: LlmExchange[];
  stageAudit: QualityStageAudit;
  evidenceByConversationId: ConversationCurationEvidenceMap;
}

interface PassResult {
  conversations: PracticeConversation[];
  exchanges: LlmExchange[];
  verdicts: ConversationQualityVerdict[];
  picks: ConversationPickOutcome[];
  dropped: QualityStageAudit['dropped'];
  failures: QualityControlFailure[];
  evidenceByConversationId: ConversationCurationEvidenceMap;
}

interface AuditedVersion {
  source: QualityVersionSource;
  conversation: PracticeConversation;
  evidence: ConversationCurationEvidence;
  flags: string[];
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${label} must be a string array.`);
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function nowIso(): string {
  return new Date().toISOString();
}

function exchangeId(kind: string, requestedAt: string, suffix = ''): string {
  return `llm-${kind}-${requestedAt.replace(/[-:.]/g, '')}${suffix}`;
}

function pendingExchange(textModel: TextModelInfo, prompt: string, kind: string, instructions: string, suffix = ''): LlmExchange {
  const requestedAt = nowIso();
  return {
    id: exchangeId(kind, requestedAt, suffix),
    provider: textModel.provider,
    model: textModel.model,
    label: textModel.label,
    instructions,
    prompt,
    requestedAt,
    status: 'pending'
  };
}

function completedExchange(exchange: LlmExchange, result: { output: string; stats?: unknown }, stats: UnknownRecord): LlmExchange {
  return {
    ...exchange,
    output: result.output,
    stats: { ...asRecord(result.stats), ...stats },
    receivedAt: nowIso(),
    status: 'complete'
  };
}

function failedExchange(exchange: LlmExchange, error: unknown, stats: UnknownRecord): LlmExchange {
  const message = error instanceof Error ? error.message : String(error);
  const record = asRecord(error);
  return {
    ...exchange,
    output: typeof record.partialOutput === 'string' ? record.partialOutput : undefined,
    stats: { ...asRecord(record.stats), ...stats, errorMessage: message },
    receivedAt: nowIso(),
    status: 'failed',
    error: message
  };
}

function nodeId(stage: 'initial' | 'balance', pass: 1 | 2, kind: WorkflowAuditCallKind, candidateIndex?: 1 | 2): string {
  const prefix = pass === 2 ? `${stage}:pass2` : stage;
  if (kind === 'repair-candidate') return `${prefix}:repair-${candidateIndex}`;
  return `${prefix}:${kind}`;
}

async function publish(options: RunQualityControlOptions, event: Omit<QualityNodeEvent, 'stage'>): Promise<void> {
  await options.onNode?.({ ...event, stage: options.stage });
}

function preserveIdentity(conversations: PracticeConversation[], originals: PracticeConversation[]): PracticeConversation[] {
  return conversations.map((conversation, index) => ({
    ...conversation,
    id: originals[index]?.id ?? conversation.id,
    number: originals[index]?.number ?? conversation.number,
    createdAt: originals[index]?.createdAt ?? conversation.createdAt
  }));
}

function validateVerdicts(payload: unknown, conversations: PracticeConversation[]): ConversationQualityVerdict[] {
  const raw = asRecord(payload).verdicts;
  if (!Array.isArray(raw)) throw new Error('Quality-triage response must contain a verdicts array.');
  const expectedIds = new Set(conversations.map((conversation) => conversation.id));
  const seen = new Set<string>();
  const verdicts = raw.map((item, index): ConversationQualityVerdict => {
    const record = asRecord(item);
    const conversationId = requiredString(record.conversationId, `verdicts[${index}].conversationId`);
    if (!expectedIds.has(conversationId)) throw new Error(`Unknown conversationId in triage response: ${conversationId}.`);
    if (seen.has(conversationId)) throw new Error(`Duplicate triage verdict for ${conversationId}.`);
    seen.add(conversationId);
    const verdict = requiredString(record.verdict, `verdicts[${index}].verdict`).toLowerCase();
    if (!['pass', 'repair', 'regenerate'].includes(verdict)) throw new Error(`Invalid triage verdict for ${conversationId}.`);
    return {
      conversationId,
      verdict: verdict as ConversationQualityVerdict['verdict'],
      rationale: requiredString(record.rationale, `verdicts[${index}].rationale`),
      flags: stringArray(record.flags ?? [], `verdicts[${index}].flags`)
    };
  });
  if (seen.size !== expectedIds.size) {
    const missing = [...expectedIds].filter((id) => !seen.has(id));
    throw new Error(`Missing triage verdicts for: ${missing.join(', ')}.`);
  }
  return verdicts;
}

function deterministicFindings(
  setNumber: number,
  conversations: PracticeConversation[],
  evidence: ConversationCurationEvidenceMap
): BalancedRepairFinding[] {
  if (setNumber < 2) return [];
  return conversations.flatMap((conversation) => {
    const item = evidence[conversation.id];
    const trueOutOfVocabularyWords = item?.outOfVocabularyUniqueWords ?? conversation.outOfVocabularyAudit;
    const rejectedDeclarations = item?.rejectedVocabularyDeclarations ?? [];
    return trueOutOfVocabularyWords.length || rejectedDeclarations.length
      ? [{ conversationId: conversation.id, trueOutOfVocabularyWords, rejectedDeclarations }]
      : [];
  });
}

function fallbackVerdicts(conversations: PracticeConversation[], findings: BalancedRepairFinding[]): ConversationQualityVerdict[] {
  const repairIds = new Set(findings.map((finding) => finding.conversationId));
  return conversations.map((conversation) => repairIds.has(conversation.id)
    ? {
        conversationId: conversation.id,
        verdict: 'repair',
        rationale: 'Deterministic vocabulary findings require repair; quality triage was unavailable.',
        flags: ['triage_fallback', 'deterministic_vocabulary_finding']
      }
    : {
        conversationId: conversation.id,
        verdict: 'pass',
        rationale: 'No deterministic vocabulary findings; quality triage was unavailable.',
        flags: ['triage_fallback']
      });
}

function applyRepairUnion(verdicts: ConversationQualityVerdict[], findings: BalancedRepairFinding[]): ConversationQualityVerdict[] {
  const findingIds = new Set(findings.map((finding) => finding.conversationId));
  return verdicts.map((verdict) => findingIds.has(verdict.conversationId) && verdict.verdict === 'pass'
    ? {
        ...verdict,
        verdict: 'repair',
        rationale: `${verdict.rationale} Deterministic vocabulary findings also require repair.`,
        flags: [...new Set([...verdict.flags, 'deterministic_vocabulary_finding'])]
      }
    : verdict);
}

function evidenceCount(version: AuditedVersion): number {
  return version.evidence.outOfVocabularyUniqueCount + (version.evidence.rejectedVocabularyDeclarations?.length ?? 0);
}

function validatePicks(payload: unknown, sets: PickerPromptSet[]): Array<{
  conversationId: string;
  selected: QualityVersionSource;
  selectedQuality: 'good' | 'okay';
  confidence: PickerConfidence;
  rationale: string;
  flags: string[];
}> {
  const raw = asRecord(payload).picks;
  if (!Array.isArray(raw)) throw new Error('Picker response must contain a picks array.');
  const byId = new Map(sets.map((set) => [set.conversationId, new Set(set.versions.map((version) => version.source))]));
  const seen = new Set<string>();
  const picks = raw.map((item, index) => {
    const record = asRecord(item);
    const conversationId = requiredString(record.conversationId, `picks[${index}].conversationId`);
    const admissible = byId.get(conversationId);
    if (!admissible) throw new Error(`Unknown conversationId in picker response: ${conversationId}.`);
    if (seen.has(conversationId)) throw new Error(`Duplicate picker decision for ${conversationId}.`);
    seen.add(conversationId);
    const selected = requiredString(record.selected, `picks[${index}].selected`) as QualityVersionSource;
    if (!admissible.has(selected)) throw new Error(`Picker selected inadmissible source ${selected} for ${conversationId}.`);
    const selectedQuality = requiredString(record.selectedQuality, `picks[${index}].selectedQuality`);
    if (!['good', 'okay'].includes(selectedQuality)) throw new Error(`Invalid selectedQuality for ${conversationId}.`);
    const confidence = requiredString(record.confidence, `picks[${index}].confidence`);
    if (!['high', 'medium', 'low'].includes(confidence)) throw new Error(`Invalid confidence for ${conversationId}.`);
    return {
      conversationId,
      selected,
      selectedQuality: selectedQuality as 'good' | 'okay',
      confidence: confidence as PickerConfidence,
      rationale: requiredString(record.rationale, `picks[${index}].rationale`),
      flags: stringArray(record.flags ?? [], `picks[${index}].flags`)
    };
  });
  if (seen.size !== byId.size) throw new Error(`Picker returned ${seen.size} decisions for ${byId.size} conversations.`);
  return picks;
}

async function auditVersions(
  options: RunQualityControlOptions,
  versions: Array<{ source: QualityVersionSource; conversations: PracticeConversation[] }>
): Promise<Map<string, AuditedVersion[]>> {
  const currentSetWords = new Set(options.allowedVocabulary.filter((item) => item.set === options.setNumber).map((item) => item.japanese));
  const output = new Map<string, AuditedVersion[]>();
  for (const version of versions) {
    const analysis = await analyzeConversationsWithVocabulary(options.setNumber, options.allowedVocabulary, version.conversations, options.knownVocabulary);
    for (const conversation of analysis.conversations) {
      const original = versions[0].conversations.find((item) => item.id === conversation.id);
      const lostWords = original?.vocabularyUsed.filter((word) => currentSetWords.has(word) && !conversation.vocabularyUsed.includes(word)) ?? [];
      const audited: AuditedVersion = {
        source: version.source,
        conversation,
        evidence: analysis.evidenceByConversationId[conversation.id],
        flags: lostWords.length ? ['coverage_loss', ...lostWords.map((word) => `coverage_loss:${word}`)] : []
      };
      output.set(conversation.id, [...(output.get(conversation.id) ?? []), audited]);
    }
  }
  return output;
}

async function qualityPass(options: RunQualityControlOptions, conversations: PracticeConversation[], pass: 1 | 2): Promise<PassResult> {
  const invoker = options.invoker ?? invokeStructuredJson;
  const exchanges: LlmExchange[] = [];
  const failures: QualityControlFailure[] = [];
  const analysis = await analyzeConversationsWithVocabulary(options.setNumber, options.allowedVocabulary, conversations, options.knownVocabulary);
  const auditedConversations = analysis.conversations;
  const findings = deterministicFindings(options.setNumber, auditedConversations, analysis.evidenceByConversationId);

  await publish(options, {
    id: pass === 1 ? `${options.stage}:generation` : nodeId(options.stage, pass, 'reroll'),
    callKind: pass === 1 ? 'generation' : 'reroll',
    pass,
    status: 'done',
    title: pass === 1 ? (options.stage === 'initial' ? 'Generate initial set' : 'Generate balance set') : 'Re-roll',
    output: {
      summary: { statLine: `${auditedConversations.length} conversations · ${findings.length} with findings`, conversationCount: auditedConversations.length },
      conversations: auditedConversations,
      factsByConversationId: Object.fromEntries(auditedConversations.map((conversation) => [conversation.id, analysis.evidenceByConversationId[conversation.id]]))
    }
  });

  await publish(options, {
    id: nodeId(options.stage, pass, 'vocab-audit'),
    callKind: 'vocab-audit', pass, status: 'done', title: 'Vocabulary audit',
    output: {
      summary: { statLine: `${auditedConversations.length} conversations · ${findings.length} with findings`, conversationCount: auditedConversations.length },
      factsByConversationId: Object.fromEntries(auditedConversations.map((conversation) => [conversation.id, analysis.evidenceByConversationId[conversation.id]])),
      details: { evidenceByConversationId: analysis.evidenceByConversationId, findings }
    }
  });

  const triagePrompt = buildQualityTriagePrompt({
    setNumber: options.setNumber,
    conversations: auditedConversations,
    evidenceByConversationId: analysis.evidenceByConversationId,
    libraryContext: options.libraryContext
  });
  const triageExchange = pendingExchange(options.textModel, triagePrompt, 'triage', QUALITY_REVIEW_INSTRUCTIONS, `-${pass}`);
  await publish(options, {
    id: nodeId(options.stage, pass, 'triage'), callKind: 'triage', pass, status: 'processing', title: 'Quality triage',
    input: { prompt: triagePrompt, model: options.textModel }
  });
  let verdicts: ConversationQualityVerdict[];
  let triageStatus: QualityNodeEvent['status'] = 'done';
  let triageError: string | undefined;
  try {
    const result = await invoker(triagePrompt, options.textModel, QUALITY_REVIEW_INSTRUCTIONS);
    verdicts = applyRepairUnion(validateVerdicts(result.parsed, auditedConversations), findings);
    exchanges.push(completedExchange(triageExchange, result, { qualityTriage: verdicts, qualityPass: pass }));
  } catch (error) {
    verdicts = fallbackVerdicts(auditedConversations, findings);
    triageStatus = 'repairWarning';
    triageError = error instanceof Error ? error.message : String(error);
    failures.push({ stage: options.stage, pass, callKind: 'triage', error: triageError, fallback: 'deterministic-only triage' });
    exchanges.push(failedExchange(triageExchange, error, { qualityTriage: verdicts, qualityPass: pass, fallback: 'deterministic-only triage' }));
  }
  const verdictCounts = (value: ConversationQualityVerdict['verdict']) => verdicts.filter((verdict) => verdict.verdict === value).length;
  await publish(options, {
    id: nodeId(options.stage, pass, 'triage'), callKind: 'triage', pass, status: triageStatus, title: 'Quality triage', error: triageError,
    output: {
      summary: {
        statLine: `${verdictCounts('pass')} pass · ${verdictCounts('repair')} repair · ${verdictCounts('regenerate')} regen${triageStatus === 'repairWarning' ? ' · fallback' : ''}`,
        passCount: verdictCounts('pass'), repairCount: verdictCounts('repair'), regenerateCount: verdictCounts('regenerate')
      },
      exchange: exchanges.at(-1),
      factsByConversationId: Object.fromEntries(verdicts.map((verdict) => [verdict.conversationId, verdict])),
      details: { verdicts }
    }
  });

  const verdictById = new Map(verdicts.map((verdict) => [verdict.conversationId, verdict]));
  const dropped = auditedConversations.filter((conversation) => verdictById.get(conversation.id)?.verdict === 'regenerate').map((conversation) => {
    const verdict = verdictById.get(conversation.id)!;
    return { conversationId: conversation.id, number: conversation.number, title: conversation.title, stage: options.stage, pass, rationale: verdict.rationale, flags: verdict.flags };
  });
  const repairOriginals = auditedConversations.filter((conversation) => verdictById.get(conversation.id)?.verdict === 'repair');
  const passing = auditedConversations.filter((conversation) => verdictById.get(conversation.id)?.verdict === 'pass').map((conversation) => ({
    ...conversation,
    quality: 'good' as const,
    qualityDecision: 'pass' as const,
    qualityFlags: verdictById.get(conversation.id)?.flags ?? []
  }));

  if (!repairOriginals.length) {
    for (const candidateIndex of [1, 2] as const) {
      await publish(options, {
        id: nodeId(options.stage, pass, 'repair-candidate', candidateIndex), callKind: 'repair-candidate', pass, candidateIndex,
        status: 'skipped', title: `Repair candidate ${candidateIndex}`,
        output: { summary: { statLine: 'Skipped — all passed', conversationCount: 0 } }
      });
    }
    for (const kind of ['dominance-gates', 'pick'] as const) {
      await publish(options, {
        id: nodeId(options.stage, pass, kind), callKind: kind, pass, status: 'skipped', title: kind === 'pick' ? 'Pick' : 'Dominance gates',
        output: { summary: { statLine: 'Skipped — no repair candidates' } }
      });
    }
    return { conversations: passing, exchanges, verdicts, picks: [], dropped, failures, evidenceByConversationId: analysis.evidenceByConversationId };
  }

  const repairPrompt = buildBalancedRepairPrompt(options.originalPrompt, options.allowedVocabulary, repairOriginals, findings, verdicts);
  const candidateSets: Array<{ source: 'candidate1' | 'candidate2'; conversations: PracticeConversation[] }> = [];
  for (const candidateIndex of [1, 2] as const) {
    const repairExchange = pendingExchange(options.textModel, repairPrompt, 'repair', QUALITY_REPAIR_INSTRUCTIONS, `-${pass}-${candidateIndex}`);
    await publish(options, {
      id: nodeId(options.stage, pass, 'repair-candidate', candidateIndex), callKind: 'repair-candidate', pass, candidateIndex,
      status: 'processing', title: `Repair candidate ${candidateIndex}`, input: { prompt: repairPrompt, model: options.textModel }
    });
    try {
      const result = await options.conversationGenerator(repairPrompt, options.textModel);
      const normalized = preserveIdentity(normalizeGeneratedConversations(result.parsed, repairOriginals.length), repairOriginals);
      if (normalized.length !== repairOriginals.length || normalized.some((conversation) => !conversation.text.length)) {
        throw new Error(`Repair candidate ${candidateIndex} did not return every flagged conversation.`);
      }
      candidateSets.push({ source: `candidate${candidateIndex}` as const, conversations: normalized });
      const exchange = completedExchange(repairExchange, result, { repairAttempt: 1, repairCandidate: candidateIndex, qualityPass: pass });
      exchanges.push(exchange);
      await publish(options, {
        id: nodeId(options.stage, pass, 'repair-candidate', candidateIndex), callKind: 'repair-candidate', pass, candidateIndex,
        status: 'done', title: `Repair candidate ${candidateIndex}`,
        output: { summary: { statLine: `${normalized.length} conversations repaired`, conversationCount: normalized.length }, exchange, conversations: normalized }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ stage: options.stage, pass, callKind: 'repair-candidate', candidateIndex, error: message, fallback: 'continue with surviving candidates or originals' });
      const exchange = failedExchange(repairExchange, error, { repairAttempt: 1, repairCandidate: candidateIndex, qualityPass: pass, fallback: 'original retained' });
      exchanges.push(exchange);
      await publish(options, {
        id: nodeId(options.stage, pass, 'repair-candidate', candidateIndex), callKind: 'repair-candidate', pass, candidateIndex,
        status: 'repairWarning', title: `Repair candidate ${candidateIndex}`, error: message,
        output: { summary: { statLine: 'Call failed · fallback available' }, exchange }
      });
    }
  }

  const versionsById = await auditVersions(options, [{ source: 'original', conversations: repairOriginals }, ...candidateSets]);
  const admissibleById = new Map<string, AuditedVersion[]>();
  const eliminatedById = new Map<string, ConversationPickOutcome['eliminated']>();
  for (const [conversationId, versions] of versionsById) {
    const minimum = Math.min(...versions.map(evidenceCount));
    admissibleById.set(conversationId, versions.filter((version) => evidenceCount(version) === minimum));
    eliminatedById.set(conversationId, versions.filter((version) => evidenceCount(version) > minimum).map((version) => ({
      source: version.source,
      reason: `Eliminated by deterministic vocabulary gate (${evidenceCount(version)} findings; best ${minimum}).`
    })));
  }
  const eliminatedCount = [...eliminatedById.values()].reduce((total, values) => total + values.length, 0);
  const coverageLossCount = [...versionsById.values()].flat().filter((version) => version.flags.includes('coverage_loss')).length;
  await publish(options, {
    id: nodeId(options.stage, pass, 'dominance-gates'), callKind: 'dominance-gates', pass, status: 'done', title: 'Dominance gates',
    output: {
      summary: { statLine: `${eliminatedCount} eliminated · ${coverageLossCount} coverage-loss flags`, eliminatedCount, coverageLossCount },
      factsByConversationId: Object.fromEntries([...admissibleById].map(([id, versions]) => [id, { admissible: versions.map((version) => version.source), eliminated: eliminatedById.get(id) }])),
      details: { versionsByConversationId: Object.fromEntries(versionsById), eliminatedByConversationId: Object.fromEntries(eliminatedById) }
    }
  });

  const picks: ConversationPickOutcome[] = [];
  const selectedById = new Map<string, AuditedVersion>();
  const ties: PickerPromptSet[] = [];
  for (const original of repairOriginals) {
    const admissible = admissibleById.get(original.id) ?? [];
    const verdict = verdictById.get(original.id)!;
    if (admissible.length === 1) {
      const selected = admissible[0];
      selectedById.set(original.id, selected);
      const noNaturalnessConcern = verdict.flags.some((flag) => flag === 'deterministic_vocabulary_finding' || flag === 'triage_fallback')
        && verdict.flags.every((flag) => flag === 'deterministic_vocabulary_finding' || flag === 'triage_fallback');
      picks.push({
        conversationId: original.id,
        selected: selected.source,
        selectedQuality: evidenceCount(selected) === 0 && noNaturalnessConcern ? 'good' : 'okay',
        decidedBy: 'gate',
        rationale: 'Deterministic vocabulary gates left one strictly best version.',
        flags: selected.flags,
        eliminated: eliminatedById.get(original.id) ?? []
      });
    } else {
      ties.push({
        conversationId: original.id,
        triageRationale: verdict.rationale,
        versions: admissible.map((version) => ({ source: version.source, conversation: version.conversation, evidence: version.evidence, flags: version.flags }))
      });
    }
  }

  if (ties.length) {
    const pickerPrompt = buildPickerPrompt(ties);
    const pickerExchange = pendingExchange(options.textModel, pickerPrompt, 'pick', QUALITY_REVIEW_INSTRUCTIONS, `-${pass}`);
    await publish(options, { id: nodeId(options.stage, pass, 'pick'), callKind: 'pick', pass, status: 'processing', title: 'Pick', input: { prompt: pickerPrompt, model: options.textModel } });
    try {
      const result = await invoker(pickerPrompt, options.textModel, QUALITY_REVIEW_INSTRUCTIONS);
      const decisions = validatePicks(result.parsed, ties);
      const exchange = completedExchange(pickerExchange, result, { pickOutcomes: decisions, qualityPass: pass });
      exchanges.push(exchange);
      for (const decision of decisions) {
        const selected = (admissibleById.get(decision.conversationId) ?? []).find((version) => version.source === decision.selected)!;
        selectedById.set(decision.conversationId, selected);
        picks.push({ ...decision, decidedBy: 'tie-break', flags: [...new Set([...decision.flags, ...selected.flags])], eliminated: eliminatedById.get(decision.conversationId) ?? [] });
      }
      await publish(options, {
        id: nodeId(options.stage, pass, 'pick'), callKind: 'pick', pass, status: 'done', title: 'Pick',
        output: { summary: pickSummary(picks), exchange, factsByConversationId: Object.fromEntries(picks.map((pick) => [pick.conversationId, pick])), details: { picks, versionsByConversationId: Object.fromEntries(versionsById) } }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ stage: options.stage, pass, callKind: 'pick', error: message, fallback: 'best deterministic audit; original on ties' });
      const exchange = failedExchange(pickerExchange, error, { qualityPass: pass, fallback: 'best deterministic audit; original on ties' });
      exchanges.push(exchange);
      for (const tie of ties) {
        const admissible = admissibleById.get(tie.conversationId) ?? [];
        const selected = admissible.find((version) => version.source === 'original') ?? admissible[0];
        selectedById.set(tie.conversationId, selected);
        picks.push({
          conversationId: tie.conversationId, selected: selected.source, selectedQuality: 'okay', decidedBy: 'fallback',
          rationale: 'Picker failed; selected the best deterministic audit and preferred the original on a tie.',
          flags: [...new Set([...selected.flags, 'picker_fallback'])], eliminated: eliminatedById.get(tie.conversationId) ?? []
        });
      }
      await publish(options, {
        id: nodeId(options.stage, pass, 'pick'), callKind: 'pick', pass, status: 'repairWarning', title: 'Pick', error: message,
        output: { summary: { ...pickSummary(picks), statLine: `${pickSummary(picks).statLine} · fallback` }, exchange, factsByConversationId: Object.fromEntries(picks.map((pick) => [pick.conversationId, pick])), details: { picks, versionsByConversationId: Object.fromEntries(versionsById) } }
      });
    }
  } else {
    await publish(options, {
      id: nodeId(options.stage, pass, 'pick'), callKind: 'pick', pass, status: 'skipped', title: 'Pick',
      output: { summary: { ...pickSummary(picks), statLine: `${pickSummary(picks).statLine} · gate-decided` }, factsByConversationId: Object.fromEntries(picks.map((pick) => [pick.conversationId, pick])), details: { picks, versionsByConversationId: Object.fromEntries(versionsById) } }
    });
  }

  const pickById = new Map(picks.map((pick) => [pick.conversationId, pick]));
  const repaired = repairOriginals.map((original) => {
    const selected = selectedById.get(original.id) ?? versionsById.get(original.id)?.find((version) => version.source === 'original')!;
    const pick = pickById.get(original.id)!;
    return {
      ...selected.conversation,
      id: original.id,
      number: original.number,
      quality: pick.selectedQuality,
      qualityDecision: 'repair' as const,
      pickerSelected: pick.selected,
      pickerConfidence: pick.confidence,
      qualityFlags: pick.flags
    };
  });
  for (let index = 0; index < exchanges.length; index += 1) {
    const stats = asRecord(exchanges[index].stats);
    const candidateIndex = stats.repairCandidate;
    if (candidateIndex !== 1 && candidateIndex !== 2) continue;
    const source = `candidate${candidateIndex}` as QualityVersionSource;
    const selectedForFinal = picks.some((pick) => pick.selected === source);
    const improved = [...versionsById.values()].some((versions) => {
      const original = versions.find((version) => version.source === 'original');
      const candidate = versions.find((version) => version.source === source);
      return Boolean(original && candidate && evidenceCount(candidate) < evidenceCount(original));
    });
    exchanges[index] = {
      ...exchanges[index],
      stats: {
        ...stats,
        repairOutcome: improved ? 'improved' : 'not_improved',
        selectedForFinal
      }
    };
  }
  for (const candidateIndex of [1, 2] as const) {
    const exchange = exchanges.find((item) => asRecord(item.stats).repairCandidate === candidateIndex);
    if (!exchange) continue;
    const candidate = candidateSets.find((item) => item.source === `candidate${candidateIndex}`);
    const selectedCount = picks.filter((pick) => pick.selected === `candidate${candidateIndex}`).length;
    await publish(options, {
      id: nodeId(options.stage, pass, 'repair-candidate', candidateIndex), callKind: 'repair-candidate', pass, candidateIndex,
      status: exchange.status === 'failed' ? 'repairWarning' : 'done', title: `Repair candidate ${candidateIndex}`, error: exchange.error,
      output: {
        summary: { statLine: exchange.status === 'failed' ? 'Call failed · fallback available' : `${candidate?.conversations.length ?? 0} conversations · ${selectedCount} selected`, conversationCount: candidate?.conversations.length ?? 0 },
        exchange,
        conversations: candidate?.conversations,
        details: {
          comparisons: candidate?.conversations.map((conversation) => ({
            conversationId: conversation.id,
            before: repairOriginals.find((original) => original.id === conversation.id)?.text ?? [],
            after: conversation.text
          })) ?? []
        }
      }
    });
  }
  const acceptedById = new Map([...passing, ...repaired].map((conversation) => [conversation.id, conversation]));
  const accepted = auditedConversations.flatMap((conversation) => acceptedById.get(conversation.id) ?? []);
  const finalAnalysis = await analyzeConversationsWithVocabulary(options.setNumber, options.allowedVocabulary, accepted, options.knownVocabulary);
  return { conversations: finalAnalysis.conversations, exchanges, verdicts, picks, dropped, failures, evidenceByConversationId: finalAnalysis.evidenceByConversationId };
}

function pickSummary(picks: ConversationPickOutcome[]) {
  const count = (source: QualityVersionSource) => picks.filter((pick) => pick.selected === source).length;
  const goodCount = picks.filter((pick) => pick.selectedQuality === 'good').length;
  const okayCount = picks.filter((pick) => pick.selectedQuality === 'okay').length;
  return {
    statLine: `orig ${count('original')} · c1 ${count('candidate1')} · c2 ${count('candidate2')} · ${goodCount} good/${okayCount} okay`,
    originalWins: count('original'), candidate1Wins: count('candidate1'), candidate2Wins: count('candidate2'), goodCount, okayCount
  };
}

export async function runQualityControl(options: RunQualityControlOptions): Promise<QualityControlResult> {
  const first = await qualityPass(options, options.conversations, 1);
  let accepted = first.conversations;
  let evidence = first.evidenceByConversationId;
  const exchanges = [...first.exchanges];
  const verdicts = [...first.verdicts];
  const picks = [...first.picks];
  const dropped = [...first.dropped];
  const failures = [...first.failures];
  let rerollGeneratedCount = 0;

  if (first.dropped.length) {
    const rerollPrompt = `${options.originalPrompt}\n\nRE-ROLL REQUEST: Return exactly ${first.dropped.length} fresh replacement conversations. Use new coherent scenarios and do not repeat structurally flawed versions from the previous batch.`;
    const exchange = pendingExchange(options.textModel, rerollPrompt, 'reroll', QUALITY_REPAIR_INSTRUCTIONS);
    await publish(options, { id: nodeId(options.stage, 2, 'reroll'), callKind: 'reroll', pass: 2, status: 'processing', title: 'Re-roll', input: { prompt: rerollPrompt, model: options.textModel } });
    try {
      const result = await options.conversationGenerator(rerollPrompt, options.textModel);
      const replacements = preserveIdentity(normalizeGeneratedConversations(result.parsed, first.dropped.length), first.dropped.map((item) => options.conversations.find((conversation) => conversation.id === item.conversationId)!).filter(Boolean));
      rerollGeneratedCount = replacements.length;
      const rerollExchange = completedExchange(exchange, result, { reroll: true, requestedCount: first.dropped.length, generatedCount: replacements.length });
      exchanges.push(rerollExchange);
      await publish(options, {
        id: nodeId(options.stage, 2, 'reroll'), callKind: 'reroll', pass: 2, status: 'done', title: 'Re-roll',
        output: { summary: { statLine: `${replacements.length} replacements generated`, replacementCount: replacements.length }, exchange: rerollExchange, conversations: replacements, details: { dropped: first.dropped, replacements } }
      });
      if (replacements.length) {
        const second = await qualityPass(options, replacements, 2);
        accepted = [...accepted, ...second.conversations].sort((a, b) => a.number - b.number);
        evidence = { ...evidence, ...second.evidenceByConversationId };
        exchanges.push(...second.exchanges);
        verdicts.push(...second.verdicts);
        picks.push(...second.picks);
        dropped.push(...second.dropped);
        failures.push(...second.failures);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ stage: options.stage, pass: 2, callKind: 'reroll', error: message, fallback: 'accept stage shortfall' });
      const rerollExchange = failedExchange(exchange, error, { reroll: true, fallback: 'accept stage shortfall' });
      exchanges.push(rerollExchange);
      await publish(options, {
        id: nodeId(options.stage, 2, 'reroll'), callKind: 'reroll', pass: 2, status: 'repairWarning', title: 'Re-roll', error: message,
        output: { summary: { statLine: 'Re-roll failed · shortfall retained', replacementCount: 0 }, exchange: rerollExchange }
      });
    }
  } else {
    await publish(options, {
      id: nodeId(options.stage, 2, 'reroll'), callKind: 'reroll', pass: 2, status: 'skipped', title: 'Re-roll',
      output: { summary: { statLine: 'Skipped — no regenerate verdicts', replacementCount: 0, droppedCount: 0 } }
    });
  }

  return {
    conversations: accepted,
    exchanges,
    evidenceByConversationId: evidence,
    stageAudit: {
      stage: options.stage,
      requestedCount: options.expectedCount,
      generatedCount: options.conversations.length,
      acceptedCount: accepted.length,
      regenerateCount: first.dropped.length,
      rerollRequestedCount: first.dropped.length,
      rerollGeneratedCount,
      dropped,
      verdicts,
      picks,
      failures
    }
  };
}

export interface FinalTextAuditInput {
  requestedCount: number;
  initial: QualityStageAudit;
  balance?: QualityStageAudit;
  conversations: PracticeConversation[];
  currentSetVocabulary: VocabItem[];
  distributionStats?: Record<string, number>;
  createdAt?: string;
}

export function buildFinalTextAudit(input: FinalTextAuditInput): FinalTextAuditReport {
  const stages = [input.initial, input.balance].filter((stage): stage is QualityStageAudit => Boolean(stage));
  const acceptedCount = input.conversations.length;
  const shortfallCount = Math.max(0, input.requestedCount - acceptedCount);
  const initialRate = input.initial.generatedCount ? input.initial.regenerateCount / input.initial.generatedCount : 0;
  const shortfallRate = input.requestedCount ? shortfallCount / input.requestedCount : 0;
  const balancePostRerollDrops = input.balance?.dropped.filter((item) => item.pass === 2).length ?? 0;
  const initialFailed = initialRate > INITIAL_REGENERATE_FAILURE_RATE;
  const shortfallPaused = shortfallCount >= SHORTFALL_PAUSE_MIN_COUNT && shortfallRate > SHORTFALL_PAUSE_RATE;
  const balancePaused = balancePostRerollDrops >= BALANCE_POST_REROLL_DROP_PAUSE_MIN_COUNT;
  const usedCurrentWords = new Set(input.conversations.flatMap((conversation) => conversation.vocabularyUsed));
  const uncoveredCurrentSetWords = [...new Set(input.currentSetVocabulary.map((item) => item.japanese))].filter((word) => !usedCurrentWords.has(word));
  const coverageLosses = input.conversations.flatMap((conversation) => {
    const words = (conversation.qualityFlags ?? []).filter((flag) => flag.startsWith('coverage_loss:')).map((flag) => flag.slice('coverage_loss:'.length));
    return words.length ? [{ conversationId: conversation.id, words }] : [];
  });
  const picks = stages.flatMap((stage) => stage.picks);
  const thresholds: FinalTextAuditReport['thresholds'] = [
    {
      id: 'initial-regenerate-rate', outcome: initialFailed ? 'tripped' : 'met', measured: initialRate, limit: INITIAL_REGENERATE_FAILURE_RATE,
      unit: 'rate', action: 'fail', detail: `${input.initial.regenerateCount} of ${input.initial.generatedCount} initial conversations received regenerate verdicts.`
    },
    {
      id: 'total-shortfall', outcome: shortfallPaused ? 'tripped' : 'met', measured: shortfallRate, limit: SHORTFALL_PAUSE_RATE,
      unit: 'rate', action: 'pause', detail: `${acceptedCount} of ${input.requestedCount} requested conversations were accepted; pause requires at least ${SHORTFALL_PAUSE_MIN_COUNT} missing.`
    },
    {
      id: 'balance-post-reroll-drop', outcome: balancePaused ? 'tripped' : 'met', measured: balancePostRerollDrops, limit: BALANCE_POST_REROLL_DROP_PAUSE_MIN_COUNT,
      unit: 'count', action: 'pause', detail: `${balancePostRerollDrops} balance conversations were dropped after the bounded re-roll.`
    }
  ];
  const outcome = initialFailed ? 'fail' : shortfallPaused || balancePaused ? 'pause' : 'pass';
  return {
    requestedCount: input.requestedCount,
    acceptedCount,
    shortfallCount,
    stages: { initial: input.initial, balance: input.balance },
    qualityLabels: {
      good: input.conversations.filter((conversation) => conversation.quality === 'good').length,
      okay: input.conversations.filter((conversation) => conversation.quality === 'okay').length
    },
    remainingOutOfVocabulary: input.conversations.filter((conversation) => conversation.outOfVocabularyAudit.length).map((conversation) => ({ conversationId: conversation.id, words: conversation.outOfVocabularyAudit })),
    uncoveredCurrentSetWords,
    coverageLosses,
    modelCallFailures: stages.flatMap((stage) => stage.failures),
    pickStatistics: {
      original: picks.filter((pick) => pick.selected === 'original').length,
      candidate1: picks.filter((pick) => pick.selected === 'candidate1').length,
      candidate2: picks.filter((pick) => pick.selected === 'candidate2').length,
      gateDecided: picks.filter((pick) => pick.decidedBy === 'gate').length,
      tieBreakDecided: picks.filter((pick) => pick.decidedBy === 'tie-break').length,
      fallbackDecided: picks.filter((pick) => pick.decidedBy === 'fallback').length
    },
    distributionStats: input.distributionStats,
    thresholds,
    outcome,
    guidance: initialFailed ? 'Initial quality regeneration exceeded 30%. Try a smaller batch, relax incompatible constraints, or adjust the generation prompt before retrying.' : undefined,
    createdAt: input.createdAt ?? nowIso()
  };
}
