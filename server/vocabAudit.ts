import path from 'node:path';
import * as kuromojiModule from 'kuromoji';
import type { IpadicFeatures, Tokenizer } from 'kuromoji';
import type { ConversationCurationEvidence, ConversationCurationEvidenceMap, PracticeConversation, VocabItem } from '../shared/types.ts';
import { ROOT_DIR } from './paths.ts';
import { CURATION_EVIDENCE_VERSION, isAuditExemptForm } from './languagePolicy.ts';

type JapaneseTokenizer = Tokenizer<IpadicFeatures>;

interface VocabPattern {
  item: VocabItem;
  formsByToken: string[][];
}

interface MatchResult {
  usedWords: Set<string>;
  coveredTokenIndexes: Set<number>;
  wordOccurrences: Map<string, number>;
}

export interface ConversationVocabularyAnalysis {
  conversations: PracticeConversation[];
  evidenceByConversationId: ConversationCurationEvidenceMap;
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

function katakanaToHiragana(value: string): string {
  return value.replace(/[\u30a1-\u30f6]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60));
}

function normalizeForm(value: string): string {
  return katakanaToHiragana(value.trim());
}

function isPatternMarker(value: string): boolean {
  return /^[\u301c\uff5e~]+$/.test(value);
}

function tokenForms(token: IpadicFeatures): string[] {
  const forms = [cleanForm(token.surface_form), cleanForm(token.basic_form), cleanForm(token.reading)]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => [value, normalizeForm(value)]);
  return [...new Set(forms)];
}

function isContentToken(token: IpadicFeatures): boolean {
  const nonContentPos = ['\u52a9\u8a5e', '\u52a9\u52d5\u8a5e', '\u8a18\u53f7', '\u63a5\u982d\u8a5e', '\u30d5\u30a3\u30e9\u30fc'];
  const nonContentNounDetails = ['\u56fa\u6709\u540d\u8a5e', '\u63a5\u5c3e', '\u975e\u81ea\u7acb'];
  const contentPos = ['\u540d\u8a5e', '\u52d5\u8a5e', '\u5f62\u5bb9\u8a5e', '\u526f\u8a5e', '\u9023\u4f53\u8a5e', '\u63a5\u7d9a\u8a5e', '\u611f\u52d5\u8a5e'];

  if (nonContentPos.includes(token.pos)) return false;
  if (token.pos === '\u540d\u8a5e' && nonContentNounDetails.includes(token.pos_detail_1)) return false;
  return contentPos.includes(token.pos);
}

function auditWordForToken(token: IpadicFeatures): string {
  return cleanForm(token.basic_form) ?? token.surface_form;
}

function uniqueSorted(words: Iterable<string>): string[] {
  return [...new Set([...words].map((word) => word.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
}

function vocabCandidates(item: VocabItem): string[] {
  return [...new Set([item.japanese, item.reading]
    .flatMap((value) => value.split(/[;；、,]/))
    .map((value) => value.trim())
    .filter(Boolean))];
}

function buildPatterns(tokenizer: JapaneseTokenizer, allowedVocabulary: VocabItem[]): VocabPattern[] {
  return allowedVocabulary
    .flatMap((item) => vocabCandidates(item)
      .map((candidate) => ({
        item,
        formsByToken: tokenizer
          .tokenize(candidate)
          .map(tokenForms)
          .filter((forms) => forms.length > 0 && !forms.every(isPatternMarker))
      }))
      .filter((pattern) => pattern.formsByToken.length > 0))
    .sort((a, b) => b.formsByToken.length - a.formsByToken.length || b.item.japanese.length - a.item.japanese.length);
}

function tokenMatchesForms(token: IpadicFeatures, allowedForms: string[]): boolean {
  const forms = tokenForms(token);
  return forms.some((form) => allowedForms.includes(form));
}

function findVocabularyMatches(tokens: IpadicFeatures[], patterns: VocabPattern[]): MatchResult {
  const usedWords = new Set<string>();
  const coveredTokenIndexes = new Set<number>();
  const wordOccurrences = new Map<string, number>();
  const countedMatches = new Set<string>();

  for (const pattern of patterns) {
    const length = pattern.formsByToken.length;
    for (let start = 0; start <= tokens.length - length; start += 1) {
      const matches = pattern.formsByToken.every((forms, offset) => tokenMatchesForms(tokens[start + offset], forms));
      if (!matches) continue;

      usedWords.add(pattern.item.japanese);
      const matchKey = `${pattern.item.japanese}\u0000${start}\u0000${length}`;
      if (!countedMatches.has(matchKey)) {
        countedMatches.add(matchKey);
        wordOccurrences.set(pattern.item.japanese, (wordOccurrences.get(pattern.item.japanese) ?? 0) + 1);
      }
      for (let offset = 0; offset < length; offset += 1) {
        coveredTokenIndexes.add(start + offset);
      }
    }
  }

  return { usedWords, coveredTokenIndexes, wordOccurrences };
}

function buildAllowedFormSet(tokenizer: JapaneseTokenizer, allowedVocabulary: VocabItem[]): Set<string> {
  return new Set(allowedVocabulary.flatMap((item) => vocabCandidates(item).flatMap((candidate) => tokenizer.tokenize(candidate).flatMap(tokenForms))));
}

function uniqueVocabularyWords(vocabulary: VocabItem[]): string[] {
  return uniqueSorted(vocabulary.map((item) => item.japanese));
}

function occurrenceRecord(counts: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b, 'ja')));
}

function auditConversation(
  tokenizer: JapaneseTokenizer,
  patterns: VocabPattern[],
  allowedForms: Set<string>,
  allowedVocabulary: VocabItem[],
  setNumber: number,
  conversation: PracticeConversation
): { conversation: PracticeConversation; evidence: ConversationCurationEvidence } {
  const tokens = conversation.text.flatMap((line) => tokenizer.tokenize(line.japanese));
  const { usedWords, coveredTokenIndexes, wordOccurrences } = findVocabularyMatches(tokens, patterns);
  const outOfVocabularyOccurrences = new Map<string, number>();

  tokens.forEach((token, index) => {
    if (!isContentToken(token)) return;
    if (coveredTokenIndexes.has(index)) return;
    if (tokenForms(token).some((form) => allowedForms.has(form))) return;
    if (isAuditExemptForm(tokenForms(token))) return;
    const word = auditWordForToken(token);
    outOfVocabularyOccurrences.set(word, (outOfVocabularyOccurrences.get(word) ?? 0) + 1);
  });

  const auditedConversation = {
    ...conversation,
    vocabularyUsed: uniqueSorted(usedWords),
    outOfVocabularyAudit: uniqueSorted(outOfVocabularyOccurrences.keys()),
    simplerReplacementSuggestions: []
  };

  const currentSetWords = new Set(uniqueVocabularyWords(allowedVocabulary.filter((item) => item.set === setNumber)));
  const allowedWords = uniqueVocabularyWords(allowedVocabulary);
  const currentSetUniqueWords = uniqueSorted([...usedWords].filter((word) => currentSetWords.has(word)));
  const allowedVocabUniqueWords = uniqueSorted([...usedWords].filter((word) => allowedWords.includes(word)));
  const outOfVocabularyUniqueWords = uniqueSorted(outOfVocabularyOccurrences.keys());

  return {
    conversation: auditedConversation,
    evidence: {
      evidenceVersion: CURATION_EVIDENCE_VERSION,
      setNumber,
      currentSetTotal: currentSetWords.size,
      currentSetUniqueCount: currentSetUniqueWords.length,
      currentSetUniqueWords,
      allowedVocabTotal: allowedWords.length,
      allowedVocabUniqueCount: allowedVocabUniqueWords.length,
      allowedVocabUniqueWords,
      vocabularyOccurrences: occurrenceRecord(wordOccurrences),
      outOfVocabularyUniqueCount: outOfVocabularyUniqueWords.length,
      outOfVocabularyUniqueWords,
      outOfVocabularyOccurrenceCount: [...outOfVocabularyOccurrences.values()].reduce((total, count) => total + count, 0)
    }
  };
}

export async function analyzeConversationsWithVocabulary(
  setNumber: number,
  allowedVocabulary: VocabItem[],
  conversations: PracticeConversation[]
): Promise<ConversationVocabularyAnalysis> {
  const tokenizer = await getTokenizer();
  const patterns = buildPatterns(tokenizer, allowedVocabulary);
  const allowedForms = buildAllowedFormSet(tokenizer, allowedVocabulary);
  const results = conversations.map((conversation) => auditConversation(
    tokenizer,
    patterns,
    allowedForms,
    allowedVocabulary,
    setNumber,
    conversation
  ));

  return {
    conversations: results.map((result) => result.conversation),
    evidenceByConversationId: Object.fromEntries(results.map((result) => [result.conversation.id, result.evidence]))
  };
}

export async function auditConversationsWithVocabulary(
  allowedVocabulary: VocabItem[],
  conversations: PracticeConversation[]
): Promise<PracticeConversation[]> {
  const setNumber = Math.max(0, ...allowedVocabulary.map((item) => item.set));
  return (await analyzeConversationsWithVocabulary(setNumber, allowedVocabulary, conversations)).conversations;
}
