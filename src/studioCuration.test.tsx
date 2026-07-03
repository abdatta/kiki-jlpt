import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AiCurationRecommendation, ConversationCurationEvidence, PracticeConversation, StudioJob } from '../shared/types.ts';
import { AddAllProgressModal } from './components/AddAllProgressModal.tsx';
import { AudioProgressStage } from './components/AudioProgressStage.tsx';
import { AiRecommendationReason, CurationEvidencePanel } from './components/CurationEvidence.tsx';
import { StudioBackgroundJobs } from './components/StudioBackgroundJobs.tsx';
import { shouldNotifyJobEvent } from './studioNotifications.ts';

const evidence: ConversationCurationEvidence = {
  evidenceVersion: '1',
  setNumber: 2,
  currentSetTotal: 98,
  currentSetUniqueCount: 3,
  currentSetUniqueWords: ['読む', '見る', '行く'],
  allowedVocabTotal: 195,
  allowedVocabUniqueCount: 8,
  allowedVocabUniqueWords: ['本', '読む', '見る', '行く', '私', '今日', '家', '友達'],
  vocabularyOccurrences: { 読む: 2, 見る: 1, 行く: 1 },
  outOfVocabularyUniqueCount: 1,
  outOfVocabularyUniqueWords: ['猫'],
  outOfVocabularyOccurrenceCount: 2
};

const conversation: PracticeConversation = {
  id: 'convo-01',
  number: 1,
  title: 'Test',
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
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
};

test('Studio evidence summary renders current, cumulative, and OOV measurements', () => {
  const html = renderToStaticMarkup(<CurationEvidencePanel evidence={evidence} />);

  assert.match(html, /3.*Set 2/);
  assert.match(html, /8.*allowed/);
  assert.match(html, /1.*OOV/);
  assert.match(html, /3\/98/);
  assert.match(html, /1 unique, 2 uses/);
  assert.match(html, /猫/);
});

test('Studio AI recommendation renders rationale, strengths, and concerns', () => {
  const recommendation: AiCurationRecommendation = {
    rank: 1,
    candidateKey: 'run-1:convo-01',
    sourceRunId: 'run-1',
    sourceConversationId: 'convo-01',
    rationale: 'Adds a natural reading scene.',
    strengths: ['Clear target context'],
    concerns: ['One question is vague'],
    contribution: { uncoveredWords: ['読む'], underexposedWords: [], currentSetWords: ['読む'] },
    evidence,
    conversation
  };
  const html = renderToStaticMarkup(<AiRecommendationReason recommendation={recommendation} />);

  assert.match(html, /Adds a natural reading scene/);
  assert.match(html, /Clear target context/);
  assert.match(html, /One question is vague/);
});

test('Studio bulk-add modal uses LLM Audit audio failure and stopped states', () => {
  const html = renderToStaticMarkup(<AddAllProgressModal
    progress={{
      stage: 'failed',
      error: 'Some audio could not be generated.',
      items: [
        {
          candidateKey: 'run-1:convo-01',
          title: 'Ready conversation',
          audioStatus: 'done',
          audioDetail: 'Already generated',
          libraryStatus: 'pending'
        },
        {
          candidateKey: 'run-1:convo-02',
          title: 'Failed conversation',
          audioStatus: 'error',
          libraryStatus: 'pending',
          error: 'Audio provider unavailable.'
        },
        {
          candidateKey: 'run-1:convo-03',
          title: 'Stopped conversation',
          audioStatus: 'skipped',
          libraryStatus: 'pending'
        }
      ]
    }}
    onClose={() => undefined}
    onRun={() => undefined}
    onPause={() => undefined}
  />);

  assert.match(html, /Add all recommendations/);
  assert.match(html, /Some audio could not be generated/);
  assert.match(html, /Audio Generation Failed/);
  assert.match(html, /1 of 3 audio conversations done/);
  assert.match(html, /Already generated/);
  assert.match(html, /Audio provider unavailable/);
  assert.match(html, /Skipped after failure/);
  assert.match(html, /Retry/);
  assert.doesNotMatch(html, /Adding to Library/);
});

test('Studio bulk-add modal transitions from shared audio progress to separate Library progress', () => {
  const html = renderToStaticMarkup(<AddAllProgressModal
    progress={{
      stage: 'library',
      items: [
        {
          candidateKey: 'run-1:convo-01',
          title: 'Existing conversation',
          audioStatus: 'done',
          audioDetail: 'Already generated',
          libraryStatus: 'done',
          libraryDetail: 'Already added'
        },
        {
          candidateKey: 'run-1:convo-02',
          title: 'New conversation',
          audioStatus: 'done',
          audioDetail: 'Audio ready',
          libraryStatus: 'processing',
          libraryDetail: 'Adding'
        }
      ]
    }}
    onClose={() => undefined}
    onRun={() => undefined}
    onPause={() => undefined}
  />);

  assert.match(html, /Generated Audio/);
  assert.match(html, /2 of 2 audio conversations done/);
  assert.match(html, /Adding to Library/);
  assert.match(html, /1 of 2 conversations added/);
  assert.match(html, /Already added/);
  assert.match(html, />Adding</);
});

test('shared LLM Audit audio stage renders the same stopped status used by Add All', () => {
  const items = [
    { id: 'one', title: 'Ready', detail: 'Audio ready', status: 'done' as const },
    { id: 'two', title: 'Stopped', detail: 'Skipped after failure', status: 'skipped' as const }
  ];
  const auditHtml = renderToStaticMarkup(<AudioProgressStage items={items} state="idle" />);
  const addAllHtml = renderToStaticMarkup(<AddAllProgressModal
    progress={{
      stage: 'failed',
      error: 'Audio generation stopped.',
      items: items.map((item) => ({
        candidateKey: item.id,
        title: item.title,
        audioStatus: item.status,
        audioDetail: item.detail,
        libraryStatus: 'pending'
      }))
    }}
    onClose={() => undefined}
    onRun={() => undefined}
    onPause={() => undefined}
  />);

  assert.match(auditHtml, /Audio Generation Stopped/);
  assert.match(addAllHtml, /Audio Generation Stopped/);
  assert.match(auditHtml, /1 of 2 audio conversations done/);
  assert.match(addAllHtml, /1 of 2 audio conversations done/);
});

test('Studio bulk-add modal requires start and exposes the pause lifecycle', () => {
  const baseItem = {
    candidateKey: 'run-1:convo-01',
    title: 'Test conversation',
    libraryStatus: 'pending' as const
  };
  const handlers = {
    onClose: () => undefined,
    onRun: () => undefined,
    onPause: () => undefined
  };
  const readyHtml = renderToStaticMarkup(<AddAllProgressModal
    progress={{ stage: 'ready', items: [{ ...baseItem, audioStatus: 'pending' }] }}
    {...handlers}
  />);
  const runningHtml = renderToStaticMarkup(<AddAllProgressModal
    progress={{ stage: 'audio', items: [{ ...baseItem, audioStatus: 'processing' }] }}
    {...handlers}
  />);
  const pausingHtml = renderToStaticMarkup(<AddAllProgressModal
    progress={{ stage: 'pausing', items: [{ ...baseItem, audioStatus: 'processing' }] }}
    {...handlers}
  />);
  const pausedHtml = renderToStaticMarkup(<AddAllProgressModal
    progress={{ stage: 'paused', items: [{ ...baseItem, audioStatus: 'paused' }] }}
    {...handlers}
  />);
  const allReadyHtml = renderToStaticMarkup(<AddAllProgressModal
    progress={{ stage: 'ready', items: [{ ...baseItem, audioStatus: 'done', audioDetail: 'Already generated' }] }}
    {...handlers}
  />);

  assert.match(readyHtml, /Ready to Generate Audio/);
  assert.match(readyHtml, /Start generation/);
  assert.doesNotMatch(readyHtml, />Pause</);
  assert.match(runningHtml, /Generating Audio/);
  assert.match(runningHtml, />Pause</);
  assert.match(pausingHtml, /Pausing Audio/);
  assert.match(pausingHtml, /Pausing\.\.\./);
  assert.match(pausedHtml, /Audio Generation Paused/);
  assert.match(pausedHtml, /Resume/);
  assert.match(allReadyHtml, /Generated Audio/);
  assert.match(allReadyHtml, /Add to Library/);
});

test('Studio background work renders standalone jobs, queue counts, pause controls, and terminal toasts', () => {
  const timestamp = new Date().toISOString();
  const standalone: StudioJob = {
    id: 'audio-one',
    idempotencyKey: 'audio-one',
    kind: 'audio-child',
    status: 'running',
    title: 'Conversation One',
    detail: 'Set 1',
    stageLabel: 'Generating audio',
    revision: 2,
    progress: { completed: 0, total: 1, running: 1 },
    stages: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const batch: StudioJob = {
    ...standalone,
    id: 'batch-one',
    idempotencyKey: 'batch-one',
    kind: 'audio-batch',
    title: 'Set 1 audio',
    stageLabel: '2/5 audio generated'
  };
  const queued: StudioJob = {
    ...standalone,
    id: 'queued-child',
    idempotencyKey: 'queued-child',
    parentJobId: batch.id,
    status: 'queued',
    title: 'Queued conversation',
    stageLabel: 'Queued for audio'
  };
  const paused: StudioJob = {
    ...batch,
    id: 'paused-batch',
    idempotencyKey: 'paused-batch',
    status: 'paused',
    title: 'Paused Set 2 audio',
    stageLabel: 'Audio paused'
  };
  const html = renderToStaticMarkup(<StudioBackgroundJobs
    jobs={[standalone, batch, queued, paused]}
    connected
    toasts={[{ id: 'toast', tone: 'success', title: 'Complete', detail: 'Audio complete' }]}
    onPause={() => undefined}
    onResume={() => undefined}
    onCancel={() => undefined}
    onFocus={() => undefined}
    onDismissToast={() => undefined}
  />);

  assert.match(html, /aria-label="Background work"/);
  assert.match(html, /class="[^"]*\bspin\b[^"]*"/);
  assert.match(html, /Conversation One/);
  assert.match(html, /2\/5 audio generated/);
  assert.match(html, /1 queued/);
  assert.match(html, /Open in Studio/);
  assert.match(html, /backgroundJobBarFill indeterminate/);
  assert.match(html, /Pause background job/);
  assert.match(html, /Resume background job/);
  assert.match(html, /Discard remaining work/);
  assert.match(html, /Complete/);
  assert.match(html, /Audio complete/);

  const pausedOnlyHtml = renderToStaticMarkup(<StudioBackgroundJobs
    jobs={[paused]}
    connected
    toasts={[]}
    onPause={() => undefined}
    onResume={() => undefined}
    onCancel={() => undefined}
    onFocus={() => undefined}
    onDismissToast={() => undefined}
  />);

  assert.match(pausedOnlyHtml, /Paused Set 2 audio/);
  assert.doesNotMatch(pausedOnlyHtml, /class="[^"]*\bspin\b[^"]*"/);
  assert.doesNotMatch(pausedOnlyHtml, /indeterminate/);
});

test('background work tray orders working first, pins interrupted parents with resume and discard, and shows queued waiting state', () => {
  const timestamp = new Date().toISOString();
  const base: StudioJob = {
    id: 'base',
    idempotencyKey: 'base',
    kind: 'workflow-generation',
    status: 'running',
    title: 'Base',
    detail: 'Test',
    stageLabel: 'Generating initial set',
    revision: 1,
    progress: { completed: 0, total: 1 },
    stages: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const runningGeneration: StudioJob = { ...base, id: 'gen-running', idempotencyKey: 'gen-running', title: 'Running generation', createdAt: '2026-07-02T10:00:00.000Z' };
  const queuedGeneration: StudioJob = { ...base, id: 'gen-queued', idempotencyKey: 'gen-queued', kind: 'library-complement', status: 'queued', title: 'Waiting generation', stageLabel: 'Waiting for earlier generation', createdAt: '2026-07-02T09:00:00.000Z' };
  const interruptedBatch: StudioJob = { ...base, id: 'batch-interrupted', idempotencyKey: 'batch-interrupted', kind: 'audio-batch', status: 'interrupted', title: 'Interrupted batch', stageLabel: 'Interrupted - 2/9 generated', progress: { completed: 2, total: 9 }, createdAt: '2026-07-02T08:00:00.000Z' };

  const html = renderToStaticMarkup(<StudioBackgroundJobs
    jobs={[queuedGeneration, interruptedBatch, runningGeneration]}
    connected
    toasts={[]}
    onPause={() => undefined}
    onResume={() => undefined}
    onCancel={() => undefined}
    onFocus={() => undefined}
    onDismissToast={() => undefined}
  />);

  // Working job renders first, then the FIFO queue, then resumable work.
  assert.ok(html.indexOf('Running generation') < html.indexOf('Waiting generation'));
  assert.ok(html.indexOf('Waiting generation') < html.indexOf('Interrupted batch'));

  // The interrupted parent stays pinned with count-bearing label plus resume and discard controls.
  assert.match(html, /Interrupted - 2\/9 generated/);
  assert.match(html, /Resume background job/);
  assert.match(html, /Discard remaining work/);

  // The queued entry shows the waiting state without any activity bar of its own.
  const queuedRow = html.slice(html.indexOf('Waiting generation'), html.indexOf('Interrupted batch'));
  assert.match(queuedRow, /Waiting for earlier generation/);
  assert.doesNotMatch(queuedRow, /backgroundJobBar/);
});

test('job notification policy toasts top-level terminal jobs only, for live and hydration alike', () => {
  const timestamp = new Date().toISOString();
  const base: StudioJob = {
    id: 'parent-1',
    idempotencyKey: 'parent-1',
    kind: 'audio-batch',
    status: 'succeeded',
    title: 'Batch',
    detail: 'Test',
    stageLabel: 'Audio complete',
    revision: 3,
    progress: { completed: 2, total: 2 },
    stages: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };

  // Top-level terminal jobs notify on both paths.
  assert.equal(shouldNotifyJobEvent(base, 'live'), true);
  assert.equal(shouldNotifyJobEvent(base, 'hydration'), true);
  assert.equal(shouldNotifyJobEvent({ ...base, status: 'interrupted' }, 'hydration'), true);

  // Children are summarized by their parent - never notify on their own.
  assert.equal(shouldNotifyJobEvent({ ...base, id: 'child-1', kind: 'audio-child', parentJobId: 'parent-1' }, 'live'), false);
  assert.equal(shouldNotifyJobEvent({ ...base, id: 'child-2', kind: 'audio-child', dependentParentJobIds: ['parent-1'] }, 'hydration'), false);

  // Non-terminal states never notify; discards notify live only.
  assert.equal(shouldNotifyJobEvent({ ...base, status: 'running' }, 'live'), false);
  assert.equal(shouldNotifyJobEvent({ ...base, status: 'cancelled' }, 'live'), true);
  assert.equal(shouldNotifyJobEvent({ ...base, status: 'cancelled' }, 'hydration'), false);
});
