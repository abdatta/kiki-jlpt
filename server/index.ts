import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { mkdir, unlink } from 'node:fs/promises';
import type { GenerateRequest, LibraryComplementGenerateRequest, LlmExchange, PracticeConversation, PracticeRun, TextModelInfo, VocabItem, WorkflowAuditNode, WorkflowGenerateRequest, WorkflowJob, WorkflowNodeStatus, WorkflowRunAudit } from '../shared/types.ts';
import { CURATED_AUDIO_DIR, CURATED_DIR, CURATED_SETS_DIR, OUTPUTS_DIR, RUNS_DIR } from './paths.ts';
import { buildGenerationPrompt, buildLibraryComplementPrompt } from './prompt.ts';
import { buildTtsPrompt, generateConversationAudio, generateConversationJson } from './gemini.ts';
import { CODEX_TEXT_INSTRUCTIONS, generateCodexConversationJson } from './codexText.ts';
import { getAllowedVocabulary, getSetSummaries } from './vocab.ts';
import { deleteRun, listRuns, makeRunId, readRun, reanalyzeRun, runAudioDir, saveRun, touchConversation, unlockCuratedSource, updateConversation } from './storage.ts';
import { normalizeGeneratedConversations, parseTranscriptText } from './normalize.ts';
import { calculateRunAnalytics } from './analytics.ts';
import { getTextModelOptions, resolveTextModel } from './textModels.ts';
import { auditConversationsWithVocabulary } from './vocabAudit.ts';
import { addConversationToLibrary, listCuratedSets, readCuratedSet, reanalyzeCuratedSet, removeConversationFromLibrary } from './library.ts';
import { recommendLibraryConversations } from './recommendations.ts';
import { buildGeneratedRunBalancePlan, buildLibraryBalancePlan } from './libraryBalance.ts';

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

function validateWorkflowGenerateRequest(body: WorkflowGenerateRequest): { setNumber: number; conversationCount: number; balanceConversationCount: number; audioCount: number } | { error: string; status: number } {
  const setNumber = Number(body.setNumber);
  const conversationCount = Number(body.conversationCount);
  const audioCount = body.audioCount === undefined ? 2 : Number(body.audioCount);

  if (!Number.isInteger(setNumber) || setNumber < 1) {
    return { status: 400, error: 'Set number must be a positive integer.' };
  }
  if (!Number.isInteger(conversationCount) || conversationCount < 4 || conversationCount > 30) {
    return { status: 400, error: 'Conversation count must be between 4 and 30.' };
  }
  if (!Number.isInteger(audioCount) || audioCount < 0 || audioCount > 5) {
    return { status: 400, error: 'Workflow audio count must be between 0 and 5.' };
  }

  return {
    setNumber,
    conversationCount,
    balanceConversationCount: Math.ceil(conversationCount / 2),
    audioCount
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
  | { setNumber: number; conversationCount: number; balanceConversationCount: number; audioCount: number; allowedVocabulary: VocabItem[]; textModel: TextModelInfo; prompt: string }
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
  | { setNumber: number; conversationCount: number; allowedVocabulary: VocabItem[]; textModel: TextModelInfo; prompt: string; balance: Awaited<ReturnType<typeof buildLibraryBalancePlan>> }
  | { error: string; status: number }
> {
  const validated = validateSetNumber(setNumberValue);
  if ('error' in validated) return validated;

  const allowedVocabulary = await getAllowedVocabulary(validated.setNumber);
  if (!allowedVocabulary.length) {
    return { status: 404, error: `No vocabulary found for Set ${validated.setNumber}.` };
  }

  const textModel = await resolveTextModel(body?.textModelId);
  const balance = await buildLibraryBalancePlan(validated.setNumber);
  const prompt = buildLibraryComplementPrompt(validated.setNumber, allowedVocabulary, balance);
  return {
    setNumber: validated.setNumber,
    conversationCount: balance.suggestedConversationCount,
    allowedVocabulary,
    textModel,
    prompt,
    balance
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
      title: 'Generator Agent',
      status: 'pending'
    },
    {
      id: 'balancer',
      kind: 'balancer',
      title: 'Balancer Agent',
      status: 'pending'
    },
    ...Array.from({ length: audioCount }, (_, index) => ({
      id: `audio-${index + 1}`,
      kind: 'audio' as const,
      title: `Audio Agent: Conversation ${index + 1}`,
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
  return updated;
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

function calculateWorkflowDistributionStats(allowedVocabulary: VocabItem[], conversations: PracticeConversation[]) {
  const allowedWords = allowedVocabulary.map((item) => item.japanese);
  const allowedWordSet = new Set(allowedWords);
  const counts = new Map(allowedWords.map((word) => [word, 0]));

  for (const conversation of conversations) {
    for (const word of conversation.vocabularyUsed) {
      const cleaned = word.trim();
      if (allowedWordSet.has(cleaned)) {
        counts.set(cleaned, (counts.get(cleaned) ?? 0) + 1);
      }
    }
  }

  const values = Array.from(counts.values());
  return {
    allowedVocabularyTotal: allowedWords.length,
    missingCount: values.filter((count) => count <= 0).length,
    atMostOnceCount: values.filter((count) => count <= 1).length,
    atMostTwiceCount: values.filter((count) => count <= 2).length
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

async function generateWorkflowAudio(run: PracticeRun, audioCount: number): Promise<{
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

  const results = await Promise.allSettled(targetConversations.map((conversation) => generateConversationAudio(run.id, conversation)));
  const audioErrors: Array<{ conversationId: string; error: string }> = [];
  let audioGeneratedCount = 0;

  updatedRun = {
    ...updatedRun,
    conversations: updatedRun.conversations.map((conversation) => {
      const targetIndex = targetConversations.findIndex((target) => target.id === conversation.id);
      if (targetIndex === -1) return conversation;

      const result = results[targetIndex];
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

async function runWorkflowJob(jobId: string, request: WorkflowGenerateRequest): Promise<void> {
  try {
    const context = await getWorkflowGenerateContext(request);
    if ('error' in context) {
      throw new Error(context.error);
    }

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
    const primary = await generateTextBatch(
      context.textModel,
      context.prompt,
      context.allowedVocabulary,
      context.conversationCount
    );
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
        distributionStats: calculateWorkflowDistributionStats(context.allowedVocabulary, primary.conversations)
      }
    });

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
    const complement = await generateTextBatch(
      context.textModel,
      complementPrompt,
      context.allowedVocabulary,
      context.balanceConversationCount
    );
    const complementConversations = renumberConversations(complement.conversations, primary.conversations.length + 1);
    const conversations = [...primary.conversations, ...complementConversations];
    if (conversations.length <= primary.conversations.length) {
      throw new Error('The balancing response did not include any usable conversations.');
    }
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
        distributionStats: calculateWorkflowDistributionStats(context.allowedVocabulary, conversations)
      }
    });

    const timestamp = nowIso();
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
    updateWorkflowJob(jobId, (job) => ({ ...job, run }));

    const audioTargets = run.conversations.slice(0, context.audioCount);
    run = {
      ...run,
      conversations: run.conversations.map((conversation) => audioTargets.some((target) => target.id === conversation.id)
        ? touchConversation({ ...conversation, status: 'audio_generating', error: undefined })
        : conversation),
      updatedAt: nowIso()
    };
    run.status = runStatusFor(run.conversations);
    await saveRun(run);
    updateWorkflowJob(jobId, (job) => ({ ...job, run }));

    const audioResults = await Promise.allSettled(audioTargets.map(async (conversation, index) => {
      const nodeId = `audio-${index + 1}`;
      const prompt = buildTtsPrompt(conversation);
      updateWorkflowNode(jobId, nodeId, {
        status: 'processing',
        startedAt: nowIso(),
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

      try {
        const audio = await generateConversationAudio(run.id, conversation);
        updateWorkflowNode(jobId, nodeId, {
          status: 'done',
          completedAt: nowIso(),
          output: {
            fileName: audio.fileName,
            audioUrl: `/audio/${encodeURIComponent(run.id)}/audio/${encodeURIComponent(audio.fileName)}`,
            filePath: audio.filePath
          }
        });
        return { conversationId: conversation.id, audio };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateWorkflowNode(jobId, nodeId, {
          status: 'error',
          completedAt: nowIso(),
          error: message
        });
        throw { conversationId: conversation.id, error: message };
      }
    }));

    let audioGeneratedCount = 0;
    const audioErrors: Array<{ conversationId: string; error: string }> = [];
    run = {
      ...run,
      conversations: run.conversations.map((conversation) => {
        const targetIndex = audioTargets.findIndex((target) => target.id === conversation.id);
        if (targetIndex === -1) return conversation;

        const result = audioResults[targetIndex];
        if (result?.status === 'fulfilled') {
          audioGeneratedCount += 1;
          const audioUrl = `/audio/${encodeURIComponent(run.id)}/audio/${encodeURIComponent(result.value.audio.fileName)}`;
          return touchConversation({
            ...conversation,
            status: 'audio_ready',
            audioFileName: result.value.audio.fileName,
            audioUrl,
            error: undefined
          });
        }

        const reason = result?.status === 'rejected' ? result.reason as { conversationId?: string; error?: string } : {};
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
    await saveRun(run);
    updateWorkflowJob(jobId, (job) => ({ ...job, run }));
  } catch (error) {
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
  res.json({ run: await readRun(routeParam(req.params.runId)) });
}));

app.delete('/api/runs/:runId', asyncHandler(async (req, res) => {
  const runId = routeParam(req.params.runId);
  await deleteRun(runId);
  res.json({ deletedRunId: runId, runs: await listRuns() });
}));

app.post('/api/runs/:runId/reanalyze', asyncHandler(async (req, res) => {
  res.json({ run: await reanalyzeRun(routeParam(req.params.runId)) });
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

app.get('/api/library/sets/:setNumber', asyncHandler(async (req, res) => {
  const setNumber = Number(routeParam(req.params.setNumber));
  if (!Number.isInteger(setNumber) || setNumber < 1) {
    res.status(400).json({ error: 'Set number must be a positive integer.' });
    return;
  }
  res.json({ set: await readCuratedSet(setNumber) });
}));

app.post('/api/library/sets/:setNumber/reanalyze', asyncHandler(async (req, res) => {
  const setNumber = Number(routeParam(req.params.setNumber));
  if (!Number.isInteger(setNumber) || setNumber < 1) {
    res.status(400).json({ error: 'Set number must be a positive integer.' });
    return;
  }
  res.json({ set: await reanalyzeCuratedSet(setNumber) });
}));

app.get('/api/library/sets/:setNumber/recommendations', asyncHandler(async (req, res) => {
  const validated = validateSetNumber(routeParam(req.params.setNumber));
  if ('error' in validated) {
    res.status(validated.status).json({ error: validated.error });
    return;
  }
  res.json({ recommendations: await recommendLibraryConversations(validated.setNumber) });
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
  const job: WorkflowJob = {
    id: makeWorkflowJobId(context.setNumber),
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
  workflowJobs.set(job.id, job);
  void runWorkflowJob(job.id, req.body);
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

  const audio = await generateWorkflowAudio(run, Math.min(context.audioCount, conversations.length));
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
          libraryBalance: context.balance
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
  let run = await updateConversation(runId, conversationId, (conversation) => {
    if (conversation.curatedId) {
      throw new Error('This conversation is in Library and is read-only.');
    }
    return touchConversation({ ...conversation, status: 'audio_generating', error: undefined });
  });

  const conversation = run.conversations.find((item) => item.id === conversationId);
  if (!conversation) throw new Error('Conversation not found.');

  try {
    const audio = await generateConversationAudio(runId, conversation);
    run = await updateConversation(runId, conversationId, (current) => {
      const audioUrl = `/audio/${encodeURIComponent(runId)}/audio/${encodeURIComponent(audio.fileName)}`;
      return touchConversation({
        ...current,
        status: 'audio_ready',
        audioFileName: audio.fileName,
        audioUrl,
        error: undefined
      });
    });
    res.json({ run });
  } catch (error) {
    run = await updateConversation(runId, conversationId, (current) => {
      return touchConversation({
        ...current,
        status: 'audio_failed',
        error: error instanceof Error ? error.message : String(error)
      });
    });
    res.status(502).json({ error: 'Audio generation failed.', detail: error instanceof Error ? error.message : String(error), run });
  }
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
  if (conversation.status === 'audio_generating') {
    throw new Error('Wait for audio generation to finish before deleting audio.');
  }

  if (conversation.audioFileName) {
    await deleteAudioFile(runId, conversation.audioFileName);
  }

  const updated = await updateConversation(runId, conversationId, (current) => {
    return touchConversation({
      ...current,
      status: 'draft',
      audioFileName: undefined,
      audioUrl: undefined,
      error: undefined
    });
  });
  res.json({ run: updated });
}));

app.post('/api/runs/:runId/conversations/:conversationId/library', asyncHandler(async (req, res) => {
  const runId = routeParam(req.params.runId);
  const conversationId = routeParam(req.params.conversationId);
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
await mkdir(CURATED_DIR, { recursive: true });
await mkdir(CURATED_SETS_DIR, { recursive: true });
await mkdir(CURATED_AUDIO_DIR, { recursive: true });

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  res.status(message.includes('not found') ? 404 : 500).json({ error: message });
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Kiki JLPT API running at http://127.0.0.1:${port}`);
  console.log(`Audio files are stored below ${path.relative(process.cwd(), RUNS_DIR) || RUNS_DIR}`);
});
