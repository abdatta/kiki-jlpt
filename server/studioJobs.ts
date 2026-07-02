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
    // Cancelled is terminal: late writes from a still-running runner (whose LLM
    // call was already dispatched) must not revive the job.
    if (current.status === 'cancelled') return current;
    const updated = await updater(current);
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
      stageLabel: current.progress.total > 1 ? `Interrupted - ${current.progress.completed}/${current.progress.total} generated` : 'Interrupted',
      stages: current.stages.map((stage) => stage.status === 'running'
        ? { ...stage, status: 'interrupted', completedAt: nowIso(), error: 'API process restarted.' }
        : stage),
      error: 'API process restarted. Resume manually.'
    })));
  }
  return interrupted;
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
