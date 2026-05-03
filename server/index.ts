import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { mkdir, unlink } from 'node:fs/promises';
import type { GenerateRequest, LlmExchange, PracticeConversation, TextModelInfo, VocabItem } from '../shared/types.ts';
import { OUTPUTS_DIR, RUNS_DIR } from './paths.ts';
import { buildGenerationPrompt } from './prompt.ts';
import { generateConversationAudio, generateConversationJson } from './gemini.ts';
import { CODEX_TEXT_INSTRUCTIONS, generateCodexConversationJson } from './codexText.ts';
import { getAllowedVocabulary, getSetSummaries } from './vocab.ts';
import { listRuns, makeRunId, readRun, runAudioDir, saveRun, touchConversation, updateConversation } from './storage.ts';
import { normalizeGeneratedConversations, parseTranscriptText } from './normalize.ts';
import { calculateRunAnalytics } from './analytics.ts';
import { getTextModelOptions, resolveTextModel } from './textModels.ts';
import { auditConversationsWithVocabulary } from './vocabAudit.ts';

const app = express();
const port = Number.parseInt(process.env.API_PORT || '8787', 10);

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/audio', express.static(RUNS_DIR));

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

app.put('/api/runs/:runId/conversations/:conversationId', asyncHandler(async (req, res) => {
  const { title, scene, sampleContext, transcript } = req.body as Record<string, string>;
  const runId = routeParam(req.params.runId);
  const conversationId = routeParam(req.params.conversationId);
  const updated = await updateConversation(runId, conversationId, (conversation) => {
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

app.post('/api/runs/:runId/conversations/:conversationId/approve', asyncHandler(async (req, res) => {
  const updated = await updateConversation(routeParam(req.params.runId), routeParam(req.params.conversationId), (conversation) => {
    return touchConversation({ ...conversation, status: 'approved', error: undefined });
  });
  res.json({ run: updated });
}));

app.post('/api/runs/:runId/conversations/:conversationId/reject', asyncHandler(async (req, res) => {
  const updated = await updateConversation(routeParam(req.params.runId), routeParam(req.params.conversationId), (conversation) => {
    return touchConversation({ ...conversation, status: 'rejected', error: undefined });
  });
  res.json({ run: updated });
}));

app.post('/api/runs/:runId/conversations/:conversationId/audio', asyncHandler(async (req, res) => {
  const runId = routeParam(req.params.runId);
  const conversationId = routeParam(req.params.conversationId);
  let run = await updateConversation(runId, conversationId, (conversation) => {
    if (conversation.status !== 'approved' && conversation.status !== 'audio_failed') {
      throw new Error('Approve the conversation before generating audio.');
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
  if (conversation.status === 'audio_generating') {
    throw new Error('Wait for audio generation to finish before deleting audio.');
  }

  if (conversation.audioFileName) {
    await deleteAudioFile(runId, conversation.audioFileName);
  }

  const updated = await updateConversation(runId, conversationId, (current) => {
    return touchConversation({
      ...current,
      status: 'approved',
      audioFileName: undefined,
      audioUrl: undefined,
      error: undefined
    });
  });
  res.json({ run: updated });
}));

await mkdir(OUTPUTS_DIR, { recursive: true });
await mkdir(RUNS_DIR, { recursive: true });

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  res.status(message.includes('not found') ? 404 : 500).json({ error: message });
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Kiki JLPT API running at http://127.0.0.1:${port}`);
  console.log(`Audio files are stored below ${path.relative(process.cwd(), RUNS_DIR) || RUNS_DIR}`);
});
