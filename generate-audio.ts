import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { buildTtsPrompt, generateConversationAudio } from './server/gemini.ts';
import type { PracticeConversation } from './shared/types.ts';

function usage(): never {
  console.error('Usage: npm run tts -- --run RUN_ID --conversation path/to/conversation.json');
  console.error('The web app normally handles TTS. This helper is for one-off local regeneration.');
  process.exit(1);
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const runId = argValue('--run');
  const conversationPath = argValue('--conversation');
  const dryRun = process.argv.includes('--dry-run');

  if (!runId || !conversationPath) usage();

  const conversation = JSON.parse(await readFile(conversationPath, 'utf8')) as PracticeConversation;

  if (dryRun) {
    console.log(buildTtsPrompt(conversation));
    return;
  }

  const audio = await generateConversationAudio(runId, conversation);
  console.log(`Saved ${audio.filePath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
