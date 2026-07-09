export interface StudioSetRun {
  setNumber: number;
}

export function selectStudioRunForSet<TRun extends StudioSetRun>(
  runs: readonly TRun[],
  setNumber: number
): TRun | null {
  return runs.find((run) => run.setNumber === setNumber) ?? null;
}
