import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PracticeRun } from '../shared/types.ts';
import type { StaticLibraryConversation, StaticLibraryManifest } from '../src/consumer/types.ts';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runsDir = path.join(rootDir, 'outputs', 'runs');
const libraryDir = path.join(rootDir, 'public', 'library');
const libraryAudioDir = path.join(libraryDir, 'audio');
const manifestPath = path.join(libraryDir, 'library.json');

async function readRuns(): Promise<PracticeRun[]> {
  const entries = await readdir(runsDir, { withFileTypes: true }).catch(() => []);
  const runs = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => {
      try {
        const raw = await readFile(path.join(runsDir, entry.name, 'run.json'), 'utf8');
        return JSON.parse(raw) as PracticeRun;
      } catch {
        return null;
      }
    }));

  return runs.filter((run): run is PracticeRun => Boolean(run));
}

async function buildLibrary(): Promise<void> {
  const runs = await readRuns();
  const conversations: StaticLibraryConversation[] = [];

  await mkdir(libraryDir, { recursive: true });
  await rm(libraryAudioDir, { recursive: true, force: true });
  await mkdir(libraryAudioDir, { recursive: true });

  for (const run of runs) {
    for (const conversation of run.conversations) {
      if (conversation.status !== 'audio_ready' || !conversation.audioFileName) {
        continue;
      }

      const sourceAudio = path.join(runsDir, run.id, 'audio', conversation.audioFileName);
      const outputAudioDir = path.join(libraryAudioDir, run.id);
      const outputAudio = path.join(outputAudioDir, conversation.audioFileName);
      await mkdir(outputAudioDir, { recursive: true });
      await copyFile(sourceAudio, outputAudio);

      conversations.push({
        id: `${run.id}:${conversation.id}`,
        level: run.setNumber,
        title: conversation.title,
        scene: conversation.scene,
        sampleContext: conversation.sampleContext,
        audioUrl: `library/audio/${encodeURIComponent(run.id)}/${encodeURIComponent(conversation.audioFileName)}`,
        text: conversation.text,
        englishTranslation: conversation.englishTranslation,
        listeningQuestions: conversation.listeningQuestions,
        answerKey: conversation.answerKey,
        createdAt: conversation.createdAt
      });
    }
  }

  conversations.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  const manifest: StaticLibraryManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    conversations
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Published ${conversations.length} conversations to ${path.relative(rootDir, manifestPath)}.`);
}

await buildLibrary();
