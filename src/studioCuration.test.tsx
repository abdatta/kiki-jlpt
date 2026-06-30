import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AiCurationRecommendation, ConversationCurationEvidence, PracticeConversation } from '../shared/types.ts';
import { AddAllProgressModal } from './components/AddAllProgressModal.tsx';
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

test('Studio bulk-add modal renders audio and library progress separately', () => {
  const html = renderToStaticMarkup(<AddAllProgressModal
    progress={{
      stage: 'failed',
      error: 'Some audio could not be generated.',
      items: [{
        candidateKey: 'run-1:convo-01',
        title: 'Test conversation',
        audioStatus: 'error',
        libraryStatus: 'pending',
        error: 'Audio provider unavailable.'
      }]
    }}
    onClose={() => undefined}
    onRetry={() => undefined}
  />);

  assert.match(html, /Add all recommendations/);
  assert.match(html, /Some audio could not be generated/);
  assert.match(html, /Audio provider unavailable/);
  assert.match(html, /Failed/);
  assert.match(html, /Waiting/);
  assert.match(html, /Retry/);
});
