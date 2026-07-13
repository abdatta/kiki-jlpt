import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CuratedConversation, CuratedSet, PracticeConversation } from '../shared/types.ts';
import { CURATED_AUDIO_DIR, CURATED_SETS_DIR } from './paths.ts';
import { runAudioDir } from './storage.ts';
import { getAllowedVocabulary, readVocabulary } from './vocab.ts';
import { calculateRunAnalytics } from './analytics.ts';
import { auditConversationsWithVocabulary } from './vocabAudit.ts';

function nowIso(): string {
  return new Date().toISOString();
}

function setSlug(setNumber: number): string {
  return `set-${String(setNumber).padStart(2, '0')}`;
}

function curatedSetPath(setNumber: number): string {
  return path.join(CURATED_SETS_DIR, `${setSlug(setNumber)}.json`);
}

function curatedAudioDir(setNumber: number): string {
  return path.join(CURATED_AUDIO_DIR, setSlug(setNumber));
}

function sanitizeFileStem(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

export function makeCuratedId(runId: string, conversationId: string): string {
  return sanitizeFileStem(`${runId}-${conversationId}`);
}

async function saveCuratedSet(set: CuratedSet): Promise<CuratedSet> {
  await mkdir(CURATED_SETS_DIR, { recursive: true });
  await writeFile(curatedSetPath(set.setNumber), `${JSON.stringify(set, null, 2)}\n`, 'utf8');
  return set;
}

export async function readCuratedSet(setNumber: number): Promise<CuratedSet> {
  const allowedVocabulary = await getAllowedVocabulary(setNumber);
  try {
    const raw = await readFile(curatedSetPath(setNumber), 'utf8');
    const parsed = JSON.parse(raw) as CuratedSet;
    const conversations = [...parsed.conversations].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      ...parsed,
      conversations,
      analytics: calculateRunAnalytics(setNumber, allowedVocabulary, conversations)
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw error;
    const timestamp = nowIso();
    return {
      setNumber,
      analytics: calculateRunAnalytics(setNumber, allowedVocabulary, []),
      conversations: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }
}

export async function listCuratedSets(): Promise<CuratedSet[]> {
  await mkdir(CURATED_SETS_DIR, { recursive: true });
  const entries = await readdir(CURATED_SETS_DIR, { withFileTypes: true });
  const sets = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /^set-\d+\.json$/i.test(entry.name))
      .map(async (entry) => {
        const match = /^set-(\d+)\.json$/i.exec(entry.name);
        if (!match) return null;
        try {
          return await readCuratedSet(Number(match[1]));
        } catch {
          return null;
        }
      })
  );

  return sets
    .filter((set): set is CuratedSet => Boolean(set))
    .sort((a, b) => a.setNumber - b.setNumber);
}

export async function reanalyzeCuratedSet(setNumber: number): Promise<CuratedSet> {
  const set = await readCuratedSet(setNumber);
  const allowedVocabulary = await getAllowedVocabulary(setNumber);
  const knownVocabulary = await readVocabulary();
  const conversations = await auditConversationsWithVocabulary(allowedVocabulary, set.conversations, knownVocabulary) as CuratedConversation[];
  const updated = {
    ...set,
    conversations,
    analytics: calculateRunAnalytics(setNumber, allowedVocabulary, conversations),
    updatedAt: nowIso()
  };

  if (updated.conversations.length) {
    await saveCuratedSet(updated);
  }

  return updated;
}

export async function addConversationToLibrary(
  runId: string,
  setNumber: number,
  conversation: PracticeConversation
): Promise<CuratedConversation> {
  if (!conversation.audioFileName || !conversation.audioUrl || conversation.status !== 'audio_ready') {
    throw new Error('Generate audio before adding this conversation to Library.');
  }

  const curatedId = makeCuratedId(runId, conversation.id);
  const set = await readCuratedSet(setNumber);
  const existing = set.conversations.find((item) => item.id === curatedId);
  if (existing) return existing;

  const sourceAudioDir = path.resolve(runAudioDir(runId));
  const sourceAudioPath = path.resolve(sourceAudioDir, conversation.audioFileName);
  if (!sourceAudioPath.startsWith(`${sourceAudioDir}${path.sep}`)) {
    throw new Error('Invalid source audio file path.');
  }

  const extension = path.extname(conversation.audioFileName) || '.wav';
  const audioFileName = `${curatedId}${extension}`;
  const destinationDir = curatedAudioDir(setNumber);
  await mkdir(destinationDir, { recursive: true });
  await copyFile(sourceAudioPath, path.join(destinationDir, audioFileName));

  const timestamp = nowIso();
  const curatedAudioPath = `curated/audio/${setSlug(setNumber)}/${audioFileName}`;
  const curated: CuratedConversation = {
    ...conversation,
    id: curatedId,
    sourceRunId: runId,
    sourceConversationId: conversation.id,
    setNumber,
    status: 'audio_ready',
    audioFileName,
    audioUrl: `/${curatedAudioPath}`,
    curatedAudioPath,
    curatedId,
    curatedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    error: undefined
  };

  set.conversations = [...set.conversations, curated].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  set.updatedAt = timestamp;
  await saveCuratedSet(set);
  return curated;
}

export async function removeConversationFromLibrary(curatedId: string): Promise<CuratedConversation> {
  const sets = await listCuratedSets();
  for (const setSummary of sets) {
    const set = await readCuratedSet(setSummary.setNumber);
    const removed = set.conversations.find((item) => item.id === curatedId);
    if (!removed) continue;

    set.conversations = set.conversations.filter((item) => item.id !== curatedId);
    set.updatedAt = nowIso();
    if (set.conversations.length) {
      await saveCuratedSet(set);
    } else {
      await unlink(curatedSetPath(set.setNumber)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }

    const audioDir = path.resolve(curatedAudioDir(removed.setNumber));
    const audioPath = path.resolve(audioDir, removed.audioFileName);
    if (audioPath.startsWith(`${audioDir}${path.sep}`)) {
      await unlink(audioPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }

    return removed;
  }

  throw new Error(`Curated conversation not found: ${curatedId}`);
}
