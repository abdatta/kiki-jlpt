import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiCurationRecommendation, PracticeConversation, PracticeRun } from '../shared/types.ts';
import { planAddAllRecommendations, runStopOnFailureQueue } from './addAllAudio.ts';

const timestamp = '2026-06-30T00:00:00.000Z';

function conversation(id: string, overrides: Partial<PracticeConversation> = {}): PracticeConversation {
  return {
    id,
    number: 1,
    title: id,
    scene: 'Test',
    sampleContext: 'Test',
    text: [],
    listeningQuestions: [],
    answerKey: [],
    englishTranslation: [],
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
    setNumber: 1,
    conversationCount: conversations.length,
    allowedVocabCount: 0,
    textModel: { id: 'test', label: 'Test', provider: 'gemini', model: 'test' },
    analytics: {
      currentSetTotal: 0,
      currentSetUsedCount: 0,
      currentSetMissingCount: 0,
      currentSetMissingWords: [],
      allowedVocabTotal: 0,
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

function recommendation(sourceRunId: string, sourceConversationId: string): AiCurationRecommendation {
  const source = conversation(sourceConversationId);
  return {
    rank: 1,
    candidateKey: `${sourceRunId}:${sourceConversationId}`,
    sourceRunId,
    sourceConversationId,
    rationale: 'Test',
    strengths: [],
    concerns: [],
    contribution: { uncoveredWords: [], underexposedWords: [], currentSetWords: [] },
    evidence: {
      evidenceVersion: '1',
      setNumber: 1,
      currentSetTotal: 0,
      currentSetUniqueCount: 0,
      currentSetUniqueWords: [],
      allowedVocabTotal: 0,
      allowedVocabUniqueCount: 0,
      allowedVocabUniqueWords: [],
      vocabularyOccurrences: {},
      outOfVocabularyUniqueCount: 0,
      outOfVocabularyUniqueWords: [],
      outOfVocabularyOccurrenceCount: 0
    },
    conversation: source
  };
}

test('Add All planning targets only recommendations and trusts persisted audio files', () => {
  const recommendations = [recommendation('run-a', 'ready'), recommendation('run-b', 'missing')];
  const runs = new Map([
    ['run-a', run('run-a', [
      conversation('ready', { status: 'audio_failed', audioFileName: 'ready.wav', curatedId: 'curated-ready' }),
      conversation('not-recommended')
    ])],
    ['run-b', run('run-b', [conversation('missing')])]
  ]);

  const plan = planAddAllRecommendations(recommendations, runs);

  assert.equal(plan.length, 2);
  assert.deepEqual(plan.map((item) => item.sourceConversationId), ['ready', 'missing']);
  assert.equal(plan[0].audioReady, true);
  assert.equal(plan[0].libraryReady, true);
  assert.equal(plan[1].audioReady, false);
  assert.equal(plan.some((item) => item.sourceConversationId === 'not-recommended'), false);
});

test('Add All planning reports missing conversations and unavailable runs', () => {
  const recommendations = [recommendation('run-a', 'missing'), recommendation('run-b', 'anything')];
  const runs = new Map([['run-a', run('run-a', [conversation('other')])]]);

  const plan = planAddAllRecommendations(recommendations, runs, new Set(['run-b']));

  assert.equal(plan[0].sourceError, 'Source conversation no longer exists.');
  assert.equal(plan[1].sourceError, 'Source run could not be loaded.');
});

test('audio queue runs at most three items concurrently', async () => {
  let active = 0;
  let maximumActive = 0;
  const releases: Array<() => void> = [];
  const started: number[] = [];
  const queued = runStopOnFailureQueue([0, 1, 2, 3, 4], {
    onStart: (item) => started.push(item),
    run: async (item) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return item;
    }
  });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2]);
  releases.shift()?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2, 3]);
  while (releases.length > 0) releases.shift()?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  while (releases.length > 0) releases.shift()?.();
  const results = await queued;

  assert.equal(maximumActive, 3);
  assert.equal(results.every((result) => result.status === 'done'), true);
});

test('audio queue stops new work after failure while in-flight work settles', async () => {
  const started: number[] = [];
  const settled: Array<[number, string]> = [];
  let releaseFirst!: () => void;
  let releaseThird!: () => void;

  const resultsPromise = runStopOnFailureQueue([0, 1, 2, 3, 4], {
    onStart: (item) => started.push(item),
    onSettled: (item, result) => settled.push([item, result.status]),
    run: async (item) => {
      if (item === 0) await new Promise<void>((resolve) => { releaseFirst = resolve; });
      if (item === 1) throw new Error('provider failed');
      if (item === 2) await new Promise<void>((resolve) => { releaseThird = resolve; });
      return item;
    }
  });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2]);
  releaseFirst();
  releaseThird();
  const results = await resultsPromise;

  assert.deepEqual(started, [0, 1, 2]);
  assert.deepEqual(results.map((result) => result.status), ['done', 'error', 'done', 'skipped', 'skipped']);
  assert.deepEqual(settled.sort(([left], [right]) => left - right), [
    [0, 'done'],
    [1, 'error'],
    [2, 'done'],
    [3, 'skipped'],
    [4, 'skipped']
  ]);
});

test('audio queue pauses before claiming new work and waits for in-flight work', async () => {
  const started: number[] = [];
  const releases = new Map<number, () => void>();
  let pauseRequested = false;
  let queueSettled = false;
  const queued = runStopOnFailureQueue([0, 1, 2, 3, 4], {
    shouldPause: () => pauseRequested,
    onStart: (item) => started.push(item),
    run: async (item) => {
      await new Promise<void>((resolve) => releases.set(item, resolve));
      return item;
    }
  }).finally(() => { queueSettled = true; });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2]);
  pauseRequested = true;
  releases.get(0)?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(queueSettled, false);
  assert.deepEqual(started, [0, 1, 2]);
  releases.get(1)?.();
  releases.get(2)?.();
  const results = await queued;

  assert.deepEqual(started, [0, 1, 2]);
  assert.deepEqual(results.map((result) => result.status), ['done', 'done', 'done', 'paused', 'paused']);
});

test('audio queue gives an in-flight failure precedence over a requested pause', async () => {
  let pauseRequested = false;
  const releases = new Map<number, (outcome: 'done' | 'fail') => void>();
  const queued = runStopOnFailureQueue([0, 1, 2, 3], {
    shouldPause: () => pauseRequested,
    run: (item) => new Promise<number>((resolve, reject) => {
      releases.set(item, (outcome) => outcome === 'fail' ? reject(new Error('failed while pausing')) : resolve(item));
    })
  });

  await new Promise<void>((resolve) => setImmediate(resolve));
  pauseRequested = true;
  releases.get(0)?.('done');
  releases.get(1)?.('fail');
  releases.get(2)?.('done');
  const results = await queued;

  assert.deepEqual(results.map((result) => result.status), ['done', 'error', 'done', 'skipped']);
});

test('paused queue work can resume without rerunning completed items', async () => {
  let pauseRequested = false;
  const firstStarted: number[] = [];
  const firstResults = await runStopOnFailureQueue([0, 1, 2, 3], {
    concurrency: 1,
    shouldPause: () => pauseRequested,
    onStart: (item) => firstStarted.push(item),
    run: async (item) => {
      pauseRequested = true;
      return item;
    }
  });
  const remaining = [0, 1, 2, 3].filter((_item, index) => firstResults[index].status === 'paused');
  const resumedStarted: number[] = [];
  const resumedResults = await runStopOnFailureQueue(remaining, {
    onStart: (item) => resumedStarted.push(item),
    run: async (item) => item
  });

  assert.deepEqual(firstStarted, [0]);
  assert.deepEqual(resumedStarted, [1, 2, 3]);
  assert.equal(resumedResults.every((result) => result.status === 'done'), true);
});
