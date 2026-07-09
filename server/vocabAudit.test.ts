import assert from 'node:assert/strict';
import test from 'node:test';
import type { PracticeConversation, VocabItem } from '../shared/types.ts';
import { analyzeConversationsWithVocabulary } from './vocabAudit.ts';

function vocab(set: number, japanese: string, reading = japanese): VocabItem {
  return {
    set,
    setTheme: `Set ${set}`,
    withinSetNumber: 1,
    japanese,
    reading,
    meaning: japanese,
    partOfSpeech: 'test',
    category: 'test'
  };
}

function conversation(japanese: string): PracticeConversation {
  const timestamp = '2026-01-01T00:00:00.000Z';
  return {
    id: 'conversation-1',
    number: 1,
    title: 'Audit fixture',
    scene: 'Test',
    sampleContext: 'Test',
    text: [{ speaker: 'Speaker 1', tags: ['slow'], japanese }],
    listeningQuestions: [],
    answerKey: [],
    englishTranslation: [],
    vocabularyUsed: [],
    outOfVocabularyAudit: [],
    simplerReplacementSuggestions: [],
    status: 'draft',
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

test('curation evidence deduplicates vocabulary and separates current from cumulative sets', async () => {
  const vocabulary = [
    vocab(1, '本', 'ほん'),
    vocab(1, '本', 'ほん'),
    vocab(1, '来る', 'くる'),
    vocab(2, '食べる', 'たべる'),
    vocab(2, '行く', 'いく')
  ];
  const source = conversation('さくらさんは本を食べません。そして東京へ行きます。ええと、猫が来ます。猫です。');

  const analysis = await analyzeConversationsWithVocabulary(2, vocabulary, [source]);
  const evidence = analysis.evidenceByConversationId[source.id];

  assert.equal(evidence.currentSetTotal, 2);
  assert.deepEqual(evidence.currentSetUniqueWords, ['行く', '食べる'].sort((a, b) => a.localeCompare(b, 'ja')));
  assert.equal(evidence.currentSetUniqueCount, 2);
  assert.equal(evidence.allowedVocabTotal, 4);
  assert.deepEqual(evidence.allowedVocabUniqueWords, ['本', '来る', '行く', '食べる'].sort((a, b) => a.localeCompare(b, 'ja')));
  assert.equal(evidence.allowedVocabUniqueCount, 4);
  assert.equal(evidence.vocabularyOccurrences['食べる'], 1);
});

test('curation evidence excludes prompt allowances and proper names but counts true OOV occurrences', async () => {
  const vocabulary = [
    vocab(1, '本', 'ほん'),
    vocab(1, '来る', 'くる'),
    vocab(2, '食べる', 'たべる'),
    vocab(2, '行く', 'いく')
  ];
  const source = conversation('さくらさんは本を食べません。そして東京へ行きます。ええと、猫が来ます。猫です。');

  const analysis = await analyzeConversationsWithVocabulary(2, vocabulary, [source]);
  const audited = analysis.conversations[0];
  const evidence = analysis.evidenceByConversationId[source.id];

  assert.deepEqual(audited.outOfVocabularyAudit, ['猫']);
  assert.deepEqual(evidence.outOfVocabularyUniqueWords, ['猫']);
  assert.equal(evidence.outOfVocabularyUniqueCount, 1);
  assert.equal(evidence.outOfVocabularyOccurrenceCount, 2);
});

test('audit exempts approved kana names with honorific suffixes', async () => {
  const vocabulary = [vocab(1, '英語', 'えいご'), vocab(1, '意味', 'いみ')];
  const source = conversation('けんさん、英語の意味です。');

  const analysis = await analyzeConversationsWithVocabulary(1, vocabulary, [source]);
  const evidence = analysis.evidenceByConversationId[source.id];

  assert.deepEqual(analysis.conversations[0].outOfVocabularyAudit, []);
  assert.ok(evidence.vocabularyExemptions?.some((item) => item.surface === 'けんさん' && item.kind === 'approved_name'));
});

test('audit accepts declared cultural references without vocabulary coverage credit', async () => {
  const vocabulary = [vocab(3, '学校', 'がっこう')];
  const source = {
    ...conversation('学校で寿司です。'),
    declaredNonVocabularyTerms: [{
      surface: '寿司',
      reading: 'すし',
      kind: 'cultural_reference' as const,
      category: 'food' as const,
      rationale: 'A common Japanese food.'
    }]
  };

  const analysis = await analyzeConversationsWithVocabulary(3, vocabulary, [source]);
  const evidence = analysis.evidenceByConversationId[source.id];

  assert.deepEqual(analysis.conversations[0].outOfVocabularyAudit, []);
  assert.deepEqual(evidence.allowedVocabUniqueWords, ['学校']);
  assert.ok(evidence.vocabularyExemptions?.some((item) => item.surface === '寿司' && item.kind === 'cultural_reference'));
});

test('audit rejects ordinary content declarations and keeps later-set words OOV', async () => {
  const allowedVocabulary = [vocab(3, '学校', 'がっこう')];
  const knownVocabulary = [...allowedVocabulary, vocab(6, '難しい', 'むずかしい')];
  const source = {
    ...conversation('学校は難しいです。'),
    declaredNonVocabularyTerms: [{
      surface: '難しい',
      kind: 'cultural_reference' as const,
      category: 'cultural_item' as const,
      rationale: 'Incorrectly declared ordinary adjective.'
    }]
  };

  const analysis = await analyzeConversationsWithVocabulary(3, allowedVocabulary, [source], knownVocabulary);
  const evidence = analysis.evidenceByConversationId[source.id];

  assert.deepEqual(analysis.conversations[0].outOfVocabularyAudit, ['難しい']);
  assert.ok(evidence.rejectedVocabularyDeclarations?.some((item) => item.surface === '難しい'));
});
