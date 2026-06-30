import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {
  AiCurationReview,
  CuratedConversation,
  CuratedSet,
  PracticeConversation,
  PracticeRun,
  TextModelInfo,
  VocabItem
} from '../shared/types.ts';
import {
  AiCurationExecutionError,
  AiCurationInputError,
  buildAiCurationPrompt,
  buildAiCurationSnapshotFromData,
  createAiCurationReview,
  isAiCurationReviewStale,
  listAiCurationReviewSummaries,
  readAiCurationReview,
  saveAiCurationReview,
  validateAiCurationResponse
} from './aiCuration.ts';

const timestamp = '2026-01-01T00:00:00.000Z';
const model: TextModelInfo = { id: 'gemini', provider: 'gemini', model: 'test-model', label: 'Test model' };
const vocabulary: VocabItem[] = [
  { set: 1, setTheme: 'Basics', withinSetNumber: 1, japanese: '本', reading: 'ほん', meaning: 'book', partOfSpeech: 'noun', category: 'object' },
  { set: 2, setTheme: 'Actions', withinSetNumber: 1, japanese: '読む', reading: 'よむ', meaning: 'read', partOfSpeech: 'verb', category: 'action' },
  { set: 2, setTheme: 'Actions', withinSetNumber: 2, japanese: '見る', reading: 'みる', meaning: 'see', partOfSpeech: 'verb', category: 'action' }
];

function conversation(id: string, japanese: string, overrides: Partial<PracticeConversation> = {}): PracticeConversation {
  return {
    id,
    number: 1,
    title: id,
    scene: 'At home',
    sampleContext: 'Two friends talk.',
    text: [{ speaker: 'Speaker 1', tags: ['slow'], japanese }],
    listeningQuestions: ['What happened?'],
    answerKey: ['They talked.'],
    englishTranslation: [{ speaker: 'Speaker 1', english: 'Test.' }],
    vocabularyUsed: [],
    outOfVocabularyAudit: [],
    simplerReplacementSuggestions: [],
    status: 'draft',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

function run(id: string, conversations: PracticeConversation[]): PracticeRun {
  return {
    id,
    setNumber: 2,
    conversationCount: conversations.length,
    allowedVocabCount: vocabulary.length,
    textModel: model,
    analytics: {
      currentSetTotal: 2,
      currentSetUsedCount: 0,
      currentSetMissingCount: 2,
      currentSetMissingWords: ['読む', '見る'],
      allowedVocabTotal: 3,
      allowedVocabUsedCount: 0,
      allowedVocabUsedPercentage: 0,
      outOfAllowedCount: 0,
      outOfAllowedWords: []
    },
    status: 'generated',
    createdAt: timestamp,
    updatedAt: timestamp,
    conversations
  };
}

function curated(sourceRunId: string, sourceConversationId: string, japanese: string): CuratedConversation {
  return {
    ...conversation(`curated-${sourceConversationId}`, japanese, {
      status: 'audio_ready',
      audioFileName: 'test.wav',
      audioUrl: '/test.wav'
    }),
    sourceRunId,
    sourceConversationId,
    setNumber: 2,
    audioFileName: 'test.wav',
    audioUrl: '/test.wav',
    curatedAudioPath: 'curated/audio/test.wav'
  };
}

function library(conversations: CuratedConversation[]): CuratedSet {
  return {
    setNumber: 2,
    analytics: {
      currentSetTotal: 2,
      currentSetUsedCount: 0,
      currentSetMissingCount: 2,
      currentSetMissingWords: ['読む', '見る'],
      allowedVocabTotal: 3,
      allowedVocabUsedCount: 0,
      allowedVocabUsedPercentage: 0,
      outOfAllowedCount: 0,
      outOfAllowedWords: []
    },
    conversations,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

async function fixtureSnapshot() {
  const sourceA = conversation('convo-01', '本を読みます。');
  const sourceB = conversation('convo-02', '本を見ます。', { status: 'audio_ready', audioFileName: 'b.wav', audioUrl: '/b.wav' });
  const sourceC = conversation('convo-01', '本を読みます。そして見ます。');
  return buildAiCurationSnapshotFromData(2, vocabulary, library([
    curated('run-a', 'convo-01', '本を読みます。')
  ]), [run('run-a', [sourceA, sourceB]), run('run-b', [sourceC])]);
}

test('snapshot excludes curated sources and accounts for every remaining candidate', async () => {
  const snapshot = await fixtureSnapshot();

  assert.equal(snapshot.candidateCount, 2);
  assert.deepEqual(new Set(snapshot.candidateKeys), new Set(['run-a:convo-02', 'run-b:convo-01']));
  assert.equal(snapshot.library.wordExposure['読む'], 1);
  assert.deepEqual(snapshot.candidates.find((candidate) => candidate.candidateKey === 'run-a:convo-02')?.contribution.uncoveredWords, ['見る']);
});

test('model prompt excludes audio readiness and recording metadata', async () => {
  const snapshot = await fixtureSnapshot();
  const prompt = buildAiCurationPrompt(snapshot, 1);

  assert.doesNotMatch(JSON.stringify(snapshot), /audio_ready|audioFileName|audioUrl|curatedAudioPath|b\.wav/i);
  assert.doesNotMatch(prompt, /audio_ready|audioFileName|audioUrl|b\.wav/i);
  assert.match(prompt, /exactly 1/);
});

test('response validation attaches authoritative data and rejects fabricated identities', async () => {
  const snapshot = await fixtureSnapshot();
  const result = validateAiCurationResponse({
    summary: 'A complementary pair.',
    recommendations: [{
      candidateKey: 'run-a:convo-02',
      rationale: 'Natural use of 見る.',
      strengths: ['Clear context'],
      concerns: []
    }]
  }, snapshot, 1);

  assert.equal(result.recommendations[0].rank, 1);
  assert.equal(result.recommendations[0].evidence.currentSetUniqueCount, 1);
  assert.equal(result.projectedLeastCoveredWords.length, 2);
  for (const word of result.recommendations[0].evidence.currentSetUniqueWords) {
    const projection = result.projectedLeastCoveredWords.find((item) => item.japanese === word);
    assert.equal(projection?.projectedLibraryCount, (projection?.currentLibraryCount ?? 0) + 1);
  }
  assert.throws(
    () => validateAiCurationResponse({ summary: 'Too few.', recommendations: [] }, snapshot, 1),
    /Expected exactly 1 recommendations, received 0/
  );
  assert.throws(() => validateAiCurationResponse({
    summary: 'Bad',
    recommendations: [{ candidateKey: 'invented', rationale: 'Bad', strengths: [], concerns: [] }]
  }, snapshot, 1), /Unknown or ineligible/);
  assert.throws(() => validateAiCurationResponse({
    summary: 'Bad',
    recommendations: [
      { candidateKey: 'run-a:convo-02', rationale: 'One', strengths: [], concerns: [] },
      { candidateKey: 'run-a:convo-02', rationale: 'Two', strengths: [], concerns: [] }
    ]
  }, snapshot, 2), /Duplicate recommended/);
});

test('batched execution includes every candidate and persists a complete review', async () => {
  const snapshot = await fixtureSnapshot();
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'jlpt-curation-'));
  const calls: string[] = [];
  try {
    const review = await createAiCurationReview(2, model, {
      snapshot,
      targetConversationCount: 1,
      storageRoot,
      maxPromptChars: 1,
      invoker: async (prompt) => {
        calls.push(prompt);
        if (prompt.includes('"evaluations"')) {
          return {
            output: 'batch',
            parsed: {
              evaluations: snapshot.candidateKeys.map((candidateKey) => ({
                candidateKey,
                recommend: true,
                rationale: 'Grounded evaluation',
                strengths: ['Useful'],
                concerns: []
              }))
            }
          };
        }
        return {
          output: 'final',
          parsed: {
            summary: 'Final portfolio',
            recommendations: [{
              candidateKey: snapshot.candidateKeys[0],
              rationale: 'Best complement',
              strengths: ['Useful'],
              concerns: []
            }]
          }
        };
      }
    });

    assert.equal(review.status, 'complete');
    assert.equal(review.snapshot.candidateCount, 2);
    assert.equal(calls.length, 2);
    assert.equal((await readAiCurationReview(2, review.id, storageRoot)).id, review.id);
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});

test('provider and parsing failures persist retryable failed reviews', async () => {
  const snapshot = await fixtureSnapshot();
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'jlpt-curation-failure-'));
  try {
    await assert.rejects(
      createAiCurationReview(2, model, {
        snapshot,
        targetConversationCount: 1,
        storageRoot,
        invoker: async () => { throw new Error('provider unavailable'); }
      }),
      (error: unknown) => error instanceof AiCurationExecutionError && error.review.status === 'failed'
    );
    const setDirectory = path.join(storageRoot, 'set-02');
    const files = await readdir(setDirectory);
    assert.equal(files.length, 1);
    const failed = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(setDirectory, files[0]), 'utf8')) as AiCurationReview;
    assert.equal(failed.status, 'failed');
    assert.match(failed.error ?? '', /provider unavailable/);
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});

test('review creation rejects portfolio sizes outside the eligible candidate range', async () => {
  const snapshot = await fixtureSnapshot();

  await assert.rejects(
    createAiCurationReview(2, model, { snapshot, targetConversationCount: 3 }),
    (error: unknown) => error instanceof AiCurationInputError && /1 through 2/.test(error.message)
  );
});

test('fingerprints detect candidate and library changes', async () => {
  const snapshot = await fixtureSnapshot();
  const review: AiCurationReview = {
    id: 'curation-set-02-test',
    setNumber: 2,
    targetConversationCount: 1,
    status: 'complete',
    stale: false,
    textModel: model,
    snapshot,
    llmExchanges: [],
    result: { summary: 'Test', recommendations: [], projectedLeastCoveredWords: [] },
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const editedRuns = [run('run-a', [
    conversation('convo-01', '本を読みます。'),
    conversation('convo-02', '本を見ます。', { updatedAt: '2026-01-02T00:00:00.000Z' })
  ]), run('run-b', [conversation('convo-01', '本を読みます。そして見ます。')])];
  const edited = await buildAiCurationSnapshotFromData(2, vocabulary, library([
    curated('run-a', 'convo-01', '本を読みます。')
  ]), editedRuns);
  const contentEditedRuns = structuredClone(editedRuns);
  contentEditedRuns[0].conversations[1].sampleContext = 'A materially different learning context.';
  const contentEdited = await buildAiCurationSnapshotFromData(
    2,
    vocabulary,
    library([curated('run-a', 'convo-01', '本を読みます。')]),
    contentEditedRuns
  );
  const deleted = await buildAiCurationSnapshotFromData(2, vocabulary, library([
    curated('run-a', 'convo-01', '本を読みます。')
  ]), []);
  const added = await buildAiCurationSnapshotFromData(2, vocabulary, library([
    curated('run-a', 'convo-01', '本を読みます。'),
    curated('run-a', 'convo-02', '本を見ます。')
  ]), editedRuns);
  const removed = await buildAiCurationSnapshotFromData(2, vocabulary, library([]), editedRuns);

  assert.equal(isAiCurationReviewStale(review, snapshot), false);
  assert.equal(isAiCurationReviewStale(review, edited), false);
  assert.equal(isAiCurationReviewStale(review, contentEdited), true);
  assert.equal(isAiCurationReviewStale(review, deleted), true);
  assert.equal(isAiCurationReviewStale(review, added), true);
  assert.equal(isAiCurationReviewStale(review, removed), true);
});

test('review storage retains and summarizes history newest first', async () => {
  const snapshot = await fixtureSnapshot();
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'jlpt-curation-storage-'));
  const review: AiCurationReview = {
    id: 'curation-set-02-storage-test',
    setNumber: 2,
    targetConversationCount: 1,
    status: 'complete',
    stale: false,
    textModel: model,
    snapshot,
    llmExchanges: [],
    result: { summary: 'Stored', recommendations: [], projectedLeastCoveredWords: [] },
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const newerReview: AiCurationReview = {
    ...review,
    id: 'curation-set-02-storage-newer',
    targetConversationCount: 2,
    status: 'failed',
    snapshot: { ...snapshot, fingerprint: 'historical-fingerprint' },
    result: undefined,
    error: 'Stored failure',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z'
  };
  try {
    await saveAiCurationReview(review, storageRoot);
    await saveAiCurationReview(newerReview, storageRoot);
    assert.deepEqual(await readAiCurationReview(2, review.id, storageRoot), review);
    const summaries = await listAiCurationReviewSummaries(2, storageRoot, snapshot);
    assert.equal(summaries.length, 2);
    assert.equal(summaries[0].id, newerReview.id);
    assert.equal(summaries[0].status, 'failed');
    assert.equal(summaries[0].targetConversationCount, 2);
    assert.equal(summaries[0].candidateCount, 2);
    assert.equal(summaries[0].stale, true);
    assert.equal(summaries[1].id, review.id);
    assert.equal(summaries[1].stale, false);
    assert.equal((await readdir(path.join(storageRoot, 'set-02'))).length, 2);
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});
