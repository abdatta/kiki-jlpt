import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import type { AiCurationRequest, GenerateRequest, LibraryComplementGenerateRequest, LlmExchange, PracticeConversation, PracticeRun, RunAudioGenerateRequest, StudioJob, StudioRunSummary, StudioSnapshot, TextModelInfo, VocabItem, WorkflowAuditNode, WorkflowAudioMode, WorkflowGenerateRequest, WorkflowJob, WorkflowNodeStatus, WorkflowRepairResponse, WorkflowRunAudit } from '../shared/types.ts';
import { CURATED_AUDIO_DIR, CURATED_DIR, CURATED_SETS_DIR, OUTPUTS_DIR, RUNS_DIR, STUDIO_JOBS_DIR } from './paths.ts';
import { buildAiLibraryBalancePrompt, buildBalancedRepairPrompt, buildGenerationPrompt, buildLibraryComplementPrompt } from './prompt.ts';
import { buildTtsPrompt, generateConversationAudio, generateConversationJson } from './gemini.ts';
import { CLAUDE_TEXT_INSTRUCTIONS, generateClaudeConversationJson } from './claudeText.ts';
import { CODEX_TEXT_INSTRUCTIONS, generateCodexConversationJson } from './codexText.ts';
import { getAllowedVocabulary, getSetSummaries, readVocabulary } from './vocab.ts';
import { deleteRun, listRuns, makeRunId, mutateRun, readRun, reanalyzeRun, runAudioDir, saveRun, touchConversation, unlockCuratedSource, updateConversation } from './storage.ts';
import { normalizeGeneratedConversations, parseTranscriptText } from './normalize.ts';
import { calculateRunAnalytics } from './analytics.ts';
import { getTextModelOptions, resolveTextModel } from './textModels.ts';
import { analyzeConversationsWithVocabulary } from './vocabAudit.ts';
import { addConversationToLibrary, listCuratedSets, readCuratedSet, reanalyzeCuratedSet, removeConversationFromLibrary } from './library.ts';
import { recommendLibraryConversations } from './recommendations.ts';
import { buildGeneratedRunBalancePlan, buildLibraryBalancePlan } from './libraryBalance.ts';
import { getPracticeLibraryPublishStatus, publishPracticeLibrary } from './practiceLibrary.ts';
import { getConversationCurationEvidence } from './curationEvidence.ts';
import { AiCurationExecutionError, AiCurationInputError, buildAiCurationSnapshot, createAiCurationReview, getAiCurationReview, getAiCurationReviewHistory, getLatestAiCurationReview, libraryContext } from './aiCuration.ts';
import type { AiCurationLibraryContext } from './aiCuration.ts';
import { cancelAudioParent, cancelUnresolvedAudioChildren, createAudioBatch, createCrossRunAudioBatch, enqueueConversationAudio, hasActiveConversationAudio, pauseAudioParent, resumeAudioParent, resumeConversationAudioJob, waitForStudioJob } from './audioScheduler.ts';
import { isGenerationSlotBusy, withGenerationSlot } from './generationGate.ts';
import { createStudioJob, currentStudioEventRevision, findStudioJobByIdempotencyKey, interruptActiveStudioJobs, listStudioJobs, makeStudioJobId, readStudioJob, subscribeStudioEvents, updateStudioJob } from './studioJobs.ts';
import {
  INITIAL_REGENERATE_FAILURE_RATE,
  buildFinalTextAudit,
  runQualityControl,
  type QualityNodeEvent
} from './qualityControl.ts';
import { invokeStructuredJson, type StructuredJsonInvoker } from './structuredText.ts';

const app = express();
const port = Number.parseInt(process.env.API_PORT || '8787', 10);

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/audio', express.static(RUNS_DIR));
app.use('/curated', express.static(CURATED_DIR));

const workflowJobs = new Map<string, WorkflowJob>();

function nowIso(): string {
  return new Date().toISOString();
}

function splitWorkflowConversationTarget(totalConversationCount: number): { primaryConversationCount: number; balanceConversationCount: number } {
  const primaryConversationCount = Math.ceil(totalConversationCount * 2 / 3);
  return {
    primaryConversationCount,
    balanceConversationCount: totalConversationCount - primaryConversationCount
  };
}

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : value ?? '';
}

async function deleteAudioFile(runId: string, fileName: string): Promise<void> {
  const audioDir = path.resolve(runAudioDir(runId));
  const filePath = path.resolve(audioDir, fileName);
  if (!filePath.startsWith(`${audioDir}${path.sep}`)) {
    throw new Error('Invalid audio file path.');
  }

  await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

function asyncHandler<TReq extends express.Request>(
  handler: (req: TReq, res: express.Response) => Promise<void>
): express.RequestHandler {
  return (req, res, next) => {
    handler(req as TReq, res).catch(next);
  };
}

function validateGenerateRequest(body: GenerateRequest): { setNumber: number; conversationCount: number } | { error: string; status: number } {
  const setNumber = Number(body.setNumber);
  const conversationCount = Number(body.conversationCount);

  if (!Number.isInteger(setNumber) || setNumber < 1) {
    return { status: 400, error: 'Set number must be a positive integer.' };
  }
  if (!Number.isInteger(conversationCount) || conversationCount < 4 || conversationCount > 30) {
    return { status: 400, error: 'Conversation count must be between 4 and 30.' };
  }

  return { setNumber, conversationCount };
}

async function readWavDurationSeconds(filePath: string): Promise<number | undefined> {
  const buffer = await readFile(filePath).catch(() => undefined);
  if (!buffer || buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return undefined;
  }

  const byteRate = buffer.readUInt32LE(28);
  if (!byteRate) return undefined;

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === 'data') {
      return Math.max(1, Math.round(chunkSize / byteRate));
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  return undefined;
}

function validateWorkflowGenerateRequest(body: WorkflowGenerateRequest): { setNumber: number; conversationCount: number; balanceConversationCount: number; audioCount: number; audioMode: WorkflowAudioMode } | { error: string; status: number } {
  const setNumber = Number(body.setNumber);
  const requestedTotalConversationCount = Number(body.conversationCount);
  const audioMode = body.audioMode ?? 'fixed';
  const { primaryConversationCount, balanceConversationCount } = splitWorkflowConversationTarget(requestedTotalConversationCount);
  const audioCount = audioMode === 'max' ? requestedTotalConversationCount : body.audioCount === undefined ? 2 : Number(body.audioCount);

  if (!Number.isInteger(setNumber) || setNumber < 1) {
    return { status: 400, error: 'Set number must be a positive integer.' };
  }
  if (!Number.isInteger(requestedTotalConversationCount) || requestedTotalConversationCount < 6 || requestedTotalConversationCount > 30) {
    return { status: 400, error: 'Workflow conversation count must be between 6 and 30.' };
  }
  if (audioMode !== 'fixed' && audioMode !== 'max') {
    return { status: 400, error: 'Workflow audio mode must be fixed or max.' };
  }
  if (!Number.isInteger(audioCount) || audioCount < 0 || (audioMode === 'fixed' && audioCount > 5)) {
    return { status: 400, error: 'Workflow audio count must be between 0 and 5.' };
  }

  return {
    setNumber,
    conversationCount: primaryConversationCount,
    balanceConversationCount,
    audioCount,
    audioMode
  };
}

function validateSetNumber(value: unknown): { setNumber: number } | { error: string; status: number } {
  const setNumber = Number(value);
  if (!Number.isInteger(setNumber) || setNumber < 1) {
    return { status: 400, error: 'Set number must be a positive integer.' };
  }
  return { setNumber };
}

async function getGenerateContext(body: GenerateRequest): Promise<
  | { setNumber: number; conversationCount: number; allowedVocabulary: VocabItem[]; knownVocabulary: VocabItem[]; textModel: TextModelInfo; prompt: string; qualityLibraryContext: AiCurationLibraryContext }
  | { error: string; status: number }
> {
  const validated = validateGenerateRequest(body);
  if ('error' in validated) return validated;

  const allowedVocabulary = await getAllowedVocabulary(validated.setNumber);
  if (!allowedVocabulary.length) {
    return { status: 404, error: `No vocabulary found for Set ${validated.setNumber}.` };
  }

  const textModel = await resolveTextModel(body.textModelId);
  const knownVocabulary = await readVocabulary();
  const prompt = await buildGenerationPrompt(validated.setNumber, validated.conversationCount, allowedVocabulary);
  const qualityLibraryContext = await getQualityLibraryContext(validated.setNumber);
  return { ...validated, allowedVocabulary, knownVocabulary, textModel, prompt, qualityLibraryContext };
}

async function getWorkflowGenerateContext(body: WorkflowGenerateRequest): Promise<
  | { setNumber: number; conversationCount: number; balanceConversationCount: number; audioCount: number; audioMode: WorkflowAudioMode; allowedVocabulary: VocabItem[]; knownVocabulary: VocabItem[]; textModel: TextModelInfo; prompt: string; qualityLibraryContext: AiCurationLibraryContext }
  | { error: string; status: number }
> {
  const validated = validateWorkflowGenerateRequest(body);
  if ('error' in validated) return validated;

  const allowedVocabulary = await getAllowedVocabulary(validated.setNumber);
  if (!allowedVocabulary.length) {
    return { status: 404, error: `No vocabulary found for Set ${validated.setNumber}.` };
  }

  const textModel = await resolveTextModel(body.textModelId);
  const knownVocabulary = await readVocabulary();
  const prompt = await buildGenerationPrompt(validated.setNumber, validated.conversationCount, allowedVocabulary);
  const qualityLibraryContext = await getQualityLibraryContext(validated.setNumber);
  return { ...validated, allowedVocabulary, knownVocabulary, textModel, prompt, qualityLibraryContext };
}

async function getQualityLibraryContext(setNumber: number): Promise<AiCurationLibraryContext> {
  const set = await readCuratedSet(setNumber);
  const wordExposure: Record<string, number> = {};
  for (const conversation of set.conversations) {
    for (const word of new Set(conversation.vocabularyUsed)) {
      wordExposure[word] = (wordExposure[word] ?? 0) + 1;
    }
  }
  return {
    conversationCount: set.conversations.length,
    wordExposure,
    conversations: set.conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      scene: conversation.scene,
      text: conversation.text,
      listeningQuestions: conversation.listeningQuestions
    }))
  };
}

async function getLibraryComplementContext(
  setNumberValue: unknown,
  body: LibraryComplementGenerateRequest | undefined
): Promise<
  | { setNumber: number; conversationCount: number; allowedVocabulary: VocabItem[]; knownVocabulary: VocabItem[]; textModel: TextModelInfo; prompt: string; balance: Awaited<ReturnType<typeof buildLibraryBalancePlan>>; balanceMode: 'stats' | 'ai'; librarySnapshotContext?: AiCurationLibraryContext }
  | { error: string; status: number }
> {
  const validated = validateSetNumber(setNumberValue);
  if ('error' in validated) return validated;

  const allowedVocabulary = await getAllowedVocabulary(validated.setNumber);
  if (!allowedVocabulary.length) {
    return { status: 404, error: `No vocabulary found for Set ${validated.setNumber}.` };
  }

  const balanceMode = body?.balanceMode === 'ai' ? 'ai' : 'stats';
  const textModel = await resolveTextModel(body?.textModelId);
  const knownVocabulary = await readVocabulary();
  const planned = await buildLibraryBalancePlan(validated.setNumber);

  // The plan suggests a count; the operator may override it before generating.
  let conversationCount = planned.suggestedConversationCount;
  if (body?.conversationCount !== undefined) {
    const requested = Number(body.conversationCount);
    if (!Number.isInteger(requested) || requested < 1 || requested > 30) {
      return { status: 400, error: 'Conversation count must be an integer between 1 and 30.' };
    }
    conversationCount = requested;
  }
  const balance = { ...planned, suggestedConversationCount: conversationCount };

  if (balanceMode === 'ai') {
    const snapshot = await buildAiCurationSnapshot(validated.setNumber);
    const librarySnapshotContext = libraryContext(snapshot);
    return {
      setNumber: validated.setNumber,
      conversationCount,
      allowedVocabulary,
      knownVocabulary,
      textModel,
      prompt: buildAiLibraryBalancePrompt(validated.setNumber, allowedVocabulary, balance, librarySnapshotContext),
      balance,
      balanceMode,
      librarySnapshotContext
    };
  }

  return {
    setNumber: validated.setNumber,
    conversationCount,
    allowedVocabulary,
    knownVocabulary,
    textModel,
    prompt: buildLibraryComplementPrompt(validated.setNumber, allowedVocabulary, balance),
    balance,
    balanceMode,
    librarySnapshotContext: await getQualityLibraryContext(validated.setNumber)
  };
}

function conversationInstructionsFor(provider: TextModelInfo['provider']): string | undefined {
  if (provider === 'codex') return CODEX_TEXT_INSTRUCTIONS;
  if (provider === 'claude') return CLAUDE_TEXT_INSTRUCTIONS;
  return undefined;
}

function makeLlmExchange(
  textModel: TextModelInfo,
  prompt: string,
  requestedAt = nowIso()
): LlmExchange {
  return {
    id: `llm-${requestedAt.replace(/[-:.]/g, '')}`,
    provider: textModel.provider,
    model: textModel.model,
    label: textModel.label,
    instructions: conversationInstructionsFor(textModel.provider),
    prompt,
    requestedAt,
    status: 'pending'
  };
}

type ConversationJsonGenerator = (
  prompt: string,
  textModel: TextModelInfo
) => Promise<{ parsed: unknown; output: string; stats?: unknown }>;

const defaultConversationJsonGenerator: ConversationJsonGenerator = async (prompt, textModel) => {
  switch (textModel.provider) {
    case 'codex':
      return generateCodexConversationJson(prompt, textModel.model);
    case 'claude':
      return generateClaudeConversationJson(prompt, textModel.model);
    default:
      return generateConversationJson(prompt);
  }
};

let conversationJsonGenerator: ConversationJsonGenerator = defaultConversationJsonGenerator;

let qualityStructuredInvokerForTests: StructuredJsonInvoker | undefined;

export function configureConversationJsonGeneratorForTests(generator?: ConversationJsonGenerator): void {
  conversationJsonGenerator = generator ?? defaultConversationJsonGenerator;
  qualityStructuredInvokerForTests = generator
    ? async (prompt) => {
        if (prompt.includes('Admissible version sets:')) {
          const json = prompt.split('Admissible version sets:\n')[1]?.split('\n\nReturn only valid JSON')[0] ?? '[]';
          const sets = JSON.parse(json) as Array<{ conversationId: string; versions: Array<{ source: string }> }>;
          const picks = sets.map((set) => ({
            conversationId: set.conversationId,
            selected: set.versions[0]?.source ?? 'original',
            selectedQuality: 'good',
            confidence: 'medium',
            rationale: 'Deterministic test picker selected the first admissible version.',
            flags: []
          }));
          return { parsed: { picks }, output: JSON.stringify({ picks }) };
        }
        const json = prompt.split('Conversations with authoritative evidence:\n')[1]?.split('\n\nReturn only valid JSON')[0] ?? '[]';
        const conversations = JSON.parse(json) as Array<{ conversationId: string }>;
        const verdicts = conversations.map((conversation) => ({
          conversationId: conversation.conversationId,
          verdict: 'pass',
          rationale: 'Deterministic test triage found no subjective issue.',
          flags: []
        }));
        return { parsed: { verdicts }, output: JSON.stringify({ verdicts }) };
      }
    : undefined;
}

export function configureQualityStructuredJsonInvokerForTests(invoker?: StructuredJsonInvoker): void {
  qualityStructuredInvokerForTests = invoker;
}

interface VocabularyQualityIssue {
  conversationId: string;
  number: number;
  title: string;
  trueOutOfVocabularyWords: string[];
  rejectedDeclarations: unknown[];
  lines: Array<{ speaker: string; japanese: string }>;
}

interface VocabularyQualityResult {
  threshold: number;
  passed: boolean;
  issues: VocabularyQualityIssue[];
}

class AuditableGenerationError extends Error {
  exchanges: LlmExchange[];
  conversations?: PracticeConversation[];
  quality?: VocabularyQualityResult;

  constructor(
    message: string,
    details: {
      exchanges: LlmExchange[];
      conversations?: PracticeConversation[];
      quality?: VocabularyQualityResult;
      cause?: unknown;
    }
  ) {
    super(message);
    this.name = 'AuditableGenerationError';
    this.exchanges = details.exchanges;
    this.conversations = details.conversations;
    this.quality = details.quality;
    if (details.cause) this.cause = details.cause;
  }
}

function vocabularyQualityThreshold(setNumber: number): number {
  return setNumber >= 2 ? 0 : Number.POSITIVE_INFINITY;
}

function objectStats(stats: unknown): Record<string, unknown> {
  if (stats && typeof stats === 'object' && !Array.isArray(stats)) return stats as Record<string, unknown>;
  return stats === undefined ? {} : { rawStats: stats };
}

function errorAuditDetails(error: unknown): { message: string; output?: string; stats?: Record<string, unknown> } {
  const message = error instanceof Error ? error.message : String(error);
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const partialOutput = typeof record.partialOutput === 'string' ? record.partialOutput : undefined;
  const stats = record.stats !== undefined ? objectStats(record.stats) : {};
  const cause = error instanceof Error && error.cause instanceof Error
    ? { causeName: error.cause.name, causeMessage: error.cause.message }
    : error instanceof Error && error.cause
      ? { cause: String(error.cause) }
      : {};
  return {
    message,
    output: partialOutput,
    stats: {
      ...stats,
      errorName: error instanceof Error ? error.name : undefined,
      errorMessage: message,
      ...cause
    }
  };
}

function resolvedModelFromStats(stats: unknown): string | undefined {
  const record = objectStats(stats);
  // Providers report the exact serving model differently: the Claude CLI as
  // `resolvedModel`, Gemini as `modelVersion`.
  const resolved = record.resolvedModel ?? record.modelVersion;
  return typeof resolved === 'string' && resolved.trim() ? resolved.trim() : undefined;
}

function annotateResolvedModel(exchange: LlmExchange): LlmExchange {
  if (exchange.resolvedModel) return exchange;
  const resolvedModel = resolvedModelFromStats(exchange.stats);
  return resolvedModel ? { ...exchange, resolvedModel } : exchange;
}

function stampResolvedTextModel(textModel: TextModelInfo, exchanges: LlmExchange[]): TextModelInfo {
  const resolvedModel = exchanges
    .filter((exchange) => exchange.status === 'complete')
    .map((exchange) => exchange.resolvedModel ?? resolvedModelFromStats(exchange.stats))
    .find((model): model is string => Boolean(model));
  // A resolved version identical to the selected model adds no information
  // (e.g. Gemini's modelVersion often matches the configured model).
  return resolvedModel && resolvedModel !== textModel.model && resolvedModel !== textModel.resolvedModel
    ? { ...textModel, resolvedModel }
    : textModel;
}

function qualityIssueScore(quality: VocabularyQualityResult): number {
  const trueOovWords = uniqueStrings(quality.issues.flatMap((issue) => issue.trueOutOfVocabularyWords));
  const rejectedDeclarationCount = quality.issues.reduce((total, issue) => total + issue.rejectedDeclarations.length, 0);
  return trueOovWords.length + rejectedDeclarationCount;
}

async function evaluateVocabularyQuality(
  setNumber: number,
  allowedVocabulary: VocabItem[],
  knownVocabulary: VocabItem[],
  conversations: PracticeConversation[]
): Promise<{ conversations: PracticeConversation[]; quality: VocabularyQualityResult }> {
  const analysis = await analyzeConversationsWithVocabulary(setNumber, allowedVocabulary, conversations, knownVocabulary);
  const threshold = vocabularyQualityThreshold(setNumber);
  const issues = analysis.conversations
    .map((conversation): VocabularyQualityIssue | null => {
      const evidence = analysis.evidenceByConversationId[conversation.id];
      const trueOutOfVocabularyWords = evidence?.outOfVocabularyUniqueWords ?? conversation.outOfVocabularyAudit;
      const rejectedDeclarations = evidence?.rejectedVocabularyDeclarations ?? [];
      if (trueOutOfVocabularyWords.length <= threshold && rejectedDeclarations.length === 0) return null;
      return {
        conversationId: conversation.id,
        number: conversation.number,
        title: conversation.title,
        trueOutOfVocabularyWords,
        rejectedDeclarations,
        lines: conversation.text.map((line) => ({ speaker: line.speaker, japanese: line.japanese }))
      };
    })
    .filter((issue): issue is VocabularyQualityIssue => Boolean(issue));

  return {
    conversations: analysis.conversations,
    quality: {
      threshold,
      passed: issues.length === 0,
      issues
    }
  };
}

function auditableGenerationFailureOutput(error: unknown): unknown | undefined {
  if (!(error instanceof AuditableGenerationError)) return undefined;
  return {
    exchanges: error.exchanges,
    conversations: error.conversations,
    vocabularyQuality: error.quality
  };
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isLlmExchange(value: unknown): value is LlmExchange {
  const record = recordValue(value);
  return Boolean(record
    && typeof record.id === 'string'
    && typeof record.prompt === 'string'
    && typeof record.requestedAt === 'string'
    && (record.status === 'pending' || record.status === 'complete' || record.status === 'failed'));
}

function nodeOutputExchanges(node: WorkflowAuditNode): LlmExchange[] {
  const output = recordValue(node.output);
  const exchanges = Array.isArray(output?.exchanges)
    ? output.exchanges.filter(isLlmExchange)
    : [];
  if (exchanges.length) return exchanges;
  if (isLlmExchange(output?.exchange)) return [output.exchange];
  if (isLlmExchange(node.output)) return [node.output];
  return [];
}

function workflowLlmExchanges(nodes: WorkflowAuditNode[]): LlmExchange[] {
  return nodes
    .filter((node) => node.kind === 'generator' || node.kind === 'balancer' || ['generation', 'triage', 'repair-candidate', 'pick', 'reroll'].includes(node.callKind ?? ''))
    .flatMap(nodeOutputExchanges);
}

function replaceRepairExchange(exchanges: LlmExchange[], repairExchange: LlmExchange): LlmExchange[] {
  return [
    ...exchanges.filter((exchange) => typeof objectStats(exchange.stats).repairAttempt !== 'number'),
    repairExchange
  ];
}

function preserveConversationIdentity(repaired: PracticeConversation[], originals: PracticeConversation[]): PracticeConversation[] {
  return repaired.map((conversation, index) => ({
    ...conversation,
    id: originals[index]?.id ?? conversation.id,
    number: originals[index]?.number ?? conversation.number
  }));
}

function replaceConversationsById(run: PracticeRun, replacements: PracticeConversation[]): PracticeConversation[] {
  const replacementById = new Map(replacements.map((conversation) => [conversation.id, conversation]));
  return run.conversations.map((conversation) => {
    const replacement = replacementById.get(conversation.id);
    if (!replacement) return conversation;
    return touchConversation({
      ...replacement,
      status: 'draft',
      audioFileName: undefined,
      audioUrl: undefined,
      error: undefined,
      curatedId: conversation.curatedId,
      curatedAt: conversation.curatedAt
    });
  });
}

function workflowAuditWithUpdatedTextNode(
  run: PracticeRun,
  nodeId: string,
  nodeOutput: Record<string, unknown>,
  changedConversationIds = new Set<string>()
): WorkflowRunAudit | undefined {
  if (!run.workflowAudit) return undefined;
  const updatedNodes = run.workflowAudit.nodes.map((node) => {
    if (node.id === nodeId) {
      return {
        ...node,
        completedAt: nowIso(),
        output: nodeOutput
      };
    }

    if (node.kind !== 'audio') return node;
    const input = recordValue(node.input);
    const conversationId = typeof input?.conversationId === 'string' ? input.conversationId : undefined;
    return conversationId && changedConversationIds.has(conversationId)
      ? {
        ...node,
        status: 'pending' as const,
        output: undefined,
        error: undefined,
        completedAt: undefined
      }
      : node;
  });
  const audioGeneratedCount = updatedNodes.filter((node) => node.kind === 'audio' && node.status === 'done').length;
  const audioErrors = updatedNodes
    .filter((node) => node.kind === 'audio' && node.status === 'error')
    .map((node) => ({
      conversationId: String(recordValue(node.input)?.conversationId ?? node.id),
      error: node.error ?? 'Audio generation failed.'
    }));
  return {
    ...run.workflowAudit,
    status: audioErrors.length || updatedNodes.some((node) => node.kind === 'audio' && node.status !== 'done') ? 'failed' : run.workflowAudit.status,
    audioGeneratedCount,
    audioErrors,
    nodes: updatedNodes,
    updatedAt: nowIso()
  };
}

function buildRepairPrompt(
  originalPrompt: string,
  allowedVocabulary: VocabItem[],
  conversations: PracticeConversation[],
  quality: VocabularyQualityResult
): string {
  return `Repair the generated JLPT listening-practice conversations below.

Goal:
Remove every true out-of-vocabulary Japanese content word and fix rejected proper-noun/cultural-reference declarations.

Hard rules:
1. Use only the allowed vocabulary table for Japanese content words.
2. If a sentence needs an unlisted Japanese content word, rewrite it with simpler allowed wording or change the scene.
3. You may keep or choose restrained common Japanese proper nouns or cultural references only when they fit naturally and are declared in declaredNonVocabularyTerms.
4. Do not declare ordinary grammar, adjectives, verbs, adverbs, classroom glue, or later-set vocabulary as cultural references.
5. Return exactly the same number of conversations as supplied, with the same JSON shape.

Allowed vocabulary table:
${allowedVocabulary.map((item) => `Set ${item.set} | ${item.japanese} | ${item.meaning}`).join('\n')}

Original generation prompt:
${originalPrompt}

Audit issues to fix:
${JSON.stringify(quality.issues, null, 2)}

Conversations to repair:
${JSON.stringify({ conversations }, null, 2)}

Return only valid JSON with a top-level "conversations" array.`;
}

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
}

function makeWorkflowJobId(setNumber: number): string {
  const stamp = nowIso().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const suffix = Math.random().toString(36).slice(2, 8);
  return `workflow-set-${String(setNumber).padStart(2, '0')}-${stamp}-${suffix}`;
}

function makeWorkflowNodes(audioCount: number): WorkflowAuditNode[] {
  const stageNodes = (stage: 'initial' | 'balance', offset: number): WorkflowAuditNode[] => {
    const titlePrefix = stage === 'initial' ? 'Initial' : 'Balance';
    const definitions: Array<{
      id: string;
      kind: WorkflowAuditNode['kind'];
      pass: 1 | 2;
      title: string;
      candidateIndex?: 1 | 2;
    }> = [
      { id: `${stage}:generation`, kind: 'generation', pass: 1, title: `${titlePrefix} generation` },
      { id: `${stage}:vocab-audit`, kind: 'vocab-audit', pass: 1, title: 'Vocabulary audit' },
      { id: `${stage}:triage`, kind: 'triage', pass: 1, title: 'Quality triage' },
      { id: `${stage}:repair-1`, kind: 'repair-candidate', pass: 1, title: 'Repair candidate 1', candidateIndex: 1 },
      { id: `${stage}:repair-2`, kind: 'repair-candidate', pass: 1, title: 'Repair candidate 2', candidateIndex: 2 },
      { id: `${stage}:dominance-gates`, kind: 'dominance-gates', pass: 1, title: 'Dominance gates' },
      { id: `${stage}:pick`, kind: 'pick', pass: 1, title: 'Pick' },
      { id: `${stage}:pass2:reroll`, kind: 'reroll', pass: 2, title: 'Re-roll' },
      { id: `${stage}:pass2:vocab-audit`, kind: 'vocab-audit', pass: 2, title: 'Re-roll vocabulary audit' },
      { id: `${stage}:pass2:triage`, kind: 'triage', pass: 2, title: 'Re-roll quality triage' },
      { id: `${stage}:pass2:repair-1`, kind: 'repair-candidate', pass: 2, title: 'Re-roll repair candidate 1', candidateIndex: 1 },
      { id: `${stage}:pass2:repair-2`, kind: 'repair-candidate', pass: 2, title: 'Re-roll repair candidate 2', candidateIndex: 2 },
      { id: `${stage}:pass2:dominance-gates`, kind: 'dominance-gates', pass: 2, title: 'Re-roll dominance gates' },
      { id: `${stage}:pass2:pick`, kind: 'pick', pass: 2, title: 'Re-roll pick' }
    ];
    return definitions.map((definition, index) => ({
      id: definition.id,
      kind: definition.kind,
      callKind: definition.kind as NonNullable<WorkflowAuditNode['callKind']>,
      stage,
      pass: definition.pass,
      candidateIndex: definition.candidateIndex,
      sequence: offset + index,
      title: definition.title,
      status: 'pending'
    }));
  };
  return [
    ...stageNodes('initial', 0),
    ...stageNodes('balance', 100),
    { id: 'final-audit', kind: 'final-audit', callKind: 'final-audit', sequence: 200, title: 'Final text audit', status: 'pending' },
    ...Array.from({ length: audioCount }, (_, index) => ({
      id: `audio-${index + 1}`,
      kind: 'audio' as const,
      callKind: 'audio' as const,
      sequence: 300 + index,
      title: `Conversation ${index + 1}`,
      status: 'pending' as const
    }))
  ];
}

function updateWorkflowJob(jobId: string, updater: (job: WorkflowJob) => WorkflowJob): WorkflowJob | undefined {
  const job = workflowJobs.get(jobId);
  if (!job) return undefined;
  const updated = {
    ...updater(job),
    updatedAt: nowIso()
  };
  workflowJobs.set(jobId, updated);
  const activeNode = updated.nodes.find((node) => node.status === 'processing') ?? updated.nodes.find((node) => node.status === 'pending');
  const completedAudio = updated.nodes.filter((node) => node.kind === 'audio' && node.status === 'done').length;
  const failedAudio = updated.nodes.filter((node) => node.kind === 'audio' && node.status === 'error').length;
  void updateStudioJob(jobId, (studioJob) => ({
    ...studioJob,
    // Keep preserving operator-set pausing/paused/queued inline: paused -> running
    // is a legal table transition (resume), so only the writer knows this write
    // is progress reporting rather than an operator resume.
    status: updated.status === 'complete' ? 'succeeded'
      : updated.status === 'failed' ? 'failed'
      : updated.status === 'paused' ? 'paused'
      : ['pausing', 'paused', 'queued'].includes(studioJob.status) ? studioJob.status
      : 'running',
    stageLabel: updated.status === 'paused' && updated.run?.finalTextAudit
      ? `Review final audit: accepted ${updated.run.finalTextAudit.acceptedCount} of ${updated.run.finalTextAudit.requestedCount} requested`
      : activeNode?.stage === 'initial' || activeNode?.kind === 'generator'
      ? 'Generating initial set'
      : activeNode?.stage === 'balance' || activeNode?.kind === 'balancer'
        ? 'Balancing set'
        : activeNode?.callKind === 'final-audit'
          ? 'Reviewing final text audit'
        : updated.audioRequestedCount > 0
          ? `${completedAudio}/${updated.audioRequestedCount} audio generated`
          : updated.status === 'complete' ? 'Complete' : 'Finishing',
    progress: {
      completed: completedAudio,
      total: updated.audioRequestedCount,
      failed: failedAudio,
      running: updated.nodes.filter((node) => node.kind === 'audio' && node.status === 'processing').length,
      queued: updated.nodes.filter((node) => node.kind === 'audio' && node.status === 'pending').length
    },
    stages: studioJob.stages.map((stage) => {
      const nodes = stage.id === 'audio' ? updated.nodes.filter((node) => node.kind === 'audio')
        : stage.id === 'generator' ? updated.nodes.filter((node) => node.stage === 'initial' || node.id === 'generator')
        : stage.id === 'balancer' ? updated.nodes.filter((node) => node.stage === 'balance' || node.id === 'balancer')
        : stage.id === 'final-audit' ? updated.nodes.filter((node) => node.callKind === 'final-audit')
        : updated.nodes.filter((node) => node.id === stage.id);
      if (!nodes.length) return stage;
      const status = nodes.some((node) => node.status === 'processing') ? 'running'
        : nodes.some((node) => node.status === 'error') ? 'failed'
        : nodes.every((node) => node.status === 'done' || node.status === 'repairWarning' || node.status === 'skipped') ? 'succeeded'
        : 'pending';
      return { ...stage, status };
    }),
    workflow: updated,
    error: updated.error,
    completedAt: updated.status === 'running' ? undefined : nowIso()
  })).catch(() => undefined);
  return updated;
}

function studioRunShell(job: StudioJob): StudioRunSummary | undefined {
  if (!job.runId || !job.setNumber || !['run-generation', 'workflow-generation', 'library-complement'].includes(job.kind)) return undefined;
  // Discarded jobs have nothing recoverable to show, and succeeded jobs whose
  // run was later deleted should not resurrect as ghost entries.
  if (job.status === 'cancelled' || job.status === 'succeeded') return undefined;
  const request = job.request as { conversationCount?: number; textModelId?: string } | undefined;
  return {
    kind: 'job',
    id: job.runId,
    jobId: job.id,
    setNumber: job.setNumber,
    title: job.title,
    modelLabel: job.workflow?.run?.textModel.label ?? request?.textModelId ?? 'Configured model',
    requestedConversationCount: request?.conversationCount ?? 0,
    status: job.status,
    stageLabel: job.stageLabel,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    resumable: job.status === 'interrupted' || job.status === 'failed' || job.status === 'paused'
  };
}

async function studioSnapshot(): Promise<StudioSnapshot> {
  const [runs, jobs] = await Promise.all([listRuns(), listStudioJobs()]);
  const runIds = new Set(runs.map((run) => run.id));
  const shells = jobs.map(studioRunShell).filter((summary): summary is StudioRunSummary => {
    if (!summary || summary.kind !== 'job') return false;
    return !runIds.has(summary.id);
  });
  return {
    generatedAt: nowIso(),
    revision: currentStudioEventRevision(),
    runs,
    runSummaries: [
      ...shells,
      ...runs.map((run): StudioRunSummary => ({ kind: 'run', id: run.id, run }))
    ].sort((a, b) => {
      const aTime = a.kind === 'run' ? a.run.createdAt : a.createdAt;
      const bTime = b.kind === 'run' ? b.run.createdAt : b.createdAt;
      return bTime.localeCompare(aTime);
    }),
    jobs: jobs.filter((job, index) => ['queued', 'running', 'pausing', 'paused', 'interrupted', 'failed'].includes(job.status) || index < 30)
  };
}

async function assertConversationHasNoActiveAudio(runId: string, conversationId: string): Promise<void> {
  if (await hasActiveConversationAudio(runId, conversationId)) {
    throw new Error('Audio generation is active for this conversation. Wait for it to finish or pause its parent job.');
  }
}

async function assertRunHasNoActiveJobs(runId: string): Promise<void> {
  const jobs = await listStudioJobs();
  if (jobs.some((job) => job.runId === runId && ['queued', 'running', 'pausing', 'paused', 'interrupted'].includes(job.status))) {
    throw new Error('This run has unfinished background work. Resume and finish it before changing the run.');
  }
}

function updateWorkflowNode(
  jobId: string,
  nodeId: string,
  patch: Partial<Omit<WorkflowAuditNode, 'id' | 'kind' | 'title'>>
): void {
  updateWorkflowJob(jobId, (job) => ({
    ...job,
    nodes: job.nodes.some((node) => node.id === nodeId)
      ? job.nodes.map((node) => node.id === nodeId ? {
          ...node,
          ...patch,
          output: patch.output && recordValue(node.output) && recordValue(patch.output)
            ? { ...recordValue(node.output), ...recordValue(patch.output) }
            : patch.output ?? node.output
        } : node)
      : [...job.nodes, {
          id: nodeId,
          kind: (patch.callKind ?? 'generation') as WorkflowAuditNode['kind'],
          callKind: patch.callKind,
          stage: patch.stage,
          pass: patch.pass,
          candidateIndex: patch.candidateIndex,
          sequence: patch.sequence ?? job.nodes.length,
          title: nodeId,
          status: patch.status ?? 'pending',
          ...patch
        }]
  }));
}

function publishWorkflowQualityNode(jobId: string, event: QualityNodeEvent): void {
  const sequenceBase = event.stage === 'initial' ? 0 : 100;
  const passOffset = event.pass === 1 ? 0 : 7;
  const kindOffset: Record<QualityNodeEvent['callKind'], number> = {
    generation: 0,
    'vocab-audit': 1,
    triage: 2,
    'repair-candidate': 2 + (event.candidateIndex ?? 1),
    'dominance-gates': 5,
    pick: 6,
    reroll: 0,
    'final-audit': 0,
    audio: 0
  };
  updateWorkflowNode(jobId, event.id, {
    callKind: event.callKind,
    stage: event.stage,
    pass: event.pass,
    candidateIndex: event.candidateIndex,
    sequence: sequenceBase + passOffset + kindOffset[event.callKind],
    status: event.status,
    startedAt: event.status === 'processing' ? nowIso() : undefined,
    completedAt: ['done', 'repairWarning', 'error', 'skipped'].includes(event.status) ? nowIso() : undefined,
    input: event.input,
    output: event.output,
    error: event.error
  });
}

function runStatusFor(conversations: PracticeConversation[]): PracticeRun['status'] {
  if (conversations.every((conversation) => conversation.status === 'audio_ready')) return 'complete';
  if (conversations.some((conversation) => conversation.audioFileName)) return 'partial_audio';
  return 'generated';
}

function countWorkflowVocabularyDistribution(words: string[], conversations: PracticeConversation[]) {
  const wordSet = new Set(words);
  const counts = new Map(words.map((word) => [word, 0]));

  for (const conversation of conversations) {
    for (const word of conversation.vocabularyUsed) {
      const cleaned = word.trim();
      if (wordSet.has(cleaned)) {
        counts.set(cleaned, (counts.get(cleaned) ?? 0) + 1);
      }
    }
  }

  const values = Array.from(counts.values());
  return {
    vocabularyTotal: words.length,
    missingCount: values.filter((count) => count <= 0).length,
    atMostOnceCount: values.filter((count) => count <= 1).length,
    atMostTwiceCount: values.filter((count) => count <= 2).length
  };
}

function calculateWorkflowDistributionStats(setNumber: number, allowedVocabulary: VocabItem[], conversations: PracticeConversation[]) {
  const allowedWords = allowedVocabulary.map((item) => item.japanese);
  const currentSetWords = allowedVocabulary.filter((item) => item.set === setNumber).map((item) => item.japanese);
  const cumulative = countWorkflowVocabularyDistribution(allowedWords, conversations);
  const currentSet = countWorkflowVocabularyDistribution(currentSetWords, conversations);

  return {
    allowedVocabularyTotal: allowedWords.length,
    currentSetTotal: currentSetWords.length,
    missingCount: cumulative.missingCount,
    atMostOnceCount: cumulative.atMostOnceCount,
    atMostTwiceCount: cumulative.atMostTwiceCount,
    currentSetMissingCount: currentSet.missingCount,
    currentSetAtMostOnceCount: currentSet.atMostOnceCount,
    currentSetAtMostTwiceCount: currentSet.atMostTwiceCount
  };
}

function workflowAuditForJob(job: WorkflowJob): WorkflowRunAudit {
  return {
    jobId: job.id,
    status: job.status,
    primaryConversationCount: job.primaryConversationCount,
    balanceConversationCount: job.balanceConversationCount,
    requestedTotalConversationCount: job.requestedTotalConversationCount,
    audioRequestedCount: job.audioRequestedCount,
    audioGeneratedCount: job.audioGeneratedCount,
    audioErrors: job.audioErrors,
    finalTextAudit: job.run?.finalTextAudit,
    nodes: job.nodes,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

function workflowAuditWithNode(run: PracticeRun, nodeId: string, patch: Partial<Omit<WorkflowAuditNode, 'id' | 'kind' | 'title'>>): WorkflowRunAudit | undefined {
  if (!run.workflowAudit) return undefined;
  return {
    ...run.workflowAudit,
    nodes: run.workflowAudit.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node),
    updatedAt: nowIso()
  };
}

function workflowAuditWithConversationAudioCleared(run: PracticeRun, conversationId: string): WorkflowRunAudit | undefined {
  if (!run.workflowAudit) return undefined;
  const nodes = run.workflowAudit.nodes.map((node) => {
    if (node.kind !== 'audio') return node;
    const input = node.input && typeof node.input === 'object' && !Array.isArray(node.input)
      ? node.input as Record<string, unknown>
      : {};
    return input.conversationId === conversationId
      ? {
        ...node,
        status: 'pending' as const,
        output: undefined,
        error: undefined,
        completedAt: undefined
      }
      : node;
  });
  const audioGeneratedCount = nodes.filter((node) => node.kind === 'audio' && node.status === 'done').length;
  const audioErrors = nodes
    .filter((node) => node.kind === 'audio' && node.status === 'error')
    .map((node) => ({
      conversationId: String((node.input as { conversationId?: unknown } | undefined)?.conversationId ?? node.id),
      error: node.error ?? 'Audio generation failed.'
    }));

  return {
    ...run.workflowAudit,
    status: audioErrors.length || nodes.some((node) => node.kind === 'audio' && node.status !== 'done') ? 'failed' : run.workflowAudit.status,
    audioGeneratedCount,
    audioErrors,
    nodes,
    updatedAt: nowIso()
  };
}

function renumberConversations(conversations: PracticeConversation[], startNumber: number): PracticeConversation[] {
  return conversations.map((conversation, index) => {
    const number = startNumber + index;
    return {
      ...conversation,
      id: `convo-${String(number).padStart(2, '0')}`,
      number
    };
  });
}

async function generateTextBatch(
  textModel: TextModelInfo,
  prompt: string,
  allowedVocabulary: VocabItem[],
  knownVocabulary: VocabItem[],
  setNumber: number,
  expectedCount: number,
  options: {
    stage?: 'initial' | 'balance';
    startNumber?: number;
    libraryContext?: AiCurationLibraryContext;
    onNode?: (event: QualityNodeEvent) => void | Promise<void>;
  } = {}
): Promise<{
  conversations: PracticeConversation[];
  exchange: LlmExchange;
  exchanges: LlmExchange[];
  quality: VocabularyQualityResult;
  stageAudit: Awaited<ReturnType<typeof runQualityControl>>['stageAudit'];
}> {
  const stage = options.stage ?? 'initial';
  const requestedAt = new Date().toISOString();
  const exchange = makeLlmExchange(textModel, prompt, requestedAt);
  await options.onNode?.({
    id: `${stage}:generation`,
    callKind: 'generation',
    stage,
    pass: 1,
    status: 'processing',
    title: stage === 'initial' ? 'Generate initial set' : 'Generate balance set',
    input: { prompt, model: textModel, requestedConversationCount: expectedCount }
  });
  let generation: Awaited<ReturnType<ConversationJsonGenerator>>;
  try {
    generation = await conversationJsonGenerator(prompt, textModel);
  } catch (error) {
    const failure = errorAuditDetails(error);
    const failed = {
      ...exchange,
      output: failure.output,
      stats: failure.stats,
      receivedAt: new Date().toISOString(),
      status: 'failed' as const,
      error: failure.message
    };
    await options.onNode?.({
      id: `${stage}:generation`, callKind: 'generation', stage, pass: 1, status: 'error',
      title: stage === 'initial' ? 'Generate initial set' : 'Generate balance set', error: failure.message,
      output: { summary: { statLine: 'Generation call failed' }, exchange: failed }
    });
    throw new AuditableGenerationError(failure.message, { exchanges: [failed], cause: error });
  }
  const normalized = renumberConversations(normalizeGeneratedConversations(generation.parsed, expectedCount), options.startNumber ?? 1);
  if (!normalized.length) {
    throw new AuditableGenerationError('The generation response did not include any usable conversations.', { exchanges: [{
      ...exchange,
      output: generation.output,
      stats: generation.stats,
      receivedAt: nowIso(),
      status: 'complete'
    }] });
  }
  const initialExchange: LlmExchange = annotateResolvedModel({
    ...exchange,
    output: generation.output,
    stats: { ...objectStats(generation.stats), vocabularyQualityStage: stage, selectedForFinal: true },
    receivedAt: nowIso(),
    status: 'complete'
  });
  await options.onNode?.({
    id: `${stage}:generation`, callKind: 'generation', stage, pass: 1, status: 'done',
    title: stage === 'initial' ? 'Generate initial set' : 'Generate balance set',
    output: { summary: { statLine: `${normalized.length} conversations generated`, conversationCount: normalized.length }, exchange: initialExchange, conversations: normalized }
  });
  const controlled = await runQualityControl({
    stage,
    textModel,
    originalPrompt: prompt,
    setNumber,
    expectedCount,
    allowedVocabulary,
    knownVocabulary,
    conversations: normalized,
    libraryContext: options.libraryContext,
    invoker: qualityStructuredInvokerForTests,
    conversationGenerator: conversationJsonGenerator,
    onNode: options.onNode
  });
  const evaluated = await evaluateVocabularyQuality(setNumber, allowedVocabulary, knownVocabulary, controlled.conversations);
  const exchanges = [
    { ...initialExchange, stats: { ...objectStats(initialExchange.stats), vocabularyQuality: evaluated.quality, finalVocabularyQuality: evaluated.quality } },
    ...controlled.exchanges
  ].map(annotateResolvedModel);
  const regenerateRate = controlled.stageAudit.generatedCount
    ? controlled.stageAudit.regenerateCount / controlled.stageAudit.generatedCount
    : 0;
  if (stage === 'initial' && regenerateRate > INITIAL_REGENERATE_FAILURE_RATE) {
    const guidance = `Initial quality regeneration rate ${Math.round(regenerateRate * 100)}% exceeded the ${Math.round(INITIAL_REGENERATE_FAILURE_RATE * 100)}% limit. Try a smaller batch, relax incompatible constraints, or adjust the generation prompt.`;
    await options.onNode?.({
      id: `${stage}:quality-threshold`,
      callKind: 'final-audit',
      stage,
      pass: 1,
      status: 'error',
      title: 'Initial quality threshold',
      error: guidance,
      output: {
        summary: { statLine: `${Math.round(regenerateRate * 100)}% regenerate · FAIL`, thresholdOutcome: 'fail' },
        details: { regenerateRate, limit: INITIAL_REGENERATE_FAILURE_RATE, guidance }
      }
    });
    throw new AuditableGenerationError(
      guidance,
      { exchanges, conversations: evaluated.conversations, quality: evaluated.quality }
    );
  }
  return {
    conversations: evaluated.conversations,
    exchange: exchanges[0],
    exchanges,
    quality: evaluated.quality,
    stageAudit: controlled.stageAudit
  };
}

function stageAuditForBatch(
  batch: { conversations: PracticeConversation[]; stageAudit?: Awaited<ReturnType<typeof runQualityControl>>['stageAudit'] },
  stage: 'initial' | 'balance',
  requestedCount: number
): Awaited<ReturnType<typeof runQualityControl>>['stageAudit'] {
  return batch.stageAudit ?? {
    stage,
    requestedCount,
    generatedCount: batch.conversations.length,
    acceptedCount: batch.conversations.length,
    regenerateCount: 0,
    rerollRequestedCount: 0,
    rerollGeneratedCount: 0,
    dropped: [],
    verdicts: [],
    picks: [],
    failures: []
  };
}

async function generateWorkflowAudio(run: PracticeRun, audioCount: number, options: { stopOnFirstError?: boolean; concurrency?: number } = {}): Promise<{
  run: PracticeRun;
  audioGeneratedCount: number;
  audioErrors: Array<{ conversationId: string; error: string }>;
}> {
  const targetConversations = run.conversations.slice(0, audioCount);
  let updatedRun: PracticeRun = {
    ...run,
    conversations: run.conversations.map((conversation) => targetConversations.some((target) => target.id === conversation.id)
      ? touchConversation({ ...conversation, status: 'audio_generating', error: undefined })
      : conversation),
    updatedAt: nowIso()
  };
  updatedRun.status = runStatusFor(updatedRun.conversations);
  await saveRun(updatedRun);

  const results: Array<PromiseSettledResult<{ fileName: string; filePath: string }> | undefined> = [];
  if (options.stopOnFirstError) {
    const concurrency = Math.max(1, options.concurrency ?? 1);
    let nextIndex = 0;
    let stopStarting = false;

    async function audioWorker(): Promise<void> {
      while (!stopStarting) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        const conversation = targetConversations[currentIndex];
        if (!conversation) return;

        try {
          results[currentIndex] = {
            status: 'fulfilled',
            value: await generateConversationAudio(run.id, conversation)
          };
        } catch (error) {
          results[currentIndex] = {
            status: 'rejected',
            reason: error
          };
          stopStarting = true;
          return;
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, targetConversations.length) }, () => audioWorker()));
  } else {
    results.push(...await Promise.allSettled(targetConversations.map((conversation) => generateConversationAudio(run.id, conversation))));
  }
  const audioErrors: Array<{ conversationId: string; error: string }> = [];
  let audioGeneratedCount = 0;

  updatedRun = {
    ...updatedRun,
    conversations: updatedRun.conversations.map((conversation) => {
      const targetIndex = targetConversations.findIndex((target) => target.id === conversation.id);
      if (targetIndex === -1) return conversation;

      const result = results[targetIndex];
      if (!result) {
        return touchConversation({
          ...targetConversations[targetIndex],
          status: 'draft',
          error: undefined
        });
      }
      if (result?.status === 'fulfilled') {
        audioGeneratedCount += 1;
        const audioUrl = `/audio/${encodeURIComponent(run.id)}/audio/${encodeURIComponent(result.value.fileName)}`;
        return touchConversation({
          ...conversation,
          status: 'audio_ready',
          audioFileName: result.value.fileName,
          audioUrl,
          error: undefined
        });
      }

      const message = result?.status === 'rejected'
        ? result.reason instanceof Error ? result.reason.message : String(result.reason)
        : 'Audio generation did not return a result.';
      audioErrors.push({ conversationId: conversation.id, error: message });
      return touchConversation({
        ...conversation,
        status: 'audio_failed',
        error: message
      });
    }),
    updatedAt: nowIso()
  };
  updatedRun.status = runStatusFor(updatedRun.conversations);
  await saveRun(updatedRun);

  return { run: updatedRun, audioGeneratedCount, audioErrors };
}

const GENERATION_JOB_KINDS = ['run-generation', 'workflow-generation', 'library-complement'];

/** Thrown by generationCheckpoint to unwind a runner whose job was paused or discarded. */
class GenerationHalted extends Error {
  constructor() {
    super('Generation halted by operator.');
  }
}

/**
 * Cooperative pause/cancel point between a runner's durable steps. An LLM call
 * already dispatched cannot be recalled, but its result is discarded: the
 * runner unwinds here instead of persisting further work.
 */
async function generationCheckpoint(jobId: string): Promise<void> {
  const job = await readStudioJob(jobId);
  if (job.status === 'cancelled') throw new GenerationHalted();
  if (job.status === 'pausing') {
    await updateStudioJob(jobId, (current) => ({ ...current, status: 'paused', stageLabel: 'Paused' }));
    throw new GenerationHalted();
  }
}

/** Runs a generation job once the single global text-generation slot is free. */
async function runQueuedGenerationJob(jobId: string, runner: () => Promise<void>): Promise<void> {
  try {
    await withGenerationSlot(async () => {
      const job = await readStudioJob(jobId);
      // Paused, discarded, or interrupted while waiting for the slot: skip.
      if (job.status !== 'queued' && job.status !== 'running') return;
      if (job.status === 'queued') {
        await updateStudioJob(jobId, (current) => ({ ...current, status: 'running' }));
      }
      await runner();
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateStudioJob(jobId, (current) => ({ ...current, status: 'failed', stageLabel: 'Generation failed', error: message, completedAt: nowIso() })).catch(() => undefined);
  }
}

async function runWorkflowJob(jobId: string, request: WorkflowGenerateRequest, resume = false): Promise<void> {
  try {
    const durableJob = await readStudioJob(jobId);
    const checkpoint = (durableJob.checkpoint ?? {}) as Record<string, unknown>;
    const context = await getWorkflowGenerateContext(request);
    if ('error' in context) {
      throw new Error(context.error);
    }

    let primary = resume ? checkpoint.primary as Awaited<ReturnType<typeof generateTextBatch>> | undefined : undefined;
    if (!primary) {
      primary = await generateTextBatch(
        context.textModel,
        context.prompt,
        context.allowedVocabulary,
        context.knownVocabulary,
        context.setNumber,
        context.conversationCount,
        {
          stage: 'initial',
          libraryContext: context.qualityLibraryContext,
          onNode: (event) => publishWorkflowQualityNode(jobId, event)
        }
      );
    }
    if (!primary.conversations.length) {
      throw new Error('The generation response did not include any usable conversations.');
    }
    await updateStudioJob(jobId, (job) => ({
      ...job,
      checkpoint: { ...(job.checkpoint as Record<string, unknown> | undefined), primary }
    }));
    await generationCheckpoint(jobId);

    const balance = buildGeneratedRunBalancePlan(
      context.setNumber,
      context.allowedVocabulary,
      primary.conversations,
      context.balanceConversationCount
    );
    const complementPrompt = buildLibraryComplementPrompt(
      context.setNumber,
      context.allowedVocabulary,
      balance,
      'fresh generated batch'
    );
    let complement = resume ? checkpoint.complement as Awaited<ReturnType<typeof generateTextBatch>> | undefined : undefined;
    if (!complement) {
      complement = await generateTextBatch(
        context.textModel,
        complementPrompt,
        context.allowedVocabulary,
        context.knownVocabulary,
        context.setNumber,
        context.balanceConversationCount,
        {
          stage: 'balance',
          startNumber: primary.conversations.length + 1,
          libraryContext: context.qualityLibraryContext,
          onNode: (event) => publishWorkflowQualityNode(jobId, event)
        }
      );
    }
    const complementConversations = renumberConversations(complement.conversations, primary.conversations.length + 1);
    const conversations = [...primary.conversations, ...complementConversations];
    if (conversations.length <= primary.conversations.length) {
      throw new Error('The balancing response did not include any usable conversations.');
    }
    await updateStudioJob(jobId, (job) => ({
      ...job,
      checkpoint: {
        ...(job.checkpoint as Record<string, unknown> | undefined),
        primary,
        complement: { ...complement, conversations: complementConversations },
        conversations
      }
    }));
    await generationCheckpoint(jobId);

    const legacyCheckpoint = resume && (!primary.stageAudit || !complement.stageAudit);
    updateWorkflowNode(jobId, 'final-audit', {
      status: 'processing',
      startedAt: nowIso(),
      input: { requestedCount: context.conversationCount + context.balanceConversationCount }
    });
    const finalTextAudit = checkpoint.finalTextAudit as ReturnType<typeof buildFinalTextAudit> | undefined ?? buildFinalTextAudit({
      requestedCount: context.conversationCount + context.balanceConversationCount,
      initial: stageAuditForBatch(primary, 'initial', context.conversationCount),
      balance: stageAuditForBatch(complement, 'balance', context.balanceConversationCount),
      conversations,
      currentSetVocabulary: context.allowedVocabulary.filter((item) => item.set === context.setNumber),
      distributionStats: calculateWorkflowDistributionStats(context.setNumber, context.allowedVocabulary, conversations)
    });
    updateWorkflowNode(jobId, 'final-audit', {
      status: 'done',
      completedAt: nowIso(),
      output: {
        summary: {
          statLine: `${finalTextAudit.acceptedCount}/${finalTextAudit.requestedCount} accepted · ${finalTextAudit.outcome.toUpperCase()}`,
          acceptedCount: finalTextAudit.acceptedCount,
          requestedCount: finalTextAudit.requestedCount,
          thresholdOutcome: finalTextAudit.outcome
        },
        factsByConversationId: Object.fromEntries(conversations.map((conversation) => [conversation.id, {
          quality: conversation.quality,
          flags: conversation.qualityFlags,
          remainingOutOfVocabulary: conversation.outOfVocabularyAudit
        }])),
        details: finalTextAudit
      }
    });
    await updateStudioJob(jobId, (job) => ({
      ...job,
      checkpoint: { ...(job.checkpoint as Record<string, unknown> | undefined), finalTextAudit }
    }));

    const timestamp = nowIso();
    const existingRun = resume && durableJob.runId ? await readRun(durableJob.runId).catch(() => undefined) : undefined;
    let run = existingRun ?? await saveRun({
      id: durableJob.runId ?? makeRunId(context.setNumber),
      setNumber: context.setNumber,
      conversationCount: context.conversationCount + context.balanceConversationCount,
      allowedVocabCount: context.allowedVocabulary.length,
      textModel: stampResolvedTextModel(context.textModel, [
        ...(primary.exchanges ?? [primary.exchange]),
        ...(complement.exchanges ?? [complement.exchange])
      ]),
      analytics: calculateRunAnalytics(context.setNumber, context.allowedVocabulary, conversations),
      status: 'generated',
      finalTextAudit,
      llmExchanges: [
        ...(primary.exchanges ?? [primary.exchange]),
        ...(complement.exchanges ?? [complement.exchange]).map((exchange) => ({
          ...complement.exchange,
          ...exchange,
          stats: {
            ...objectStats(exchange.stats),
            generatedBatchBalance: balance
          }
        }))
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
      conversations
    });
    const textCompleteJob = updateWorkflowJob(jobId, (job) => ({ ...job, run }));
    if (textCompleteJob) {
      run = {
        ...run,
        finalTextAudit,
        workflowAudit: { ...workflowAuditForJob(textCompleteJob), finalTextAudit }
      };
      await mutateRun(run.id, () => run);
      updateWorkflowJob(jobId, (job) => ({ ...job, run }));
    }

    if (finalTextAudit.outcome === 'fail') {
      throw new Error(finalTextAudit.guidance ?? 'The final text audit failed.');
    }
    if (finalTextAudit.outcome === 'pause' && checkpoint.reviewApproved !== true && !legacyCheckpoint) {
      const paused = updateWorkflowJob(jobId, (job) => ({ ...job, status: 'paused', run }));
      if (paused) {
        run = { ...run, workflowAudit: { ...workflowAuditForJob(paused), finalTextAudit } };
        await mutateRun(run.id, () => run);
      }
      await updateStudioJob(jobId, (job) => ({
        ...job,
        status: 'paused',
        stageLabel: `Review final audit: accepted ${finalTextAudit.acceptedCount} of ${finalTextAudit.requestedCount} requested`,
        runId: run.id,
        checkpoint: { ...(job.checkpoint as Record<string, unknown> | undefined), finalTextAudit, conversations, runId: run.id }
      }));
      return;
    }

    const audioTargets = run.conversations.slice(0, context.audioCount);
    const preDoneCount = audioTargets.filter((conversation) => conversation.audioFileName).length;
    await updateStudioJob(jobId, (job) => ({
      ...job,
      stopOnFailure: context.audioMode === 'max',
      stageLabel: audioTargets.length ? `${preDoneCount}/${audioTargets.length} audio generated` : 'Complete',
      progress: { completed: preDoneCount, total: audioTargets.length, queued: audioTargets.length - preDoneCount }
    }));
    const existingAudioChildren = (await listStudioJobs()).filter((job) => job.parentJobId === jobId || job.dependentParentJobIds?.includes(jobId));
    if (resume && existingAudioChildren.length) await resumeAudioParent(jobId);
    let pendingAudio = false;
    for (let index = 0; index < audioTargets.length; index += 1) {
      const conversation = audioTargets[index];
      // Audio already on disk (a prior pass generated it): record the node as
      // done instead of re-enqueueing, so repeated resumes never redo work.
      if (conversation.audioFileName) {
        updateWorkflowNode(jobId, `audio-${index + 1}`, {
          status: 'done',
          completedAt: nowIso(),
          output: { fileName: conversation.audioFileName }
        });
        continue;
      }
      updateWorkflowNode(jobId, `audio-${index + 1}`, {
        status: 'pending',
        input: {
          conversationId: conversation.id,
          conversationTitle: conversation.title,
          model: process.env.GEMINI_TTS_MODEL ?? 'GEMINI_TTS_MODEL not configured',
          prompt: buildTtsPrompt(conversation)
        }
      });
      await enqueueConversationAudio({ runId: run.id, conversationId: conversation.id, parentJobId: jobId });
      pendingAudio = true;
    }
    if (pendingAudio) {
      const settled = await waitForStudioJob(jobId);
      // Operator paused or discarded during the audio phase: leave the durable
      // checkpoint as-is for resume instead of writing a terminal audit.
      if (settled.status === 'paused' || settled.status === 'interrupted' || settled.status === 'cancelled') return;
    }
    const childJobs = (await listStudioJobs()).filter((job) => job.parentJobId === jobId);
    const audioErrors = childJobs.filter((job) => job.status === 'failed').map((job) => ({
      conversationId: job.conversationId ?? '',
      error: job.error ?? 'Audio generation failed.'
    }));
    run = await readRun(run.id);
    const audioGeneratedCount = audioTargets.filter((target) => run.conversations.find((item) => item.id === target.id)?.audioFileName).length;
    for (let index = 0; index < audioTargets.length; index += 1) {
      const child = childJobs.find((job) => job.conversationId === audioTargets[index].id && job.status === 'succeeded')
        ?? childJobs.find((job) => job.conversationId === audioTargets[index].id);
      const fileName = run.conversations.find((item) => item.id === audioTargets[index].id)?.audioFileName;
      // Audio on disk is the ground truth for the node, regardless of which
      // (possibly duplicated) child job produced it.
      updateWorkflowNode(jobId, `audio-${index + 1}`, fileName
        ? { status: 'done', completedAt: child?.completedAt ?? nowIso(), output: { fileName } }
        : child?.status === 'failed'
          ? { status: 'error', completedAt: child.completedAt, error: child.error }
          : { status: 'skipped', completedAt: nowIso(), error: child?.error ?? 'Audio generation skipped.' });
    }
    const completedJob = updateWorkflowJob(jobId, (job) => ({
      ...job,
      status: audioErrors.length ? 'failed' : 'complete',
      audioGeneratedCount,
      audioErrors,
      run,
      error: audioErrors.length ? 'One or more audio calls failed.' : undefined
    }));
    if (completedJob) {
      run = {
        ...run,
        workflowAudit: workflowAuditForJob(completedJob)
      };
    }
    await mutateRun(run.id, () => run);
    updateWorkflowJob(jobId, (job) => ({ ...job, run }));
  } catch (error) {
    if (error instanceof GenerationHalted) return;
    const message = error instanceof Error ? error.message : String(error);
    const failureOutput = auditableGenerationFailureOutput(error);
    updateWorkflowJob(jobId, (job) => ({
      ...job,
      status: 'failed',
      error: message,
      nodes: job.nodes.map((node) => node.status === 'processing'
        ? { ...node, status: 'error' as WorkflowNodeStatus, completedAt: nowIso(), error: message, output: failureOutput ?? node.output }
        : node.status === 'pending'
          ? { ...node, status: 'skipped' as WorkflowNodeStatus, completedAt: nowIso(), error: 'Skipped after a run-stopping failure.' }
          : node)
    }));
  }
}

async function runStandardGenerationJob(jobId: string): Promise<void> {
  const job = await readStudioJob(jobId);
  const request = job.request as GenerateRequest;
  try {
    const context = await getGenerateContext(request);
    if ('error' in context) throw new Error(context.error);
    await updateStudioJob(jobId, (current) => ({
      ...current,
      status: 'running',
      stageLabel: 'Generating initial set',
      stages: current.stages.map((stage) => ({ ...stage, status: 'running', startedAt: nowIso() }))
    }));
    const generated = await generateTextBatch(
      context.textModel,
      context.prompt,
      context.allowedVocabulary,
      context.knownVocabulary,
      context.setNumber,
      context.conversationCount,
      { stage: 'initial', libraryContext: context.qualityLibraryContext }
    );
    if (!generated.conversations.length) throw new Error('The generation response did not include any usable conversations.');
    await generationCheckpoint(jobId);
    const timestamp = nowIso();
    const finalTextAudit = buildFinalTextAudit({
      requestedCount: context.conversationCount,
      initial: generated.stageAudit,
      conversations: generated.conversations,
      currentSetVocabulary: context.allowedVocabulary.filter((item) => item.set === context.setNumber)
    });
    const run = await saveRun({
      id: job.runId ?? makeRunId(context.setNumber),
      setNumber: context.setNumber,
      conversationCount: context.conversationCount,
      allowedVocabCount: context.allowedVocabulary.length,
      textModel: stampResolvedTextModel(context.textModel, generated.exchanges),
      analytics: calculateRunAnalytics(context.setNumber, context.allowedVocabulary, generated.conversations),
      status: 'generated',
      llmExchanges: generated.exchanges,
      finalTextAudit,
      createdAt: job.createdAt,
      updatedAt: timestamp,
      conversations: generated.conversations
    });
    await updateStudioJob(jobId, (current) => ({
      ...current,
      status: 'succeeded',
      stageLabel: 'Initial set generated',
      checkpoint: { generated, runId: run.id },
      progress: { completed: 1, total: 1 },
      completedAt: timestamp,
      stages: current.stages.map((stage) => ({ ...stage, status: 'succeeded', completedAt: timestamp }))
    }));
  } catch (error) {
    if (error instanceof GenerationHalted) return;
    const message = error instanceof Error ? error.message : String(error);
    const generationFailure = auditableGenerationFailureOutput(error);
    await updateStudioJob(jobId, (current) => ({
      ...current,
      status: 'failed',
      stageLabel: 'Generation failed',
      error: message,
      checkpoint: generationFailure ? { ...(current.checkpoint as Record<string, unknown> | undefined), generationFailure } : current.checkpoint,
      completedAt: nowIso(),
      stages: current.stages.map((stage) => stage.status === 'running' ? { ...stage, status: 'failed', completedAt: nowIso(), error: message } : stage)
    }));
  }
}

async function runLibraryComplementJob(jobId: string): Promise<void> {
  const job = await readStudioJob(jobId);
  const request = job.request as LibraryComplementGenerateRequest & { setNumber: number };
  try {
    const context = await getLibraryComplementContext(request.setNumber, request);
    if ('error' in context) throw new Error(context.error);
    await updateStudioJob(jobId, (current) => ({ ...current, status: 'running', stageLabel: 'Generating balanced set' }));
    const generated = await generateTextBatch(
      context.textModel,
      context.prompt,
      context.allowedVocabulary,
      context.knownVocabulary,
      context.setNumber,
      context.conversationCount,
      { stage: 'balance', libraryContext: context.librarySnapshotContext }
    );
    if (!generated.conversations.length) throw new Error('The generation response did not include any usable conversations.');
    await generationCheckpoint(jobId);
    const timestamp = nowIso();
    const exchanges = generated.exchanges.map((exchange) => ({
      ...exchange,
      stats: {
        ...(exchange.stats && typeof exchange.stats === 'object' ? exchange.stats : { rawStats: exchange.stats }),
        libraryBalance: context.balance,
        libraryBalanceMode: context.balanceMode
      }
    }));
    const run = await saveRun({
      id: job.runId ?? makeRunId(context.setNumber),
      setNumber: context.setNumber,
      conversationCount: context.conversationCount,
      allowedVocabCount: context.allowedVocabulary.length,
      textModel: stampResolvedTextModel(context.textModel, exchanges),
      analytics: calculateRunAnalytics(context.setNumber, context.allowedVocabulary, generated.conversations),
      status: 'generated',
      llmExchanges: exchanges,
      finalTextAudit: buildFinalTextAudit({
        requestedCount: context.conversationCount,
        initial: generated.stageAudit,
        conversations: generated.conversations,
        currentSetVocabulary: context.allowedVocabulary.filter((item) => item.set === context.setNumber)
      }),
      createdAt: job.createdAt,
      updatedAt: timestamp,
      conversations: generated.conversations
    });
    await updateStudioJob(jobId, (current) => ({
      ...current,
      status: 'succeeded',
      stageLabel: 'Balanced set generated',
      checkpoint: { runId: run.id },
      progress: { completed: 1, total: 1 },
      completedAt: timestamp,
      stages: current.stages.map((stage) => ({ ...stage, status: 'succeeded', completedAt: timestamp }))
    }));
  } catch (error) {
    if (error instanceof GenerationHalted) return;
    const message = error instanceof Error ? error.message : String(error);
    const generationFailure = auditableGenerationFailureOutput(error);
    await updateStudioJob(jobId, (current) => ({
      ...current,
      status: 'failed',
      stageLabel: 'Balance generation failed',
      error: message,
      checkpoint: generationFailure ? { ...(current.checkpoint as Record<string, unknown> | undefined), generationFailure } : current.checkpoint,
      completedAt: nowIso()
    }));
  }
}

app.get('/api/studio/snapshot', asyncHandler(async (_req, res) => {
  res.json({ snapshot: await studioSnapshot() });
}));

app.get('/api/studio/events', (req, res) => {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`event: connected\ndata: ${JSON.stringify({ revision: currentStudioEventRevision() })}\n\n`);
  const unsubscribe = subscribeStudioEvents((event) => {
    res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(`: heartbeat ${Date.now()}\n\n`), 15_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

app.get('/api/studio/jobs/:jobId', asyncHandler(async (req, res) => {
  res.json({ job: await readStudioJob(routeParam(req.params.jobId)) });
}));

app.post('/api/studio/jobs/:jobId/pause', asyncHandler(async (req, res) => {
  const job = await readStudioJob(routeParam(req.params.jobId));
  if (job.kind === 'audio-batch' || job.kind === 'add-all-audio') {
    res.json({ job: await pauseAudioParent(job.id) });
    return;
  }
  if (GENERATION_JOB_KINDS.includes(job.kind)) {
    if (job.status === 'queued') {
      res.json({ job: await updateStudioJob(job.id, (current) => ({ ...current, status: 'paused', stageLabel: 'Paused before start' })) });
      return;
    }
    if (job.status === 'running') {
      // If the job is in its audio phase it pauses like an audio parent;
      // otherwise the runner honors this at its next generation checkpoint.
      res.json({ job: await updateStudioJob(job.id, (current) => ({ ...current, status: 'pausing', stageLabel: 'Pausing after current step' })) });
      return;
    }
    res.status(409).json({ error: 'This job is not running.' });
    return;
  }
  res.status(409).json({ error: 'This job cannot be paused.' });
}));

app.post('/api/studio/jobs/:jobId/cancel', asyncHandler(async (req, res) => {
  const job = await readStudioJob(routeParam(req.params.jobId));
  if (job.kind === 'audio-batch' || job.kind === 'add-all-audio') {
    res.json({ job: await cancelAudioParent(job.id) });
    return;
  }
  if (GENERATION_JOB_KINDS.includes(job.kind)) {
    if (!['queued', 'running', 'pausing', 'paused', 'interrupted', 'failed'].includes(job.status)) {
      res.status(409).json({ error: 'This job is already finished.' });
      return;
    }
    const cancelled = await updateStudioJob(job.id, (current) => ({
      ...current,
      status: 'cancelled',
      stageLabel: 'Discarded',
      completedAt: nowIso(),
      stages: current.stages.map((stage) => stage.status === 'succeeded'
        ? stage
        : { ...stage, status: 'skipped', completedAt: nowIso() })
    }));
    await cancelUnresolvedAudioChildren(job.id);
    res.json({ job: cancelled });
    return;
  }
  res.status(409).json({ error: 'This job cannot be discarded.' });
}));

app.post('/api/studio/jobs/:jobId/resume', asyncHandler(async (req, res) => {
  const job = await readStudioJob(routeParam(req.params.jobId));
  if (job.status === 'cancelled') {
    res.status(409).json({ error: 'This job was discarded and can no longer be resumed.' });
    return;
  }
  if (job.status === 'succeeded') {
    res.status(409).json({ error: 'This job already completed.' });
    return;
  }
  if (job.status === 'running' || job.status === 'queued' || job.status === 'pausing') {
    // Idempotent: a repeated resume (double click, stale view) must not restart work.
    res.status(202).json({ job });
    return;
  }
  if (job.kind === 'audio-batch' || job.kind === 'add-all-audio') {
    res.json({ job: await resumeAudioParent(job.id) });
    return;
  }
  if (job.kind === 'audio-child') {
    res.status(202).json({ job: await resumeConversationAudioJob(job.id) });
    return;
  }
  if (job.kind === 'workflow-generation') {
    if (!job.workflow || !job.request) throw new Error('Workflow checkpoint is incomplete.');
    const approvedFinalAudit = job.status === 'paused' && Boolean((job.checkpoint as Record<string, unknown> | undefined)?.finalTextAudit);
    const resumed = await updateStudioJob(job.id, (current) => ({
      ...current,
      status: 'queued',
      stageLabel: isGenerationSlotBusy() ? 'Waiting for earlier generation' : 'Resuming workflow',
      error: undefined,
      checkpoint: approvedFinalAudit
        ? { ...(current.checkpoint as Record<string, unknown> | undefined), reviewApproved: true }
        : current.checkpoint
    }));
    workflowJobs.set(job.id, { ...job.workflow, status: 'running', error: undefined });
    void runQueuedGenerationJob(job.id, () => runWorkflowJob(job.id, job.request as WorkflowGenerateRequest, true));
    res.status(202).json({ job: resumed });
    return;
  }
  if (job.kind === 'run-generation') {
    const resumed = await updateStudioJob(job.id, (current) => ({ ...current, status: 'queued', stageLabel: isGenerationSlotBusy() ? 'Waiting for earlier generation' : 'Resuming generation', error: undefined }));
    void runQueuedGenerationJob(job.id, () => runStandardGenerationJob(job.id));
    res.status(202).json({ job: resumed });
    return;
  }
  if (job.kind === 'library-complement') {
    const resumed = await updateStudioJob(job.id, (current) => ({ ...current, status: 'queued', stageLabel: isGenerationSlotBusy() ? 'Waiting for earlier generation' : 'Resuming balance generation', error: undefined }));
    void runQueuedGenerationJob(job.id, () => runLibraryComplementJob(job.id));
    res.status(202).json({ job: resumed });
    return;
  }
  res.status(409).json({ error: 'This job cannot be resumed yet.' });
}));

app.post('/api/studio/audio-batches', asyncHandler(async (req, res) => {
  const body = req.body as {
    items?: Array<{ runId?: string; conversationId?: string }>;
    idempotencyKey?: string;
    setNumber?: number;
    title?: string;
  };
  const items = (body.items ?? []).filter((item): item is { runId: string; conversationId: string } => Boolean(item.runId && item.conversationId));
  if (!items.length || items.length !== body.items?.length) {
    res.status(400).json({ error: 'At least one valid audio source is required.' });
    return;
  }
  const job = await createCrossRunAudioBatch({
    items,
    idempotencyKey: body.idempotencyKey ?? makeStudioJobId('add-all-request'),
    setNumber: body.setNumber,
    title: body.title ?? 'Generate recommendation audio',
    stopOnFailure: true
  });
  res.status(202).json({ job });
}));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/sets', asyncHandler(async (_req, res) => {
  res.json({ sets: await getSetSummaries() });
}));

app.get('/api/vocabulary', asyncHandler(async (_req, res) => {
  res.json({ vocabulary: await readVocabulary() });
}));

app.get('/api/text-models', asyncHandler(async (_req, res) => {
  res.json({ models: await getTextModelOptions() });
}));

app.get('/api/runs', asyncHandler(async (_req, res) => {
  res.json({ runs: await listRuns() });
}));

app.get('/api/runs/:runId', asyncHandler(async (req, res) => {
  let run: PracticeRun;
  try {
    run = await readRun(routeParam(req.params.runId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      res.status(404).json({ error: 'Run not found. It may still be generating or was deleted.' });
      return;
    }
    throw error;
  }
  res.json({
    run,
    evidenceByConversationId: await getConversationCurationEvidence(run.setNumber, run.conversations)
  });
}));

app.delete('/api/runs/:runId', asyncHandler(async (req, res) => {
  const runId = routeParam(req.params.runId);
  await assertRunHasNoActiveJobs(runId);
  await deleteRun(runId);
  res.json({ deletedRunId: runId, runs: await listRuns() });
}));

app.post('/api/runs/:runId/reanalyze', asyncHandler(async (req, res) => {
  const run = await reanalyzeRun(routeParam(req.params.runId));
  res.json({
    run,
    evidenceByConversationId: await getConversationCurationEvidence(run.setNumber, run.conversations)
  });
}));

app.post('/api/runs/:runId/workflow-nodes/:nodeId/repair', asyncHandler(async (req, res) => {
  const runId = routeParam(req.params.runId);
  const nodeId = routeParam(req.params.nodeId);
  await assertRunHasNoActiveJobs(runId);

  const run = await readRun(runId);
  const node = run.workflowAudit?.nodes.find((item) => item.id === nodeId);
  if (!run.workflowAudit || !node) {
    res.status(404).json({ error: 'Workflow audit node not found for this run.' });
    return;
  }
  if (node.callKind && node.stage) {
    if (!['repair-candidate', 'dominance-gates', 'pick'].includes(node.callKind)) {
      res.status(409).json({ error: 'Choose a repair, gates, or pick node to rerun the scoped repair flow.' });
      return;
    }
    if (!['done', 'repairWarning', 'error'].includes(node.status)) {
      res.status(409).json({ error: 'Repair can only be rerun after the selected node has finished.' });
      return;
    }
    const pass = node.pass ?? 1;
    const stageNodes = run.workflowAudit.nodes.filter((item) => item.stage === node.stage && (item.pass ?? 1) === pass);
    const triageNode = stageNodes.find((item) => item.callKind === 'triage');
    const sourceNode = stageNodes.find((item) => pass === 2 ? item.callKind === 'reroll' : item.callKind === 'generation');
    const triageDetails = recordValue(recordValue(triageNode?.output)?.details);
    const verdicts = Array.isArray(triageDetails?.verdicts) ? triageDetails.verdicts.map(recordValue).filter(Boolean) : [];
    const repairIds = new Set(verdicts.filter((verdict) => verdict?.verdict === 'repair').map((verdict) => String(verdict?.conversationId)));
    const sourceConversations = Array.isArray(recordValue(sourceNode?.output)?.conversations)
      ? (recordValue(sourceNode?.output)?.conversations as unknown[]).filter((item): item is PracticeConversation => Boolean(recordValue(item) && Array.isArray(recordValue(item)?.text)))
      : [];
    const flagged = sourceConversations.filter((conversation) => repairIds.has(conversation.id));
    if (!flagged.length) {
      res.status(409).json({ error: 'The saved per-call audit has no flagged source conversations to repair.' });
      return;
    }
    if (run.conversations.some((conversation) => repairIds.has(conversation.id) && conversation.curatedId)) {
      res.status(409).json({ error: 'Remove repaired conversations from the curated library before changing their generated text.' });
      return;
    }
    const sourceInput = recordValue(sourceNode?.input);
    const originalPrompt = typeof sourceInput?.prompt === 'string' ? sourceInput.prompt : 'Repair the saved flagged conversations.';
    const allowedVocabulary = await getAllowedVocabulary(run.setNumber);
    const knownVocabulary = await readVocabulary();
    const publishedEvents = new Map<string, QualityNodeEvent>();
    let forcedTriage = true;
    const rerunInvoker: StructuredJsonInvoker = async (prompt, textModel, instructions) => {
      if (forcedTriage && prompt.includes('Conversations with authoritative evidence:')) {
        forcedTriage = false;
        const forcedVerdicts = flagged.map((conversation) => ({
          conversationId: conversation.id,
          verdict: 'repair',
          rationale: 'Operator requested a scoped repair rerun from the saved audit.',
          flags: ['operator_repair_rerun']
        }));
        return { parsed: { verdicts: forcedVerdicts }, output: JSON.stringify({ verdicts: forcedVerdicts }) };
      }
      return (qualityStructuredInvokerForTests ?? invokeStructuredJson)(prompt, textModel, instructions);
    };
    const result = await runQualityControl({
      stage: node.stage,
      textModel: run.textModel,
      originalPrompt,
      setNumber: run.setNumber,
      expectedCount: flagged.length,
      allowedVocabulary,
      knownVocabulary,
      conversations: flagged,
      libraryContext: await getQualityLibraryContext(run.setNumber),
      invoker: rerunInvoker,
      conversationGenerator: conversationJsonGenerator,
      onNode: (event) => { publishedEvents.set(event.id, event); }
    });
    const replacements = result.conversations;
    const originalById = new Map(flagged.map((conversation) => [conversation.id, conversation]));
    const changedIds = new Set(replacements.filter((conversation) => JSON.stringify(conversation.text) !== JSON.stringify(originalById.get(conversation.id)?.text)).map((conversation) => conversation.id));
    const rerunSuffix = `rerun-${Date.now()}`;
    const appendedNodes: WorkflowAuditNode[] = [...publishedEvents.values()].map((event, index) => ({
      id: `${event.id}:${rerunSuffix}`,
      kind: event.callKind,
      callKind: event.callKind,
      stage: event.stage,
      pass: event.pass,
      candidateIndex: event.candidateIndex,
      sequence: Math.max(0, ...run.workflowAudit!.nodes.map((item) => item.sequence ?? 0)) + index + 1,
      title: `${event.title} (rerun)`,
      status: event.status,
      startedAt: event.status === 'processing' ? nowIso() : undefined,
      completedAt: event.status === 'processing' ? undefined : nowIso(),
      input: event.input,
      output: event.output,
      error: event.error
    }));
    const updated = await mutateRun(run.id, async (current) => {
      await Promise.all(current.conversations.map((conversation) => changedIds.has(conversation.id) && conversation.audioFileName
        ? deleteAudioFile(current.id, conversation.audioFileName)
        : Promise.resolve()));
      const conversations = replaceConversationsById(current, replacements);
      let workflowAudit = current.workflowAudit!;
      for (const conversationId of changedIds) {
        workflowAudit = workflowAuditWithConversationAudioCleared({ ...current, workflowAudit }, conversationId) ?? workflowAudit;
      }
      workflowAudit = { ...workflowAudit, nodes: [...workflowAudit.nodes, ...appendedNodes], updatedAt: nowIso() };
      const next = {
        ...current,
        conversations,
        analytics: calculateRunAnalytics(current.setNumber, allowedVocabulary, conversations),
        workflowAudit,
        llmExchanges: workflowLlmExchanges(workflowAudit.nodes),
        updatedAt: nowIso()
      };
      next.status = runStatusFor(next.conversations);
      return next;
    });
    const responseExchange = [...result.exchanges].reverse().find((item) => item.status === 'complete') ?? result.exchanges.at(-1);
    if (!responseExchange) throw new Error('Scoped repair rerun did not record a model exchange.');
    res.json({
      run: updated,
      repairApplied: changedIds.size > 0,
      repairOutcome: changedIds.size > 0 ? 'improved' : 'not_improved',
      exchange: responseExchange,
      evidenceByConversationId: await getConversationCurationEvidence(updated.setNumber, updated.conversations)
    } satisfies WorkflowRepairResponse);
    return;
  }
  if (node.kind !== 'generator' && node.kind !== 'balancer') {
    res.status(409).json({ error: 'Only text-generation workflow nodes can be repaired.' });
    return;
  }
  if (node.status !== 'done') {
    res.status(409).json({ error: 'Repair can only be rerun after the text node has completed.' });
    return;
  }

  const input = recordValue(node.input);
  const output = recordValue(node.output);
  const originalPrompt = typeof input?.prompt === 'string' ? input.prompt : undefined;
  const conversations = Array.isArray(output?.conversations)
    ? output.conversations.filter((item): item is PracticeConversation => {
      const record = recordValue(item);
      return Boolean(record && Array.isArray(record.vocabularyUsed) && Array.isArray(record.text));
    })
    : [];
  if (!originalPrompt || !output || conversations.length === 0) {
    res.status(409).json({ error: 'This workflow node does not have enough saved prompt and conversation data to rerun repair.' });
    return;
  }

  const targetIds = new Set(conversations.map((conversation) => conversation.id));
  if (run.conversations.some((conversation) => targetIds.has(conversation.id) && conversation.curatedId)) {
    res.status(409).json({ error: 'Remove repaired conversations from the curated library before changing their generated text.' });
    return;
  }

  const allowedVocabulary = await getAllowedVocabulary(run.setNumber);
  const knownVocabulary = await readVocabulary();
  const evaluated = await evaluateVocabularyQuality(run.setNumber, allowedVocabulary, knownVocabulary, conversations);
  if (evaluated.quality.passed) {
    res.status(409).json({ error: 'This node has no repairable vocabulary findings.' });
    return;
  }

  const existingExchanges = nodeOutputExchanges(node);
  const repairPrompt = buildRepairPrompt(originalPrompt, allowedVocabulary, evaluated.conversations, evaluated.quality);
  const repairExchange = makeLlmExchange(run.textModel, repairPrompt);

  async function persistNodeOutput(nodeOutput: Record<string, unknown>, response: Omit<WorkflowRepairResponse, 'run' | 'evidenceByConversationId'>): Promise<void> {
    const updated = await mutateRun(run.id, (current) => {
      const workflowAudit = workflowAuditWithUpdatedTextNode(current, nodeId, nodeOutput);
      if (!workflowAudit) return current;
      const updatedRun = {
        ...current,
        workflowAudit,
        llmExchanges: workflowLlmExchanges(workflowAudit.nodes),
        updatedAt: nowIso()
      };
      return updatedRun;
    });
    res.json({
      ...response,
      run: updated,
      evidenceByConversationId: await getConversationCurationEvidence(updated.setNumber, updated.conversations)
    } satisfies WorkflowRepairResponse);
  }

  let repair: Awaited<ReturnType<ConversationJsonGenerator>>;
  try {
    repair = await conversationJsonGenerator(repairPrompt, run.textModel);
  } catch (error) {
    const failure = errorAuditDetails(error);
    const failedExchange: LlmExchange = {
      ...repairExchange,
      output: failure.output,
      stats: {
        ...failure.stats,
        repairAttempt: 1,
        vocabularyQualityBeforeRepair: evaluated.quality,
        repairOutcome: 'provider_failed',
        selectedForFinal: false
      },
      receivedAt: nowIso(),
      status: 'failed',
      error: failure.message
    };
    await persistNodeOutput({
      ...output,
      exchange: output.exchange,
      exchanges: replaceRepairExchange(existingExchanges, failedExchange),
      vocabularyQuality: evaluated.quality
    }, {
      repairApplied: false,
      repairOutcome: 'provider_failed',
      exchange: failedExchange
    });
    return;
  }

  const repairedConversations = preserveConversationIdentity(
    normalizeGeneratedConversations(repair.parsed, conversations.length),
    conversations
  );
  const repaired = await evaluateVocabularyQuality(run.setNumber, allowedVocabulary, knownVocabulary, repairedConversations);
  const improved = repaired.conversations.length > 0 && qualityIssueScore(repaired.quality) < qualityIssueScore(evaluated.quality);
  const completedExchange: LlmExchange = annotateResolvedModel({
    ...repairExchange,
    output: repair.output,
    stats: {
      ...objectStats(repair.stats),
      repairAttempt: 1,
      vocabularyQualityBeforeRepair: evaluated.quality,
      vocabularyQuality: repaired.quality,
      repairOutcome: improved ? 'improved' : 'not_improved',
      selectedForFinal: improved
    },
    receivedAt: nowIso(),
    status: 'complete'
  });
  const exchanges = improved
    ? replaceRepairExchange([
      ...existingExchanges.map((exchange) => ({
        ...exchange,
        stats: {
          ...objectStats(exchange.stats),
          selectedForFinal: false
        }
      }))
    ], completedExchange)
    : replaceRepairExchange(existingExchanges, completedExchange);

  if (!improved) {
    await persistNodeOutput({
      ...output,
      exchange: output.exchange,
      exchanges,
      vocabularyQuality: evaluated.quality
    }, {
      repairApplied: false,
      repairOutcome: 'not_improved',
      exchange: completedExchange
    });
    return;
  }

  const updated = await mutateRun(run.id, async (current) => {
    await Promise.all(current.conversations.map((conversation) => targetIds.has(conversation.id) && conversation.audioFileName
      ? deleteAudioFile(current.id, conversation.audioFileName)
      : Promise.resolve()));
    const updatedConversations = replaceConversationsById(current, repaired.conversations);
    const nodeAnalyticsConversations = node.kind === 'balancer' ? updatedConversations : repaired.conversations;
    const nodeOutput = {
      ...output,
      exchange: completedExchange,
      exchanges,
      conversations: repaired.conversations,
      vocabularyQuality: repaired.quality,
      analytics: calculateRunAnalytics(current.setNumber, allowedVocabulary, nodeAnalyticsConversations),
      distributionStats: calculateWorkflowDistributionStats(current.setNumber, allowedVocabulary, nodeAnalyticsConversations)
    };
    const workflowAudit = workflowAuditWithUpdatedTextNode(current, nodeId, nodeOutput, targetIds);
    if (!workflowAudit) return current;
    const updatedRun = {
      ...current,
      conversations: updatedConversations,
      analytics: calculateRunAnalytics(current.setNumber, allowedVocabulary, updatedConversations),
      workflowAudit,
      llmExchanges: workflowLlmExchanges(workflowAudit.nodes),
      updatedAt: nowIso()
    };
    updatedRun.status = runStatusFor(updatedRun.conversations);
    return updatedRun;
  });
  res.json({
    run: updated,
    repairApplied: true,
    repairOutcome: 'improved',
    exchange: completedExchange,
    evidenceByConversationId: await getConversationCurationEvidence(updated.setNumber, updated.conversations)
  } satisfies WorkflowRepairResponse);
}));

app.get('/api/library', asyncHandler(async (_req, res) => {
  const setSummaries = await getSetSummaries();
  res.json({ sets: await Promise.all(setSummaries.map((set) => readCuratedSet(set.set))) });
}));

app.get('/api/library/sets', asyncHandler(async (_req, res) => {
  const sets = await listCuratedSets();
  res.json({
    sets: sets.map((set) => ({
      setNumber: set.setNumber,
      conversationCount: set.conversations.length,
      updatedAt: set.updatedAt
    }))
  });
}));

app.get('/api/library/publish/status', asyncHandler(async (_req, res) => {
  res.json({ status: await getPracticeLibraryPublishStatus() });
}));

app.post('/api/library/publish', asyncHandler(async (_req, res) => {
  const result = await publishPracticeLibrary();
  res.json({
    status: {
      stale: result.stale,
      curatedGeneratedAt: result.curatedGeneratedAt,
      publishedGeneratedAt: result.publishedGeneratedAt,
      curatedConversationCount: result.curatedConversationCount,
      publishedConversationCount: result.publishedConversationCount
    }
  });
}));

app.get('/api/library/sets/:setNumber', asyncHandler(async (req, res) => {
  const setNumber = Number(routeParam(req.params.setNumber));
  if (!Number.isInteger(setNumber) || setNumber < 1) {
    res.status(400).json({ error: 'Set number must be a positive integer.' });
    return;
  }
  const set = await readCuratedSet(setNumber);
  res.json({
    set,
    evidenceByConversationId: await getConversationCurationEvidence(setNumber, set.conversations)
  });
}));

app.post('/api/library/sets/:setNumber/reanalyze', asyncHandler(async (req, res) => {
  const setNumber = Number(routeParam(req.params.setNumber));
  if (!Number.isInteger(setNumber) || setNumber < 1) {
    res.status(400).json({ error: 'Set number must be a positive integer.' });
    return;
  }
  const set = await reanalyzeCuratedSet(setNumber);
  res.json({
    set,
    evidenceByConversationId: await getConversationCurationEvidence(setNumber, set.conversations)
  });
}));

app.get('/api/library/sets/:setNumber/recommendations', asyncHandler(async (req, res) => {
  const validated = validateSetNumber(routeParam(req.params.setNumber));
  if ('error' in validated) {
    res.status(validated.status).json({ error: validated.error });
    return;
  }
  res.json({ recommendations: await recommendLibraryConversations(validated.setNumber) });
}));

app.get('/api/library/sets/:setNumber/ai-curation', asyncHandler(async (req, res) => {
  const validated = validateSetNumber(routeParam(req.params.setNumber));
  if ('error' in validated) {
    res.status(validated.status).json({ error: validated.error });
    return;
  }
  res.json({ review: await getLatestAiCurationReview(validated.setNumber) });
}));

app.post('/api/library/sets/:setNumber/ai-curation', asyncHandler(async (req: express.Request<{ setNumber: string }, unknown, AiCurationRequest>, res) => {
  const validated = validateSetNumber(routeParam(req.params.setNumber));
  if ('error' in validated) {
    res.status(validated.status).json({ error: validated.error });
    return;
  }
  const textModel = await resolveTextModel(req.body?.textModelId);
  try {
    res.json({ review: await createAiCurationReview(validated.setNumber, textModel, {
      targetConversationCount: req.body?.targetConversationCount ?? Number.NaN
    }) });
  } catch (error) {
    if (error instanceof AiCurationInputError) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error instanceof AiCurationExecutionError) {
      res.status(502).json({ error: 'AI curation failed.', detail: error.message, review: error.review });
      return;
    }
    throw error;
  }
}));

app.get('/api/library/sets/:setNumber/ai-curation/history', asyncHandler(async (req, res) => {
  const validated = validateSetNumber(routeParam(req.params.setNumber));
  if ('error' in validated) {
    res.status(validated.status).json({ error: validated.error });
    return;
  }
  res.json(await getAiCurationReviewHistory(validated.setNumber));
}));

app.get('/api/library/sets/:setNumber/ai-curation/:reviewId', asyncHandler(async (req, res) => {
  const validated = validateSetNumber(routeParam(req.params.setNumber));
  if ('error' in validated) {
    res.status(validated.status).json({ error: validated.error });
    return;
  }
  res.json({ review: await getAiCurationReview(validated.setNumber, routeParam(req.params.reviewId)) });
}));

app.post('/api/library/sets/:setNumber/ai-curation/:reviewId/retry', asyncHandler(async (req: express.Request<{ setNumber: string; reviewId: string }, unknown, AiCurationRequest>, res) => {
  const validated = validateSetNumber(routeParam(req.params.setNumber));
  if ('error' in validated) {
    res.status(validated.status).json({ error: validated.error });
    return;
  }
  const previous = await getAiCurationReview(validated.setNumber, routeParam(req.params.reviewId));
  const textModel = await resolveTextModel(req.body?.textModelId ?? previous.textModel.id);
  try {
    res.json({ review: await createAiCurationReview(validated.setNumber, textModel, {
      targetConversationCount: req.body?.targetConversationCount ?? previous.targetConversationCount
    }) });
  } catch (error) {
    if (error instanceof AiCurationInputError) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error instanceof AiCurationExecutionError) {
      res.status(502).json({ error: 'AI curation retry failed.', detail: error.message, review: error.review });
      return;
    }
    throw error;
  }
}));

app.get('/api/library/sets/:setNumber/balance', asyncHandler(async (req, res) => {
  const validated = validateSetNumber(routeParam(req.params.setNumber));
  if ('error' in validated) {
    res.status(validated.status).json({ error: validated.error });
    return;
  }
  res.json({ balance: await buildLibraryBalancePlan(validated.setNumber) });
}));

app.post('/api/library/sets/:setNumber/complement/preview', asyncHandler(async (req: express.Request<{ setNumber: string }, unknown, LibraryComplementGenerateRequest>, res) => {
  const context = await getLibraryComplementContext(routeParam(req.params.setNumber), req.body);
  if ('error' in context) {
    res.status(context.status).json({ error: context.error });
    return;
  }

  res.json({ balance: context.balance, exchange: makeLlmExchange(context.textModel, context.prompt) });
}));

app.post('/api/generate/preview', asyncHandler(async (req: express.Request<unknown, unknown, GenerateRequest>, res) => {
  const context = await getGenerateContext(req.body);
  if ('error' in context) {
    res.status(context.status).json({ error: context.error });
    return;
  }

  res.json({ exchange: makeLlmExchange(context.textModel, context.prompt) });
}));

app.post('/api/generate/start', asyncHandler(async (req: express.Request<unknown, unknown, GenerateRequest>, res) => {
  const context = await getGenerateContext(req.body);
  if ('error' in context) {
    res.status(context.status).json({ error: context.error });
    return;
  }
  const idempotencyKey = req.body.idempotencyKey ?? makeStudioJobId('generate-request');
  const existing = await findStudioJobByIdempotencyKey(idempotencyKey);
  if (existing) {
    res.status(202).json({ job: existing, attached: true });
    return;
  }
  const timestamp = nowIso();
  const candidateJobId = makeStudioJobId('generate');
  const job = await createStudioJob({
    id: candidateJobId,
    idempotencyKey,
    kind: 'run-generation',
    status: 'queued',
    title: `Set ${context.setNumber} generation`,
    detail: `${context.conversationCount} conversations`,
    stageLabel: 'Queued for generation',
    setNumber: context.setNumber,
    runId: makeRunId(context.setNumber),
    revision: 1,
    progress: { completed: 0, total: 1, queued: 1 },
    stages: [{ id: 'generator', label: 'Generating initial set', status: 'pending' }],
    request: req.body,
    createdAt: timestamp,
    updatedAt: timestamp
  });
  if (job.id === candidateJobId) void runQueuedGenerationJob(job.id, () => runStandardGenerationJob(job.id));
  res.status(202).json({ job, attached: job.id !== candidateJobId });
}));

app.post('/api/workflow/preview', asyncHandler(async (req: express.Request<unknown, unknown, WorkflowGenerateRequest>, res) => {
  const context = await getWorkflowGenerateContext(req.body);
  if ('error' in context) {
    res.status(context.status).json({ error: context.error });
    return;
  }

  res.json({
    exchange: makeLlmExchange(context.textModel, context.prompt),
    primaryConversationCount: context.conversationCount,
    balanceConversationCount: context.balanceConversationCount,
    requestedTotalConversationCount: context.conversationCount + context.balanceConversationCount,
    audioRequestedCount: context.audioCount
  });
}));

app.post('/api/workflow/start', asyncHandler(async (req: express.Request<unknown, unknown, WorkflowGenerateRequest>, res) => {
  const context = await getWorkflowGenerateContext(req.body);
  if ('error' in context) {
    res.status(context.status).json({ error: context.error });
    return;
  }

  const timestamp = nowIso();
  const idempotencyKey = req.body.idempotencyKey ?? makeWorkflowJobId(context.setNumber);
  const existing = await findStudioJobByIdempotencyKey(idempotencyKey);
  if (existing?.workflow) {
    res.status(202).json({ job: existing.workflow });
    return;
  }
  const jobId = makeWorkflowJobId(context.setNumber);
  const runId = makeRunId(context.setNumber);
  const job: WorkflowJob = {
    id: jobId,
    runId,
    status: 'running',
    setNumber: context.setNumber,
    primaryConversationCount: context.conversationCount,
    balanceConversationCount: context.balanceConversationCount,
    requestedTotalConversationCount: context.conversationCount + context.balanceConversationCount,
    audioRequestedCount: context.audioCount,
    audioGeneratedCount: 0,
    audioErrors: [],
    nodes: makeWorkflowNodes(context.audioCount),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const studioJob = await createStudioJob({
    id: jobId,
    idempotencyKey,
    kind: 'workflow-generation',
    status: 'queued',
    title: `Set ${context.setNumber} generation`,
    detail: `${context.conversationCount + context.balanceConversationCount} conversations`,
    stageLabel: isGenerationSlotBusy() ? 'Waiting for earlier generation' : 'Starting generation',
    setNumber: context.setNumber,
    runId,
    revision: 1,
    progress: { completed: 0, total: context.audioCount, queued: context.audioCount },
    stages: [
      { id: 'generator', label: 'Generating initial set', status: 'pending' },
      { id: 'balancer', label: 'Balancing set', status: 'pending' },
      { id: 'final-audit', label: 'Reviewing final text audit', status: 'pending' },
      { id: 'audio', label: 'Generating audio', status: 'pending' }
    ],
    request: req.body,
    workflow: job,
    createdAt: timestamp,
    updatedAt: timestamp
  });
  if (studioJob.id !== jobId) {
    res.status(202).json({ job: studioJob.workflow, attached: true });
    return;
  }
  workflowJobs.set(job.id, job);
  void runQueuedGenerationJob(job.id, () => runWorkflowJob(job.id, req.body));
  res.status(202).json({ job });
}));

app.get('/api/workflow/jobs/:jobId', asyncHandler(async (req, res) => {
  const job = workflowJobs.get(routeParam(req.params.jobId));
  if (!job) {
    res.status(404).json({ error: 'Workflow job not found.' });
    return;
  }
  res.json({ job });
}));

app.post('/api/generate', asyncHandler(async (req: express.Request<unknown, unknown, GenerateRequest>, res) => {
  const context = await getGenerateContext(req.body);
  if ('error' in context) {
    res.status(context.status).json({ error: context.error });
    return;
  }

  const generated = await generateTextBatch(
    context.textModel,
    context.prompt,
    context.allowedVocabulary,
    context.knownVocabulary,
    context.setNumber,
    context.conversationCount,
    { stage: 'initial', libraryContext: context.qualityLibraryContext }
  );

  if (!generated.conversations.length) {
    res.status(502).json({ error: 'The generation response did not include any usable conversations.' });
    return;
  }

  const timestamp = new Date().toISOString();
  const finalTextAudit = buildFinalTextAudit({
    requestedCount: context.conversationCount,
    initial: generated.stageAudit,
    conversations: generated.conversations,
    currentSetVocabulary: context.allowedVocabulary.filter((item) => item.set === context.setNumber)
  });
  const run = await saveRun({
    id: makeRunId(context.setNumber),
    setNumber: context.setNumber,
    conversationCount: context.conversationCount,
    allowedVocabCount: context.allowedVocabulary.length,
    textModel: stampResolvedTextModel(context.textModel, generated.exchanges),
    analytics: calculateRunAnalytics(context.setNumber, context.allowedVocabulary, generated.conversations),
    status: 'generated',
    llmExchanges: generated.exchanges,
    finalTextAudit,
    createdAt: timestamp,
    updatedAt: timestamp,
    conversations: generated.conversations
  });

  res.json({ run });
}));

app.post('/api/workflow', asyncHandler(async (req: express.Request<unknown, unknown, WorkflowGenerateRequest>, res) => {
  const context = await getWorkflowGenerateContext(req.body);
  if ('error' in context) {
    res.status(context.status).json({ error: context.error });
    return;
  }

  const primary = await generateTextBatch(
    context.textModel,
    context.prompt,
    context.allowedVocabulary,
    context.knownVocabulary,
    context.setNumber,
    context.conversationCount,
    { stage: 'initial', libraryContext: context.qualityLibraryContext }
  );

  if (!primary.conversations.length) {
    res.status(502).json({ error: 'The generation response did not include any usable conversations.' });
    return;
  }

  const balance = buildGeneratedRunBalancePlan(
    context.setNumber,
    context.allowedVocabulary,
    primary.conversations,
    context.balanceConversationCount
  );
  const complementPrompt = buildLibraryComplementPrompt(
    context.setNumber,
    context.allowedVocabulary,
    balance,
    'fresh generated batch'
  );
  const complement = await generateTextBatch(
    context.textModel,
    complementPrompt,
    context.allowedVocabulary,
    context.knownVocabulary,
    context.setNumber,
    context.balanceConversationCount,
    { stage: 'balance', startNumber: primary.conversations.length + 1, libraryContext: context.qualityLibraryContext }
  );
  const complementConversations = renumberConversations(complement.conversations, primary.conversations.length + 1);
  const conversations = [...primary.conversations, ...complementConversations];

  if (conversations.length <= primary.conversations.length) {
    res.status(502).json({ error: 'The balancing response did not include any usable conversations.' });
    return;
  }

  const timestamp = new Date().toISOString();
  const finalTextAudit = buildFinalTextAudit({
    requestedCount: context.conversationCount + context.balanceConversationCount,
    initial: primary.stageAudit,
    balance: complement.stageAudit,
    conversations,
    currentSetVocabulary: context.allowedVocabulary.filter((item) => item.set === context.setNumber),
    distributionStats: calculateWorkflowDistributionStats(context.setNumber, context.allowedVocabulary, conversations)
  });
  let run = await saveRun({
    id: makeRunId(context.setNumber),
    setNumber: context.setNumber,
    conversationCount: context.conversationCount + context.balanceConversationCount,
    allowedVocabCount: context.allowedVocabulary.length,
    textModel: stampResolvedTextModel(context.textModel, [...primary.exchanges, ...complement.exchanges]),
    analytics: calculateRunAnalytics(context.setNumber, context.allowedVocabulary, conversations),
    status: 'generated',
    finalTextAudit,
    llmExchanges: [
      ...primary.exchanges,
      ...complement.exchanges.map((exchange) => ({
        ...exchange,
        stats: {
          ...objectStats(exchange.stats),
          generatedBatchBalance: balance
        }
      }))
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
    conversations
  });

  const audio = await generateWorkflowAudio(run, Math.min(context.audioCount, conversations.length), {
    stopOnFirstError: context.audioMode === 'max',
    concurrency: context.audioMode === 'max' ? 3 : undefined
  });
  run = audio.run;

  res.json({
    run,
    primaryConversationCount: context.conversationCount,
    balanceConversationCount: context.balanceConversationCount,
    requestedTotalConversationCount: context.conversationCount + context.balanceConversationCount,
    audioRequestedCount: context.audioCount,
    audioGeneratedCount: audio.audioGeneratedCount,
    audioErrors: audio.audioErrors
  });
}));

app.post('/api/library/sets/:setNumber/complement/start', asyncHandler(async (req: express.Request<{ setNumber: string }, unknown, LibraryComplementGenerateRequest>, res) => {
  const context = await getLibraryComplementContext(routeParam(req.params.setNumber), req.body);
  if ('error' in context) {
    res.status(context.status).json({ error: context.error });
    return;
  }
  const idempotencyKey = req.body.idempotencyKey ?? makeStudioJobId('complement-request');
  const existing = await findStudioJobByIdempotencyKey(idempotencyKey);
  if (existing) {
    res.status(202).json({ job: existing, attached: true });
    return;
  }
  const timestamp = nowIso();
  const candidateJobId = makeStudioJobId('complement');
  const job = await createStudioJob({
    id: candidateJobId,
    idempotencyKey,
    kind: 'library-complement',
    status: 'queued',
    title: `Set ${context.setNumber} balanced generation`,
    detail: `${context.conversationCount} conversations`,
    stageLabel: 'Queued for balance generation',
    setNumber: context.setNumber,
    runId: makeRunId(context.setNumber),
    revision: 1,
    progress: { completed: 0, total: 1, queued: 1 },
    stages: [{ id: 'generator', label: 'Generating balanced set', status: 'pending' }],
    request: { ...req.body, setNumber: context.setNumber },
    createdAt: timestamp,
    updatedAt: timestamp
  });
  if (job.id === candidateJobId) void runQueuedGenerationJob(job.id, () => runLibraryComplementJob(job.id));
  res.status(202).json({ job, balance: context.balance, attached: job.id !== candidateJobId });
}));

app.post('/api/library/sets/:setNumber/complement', asyncHandler(async (req: express.Request<{ setNumber: string }, unknown, LibraryComplementGenerateRequest>, res) => {
  const context = await getLibraryComplementContext(routeParam(req.params.setNumber), req.body);
  if ('error' in context) {
    res.status(context.status).json({ error: context.error });
    return;
  }

  const generated = await generateTextBatch(
    context.textModel,
    context.prompt,
    context.allowedVocabulary,
    context.knownVocabulary,
    context.setNumber,
    context.conversationCount,
    { stage: 'balance', libraryContext: context.librarySnapshotContext }
  );

  if (!generated.conversations.length) {
    res.status(502).json({ error: 'The generation response did not include any usable conversations.' });
    return;
  }

  const timestamp = new Date().toISOString();
  const exchanges = generated.exchanges.map((exchange) => ({
    ...exchange,
    stats: {
      ...(exchange.stats && typeof exchange.stats === 'object' ? exchange.stats : { rawStats: exchange.stats }),
      libraryBalance: context.balance,
      libraryBalanceMode: context.balanceMode,
      ...(context.balanceMode === 'ai' && context.librarySnapshotContext
        ? {
            libraryBalanceContext: {
              mode: 'ai',
              libraryConversationCount: context.librarySnapshotContext.conversationCount,
              wordExposure: context.librarySnapshotContext.wordExposure
            }
          }
        : {})
    }
  }));
  const run = await saveRun({
    id: makeRunId(context.setNumber),
    setNumber: context.setNumber,
    conversationCount: context.conversationCount,
    allowedVocabCount: context.allowedVocabulary.length,
    textModel: stampResolvedTextModel(context.textModel, exchanges),
    analytics: calculateRunAnalytics(context.setNumber, context.allowedVocabulary, generated.conversations),
    status: 'generated',
    llmExchanges: exchanges,
    finalTextAudit: buildFinalTextAudit({
      requestedCount: context.conversationCount,
      initial: generated.stageAudit,
      conversations: generated.conversations,
      currentSetVocabulary: context.allowedVocabulary.filter((item) => item.set === context.setNumber)
    }),
    createdAt: timestamp,
    updatedAt: timestamp,
    conversations: generated.conversations
  });

  res.json({ run, balance: context.balance });
}));

app.put('/api/runs/:runId/conversations/:conversationId', asyncHandler(async (req, res) => {
  const { title, scene, sampleContext, transcript } = req.body as Record<string, string>;
  const runId = routeParam(req.params.runId);
  const conversationId = routeParam(req.params.conversationId);
  await assertConversationHasNoActiveAudio(runId, conversationId);
  const updated = await updateConversation(runId, conversationId, (conversation) => {
    if (conversation.curatedId) {
      throw new Error('This conversation is in Library and is read-only.');
    }
    const next: PracticeConversation = {
      ...conversation,
      title: typeof title === 'string' ? title.trim() : conversation.title,
      scene: typeof scene === 'string' ? scene.trim() : conversation.scene,
      sampleContext: typeof sampleContext === 'string' ? sampleContext.trim() : conversation.sampleContext,
      text: typeof transcript === 'string' ? parseTranscriptText(transcript) : conversation.text,
      audioFileName: undefined,
      audioUrl: undefined,
      status: 'draft',
      error: undefined
    };
    return touchConversation(next);
  });
  res.json({ run: updated });
}));

app.post('/api/runs/:runId/conversations/:conversationId/audio', asyncHandler(async (req, res) => {
  const runId = routeParam(req.params.runId);
  const conversationId = routeParam(req.params.conversationId);
  const idempotencyKey = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey : undefined;
  const result = await enqueueConversationAudio({ runId, conversationId, idempotencyKey });
  res.status(202).json({ ...result, run: await readRun(runId) });
}));

app.delete('/api/runs/:runId/conversations/:conversationId/audio', asyncHandler(async (req, res) => {
  const runId = routeParam(req.params.runId);
  const conversationId = routeParam(req.params.conversationId);
  const run = await readRun(runId);
  const conversation = run.conversations.find((item) => item.id === conversationId);
  if (!conversation) throw new Error('Conversation not found.');
  if (conversation.curatedId) {
    throw new Error('This conversation is in Library and is read-only.');
  }
  if (conversation.status === 'audio_generating' || await hasActiveConversationAudio(runId, conversationId)) {
    throw new Error('Wait for audio generation to finish before deleting audio.');
  }

  if (conversation.audioFileName) {
    await deleteAudioFile(runId, conversation.audioFileName);
  }

  let updated = await updateConversation(runId, conversationId, (current) => {
    return touchConversation({
      ...current,
      status: 'draft',
      audioFileName: undefined,
      audioUrl: undefined,
      error: undefined
    });
  });
  const workflowAudit = workflowAuditWithConversationAudioCleared(updated, conversationId);
  if (workflowAudit) {
    updated = await saveRun({ ...updated, workflowAudit, updatedAt: nowIso() });
  }
  res.json({ run: updated });
}));

app.post('/api/runs/:runId/audio', asyncHandler(async (req, res) => {
  {
    const requestedRunId = routeParam(req.params.runId);
    const requestedMode = (req.body as RunAudioGenerateRequest & { idempotencyKey?: string } | undefined)?.mode === 'resume' ? 'resume' : 'replace';
    const sourceRun = await readRun(requestedRunId);
    const targets = requestedMode === 'resume'
      ? sourceRun.conversations.filter((conversation) => !conversation.audioFileName)
      : sourceRun.conversations;
    if (requestedMode === 'replace' && targets.some((conversation) => conversation.curatedId)) {
      throw new Error('Remove Library conversations before regenerating all audio for this run.');
    }
    if (targets.some((conversation) => conversation.curatedId)) {
      throw new Error('Remove Library conversations that are missing audio before generating missing audio.');
    }
    const requestBody = req.body as RunAudioGenerateRequest & { idempotencyKey?: string } | undefined;
    const job = await createAudioBatch({
      runId: requestedRunId,
      conversationIds: targets.map((conversation) => conversation.id),
      idempotencyKey: requestBody?.idempotencyKey ?? `audio-batch:${requestedRunId}:${requestedMode}:${nowIso()}`,
      stopOnFailure: true
    });
    res.status(202).json({ job, run: sourceRun });
    return;
  }
  /* Legacy synchronous whole-run audio implementation retained for migration reference.
  const runId = routeParam(req.params.runId);
  const mode = (req.body as RunAudioGenerateRequest | undefined)?.mode === 'resume' ? 'resume' : 'replace';
  let run = await readRun(runId);
  if (run.conversations.some((conversation) => conversation.status === 'audio_generating')) {
    throw new Error('Wait for current audio generation to finish.');
  }

  const targetIds = new Set((mode === 'resume'
    ? run.conversations.filter((conversation) => !conversation.audioFileName)
    : run.conversations).map((conversation) => conversation.id));
  const targetConversations = run.conversations.filter((conversation) => targetIds.has(conversation.id));
  const initialActiveTargetIds = new Set(targetConversations.slice(0, 3).map((conversation) => conversation.id));

  if (mode === 'replace' && run.conversations.some((conversation) => conversation.curatedId)) {
    throw new Error('Remove Library conversations before regenerating all audio for this run.');
  }
  if (targetConversations.some((conversation) => conversation.curatedId)) {
    throw new Error('Remove Library conversations that are missing audio before generating missing audio.');
  }

  await Promise.all(run.conversations.map((conversation) => targetIds.has(conversation.id) && conversation.audioFileName
    ? deleteAudioFile(runId, conversation.audioFileName)
    : Promise.resolve()));

  const timestamp = nowIso();
  const existingAudit = run.workflowAudit;
  const baseNodes = existingAudit?.nodes.filter((node) => node.kind !== 'audio') ?? makeWorkflowNodes(0);
  const audioNodes = run.conversations.map((conversation, index): WorkflowAuditNode => {
    const existingNode = existingAudit?.nodes.find((node) => node.id === `audio-${index + 1}`);
    return {
      id: `audio-${index + 1}`,
      kind: 'audio',
      title: `Conversation ${index + 1}`,
      status: targetIds.has(conversation.id) ? 'pending' : 'done',
      input: {
        conversationId: conversation.id,
        conversationTitle: conversation.title
      },
      output: targetIds.has(conversation.id) ? undefined : existingNode?.output ?? {
        fileName: conversation.audioFileName,
        audioUrl: conversation.audioUrl
      }
    };
  });

  run = await saveRun({
    ...run,
    status: 'generated',
    workflowAudit: existingAudit ? {
      ...existingAudit,
      audioRequestedCount: run.conversations.length,
      audioGeneratedCount: run.conversations.length - targetIds.size,
      audioErrors: [],
      nodes: [...baseNodes, ...audioNodes],
      updatedAt: timestamp
    } : undefined,
    conversations: run.conversations.map((conversation) => targetIds.has(conversation.id)
      ? touchConversation({
        ...conversation,
        status: initialActiveTargetIds.has(conversation.id) ? 'audio_generating' : 'draft',
        audioFileName: undefined,
        audioUrl: undefined,
        error: undefined
      })
      : conversation),
    updatedAt: timestamp
  });

  const audioResults: Array<PromiseSettledResult<{ conversationId: string; audio: { fileName: string; filePath: string }; durationSeconds?: number }> | undefined> = [];
  let nextAudioIndex = 0;
  let stopStartingAudio = false;
  let auditSaveQueue: Promise<void> = Promise.resolve();

  async function saveAuditNode(nodeId: string, patch: Partial<Omit<WorkflowAuditNode, 'id' | 'kind' | 'title'>>): Promise<void> {
    const save = auditSaveQueue.then(async () => {
      const workflowAudit = workflowAuditWithNode(run, nodeId, patch);
      if (!workflowAudit) return;
      run = await saveRun({ ...run, workflowAudit, updatedAt: nowIso() });
    });
    auditSaveQueue = save.catch(() => undefined);
    await save;
  }

  async function regenerateAudioTarget(conversation: PracticeConversation, index: number) {
    const nodeId = `audio-${index + 1}`;
    const prompt = buildTtsPrompt(conversation);
    await saveAuditNode(nodeId, {
      status: 'processing',
      startedAt: nowIso(),
      error: undefined,
      input: {
        conversationId: conversation.id,
        conversationTitle: conversation.title,
        model: process.env.GEMINI_TTS_MODEL ?? 'GEMINI_TTS_MODEL not configured',
        voiceConfig: {
          speaker1: process.env.GEMINI_TTS_SPEAKER_1 || 'Zephyr',
          speaker2: process.env.GEMINI_TTS_SPEAKER_2 || 'Puck'
        },
        prompt
      }
    });

    const audio = await generateConversationAudio(run.id, conversation);
    const durationSeconds = await readWavDurationSeconds(audio.filePath);
    await saveAuditNode(nodeId, {
      status: 'done',
      completedAt: nowIso(),
      output: {
        fileName: audio.fileName,
        audioUrl: `/audio/${encodeURIComponent(run.id)}/audio/${encodeURIComponent(audio.fileName)}`,
        filePath: audio.filePath,
        durationSeconds
      }
    });
    return { conversationId: conversation.id, audio, durationSeconds };
  }

  async function audioWorker(): Promise<void> {
    while (!stopStartingAudio) {
      const currentIndex = nextAudioIndex;
      nextAudioIndex += 1;
      const conversation = run.conversations.filter((item) => targetIds.has(item.id))[currentIndex];
      if (!conversation) return;
      const conversationIndex = run.conversations.findIndex((item) => item.id === conversation.id);

      try {
        audioResults[conversationIndex] = {
          status: 'fulfilled',
          value: await regenerateAudioTarget(conversation, conversationIndex)
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        audioResults[conversationIndex] = {
          status: 'rejected',
          reason: { conversationId: conversation.id, error: message }
        };
        await saveAuditNode(`audio-${conversationIndex + 1}`, {
          status: 'error',
          completedAt: nowIso(),
          error: message
        });
        stopStartingAudio = true;
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(3, targetIds.size) }, () => audioWorker()));

  for (let index = 0; index < run.conversations.length; index += 1) {
    if (targetIds.has(run.conversations[index].id) && !audioResults[index]) {
      await saveAuditNode(`audio-${index + 1}`, {
        status: 'skipped',
        completedAt: nowIso(),
        error: 'Audio generation skipped after an earlier failure.'
      });
    }
  }

  let audioGeneratedCount = 0;
  const audioErrors: Array<{ conversationId: string; error: string }> = [];
  run = {
    ...run,
    conversations: run.conversations.map((conversation, index) => {
      if (!targetIds.has(conversation.id)) return conversation;
      const result = audioResults[index];
      if (!result) {
        return touchConversation({
          ...conversation,
          status: 'draft',
          error: undefined
        });
      }
      if (result.status === 'fulfilled') {
        audioGeneratedCount += 1;
        return touchConversation({
          ...conversation,
          status: 'audio_ready',
          audioFileName: result.value.audio.fileName,
          audioUrl: `/audio/${encodeURIComponent(run.id)}/audio/${encodeURIComponent(result.value.audio.fileName)}`,
          error: undefined
        });
      }

      const reason = result.reason as { conversationId?: string; error?: string };
      const message = reason.error ?? 'Audio generation failed.';
      audioErrors.push({ conversationId: conversation.id, error: message });
      return touchConversation({
        ...conversation,
        status: 'audio_failed',
        error: message
      });
    }),
    updatedAt: nowIso()
  };
  run.status = runStatusFor(run.conversations);
  const totalAudioReadyCount = run.conversations.filter((conversation) => conversation.audioFileName).length;
  if (run.workflowAudit) {
    run.workflowAudit = {
      ...run.workflowAudit,
      status: audioErrors.length ? 'failed' : 'complete',
      audioRequestedCount: run.conversations.length,
      audioGeneratedCount: totalAudioReadyCount,
      audioErrors,
      updatedAt: run.updatedAt
    };
  }
  run = await saveRun(run);
  if (audioErrors.length) {
    res.status(502).json({ error: 'One or more audio calls failed.', run });
    return;
  }
  res.json({ run });
  */
}));

app.post('/api/runs/:runId/conversations/:conversationId/library', asyncHandler(async (req, res) => {
  const runId = routeParam(req.params.runId);
  const conversationId = routeParam(req.params.conversationId);
  await assertConversationHasNoActiveAudio(runId, conversationId);
  let run = await readRun(runId);
  const conversation = run.conversations.find((item) => item.id === conversationId);
  if (!conversation) throw new Error('Conversation not found.');
  if (conversation.curatedId) {
    res.json({ run, curated: null });
    return;
  }

  const curated = await addConversationToLibrary(runId, run.setNumber, conversation);
  run = await updateConversation(runId, conversationId, (current) => {
    return touchConversation({
      ...current,
      curatedId: curated.id,
      curatedAt: curated.curatedAt
    });
  });
  res.json({ run, curated });
}));

app.delete('/api/library/:curatedId', asyncHandler(async (req, res) => {
  const removed = await removeConversationFromLibrary(routeParam(req.params.curatedId));
  const run = await unlockCuratedSource(removed.sourceRunId, removed.sourceConversationId, removed.id);
  res.json({ removed, run });
}));

await mkdir(OUTPUTS_DIR, { recursive: true });
await mkdir(RUNS_DIR, { recursive: true });
await mkdir(STUDIO_JOBS_DIR, { recursive: true });
await mkdir(CURATED_DIR, { recursive: true });
await mkdir(CURATED_SETS_DIR, { recursive: true });
await mkdir(CURATED_AUDIO_DIR, { recursive: true });
const interruptedStudioJobs = await interruptActiveStudioJobs();
for (const job of interruptedStudioJobs.filter((item) => item.kind === 'audio-child' && item.runId && item.conversationId)) {
  await mutateRun(job.runId!, (run) => ({
    ...run,
    conversations: run.conversations.map((conversation) => conversation.id === job.conversationId
      ? touchConversation({
          ...conversation,
          status: conversation.audioFileName ? 'audio_ready' : 'draft',
          error: conversation.audioFileName ? undefined : 'Audio generation was interrupted by an API restart.'
        })
      : conversation),
    updatedAt: nowIso()
  })).catch(() => undefined);
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  res.status(message.includes('not found') ? 404 : 500).json({ error: message });
});

// Listen only when run as the entry point; tests import `app` and bind an
// ephemeral port themselves.
const runAsEntryPoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (runAsEntryPoint) {
  app.listen(port, '127.0.0.1', () => {
    console.log(`Kiki JLPT API running at http://127.0.0.1:${port}`);
    console.log(`Audio files are stored below ${path.relative(process.cwd(), RUNS_DIR) || RUNS_DIR}`);
  });
}

export { app };
