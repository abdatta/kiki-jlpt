import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AiCurationRecommendation, AiCurationReviewReconciliation, ConversationCurationEvidence, CuratedConversation, CuratedSet, FinalTextAuditReport, PracticeConversation, StudioJob, WorkflowJob } from '../shared/types.ts';
import { cleanShellModelLabel, conversationQualityCounts, formatClaudeModelVersion, formatCodexModelName, formatGeminiModelName, formatResolvedModel, GenerateModal, libraryCountsBySourceRun, parseStudioRoute, RunLibraryBadge, snakeCellPlacement, snakeColumnCount, TextModelOptionGroups, WorkflowAuditFlow } from './App.tsx';
import { AddAllProgressModal } from './components/AddAllProgressModal.tsx';
import { AiCurationReconciliationPanel } from './components/AiCurationReconciliationPanel.tsx';
import { AudioProgressStage } from './components/AudioProgressStage.tsx';
import { AiRecommendationReason, CurationEvidencePanel, StudioWordChip, WordFrequencyDistribution } from './components/CurationEvidence.tsx';
import {
  SourceRunDistribution,
  SourceRunLabel,
  resolveSourceRunMetadata,
  sourceRunDistribution
} from './components/SourceRunProvenance.tsx';
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

test('Studio quality counts keep unlabeled legacy conversations out of the split', () => {
  assert.deepEqual(conversationQualityCounts([
    { quality: 'good' },
    { quality: 'good' },
    { quality: 'bad' },
    {}
  ]), { good: 2, okay: 0, bad: 1 });
});

test('Studio evidence summary renders current, cumulative, and OOV measurements', () => {
  const html = renderToStaticMarkup(<CurationEvidencePanel evidence={evidence} />);

  assert.match(html, /3.*Set 2/);
  assert.match(html, /8.*allowed/);
  assert.match(html, /1.*OOV/);
  assert.match(html, /3\/98/);
  assert.match(html, /1 unique, 2 uses/);
  assert.match(html, /猫/);
});

test('Studio word chips expose lexical metadata without mastery statistics', () => {
  const html = renderToStaticMarkup(<StudioWordChip word="猫" className="coverageCount1" adornment={<b>2</b>} metadata={{
    japanese: '猫', reading: 'ねこ', meaning: 'cat', set: 3, partOfSpeech: 'noun', category: 'animals'
  }} />);
  assert.match(html, /role="tooltip"/);
  assert.match(html, /ねこ/);
  assert.match(html, /cat/);
  assert.match(html, /Set 3/);
  assert.match(html, /coverageCount1/);
  assert.match(html, /<b>2<\/b>/);
  assert.doesNotMatch(html, /master|review|stat/i);
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

test('Studio word-frequency distribution stacks current and Add All counts', () => {
  const html = renderToStaticMarkup(<WordFrequencyDistribution words={[
    { japanese: '読む', currentLibraryCount: 2, projectedLibraryCount: 4 },
    { japanese: '見る', currentLibraryCount: 1, projectedLibraryCount: 1 },
    { japanese: '行く', currentLibraryCount: 3, projectedLibraryCount: 4 }
  ]} />);

  assert.match(html, /Word frequency distribution/);
  assert.match(html, /Added by Add All/);
  assert.match(html, /<details class="wordFrequencyDistribution">/);
  assert.doesNotMatch(html, /<details class="wordFrequencyDistribution" open/);
  assert.match(html, /aria-pressed="false"[^>]*>.*Split view/);
  assert.match(html, /読む: 4 \(\+2\)/);
  assert.doesNotMatch(html, /title="読む: 4/);
  assert.match(html, /wordFrequencyTooltip/);
  assert.match(html, /wordFrequencyBar[^>]*height:100%/);
  assert.match(html, /wordFrequencyDelta[^>]*height:50%/);
  assert.match(html, /wordFrequencyCurrent[^>]*height:50%/);
  assert.match(html, /Less frequent/);
  assert.match(html, /Most frequent/);
});

test('Studio source provenance resolves links and falls back without broken navigation', () => {
  const runs = [{
    ...conversation,
    id: 'run-a',
    setNumber: 2,
    conversationCount: 1,
    allowedVocabCount: 195,
    textModel: { id: 'model-1', provider: 'gemini' as const, model: 'gemini-test', label: 'Gemini Test' },
    analytics: {
      currentSetTotal: 98,
      currentSetUsedCount: 80,
      currentSetMissingCount: 18,
      currentSetMissingWords: [],
      allowedVocabTotal: 195,
      allowedVocabUsedCount: 150,
      allowedVocabUsedPercentage: 77,
      outOfAllowedCount: 2,
      outOfAllowedWords: ['猫', '犬']
    },
    status: 'generated' as const,
    conversations: [conversation],
    createdAt: '2026-07-09T07:28:00.000Z',
    updatedAt: '2026-07-09T07:28:00.000Z'
  }];
  const format = (value: string) => `title:${value}`;
  const route = (runId: string) => `#/studio/runs/${runId}`;

  const resolved = resolveSourceRunMetadata({ sourceRunId: 'run-a' }, runs, format, route);
  const unresolved = resolveSourceRunMetadata(
    { sourceRunId: 'missing-run', sourceRunCreatedAt: '2026-07-02T19:44:00.000Z' },
    runs,
    format,
    route
  );
  const unresolvedWithoutTimestamp = resolveSourceRunMetadata({ sourceRunId: 'missing-run-extra' }, runs, format, route);

  assert.equal(resolved?.label, 'title:2026-07-09T07:28:00.000Z');
  assert.equal(resolved?.targetRoute, '#/studio/runs/run-a');
  assert.equal(resolved?.resolved, true);
  assert.equal(unresolved?.label, 'title:2026-07-02T19:44:00.000Z');
  assert.equal(unresolved?.targetRoute, undefined);
  assert.equal(unresolved?.resolved, false);
  assert.equal(unresolvedWithoutTimestamp?.label, 'Run missing-');

  const resolvedHtml = renderToStaticMarkup(<SourceRunLabel metadata={resolved} />);
  const unresolvedHtml = renderToStaticMarkup(<SourceRunLabel metadata={unresolved} />);

  assert.match(resolvedHtml, /href="#\/studio\/runs\/run-a"/);
  assert.match(resolvedHtml, /Gemini Test/);
  assert.match(resolvedHtml, /Current set: 80\/98 used, 18 missing/);
  assert.match(resolvedHtml, /Cumulative: 77% \(150\/195\)/);
  assert.match(resolvedHtml, /OOV: 2/);
  assert.match(unresolvedHtml, /Run metadata unavailable/);
  assert.doesNotMatch(unresolvedHtml, /href=/);
});

test('Studio source distribution groups visible items and renders collapsed rows', () => {
  const runs = [
    { id: 'run-a', createdAt: '2026-07-09T07:28:00.000Z' },
    { id: 'run-b', createdAt: '2026-07-08T17:57:00.000Z' }
  ];
  const rows = sourceRunDistribution(
    [
      { sourceRunId: 'run-a' },
      { sourceRunId: 'run-b' },
      { sourceRunId: 'run-a' },
      { sourceRunId: 'missing-run', sourceRunCreatedAt: '2026-07-02T19:44:00.000Z' }
    ],
    runs,
    (value) => `title:${value}`,
    (runId) => `#/studio/runs/${runId}`
  );
  const html = renderToStaticMarkup(<SourceRunDistribution rows={rows} />);

  assert.deepEqual(rows.map((row) => [row.sourceRunId, row.count, row.percentage]), [
    ['run-a', 2, 50],
    ['run-b', 1, 25],
    ['missing-run', 1, 25]
  ]);
  assert.match(html, /<details class="sourceRunDistribution">/);
  assert.doesNotMatch(html, /<details class="sourceRunDistribution" open/);
  assert.match(html, /3 sources/);
  assert.match(html, /2 conversations/);
  assert.match(html, /50%/);
  assert.match(html, /25%/);
  assert.match(html, /href="#\/studio\/runs\/run-a"/);
  assert.match(html, /Run metadata unavailable/);
});

test('Studio run library badge counts curated conversations per source run', () => {
  const analytics = {
    currentSetTotal: 98,
    currentSetUsedCount: 80,
    currentSetMissingCount: 18,
    currentSetMissingWords: [],
    allowedVocabTotal: 195,
    allowedVocabUsedCount: 150,
    allowedVocabUsedPercentage: 77,
    outOfAllowedCount: 0,
    outOfAllowedWords: []
  };
  const curated = (id: string, sourceRunId: string): CuratedConversation => ({
    ...conversation,
    id,
    sourceRunId,
    sourceConversationId: 'convo-01',
    setNumber: 2,
    audioFileName: `${id}.mp3`,
    audioUrl: `/audio/library/${id}.mp3`,
    curatedAudioPath: `library/${id}.mp3`
  });
  const sets: CuratedSet[] = [
    {
      setNumber: 2,
      analytics,
      createdAt: '2026-07-09T07:28:00.000Z',
      updatedAt: '2026-07-09T07:28:00.000Z',
      conversations: [curated('set-02-001', 'run-a'), curated('set-02-002', 'run-a'), curated('set-02-003', 'run-b')]
    },
    {
      setNumber: 3,
      analytics,
      createdAt: '2026-07-09T07:28:00.000Z',
      updatedAt: '2026-07-09T07:28:00.000Z',
      conversations: [curated('set-03-001', 'run-a')]
    }
  ];

  const counts = libraryCountsBySourceRun(sets);
  assert.equal(counts.get('run-a'), 3);
  assert.equal(counts.get('run-b'), 1);
  assert.equal(counts.get('run-c'), undefined);

  const html = renderToStaticMarkup(<RunLibraryBadge count={3} />);
  assert.match(html, /class="runLibraryBadge"/);
  assert.match(html, /title="3 conversations from this run in the library"/);
  assert.match(html, />3</);

  const singular = renderToStaticMarkup(<RunLibraryBadge count={1} />);
  assert.match(singular, /title="1 conversation from this run in the library"/);
  assert.equal(renderToStaticMarkup(<RunLibraryBadge count={0} />), '');
});

test('Studio historical curation reconciliation renders action state and stale warnings', () => {
  const reconciliation: AiCurationReviewReconciliation = {
    reviewId: 'curation-set-02-old',
    setNumber: 2,
    actionable: true,
    actionLabel: 'Add Remaining',
    blockingReasons: [],
    warnings: [
      '30 newer candidates were not evaluated by this review.',
      '6 recommendations are already in Library and will be skipped.'
    ],
    counts: {
      totalRecommendations: 20,
      alreadyInLibrary: 6,
      remainingToAdd: 14,
      audioReady: 4,
      missingAudio: 10,
      blocked: 0,
      missingSource: 0,
      changedSourceContent: 0,
      notCurrentCandidate: 0,
      newerCandidatesNotEvaluated: 30,
      librarySourcesAddedSinceReview: 6,
      librarySourcesRemovedSinceReview: 0
    },
    recommendations: [],
    recommendationKeysToAdd: [],
    currentProjectedLeastCoveredWords: []
  };
  const html = renderToStaticMarkup(<AiCurationReconciliationPanel reconciliation={reconciliation} stale />);

  assert.match(html, /Historical review/);
  assert.match(html, /historical snapshot with stale context/);
  assert.match(html, /14.*remaining/);
  assert.match(html, /6.*in Library/);
  assert.match(html, /10.*need audio/);
  assert.doesNotMatch(html, /blocked/);
  assert.match(html, /Add Remaining ready/);
  assert.match(html, /30 newer candidates were not evaluated/);
  assert.match(html, /already in Library and will be skipped/);
});

test('Studio historical curation reconciliation renders blocked reasons', () => {
  const reconciliation: AiCurationReviewReconciliation = {
    reviewId: 'curation-set-02-blocked',
    setNumber: 2,
    actionable: false,
    blockingReasons: ['1 recommended source could not be loaded.', '1 recommended source changed since review.'],
    warnings: [],
    counts: {
      totalRecommendations: 2,
      alreadyInLibrary: 0,
      remainingToAdd: 0,
      audioReady: 0,
      missingAudio: 0,
      blocked: 2,
      missingSource: 1,
      changedSourceContent: 1,
      notCurrentCandidate: 0,
      newerCandidatesNotEvaluated: 0,
      librarySourcesAddedSinceReview: 0,
      librarySourcesRemovedSinceReview: 0
    },
    recommendations: [],
    recommendationKeysToAdd: [],
    currentProjectedLeastCoveredWords: []
  };
  const html = renderToStaticMarkup(<AiCurationReconciliationPanel reconciliation={reconciliation} />);

  assert.match(html, /Review only/);
  assert.match(html, /historicalReviewStatus blocked/);
  assert.match(html, /2<b>blocked/);
  assert.match(html, /historical snapshot\. Use Settings/);
  assert.match(html, /source could not be loaded/);
  assert.match(html, /changed since review/);
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

test('Studio bulk-add modal can label historical remaining recommendations', () => {
  const html = renderToStaticMarkup(<AddAllProgressModal
    progress={{
      stage: 'ready',
      title: 'Add Remaining recommendations',
      items: [{
        candidateKey: 'run-1:convo-01',
        title: 'Remaining conversation',
        audioStatus: 'done',
        libraryStatus: 'pending'
      }]
    }}
    onClose={() => undefined}
    onRun={() => undefined}
    onPause={() => undefined}
  />);

  assert.match(html, /Add Remaining recommendations/);
  assert.match(html, /Add to Library/);
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

function auditReport(outcome: FinalTextAuditReport['outcome'] = 'pass'): FinalTextAuditReport {
  const stage = {
    stage: 'initial' as const,
    requestedCount: 1,
    generatedCount: 1,
    acceptedCount: outcome === 'pause' ? 0 : 1,
    regenerateCount: 0,
    rerollRequestedCount: 0,
    rerollGeneratedCount: 0,
    dropped: [],
    verdicts: [],
    picks: [],
    failures: []
  };
  return {
    requestedCount: 1,
    acceptedCount: outcome === 'pause' ? 0 : 1,
    shortfallCount: outcome === 'pause' ? 1 : 0,
    stages: { initial: stage },
    qualityLabels: { good: outcome === 'pause' ? 0 : 1, okay: 0 },
    remainingOutOfVocabulary: [],
    uncoveredCurrentSetWords: [],
    coverageLosses: [],
    modelCallFailures: [],
    pickStatistics: { original: 0, candidate1: 1, candidate2: 0, gateDecided: 0, tieBreakDecided: 1, fallbackDecided: 0 },
    thresholds: [{ id: 'total-shortfall', outcome: outcome === 'pause' ? 'tripped' : 'met', measured: outcome === 'pause' ? 1 : 0, limit: .2, unit: 'rate', action: 'pause', detail: 'Accepted count threshold.' }],
    outcome,
    createdAt: '2026-01-01T00:00:00.000Z'
  };
}

function perCallJob(status: WorkflowJob['status'] = 'complete'): WorkflowJob {
  const runConversation = { ...conversation, quality: 'good' as const, qualityDecision: 'repair' as const, pickerSelected: 'candidate1' as const };
  const finalTextAudit = auditReport(status === 'paused' ? 'pause' : 'pass');
  const summary = (statLine: string, factsByConversationId?: Record<string, unknown>) => ({ summary: { statLine }, factsByConversationId });
  const nodes: WorkflowJob['nodes'] = [
    { id: 'initial:generation', kind: 'generation', callKind: 'generation', stage: 'initial', pass: 1, sequence: 0, title: 'Initial generation', status: 'done', output: summary('1 conversation generated', { 'convo-01': { version: 'original' } }) },
    { id: 'initial:vocab-audit', kind: 'vocab-audit', callKind: 'vocab-audit', stage: 'initial', pass: 1, sequence: 1, title: 'Vocabulary audit', status: 'done', output: summary('1 conversation · 0 findings', { 'convo-01': { outOfVocabularyUniqueCount: 0 } }) },
    { id: 'initial:triage', kind: 'triage', callKind: 'triage', stage: 'initial', pass: 1, sequence: 2, title: 'Quality triage', status: 'done', output: { ...summary('0 pass · 1 repair · 0 regen', { 'convo-01': { conversationId: 'convo-01', verdict: 'repair', rationale: 'Stilted.' } }), details: { verdicts: [{ conversationId: 'convo-01', verdict: 'repair', rationale: 'Stilted.', flags: [] }] } } },
    { id: 'initial:repair-1', kind: 'repair-candidate', callKind: 'repair-candidate', stage: 'initial', pass: 1, candidateIndex: 1, sequence: 3, title: 'Repair candidate 1', status: 'done', output: summary('1 conversation · 1 selected', { 'convo-01': { oovBefore: 0, oovAfter: 0 } }) },
    { id: 'initial:repair-2', kind: 'repair-candidate', callKind: 'repair-candidate', stage: 'initial', pass: 1, candidateIndex: 2, sequence: 4, title: 'Repair candidate 2', status: 'done', output: summary('1 conversation · 0 selected', { 'convo-01': { oovBefore: 0, oovAfter: 0 } }) },
    { id: 'initial:dominance-gates', kind: 'dominance-gates', callKind: 'dominance-gates', stage: 'initial', pass: 1, sequence: 5, title: 'Dominance gates', status: 'done', output: { summary: { statLine: '1 eliminated · 1 coverage-loss flags' }, factsByConversationId: { 'convo-01': { admissible: ['original', 'candidate1'] } }, details: { versionsByConversationId: { 'convo-01': [{ source: 'original', flags: [] }, { source: 'candidate1', flags: ['coverage_loss'] }, { source: 'candidate2', flags: [] }] }, eliminatedByConversationId: { 'convo-01': [{ source: 'candidate2', reason: 'Eliminated by deterministic vocabulary gate (2 findings; best 0).' }] } } } },
    { id: 'initial:pick', kind: 'pick', callKind: 'pick', stage: 'initial', pass: 1, sequence: 6, title: 'Version pick', status: 'done', output: { summary: { statLine: 'orig 0 · c1 1 · c2 0' }, factsByConversationId: { 'convo-01': { conversationId: 'convo-01', selected: 'candidate1', selectedQuality: 'good' } }, details: { picks: [{ conversationId: 'convo-01', selected: 'candidate1', selectedQuality: 'good' }] } } },
    { id: 'final-audit', kind: 'final-audit', callKind: 'final-audit', sequence: 200, title: 'Final text audit', status: 'done', output: { summary: { statLine: `1/1 accepted · ${finalTextAudit.outcome.toUpperCase()}` }, details: finalTextAudit } },
    { id: 'audio-1', kind: 'audio', callKind: 'audio', sequence: 300, title: 'Conversation 1', status: status === 'paused' ? 'pending' : 'done' }
  ];
  return {
    id: 'workflow-per-call', status, setNumber: 2, primaryConversationCount: 1, balanceConversationCount: 0,
    requestedTotalConversationCount: 1, audioRequestedCount: 1, audioGeneratedCount: status === 'paused' ? 0 : 1, audioErrors: [], nodes,
    run: {
      id: 'run-per-call', setNumber: 2, conversationCount: 1, allowedVocabCount: 2,
      textModel: { id: 'test', provider: 'gemini', model: 'test', label: 'Test' },
      analytics: { currentSetTotal: 1, currentSetUsedCount: 1, currentSetMissingCount: 0, currentSetMissingWords: [], allowedVocabTotal: 2, allowedVocabUsedCount: 1, allowedVocabUsedPercentage: 50, outOfAllowedCount: 0, outOfAllowedWords: [] },
      status: 'generated', finalTextAudit, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', conversations: [runConversation]
    },
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

test('per-call audit renders lanes, parallel repairs, stat lines, and conversation trace facts', () => {
  const html = renderToStaticMarkup(<WorkflowAuditFlow job={perCallJob()} selectedNodeId="initial:pick" onSelectNode={() => undefined} onSelectConversation={() => undefined} />);
  const traceJob = perCallJob();
  const generationNode = traceJob.nodes.find((node) => node.id === 'initial:generation')!;
  generationNode.output = { summary: { statLine: '1 conversation generated' }, factsByConversationId: { 'convo-01': evidence } };
  const repairNode = traceJob.nodes.find((node) => node.id === 'initial:repair-1')!;
  repairNode.output = {
    summary: { statLine: '1 conversation repaired' },
    factsByConversationId: { 'convo-01': { candidate: 'candidate1', selected: true } },
    details: { comparisons: [{ conversationId: 'convo-01', before: [{ speaker: 'Speaker 1', japanese: 'old text' }], after: [{ speaker: 'Speaker 1', japanese: 'new text' }] }] }
  };
  const traceHtml = renderToStaticMarkup(<WorkflowAuditFlow job={traceJob} selectedNodeId="initial:pick" selectedConversationId="convo-01" onSelectNode={() => undefined} onSelectConversation={() => undefined} />);
  assert.match(html, /Stage 1 · initial/i);
  assert.doesNotMatch(html, /Final dialogue labels/i);
  assert.match(html, /parallel/i);
  // Version-comparing nodes derive per-version stat stacks from their details
  // (never from stored display text). The bold title names every node; the
  // redundant all-caps kind eyebrow is gone.
  assert.match(html, /<strong>Version pick<\/strong>/);
  assert.match(html, /Original: 0 picked/);
  assert.match(html, /Repair 1: 1 picked · 1 good/);
  assert.match(html, /Repair 2: 0 picked/);
  assert.match(html, /Repair 1: 0 eliminated · 1 coverage-loss/);
  assert.match(html, /Repair 2: 1 eliminated · 0 coverage-loss/);
  assert.doesNotMatch(html, /orig 0 · c1 1 · c2 0/);
  assert.doesNotMatch(html, /workflowNodeEyebrow/);
  assert.match(traceHtml, /Conversation trace/i);
  assert.match(traceHtml, /candidate1 · good/i);
  assert.match(traceHtml, /candidate1 - selected/i);
  assert.match(traceHtml, /<del>old text<\/del>/i);
  assert.match(traceHtml, /<ins>new text<\/ins>/i);
  assert.match(traceHtml, /1 OOV - 3 current-set words/i);
  assert.doesNotMatch(traceHtml, /evidenceVersion/i);
  assert.doesNotMatch(html, />Attempts</);
});

test('the conversation trace is a custom dropdown with chip-formatted options and an explainer', () => {
  const html = renderToStaticMarkup(<WorkflowAuditFlow job={perCallJob()} selectedNodeId="initial:pick" onSelectNode={() => undefined} onSelectConversation={() => undefined} />);

  assert.match(html, /aria-haspopup="listbox"[^>]*aria-label="Conversation trace"|aria-label="Conversation trace"[^>]*aria-haspopup="listbox"/);
  assert.match(html, /role="listbox"/);
  assert.match(html, /role="option"/);
  assert.match(html, /All conversations/);
  // Number as its own badge, quality and repaired rendered as separate chips.
  assert.match(html, /class="traceNumber">1</);
  assert.match(html, /class="conversationQualityChip good">good</);
  assert.match(html, /class="traceChip repaired">repaired</);
  assert.match(html, /Follow one conversation through the pipeline/);
});

test('snake placement reverses odd rows and turns down at row ends', () => {
  // 3 columns, 7 cells → row 0 L→R (cols 1,2,3), row 1 R→L (cols 3,2,1), row 2 (col 1).
  assert.deepEqual(snakeCellPlacement(0, 3, 7), { column: 1, row: 1, arrow: 'right' });
  assert.deepEqual(snakeCellPlacement(2, 3, 7), { column: 3, row: 1, arrow: 'down' });
  assert.deepEqual(snakeCellPlacement(3, 3, 7), { column: 3, row: 2, arrow: 'left' });
  assert.deepEqual(snakeCellPlacement(5, 3, 7), { column: 1, row: 2, arrow: 'down' });
  assert.deepEqual(snakeCellPlacement(6, 3, 7), { column: 1, row: 3, arrow: 'none' });
  // Single column degenerates to a straight vertical flow.
  assert.equal(snakeCellPlacement(0, 1, 3).arrow, 'down');
  assert.equal(snakeCellPlacement(2, 1, 3).arrow, 'none');
});

test('snake column count fits the width, balances rows, and never drops below one', () => {
  assert.equal(snakeColumnCount(0, 8), 1);
  assert.equal(snakeColumnCount(200, 8), 1);
  assert.equal(snakeColumnCount(900, 8), 3); // fits 3 → 3+3+2
  // 8 cells fit 6 wide, but balance to two rows of 4 rather than 6+2.
  assert.equal(snakeColumnCount(1600, 8), 4);
  // 6 cells fit 4 wide → balance to 3+3, not 4+2.
  assert.equal(snakeColumnCount(1100, 6), 3);
  // A single row is left intact (and centres via CSS).
  assert.equal(snakeColumnCount(5000, 3), 3);
});

test('selecting a node presents its deep dive as a modal dialog', () => {
  const html = renderToStaticMarkup(<WorkflowAuditFlow job={perCallJob()} selectedNodeId="initial:pick" onSelectNode={() => undefined} onSelectConversation={() => undefined} />);

  assert.match(html, /workflowInspectorModal/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /title="Close"/);
});

test('stored final-label calls render after pass 2 while final text audit remains before audio', () => {
  const job = perCallJob();
  job.nodes.push(
    { id: 'initial:pass2:reroll', kind: 'reroll', callKind: 'reroll', stage: 'initial', pass: 2, sequence: 7, title: 'Re-roll', status: 'done', output: { summary: { statLine: '1 replacement' } } },
    { id: 'initial:final-label', kind: 'final-label', callKind: 'final-label', stage: 'initial', pass: 1, sequence: 14, title: 'Final dialogue labels', status: 'done', output: { summary: { statLine: '1 good' } } }
  );

  const html = renderToStaticMarkup(<WorkflowAuditFlow job={job} onSelectNode={() => undefined} onSelectConversation={() => undefined} />);
  const pass2Index = html.indexOf('Pass 2');
  const compatibilityIndex = html.indexOf('Legacy terminal label pass');
  const finalLabelIndex = html.indexOf('Final dialogue labels');
  const finalAuditIndex = html.indexOf('Final text audit');
  const audioIndex = html.indexOf('Conversation 1');

  assert.ok(pass2Index >= 0 && compatibilityIndex > pass2Index && finalLabelIndex > compatibilityIndex);
  assert.ok(finalAuditIndex > finalLabelIndex && audioIndex > finalAuditIndex);
});

test('a pass that never ran collapses into an expandable summary row once the job settles', () => {
  const job = perCallJob();
  job.nodes = [
    ...job.nodes,
    { id: 'initial:pass2:reroll', kind: 'reroll', callKind: 'reroll', stage: 'initial', pass: 2, sequence: 10, title: 'Re-roll', status: 'skipped', output: { summary: { statLine: 'No regenerate verdicts' } } },
    // Ghost step published at stage start that never transitioned because the
    // re-roll was skipped — must count as skipped once the job is settled.
    { id: 'initial:pass2:vocab-audit', kind: 'vocab-audit', callKind: 'vocab-audit', stage: 'initial', pass: 2, sequence: 11, title: 'Re-roll vocabulary audit', status: 'pending' }
  ];

  const html = renderToStaticMarkup(<WorkflowAuditFlow job={job} selectedNodeId="initial:pick" onSelectNode={() => undefined} onSelectConversation={() => undefined} />);

  assert.match(html, /workflowPassCollapsed/);
  assert.match(html, /↳ Pass 2 · re-roll · skipped/);
  assert.match(html, /2 steps skipped — expand to inspect/);
  assert.match(html, /No regenerate verdicts/);

  const runningJob = { ...perCallJob('running'), nodes: job.nodes };
  const runningHtml = renderToStaticMarkup(<WorkflowAuditFlow job={runningJob} selectedNodeId="initial:pick" onSelectNode={() => undefined} onSelectConversation={() => undefined} />);
  assert.doesNotMatch(runningHtml, /workflowPassCollapsed/);
});

test('an isolated skipped node renders as a full greyed-out card, not a compact chip', () => {
  const job = perCallJob();
  job.nodes = job.nodes.map((node) => node.id === 'initial:pick' ? { ...node, status: 'skipped' as const, output: undefined } : node);

  const html = renderToStaticMarkup(<WorkflowAuditFlow job={job} selectedNodeId="initial:triage" onSelectNode={() => undefined} onSelectConversation={() => undefined} />);

  assert.doesNotMatch(html, /compactNode/);
  // Full card, greyed via the status class, with the detail line calling it skipped.
  assert.match(html, /workflowNode skipped/);
  assert.match(html, />Version pick</);
  assert.match(html, />Skipped</);
});

test('paused final audit renders threshold review actions and awaiting-audio state', () => {
  const html = renderToStaticMarkup(<WorkflowAuditFlow job={perCallJob('paused')} selectedNodeId="final-audit" onSelectNode={() => undefined} onSelectConversation={() => undefined} onApprove={() => undefined} onDiscard={() => undefined} />);
  assert.match(html, /Paused for review/i);
  assert.match(html, /Approve &amp; generate audio/i);
  assert.match(html, /Discard run/i);
  assert.match(html, /Awaiting review/i);
  assert.match(html, /total shortfall: tripped/i);
});

test('legacy workflow rendering keeps the pre-quality-control notice and Attempts tab', () => {
  const exchange = { id: 'legacy-exchange', provider: 'gemini' as const, model: 'test', label: 'Test', prompt: 'prompt', output: 'output', requestedAt: '2026-01-01T00:00:00.000Z', receivedAt: '2026-01-01T00:00:01.000Z', status: 'complete' as const };
  const job: WorkflowJob = {
    id: 'legacy', status: 'complete', setNumber: 2, primaryConversationCount: 1, balanceConversationCount: 1, requestedTotalConversationCount: 2,
    audioRequestedCount: 0, audioGeneratedCount: 0, audioErrors: [],
    nodes: [
      { id: 'generator', kind: 'generator', title: 'Generate', status: 'done', output: { exchanges: [exchange] } },
      { id: 'balancer', kind: 'balancer', title: 'Balance', status: 'done', output: exchange }
    ],
    createdAt: exchange.requestedAt, updatedAt: exchange.receivedAt
  };
  const html = renderToStaticMarkup(<WorkflowAuditFlow job={job} selectedNodeId="generator:generate" onSelectNode={() => undefined} onSelectConversation={() => undefined} />);
  assert.match(html, /Recorded before per-call quality auditing/i);
  assert.match(html, />Attempts</);
});

test('audit deep links restore conversation trace and ignore any node segment', () => {
  assert.deepEqual(
    parseStudioRoute('#/studio/runs/run-1/audit/c/convo-01'),
    { boardMode: 'runs', runId: 'run-1', auditOpen: true, conversationId: 'convo-01' }
  );
  // The node inspector is a transient modal, so a legacy /n/ segment is parsed
  // for its conversation only — no node is restored from the URL.
  assert.deepEqual(
    parseStudioRoute('#/studio/runs/run-1/audit/n/initial%3Apick/c/convo-01'),
    { boardMode: 'runs', runId: 'run-1', auditOpen: true, conversationId: 'convo-01' }
  );
});

const pickerModels = [
  { id: 'gemini', provider: 'gemini' as const, model: 'gemini-2.5-flash', label: 'Gemini (gemini-2.5-flash)' },
  { id: 'codex:gpt-5.5', provider: 'codex' as const, model: 'gpt-5.5', label: 'GPT-5.5 (Codex, medium)' },
  { id: 'claude:sonnet', provider: 'claude' as const, model: 'sonnet', label: 'Claude Sonnet' },
  { id: 'claude:haiku', provider: 'claude' as const, model: 'haiku', label: 'Claude Haiku' }
];

test('generation modal makes model preflight progress and errors visible', () => {
  const commonProps = {
    state: { setNumber: 2, conversationCount: '25', textModelId: 'claude:sonnet', judgeModelId: 'codex:gpt-5.5', runMode: 'workflow-audio' as const },
    sets: [{ set: 2, theme: 'Daily Routine + Time', count: 100, cumulativeCount: 200 }],
    textModels: pickerModels,
    onChange: () => undefined,
    onClose: () => undefined,
    onSubmit: () => undefined
  };
  const checkingHtml = renderToStaticMarkup(<GenerateModal {...commonProps} busy="preflight" />);
  const failedHtml = renderToStaticMarkup(<GenerateModal {...commonProps} busy={null} preflightError="Model preflight failed: Generator timed out." />);

  assert.match(checkingHtml, /Checking generator and judge/);
  assert.match(checkingHtml, /Checking models/);
  assert.match(checkingHtml, /Claude Sonnet.*GPT-5\.5/);
  assert.match(checkingHtml, /disabled/);
  assert.match(failedHtml, /role="alert"/);
  assert.match(failedHtml, /Generator timed out/);
});

test('text model picker groups options under Gemini, GPT, and Claude in order', () => {
  const html = renderToStaticMarkup(<select value="" onChange={() => undefined}><TextModelOptionGroups models={pickerModels} /></select>);

  const groupOrder = [...html.matchAll(/<optgroup label="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(groupOrder, ['Gemini', 'GPT', 'Claude']);
  const claudeGroup = html.slice(html.indexOf('<optgroup label="Claude"'));
  assert.match(claudeGroup, /Claude Sonnet/);
  assert.match(claudeGroup, /Claude Haiku/);
  assert.ok(claudeGroup.indexOf('Claude Sonnet') < claudeGroup.indexOf('Claude Haiku'));
});

test('a historical model injected ahead of the list still renders inside its provider group', () => {
  const legacy = { id: 'codex:gpt-5', provider: 'codex' as const, model: 'gpt-5', label: 'GPT-5 (Codex, medium)', source: 'fallback' as const };
  const html = renderToStaticMarkup(<select value="" onChange={() => undefined}><TextModelOptionGroups models={[legacy, ...pickerModels]} /></select>);

  // Options render the clean name (no redundant "(Codex, medium)").
  const gptGroup = html.slice(html.indexOf('<optgroup label="GPT"'), html.indexOf('<optgroup label="Claude"'));
  assert.match(gptGroup, />GPT 5</);
  assert.match(gptGroup, />GPT 5.5</);
  assert.doesNotMatch(gptGroup, /Codex, medium/);
  const groupOrder = [...html.matchAll(/<optgroup label="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(groupOrder, ['Gemini', 'GPT', 'Claude']);
});

test('model names format cleanly by provider without redundant effort or variant noise', () => {
  assert.equal(formatCodexModelName('gpt-5.5'), 'GPT 5.5');
  assert.equal(formatCodexModelName('gpt-5.6-sol'), 'GPT 5.6 Sol');
  assert.equal(formatCodexModelName('gpt-5.6-terra'), 'GPT 5.6 Terra');
  assert.equal(formatCodexModelName('gpt-5.6-luna'), 'GPT 5.6 Luna');
  assert.equal(formatCodexModelName('gpt-5.4-mini'), 'GPT 5.4 Mini');
  assert.equal(formatGeminiModelName('gemini-3-flash-preview'), 'Gemini 3');
  assert.equal(formatGeminiModelName('gemini-3.5-flash'), 'Gemini 3.5');
  assert.equal(formatGeminiModelName('gemini-2.5-flash'), 'Gemini 2.5');
});

test('in-progress run shell labels normalise every stored shape', () => {
  // Picker ids (no run yet).
  assert.equal(cleanShellModelLabel('gemini'), 'Gemini');
  assert.equal(cleanShellModelLabel('codex:gpt-5.5'), 'GPT 5.5');
  assert.equal(cleanShellModelLabel('claude:sonnet'), 'Claude Sonnet');
  // Stored textModel labels once the run exists.
  assert.equal(cleanShellModelLabel('GPT-5.6-Sol (Codex, medium)'), 'GPT 5.6 Sol');
  assert.equal(cleanShellModelLabel('Gemini (gemini-3-flash-preview)'), 'Gemini 3');
  assert.equal(cleanShellModelLabel('Claude Fable'), 'Claude Fable');
  assert.equal(cleanShellModelLabel('Configured model'), 'Configured model');
});

test('audit node meta prefers the resolved model version reported by the provider', () => {
  const exchange = {
    id: 'claude-exchange', provider: 'claude' as const, model: 'sonnet', label: 'Claude Sonnet', resolvedModel: 'claude-sonnet-5',
    prompt: 'prompt', output: 'output', requestedAt: '2026-01-01T00:00:00.000Z', receivedAt: '2026-01-01T00:00:01.000Z', status: 'complete' as const
  };
  const job: WorkflowJob = {
    id: 'claude-run', status: 'complete', setNumber: 2, primaryConversationCount: 1, balanceConversationCount: 1, requestedTotalConversationCount: 2,
    audioRequestedCount: 0, audioGeneratedCount: 0, audioErrors: [],
    nodes: [
      { id: 'generator', kind: 'generator', title: 'Generate', status: 'done', output: { exchanges: [exchange] } },
      { id: 'balancer', kind: 'balancer', title: 'Balance', status: 'done', output: exchange }
    ],
    createdAt: exchange.requestedAt, updatedAt: exchange.receivedAt
  };
  const html = renderToStaticMarkup(<WorkflowAuditFlow job={job} selectedNodeId="generator:generate" onSelectNode={() => undefined} onSelectConversation={() => undefined} />);

  assert.match(html, /Claude Sonnet 5/);
  assert.doesNotMatch(html, /claude-sonnet-5/);
});

test('resolved Claude model ids format as short friendly names without date suffixes', () => {
  assert.equal(formatClaudeModelVersion('claude-sonnet-4-5-20250929'), 'Sonnet 4.5');
  assert.equal(formatClaudeModelVersion('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.equal(formatClaudeModelVersion('claude-opus-4-8'), 'Opus 4.8');
  assert.equal(formatClaudeModelVersion('claude-fable-5'), 'Fable 5');
  assert.equal(formatClaudeModelVersion('gemini-2.5-flash-002'), 'gemini-2.5-flash-002');
});

test('resolved model display keeps the Claude provider name for cross-provider clarity', () => {
  assert.equal(formatResolvedModel('claude-fable-5'), 'Claude Fable 5');
  assert.equal(formatResolvedModel('claude-sonnet-4-5-20250929'), 'Claude Sonnet 4.5');
  assert.equal(formatResolvedModel('gemini-2.5-flash-002'), 'gemini-2.5-flash-002');
});
