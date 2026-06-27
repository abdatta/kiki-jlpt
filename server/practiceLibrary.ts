import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CuratedSet } from '../shared/types.ts';
import type { StaticLibraryConversation, StaticLibraryManifest } from '../src/consumer/types.ts';
import { CURATED_AUDIO_DIR, PRACTICE_LIBRARY_DIR } from './paths.ts';
import { listCuratedSets } from './library.ts';

const libraryAudioDir = path.join(PRACTICE_LIBRARY_DIR, 'audio');
const manifestPath = path.join(PRACTICE_LIBRARY_DIR, 'library.json');

function setSlug(setNumber: number): string {
  return `set-${String(setNumber).padStart(2, '0')}`;
}

function latestTimestamp(values: Array<string | undefined>): string {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => b.localeCompare(a))[0] ?? '';
}

function curatedUpdatedAt(sets: CuratedSet[]): string {
  return latestTimestamp(sets.flatMap((set) => [
    set.updatedAt,
    ...set.conversations.map((conversation) => conversation.curatedAt ?? conversation.updatedAt ?? conversation.createdAt)
  ]));
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function contentFingerprint(level: number, conversation: {
  title: string;
  scene: string;
  sampleContext?: string;
  text: unknown;
  englishTranslation: unknown;
  listeningQuestions: unknown;
  answerKey: unknown;
}): string {
  return createHash('sha256')
    .update(stableJson({
      level,
      title: conversation.title,
      scene: conversation.scene,
      sampleContext: conversation.sampleContext ?? '',
      text: conversation.text,
      englishTranslation: conversation.englishTranslation,
      listeningQuestions: conversation.listeningQuestions,
      answerKey: conversation.answerKey
    }))
    .digest('hex');
}

function fallbackPublishedId(level: number, fingerprint: string): string {
  return `${setSlug(level)}-${fingerprint.slice(0, 16)}`;
}

function uniquePublishedId(baseId: string, usedIds: Set<string>): string {
  if (!usedIds.has(baseId)) return baseId;

  let suffix = 2;
  let nextId = `${baseId}-${suffix}`;
  while (usedIds.has(nextId)) {
    suffix += 1;
    nextId = `${baseId}-${suffix}`;
  }
  return nextId;
}

interface PreviousPublishedConversation {
  id: string;
  order: number;
}

function previousConversationsByFingerprint(manifest: StaticLibraryManifest | null): Map<string, PreviousPublishedConversation[]> {
  const conversationsByFingerprint = new Map<string, PreviousPublishedConversation[]>();
  if (!manifest) return conversationsByFingerprint;

  manifest.conversations.forEach((conversation, order) => {
    const fingerprint = contentFingerprint(conversation.level, conversation);
    conversationsByFingerprint.set(fingerprint, [
      ...(conversationsByFingerprint.get(fingerprint) ?? []),
      { id: conversation.id, order }
    ]);
  });

  return conversationsByFingerprint;
}

async function readPracticeManifest(): Promise<StaticLibraryManifest | null> {
  try {
    const raw = await readFile(manifestPath, 'utf8');
    return JSON.parse(raw) as StaticLibraryManifest;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw error;
  }
}

function countPublishableConversations(sets: CuratedSet[]): number {
  return sets.reduce((count, set) => (
    count + set.conversations.filter((conversation) => conversation.status === 'audio_ready' && Boolean(conversation.audioFileName)).length
  ), 0);
}

export async function getPracticeLibraryPublishStatus() {
  const sets = await listCuratedSets();
  const manifest = await readPracticeManifest();
  const curatedGeneratedAt = curatedUpdatedAt(sets);
  const publishedGeneratedAt = manifest?.generatedAt ?? '';
  const curatedConversationCount = countPublishableConversations(sets);
  const publishedConversationCount = manifest?.conversations?.length ?? 0;

  return {
    stale: curatedGeneratedAt !== publishedGeneratedAt || curatedConversationCount !== publishedConversationCount,
    curatedGeneratedAt,
    publishedGeneratedAt,
    curatedConversationCount,
    publishedConversationCount
  };
}

export async function publishPracticeLibrary() {
  const sets = await listCuratedSets();
  const previousManifest = await readPracticeManifest();
  const reusableConversations = previousConversationsByFingerprint(previousManifest);
  const usedIds = new Set<string>();
  const previousConversationCount = previousManifest?.conversations.length ?? 0;
  const conversations: Array<StaticLibraryConversation & { publishOrder: number }> = [];
  let nextNewConversationOrder = previousConversationCount;

  await mkdir(PRACTICE_LIBRARY_DIR, { recursive: true });
  await rm(libraryAudioDir, { recursive: true, force: true });
  await mkdir(libraryAudioDir, { recursive: true });

  for (const set of sets) {
    const slug = setSlug(set.setNumber);
    for (const conversation of set.conversations) {
      if (conversation.status !== 'audio_ready' || !conversation.audioFileName) {
        continue;
      }

      const sourceAudio = path.join(CURATED_AUDIO_DIR, slug, conversation.audioFileName);
      const outputAudioDir = path.join(libraryAudioDir, slug);
      const outputAudio = path.join(outputAudioDir, conversation.audioFileName);
      await mkdir(outputAudioDir, { recursive: true });
      await copyFile(sourceAudio, outputAudio);

      const fingerprint = contentFingerprint(set.setNumber, conversation);
      const reusableConversation = reusableConversations.get(fingerprint)?.shift();
      const publishedId = uniquePublishedId(reusableConversation?.id ?? fallbackPublishedId(set.setNumber, fingerprint), usedIds);
      usedIds.add(publishedId);

      conversations.push({
        id: publishedId,
        level: set.setNumber,
        title: conversation.title,
        scene: conversation.scene,
        sampleContext: conversation.sampleContext,
        audioUrl: `library/audio/${encodeURIComponent(slug)}/${encodeURIComponent(conversation.audioFileName)}`,
        text: conversation.text,
        englishTranslation: conversation.englishTranslation,
        listeningQuestions: conversation.listeningQuestions,
        answerKey: conversation.answerKey,
        vocabularyUsed: conversation.vocabularyUsed,
        createdAt: conversation.curatedAt ?? conversation.createdAt,
        publishOrder: reusableConversation?.order ?? nextNewConversationOrder++
      });
    }
  }

  conversations.sort((a, b) => a.publishOrder - b.publishOrder || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  const manifest: StaticLibraryManifest = {
    version: 2,
    generatedAt: curatedUpdatedAt(sets),
    conversations: conversations.map(({ publishOrder: _publishOrder, ...conversation }) => conversation)
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    ...(await getPracticeLibraryPublishStatus()),
    manifest
  };
}
