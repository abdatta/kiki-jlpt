import assert from 'node:assert/strict';
import test from 'node:test';
import type { PracticeConversation, QualityStageAudit, TextModelInfo, VocabItem } from '../shared/types.ts';
import { buildFinalTextAudit, runQualityControl, type QualityConversationGenerator, type QualityNodeEvent } from './qualityControl.ts';
import type { StructuredJsonInvoker } from './structuredText.ts';

const model: TextModelInfo = { id: 'test', provider: 'gemini', model: 'test-model', label: 'Test model' };
const vocabulary: VocabItem[] = [
  { set: 1, setTheme: 'Basics', withinSetNumber: 1, japanese: '\u672c', reading: '\u307b\u3093', meaning: 'book', partOfSpeech: 'noun', category: 'object' },
  { set: 2, setTheme: 'Actions', withinSetNumber: 1, japanese: '\u8aad\u3080', reading: '\u3088\u3080', meaning: 'read', partOfSpeech: 'verb', category: 'action' }
];

function conversation(id: string, number: number, japanese = '\u672c\u3092\u8aad\u307f\u307e\u3059\u3002'): PracticeConversation {
  const timestamp = '2026-01-01T00:00:00.000Z';
  return {
    id,
    number,
    title: `Conversation ${number}`,
    scene: 'At home.',
    sampleContext: 'Two friends speak slowly.',
    text: [{ speaker: 'Speaker 1', tags: ['friendly', 'slow'], japanese }],
    listeningQuestions: ['What happens?'],
    answerKey: ['A book is read.'],
    englishTranslation: [{ speaker: 'Speaker 1', english: 'I read a book.' }],
    vocabularyUsed: [],
    outOfVocabularyAudit: [],
    simplerReplacementSuggestions: [],
    status: 'draft',
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function rawConversation(japanese = '\u672c\u3092\u8aad\u307f\u307e\u3059\u3002') {
  return {
    title: 'Repaired',
    scene: 'At home.',
    sampleContext: 'Two friends speak slowly.',
    text: [{ speaker: 'Speaker 1', tags: ['friendly', 'slow'], japanese }],
    listeningQuestions: ['What happens?'],
    answerKey: ['A book is read.'],
    englishTranslation: [{ speaker: 'Speaker 1', english: 'I read a book.' }]
  };
}

function triage(verdicts: Array<{ conversationId: string; verdict: 'pass' | 'repair' | 'regenerate'; rationale?: string; flags?: string[] }>): StructuredJsonInvoker {
  return async () => ({
    parsed: { verdicts: verdicts.map((item) => ({ rationale: 'Reviewed.', flags: [], ...item })) },
    output: JSON.stringify({ verdicts })
  });
}

function generator(outputs: Array<unknown | Error>, calls: string[] = []): QualityConversationGenerator {
  return async (prompt) => {
    calls.push(prompt);
    const next = outputs.shift();
    if (next instanceof Error) throw next;
    return { parsed: next, output: JSON.stringify(next) };
  };
}

test('triage rejects unknown IDs and applies deterministic-only fallback', async () => {
  const input = conversation('convo-01', 1);
  const result = await runQualityControl({
    stage: 'initial', textModel: model, originalPrompt: 'Generate.', setNumber: 2, expectedCount: 1,
    allowedVocabulary: vocabulary, knownVocabulary: vocabulary, conversations: [input],
    invoker: triage([{ conversationId: 'unknown', verdict: 'pass' }]),
    conversationGenerator: generator([])
  });
  assert.equal(result.conversations[0].quality, 'good');
  assert.equal(result.stageAudit.failures[0].callKind, 'triage');
  assert.equal(result.stageAudit.verdicts[0].flags.includes('triage_fallback'), true);
});

test('pass conversations keep their learning content and never enter repair', async () => {
  const input = conversation('convo-01', 1);
  const repairCalls: string[] = [];
  const events: QualityNodeEvent[] = [];
  const result = await runQualityControl({
    stage: 'initial', textModel: model, originalPrompt: 'Generate.', setNumber: 2, expectedCount: 1,
    allowedVocabulary: vocabulary, knownVocabulary: vocabulary, conversations: [input],
    invoker: triage([{ conversationId: input.id, verdict: 'pass' }]),
    conversationGenerator: generator([], repairCalls),
    onNode: (event) => { events.push(event); }
  });
  assert.equal(repairCalls.length, 0);
  assert.deepEqual(result.conversations[0].text, input.text);
  assert.equal(result.conversations[0].qualityDecision, 'pass');
  assert.equal(events.filter((event) => event.pass === 2).length, 7);
  assert.equal(events.filter((event) => event.pass === 2).every((event) => event.status === 'skipped'), true);
});

test('dominance gates eliminate OOV-worsening versions and select the clean candidate', async () => {
  const input = conversation('convo-01', 1, '\u6620\u753b\u3092\u898b\u307e\u3059\u3002');
  const result = await runQualityControl({
    stage: 'initial', textModel: model, originalPrompt: 'Generate.', setNumber: 2, expectedCount: 1,
    allowedVocabulary: vocabulary, knownVocabulary: vocabulary, conversations: [input],
    invoker: triage([{ conversationId: input.id, verdict: 'repair', flags: ['stilted'] }]),
    conversationGenerator: generator([
      { conversations: [rawConversation()] },
      { conversations: [rawConversation('\u6620\u753b\u3092\u898b\u307e\u3059\u3002')] }
    ])
  });
  assert.equal(result.stageAudit.picks[0].selected, 'candidate1');
  assert.equal(result.stageAudit.picks[0].decidedBy, 'gate');
  assert.equal(result.conversations[0].outOfVocabularyAudit.length, 0);
});

test('picker is forced among admissible versions and its selected quality is persisted', async () => {
  const input = conversation('convo-01', 1);
  const events: QualityNodeEvent[] = [];
  let invocation = 0;
  const invoker: StructuredJsonInvoker = async (prompt) => {
    invocation += 1;
    if (prompt.includes('Admissible version sets')) {
      return {
        parsed: { picks: [{ conversationId: input.id, selected: 'candidate2', selectedQuality: 'okay', confidence: 'medium', rationale: 'Most natural.', flags: ['mild_issue'] }] },
        output: '{}'
      };
    }
    return { parsed: { verdicts: [{ conversationId: input.id, verdict: 'repair', rationale: 'Awkward.', flags: ['awkward'] }] }, output: '{}' };
  };
  const result = await runQualityControl({
    stage: 'initial', textModel: model, originalPrompt: 'Generate.', setNumber: 2, expectedCount: 1,
    allowedVocabulary: vocabulary, knownVocabulary: vocabulary, conversations: [input], invoker,
    conversationGenerator: generator([{ conversations: [rawConversation()] }, { conversations: [rawConversation()] }]),
    onNode: (event) => { events.push(event); }
  });
  assert.equal(invocation, 2);
  assert.equal(result.stageAudit.picks[0].selected, 'candidate2');
  assert.equal(result.conversations[0].quality, 'okay');
  assert.equal(result.conversations[0].pickerConfidence, 'medium');
  const selectedCandidate = events.find((event) => event.id === 'initial:repair-2' && event.status === 'done' && event.output?.factsByConversationId);
  assert.equal((selectedCandidate?.output?.factsByConversationId?.[input.id] as { selected?: boolean })?.selected, true);
  assert.equal(Array.isArray((selectedCandidate?.output?.details as { comparisons?: unknown[] })?.comparisons), true);
});

test('repair and picker failures retain a deterministic admissible version', async () => {
  const input = conversation('convo-01', 1);
  let invocation = 0;
  const invoker: StructuredJsonInvoker = async (prompt) => {
    invocation += 1;
    if (prompt.includes('Admissible version sets')) throw new Error('picker unavailable');
    return { parsed: { verdicts: [{ conversationId: input.id, verdict: 'repair', rationale: 'Awkward.', flags: ['awkward'] }] }, output: '{}' };
  };
  const result = await runQualityControl({
    stage: 'initial', textModel: model, originalPrompt: 'Generate.', setNumber: 2, expectedCount: 1,
    allowedVocabulary: vocabulary, knownVocabulary: vocabulary, conversations: [input], invoker,
    conversationGenerator: generator([new Error('candidate one failed'), { conversations: [rawConversation()] }])
  });
  assert.equal(invocation, 2);
  assert.equal(result.conversations.length, 1);
  assert.equal(result.stageAudit.failures.some((failure) => failure.callKind === 'repair-candidate'), true);
  assert.equal(result.stageAudit.failures.some((failure) => failure.callKind === 'pick'), true);
  assert.equal(result.stageAudit.picks[0].decidedBy, 'fallback');
});

test('regeneration is bounded to one re-roll and a second regenerate becomes shortfall', async () => {
  const input = conversation('convo-01', 1);
  let triageCalls = 0;
  const invoker: StructuredJsonInvoker = async () => {
    triageCalls += 1;
    return { parsed: { verdicts: [{ conversationId: input.id, verdict: 'regenerate', rationale: 'Broken structure.', flags: ['structural'] }] }, output: '{}' };
  };
  const generationCalls: string[] = [];
  const result = await runQualityControl({
    stage: 'initial', textModel: model, originalPrompt: 'Generate.', setNumber: 2, expectedCount: 1,
    allowedVocabulary: vocabulary, knownVocabulary: vocabulary, conversations: [input], invoker,
    conversationGenerator: generator([{ conversations: [rawConversation()] }], generationCalls)
  });
  assert.equal(triageCalls, 2);
  assert.equal(generationCalls.length, 1);
  assert.equal(result.conversations.length, 0);
  assert.equal(result.stageAudit.rerollRequestedCount, 1);
  assert.equal(result.stageAudit.dropped.some((item) => item.pass === 2), true);
});

function stage(overrides: Partial<QualityStageAudit> = {}): QualityStageAudit {
  return {
    stage: 'initial', requestedCount: 4, generatedCount: 4, acceptedCount: 3, regenerateCount: 1,
    rerollRequestedCount: 1, rerollGeneratedCount: 1, dropped: [], verdicts: [], picks: [], failures: [], ...overrides
  };
}

test('small-batch shortfall thresholds require an absolute-count guard', () => {
  const report = buildFinalTextAudit({
    requestedCount: 4,
    initial: stage(),
    conversations: [conversation('convo-01', 1), conversation('convo-02', 2), conversation('convo-03', 3)],
    currentSetVocabulary: vocabulary.filter((item) => item.set === 2)
  });
  assert.equal(report.shortfallCount, 1);
  assert.equal(report.thresholds.find((item) => item.id === 'total-shortfall')?.outcome, 'met');
  assert.equal(report.outcome, 'pass');
});
