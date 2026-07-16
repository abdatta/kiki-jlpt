import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ConversationQualityVerdict,
  PracticeConversation,
  PracticeRun,
  TextModelInfo
} from '../shared/types.ts';
import { atomicWriteFile } from '../server/atomic.ts';
import { OUTPUTS_DIR } from '../server/paths.ts';
import { FINAL_DIALOGUE_QUALITY_RUBRIC_VERSION as HISTORICAL_QUALITY_RUBRIC_VERSION } from '../server/prompt.ts';
import { labelHistoricalConversations } from '../server/qualityControl.ts';
import { listRuns, mutateRun } from '../server/storage.ts';
import { resolveTextModel } from '../server/textModels.ts';
import { getAllowedVocabulary, readVocabulary } from '../server/vocab.ts';

const DEFAULT_MODEL_ID = 'codex:gpt-5.6-sol';
// Ten conversations keeps progress visible and avoids very long Sol reasoning
// calls while remaining comfortably more efficient than one call per item.
const DEFAULT_BATCH_SIZE = 10;
const REPORT_DIR = path.join(OUTPUTS_DIR, 'quality-backfills');
const REPORT_PATH = path.join(REPORT_DIR, `set-2-plus-gpt-5.6-sol-${HISTORICAL_QUALITY_RUBRIC_VERSION}.json`);

type QualityLabel = NonNullable<PracticeConversation['quality']>;

interface BackfillResult {
  runId: string;
  setNumber: number;
  conversationId: string;
  priorLabel?: QualityLabel;
  label: QualityLabel;
  verdict: ConversationQualityVerdict['verdict'];
  rationale: string;
  flags: string[];
  judgedAt: string;
}

interface BackfillReport {
  version: 1;
  model: TextModelInfo;
  rubricVersion: string;
  createdAt: string;
  updatedAt: string;
  inventory: {
    runCount: number;
    conversationCount: number;
    excludedSetOneRuns: number;
    excludedSetOneConversations: number;
  };
  results: Record<string, BackfillResult>;
  appliedRuns: string[];
  failures: Array<{
    runId: string;
    conversationIds: string[];
    failedAt: string;
    message: string;
    retryAt?: string;
  }>;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, received ${value}.`);
  return parsed;
}

function argumentValue(name: string): string | undefined {
  const prefix = `${name}=`;
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function resultKey(runId: string, conversationId: string): string {
  return `${runId}/${conversationId}`;
}

function verdictLabel(verdict: ConversationQualityVerdict['verdict']): QualityLabel {
  return verdict === 'pass' ? 'good' : verdict === 'repair' ? 'okay' : 'bad';
}

function percent(value: number, total: number): string {
  return total ? `${((value / total) * 100).toFixed(1)}%` : '100.0%';
}

function qualityCounts(results: BackfillResult[]): string {
  const counts = { good: 0, okay: 0, bad: 0 };
  for (const result of results) counts[result.label] += 1;
  return `good ${counts.good} | okay ${counts.okay} | bad ${counts.bad}`;
}

function retryAtFromError(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const seconds = /"resets_at"\s*:\s*(\d+)/.exec(message)?.[1];
  if (!seconds) return undefined;
  return new Date(Number(seconds) * 1000).toISOString();
}

function withoutQualityMetadata(run: PracticeRun): unknown {
  return {
    ...run,
    conversations: run.conversations.map((conversation) => {
      const {
        quality: _quality,
        qualityDecision: _qualityDecision,
        qualityFlags: _qualityFlags,
        qualityReview: _qualityReview,
        ...preserved
      } = conversation;
      return preserved;
    })
  };
}

function preservedFingerprint(run: PracticeRun): string {
  return JSON.stringify(withoutQualityMetadata(run));
}

function applyResult(conversation: PracticeConversation, result: BackfillResult): PracticeConversation {
  const label = result.label;
  const verdict = label === 'good' ? 'pass' : label === 'okay' ? 'repair' : 'regenerate';
  if (!conversation.quality) {
    // Old runs receive the one field the Studio needs. Detailed provenance is
    // retained in the external backfill report instead of bloating every row.
    return { ...conversation, quality: label };
  }
  if (conversation.quality === label) return conversation;

  const updated: PracticeConversation = {
    ...conversation,
    quality: label,
    ...(conversation.qualityDecision ? { qualityDecision: verdict } : {}),
    ...(conversation.qualityFlags ? { qualityFlags: result.flags } : {})
  };
  if (conversation.qualityReview) {
    updated.qualityReview = {
      ...conversation.qualityReview,
      verdict,
      rationale: result.rationale,
      flags: result.flags,
      reviewedAt: result.judgedAt
    };
  }
  return updated;
}

async function readReport(): Promise<BackfillReport | null> {
  try {
    return JSON.parse(await readFile(REPORT_PATH, 'utf8')) as BackfillReport;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function saveReport(report: BackfillReport): Promise<void> {
  report.updatedAt = new Date().toISOString();
  await atomicWriteFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

async function main(): Promise<void> {
  process.env.CODEX_REQUEST_TIMEOUT_MS ??= String(4 * 60 * 1000);
  const dryRun = process.argv.includes('--dry-run');
  const reapply = process.argv.includes('--reapply');
  const batchSize = parsePositiveInteger(argumentValue('--batch-size'), DEFAULT_BATCH_SIZE);
  const modelId = argumentValue('--model') ?? DEFAULT_MODEL_ID;
  const judgeModel = await resolveTextModel(modelId);
  const allRuns = await listRuns();
  const eligibleRuns = allRuns
    .filter((run) => run.setNumber > 1)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const excludedRuns = allRuns.filter((run) => run.setNumber === 1);
  const total = eligibleRuns.reduce((sum, run) => sum + run.conversations.length, 0);
  const excludedConversations = excludedRuns.reduce((sum, run) => sum + run.conversations.length, 0);
  const existing = await readReport();
  if (existing && (existing.model.id !== judgeModel.id || existing.rubricVersion !== HISTORICAL_QUALITY_RUBRIC_VERSION)) {
    throw new Error(`Existing checkpoint uses ${existing.model.id}/${existing.rubricVersion}; remove ${REPORT_PATH} before changing judge or rubric.`);
  }
  const now = new Date().toISOString();
  const report: BackfillReport = existing ?? {
    version: 1,
    model: judgeModel,
    rubricVersion: HISTORICAL_QUALITY_RUBRIC_VERSION,
    createdAt: now,
    updatedAt: now,
    inventory: {
      runCount: eligibleRuns.length,
      conversationCount: total,
      excludedSetOneRuns: excludedRuns.length,
      excludedSetOneConversations: excludedConversations
    },
    results: {},
    appliedRuns: [],
    failures: []
  };
  report.failures ??= [];
  if (reapply) report.appliedRuns = [];

  console.log(`QUALITY BACKFILL | judge ${judgeModel.label} | rubric ${HISTORICAL_QUALITY_RUBRIC_VERSION}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN - judgments checkpointed, run labels unchanged' : 'APPLY - completed runs receive compact labels'}`);
  console.log(`Scope: ${eligibleRuns.length} Set 2+ runs / ${total} conversations; excluded ${excludedRuns.length} Set 1 runs / ${excludedConversations} conversations.`);
  console.log(`Checkpoint: ${REPORT_PATH}`);
  console.log(`Resuming with ${Object.keys(report.results).length}/${total} judgments and ${report.appliedRuns.length}/${eligibleRuns.length} runs applied.`);

  const knownVocabulary = await readVocabulary();
  let judged = Object.keys(report.results).length;
  for (let runIndex = 0; runIndex < eligibleRuns.length; runIndex += 1) {
    const run = eligibleRuns[runIndex];
    const unapplied = run.conversations.filter((conversation) => !report.results[resultKey(run.id, conversation.id)]);
    console.log(`\nRUN ${runIndex + 1}/${eligibleRuns.length} | ${run.id} | Set ${run.setNumber} | ${run.conversations.length} conversations | ${unapplied.length} awaiting judgment`);
    const allowedVocabulary = await getAllowedVocabulary(run.setNumber);

    for (let offset = 0; offset < unapplied.length; offset += batchSize) {
      const batch = unapplied.slice(offset, offset + batchSize);
      console.log(`  Calling judge for ${batch.length} conversations (${judged}/${total}, ${percent(judged, total)} complete)...`);
      let labeled: Awaited<ReturnType<typeof labelHistoricalConversations>>;
      try {
        labeled = await labelHistoricalConversations({
          setNumber: run.setNumber,
          conversations: batch,
          allowedVocabulary,
          knownVocabulary,
          judgeModel,
          rubricVersion: HISTORICAL_QUALITY_RUBRIC_VERSION
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const retryAt = retryAtFromError(error);
        report.failures.push({
          runId: run.id,
          conversationIds: batch.map((conversation) => conversation.id),
          failedAt: new Date().toISOString(),
          message,
          ...(retryAt ? { retryAt } : {})
        });
        await saveReport(report);
        if (retryAt) console.error(`  Provider limit resets at ${retryAt}.`);
        throw error;
      }
      const verdicts = new Map(labeled.verdicts.map((verdict) => [verdict.conversationId, verdict]));
      for (const conversation of batch) {
        const verdict = verdicts.get(conversation.id);
        if (!verdict) throw new Error(`Judge omitted ${conversation.id}.`);
        const label = verdictLabel(verdict.verdict);
        const result: BackfillResult = {
          runId: run.id,
          setNumber: run.setNumber,
          conversationId: conversation.id,
          ...(conversation.quality ? { priorLabel: conversation.quality } : {}),
          label,
          verdict: verdict.verdict,
          rationale: verdict.rationale,
          flags: verdict.flags,
          judgedAt: new Date().toISOString()
        };
        const key = resultKey(run.id, conversation.id);
        report.results[key] = result;
        judged += 1;
        const change = conversation.quality && conversation.quality !== label ? ` CHANGED ${conversation.quality}->${label}` : '';
        console.log(`    [${judged}/${total} ${percent(judged, total)}] ${conversation.id}: ${label}${change} - ${verdict.rationale}`);
      }
      await saveReport(report);
    }

    if (dryRun) {
      const results = run.conversations.map((conversation) => report.results[resultKey(run.id, conversation.id)]) as BackfillResult[];
      const changes = results.filter((result) => result.priorLabel && result.priorLabel !== result.label).length;
      console.log(`  DRY RUN ${run.id} | ${qualityCounts(results)} | current-label differences ${changes}`);
    } else if (!report.appliedRuns.includes(run.id)) {
      const beforeFingerprint = preservedFingerprint(run);
      const runResults = run.conversations.map((conversation) => report.results[resultKey(run.id, conversation.id)]);
      if (runResults.some((result) => !result)) throw new Error(`Cannot apply incomplete run ${run.id}.`);
      const updated = await mutateRun(run.id, (current) => ({
        ...current,
        conversations: current.conversations.map((conversation) => {
          const result = report.results[resultKey(run.id, conversation.id)];
          if (!result) throw new Error(`Missing result for ${conversation.id}.`);
          return applyResult(conversation, result);
        })
      }));
      if (preservedFingerprint(updated) !== beforeFingerprint) {
        throw new Error(`Non-quality run data changed while applying ${run.id}.`);
      }
      report.appliedRuns.push(run.id);
      await saveReport(report);
      const results = runResults as BackfillResult[];
      const changes = results.filter((result) => result.priorLabel && result.priorLabel !== result.label).length;
      console.log(`  APPLIED ${run.id} | ${qualityCounts(results)} | existing-label changes ${changes}`);
    } else {
      console.log(`  ALREADY APPLIED ${run.id}`);
    }
  }

  const results = Object.values(report.results);
  const existingResults = results.filter((result) => result.priorLabel);
  const changed = existingResults.filter((result) => result.priorLabel !== result.label);
  console.log(`\nCOMPLETE | ${results.length}/${total} judged | ${report.appliedRuns.length}/${eligibleRuns.length} runs applied | ${qualityCounts(results)}`);
  console.log(`Existing labels: ${existingResults.length}; unchanged ${existingResults.length - changed.length}; changed ${changed.length}.`);
  console.log(`Detailed rationales and provenance: ${REPORT_PATH}`);
}

main().catch((error) => {
  console.error(`BACKFILL FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
