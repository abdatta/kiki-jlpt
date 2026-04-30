import path from 'node:path';
import * as kuromojiModule from 'kuromoji';
import type { IpadicFeatures, Tokenizer } from 'kuromoji';
import type { PracticeConversation, VocabItem } from '../shared/types.ts';
import { ROOT_DIR } from './paths.ts';

type JapaneseTokenizer = Tokenizer<IpadicFeatures>;

interface VocabPattern {
  item: VocabItem;
  formsByToken: string[][];
}

interface MatchResult {
  usedWords: Set<string>;
  coveredTokenIndexes: Set<number>;
}

let tokenizerPromise: Promise<JapaneseTokenizer> | null = null;

function kuromojiBuilder(): typeof kuromojiModule.builder {
  const candidate = kuromojiModule as typeof kuromojiModule & { default?: typeof kuromojiModule };
  return candidate.builder ?? candidate.default?.builder;
}

function getTokenizer(): Promise<JapaneseTokenizer> {
  tokenizerPromise ??= new Promise((resolve, reject) => {
    const dicPath = path.join(ROOT_DIR, 'node_modules', 'kuromoji', 'dict');
    kuromojiBuilder()({ dicPath }).build((error, tokenizer) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(tokenizer);
    });
  });
  return tokenizerPromise;
}

function cleanForm(value: string | undefined): string | null {
  const cleaned = value?.trim();
  if (!cleaned || cleaned === '*') return null;
  return cleaned;
}

function tokenForms(token: IpadicFeatures): string[] {
  return [...new Set([cleanForm(token.surface_form), cleanForm(token.basic_form)].filter((value): value is string => Boolean(value)))];
}

function isContentToken(token: IpadicFeatures): boolean {
  if (['助詞', '助動詞', '記号', '接頭詞', 'フィラー'].includes(token.pos)) return false;
  if (token.pos === '名詞' && ['固有名詞', '接尾', '非自立'].includes(token.pos_detail_1)) return false;
  return ['名詞', '動詞', '形容詞', '副詞', '連体詞', '接続詞', '感動詞'].includes(token.pos);
}

function auditWordForToken(token: IpadicFeatures): string {
  return cleanForm(token.basic_form) ?? token.surface_form;
}

function uniqueSorted(words: Iterable<string>): string[] {
  return [...new Set([...words].map((word) => word.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
}

function buildPatterns(tokenizer: JapaneseTokenizer, allowedVocabulary: VocabItem[]): VocabPattern[] {
  return allowedVocabulary
    .map((item) => ({
      item,
      formsByToken: tokenizer.tokenize(item.japanese).map(tokenForms).filter((forms) => forms.length > 0)
    }))
    .filter((pattern) => pattern.formsByToken.length > 0)
    .sort((a, b) => b.formsByToken.length - a.formsByToken.length || b.item.japanese.length - a.item.japanese.length);
}

function tokenMatchesForms(token: IpadicFeatures, allowedForms: string[]): boolean {
  const forms = tokenForms(token);
  return forms.some((form) => allowedForms.includes(form));
}

function findVocabularyMatches(tokens: IpadicFeatures[], patterns: VocabPattern[]): MatchResult {
  const usedWords = new Set<string>();
  const coveredTokenIndexes = new Set<number>();

  for (const pattern of patterns) {
    const length = pattern.formsByToken.length;
    for (let start = 0; start <= tokens.length - length; start += 1) {
      const matches = pattern.formsByToken.every((forms, offset) => tokenMatchesForms(tokens[start + offset], forms));
      if (!matches) continue;

      usedWords.add(pattern.item.japanese);
      for (let offset = 0; offset < length; offset += 1) {
        coveredTokenIndexes.add(start + offset);
      }
    }
  }

  return { usedWords, coveredTokenIndexes };
}

function auditConversation(
  tokenizer: JapaneseTokenizer,
  patterns: VocabPattern[],
  allowedWords: Set<string>,
  conversation: PracticeConversation
): PracticeConversation {
  const tokens = conversation.text.flatMap((line) => tokenizer.tokenize(line.japanese));
  const { usedWords, coveredTokenIndexes } = findVocabularyMatches(tokens, patterns);
  const outOfVocabulary = new Set<string>();

  tokens.forEach((token, index) => {
    if (!isContentToken(token)) return;
    if (coveredTokenIndexes.has(index)) return;
    if (tokenForms(token).some((form) => allowedWords.has(form))) return;
    outOfVocabulary.add(auditWordForToken(token));
  });

  return {
    ...conversation,
    vocabularyUsed: uniqueSorted(usedWords),
    outOfVocabularyAudit: uniqueSorted(outOfVocabulary),
    simplerReplacementSuggestions: []
  };
}

export async function auditConversationsWithVocabulary(
  allowedVocabulary: VocabItem[],
  conversations: PracticeConversation[]
): Promise<PracticeConversation[]> {
  const tokenizer = await getTokenizer();
  const patterns = buildPatterns(tokenizer, allowedVocabulary);
  const allowedWords = new Set(allowedVocabulary.map((item) => item.japanese));
  return conversations.map((conversation) => auditConversation(tokenizer, patterns, allowedWords, conversation));
}
