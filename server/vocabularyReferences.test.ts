import assert from 'node:assert/strict';
import test from 'node:test';
import type { VocabItem } from '../shared/types.ts';
import { resolveVocabularyReferences, validateConversationVocabularyReferences } from './vocabularyReferences.ts';

const vocabulary: VocabItem[] = [
  { set: 4, setTheme: '', withinSetNumber: 1, japanese: '分かる', reading: 'わかる', meaning: 'to understand', partOfSpeech: 'verb', category: 'action' },
  { set: 5, setTheme: '', withinSetNumber: 2, japanese: '重い', reading: 'おもい', meaning: 'heavy', partOfSpeech: 'adjective', category: 'description' },
  { set: 6, setTheme: '', withinSetNumber: 3, japanese: 'すぐに', reading: 'すぐに', meaning: 'immediately', partOfSpeech: 'adverb', category: 'time' },
  { set: 8, setTheme: '', withinSetNumber: 4, japanese: 'ゆっくりと', reading: 'ゆっくりと', meaning: 'slowly', partOfSpeech: 'adverb', category: 'manner' }
];

test('resolves later-set exact and unambiguous kana forms and deduplicates canonical words', () => {
  const result = resolveVocabularyReferences(['分かる', 'わかる', '分かる'], 1, vocabulary);
  assert.equal(result.references.length, 1);
  assert.equal(result.references[0].japanese, '分かる');
  assert.equal(result.references[0].setNumber, 4);
});

test('preserves exact Japanese homophones', () => {
  const result = resolveVocabularyReferences(['思う'], 1, vocabulary);
  assert.equal(result.references[0].japanese, '思う');
  assert.notEqual(result.references[0].japanese, '重い');
});

test('resolves reviewed external aliases and rejects malformed candidates', () => {
  const result = resolveVocabularyReferences(['良い', '。'], 1, vocabulary, {
    version: 1,
    entries: [{ japanese: '良い', aliases: ['よい'], reading: 'よい', meaning: 'good' }]
  });
  assert.equal(result.references[0].kind, 'external');
  assert.deepEqual(result.discarded, ['。']);
});

test('validation reports learner-visible unresolved terms and ignores malformed audit debris', () => {
  assert.deepEqual(validateConversationVocabularyReferences({
    id: 'conversation-1',
    outOfVocabularyAudit: ['猫', 'ー'],
    vocabularyReferences: []
  }), [{ conversationId: 'conversation-1', surface: '猫', reason: 'unresolved' }]);
});

test('resolves reviewed adverb variants to their future course entries', () => {
  const result = resolveVocabularyReferences(['すぐ', 'ゆっくり'], 2, vocabulary);
  assert.deepEqual(result.references.map((reference) => [reference.japanese, reference.kind, reference.setNumber]), [
    ['すぐに', 'future_set', 6],
    ['ゆっくりと', 'future_set', 8]
  ]);
});
