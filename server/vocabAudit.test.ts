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

test('audit exempts approved names that Kuromoji splits across tokens', async () => {
  const vocabulary = [vocab(1, '窓', 'まど'), vocab(1, '開ける', 'あける')];
  const source = conversation('けんたさん、この窓を開けてください。');

  const analysis = await analyzeConversationsWithVocabulary(1, vocabulary, [source]);
  const evidence = analysis.evidenceByConversationId[source.id];

  assert.ok(!analysis.conversations[0].outOfVocabularyAudit.includes('たす'));
  assert.ok(!analysis.conversations[0].outOfVocabularyAudit.includes('ける'));
  assert.ok(evidence.vocabularyExemptions?.some((item) => item.surface === 'けんたさん' && item.kind === 'approved_name'));
});

test('audit canonicalizes kana OOV forms to known vocabulary spelling', async () => {
  const allowedVocabulary = [vocab(1, '本', 'ほん')];
  const knownVocabulary = [...allowedVocabulary, vocab(8, '分かる', 'わかる')];
  const source = conversation('わかります。');

  const analysis = await analyzeConversationsWithVocabulary(1, allowedVocabulary, [source], knownVocabulary);

  assert.deepEqual(analysis.conversations[0].outOfVocabularyAudit, ['分かる']);
});

test('audit prefers exact Japanese forms over homophonous reading aliases', async () => {
  const allowedVocabulary = [vocab(1, '本', 'ほん')];
  const knownVocabulary = [
    ...allowedVocabulary,
    vocab(6, '重い', 'おもい'),
    vocab(8, '思う', 'おもう')
  ];
  const source = conversation('そう思います。');

  const analysis = await analyzeConversationsWithVocabulary(1, allowedVocabulary, [source], knownVocabulary);

  assert.ok(analysis.conversations[0].outOfVocabularyAudit.includes('思う'));
  assert.ok(!analysis.conversations[0].outOfVocabularyAudit.includes('重い'));
});

test('audit does not canonicalize an unknown kanji word through a homophonous reading', async () => {
  const allowedVocabulary = [vocab(1, '本', 'ほん')];
  const knownVocabulary = [...allowedVocabulary, vocab(6, '重い', 'おもい')];
  const source = conversation('そう思います。');

  const analysis = await analyzeConversationsWithVocabulary(1, allowedVocabulary, [source], knownVocabulary);

  assert.ok(analysis.conversations[0].outOfVocabularyAudit.includes('思う'));
  assert.ok(!analysis.conversations[0].outOfVocabularyAudit.includes('重い'));
});

test('audit matches productive tilde vocabulary inside single and split tokens', async () => {
  const vocabulary = [vocab(2, '～月', '～がつ'), vocab(2, '～冊', '～さつ')];
  const source = conversation('三月に本を五冊読みます。');

  const analysis = await analyzeConversationsWithVocabulary(2, vocabulary, [source]);
  const evidence = analysis.evidenceByConversationId[source.id];

  assert.ok(evidence.allowedVocabUniqueWords.includes('～月'));
  assert.ok(evidence.allowedVocabUniqueWords.includes('～冊'));
  assert.ok(!analysis.conversations[0].outOfVocabularyAudit.includes('三月'));
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

test('audit credits reviewed good allomorphs and inflections to allowed いい', async () => {
  const source = conversation('これはよいです。昨日もよかったです。');
  const analysis = await analyzeConversationsWithVocabulary(1, [vocab(1, 'いい', 'いい')], [source]);

  assert.ok(!analysis.conversations[0].outOfVocabularyAudit.includes('よい'));
  assert.deepEqual(analysis.conversations[0].vocabularyUsed, ['いい']);
});

test('audit credits complete polite kinship spans to allowed base words', async () => {
  const allowed = [vocab(1, '兄', 'あに'), vocab(1, '姉', 'あね')];
  const source = conversation('お兄さんとお姉さんは学生です。');
  const analysis = await analyzeConversationsWithVocabulary(1, allowed, [source]);

  assert.ok(!analysis.conversations[0].outOfVocabularyAudit.includes('兄さん'));
  assert.ok(!analysis.conversations[0].outOfVocabularyAudit.includes('姉さん'));
  assert.deepEqual(analysis.conversations[0].vocabularyUsed, ['兄', '姉'].sort((a, b) => a.localeCompare(b, 'ja')));
});

test('audit credits reviewed 本当に composition only when 本当 is allowed', async () => {
  const source = conversation('本当にいいです。');
  const allowedAnalysis = await analyzeConversationsWithVocabulary(3, [vocab(3, '本当', 'ほんとう'), vocab(1, 'いい', 'いい')], [source]);
  const disallowedAnalysis = await analyzeConversationsWithVocabulary(1, [vocab(1, 'いい', 'いい')], [source], [vocab(1, 'いい', 'いい'), vocab(3, '本当', 'ほんとう')]);

  assert.ok(!allowedAnalysis.conversations[0].outOfVocabularyAudit.includes('本当に'));
  assert.ok(disallowedAnalysis.conversations[0].outOfVocabularyAudit.includes('本当に'));
});

test('audit discards standalone prolonged-sound debris from a filler', async () => {
  const analysis = await analyzeConversationsWithVocabulary(1, [], [conversation('んー。')]);
  assert.deepEqual(analysis.conversations[0].outOfVocabularyAudit, []);
  assert.equal(analysis.evidenceByConversationId['conversation-1'].outOfVocabularyOccurrenceCount, 0);
});

test('audit preserves distinct nouns, counters, and compounds without reviewed equivalence', async () => {
  const allowed = [vocab(2, '話す', 'はなす'), vocab(2, '遊ぶ', 'あそぶ'), vocab(1, '二', 'に'), vocab(1, '食べる', 'たべる'), vocab(1, '飲む', 'のむ')];
  const known = [...allowed, vocab(8, '話', 'はなし'), vocab(8, '二つ', 'ふたつ'), vocab(4, '食べ物', 'たべもの'), vocab(4, '飲み物', 'のみもの')];
  const analysis = await analyzeConversationsWithVocabulary(2, allowed, [conversation('話と遊びと二つの食べ物と飲み物です。')], known);
  const oov = analysis.conversations[0].outOfVocabularyAudit;

  for (const word of ['話', '遊び', '二つ', '食べ物', '飲み物']) assert.ok(oov.includes(word), `${word} should remain OOV`);
});
