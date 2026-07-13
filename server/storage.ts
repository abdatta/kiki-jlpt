import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { RUNS_DIR } from './paths.ts';
import type { PracticeConversation, PracticeRun } from '../shared/types.ts';
import { getAllowedVocabulary, readVocabulary } from './vocab.ts';
import { calculateRunAnalytics } from './analytics.ts';
import { legacyTextModel } from './textModels.ts';
import { auditConversationsWithVocabulary } from './vocabAudit.ts';
import { atomicWriteFile, retryTransientFs } from './atomic.ts';
import { publishStudioRunEvent } from './studioJobs.ts';

function nowIso(): string {
  return new Date().toISOString();
}

const runUpdateQueues = new Map<string, Promise<void>>();
let runsRoot = RUNS_DIR;

async function withRunUpdateQueue<T>(runId: string, operation: () => Promise<T>): Promise<T> {
  const previous = runUpdateQueues.get(runId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const tail = current.then(() => undefined, () => undefined);
  runUpdateQueues.set(runId, tail);
  try {
    return await current;
  } finally {
    if (runUpdateQueues.get(runId) === tail) {
      runUpdateQueues.delete(runId);
    }
  }
}

export function makeRunId(setNumber: number): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const suffix = Math.random().toString(36).slice(2, 8);
  return `set-${String(setNumber).padStart(2, '0')}-${stamp}-${suffix}`;
}

export function runDir(runId: string): string {
  return path.join(runsRoot, runId);
}

export function runJsonPath(runId: string): string {
  return path.join(runDir(runId), 'run.json');
}

export function runAudioDir(runId: string): string {
  return path.join(runDir(runId), 'audio');
}

async function writeRun(run: PracticeRun): Promise<PracticeRun> {
  await mkdir(runDir(run.id), { recursive: true });
  await atomicWriteFile(runJsonPath(run.id), `${JSON.stringify(run, null, 2)}\n`);
  publishStudioRunEvent(run);
  return run;
}

export async function saveRun(run: PracticeRun): Promise<PracticeRun> {
  return withRunUpdateQueue(run.id, () => writeRun(run));
}

export async function mutateRun(runId: string, updater: (run: PracticeRun) => PracticeRun | Promise<PracticeRun>): Promise<PracticeRun> {
  return withRunUpdateQueue(runId, async () => writeRun(await updater(await readRun(runId))));
}

export async function readRun(runId: string): Promise<PracticeRun> {
  const raw = await retryTransientFs(() => readFile(runJsonPath(runId), 'utf8'));
  const run = JSON.parse(raw.replace(/^\uFEFF/, '')) as PracticeRun;
  if (!run.textModel) {
    run.textModel = legacyTextModel();
  }
  return run;
}

export async function listRuns(): Promise<PracticeRun[]> {
  await mkdir(runsRoot, { recursive: true });
  const entries = await readdir(runsRoot, { withFileTypes: true });
  const runs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        try {
          return await readRun(entry.name);
        } catch {
          return null;
        }
      })
  );

  return runs
    .filter((run): run is PracticeRun => Boolean(run))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteRun(runId: string): Promise<void> {
  const root = path.resolve(runsRoot);
  const target = path.resolve(runDir(runId));
  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    throw new Error('Invalid run path.');
  }
  await withRunUpdateQueue(runId, async () => {
    await readRun(runId);
    await rm(target, { recursive: true, force: true });
  });
}

export async function reanalyzeRun(runId: string): Promise<PracticeRun> {
  return mutateRun(runId, async (run) => {
    const allowedVocabulary = await getAllowedVocabulary(run.setNumber);
    const knownVocabulary = await readVocabulary();
    run.conversations = await auditConversationsWithVocabulary(allowedVocabulary, run.conversations, knownVocabulary);
    run.analytics = calculateRunAnalytics(run.setNumber, allowedVocabulary, run.conversations);
    run.updatedAt = nowIso();
    return run;
  });
}

export async function updateConversation(
  runId: string,
  conversationId: string,
  updater: (conversation: PracticeConversation, run: PracticeRun) => PracticeConversation
): Promise<PracticeRun> {
  return withRunUpdateQueue(runId, async () => {
    const run = await readRun(runId);
    const index = run.conversations.findIndex((conversation) => conversation.id === conversationId);
    if (index === -1) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const allowedVocabulary = await getAllowedVocabulary(run.setNumber);
    const knownVocabulary = await readVocabulary();
    run.conversations[index] = updater(run.conversations[index], run);
    run.conversations = await auditConversationsWithVocabulary(allowedVocabulary, run.conversations, knownVocabulary);
    run.analytics = calculateRunAnalytics(run.setNumber, allowedVocabulary, run.conversations);
    run.updatedAt = nowIso();
    run.status = run.conversations.every((conversation) => conversation.status === 'audio_ready') ? 'complete' : run.conversations.some((conversation) => conversation.audioFileName) ? 'partial_audio' : 'generated';
    return writeRun(run);
  });
}

export async function unlockCuratedSource(runId: string, conversationId: string, curatedId: string): Promise<PracticeRun | null> {
  try {
    return await updateConversation(runId, conversationId, (conversation) => {
      if (conversation.curatedId !== curatedId) return conversation;
      return touchConversation({
        ...conversation,
        curatedId: undefined,
        curatedAt: undefined
      });
    });
  } catch {
    return null;
  }
}

export function touchConversation<T extends PracticeConversation>(conversation: T): T {
  return {
    ...conversation,
    updatedAt: nowIso()
  };
}

export function configureRunStorageForTests(root: string): void {
  runsRoot = root;
  runUpdateQueues.clear();
}
