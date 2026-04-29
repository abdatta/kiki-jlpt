import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { GenerateRequest, PracticeConversation } from '../shared/types.ts';
import { OUTPUTS_DIR, RUNS_DIR } from './paths.ts';
import { buildGenerationPrompt } from './prompt.ts';
import { generateConversationAudio, generateConversationJson } from './gemini.ts';
import { getAllowedVocabulary, getSetSummaries } from './vocab.ts';
import { listRuns, makeRunId, readRun, saveRun, touchConversation, updateConversation } from './storage.ts';
import { normalizeGeneratedConversations, parseTranscriptText } from './normalize.ts';
import { calculateRunAnalytics } from './analytics.ts';

const app = express();
const port = Number.parseInt(process.env.API_PORT || '8787', 10);

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/audio', express.static(RUNS_DIR));

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : value ?? '';
}

function asyncHandler<TReq extends express.Request>(
  handler: (req: TReq, res: express.Response) => Promise<void>
): express.RequestHandler {
  return (req, res, next) => {
    handler(req as TReq, res).catch(next);
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/sets', asyncHandler(async (_req, res) => {
  res.json({ sets: await getSetSummaries() });
}));

app.get('/api/runs', asyncHandler(async (_req, res) => {
  res.json({ runs: await listRuns() });
}));

app.get('/api/runs/:runId', asyncHandler(async (req, res) => {
  res.json({ run: await readRun(routeParam(req.params.runId)) });
}));

app.post('/api/generate', asyncHandler(async (req: express.Request<unknown, unknown, GenerateRequest>, res) => {
  const setNumber = Number(req.body.setNumber);
  const conversationCount = Number(req.body.conversationCount);

  if (!Number.isInteger(setNumber) || setNumber < 1) {
    res.status(400).json({ error: 'Set number must be a positive integer.' });
    return;
  }
  if (!Number.isInteger(conversationCount) || conversationCount < 4 || conversationCount > 30) {
    res.status(400).json({ error: 'Conversation count must be between 4 and 30.' });
    return;
  }

  const allowedVocabulary = await getAllowedVocabulary(setNumber);
  if (!allowedVocabulary.length) {
    res.status(404).json({ error: `No vocabulary found for Set ${setNumber}.` });
    return;
  }

  const prompt = await buildGenerationPrompt(setNumber, conversationCount, allowedVocabulary);
  const raw = await generateConversationJson(prompt);
  const conversations = normalizeGeneratedConversations(raw, conversationCount);

  if (!conversations.length) {
    res.status(502).json({ error: 'The generation response did not include any usable conversations.' });
    return;
  }

  const timestamp = new Date().toISOString();
  const run = await saveRun({
    id: makeRunId(setNumber),
    setNumber,
    conversationCount,
    allowedVocabCount: allowedVocabulary.length,
    analytics: calculateRunAnalytics(setNumber, allowedVocabulary, conversations),
    status: 'generated',
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

await mkdir(OUTPUTS_DIR, { recursive: true });
await mkdir(RUNS_DIR, { recursive: true });

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  res.status(message.includes('not found') ? 404 : 500).json({ error: message });
});

app.listen(port, '127.0.0.1', () => {
  console.log(`JLPT Listener API running at http://127.0.0.1:${port}`);
  console.log(`Audio files are stored below ${path.relative(process.cwd(), RUNS_DIR) || RUNS_DIR}`);
});
