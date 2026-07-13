import type { AiCurationEligibleRun } from '../shared/types.ts';

export function selectedCurationCandidateCount(runs: AiCurationEligibleRun[], selectedRunIds: string[]): number {
  const selected = new Set(selectedRunIds);
  return runs.reduce((total, run) => selected.has(run.runId) ? total + run.eligibleCandidateCount : total, 0);
}

export function toggleCurationRun(selectedRunIds: string[], runId: string, selected: boolean): string[] {
  if (selected) return [...new Set([...selectedRunIds, runId])];
  return selectedRunIds.filter((id) => id !== runId);
}
