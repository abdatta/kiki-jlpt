import { readFile } from 'node:fs/promises';
import { PROMPT_PATH } from './paths.ts';
import { formatVocabForPrompt } from './vocab.ts';
import type { VocabItem } from '../shared/types.ts';

export async function buildGenerationPrompt(setNumber: number, conversationCount: number, allowedVocabulary: VocabItem[]): Promise<string> {
  const template = await readFile(PROMPT_PATH, 'utf8');

  return template
    .replaceAll('{{setNumber}}', String(setNumber))
    .replaceAll('{{conversationCount}}', String(conversationCount))
    .replaceAll('{{allowedVocabularyCount}}', String(allowedVocabulary.length))
    .replaceAll('{{allowedVocabularyTable}}', formatVocabForPrompt(allowedVocabulary));
}
