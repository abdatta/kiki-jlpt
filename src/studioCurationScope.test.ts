import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiCurationEligibleRun, TextModelInfo } from '../shared/types.ts';
import { selectedCurationCandidateCount, toggleCurationRun } from './studioCurationScope.ts';

const textModel: TextModelInfo = { id: 'gemini', provider: 'gemini', model: 'test', label: 'Test' };
const runs: AiCurationEligibleRun[] = [
  { runId: 'run-a', createdAt: '2026-01-01T00:00:00Z', textModel, eligibleCandidateCount: 2 },
  { runId: 'run-b', createdAt: '2026-01-02T00:00:00Z', textModel, eligibleCandidateCount: 3 }
];

test('curation scope candidate count follows the selected generated runs', () => {
  assert.equal(selectedCurationCandidateCount(runs, ['run-a', 'missing']), 2);
  assert.equal(selectedCurationCandidateCount(runs, ['run-a', 'run-b']), 5);
  assert.equal(selectedCurationCandidateCount(runs, []), 0);
});

test('curation scope toggles retain deliberate empty and subset selections', () => {
  assert.deepEqual(toggleCurationRun(['run-a'], 'run-b', true), ['run-a', 'run-b']);
  assert.deepEqual(toggleCurationRun(['run-a'], 'run-a', false), []);
});
