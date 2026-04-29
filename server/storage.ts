import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RUNS_DIR } from './paths.ts';
import type { PracticeConversation, PracticeRun } from '../shared/types.ts';
import { getAllowedVocabulary } from './vocab.ts';
import { calculateRunAnalytics } from './analytics.ts';

function nowIso(): string {
  return new Date().toISOString();
}

export function makeRunId(setNumber: number): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const suffix = Math.random().toString(36).slice(2, 8);
  return `set-${String(setNumber).padStart(2, '0')}-${stamp}-${suffix}`;
}

export function runDir(runId: string): string {
  return path.join(RUNS_DIR, runId);
}

export function runJsonPath(runId: string): string {
  return path.join(runDir(runId), 'run.json');
}

export function runAudioDir(runId: string): string {
  return path.join(runDir(runId), 'audio');
}

export async function saveRun(run: PracticeRun): Promise<PracticeRun> {
  await mkdir(runDir(run.id), { recursive: true });
  await writeFile(runJsonPath(run.id), `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  return run;
}

export async function readRun(runId: string): Promise<PracticeRun> {
  const raw = await readFile(runJsonPath(runId), 'utf8');
  const run = JSON.parse(raw) as PracticeRun;
  if (!run.analytics) {
    const allowedVocabulary = await getAllowedVocabulary(run.setNumber);
    run.analytics = calculateRunAnalytics(run.setNumber, allowedVocabulary, run.conversations);
  }
  return run;
}

export async function listRuns(): Promise<PracticeRun[]> {
  await mkdir(RUNS_DIR, { recursive: true });
  const entries = await readdir(RUNS_DIR, { withFileTypes: true });
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

export async function updateConversation(
  runId: string,
  conversationId: string,
  updater: (conversation: PracticeConversation, run: PracticeRun) => PracticeConversation
): Promise<PracticeRun> {
  const run = await readRun(runId);
  const index = run.conversations.findIndex((conversation) => conversation.id === conversationId);
  if (index === -1) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  run.conversations[index] = updater(run.conversations[index], run);
  const allowedVocabulary = await getAllowedVocabulary(run.setNumber);
  run.analytics = calculateRunAnalytics(run.setNumber, allowedVocabulary, run.conversations);
  run.updatedAt = nowIso();
  run.status = run.conversations.every((conversation) => conversation.status === 'audio_ready') ? 'complete' : run.conversations.some((conversation) => conversation.audioFileName) ? 'partial_audio' : 'generated';
  return saveRun(run);
}

export function touchConversation<T extends PracticeConversation>(conversation: T): T {
  return {
    ...conversation,
    updatedAt: nowIso()
  };
}
