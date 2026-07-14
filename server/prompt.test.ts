import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConversationCurationEvidenceMap, ConversationQualityVerdict, LibraryBalancePlan, PracticeConversation, VocabItem } from '../shared/types.ts';
import type { AiCurationLibraryContext } from './aiCuration.ts';
import {
  buildAiLibraryBalancePrompt,
  buildBalancedRepairPrompt,
  buildGenerationPrompt,
  buildLibraryComplementPrompt,
  buildPickerPrompt,
  buildQualityTriagePrompt
} from './prompt.ts';

const vocabulary: VocabItem[] = [
  { set: 1, setTheme: 'Basics', withinSetNumber: 1, japanese: '本', reading: 'ほん', meaning: 'book', partOfSpeech: 'noun', category: 'object' },
  { set: 2, setTheme: 'Actions', withinSetNumber: 1, japanese: '読む', reading: 'よむ', meaning: 'read', partOfSpeech: 'verb', category: 'action' }
];

const balance: LibraryBalancePlan = {
  setNumber: 2,
  targetWordCount: 1,
  libraryConversationCount: 0,
  zeroCount: 1,
  lowCoverageCount: 0,
  meanCount: 0,
  standardDeviation: 0,
  targetCount: 1,
  preferredMaxConversationCount: 10,
  suggestedConversationCount: 1,
  requiredZeroWords: [{ japanese: '読む', reading: 'よむ', meaning: 'read', partOfSpeech: 'verb', category: 'action', libraryCount: 0, targetCount: 1, neededCount: 1 }],
  priorityWords: [{ japanese: '読む', reading: 'よむ', meaning: 'read', partOfSpeech: 'verb', category: 'action', libraryCount: 0, targetCount: 1, neededCount: 1 }],
  overrepresentedWords: []
};

test('standard prompt emphasizes natural current-set focus and shared language policy', async () => {
  const prompt = await buildGenerationPrompt(2, 4, vocabulary);

  assert.match(prompt, /current Set 2 is the primary learning focus/i);
  assert.match(prompt, /never force a word into an unnatural line/i);
  assert.match(prompt, /earlier-set vocabulary as natural supporting language/i);
  assert.match(prompt, /even if they are common JLPT N5 words from later sets/i);
  assert.match(prompt, /choose simpler wording or a different scene/i);
  assert.match(prompt, /declaredNonVocabularyTerms/);
  assert.match(prompt, /common Japanese proper nouns or cultural references/i);
  assert.match(prompt, /Conversation fillers:/);
  assert.match(prompt, /Speaker 1 female names: さくら/);
  assert.doesNotMatch(prompt, /\{\{languagePolicy\}\}/);
});

test('complement prompt preserves priorities while allowing natural omissions', () => {
  const prompt = buildLibraryComplementPrompt(2, vocabulary, balance);

  assert.match(prompt, /strong coverage priority/i);
  assert.match(prompt, /do not force an awkward use/i);
  assert.match(prompt, /omit or redistribute a priority word/i);
  assert.match(prompt, /even if they are common JLPT N5 words from later sets/i);
  assert.match(prompt, /declaredNonVocabularyTerms/);
  assert.match(prompt, /common Japanese proper nouns or cultural references/i);
  assert.match(prompt, /Conversation fillers:/);
  assert.match(prompt, /読む/);
});

const libraryContext: AiCurationLibraryContext = {
  conversationCount: 1,
  wordExposure: { 読む: 0, 本: 2 },
  conversations: [
    {
      id: 'set-02-0001',
      title: 'At the library',
      scene: 'Two friends discuss a book.',
      text: [{ speaker: 'Speaker 1', tags: ['friendly', 'slow'], japanese: '本を読みますか。' }],
      listeningQuestions: ['What do they discuss?']
    }
  ]
};

test('AI balance prompt grounds on gaps, library content, exposure, variety, and authoritative counts', () => {
  const prompt = buildAiLibraryBalancePrompt(2, vocabulary, balance, libraryContext);

  // Deterministic gap priorities are supplied.
  assert.match(prompt, /strong coverage priority/i);
  assert.match(prompt, /読む/);
  // Existing library conversation content and per-word exposure are supplied.
  assert.match(prompt, /Existing curated library/i);
  assert.match(prompt, /wordExposure/);
  assert.match(prompt, /At the library/);
  // Variety / non-redundancy guidance.
  assert.match(prompt, /diversify scenes/i);
  assert.match(prompt, /do not retell or lightly reskin an existing conversation/i);
  assert.match(prompt, /even if they are common JLPT N5 words from later sets/i);
  assert.match(prompt, /declaredNonVocabularyTerms/);
  // Authoritative-counts instruction.
  assert.match(prompt, /never recompute or alter them/i);
  // Shared language policy is included.
  assert.match(prompt, /Conversation fillers:/);
});

function conversation(id: string, number: number): PracticeConversation {
  const timestamp = '2026-01-01T00:00:00.000Z';
  return {
    id,
    number,
    title: `Conversation ${number}`,
    scene: 'Two friends talk.',
    sampleContext: 'They speak slowly.',
    text: [{ speaker: 'Speaker 1', tags: ['friendly', 'slow'], japanese: 'æœ¬ã‚’èª­ã¿ã¾ã™ã€‚' }],
    listeningQuestions: ['What happens?'],
    answerKey: ['A book is read.'],
    englishTranslation: [{ speaker: 'Speaker 1', english: 'I read a book.' }],
    vocabularyUsed: ['æœ¬'],
    outOfVocabularyAudit: [],
    simplerReplacementSuggestions: [],
    status: 'draft',
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

const promptConversations = [conversation('convo-01', 1), conversation('convo-02', 2)];
const promptEvidence: ConversationCurationEvidenceMap = Object.fromEntries(promptConversations.map((item) => [item.id, {
  evidenceVersion: 'test',
  setNumber: 2,
  currentSetTotal: 1,
  currentSetUniqueCount: 0,
  currentSetUniqueWords: [],
  allowedVocabTotal: 2,
  allowedVocabUniqueCount: 1,
  allowedVocabUniqueWords: ['æœ¬'],
  vocabularyOccurrences: { 'æœ¬': 1 },
  outOfVocabularyUniqueCount: 0,
  outOfVocabularyUniqueWords: [],
  outOfVocabularyOccurrenceCount: 0
}]));

test('quality triage prompt marks deterministic evidence authoritative and includes curated exemplars', () => {
  const prompt = buildQualityTriagePrompt({
    setNumber: 2,
    conversations: promptConversations,
    evidenceByConversationId: promptEvidence,
    libraryContext
  });
  assert.match(prompt, /authoritative/i);
  assert.match(prompt, /MUST NOT be used as a reason to regenerate/i);
  assert.match(prompt, /At the library/);
  assert.match(prompt, /exactly one verdict for every supplied conversationId/i);
  assert.match(prompt, /Judge only the spoken dialogue/i);
  assert.doesNotMatch(prompt, /What happens\?/);
  assert.doesNotMatch(prompt, /A book is read\./);
});

test('historical quality labels separate harmless constraints from noticeable dialogue flaws', () => {
  const prompt = buildQualityTriagePrompt({
    setNumber: 2,
    conversations: promptConversations,
    evidenceByConversationId: promptEvidence,
    reviewPurpose: 'historical-label'
  });
  assert.match(prompt, /shared final quality label, not a repair queue/i);
  assert.match(prompt, /communicative success/i);
  assert.match(prompt, /recoverable ellipsis/i);
  assert.match(prompt, /materially obscures or changes the intended meaning/i);
  assert.match(prompt, /repeated or sustained pattern/i);
  assert.match(prompt, /A phrase having a more idiomatic alternative is not enough/i);
  assert.match(prompt, /Do not target any desired distribution/i);
  assert.match(prompt, /No vocabulary, question, answer, translation, generator, repair-history, or earlier-label evidence is supplied or relevant/i);
  assert.match(prompt, /generator identity, repair history, and earlier labels are deliberately excluded/i);
  assert.doesNotMatch(prompt, /authoritativeVocabularyEvidence/);
  assert.doesNotMatch(prompt, /Curated quality-bar exemplars/);
  assert.doesNotMatch(prompt, /What happens\?/);
});

test('balanced repair prompt contains flagged conversations only and uses a balanced objective', () => {
  const verdicts: ConversationQualityVerdict[] = [
    { conversationId: 'convo-01', verdict: 'repair', rationale: 'Stilted.', flags: ['stilted'] },
    { conversationId: 'convo-02', verdict: 'pass', rationale: 'Natural.', flags: [] }
  ];
  const prompt = buildBalancedRepairPrompt('Original objective', vocabulary, [promptConversations[0]], [{
    conversationId: 'convo-01',
    trueOutOfVocabularyWords: ['å›°ã‚‹']
  }], verdicts);
  assert.match(prompt, /naturalness and realism/i);
  assert.match(prompt, /convo-01/);
  assert.doesNotMatch(prompt, /convo-02/);
  assert.match(prompt, /Return exactly 1 conversations/i);
});

test('picker prompt is forced-choice and attaches authoritative re-audit evidence', () => {
  const prompt = buildPickerPrompt([{
    conversationId: 'convo-01',
    triageRationale: 'Stilted.',
    versions: [{ source: 'original', conversation: promptConversations[0], evidence: promptEvidence['convo-01'], flags: [] }]
  }]);
  assert.match(prompt, /forced-choice/i);
  assert.match(prompt, /may not reject all versions/i);
  assert.match(prompt, /selectedQuality/);
  assert.match(prompt, /outOfVocabularyUniqueCount/);
  assert.match(prompt, /spoken dialogue's naturalness/i);
  assert.doesNotMatch(prompt, /What happens\?/);
  assert.doesNotMatch(prompt, /A book is read\./);
});
