import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CuratedSet } from '../shared/types.ts';
import type { StaticLibraryConversation, StaticLibraryManifest } from '../src/consumer/types.ts';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const curatedSetsDir = path.join(rootDir, 'curated', 'sets');
const curatedAudioDir = path.join(rootDir, 'curated', 'audio');
const libraryDir = path.join(rootDir, 'public', 'library');
const libraryAudioDir = path.join(libraryDir, 'audio');
const manifestPath = path.join(libraryDir, 'library.json');

function setSlug(setNumber: number): string {
  return `set-${String(setNumber).padStart(2, '0')}`;
}

function latestTimestamp(values: Array<string | undefined>): string {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => b.localeCompare(a))[0] ?? '';
}

async function readCuratedSets(): Promise<CuratedSet[]> {
  const entries = await readdir(curatedSetsDir, { withFileTypes: true }).catch(() => []);
  const sets = await Promise.all(entries
    .filter((entry) => entry.isFile() && /^set-\d+\.json$/i.test(entry.name))
    .map(async (entry) => {
      try {
        const raw = await readFile(path.join(curatedSetsDir, entry.name), 'utf8');
        return JSON.parse(raw) as CuratedSet;
      } catch {
        return null;
      }
    }));

  return sets
    .filter((set): set is CuratedSet => Boolean(set))
    .sort((a, b) => a.setNumber - b.setNumber);
}

async function buildLibrary(): Promise<void> {
  const sets = await readCuratedSets();
  const conversations: StaticLibraryConversation[] = [];

  await mkdir(libraryDir, { recursive: true });
  await rm(libraryAudioDir, { recursive: true, force: true });
  await mkdir(libraryAudioDir, { recursive: true });

  for (const set of sets) {
    const slug = setSlug(set.setNumber);
    for (const conversation of set.conversations) {
      if (conversation.status !== 'audio_ready' || !conversation.audioFileName) {
        continue;
      }

      const sourceAudio = path.join(curatedAudioDir, slug, conversation.audioFileName);
      const outputAudioDir = path.join(libraryAudioDir, slug);
      const outputAudio = path.join(outputAudioDir, conversation.audioFileName);
      await mkdir(outputAudioDir, { recursive: true });
      await copyFile(sourceAudio, outputAudio);

      conversations.push({
        id: conversation.id,
        level: set.setNumber,
        title: conversation.title,
        scene: conversation.scene,
        sampleContext: conversation.sampleContext,
        audioUrl: `library/audio/${encodeURIComponent(slug)}/${encodeURIComponent(conversation.audioFileName)}`,
        text: conversation.text,
        englishTranslation: conversation.englishTranslation,
        listeningQuestions: conversation.listeningQuestions,
        answerKey: conversation.answerKey,
        createdAt: conversation.curatedAt ?? conversation.createdAt
      });
    }
  }

  conversations.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  const manifest: StaticLibraryManifest = {
    version: 1,
    generatedAt: latestTimestamp(sets.flatMap((set) => [
      set.updatedAt,
      ...set.conversations.map((conversation) => conversation.curatedAt ?? conversation.updatedAt ?? conversation.createdAt)
    ])),
    conversations
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Published ${conversations.length} conversations to ${path.relative(rootDir, manifestPath)}.`);
}

await buildLibrary();
