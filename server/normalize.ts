import type {
  DeclaredNonVocabularyCategory,
  DeclaredNonVocabularyKind,
  DeclaredNonVocabularyTerm,
  EnglishLine,
  PracticeConversation,
  ConversationVocabularyReference,
  ConversationLine
} from '../shared/types.ts';

type UnknownRecord = Record<string, unknown>;

function nowIso(): string {
  return new Date().toISOString();
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? (value as UnknownRecord) : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => asString(item)).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeVocabularyReferences(value: unknown): ConversationVocabularyReference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const kind = record.kind === 'future_set' || record.kind === 'external' ? record.kind : null;
    const source = record.source === 'master_vocabulary' || record.source === 'supplemental_catalog' ? record.source : null;
    const japanese = asString(record.japanese);
    const surface = asString(record.surface);
    const reading = asString(record.reading);
    const meaning = asString(record.meaning);
    if (!kind || !source || !japanese || !surface || !reading || !meaning) return [];
    return [{
      version: 1,
      surface,
      japanese,
      reading,
      meaning,
      kind,
      source,
      setNumber: Number.isInteger(record.setNumber) ? record.setNumber as number : undefined,
      partOfSpeech: asString(record.partOfSpeech) || undefined,
      category: asString(record.category) || undefined
    } satisfies ConversationVocabularyReference];
  });
}

const DECLARED_NON_VOCABULARY_KINDS = new Set<DeclaredNonVocabularyKind>(['proper_noun', 'cultural_reference']);
const DECLARED_NON_VOCABULARY_CATEGORIES = new Set<DeclaredNonVocabularyCategory>([
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

function normalizeDeclaredKind(value: unknown, fallback: DeclaredNonVocabularyKind): DeclaredNonVocabularyKind {
  const normalized = asString(value).toLowerCase().replace(/[\s-]+/g, '_');
  return DECLARED_NON_VOCABULARY_KINDS.has(normalized as DeclaredNonVocabularyKind)
    ? normalized as DeclaredNonVocabularyKind
    : fallback;
}

function normalizeDeclaredCategory(value: unknown, fallback: DeclaredNonVocabularyCategory): DeclaredNonVocabularyCategory {
  const normalized = asString(value).toLowerCase().replace(/[\s-]+/g, '_');
  return DECLARED_NON_VOCABULARY_CATEGORIES.has(normalized as DeclaredNonVocabularyCategory)
    ? normalized as DeclaredNonVocabularyCategory
    : fallback;
}

function normalizeDeclaredTerm(value: unknown, fallbackKind: DeclaredNonVocabularyKind): DeclaredNonVocabularyTerm | null {
  const record = asRecord(value);
  const surface = asString(record.surface ?? record.japanese ?? record.term ?? record.word ?? record.name);
  if (!surface) return null;
  const kind = normalizeDeclaredKind(record.kind ?? record.type, fallbackKind);
  const defaultCategory: DeclaredNonVocabularyCategory = kind === 'proper_noun' ? 'person' : 'cultural_item';
  return {
    surface,
    reading: asString(record.reading) || undefined,
    kind,
    category: normalizeDeclaredCategory(record.category, defaultCategory),
    rationale: asString(record.rationale ?? record.reason ?? record.note) || undefined
  };
}

function normalizeDeclaredTerms(value: unknown, fallbackKind: DeclaredNonVocabularyKind): DeclaredNonVocabularyTerm[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeDeclaredTerm(item, fallbackKind))
    .filter((item): item is DeclaredNonVocabularyTerm => Boolean(item));
}

function normalizeSpeaker(value: unknown): 'Speaker 1' | 'Speaker 2' {
  return asString(value).includes('2') ? 'Speaker 2' : 'Speaker 1';
}

function normalizeLine(value: unknown): ConversationLine | null {
  const record = asRecord(value);
  const japanese = asString(record.japanese ?? record.text ?? record.line);
  if (!japanese) return null;

  const tags = asStringArray(record.tags).map((tag) => tag.replace(/^\[|\]$/g, '').trim()).filter(Boolean);
  const finalTags = tags.length ? tags : ['slow'];
  if (finalTags[finalTags.length - 1]?.toLowerCase() !== 'slow') {
    finalTags.push('slow');
  }

  return {
    speaker: normalizeSpeaker(record.speaker),
    tags: finalTags,
    japanese
  };
}

function normalizeEnglishLine(value: unknown): EnglishLine | null {
  const record = asRecord(value);
  const english = asString(record.english ?? record.translation ?? record.text);
  if (!english) return null;
  return {
    speaker: normalizeSpeaker(record.speaker),
    english
  };
}

export function normalizeGeneratedConversations(payload: unknown, expectedCount: number): PracticeConversation[] {
  const record = asRecord(payload);
  const source = Array.isArray(record.conversations) ? record.conversations : Array.isArray(payload) ? payload : [];
  const timestamp = nowIso();

  return source.slice(0, expectedCount).map((item, index) => {
    const conversation = asRecord(item);
    const text = Array.isArray(conversation.text)
      ? conversation.text.map(normalizeLine).filter((line): line is ConversationLine => Boolean(line))
      : [];
    const englishTranslation = Array.isArray(conversation.englishTranslation)
      ? conversation.englishTranslation.map(normalizeEnglishLine).filter((line): line is EnglishLine => Boolean(line))
      : [];
    const declaredNonVocabularyTerms = [
      ...normalizeDeclaredTerms(conversation.declaredNonVocabularyTerms ?? conversation.declared_non_vocabulary_terms, 'cultural_reference'),
      ...normalizeDeclaredTerms(conversation.properNouns ?? conversation.proper_nouns, 'proper_noun'),
      ...normalizeDeclaredTerms(conversation.culturalReferences ?? conversation.cultural_references, 'cultural_reference')
    ];

    return {
      id: `convo-${String(index + 1).padStart(2, '0')}`,
      number: index + 1,
      title: asString(conversation.title, `Conversation ${index + 1}`),
      scene: asString(conversation.scene),
      sampleContext: asString(conversation.sampleContext ?? conversation.sample_context),
      text,
      listeningQuestions: asStringArray(conversation.listeningQuestions ?? conversation.listening_questions),
      answerKey: asStringArray(conversation.answerKey ?? conversation.answer_key),
      englishTranslation,
      declaredNonVocabularyTerms,
      vocabularyUsed: asStringArray(conversation.vocabularyUsed ?? conversation.vocabulary_used),
      outOfVocabularyAudit: asStringArray(conversation.outOfVocabularyAudit ?? conversation.out_of_vocabulary_audit),
      vocabularyReferences: normalizeVocabularyReferences(conversation.vocabularyReferences ?? conversation.vocabulary_references),
      simplerReplacementSuggestions: asStringArray(conversation.simplerReplacementSuggestions ?? conversation.simpler_replacement_suggestions),
      status: 'draft',
      createdAt: timestamp,
      updatedAt: timestamp
    };
  });
}

export function parseTranscriptText(transcript: string): ConversationLine[] {
  return transcript
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(Speaker\s*[12])\s*:\s*\[([^\]]+)\]\s*(.+)$/i.exec(line);
      if (!match) return null;
      const tags = match[2].split(',').map((tag) => tag.trim()).filter(Boolean);
      if (tags[tags.length - 1]?.toLowerCase() !== 'slow') tags.push('slow');
      return {
        speaker: match[1].includes('2') ? 'Speaker 2' : 'Speaker 1',
        tags,
        japanese: match[3].trim()
      } satisfies ConversationLine;
    })
    .filter((line): line is ConversationLine => Boolean(line));
}
