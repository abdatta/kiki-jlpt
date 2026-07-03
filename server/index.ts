import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import type { AiCurationRequest, GenerateRequest, LibraryComplementGenerateRequest, LlmExchange, PracticeConversation, PracticeRun, RunAudioGenerateRequest, StudioJob, StudioRunSummary, StudioSnapshot, TextModelInfo, VocabItem, WorkflowAuditNode, WorkflowAudioMode, WorkflowGenerateRequest, WorkflowJob, WorkflowNodeStatus, WorkflowRunAudit } from '../shared/types.ts';
import { CURATED_AUDIO_DIR, CURATED_DIR, CURATED_SETS_DIR, OUTPUTS_DIR, RUNS_DIR, STUDIO_JOBS_DIR } from './paths.ts';
import { buildAiLibraryBalancePrompt, buildGenerationPrompt, buildLibraryComplementPrompt } from './prompt.ts';
import { buildTtsPrompt, generateConversationAudio, generateConversationJson } from './gemini.ts';
import { CODEX_TEXT_INSTRUCTIONS, generateCodexConversationJson } from './codexText.ts';
import { getAllowedVocabulary, getSetSummaries } from './vocab.ts';
import { deleteRun, listRuns, makeRunId, mutateRun, readRun, reanalyzeRun, runAudioDir, saveRun, touchConversation, unlockCuratedSource, updateConversation } from './storage.ts';
import { normalizeGeneratedConversations, parseTranscriptText } from './normalize.ts';
import { calculateRunAnalytics } from './analytics.ts';
import { getTextModelOptions, resolveTextModel } from './textModels.ts';
import { auditConversationsWithVocabulary } from './vocabAudit.ts';
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
  | { setNumber: number; conversationCount: number; allowedVocabulary: VocabItem[]; textModel: TextModelInfo; prompt: string }
  | { error: string; status: number }
> {
  const validated = validateGenerateRequest(body);
  if ('error' in validated) return validated;

  const allowedVocabulary = await getAllowedVocabulary(validated.setNumber);
  if (!allowedVocabulary.length) {
    return { status: 404, error: `No vocabulary found for Set ${validated.setNumber}.` };
  }

  const textModel = await resolveTextModel(body.textModelId);
  const prompt = await buildGenerationPrompt(validated.setNumber, validated.conversationCount, allowedVocabulary);
  return { ...validated, allowedVocabulary, textModel, prompt };
}

async function getWorkflowGenerateContext(body: WorkflowGenerateRequest): Promise<
  | { setNumber: number; conversationCount: number; balanceConversationCount: number; audioCount: number; audioMode: WorkflowAudioMode; allowedVocabulary: VocabItem[]; textModel: TextModelInfo; prompt: string }
  | { error: string; status: number }
> {
  const validated = validateWorkflowGenerateRequest(body);
  if ('error' in validated) return validated;

  const allowedVocabulary = await getAllowedVocabulary(validated.setNumber);
  if (!allowedVocabulary.length) {
    return { status: 404, error: `No vocabulary found for Set ${validated.setNumber}.` };
  }

  const textModel = await resolveTextModel(body.textModelId);
  const prompt = await buildGenerationPrompt(validated.setNumber, validated.conversationCount, allowedVocabulary);
  return { ...validated, allowedVocabulary, textModel, prompt };
}

async function getLibraryComplementContext(
  setNumberValue: unknown,
  body: LibraryComplementGenerateRequest | undefined
): Promise<
  | { setNumber: number; conversationCount: number; allowedVocabulary: VocabItem[]; textModel: TextModelInfo; prompt: string; balance: Awaited<ReturnType<typeof buildLibraryBalancePlan>>; balanceMode: 'stats' | 'ai'; librarySnapshotContext?: AiCurationLibraryContext }
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
    textModel,
    prompt: buildLibraryComplementPrompt(validated.setNumber, allowedVocabulary, balance),
    balance,
    balanceMode
  };
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
    instructions: textModel.provider === 'codex' ? CODEX_TEXT_INSTRUCTIONS : undefined,
    prompt,
    requestedAt,
    status: 'pending'
  };
}

function makeWorkflowJobId(setNumber: number): string {
  const stamp = nowIso().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const suffix = Math.random().toString(36).slice(2, 8);
  return `workflow-set-${String(setNumber).padStart(2, '0')}-${stamp}-${suffix}`;
}

function makeWorkflowNodes(audioCount: number): WorkflowAuditNode[] {
  return [
    {
      id: 'generator',
      kind: 'generator',
      title: 'Generating Initial Set',
      status: 'pending'
    },
    {
      id: 'balancer',
      kind: 'balancer',
      title: 'Balancing Set',
      status: 'pending'
    },
    ...Array.from({ length: audioCount }, (_, index) => ({
      id: `audio-${index + 1}`,
      kind: 'audio' as const,
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
      : ['pausing', 'paused', 'queued'].includes(studioJob.status) ? studioJob.status
      : 'running',
    stageLabel: activeNode?.kind === 'generator'
      ? 'Generating initial set'
      : activeNode?.kind === 'balancer'
        ? 'Balancing set'
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
      const nodes = stage.id === 'audio' ? updated.nodes.filter((node) => node.kind === 'audio') : updated.nodes.filter((node) => node.id === stage.id);
      if (!nodes.length) return stage;
      const status = nodes.some((node) => node.status === 'processing') ? 'running'
        : nodes.some((node) => node.status === 'error') ? 'failed'
        : nodes.every((node) => node.status === 'done' || node.status === 'skipped') ? 'succeeded'
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
    throw new Error('This run has unfinished background work. Resume and finish it before deleting the run.');
  }
}

function updateWorkflowNode(
  jobId: string,
  nodeId: string,
  patch: Partial<Omit<WorkflowAuditNode, 'id' | 'kind' | 'title'>>
): void {
  updateWorkflowJob(jobId, (job) => ({
    ...job,
    nodes: job.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node)
  }));
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
  expectedCount: number
): Promise<{ conversations: PracticeConversation[]; exchange: LlmExchange }> {
  const requestedAt = new Date().toISOString();
  const exchange = makeLlmExchange(textModel, prompt, requestedAt);
  const generation = textModel.provider === 'codex'
    ? await generateCodexConversationJson(prompt, textModel.model)
    : await generateConversationJson(prompt);
  const conversations = await auditConversationsWithVocabulary(
    allowedVocabulary,
    normalizeGeneratedConversations(generation.parsed, expectedCount)
  );
  const timestamp = new Date().toISOString();

  return {
    conversations,
    exchange: {
      ...exchange,
      output: generation.output,
      stats: generation.stats,
      receivedAt: timestamp,
      status: 'complete'
    }
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
      updateWorkflowNode(jobId, 'generator', {
        status: 'processing',
        startedAt: nowIso(),
        input: {
          setNumber: context.setNumber,
          requestedConversationCount: context.conversationCount,
          model: context.textModel,
          prompt: context.prompt
        }
      });
      primary = await generateTextBatch(
        context.textModel,
        context.prompt,
        context.allowedVocabulary,
        context.conversationCount
      );
    }
    if (!primary.conversations.length) {
      throw new Error('The generation response did not include any usable conversations.');
    }
    updateWorkflowNode(jobId, 'generator', {
      status: 'done',
      completedAt: nowIso(),
      output: {
        exchange: primary.exchange,
        conversations: primary.conversations,
        analytics: calculateRunAnalytics(context.setNumber, context.allowedVocabulary, primary.conversations),
        distributionStats: calculateWorkflowDistributionStats(context.setNumber, context.allowedVocabulary, primary.conversations)
      }
    });
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
    updateWorkflowNode(jobId, 'balancer', {
      status: 'processing',
      startedAt: nowIso(),
      input: {
        setNumber: context.setNumber,
        requestedConversationCount: context.balanceConversationCount,
        model: context.textModel,
        balance,
        prompt: complementPrompt
      }
    });
    let complement = resume ? checkpoint.complement as Awaited<ReturnType<typeof generateTextBatch>> | undefined : undefined;
    if (!complement) {
      complement = await generateTextBatch(
        context.textModel,
        complementPrompt,
        context.allowedVocabulary,
        context.balanceConversationCount
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
    updateWorkflowNode(jobId, 'balancer', {
      status: 'done',
      completedAt: nowIso(),
      output: {
        exchange: {
          ...complement.exchange,
          stats: {
            ...(complement.exchange.stats && typeof complement.exchange.stats === 'object' ? complement.exchange.stats : { rawStats: complement.exchange.stats }),
            generatedBatchBalance: balance
          }
        },
        conversations: complementConversations,
        analytics: calculateRunAnalytics(context.setNumber, context.allowedVocabulary, conversations),
        distributionStats: calculateWorkflowDistributionStats(context.setNumber, context.allowedVocabulary, conversations)
      }
    });
    await generationCheckpoint(jobId);

    const timestamp = nowIso();
    const existingRun = resume && durableJob.runId ? await readRun(durableJob.runId).catch(() => undefined) : undefined;
    let run = existingRun ?? await saveRun({
      id: durableJob.runId ?? makeRunId(context.setNumber),
      setNumber: context.setNumber,
      conversationCount: context.conversationCount + context.balanceConversationCount,
      allowedVocabCount: context.allowedVocabulary.length,
      textModel: context.textModel,
      analytics: calculateRunAnalytics(context.setNumber, context.allowedVocabulary, conversations),
      status: 'generated',
      llmExchanges: [
        primary.exchange,
        {
          ...complement.exchange,
          stats: {
            ...(complement.exchange.stats && typeof complement.exchange.stats === 'object' ? complement.exchange.stats : { rawStats: complement.exchange.stats }),
            generatedBatchBalance: balance
          }
        }
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
      conversations
    });
    updateWorkflowJob(jobId, (job) => ({ ...job, run }));

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
    updateWorkflowJob(jobId, (job) => ({
      ...job,
      status: 'failed',
      error: message,
      nodes: job.nodes.map((node) => node.status === 'processing'
        ? { ...node, status: 'error' as WorkflowNodeStatus, completedAt: nowIso(), error: message }
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
    const generated = await generateTextBatch(context.textModel, context.prompt, context.allowedVocabulary, context.conversationCount);
    if (!generated.conversations.length) throw new Error('The generation response did not include any usable conversations.');
    await generationCheckpoint(jobId);
    const timestamp = nowIso();
    const run = await saveRun({
      id: job.runId ?? makeRunId(context.setNumber),
      setNumber: context.setNumber,
      conversationCount: context.conversationCount,
      allowedVocabCount: context.allowedVocabulary.length,
      textModel: context.textModel,
      analytics: calculateRunAnalytics(context.setNumber, context.allowedVocabulary, generated.conversations),
      status: 'generated',
      llmExchanges: [generated.exchange],
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
    await updateStudioJob(jobId, (current) => ({
      ...current,
      status: 'failed',
      stageLabel: 'Generation failed',
      error: message,
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
    const requestedAt = nowIso();
    const exchange = makeLlmExchange(context.textModel, context.prompt, requestedAt);
    const generation = context.textModel.provider === 'codex'
      ? await generateCodexConversationJson(context.prompt, context.textModel.model)
      : await generateConversationJson(context.prompt);
    const conversations = await auditConversationsWithVocabulary(
      context.allowedVocabulary,
      normalizeGeneratedConversations(generation.parsed, context.conversationCount)
    );
    if (!conversations.length) throw new Error('The generation response did not include any usable conversations.');
    await generationCheckpoint(jobId);
    const timestamp = nowIso();
    const run = await saveRun({
      id: job.runId ?? makeRunId(context.setNumber),
      setNumber: context.setNumber,
      conversationCount: context.conversationCount,
      allowedVocabCount: context.allowedVocabulary.length,
      textModel: context.textModel,
      analytics: calculateRunAnalytics(context.setNumber, context.allowedVocabulary, conversations),
      status: 'generated',
      llmExchanges: [{
        ...exchange,
        output: generation.output,
        stats: {
          ...(generation.stats && typeof generation.stats === 'object' ? generation.stats : { rawStats: generation.stats }),
          libraryBalance: context.balance,
          libraryBalanceMode: context.balanceMode
        },
        receivedAt: timestamp,
        status: 'complete'
      }],
      createdAt: job.createdAt,
      updatedAt: timestamp,
      conversations
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
    await updateStudioJob(jobId, (current) => ({ ...current, status: 'failed', stageLabel: 'Balance generation failed', error: message, completedAt: nowIso() }));
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
    const resumed = await updateStudioJob(job.id, (current) => ({ ...current, status: 'queued', stageLabel: isGenerationSlotBusy() ? 'Waiting for earlier generation' : 'Resuming workflow', error: undefined }));
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
  const job: WorkflowJob = {
    id: jobId,
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
    runId: makeRunId(context.setNumber),
    revision: 1,
    progress: { completed: 0, total: context.audioCount, queued: context.audioCount },
    stages: [
      { id: 'generator', label: 'Generating initial set', status: 'pending' },
      { id: 'balancer', label: 'Balancing set', status: 'pending' },
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

  const requestedAt = new Date().toISOString();
  const exchange = makeLlmExchange(context.textModel, context.prompt, requestedAt);
  const generation = context.textModel.provider === 'codex'
    ? await generateCodexConversationJson(context.prompt, context.textModel.model)
    : await generateConversationJson(context.prompt);
  const conversations = await auditConversationsWithVocabulary(
    context.allowedVocabulary,
    normalizeGeneratedConversations(generation.parsed, context.conversationCount)
  );

  if (!conversations.length) {
    res.status(502).json({ error: 'The generation response did not include any usable conversations.' });
    return;
  }

  const timestamp = new Date().toISOString();
  const run = await saveRun({
    id: makeRunId(context.setNumber),
    setNumber: context.setNumber,
    conversationCount: context.conversationCount,
    allowedVocabCount: context.allowedVocabulary.length,
    textModel: context.textModel,
    analytics: calculateRunAnalytics(context.setNumber, context.allowedVocabulary, conversations),
    status: 'generated',
    llmExchanges: [
      {
        ...exchange,
        output: generation.output,
        stats: generation.stats,
        receivedAt: timestamp,
        status: 'complete'
      }
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
    conversations
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
    context.conversationCount
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
    context.balanceConversationCount
  );
  const complementConversations = renumberConversations(complement.conversations, primary.conversations.length + 1);
  const conversations = [...primary.conversations, ...complementConversations];

  if (conversations.length <= primary.conversations.length) {
    res.status(502).json({ error: 'The balancing response did not include any usable conversations.' });
    return;
  }

  const timestamp = new Date().toISOString();
  let run = await saveRun({
    id: makeRunId(context.setNumber),
    setNumber: context.setNumber,
    conversationCount: context.conversationCount + context.balanceConversationCount,
    allowedVocabCount: context.allowedVocabulary.length,
    textModel: context.textModel,
    analytics: calculateRunAnalytics(context.setNumber, context.allowedVocabulary, conversations),
    status: 'generated',
    llmExchanges: [
      primary.exchange,
      {
        ...complement.exchange,
        stats: {
          ...(complement.exchange.stats && typeof complement.exchange.stats === 'object' ? complement.exchange.stats : { rawStats: complement.exchange.stats }),
          generatedBatchBalance: balance
        }
      }
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

  const requestedAt = new Date().toISOString();
  const exchange = makeLlmExchange(context.textModel, context.prompt, requestedAt);
  const generation = context.textModel.provider === 'codex'
    ? await generateCodexConversationJson(context.prompt, context.textModel.model)
    : await generateConversationJson(context.prompt);
  const conversations = await auditConversationsWithVocabulary(
    context.allowedVocabulary,
    normalizeGeneratedConversations(generation.parsed, context.conversationCount)
  );

  if (!conversations.length) {
    res.status(502).json({ error: 'The generation response did not include any usable conversations.' });
    return;
  }

  const timestamp = new Date().toISOString();
  const run = await saveRun({
    id: makeRunId(context.setNumber),
    setNumber: context.setNumber,
    conversationCount: context.conversationCount,
    allowedVocabCount: context.allowedVocabulary.length,
    textModel: context.textModel,
    analytics: calculateRunAnalytics(context.setNumber, context.allowedVocabulary, conversations),
    status: 'generated',
    llmExchanges: [
      {
        ...exchange,
        output: generation.output,
        stats: {
          ...(generation.stats && typeof generation.stats === 'object' ? generation.stats : { rawStats: generation.stats }),
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
        },
        receivedAt: timestamp,
        status: 'complete'
      }
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
    conversations
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
