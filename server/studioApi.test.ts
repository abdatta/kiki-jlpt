import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import type { LlmExchange, PracticeConversation, PracticeRun, StudioJob, WorkflowJob, WorkflowRepairResponse } from '../shared/types.ts';
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
const { app, configureConversationJsonGeneratorForTests, configureQualityStructuredJsonInvokerForTests } = await import('./index.ts');

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

function generatedPayload(japaneseLines: string[], declarations: unknown[][] = []): { conversations: unknown[] } {
  return {
    conversations: japaneseLines.map((japanese, index) => ({
      title: `Generated ${index + 1}`,
      scene: 'Test scene.',
      sampleContext: 'Test context.',
      text: [{ speaker: 'Speaker 1', tags: ['slow'], japanese }],
      listeningQuestions: ['What is discussed?'],
      answerKey: ['A test topic.'],
      declaredNonVocabularyTerms: declarations[index] ?? [],
      englishTranslation: [{ speaker: 'Speaker 1', english: 'Test line.' }]
    }))
  };
}

function generatorResult(payload: unknown, label = 'mock'): { parsed: unknown; output: string; stats: { label: string } } {
  return {
    parsed: payload,
    output: JSON.stringify(payload),
    stats: { label }
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

test('direct generation succeeds without repair when Set 3 output has no true OOV', async () => {
  let calls = 0;
  configureConversationJsonGeneratorForTests(async () => {
    calls += 1;
    return generatorResult(generatedPayload([
    '学校です。',
    '英語です。',
    '銀行です。',
    'ペンです。'
  ], []), 'clean');
  });
  try {
    const response = await api<{ run: PracticeRun }>('/api/generate', {
      method: 'POST',
      body: JSON.stringify({ setNumber: 3, conversationCount: 4, textModelId: 'gemini' })
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.run.analytics.outOfAllowedCount, 0);
    assert.equal(response.body.run.llmExchanges?.length, 2);
    assert.equal(response.body.run.conversations.every((item) => item.quality === 'good'), true);
  } finally {
    configureConversationJsonGeneratorForTests();
  }
});

test('direct generation repairs true Set 3 OOV before saving', async () => {
  let calls = 0;
  configureConversationJsonGeneratorForTests(async () => {
    calls += 1;
    return calls === 1
      ? generatorResult(generatedPayload(['学校は難しいです。', '英語です。', '銀行です。', 'ペンです。']), 'initial')
      : generatorResult(generatedPayload(['学校です。', '英語です。', '銀行です。', 'ペンです。']), 'repair');
  });
  try {
    const response = await api<{ run: PracticeRun }>('/api/generate', {
      method: 'POST',
      body: JSON.stringify({ setNumber: 3, conversationCount: 4, textModelId: 'gemini' })
    });

    assert.equal(response.status, 200);
    assert.equal(calls, 3);
    assert.equal(response.body.run.analytics.outOfAllowedCount, 0);
    assert.equal(response.body.run.llmExchanges?.filter((item) => (item.stats as { repairCandidate?: number } | undefined)?.repairCandidate).length, 2);
    assert.match(response.body.run.llmExchanges?.find((item) => (item.stats as { repairCandidate?: number } | undefined)?.repairCandidate === 1)?.prompt ?? '', /Authoritative per-conversation audit findings/);
  } finally {
    configureConversationJsonGeneratorForTests();
  }
});

test('direct generation repairs true Set 2 OOV before saving', async () => {
  let calls = 0;
  configureConversationJsonGeneratorForTests(async () => {
    calls += 1;
    return calls === 1
      ? generatorResult(generatedPayload(['\u5b66\u6821\u3067\u3059\u3002', '\u306f\u3044\u3002', '\u3044\u3044\u3048\u3002', '\u3053\u308c\u3002']), 'set2-initial')
      : generatorResult(generatedPayload(['\u306f\u3044\u3002', '\u3044\u3044\u3048\u3002', '\u3053\u308c\u3002', '\u305d\u308c\u3002']), 'set2-repair');
  });
  try {
    const response = await api<{ run: PracticeRun }>('/api/generate', {
      method: 'POST',
      body: JSON.stringify({ setNumber: 2, conversationCount: 4, textModelId: 'gemini' })
    });

    assert.equal(response.status, 200);
    assert.equal(calls, 3);
    assert.equal(response.body.run.analytics.outOfAllowedCount, 0);
    assert.equal(response.body.run.llmExchanges?.filter((item) => (item.stats as { repairCandidate?: number } | undefined)?.repairCandidate).length, 2);
  } finally {
    configureConversationJsonGeneratorForTests();
  }
});

test('direct generation accepts declared cultural references without repair', async () => {
  let calls = 0;
  configureConversationJsonGeneratorForTests(async () => {
    calls += 1;
    return generatorResult(generatedPayload([
      '学校で寿司です。',
      '英語です。',
      '銀行です。',
      'ペンです。'
    ], [[{
      surface: '寿司',
      kind: 'cultural_reference',
      category: 'food',
      rationale: 'A common Japanese food.'
    }]]), 'culture');
  });
  try {
    const response = await api<{ run: PracticeRun }>('/api/generate', {
      method: 'POST',
      body: JSON.stringify({ setNumber: 3, conversationCount: 4, textModelId: 'gemini' })
    });

    assert.equal(response.status, 200);
    assert.equal(calls, 1);
    assert.equal(response.body.run.analytics.outOfAllowedCount, 0);
  } finally {
    configureConversationJsonGeneratorForTests();
  }
});

test('direct generation repairs rejected cultural-reference declarations', async () => {
  let calls = 0;
  configureConversationJsonGeneratorForTests(async () => {
    calls += 1;
    return calls === 1
      ? generatorResult(generatedPayload([
        '学校は難しいです。',
        '英語です。',
        '銀行です。',
        'ペンです。'
      ], [[{
        surface: '難しい',
        kind: 'cultural_reference',
        category: 'cultural_item',
        rationale: 'Incorrect ordinary adjective.'
      }]]), 'bad-declaration')
      : generatorResult(generatedPayload(['学校です。', '英語です。', '銀行です。', 'ペンです。']), 'repair');
  });
  try {
    const response = await api<{ run: PracticeRun }>('/api/generate', {
      method: 'POST',
      body: JSON.stringify({ setNumber: 3, conversationCount: 4, textModelId: 'gemini' })
    });

    assert.equal(response.status, 200);
    assert.equal(calls, 3);
    assert.equal(response.body.run.analytics.outOfAllowedCount, 0);
  } finally {
    configureConversationJsonGeneratorForTests();
  }
});

test('direct generation proceeds with best available batch when repair does not improve OOV', async () => {
  let calls = 0;
  configureConversationJsonGeneratorForTests(async () => {
    calls += 1;
    return generatorResult(generatedPayload([
    '学校は難しいです。',
    '英語です。',
    '銀行です。',
    'ペンです。'
    ]), calls === 1 ? 'initial-oov' : 'still-oov');
  });
  try {
    const response = await api<{ run: PracticeRun }>('/api/generate', {
      method: 'POST',
      body: JSON.stringify({ setNumber: 3, conversationCount: 4, textModelId: 'gemini' })
    });

    assert.equal(response.status, 200);
    assert.equal(calls, 3);
    assert.ok(response.body.run.analytics.outOfAllowedCount > 0);
    const repairExchanges = response.body.run.llmExchanges?.filter((item) => (item.stats as { repairCandidate?: number } | undefined)?.repairCandidate) ?? [];
    assert.equal(repairExchanges.length, 2);
    assert.match(repairExchanges[0]?.prompt ?? '', /Authoritative per-conversation audit findings/);
    assert.equal((repairExchanges[0]?.stats as { repairOutcome?: string } | undefined)?.repairOutcome, 'not_improved');
  } finally {
    configureConversationJsonGeneratorForTests();
  }
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

test('workflow generation quality warning preserves initial and repair LLM exchanges', async () => {
  configureConversationJsonGeneratorForTests(async () => generatorResult(generatedPayload([
    '学校は難しいです。',
    '英語です。',
    '銀行です。',
    'ペンです。'
  ]), 'workflow-still-oov'));
  try {
    const started = await api<{ job: StudioJob }>('/api/workflow/start', {
      method: 'POST',
      body: JSON.stringify({
        setNumber: 3,
        conversationCount: 6,
        audioCount: 0,
        audioMode: 'fixed',
        textModelId: 'gemini',
        idempotencyKey: 'api-workflow-auditable-quality-warning'
      })
    });
    assert.equal(started.status, 202);

    const completed = await waitForStudioJob(started.body.job.id);
    assert.equal(completed.status, 'succeeded');
    const generation = completed.workflow?.nodes.find((node) => node.id === 'initial:generation');
    const repairOne = completed.workflow?.nodes.find((node) => node.id === 'initial:repair-1');
    const audit = completed.workflow?.nodes.find((node) => node.id === 'initial:vocab-audit');
    assert.equal(generation?.status, 'done');
    assert.ok(generation?.startedAt);
    assert.match(String((generation?.input as { prompt?: string } | undefined)?.prompt ?? ''), /Return|conversation/i);
    assert.equal(repairOne?.status, 'done');
    assert.match(((repairOne?.output as { exchange?: LlmExchange } | undefined)?.exchange?.prompt) ?? '', /Authoritative per-conversation audit findings/);
    assert.ok((audit?.output as { summary?: { statLine?: string } } | undefined)?.summary?.statLine);
    const run = await readRun(completed.runId!);
    assert.ok(run.analytics.outOfAllowedCount > 0);
    assert.ok((run.llmExchanges?.length ?? 0) >= 4);
    assert.equal(completed.stageLabel, 'Complete');
    assert.equal(completed.workflow?.nodes.filter((node) => node.pass === 2).every((node) => node.status === 'skipped'), true);
  } finally {
    configureConversationJsonGeneratorForTests();
  }
});

test('final-audit warning pauses before audio and resume approves the checkpoint without repeating text calls', async () => {
  let textCalls = 0;
  let triageCalls = 0;
  configureConversationJsonGeneratorForTests(async () => {
    textCalls += 1;
    return generatorResult(generatedPayload(['\u306f\u3044\u3002', '\u3044\u3044\u3048\u3002', '\u3053\u308c\u3002', '\u305d\u308c\u3002']), `shortfall-${textCalls}`);
  });
  configureQualityStructuredJsonInvokerForTests(async (prompt) => {
    triageCalls += 1;
    const json = prompt.split('Conversations with authoritative evidence:\n')[1]?.split('\n\nReturn only valid JSON')[0] ?? '[]';
    const conversations = JSON.parse(json) as Array<{ conversationId: string }>;
    const droppedId = conversations.at(-1)?.conversationId;
    const verdicts = conversations.map((conversation) => ({
      conversationId: conversation.conversationId,
      verdict: conversation.conversationId === droppedId ? 'regenerate' : 'pass',
      rationale: conversation.conversationId === droppedId ? 'Structurally unusable test fixture.' : 'Natural test fixture.',
      flags: conversation.conversationId === droppedId ? ['structural'] : []
    }));
    return { parsed: { verdicts }, output: JSON.stringify({ verdicts }) };
  });
  configureAudioSchedulerForTests({
    concurrency: 2,
    executor: async (_runId, item) => ({ fileName: `${item.id}.wav`, filePath: `${item.id}.wav` })
  });
  try {
    const started = await api<{ job: StudioJob }>('/api/workflow/start', {
      method: 'POST',
      body: JSON.stringify({ setNumber: 1, conversationCount: 6, audioCount: 2, audioMode: 'fixed', textModelId: 'gemini', idempotencyKey: 'api-workflow-final-audit-pause' })
    });
    const paused = await waitForStudioJob(started.body.job.id);
    assert.equal(paused.status, 'paused');
    assert.match(paused.stageLabel, /accepted 4 of 6 requested/i);
    assert.equal(paused.workflow?.nodes.find((node) => node.id === 'final-audit')?.status, 'done');
    assert.equal(paused.workflow?.nodes.filter((node) => node.kind === 'audio').every((node) => node.status === 'pending'), true);
    assert.equal((paused.workflow?.run?.finalTextAudit?.outcome), 'pause');

    const beforeResumeTextCalls = textCalls;
    const resumed = await api<{ job: StudioJob }>(`/api/studio/jobs/${paused.id}/resume`, { method: 'POST' });
    assert.equal(resumed.status, 202);
    const completed = await waitForStudioJob(paused.id);
    await waitForAudioSchedulerIdle();
    assert.equal(completed.status, 'succeeded');
    assert.equal(textCalls, beforeResumeTextCalls);
    assert.equal(triageCalls, 4);
    let finalized = await readStudioJob(paused.id);
    for (let attempt = 0; attempt < 50 && finalized.workflow?.status !== 'complete'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      finalized = await readStudioJob(paused.id);
    }
    assert.equal(finalized.workflow?.status, 'complete');
    const saved = await readRun(finalized.runId!);
    assert.equal(saved.conversations.length, 4);
    assert.equal(saved.conversations.filter((item) => item.audioFileName).length, 2);
  } finally {
    configureAudioSchedulerForTests();
    configureConversationJsonGeneratorForTests();
    configureQualityStructuredJsonInvokerForTests();
  }
});

test('workflow repair rerun updates saved audit and applies improved conversations', async () => {
  const timestamp = new Date().toISOString();
  const oovConversations = [1, 2, 3, 4].map((number) => ({
    ...conversation(number),
    text: [{ speaker: 'Speaker 1' as const, tags: ['slow'], japanese: '\u5b66\u6821\u306f\u96e3\u3057\u3044\u3067\u3059\u3002' }]
  }));
  const initialExchange: LlmExchange = {
    id: 'repair-rerun-initial',
    provider: 'gemini',
    model: 'test',
    label: 'Test',
    prompt: 'original prompt',
    output: JSON.stringify(generatedPayload(oovConversations.map((item) => item.text[0].japanese))),
    requestedAt: timestamp,
    receivedAt: timestamp,
    status: 'complete'
  };
  const failedRepairExchange: LlmExchange = {
    id: 'repair-rerun-failed',
    provider: 'gemini',
    model: 'test',
    label: 'Test',
    prompt: 'repair prompt',
    requestedAt: timestamp,
    receivedAt: timestamp,
    status: 'failed',
    error: 'provider unavailable',
    stats: {
      repairAttempt: 1,
      repairOutcome: 'provider_failed',
      selectedForFinal: false
    }
  };
  const saved = run('run-workflow-repair-rerun', 4);
  saved.setNumber = 3;
  saved.conversations = oovConversations;
  saved.workflowAudit = {
    jobId: 'workflow-repair-rerun',
    status: 'complete',
    primaryConversationCount: 4,
    balanceConversationCount: 0,
    requestedTotalConversationCount: 4,
    audioRequestedCount: 0,
    audioGeneratedCount: 0,
    audioErrors: [],
    nodes: [{
      id: 'generator',
      kind: 'generator',
      title: 'Generating Initial Set',
      status: 'done',
      startedAt: timestamp,
      completedAt: timestamp,
      input: {
        prompt: initialExchange.prompt,
        model: saved.textModel
      },
      output: {
        exchange: initialExchange,
        exchanges: [initialExchange, failedRepairExchange],
        conversations: oovConversations
      }
    }],
    createdAt: timestamp,
    updatedAt: timestamp
  };
  saved.llmExchanges = [initialExchange, failedRepairExchange];
  await saveRun(saved);

  let calls = 0;
  configureConversationJsonGeneratorForTests(async () => {
    calls += 1;
    return generatorResult(generatedPayload([
      '\u5b66\u6821\u3067\u3059\u3002',
      '\u82f1\u8a9e\u3067\u3059\u3002',
      '\u9280\u884c\u3067\u3059\u3002',
      '\u30da\u30f3\u3067\u3059\u3002'
    ]), 'rerun-repair');
  });
  try {
    const response = await api<WorkflowRepairResponse>('/api/runs/run-workflow-repair-rerun/workflow-nodes/generator/repair', { method: 'POST' });
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
    assert.equal(response.body.repairApplied, true);
    assert.equal(response.body.repairOutcome, 'improved');
    assert.equal(response.body.run.analytics.outOfAllowedCount, 0);
    const generator = response.body.run.workflowAudit?.nodes.find((node) => node.id === 'generator');
    const output = generator?.output as { exchanges?: LlmExchange[]; conversations?: PracticeConversation[] } | undefined;
    assert.equal(output?.exchanges?.length, 2);
    assert.equal((output?.exchanges?.[1].stats as { repairOutcome?: string; selectedForFinal?: boolean } | undefined)?.repairOutcome, 'improved');
    assert.equal((output?.exchanges?.[1].stats as { repairOutcome?: string; selectedForFinal?: boolean } | undefined)?.selectedForFinal, true);
    assert.equal(output?.conversations?.[0].id, 'convo-01');
    assert.equal(output?.conversations?.[0].text[0].japanese, '\u5b66\u6821\u3067\u3059\u3002');
    assert.equal(response.body.run.llmExchanges?.length, 2);
  } finally {
    configureConversationJsonGeneratorForTests();
  }
});

test('workflow provider failure preserves partial LLM output and transport metadata', async () => {
  configureConversationJsonGeneratorForTests(async () => {
    const error = new Error('Codex stream terminated while reading the generation response.');
    Object.assign(error, {
      partialOutput: 'data: {"type":"response.output_text.delta","delta":"{\\"conversations\\":["}',
      stats: {
        transport: 'codex-stream',
        streamTerminated: true,
        partialResponseBytes: 72,
        partialStreamEventCount: 1
      }
    });
    throw error;
  });
  try {
    const started = await api<{ job: StudioJob }>('/api/workflow/start', {
      method: 'POST',
      body: JSON.stringify({
        setNumber: 3,
        conversationCount: 6,
        audioCount: 0,
        audioMode: 'fixed',
        textModelId: 'gemini',
        idempotencyKey: 'api-workflow-auditable-provider-failure'
      })
    });
    assert.equal(started.status, 202);

    const failed = await waitForStudioJob(started.body.job.id);
    assert.equal(failed.status, 'failed');
    const generator = failed.workflow?.nodes.find((node) => node.id === 'initial:generation');
    const output = generator?.output as { exchange?: LlmExchange } | undefined;
    assert.equal(generator?.status, 'error');
    assert.equal(output?.exchange?.status, 'failed');
    assert.match(output?.exchange?.output ?? '', /response\.output_text\.delta/);
    assert.equal((output?.exchange?.stats as { streamTerminated?: boolean } | undefined)?.streamTerminated, true);
    assert.equal(failed.workflow?.nodes.some((node) => node.status === 'pending'), false);
    assert.ok((failed.workflow?.nodes.filter((node) => node.status === 'skipped').length ?? 0) > 0);
  } finally {
    configureConversationJsonGeneratorForTests();
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
    const primaryExchange = exchange('primary');
    const primaryRepairExchange = exchange('primary-repair');
    const complementExchange = exchange('complement');
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
        primary: { exchange: primaryExchange, exchanges: [primaryExchange, primaryRepairExchange], conversations: primaryConversations },
        complement: { exchange: complementExchange, exchanges: [complementExchange], conversations: complementConversations }
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
    assert.equal(run.llmExchanges?.length, 3);
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
