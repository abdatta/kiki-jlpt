import assert from 'node:assert/strict';
import test from 'node:test';
import type { PracticeConversation, TextModelInfo, VocabItem } from '../shared/types.ts';
import { labelHistoricalConversations } from './qualityControl.ts';

const vocabulary: VocabItem[] = [{ set: 1, setTheme: 'Basics', withinSetNumber: 1, japanese: '本', reading: 'ほん', meaning: 'book', partOfSpeech: 'noun', category: 'object' }];
const judge: TextModelInfo = { id: 'judge', provider: 'codex', model: 'gpt-5.6-sol', label: 'Judge' };

test('historical bad labels are additive and leave conversation content intact', async () => {
  const conversation: PracticeConversation = {
    id: 'legacy-1', number: 1, title: 'Legacy', scene: 'Home', sampleContext: 'Context',
    text: [{ speaker: 'Speaker 1', tags: [], japanese: '本です。' }], listeningQuestions: [], answerKey: [], englishTranslation: [],
    vocabularyUsed: [], outOfVocabularyAudit: [], simplerReplacementSuggestions: [], status: 'audio_ready', audioFileName: 'legacy.wav', audioUrl: '/audio/legacy.wav',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
  };
  let submittedPrompt = '';
  const result = await labelHistoricalConversations({
    setNumber: 1, conversations: [conversation], allowedVocabulary: vocabulary, knownVocabulary: vocabulary, judgeModel: judge, rubricVersion: 'test',
    invoker: async (prompt) => {
      submittedPrompt = prompt;
      return { parsed: { verdicts: [{ conversationId: 'legacy-1', verdict: 'regenerate', rationale: 'Structural issue.', flags: ['structural'] }] }, output: '{}' };
    }
  });
  assert.equal(result.conversations[0].quality, 'bad');
  assert.equal(result.conversations[0].qualityReview?.verdict, 'regenerate');
  assert.deepEqual(result.conversations[0].text, conversation.text);
  assert.equal(result.conversations[0].audioFileName, conversation.audioFileName);
  assert.match(submittedPrompt, /shared final quality label, not a repair queue/i);
});
