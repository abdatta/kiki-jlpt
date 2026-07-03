import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { PracticeConversation, PracticeRun, StudioJob } from '../shared/types.ts';
import { cancelAudioParent, configureAudioSchedulerForTests, createAudioBatch, enqueueConversationAudio, pauseAudioParent, resumeAudioParent, waitForAudioSchedulerIdle, waitForStudioJob } from './audioScheduler.ts';
import { resetGenerationGateForTests, withGenerationSlot } from './generationGate.ts';
import { configureRunStorageForTests, mutateRun, readRun, saveRun } from './storage.ts';
import { configureStudioJobStorageForTests, createStudioJob, interruptActiveStudioJobs, listStudioJobs, readStudioJob, subscribeStudioEvents, updateStudioJob } from './studioJobs.ts';

function conversation(number: number): PracticeConversation {
  const timestamp = new Date().toISOString();
  return {
    id: `convo-${String(number).padStart(2, '0')}`,
    number,
    title: `Conversation ${number}`,
    scene: 'Test',
    sampleContext: 'Test',
    text: [{ speaker: 'Speaker 1', tags: [], japanese: 'はい' }],
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

function run(id: string, count: number): PracticeRun {
  const timestamp = new Date().toISOString();
  return {
    id,
    setNumber: 1,
    conversationCount: count,
    allowedVocabCount: 0,
    textModel: { id: 'test', provider: 'gemini', model: 'test', label: 'Test' },
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
    conversations: Array.from({ length: count }, (_, index) => conversation(index + 1))
  };
}

async function isolatedStorage() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jlpt-studio-jobs-'));
  configureStudioJobStorageForTests(path.join(root, 'jobs'));
  configureRunStorageForTests(path.join(root, 'runs'));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

function job(overrides: Partial<StudioJob> = {}): StudioJob {
  const timestamp = new Date().toISOString();
  return {
    id: 'job-1',
    idempotencyKey: 'request-1',
    kind: 'run-generation',
    status: 'running',
    title: 'Test job',
    detail: 'Test',
    stageLabel: 'Running',
    revision: 1,
    progress: { completed: 0, total: 1 },
    stages: [{ id: 'generate', label: 'Generate', status: 'running' }],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

test('studio job persistence is idempotent, revisioned, and restart-aware', async () => {
  const storage = await isolatedStorage();
  try {
    const [first, duplicate] = await Promise.all([
      createStudioJob(job()),
      createStudioJob(job({ id: 'job-duplicate' }))
    ]);
    assert.equal(duplicate.id, first.id);

    const updated = await updateStudioJob(first.id, (current) => ({ ...current, stageLabel: 'Still running' }));
    assert.equal(updated.revision, 2);
    assert.equal((await readStudioJob(first.id)).stageLabel, 'Still running');

    await interruptActiveStudioJobs();
    const interrupted = await readStudioJob(first.id);
    assert.equal(interrupted.status, 'interrupted');
    assert.equal(interrupted.stages[0].status, 'interrupted');

    const cancelled = await updateStudioJob(first.id, (current) => ({ ...current, status: 'cancelled', stageLabel: 'Discarded' }));
    assert.equal(cancelled.status, 'cancelled');
    const afterLateWrite = await updateStudioJob(first.id, (current) => ({ ...current, status: 'running', stageLabel: 'Zombie write' }));
    assert.equal(afterLateWrite.status, 'cancelled');
    assert.equal(afterLateWrite.stageLabel, 'Discarded');
  } finally {
    await storage.cleanup();
  }
});

test('status transitions honor the legality table', async () => {
  const storage = await isolatedStorage();
  try {
    // Terminal finality: succeeded rejects status changes but accepts payload updates.
    await createStudioJob(job({ id: 'job-done', idempotencyKey: 'done', status: 'succeeded' }));
    const events: string[] = [];
    const unsubscribe = subscribeStudioEvents((event) => {
      if (event.job) events.push(`${event.job.id}:${event.job.status}`);
    });
    const revived = await updateStudioJob('job-done', (current) => ({ ...current, status: 'running' }));
    assert.equal(revived.status, 'succeeded');
    assert.equal(events.length, 0);
    const payload = await updateStudioJob('job-done', (current) => ({ ...current, detail: 'updated detail' }));
    assert.equal(payload.detail, 'updated detail');
    assert.equal(events.length, 1);
    unsubscribe();

    // Pausing settles to paused (not back to queued); paused resists stale
    // failure writes but resumes to queued.
    await createStudioJob(job({ id: 'job-pausing', idempotencyKey: 'pausing', status: 'pausing' }));
    assert.equal((await updateStudioJob('job-pausing', (current) => ({ ...current, status: 'queued' }))).status, 'pausing');
    assert.equal((await updateStudioJob('job-pausing', (current) => ({ ...current, status: 'paused' }))).status, 'paused');
    assert.equal((await updateStudioJob('job-pausing', (current) => ({ ...current, status: 'failed' }))).status, 'paused');
    assert.equal((await updateStudioJob('job-pausing', (current) => ({ ...current, status: 'queued' }))).status, 'queued');
  } finally {
    await storage.cleanup();
  }
});

test('interruption retains completed-versus-total counts in the derived label', async () => {
  const storage = await isolatedStorage();
  try {
    await createStudioJob(job({
      id: 'batch-counts',
      idempotencyKey: 'batch-counts',
      kind: 'audio-batch',
      status: 'running',
      progress: { completed: 2, total: 9, queued: 7 }
    }));
    await interruptActiveStudioJobs();
    assert.equal((await readStudioJob('batch-counts')).stageLabel, 'Interrupted - 2/9 generated');
  } finally {
    await storage.cleanup();
  }
});

test('an idempotent start retry recreates children missing from a partial start', async () => {
  const storage = await isolatedStorage();
  configureAudioSchedulerForTests({
    concurrency: 1,
    executor: async (_runId, item) => ({ fileName: `${item.id}.wav`, filePath: `${item.id}.wav` })
  });
  try {
    await saveRun(run('run-retry', 3));
    const timestamp = new Date().toISOString();
    const parent = await createStudioJob(job({
      id: 'batch-retry',
      idempotencyKey: 'batch-retry',
      kind: 'audio-batch',
      status: 'running',
      runId: 'run-retry',
      progress: { completed: 0, total: 3, queued: 0 },
      stages: [{ id: 'audio', label: 'Generate audio', status: 'running', startedAt: timestamp }],
      request: { runId: 'run-retry', conversationIds: ['convo-01', 'convo-02', 'convo-03'], idempotencyKey: 'batch-retry' }
    }));
    // Only one child was created before the original start failed partway.
    await enqueueConversationAudio({ runId: 'run-retry', conversationId: 'convo-01', parentJobId: parent.id });

    const retried = await createAudioBatch({
      runId: 'run-retry',
      conversationIds: ['convo-01', 'convo-02', 'convo-03'],
      idempotencyKey: 'batch-retry'
    });
    assert.equal(retried.id, parent.id);
    const completed = await waitForStudioJob(parent.id);
    await waitForAudioSchedulerIdle();
    assert.equal(completed.status, 'succeeded');
    assert.equal((await listStudioJobs()).filter((item) => item.parentJobId === parent.id).length, 3);
  } finally {
    configureAudioSchedulerForTests();
    await storage.cleanup();
  }
});

test('generation gate runs one job at a time in FIFO order', async () => {
  resetGenerationGateForTests();
  const order: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const first = withGenerationSlot(async () => {
    order.push('first-start');
    await firstGate;
    order.push('first-end');
  });
  const second = withGenerationSlot(async () => {
    order.push('second');
  });
  const third = withGenerationSlot(async () => {
    order.push('third');
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(order, ['first-start']);
  releaseFirst();
  await Promise.all([first, second, third]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second', 'third']);
});

test('concurrent run mutations preserve both writers', async () => {
  const storage = await isolatedStorage();
  try {
    await saveRun(run('run-concurrent', 2));
    await Promise.all([
      mutateRun('run-concurrent', (current) => ({
        ...current,
        conversations: current.conversations.map((item) => item.number === 1 ? { ...item, error: 'first' } : item)
      })),
      mutateRun('run-concurrent', (current) => ({
        ...current,
        conversations: current.conversations.map((item) => item.number === 2 ? { ...item, error: 'second' } : item)
      }))
    ]);
    const persisted = await readRun('run-concurrent');
    assert.equal(persisted.conversations[0].error, 'first');
    assert.equal(persisted.conversations[1].error, 'second');
  } finally {
    await storage.cleanup();
  }
});

test('audio scheduler deduplicates conversations and never exceeds three workers', async () => {
  const storage = await isolatedStorage();
  let active = 0;
  let maximum = 0;
  let calls = 0;
  configureAudioSchedulerForTests({
    concurrency: 3,
    executor: async (_runId, item) => {
      calls += 1;
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return { fileName: `${item.id}.wav`, filePath: `${item.id}.wav` };
    }
  });
  try {
    await saveRun(run('run-audio', 5));
    const [first, duplicate] = await Promise.all([
      enqueueConversationAudio({ runId: 'run-audio', conversationId: 'convo-01' }),
      enqueueConversationAudio({ runId: 'run-audio', conversationId: 'convo-01' })
    ]);
    assert.equal(duplicate.attached, true);
    assert.equal(duplicate.job.id, first.job.id);
    await waitForStudioJob(first.job.id);
    assert.equal(calls, 1);

    const parent = await createAudioBatch({
      runId: 'run-audio',
      conversationIds: ['convo-02', 'convo-03', 'convo-04', 'convo-05'],
      idempotencyKey: 'batch-1'
    });
    const completed = await waitForStudioJob(parent.id);
    await waitForAudioSchedulerIdle();
    assert.equal(completed.status, 'succeeded');
    assert.equal(maximum <= 3, true);
    assert.equal((await readRun('run-audio')).conversations.every((item) => Boolean(item.audioFileName)), true);
  } finally {
    configureAudioSchedulerForTests();
    await storage.cleanup();
  }
});

test('audio scheduler stops only the failed parent and preserves successful work', async () => {
  const storage = await isolatedStorage();
  const started: string[] = [];
  configureAudioSchedulerForTests({
    concurrency: 2,
    executor: async (_runId, item) => {
      started.push(item.id);
      if (item.id === 'convo-02') throw new Error('Injected failure');
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { fileName: `${item.id}.wav`, filePath: `${item.id}.wav` };
    }
  });
  try {
    await saveRun(run('run-failure', 5));
    const parent = await createAudioBatch({
      runId: 'run-failure',
      conversationIds: ['convo-01', 'convo-02', 'convo-03', 'convo-04', 'convo-05'],
      idempotencyKey: 'batch-failure',
      stopOnFailure: true
    });
    const failed = await waitForStudioJob(parent.id);
    await waitForAudioSchedulerIdle();
    assert.equal(failed.status, 'failed');
    assert.equal(started.length <= 3, true);
    assert.equal((await readRun('run-failure')).conversations[0].audioFileName, 'convo-01.wav');
  } finally {
    configureAudioSchedulerForTests();
    await storage.cleanup();
  }
});

test('audio scheduler pauses cooperatively and resumes unresolved children', async () => {
  const storage = await isolatedStorage();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  configureAudioSchedulerForTests({
    concurrency: 1,
    executor: async (_runId, item) => {
      await gate;
      return { fileName: `${item.id}.wav`, filePath: `${item.id}.wav` };
    }
  });
  try {
    await saveRun(run('run-pause', 3));
    const parent = await createAudioBatch({
      runId: 'run-pause',
      conversationIds: ['convo-01', 'convo-02', 'convo-03'],
      idempotencyKey: 'batch-pause'
    });
    await pauseAudioParent(parent.id);
    release();
    const paused = await waitForStudioJob(parent.id);
    assert.equal(paused.status, 'paused');
    assert.equal(paused.stageLabel, 'Audio paused - 1/3 generated');
    configureAudioSchedulerForTests({
      concurrency: 1,
      executor: async (_runId, item) => ({ fileName: `${item.id}.wav`, filePath: `${item.id}.wav` })
    });
    await resumeAudioParent(parent.id);
    const completed = await waitForStudioJob(parent.id);
    await waitForAudioSchedulerIdle();
    assert.equal(completed.status, 'succeeded');
    assert.equal((await readRun('run-pause')).conversations.every((item) => Boolean(item.audioFileName)), true);
  } finally {
    configureAudioSchedulerForTests();
    await storage.cleanup();
  }
});

test('resume recreates children that were never enqueued after a failed batch start', async () => {
  const storage = await isolatedStorage();
  configureAudioSchedulerForTests({
    concurrency: 1,
    executor: async (_runId, item) => ({ fileName: `${item.id}.wav`, filePath: `${item.id}.wav` })
  });
  try {
    await saveRun(run('run-heal', 3));
    const timestamp = new Date().toISOString();
    const parent = await createStudioJob(job({
      id: 'batch-heal',
      idempotencyKey: 'batch-heal',
      kind: 'audio-batch',
      status: 'paused',
      title: 'Generate audio for Set 1',
      stageLabel: 'Audio paused',
      runId: 'run-heal',
      progress: { completed: 0, total: 3, queued: 0 },
      stages: [{ id: 'audio', label: 'Generate audio', status: 'running', startedAt: timestamp }],
      request: { runId: 'run-heal', conversationIds: ['convo-01', 'convo-02', 'convo-03'], idempotencyKey: 'batch-heal' }
    }));
    // Only one child was created before the original start failed partway.
    await enqueueConversationAudio({ runId: 'run-heal', conversationId: 'convo-01', parentJobId: parent.id });

    await resumeAudioParent(parent.id);
    const completed = await waitForStudioJob(parent.id);
    await waitForAudioSchedulerIdle();
    assert.equal(completed.status, 'succeeded');
    assert.equal((await listStudioJobs()).filter((item) => item.parentJobId === parent.id).length, 3);
    assert.equal((await readRun('run-heal')).conversations.every((item) => Boolean(item.audioFileName)), true);
  } finally {
    configureAudioSchedulerForTests();
    await storage.cleanup();
  }
});

test('cancelling a paused batch discards unresolved children, keeps completed audio, and blocks resume', async () => {
  const storage = await isolatedStorage();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  configureAudioSchedulerForTests({
    concurrency: 1,
    executor: async (_runId, item) => {
      await gate;
      return { fileName: `${item.id}.wav`, filePath: `${item.id}.wav` };
    }
  });
  try {
    await saveRun(run('run-cancel', 3));
    const parent = await createAudioBatch({
      runId: 'run-cancel',
      conversationIds: ['convo-01', 'convo-02', 'convo-03'],
      idempotencyKey: 'batch-cancel'
    });

    await assert.rejects(cancelAudioParent(parent.id), /Pause this job/);

    await pauseAudioParent(parent.id);
    release();
    const paused = await waitForStudioJob(parent.id);
    assert.equal(paused.status, 'paused');

    const cancelled = await cancelAudioParent(parent.id);
    await waitForAudioSchedulerIdle();
    assert.equal(cancelled.status, 'cancelled');
    assert.match(cancelled.stageLabel, /Discarded with 1\/3 audio generated/);

    const jobs = await listStudioJobs();
    const children = jobs.filter((item) => item.parentJobId === parent.id);
    assert.equal(children.filter((item) => item.status === 'succeeded').length, 1);
    assert.equal(children.filter((item) => item.status === 'cancelled').length, 2);
    assert.equal((await readRun('run-cancel')).conversations[0].audioFileName, 'convo-01.wav');

    await assert.rejects(resumeAudioParent(parent.id), /discarded/);
  } finally {
    configureAudioSchedulerForTests();
    await storage.cleanup();
  }
});
