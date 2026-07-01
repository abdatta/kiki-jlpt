import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AiCurationRecommendation, ConversationCurationEvidence, PracticeConversation } from '../shared/types.ts';
import { AddAllProgressModal } from './components/AddAllProgressModal.tsx';
import { AudioProgressStage } from './components/AudioProgressStage.tsx';
import { AiRecommendationReason, CurationEvidencePanel } from './components/CurationEvidence.tsx';

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
