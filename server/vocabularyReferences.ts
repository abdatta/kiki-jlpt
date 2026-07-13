import catalogJson from './supplementalVocabulary.json' with { type: 'json' };
import type {
  ConversationVocabularyReference,
  ConversationVocabularyValidationFailure,
  PracticeConversation,
  VocabItem
} from '../shared/types.ts';
import { CONVERSATION_VOCABULARY_REFERENCE_VERSION } from '../shared/types.ts';

export interface SupplementalVocabularyEntry {
  japanese: string;
  aliases?: string[];
  reading: string;
  meaning: string;
  partOfSpeech?: string;
  category?: string;
}

export interface SupplementalVocabularyCatalog {
  version: number;
  entries: SupplementalVocabularyEntry[];
}

export interface VocabularyReferenceResolution {
  references: ConversationVocabularyReference[];
  unresolved: string[];
  discarded: string[];
}

const catalog = catalogJson as SupplementalVocabularyCatalog;
export const VOCABULARY_REFERENCE_RESOLVER_VERSION = `2:${JSON.stringify(catalog)}`;
const REVIEWED_FUTURE_ALIASES: Record<string, string> = {
  'すぐ': 'すぐに',
  'ゆっくり': 'ゆっくりと'
};
const lexicalJapanese = /^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}々〆ヶー]+$/u;
const kanaOnly = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u;

export function isLearnerVisibleVocabularyCandidate(value: string): boolean {
  const surface = normalized(value);
  return Boolean(surface && lexicalJapanese.test(surface) && /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}々〆ヶ]/u.test(surface));
}

function normalized(value: string): string {
  return value.normalize('NFKC').trim();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function complete(reference: ConversationVocabularyReference): boolean {
  return Boolean(reference.japanese.trim() && reference.reading.trim() && reference.meaning.trim());
}

export function resolveVocabularyReferences(
  surfaces: string[],
  conversationSet: number,
  vocabulary: VocabItem[],
  supplemental: SupplementalVocabularyCatalog = catalog
): VocabularyReferenceResolution {
  const exactCourse = new Map(vocabulary.map((item) => [normalized(item.japanese), item]));
  const courseByReading = new Map<string, VocabItem[]>();
  for (const item of vocabulary) {
    const key = normalized(item.reading);
    courseByReading.set(key, [...(courseByReading.get(key) ?? []), item]);
  }
  const supplementalByForm = new Map<string, SupplementalVocabularyEntry>();
  for (const entry of supplemental.entries) {
    for (const form of [entry.japanese, ...(entry.aliases ?? [])]) {
      supplementalByForm.set(normalized(form), entry);
    }
  }

  const references: ConversationVocabularyReference[] = [];
  const unresolved: string[] = [];
  const discarded: string[] = [];
  const seenCanonical = new Set<string>();

  for (const rawSurface of unique(surfaces)) {
    const surface = normalized(rawSurface);
    if (!isLearnerVisibleVocabularyCandidate(surface)) {
      discarded.push(rawSurface);
      continue;
    }
    let course = exactCourse.get(surface) ?? exactCourse.get(REVIEWED_FUTURE_ALIASES[surface] ?? '');
    if (!course && kanaOnly.test(surface)) {
      const readingMatches = courseByReading.get(surface) ?? [];
      if (readingMatches.length === 1) course = readingMatches[0];
    }

    let reference: ConversationVocabularyReference | null = null;
    if (course && course.set > conversationSet) {
      reference = {
        version: CONVERSATION_VOCABULARY_REFERENCE_VERSION,
        surface,
        japanese: course.japanese,
        reading: course.reading,
        meaning: course.meaning,
        kind: 'future_set',
        source: 'master_vocabulary',
        setNumber: course.set,
        partOfSpeech: course.partOfSpeech || undefined,
        category: course.category || undefined
      };
    } else if (!course) {
      const entry = supplementalByForm.get(surface);
      if (entry) {
        reference = {
          version: CONVERSATION_VOCABULARY_REFERENCE_VERSION,
          surface,
          japanese: entry.japanese,
          reading: entry.reading,
          meaning: entry.meaning,
          kind: 'external',
          source: 'supplemental_catalog',
          partOfSpeech: entry.partOfSpeech,
          category: entry.category
        };
      }
    }

    if (!reference || !complete(reference)) {
      unresolved.push(surface);
      continue;
    }
    if (seenCanonical.has(reference.japanese)) continue;
    seenCanonical.add(reference.japanese);
    references.push(reference);
  }

  references.sort((a, b) => (a.setNumber ?? Number.MAX_SAFE_INTEGER) - (b.setNumber ?? Number.MAX_SAFE_INTEGER)
    || a.japanese.localeCompare(b.japanese, 'ja'));
  return { references, unresolved: unique(unresolved), discarded: unique(discarded) };
}

export function validateConversationVocabularyReferences(
  conversation: Pick<PracticeConversation, 'id' | 'outOfVocabularyAudit' | 'vocabularyReferences'>
): ConversationVocabularyValidationFailure[] {
  const resolvedSurfaces = new Set((conversation.vocabularyReferences ?? []).map((item) => item.surface));
  const failures: ConversationVocabularyValidationFailure[] = conversation.outOfVocabularyAudit
    .filter((surface) => isLearnerVisibleVocabularyCandidate(surface) && !resolvedSurfaces.has(surface))
    .map((surface) => ({ conversationId: conversation.id, surface, reason: 'unresolved' as const }));
  for (const reference of conversation.vocabularyReferences ?? []) {
    if (!complete(reference)) failures.push({ conversationId: conversation.id, surface: reference.surface, reason: 'incomplete_metadata' });
  }
  return failures;
}
