import type { AiCurationRecommendation, PracticeRun } from '../shared/types.ts';

export interface AddAllPlanItem {
  candidateKey: string;
  title: string;
  sourceRunId: string;
  sourceConversationId: string;
  audioReady: boolean;
  libraryReady: boolean;
  sourceError?: string;
}

export function planAddAllRecommendations(
  recommendations: readonly AiCurationRecommendation[],
  runsById: ReadonlyMap<string, PracticeRun>,
  unavailableRunIds: ReadonlySet<string> = new Set()
): AddAllPlanItem[] {
  return recommendations.map((recommendation) => {
    const run = runsById.get(recommendation.sourceRunId);
    const conversation = run?.conversations.find((item) => item.id === recommendation.sourceConversationId);
    const sourceError = !run
      ? unavailableRunIds.has(recommendation.sourceRunId)
        ? 'Source run could not be loaded.'
        : 'Source run no longer exists.'
      : !conversation
        ? 'Source conversation no longer exists.'
        : undefined;

    return {
      candidateKey: recommendation.candidateKey,
      title: recommendation.conversation.title,
      sourceRunId: recommendation.sourceRunId,
      sourceConversationId: recommendation.sourceConversationId,
      audioReady: Boolean(conversation?.audioFileName),
      libraryReady: Boolean(conversation?.curatedId),
      sourceError
    };
  });
}

export type StopOnFailureResult<T> =
  | { status: 'done'; value: T }
  | { status: 'error'; error: unknown }
  | { status: 'skipped' }
  | { status: 'paused' };

export interface StopOnFailureQueueOptions<TItem, TValue> {
  concurrency?: number;
  run: (item: TItem, index: number) => Promise<TValue>;
  shouldPause?: () => boolean;
  onStart?: (item: TItem, index: number) => void;
  onSettled?: (item: TItem, result: StopOnFailureResult<TValue>, index: number) => void;
}

export async function runStopOnFailureQueue<TItem, TValue>(
  items: readonly TItem[],
  options: StopOnFailureQueueOptions<TItem, TValue>
): Promise<Array<StopOnFailureResult<TValue>>> {
  if (items.length === 0) return [];

  const concurrency = Math.max(1, Math.min(Math.floor(options.concurrency ?? 3), items.length));
  const results: Array<StopOnFailureResult<TValue> | undefined> = Array.from({ length: items.length });
  let nextIndex = 0;
  let stopStarting = false;
  let stopReason: 'failure' | 'pause' | undefined;

  async function worker(): Promise<void> {
    while (!stopStarting) {
      if (options.shouldPause?.()) {
        stopStarting = true;
        stopReason ??= 'pause';
        return;
      }
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) return;

      options.onStart?.(item, index);
      try {
        const result: StopOnFailureResult<TValue> = {
          status: 'done',
          value: await options.run(item, index)
        };
        results[index] = result;
        options.onSettled?.(item, result, index);
      } catch (error) {
        const result: StopOnFailureResult<TValue> = { status: 'error', error };
        results[index] = result;
        stopStarting = true;
        stopReason = 'failure';
        options.onSettled?.(item, result, index);
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return results.map((result, index) => {
    if (result) return result;
    const unstarted: StopOnFailureResult<TValue> = stopReason === 'pause'
      ? { status: 'paused' }
      : { status: 'skipped' };
    options.onSettled?.(items[index], unstarted, index);
    return unstarted;
  });
}
