import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { mkdir, unlink } from 'node:fs/promises';
import type { GenerateRequest, LibraryComplementGenerateRequest, LlmExchange, PracticeConversation, TextModelInfo, VocabItem } from '../shared/types.ts';
import { CURATED_AUDIO_DIR, CURATED_DIR, CURATED_SETS_DIR, OUTPUTS_DIR, RUNS_DIR } from './paths.ts';
import { buildGenerationPrompt, buildLibraryComplementPrompt } from './prompt.ts';
import { generateConversationAudio, generateConversationJson } from './gemini.ts';
import { CODEX_TEXT_INSTRUCTIONS, generateCodexConversationJson } from './codexText.ts';
import { getAllowedVocabulary, getSetSummaries } from './vocab.ts';
import { listRuns, makeRunId, readRun, reanalyzeRun, runAudioDir, saveRun, touchConversation, unlockCuratedSource, updateConversation } from './storage.ts';
import { normalizeGeneratedConversations, parseTranscriptText } from './normalize.ts';
import { calculateRunAnalytics } from './analytics.ts';
import { getTextModelOptions, resolveTextModel } from './textModels.ts';
import { auditConversationsWithVocabulary } from './vocabAudit.ts';
import { addConversationToLibrary, listCuratedSets, readCuratedSet, reanalyzeCuratedSet, removeConversationFromLibrary } from './library.ts';
import { recommendLibraryConversations } from './recommendations.ts';
import { buildLibraryBalancePlan } from './libraryBalance.ts';

const app = express();
const port = Number.parseInt(process.env.API_PORT || '8787', 10);

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/audio', express.static(RUNS_DIR));
app.use('/curated', express.static(CURATED_DIR));

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
  requestedAt = new Date().toISOString()
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
