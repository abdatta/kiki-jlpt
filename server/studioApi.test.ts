import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import type { LlmExchange, PracticeConversation, PracticeRun, StudioJob, WorkflowJob } from '../shared/types.ts';
import { configureAudioSchedulerForTests, waitForAudioSchedulerIdle, waitForStudioJob } from './audioScheduler.ts';
import { withGenerationSlot } from './generationGate.ts';
import { configureRunStorageForTests, mutateRun, readRun, saveRun } from './storage.ts';
import { configureStudioJobStorageForTests, createStudioJob, readStudioJob } from './studioJobs.ts';

// Guarantee hermetic tests: any accidental text-provider call fails loudly
// instead of spending quota (dotenv does not override pre-set variables).
process.env.GEMINI_API_KEY = 'invalid-test-key';

// Configure isolated storage BEFORE importing the app so its startup recovery
// runs against the temp directories instead of real outputs.
const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'jlpt-studio-api-'));
configureStudioJobStorageForTests(path.join(storageRoot, 'jobs'));
configureRunStorageForTests(path.join(storageRoot, 'runs'));
const { app } = await import('./index.ts');

let server: Server;
let baseUrl = '';

before(() => new Promise<void>((resolve) => {
  server = app.listen(0, '127.0.0.1', () => {
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    resolve();
  });
}));

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(storageRoot, { recursive: true, force: true });
});

async function api<T>(pathname: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }
  });
  return { status: response.status, body: await response.json() as T };
}

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

test('audio batch commands are idempotent and enforce the job lifecycle', async () => {
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
    await saveRun(run('run-api-batch', 3));
    const batchRequest = {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: 'api-batch-1',
        items: [1, 2, 3].map((n) => ({ runId: 'run-api-batch', conversationId: `convo-0${n}` }))
      })
    };
    const first = await api<{ job: StudioJob }>('/api/studio/audio-batches', batchRequest);
    assert.equal(first.status, 202);
    const duplicate = await api<{ job: StudioJob }>('/api/studio/audio-batches', batchRequest);
    assert.equal(duplicate.body.job.id, first.body.job.id);

    // Resuming an in-flight job is a no-op, not a restart.
    const resumeRunning = await api<{ job: StudioJob }>(`/api/studio/jobs/${first.body.job.id}/resume`, { method: 'POST' });
    assert.equal(resumeRunning.status, 202);
    assert.equal(resumeRunning.body.job.status, 'running');

    const paused = await api<{ job: StudioJob }>(`/api/studio/jobs/${first.body.job.id}/pause`, { method: 'POST' });
    assert.equal(paused.body.job.status, 'pausing');
    release();
    const settled = await waitForStudioJob(first.body.job.id);
    assert.equal(settled.status, 'paused');
    assert.match(settled.stageLabel, /Audio paused - 1\/3 generated/);

    const cancelled = await api<{ job: StudioJob }>(`/api/studio/jobs/${first.body.job.id}/cancel`, { method: 'POST' });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.job.status, 'cancelled');
    assert.match(cancelled.body.job.stageLabel, /Discarded with 1\/3 audio generated/);

    const resumeCancelled = await api<{ error: string }>(`/api/studio/jobs/${first.body.job.id}/resume`, { method: 'POST' });
    assert.equal(resumeCancelled.status, 409);
    await waitForAudioSchedulerIdle();
  } finally {
    configureAudioSchedulerForTests();
  }
});

test('resume rejects completed batches instead of re-running them', async () => {
  configureAudioSchedulerForTests({
    concurrency: 1,
    executor: async (_runId, item) => ({ fileName: `${item.id}.wav`, filePath: `${item.id}.wav` })
  });
  try {
    await saveRun(run('run-api-complete', 2));
    const started = await api<{ job: StudioJob }>('/api/studio/audio-batches', {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: 'api-batch-complete',
        items: [1, 2].map((n) => ({ runId: 'run-api-complete', conversationId: `convo-0${n}` }))
      })
    });
    const completed = await waitForStudioJob(started.body.job.id);
    await waitForAudioSchedulerIdle();
    assert.equal(completed.status, 'succeeded');

    const resumeSucceeded = await api<{ error: string }>(`/api/studio/jobs/${started.body.job.id}/resume`, { method: 'POST' });
    assert.equal(resumeSucceeded.status, 409);
    assert.match(resumeSucceeded.body.error, /already completed/);
  } finally {
    configureAudioSchedulerForTests();
  }
});

test('generation job commands pause before start, discard, and block revival', async () => {
  const timestamp = new Date().toISOString();
  const job = await createStudioJob({
    id: 'gen-api-1',
    idempotencyKey: 'gen-api-1',
    kind: 'run-generation',
    status: 'queued',
    title: 'Set 1 generation',
    detail: '4 conversations',
    stageLabel: 'Queued for generation',
    setNumber: 1,
    revision: 1,
    progress: { completed: 0, total: 1, queued: 1 },
    stages: [{ id: 'generator', label: 'Generating initial set', status: 'pending' }],
    request: {},
    createdAt: timestamp,
    updatedAt: timestamp
  });

  const paused = await api<{ job: StudioJob }>(`/api/studio/jobs/${job.id}/pause`, { method: 'POST' });
  assert.equal(paused.body.job.status, 'paused');
  assert.equal(paused.body.job.stageLabel, 'Paused before start');

  const cancelled = await api<{ job: StudioJob }>(`/api/studio/jobs/${job.id}/cancel`, { method: 'POST' });
  assert.equal(cancelled.body.job.status, 'cancelled');

  const resumed = await api<{ error: string }>(`/api/studio/jobs/${job.id}/resume`, { method: 'POST' });
  assert.equal(resumed.status, 409);
  assert.equal((await readStudioJob(job.id)).status, 'cancelled');
});

test('workflow start persists an immediately visible shell and lost-response retries attach to it', async () => {
  // Hold the generation slot so the queued runner can never reach a provider.
  let releaseSlot!: () => void;
  const slotHeld = new Promise<void>((resolve) => { releaseSlot = resolve; });
  const slotDone = withGenerationSlot(() => slotHeld);
  try {
    const body = JSON.stringify({
      setNumber: 1,
      conversationCount: 6,
      audioCount: 0,
      audioMode: 'fixed',
      textModelId: 'gemini',
      idempotencyKey: 'api-workflow-visibility'
    });
    const first = await api<{ job: { id: string } }>('/api/workflow/start', { method: 'POST', body });
    assert.equal(first.status, 202);

    // Durably queued and immediately visible as a job-backed run shell.
    const snapshot = await api<{ snapshot: { jobs: StudioJob[]; runSummaries: Array<{ kind: string; jobId?: string; status?: string; stageLabel?: string }> } }>('/api/studio/snapshot');
    const studioJob = snapshot.body.snapshot.jobs.find((item) => item.idempotencyKey === 'api-workflow-visibility');
    assert.ok(studioJob, 'job missing from snapshot');
    assert.equal(studioJob!.status, 'queued');
    const shell = snapshot.body.snapshot.runSummaries.find((item) => item.kind === 'job' && item.jobId === studioJob!.id);
    assert.ok(shell, 'run shell missing from snapshot');
    assert.equal(shell!.status, 'queued');

    // A retry after a lost response returns the same workflow job.
    const retry = await api<{ job: { id: string } }>('/api/workflow/start', { method: 'POST', body });
    assert.equal(retry.status, 202);
    assert.equal(retry.body.job.id, studioJob!.id);

    // Discard the waiting job so releasing the slot starts no provider work.
    const cancelled = await api<{ job: StudioJob }>(`/api/studio/jobs/${studioJob!.id}/cancel`, { method: 'POST' });
    assert.equal(cancelled.body.job.status, 'cancelled');
  } finally {
    releaseSlot();
    await slotDone;
  }
});

test('workflow resume reuses generator and balancer checkpoints and finishes audio without new text calls', async () => {
  configureAudioSchedulerForTests({
    concurrency: 2,
    executor: async (_runId, item) => ({ fileName: `${item.id}.wav`, filePath: `${item.id}.wav` })
  });
  try {
    const timestamp = new Date().toISOString();
    const exchange = (label: string): LlmExchange => ({
      id: `exchange-${label}`,
      provider: 'gemini',
      model: 'test',
      label: 'Test',
      prompt: 'prompt',
      output: 'output',
      requestedAt: timestamp,
      receivedAt: timestamp,
      status: 'complete'
    });
    const primaryConversations = [conversation(1), conversation(2)];
    const complementConversations = [conversation(3)];
    const workflow: WorkflowJob = {
      id: 'workflow-resume-1',
      status: 'running',
      setNumber: 1,
      primaryConversationCount: 4,
      balanceConversationCount: 2,
      requestedTotalConversationCount: 6,
      audioRequestedCount: 2,
      audioGeneratedCount: 0,
      audioErrors: [],
      nodes: [
        { id: 'generator', kind: 'generator', title: 'Generate', status: 'done' },
        { id: 'balancer', kind: 'balancer', title: 'Balance', status: 'done' },
        { id: 'audio-1', kind: 'audio', title: 'Audio 1', status: 'pending' },
        { id: 'audio-2', kind: 'audio', title: 'Audio 2', status: 'pending' }
      ],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await createStudioJob({
      id: 'workflow-resume-1',
      idempotencyKey: 'workflow-resume-1',
      kind: 'workflow-generation',
      status: 'interrupted',
      title: 'Set 1 generation',
      detail: '6 conversations',
      stageLabel: 'Interrupted',
      setNumber: 1,
      runId: 'run-workflow-resume',
      revision: 1,
      progress: { completed: 0, total: 2, queued: 2 },
      stages: [
        { id: 'generator', label: 'Generating initial set', status: 'succeeded' },
        { id: 'balancer', label: 'Balancing set', status: 'succeeded' },
        { id: 'audio', label: 'Generating audio', status: 'interrupted' }
      ],
      request: { setNumber: 1, conversationCount: 6, audioCount: 2, audioMode: 'fixed', textModelId: 'gemini' },
      workflow,
      checkpoint: {
        primary: { exchange: exchange('primary'), conversations: primaryConversations },
        complement: { exchange: exchange('complement'), conversations: complementConversations }
      },
      createdAt: timestamp,
      updatedAt: timestamp
    });

    const resumed = await api<{ job: StudioJob }>('/api/studio/jobs/workflow-resume-1/resume', { method: 'POST' });
    assert.equal(resumed.status, 202);

    const completed = await waitForStudioJob('workflow-resume-1');
    await waitForAudioSchedulerIdle();
    assert.equal(completed.status, 'succeeded');
    // The parent settles before the runner writes its final audit payload; wait
    // for the workflow to report complete before asserting on it.
    let final = await readStudioJob('workflow-resume-1');
    for (let attempt = 0; attempt < 50 && final.workflow?.status !== 'complete'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      final = await readStudioJob('workflow-resume-1');
    }
    assert.equal(final.workflow?.status, 'complete');
    assert.equal(final.workflow?.audioGeneratedCount, 2);
    assert.equal(final.workflow?.nodes.filter((node) => node.kind === 'audio' && node.status === 'done').length, 2);

    // The run was materialized from the checkpoints, not from new provider calls.
    const run = await readRun('run-workflow-resume');
    assert.equal(run.conversations.length, 3);
    assert.equal(run.conversations.filter((item) => item.audioFileName).length, 2);
    assert.equal(run.llmExchanges?.length, 2);
  } finally {
    configureAudioSchedulerForTests();
  }
});

test('concurrent run reads never surface transient replacement errors', async () => {
  await saveRun(run('run-stress', 3));
  let failures = 0;
  const writer = (async () => {
    for (let index = 0; index < 200; index += 1) {
      await mutateRun('run-stress', (current) => ({ ...current, updatedAt: new Date().toISOString() }));
    }
  })();
  const readers = Array.from({ length: 4 }, () => (async () => {
    for (let index = 0; index < 200; index += 1) {
      try {
        await readRun('run-stress');
      } catch {
        failures += 1;
      }
    }
  })());
  await Promise.all([writer, ...readers]);
  assert.equal(failures, 0);
});
