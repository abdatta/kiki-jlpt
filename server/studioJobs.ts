import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { PracticeRun, StudioEvent, StudioJob, StudioJobStatus } from '../shared/types.ts';
import { atomicWriteFile, retryTransientFs } from './atomic.ts';
import { STUDIO_JOBS_DIR } from './paths.ts';

type StudioJobListener = (event: StudioEvent) => void;

const jobQueues = new Map<string, Promise<void>>();
const idempotencyQueues = new Map<string, Promise<void>>();
const listeners = new Set<StudioJobListener>();
let eventRevision = 0;
const eventEpoch = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
let studioJobsRoot = STUDIO_JOBS_DIR;

function nowIso(): string {
  return new Date().toISOString();
}

function jobPath(jobId: string): string {
  return path.join(studioJobsRoot, `${jobId}.json`);
}

function isActive(status: StudioJobStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'pausing' || status === 'paused' || status === 'interrupted';
}

/**
 * Legal status transitions. Writers submit their intended status; a write whose
 * status change is not listed here is dropped unchanged (see updateStudioJob).
 * `succeeded` accepts payload-only updates (same-status) but no status change;
 * `cancelled` is fully frozen - a discard is final. `failed` stays resumable.
 */
const LEGAL_TRANSITIONS: Record<StudioJobStatus, StudioJobStatus[]> = {
  queued: ['running', 'pausing', 'paused', 'interrupted', 'succeeded', 'failed', 'cancelled'],
  running: ['pausing', 'paused', 'interrupted', 'succeeded', 'failed', 'cancelled'],
  pausing: ['running', 'paused', 'interrupted', 'succeeded', 'failed', 'cancelled'],
  paused: ['queued', 'running', 'succeeded', 'cancelled'],
  interrupted: ['queued', 'running', 'succeeded', 'cancelled'],
  failed: ['queued', 'running', 'succeeded', 'cancelled'],
  succeeded: [],
  cancelled: []
};

function emitJob(job: StudioJob): void {
  eventRevision += 1;
  const event: StudioEvent = {
    id: `studio-event-${eventEpoch}-${eventRevision}`,
    type: 'job',
    revision: eventRevision,
    emittedAt: nowIso(),
    job
  };
  for (const listener of listeners) listener(event);
}

export function publishStudioRunEvent(run: PracticeRun): void {
  eventRevision += 1;
  const event: StudioEvent = {
    id: `studio-event-${eventEpoch}-${eventRevision}`,
    type: 'run',
    revision: eventRevision,
    emittedAt: nowIso(),
    run
  };
  for (const listener of listeners) listener(event);
}

async function writeJob(job: StudioJob): Promise<void> {
  await atomicWriteFile(jobPath(job.id), `${JSON.stringify(job, null, 2)}\n`);
}

async function withJobQueue<T>(jobId: string, operation: () => Promise<T>): Promise<T> {
  const previous = jobQueues.get(jobId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const tail = current.then(() => undefined, () => undefined);
  jobQueues.set(jobId, tail);
  try {
    return await current;
  } finally {
    if (jobQueues.get(jobId) === tail) jobQueues.delete(jobId);
  }
}

async function withIdempotencyQueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = idempotencyQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const tail = current.then(() => undefined, () => undefined);
  idempotencyQueues.set(key, tail);
  try {
    return await current;
  } finally {
    if (idempotencyQueues.get(key) === tail) idempotencyQueues.delete(key);
  }
}

export function currentStudioEventRevision(): number {
  return eventRevision;
}

export function subscribeStudioEvents(listener: StudioJobListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function readStudioJob(jobId: string): Promise<StudioJob> {
  return JSON.parse((await retryTransientFs(() => readFile(jobPath(jobId), 'utf8'))).replace(/^\uFEFF/, '')) as StudioJob;
}

export async function listStudioJobs(): Promise<StudioJob[]> {
  await mkdir(studioJobsRoot, { recursive: true });
  const entries = await readdir(studioJobsRoot, { withFileTypes: true });
  const jobs = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map(async (entry) => {
    try {
      return await readStudioJob(entry.name.slice(0, -5));
    } catch {
      return null;
    }
  }));
  return jobs.filter((job): job is StudioJob => Boolean(job)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function findStudioJobByIdempotencyKey(key: string): Promise<StudioJob | undefined> {
  return (await listStudioJobs()).find((job) => job.idempotencyKey === key);
}

export async function findActiveStudioJobByDeduplicationKey(key: string): Promise<StudioJob | undefined> {
  return (await listStudioJobs()).find((job) => job.deduplicationKey === key && isActive(job.status));
}

export async function createStudioJob(job: StudioJob): Promise<StudioJob> {
  return withIdempotencyQueue(job.idempotencyKey, async () => {
    const existing = await findStudioJobByIdempotencyKey(job.idempotencyKey);
    if (existing) return existing;
    await writeJob(job);
    emitJob(job);
    return job;
  });
}

export async function updateStudioJob(jobId: string, updater: (job: StudioJob) => StudioJob | Promise<StudioJob>): Promise<StudioJob> {
  return withJobQueue(jobId, async () => {
    const current = await readStudioJob(jobId);
    // A discard is final: even payload-only writes from a still-running runner
    // (whose provider call was already dispatched) must not touch the job.
    if (current.status === 'cancelled') return current;
    const updated = await updater(current);
    if (updated.status !== current.status && !LEGAL_TRANSITIONS[current.status].includes(updated.status)) {
      console.warn(`[studio-jobs] Ignored illegal status transition for ${jobId}: ${current.status} -> ${updated.status}`);
      return current;
    }
    const next: StudioJob = {
      ...updated,
      revision: current.revision + 1,
      updatedAt: nowIso()
    };
    await writeJob(next);
    emitJob(next);
    return next;
  });
}

export async function interruptActiveStudioJobs(): Promise<StudioJob[]> {
  const jobs = await listStudioJobs();
  const interrupted: StudioJob[] = [];
  for (const job of jobs) {
    if (!['queued', 'running', 'pausing'].includes(job.status)) continue;
    interrupted.push(await updateStudioJob(job.id, (current) => ({
      ...current,
      status: 'interrupted',
      stageLabel: deriveStageLabel({ ...current, status: 'interrupted' }),
      stages: current.stages.map((stage) => stage.status === 'running'
        ? { ...stage, status: 'interrupted', completedAt: nowIso(), error: 'API process restarted.' }
        : stage),
      error: 'API process restarted. Resume manually.'
    })));
  }
  return interrupted;
}

/**
 * Derives the display label for count-bearing job states from durable status
 * and progress, so no status writer can lose completed-versus-total counts.
 * Transient labels that carry information state cannot express (for example
 * "Waiting for earlier generation", "Pausing after current step", "Resuming
 * workflow", runner stage names) remain caller-authored by design.
 */
export function deriveStageLabel(job: Pick<StudioJob, 'kind' | 'status' | 'progress'>): string {
  const { completed, total } = job.progress;
  const counts = total > 1 ? `${completed}/${total}` : null;
  const isAudio = job.kind === 'audio-batch' || job.kind === 'add-all-audio' || job.kind === 'audio-child';
  switch (job.status) {
    case 'queued':
      return isAudio ? 'Queued for audio' : 'Queued for generation';
    case 'running':
    case 'pausing':
      return counts ? `${counts} audio generated` : isAudio ? 'Generating audio' : 'Generating';
    case 'paused':
      return counts ? `Audio paused - ${counts} generated` : 'Paused';
    case 'interrupted':
      return counts ? `Interrupted - ${counts} generated` : 'Interrupted';
    case 'succeeded':
      return isAudio ? 'Audio complete' : 'Complete';
    case 'failed':
      return counts ? `Audio generation failed - ${counts} generated` : isAudio ? 'Audio generation failed' : 'Failed';
    case 'cancelled':
      return counts ? `Discarded with ${counts} audio generated` : 'Discarded';
  }
}

export function makeStudioJobId(prefix: string): string {
  return `${prefix}-${nowIso().replace(/[-:.]/g, '')}-${Math.random().toString(36).slice(2, 8)}`;
}

export function configureStudioJobStorageForTests(root: string): void {
  studioJobsRoot = root;
  jobQueues.clear();
  idempotencyQueues.clear();
  eventRevision = 0;
}
