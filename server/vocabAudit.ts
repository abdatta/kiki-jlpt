import { createHash } from 'node:crypto';
import path from 'node:path';
import * as kuromojiModule from 'kuromoji';
import type { IpadicFeatures, Tokenizer } from 'kuromoji';
import type {
  ConversationCurationEvidence,
  ConversationCurationEvidenceMap,
  DeclaredNonVocabularyCategory,
  DeclaredNonVocabularyTerm,
  PracticeConversation,
  VocabItem,
  VocabularyAuditExemption,
  VocabularyAuditRejectedDeclaration
} from '../shared/types.ts';
import { ROOT_DIR } from './paths.ts';
import { APPROVED_GENERATED_NAMES, CURATION_EVIDENCE_VERSION, isAuditExemptForm } from './languagePolicy.ts';

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

function findVocabularyMatches(tokenFormSets: Set<string>[], patterns: VocabPattern[]): MatchResult {
  const usedWords = new Set<string>();
  const coveredTokenIndexes = new Set<number>();
  const wordOccurrences = new Map<string, number>();
  const countedMatches = new Set<string>();

  for (const pattern of patterns) {
    const length = pattern.formsByToken.length;
    for (let start = 0; start <= tokenFormSets.length - length; start += 1) {
      const matches = pattern.formsByToken.every((forms, offset) => forms.some((form) => tokenFormSets[start + offset].has(form)));
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

// Analysis is pure over (vocabulary content, set number, conversation text), and the same
// conversations are re-analyzed constantly: every snapshot rebuild re-reads every run, and
// every conversation update re-audits its whole run. Both caches are content-keyed, so they
// self-invalidate when text or vocabulary actually changes and stay correct for tests that
// pass synthetic vocabularies.
interface VocabularyArtifacts {
  patterns: VocabPattern[];
  allowedForms: Set<string>;
  knownVocabularyWords: Set<string>;
}

const vocabularyArtifactsCache = new Map<string, VocabularyArtifacts>();
const MAX_VOCABULARY_ARTIFACT_ENTRIES = 8;

interface CachedConversationAudit {
  vocabularyUsed: string[];
  outOfVocabularyAudit: string[];
  evidence: ConversationCurationEvidence;
}

const conversationAuditCache = new Map<string, CachedConversationAudit>();
const MAX_CONVERSATION_AUDIT_ENTRIES = 4000;

function vocabularyContentKey(allowedVocabulary: VocabItem[], knownVocabulary: VocabItem[] = allowedVocabulary): string {
  return createHash('sha256')
    .update(JSON.stringify({
      allowed: allowedVocabulary.map((item) => [item.set, item.japanese, item.reading]),
      known: knownVocabulary.map((item) => [item.set, item.japanese, item.reading])
    }))
    .digest('hex');
}

function getVocabularyArtifacts(tokenizer: JapaneseTokenizer, allowedVocabulary: VocabItem[], knownVocabulary: VocabItem[], vocabularyKey: string): VocabularyArtifacts {
  const cached = vocabularyArtifactsCache.get(vocabularyKey);
  if (cached) return cached;

  const artifacts = {
    patterns: buildPatterns(tokenizer, allowedVocabulary),
    allowedForms: buildAllowedFormSet(tokenizer, allowedVocabulary),
    knownVocabularyWords: new Set(knownVocabulary.map((item) => item.japanese))
  };
  while (vocabularyArtifactsCache.size >= MAX_VOCABULARY_ARTIFACT_ENTRIES) {
    vocabularyArtifactsCache.delete(vocabularyArtifactsCache.keys().next().value!);
  }
  vocabularyArtifactsCache.set(vocabularyKey, artifacts);
  return artifacts;
}

const HONORIFIC_SUFFIXES = ['さん'];
const DECLARED_TERM_CATEGORIES = new Set<DeclaredNonVocabularyCategory>([
  'person',
  'place',
  'city',
  'region',
  'landmark',
  'institution',
  'event',
  'work_title',
  'brand',
  'food',
  'cultural_item'
]);
const PROPER_LIKE_CATEGORIES = new Set<DeclaredNonVocabularyCategory>([
  'person',
  'place',
  'city',
  'region',
  'landmark',
  'institution',
  'event',
  'work_title',
  'brand'
]);

function isApprovedNameSurface(forms: string[]): boolean {
  return forms.some((form) => (
    APPROVED_GENERATED_NAMES.some((name) => (
      form === name || HONORIFIC_SUFFIXES.some((suffix) => form === `${name}${suffix}`)
    ))
  ));
}

function findSurfaceTokenIndexes(tokens: IpadicFeatures[], surface: string): number[] {
  for (let start = 0; start < tokens.length; start += 1) {
    let value = '';
    for (let end = start; end < tokens.length && value.length < surface.length; end += 1) {
      value += tokens[end].surface_form;
      if (value === surface) {
        return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
      }
    }
  }
  return [];
}

function declarationRejection(term: DeclaredNonVocabularyTerm, reason: string): VocabularyAuditRejectedDeclaration {
  return {
    surface: term.surface,
    kind: term.kind,
    category: term.category,
    reason
  };
}

function validateDeclaredTerm(
  term: DeclaredNonVocabularyTerm,
  tokens: IpadicFeatures[],
  knownVocabularyWords: Set<string>
): { indexes: number[]; exemption: VocabularyAuditExemption } | { rejection: VocabularyAuditRejectedDeclaration } {
  const surface = term.surface.trim();
  if (!surface) return { rejection: declarationRejection(term, 'empty declaration') };
  if (!DECLARED_TERM_CATEGORIES.has(term.category)) return { rejection: declarationRejection(term, 'unsupported category') };

  const indexes = findSurfaceTokenIndexes(tokens, surface);
  if (!indexes.length) return { rejection: declarationRejection(term, 'declared term does not appear in Japanese text') };

  const termTokens = indexes.map((index) => tokens[index]);
  if (termTokens.some((token) => ['動詞', '形容詞', '副詞'].includes(token.pos))) {
    return { rejection: declarationRejection(term, 'ordinary verb, adjective, or adverb cannot be declared as a proper noun or cultural reference') };
  }
  if (term.kind === 'proper_noun' && !PROPER_LIKE_CATEGORIES.has(term.category)) {
    return { rejection: declarationRejection(term, 'proper noun declaration uses a non-proper category') };
  }
  if (knownVocabularyWords.has(surface) && term.category === 'cultural_item') {
    return { rejection: declarationRejection(term, 'known vocabulary word needs a more specific cultural category to be exempt') };
  }

  return {
    indexes,
    exemption: {
      surface,
      kind: term.kind === 'proper_noun' ? 'proper_noun' : 'cultural_reference',
      category: term.category,
      rationale: term.rationale
    }
  };
}

function uniqueExemptions(exemptions: VocabularyAuditExemption[]): VocabularyAuditExemption[] {
  const seen = new Set<string>();
  return exemptions.filter((item) => {
    const key = `${item.kind}:${item.category ?? ''}:${item.surface}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.surface.localeCompare(b.surface, 'ja') || a.kind.localeCompare(b.kind));
}

function uniqueRejections(rejections: VocabularyAuditRejectedDeclaration[]): VocabularyAuditRejectedDeclaration[] {
  const seen = new Set<string>();
  return rejections.filter((item) => {
    const key = `${item.kind}:${item.category}:${item.surface}:${item.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.surface.localeCompare(b.surface, 'ja') || a.reason.localeCompare(b.reason));
}

function auditConversation(
  tokenizer: JapaneseTokenizer,
  patterns: VocabPattern[],
  allowedForms: Set<string>,
  knownVocabularyWords: Set<string>,
  allowedVocabulary: VocabItem[],
  setNumber: number,
  conversation: PracticeConversation,
  auditCachePrefix: string
): { conversation: PracticeConversation; evidence: ConversationCurationEvidence } {
  const auditKey = createHash('sha256')
    .update(auditCachePrefix)
    .update(JSON.stringify(conversation.text.map((line) => line.japanese)))
    .update(JSON.stringify(conversation.declaredNonVocabularyTerms ?? []))
    .digest('hex');
  const cached = conversationAuditCache.get(auditKey);
  if (cached) {
    // Refresh recency so hot conversations survive eviction.
    conversationAuditCache.delete(auditKey);
    conversationAuditCache.set(auditKey, cached);
    return {
      conversation: {
        ...conversation,
        vocabularyUsed: cached.vocabularyUsed,
        outOfVocabularyAudit: cached.outOfVocabularyAudit,
        simplerReplacementSuggestions: []
      },
      evidence: cached.evidence
    };
  }

  const tokens = conversation.text.flatMap((line) => tokenizer.tokenize(line.japanese));
  const tokenFormsList = tokens.map(tokenForms);
  const { usedWords, coveredTokenIndexes, wordOccurrences } = findVocabularyMatches(
    tokenFormsList.map((forms) => new Set(forms)),
    patterns
  );
  const outOfVocabularyOccurrences = new Map<string, number>();
  const declaredCoveredTokenIndexes = new Set<number>();
  const vocabularyExemptions: VocabularyAuditExemption[] = [];
  const rejectedVocabularyDeclarations: VocabularyAuditRejectedDeclaration[] = [];

  for (const term of conversation.declaredNonVocabularyTerms ?? []) {
    const result = validateDeclaredTerm(term, tokens, knownVocabularyWords);
    if ('rejection' in result) {
      rejectedVocabularyDeclarations.push(result.rejection);
      continue;
    }
    result.indexes.forEach((index) => declaredCoveredTokenIndexes.add(index));
    vocabularyExemptions.push(result.exemption);
  }

  tokens.forEach((token, index) => {
    if (!isContentToken(token)) return;
    if (coveredTokenIndexes.has(index)) return;
    if (declaredCoveredTokenIndexes.has(index)) return;
    const forms = tokenFormsList[index];
    if (forms.some((form) => allowedForms.has(form))) return;
    if (isApprovedNameSurface(forms)) {
      vocabularyExemptions.push({ surface: token.surface_form, kind: 'approved_name', category: 'person' });
      return;
    }
    if (isAuditExemptForm(forms)) {
      vocabularyExemptions.push({ surface: token.surface_form, kind: 'language_policy' });
      return;
    }
    const word = auditWordForToken(token);
    outOfVocabularyOccurrences.set(word, (outOfVocabularyOccurrences.get(word) ?? 0) + 1);
  });

  const currentSetWords = new Set(uniqueVocabularyWords(allowedVocabulary.filter((item) => item.set === setNumber)));
  const allowedWords = uniqueVocabularyWords(allowedVocabulary);
  const currentSetUniqueWords = uniqueSorted([...usedWords].filter((word) => currentSetWords.has(word)));
  const allowedVocabUniqueWords = uniqueSorted([...usedWords].filter((word) => allowedWords.includes(word)));
  const outOfVocabularyUniqueWords = uniqueSorted(outOfVocabularyOccurrences.keys());

  const audit: CachedConversationAudit = {
    vocabularyUsed: uniqueSorted(usedWords),
    outOfVocabularyAudit: outOfVocabularyUniqueWords,
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
      outOfVocabularyOccurrenceCount: [...outOfVocabularyOccurrences.values()].reduce((total, count) => total + count, 0),
      vocabularyExemptions: uniqueExemptions(vocabularyExemptions),
      rejectedVocabularyDeclarations: uniqueRejections(rejectedVocabularyDeclarations)
    }
  };

  while (conversationAuditCache.size >= MAX_CONVERSATION_AUDIT_ENTRIES) {
    conversationAuditCache.delete(conversationAuditCache.keys().next().value!);
  }
  conversationAuditCache.set(auditKey, audit);

  return {
    conversation: {
      ...conversation,
      vocabularyUsed: audit.vocabularyUsed,
      outOfVocabularyAudit: audit.outOfVocabularyAudit,
      simplerReplacementSuggestions: []
    },
    evidence: audit.evidence
  };
}

export async function analyzeConversationsWithVocabulary(
  setNumber: number,
  allowedVocabulary: VocabItem[],
  conversations: PracticeConversation[],
  knownVocabulary: VocabItem[] = allowedVocabulary
): Promise<ConversationVocabularyAnalysis> {
  const tokenizer = await getTokenizer();
  const vocabularyKey = vocabularyContentKey(allowedVocabulary, knownVocabulary);
  const { patterns, allowedForms, knownVocabularyWords } = getVocabularyArtifacts(tokenizer, allowedVocabulary, knownVocabulary, vocabularyKey);
  const auditCachePrefix = `${CURATION_EVIDENCE_VERSION}:${setNumber}:${vocabularyKey}:`;
  const results = conversations.map((conversation) => auditConversation(
    tokenizer,
    patterns,
    allowedForms,
    knownVocabularyWords,
    allowedVocabulary,
    setNumber,
    conversation,
    auditCachePrefix
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
