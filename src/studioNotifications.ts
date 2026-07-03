import type { StudioJob } from '../shared/types.ts';

export function isTopLevelStudioJob(job: StudioJob): boolean {
  return !job.parentJobId && !job.dependentParentJobIds?.length;
}

const LIVE_NOTIFY_STATUSES = new Set<StudioJob['status']>(['succeeded', 'failed', 'interrupted', 'cancelled']);
const HYDRATION_NOTIFY_STATUSES = new Set<StudioJob['status']>(['succeeded', 'failed', 'interrupted']);

/**
 * Single policy for whether a job state notifies the operator. Children are
 * summarized by their parent and never toast on their own. Hydration (after a
 * reload) skips cancelled because the discard was the operator's own action.
 */
export function shouldNotifyJobEvent(job: StudioJob, source: 'live' | 'hydration'): boolean {
  if (!isTopLevelStudioJob(job)) return false;
  return (source === 'live' ? LIVE_NOTIFY_STATUSES : HYDRATION_NOTIFY_STATUSES).has(job.status);
}
