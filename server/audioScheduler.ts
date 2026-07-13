import type { PracticeConversation, StudioJob } from '../shared/types.ts';
import { generateConversationAudio } from './gemini.ts';
import { mutateRun, readRun, touchConversation } from './storage.ts';
import {
  createStudioJob,
  deriveStageLabel,
  findActiveStudioJobByDeduplicationKey,
  listStudioJobs,
  makeStudioJobId,
  readStudioJob,
  subscribeStudioEvents,
  updateStudioJob
} from './studioJobs.ts';

let audioConcurrency = 3;
let audioExecutor = generateConversationAudio;
let activeWorkers = 0;
let pumping = false;
let lastParentId: string | undefined;
const claimedJobIds = new Set<string>();
const deduplicationQueues = new Map<string, Promise<void>>();

async function withDeduplicationQueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = deduplicationQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const tail = current.then(() => undefined, () => undefined);
  deduplicationQueues.set(key, tail);
  try {
    return await current;
  } finally {
    if (deduplicationQueues.get(key) === tail) deduplicationQueues.delete(key);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function audioUrl(runId: string, fileName: string): string {
  return `/audio/${encodeURIComponent(runId)}/audio/${encodeURIComponent(fileName)}`;
}

function childRequest(job: StudioJob): { runId: string; conversationId: string } {
  const request = job.request as { runId?: string; conversationId?: string } | undefined;
  const runId = job.runId ?? request?.runId;
  const conversationId = job.conversationId ?? request?.conversationId;
  if (!runId || !conversationId) throw new Error('Audio job is missing its source conversation.');
  return { runId, conversationId };
}

function childBelongsToParent(job: StudioJob, parentJobId: string): boolean {
  return job.parentJobId === parentJobId || Boolean(job.dependentParentJobIds?.includes(parentJobId));
}

function childParentIds(job: StudioJob): string[] {
  return [...new Set([job.parentJobId, ...(job.dependentParentJobIds ?? [])].filter((id): id is string => Boolean(id)))];
}

async function updateParent(parentJobId: string): Promise<void> {
  const jobs = await listStudioJobs();
  const children = jobs.filter((job) => childBelongsToParent(job, parentJobId));
  if (!children.length) return;
  const completed = children.filter((job) => job.status === 'succeeded').length;
  const failed = children.filter((job) => job.status === 'failed').length;
  const running = children.filter((job) => job.status === 'running').length;
  const queued = children.filter((job) => job.status === 'queued').length;
  const parent = await readStudioJob(parentJobId);
  const total = Math.max(parent.progress.total, children.length);
  let status = parent.status;
  if (failed > 0 && parent.stopOnFailure) {
    status = 'failed';
  } else if (children.length >= total && completed + failed === total) {
    status = failed > 0 ? 'failed' : 'succeeded';
  } else if ((parent.status === 'pausing' || parent.status === 'paused') && running === 0) {
    status = 'paused';
  }
  const progress = { completed, total, failed, running, queued };
  const stageLabel = deriveStageLabel({ kind: parent.kind, status, progress });
  await updateStudioJob(parentJobId, (current) => ({
    ...current,
    status,
    stageLabel,
    progress,
    completedAt: status === 'succeeded' || status === 'failed' ? nowIso() : current.completedAt
  }));
}

async function stopParentSiblings(parentJobId: string, failedJobId: string): Promise<void> {
  const parent = await readStudioJob(parentJobId);
  if (!parent.stopOnFailure) return;
  const jobs = await listStudioJobs();
  for (const sibling of jobs.filter((job) => childBelongsToParent(job, parentJobId) && job.id !== failedJobId && job.status === 'queued')) {
    // Keep a shared child queued only when another parent can still run it.
    // A failed retry parent must not leave its siblings queued forever merely
    // because they are also attached to an older terminal parent.
    const otherParents = await Promise.all(
      childParentIds(sibling)
        .filter((id) => id !== parentJobId)
        .map((id) => readStudioJob(id).catch(() => undefined))
    );
    if (otherParents.some((other) => other?.status === 'queued' || other?.status === 'running' || other?.status === 'pausing')) continue;
    await updateStudioJob(sibling.id, (current) => ({
      ...current,
      status: 'paused',
      stageLabel: 'Skipped after earlier failure',
      error: 'Audio generation skipped after an earlier failure.'
    }));
  }
}

async function runChild(job: StudioJob): Promise<void> {
  activeWorkers += 1;
  const { runId, conversationId } = childRequest(job);
  try {
    const running = await updateStudioJob(job.id, (current) => ({
      ...current,
      status: 'running',
      stageLabel: 'Generating audio',
      stages: current.stages.map((stage) => stage.id === 'audio'
        ? { ...stage, status: 'running', startedAt: nowIso(), error: undefined }
        : stage)
    }));
    const run = await mutateRun(runId, (current) => ({
      ...current,
      conversations: current.conversations.map((conversation) => conversation.id === conversationId
        ? touchConversation({ ...conversation, status: 'audio_generating', error: undefined })
        : conversation),
      updatedAt: nowIso()
    }));
    const conversation = run.conversations.find((item) => item.id === conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
    if (conversation.curatedId) throw new Error('This conversation is in Library and is read-only.');
    const audio = await audioExecutor(runId, conversation, running.id);
    await mutateRun(runId, (current) => {
      const conversations = current.conversations.map((item) => item.id === conversationId
        ? touchConversation({
            ...item,
            status: 'audio_ready' as const,
            audioFileName: audio.fileName,
            audioUrl: audioUrl(runId, audio.fileName),
            error: undefined
          })
        : item);
      return {
        ...current,
        conversations,
        status: conversations.every((item) => item.audioFileName) ? 'complete' : conversations.some((item) => item.audioFileName) ? 'partial_audio' : 'generated',
        updatedAt: nowIso()
      };
    });
    await updateStudioJob(job.id, (current) => ({
      ...current,
      status: 'succeeded',
      stageLabel: 'Audio complete',
      progress: { completed: 1, total: 1 },
      completedAt: nowIso(),
      stages: current.stages.map((stage) => stage.id === 'audio'
        ? { ...stage, status: 'succeeded', completedAt: nowIso(), error: undefined }
        : stage)
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await mutateRun(runId, (current) => ({
      ...current,
      conversations: current.conversations.map((conversation) => conversation.id === conversationId
        ? touchConversation({ ...conversation, status: 'audio_failed', error: message })
        : conversation),
      updatedAt: nowIso()
    })).catch(() => undefined);
    await updateStudioJob(job.id, (current) => ({
      ...current,
      status: 'failed',
      stageLabel: 'Audio failed',
      error: message,
      completedAt: nowIso(),
      progress: { completed: 0, total: 1, failed: 1 },
      stages: current.stages.map((stage) => stage.id === 'audio'
        ? { ...stage, status: 'failed', completedAt: nowIso(), error: message }
        : stage)
    }));
    for (const parentJobId of childParentIds(job)) await stopParentSiblings(parentJobId, job.id);
  } finally {
    for (const parentJobId of childParentIds(job)) await updateParent(parentJobId).catch(() => undefined);
    activeWorkers -= 1;
    claimedJobIds.delete(job.id);
    void pumpAudioJobs();
  }
}

async function nextQueuedJob(): Promise<StudioJob | undefined> {
  const jobs = (await listStudioJobs()).filter((job) => job.kind === 'audio-child' && job.status === 'queued' && !claimedJobIds.has(job.id));
  const eligible: StudioJob[] = [];
  for (const job of jobs.reverse()) {
    const parentIds = childParentIds(job);
    if (!parentIds.length) {
      eligible.push(job);
      continue;
    }
    // A retry batch can attach to a paused child left behind by an earlier
    // failed batch. Its original parent remains failed, so eligibility must
    // consider every parent, not just parentJobId.
    const parents = await Promise.all(parentIds.map((parentId) => readStudioJob(parentId).catch(() => undefined)));
    if (parents.some((parent) => parent?.status === 'running' || parent?.status === 'queued')) eligible.push(job);
  }
  return eligible.find((job) => job.parentJobId !== lastParentId) ?? eligible[0];
}

export async function pumpAudioJobs(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (activeWorkers < audioConcurrency) {
      const next = await nextQueuedJob();
      if (!next) break;
      lastParentId = next.parentJobId;
      claimedJobIds.add(next.id);
      void runChild(next);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    pumping = false;
  }
}

export async function enqueueConversationAudio(args: {
  runId: string;
  conversationId: string;
  parentJobId?: string;
  idempotencyKey?: string;
}): Promise<{ job: StudioJob; attached: boolean }> {
  const deduplicationKey = `${args.runId}:${args.conversationId}`;
  return withDeduplicationQueue(deduplicationKey, async () => {
    let existing = await findActiveStudioJobByDeduplicationKey(deduplicationKey);
    // A direct card retry after a failed/interrupted batch must not attach to
    // the stale paused child: it has a terminal parent and cannot run again.
    // Retire it and create a fresh standalone job instead.
    if (!args.parentJobId && existing && (existing.status === 'paused' || existing.status === 'interrupted')) {
      await updateStudioJob(existing.id, (current) => ({
        ...current,
        status: 'cancelled',
        stageLabel: 'Replaced by a direct retry',
        completedAt: nowIso()
      }));
      existing = undefined;
    }
    if (existing) {
      const attached = args.parentJobId && !childBelongsToParent(existing, args.parentJobId)
        ? await updateStudioJob(existing.id, (current) => {
            const retryingPausedChild = current.status === 'paused' || current.status === 'interrupted';
            return {
              ...current,
              status: retryingPausedChild ? 'queued' : current.status,
              stageLabel: retryingPausedChild ? 'Queued for audio' : current.stageLabel,
              progress: retryingPausedChild ? { completed: 0, total: 1, queued: 1 } : current.progress,
              error: retryingPausedChild ? undefined : current.error,
              dependentParentJobIds: [...new Set([...(current.dependentParentJobIds ?? []), args.parentJobId!])]
            };
          })
        : existing;
      if (attached.status === 'queued') void pumpAudioJobs();
      return { job: attached, attached: true };
    }
    const run = await readRun(args.runId);
    const conversation = run.conversations.find((item) => item.id === args.conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${args.conversationId}`);
    if (conversation.curatedId) throw new Error('This conversation is in Library and is read-only.');
    const timestamp = nowIso();
    const job = await createStudioJob({
      id: makeStudioJobId('audio'),
      idempotencyKey: args.idempotencyKey ?? `audio:${deduplicationKey}:${timestamp}`,
      kind: 'audio-child',
      status: 'queued',
      title: conversation.title,
      detail: `Set ${run.setNumber} - Conversation ${conversation.number}`,
      stageLabel: 'Queued for audio',
      setNumber: run.setNumber,
      runId: args.runId,
      conversationId: args.conversationId,
      parentJobId: args.parentJobId,
      deduplicationKey,
      revision: 1,
      progress: { completed: 0, total: 1, queued: 1 },
      stages: [{ id: 'audio', label: 'Generate audio', status: 'pending' }],
      request: args,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    void pumpAudioJobs();
    return { job, attached: false };
  });
}

export async function createAudioBatch(args: {
  runId: string;
  conversationIds: string[];
  idempotencyKey: string;
  kind?: 'audio-batch' | 'add-all-audio';
  title?: string;
  stopOnFailure?: boolean;
}): Promise<StudioJob> {
  const run = await readRun(args.runId);
  const timestamp = nowIso();
  const parent = await createStudioJob({
    id: makeStudioJobId('audio-batch'),
    idempotencyKey: args.idempotencyKey,
    kind: args.kind ?? 'audio-batch',
    status: 'running',
    title: args.title ?? `Generate audio for Set ${run.setNumber}`,
    detail: `${args.conversationIds.length} conversations`,
    stageLabel: `0/${args.conversationIds.length} audio generated`,
    setNumber: run.setNumber,
    runId: run.id,
    stopOnFailure: args.stopOnFailure ?? true,
    revision: 1,
    progress: { completed: 0, total: args.conversationIds.length, queued: args.conversationIds.length },
    stages: [{ id: 'audio', label: 'Generate audio', status: 'running', startedAt: timestamp }],
    request: args,
    createdAt: timestamp,
    updatedAt: timestamp
  });
  await reconcileAudioChildren(parent.id, { reuseExistingAudio: false });
  await updateParent(parent.id);
  void pumpAudioJobs();
  return readStudioJob(parent.id);
}

export async function createCrossRunAudioBatch(args: {
  items: Array<{ runId: string; conversationId: string }>;
  idempotencyKey: string;
  setNumber?: number;
  title: string;
  stopOnFailure?: boolean;
}): Promise<StudioJob> {
  const timestamp = nowIso();
  const parent = await createStudioJob({
    id: makeStudioJobId('add-all-audio'),
    idempotencyKey: args.idempotencyKey,
    kind: 'add-all-audio',
    status: 'running',
    title: args.title,
    detail: `${args.items.length} conversations`,
    stageLabel: `0/${args.items.length} audio generated`,
    setNumber: args.setNumber,
    stopOnFailure: args.stopOnFailure ?? true,
    revision: 1,
    progress: { completed: 0, total: args.items.length, queued: args.items.length },
    stages: [{ id: 'audio', label: 'Generate recommendation audio', status: 'running', startedAt: timestamp }],
    request: args,
    createdAt: timestamp,
    updatedAt: timestamp
  });
  await reconcileAudioChildren(parent.id, { reuseExistingAudio: false });
  await updateParent(parent.id);
  void pumpAudioJobs();
  return readStudioJob(parent.id);
}

export async function pauseAudioParent(jobId: string): Promise<StudioJob> {
  const parent = await updateStudioJob(jobId, (current) => ({ ...current, status: 'pausing', stageLabel: 'Pausing audio' }));
  await updateParent(jobId);
  return readStudioJob(parent.id);
}

function parentRequestedItems(parent: StudioJob): Array<{ runId: string; conversationId: string }> {
  const request = parent.request as {
    runId?: string;
    conversationIds?: string[];
    items?: Array<{ runId?: string; conversationId?: string }>;
  } | undefined;
  if (request?.items) {
    return request.items.filter((item): item is { runId: string; conversationId: string } => Boolean(item.runId && item.conversationId));
  }
  if (request?.runId && request.conversationIds) {
    return request.conversationIds.map((conversationId) => ({ runId: request.runId!, conversationId }));
  }
  return [];
}

/**
 * Converges a parent's children with its persisted request: enqueues children
 * that were never created (e.g. the original start failed partway), and, when
 * reuseExistingAudio is set, settles unresolved children whose audio already
 * exists on disk. Start paths pass reuseExistingAudio: false so replace-mode
 * batches still regenerate over old audio; resume paths pass true so completed
 * work is never redone. Children stay inert until the parent is running.
 */
async function reconcileAudioChildren(parentJobId: string, options: { reuseExistingAudio: boolean }): Promise<void> {
  const parent = await readStudioJob(parentJobId);
  const existing = (await listStudioJobs()).filter((job) => childBelongsToParent(job, parentJobId));
  const known = new Set(existing.map((child) => {
    const { runId, conversationId } = childRequest(child);
    return `${runId}:${conversationId}`;
  }));
  for (const item of parentRequestedItems(parent)) {
    if (known.has(`${item.runId}:${item.conversationId}`)) continue;
    await enqueueConversationAudio({ ...item, parentJobId }).catch(() => undefined);
  }
  if (!options.reuseExistingAudio) return;
  const children = (await listStudioJobs()).filter((job) => childBelongsToParent(job, parentJobId));
  for (const child of children.filter((job) => ['queued', 'paused', 'interrupted', 'failed'].includes(job.status))) {
    const { runId, conversationId } = childRequest(child);
    const run = await readRun(runId).catch(() => undefined);
    const conversation = run?.conversations.find((item) => item.id === conversationId);
    if (conversation?.audioFileName) {
      await updateStudioJob(child.id, (current) => ({ ...current, status: 'succeeded', stageLabel: deriveStageLabel({ ...current, status: 'succeeded' }), progress: { completed: 1, total: 1 } }));
    } else if (child.status !== 'queued') {
      await updateStudioJob(child.id, (current) => ({ ...current, status: 'queued', stageLabel: deriveStageLabel({ ...current, status: 'queued' }), error: undefined }));
    }
  }
}

export async function resumeAudioParent(jobId: string): Promise<StudioJob> {
  const parent = await readStudioJob(jobId);
  if (parent.status === 'cancelled') {
    throw new Error('This job was discarded and can no longer be resumed.');
  }
  await reconcileAudioChildren(jobId, { reuseExistingAudio: true });
  await updateStudioJob(jobId, (current) => ({ ...current, status: 'running', stageLabel: 'Resuming audio', error: undefined }));
  await updateParent(jobId);
  void pumpAudioJobs();
  return readStudioJob(jobId);
}

export async function cancelUnresolvedAudioChildren(jobId: string): Promise<void> {
  const children = (await listStudioJobs()).filter((job) => childBelongsToParent(job, jobId));
  for (const child of children.filter((job) => ['queued', 'paused', 'interrupted', 'failed'].includes(job.status))) {
    if (childParentIds(child).some((id) => id !== jobId)) continue;
    await updateStudioJob(child.id, (current) => ({
      ...current,
      status: 'cancelled',
      stageLabel: deriveStageLabel({ ...current, status: 'cancelled' }),
      completedAt: nowIso(),
      stages: current.stages.map((stage) => stage.status === 'succeeded'
        ? stage
        : { ...stage, status: 'skipped', completedAt: nowIso() })
    }));
  }
}

export async function cancelAudioParent(jobId: string): Promise<StudioJob> {
  const parent = await readStudioJob(jobId);
  if (parent.status === 'cancelled') return parent;
  if (!['paused', 'interrupted', 'failed'].includes(parent.status)) {
    throw new Error('Pause this job before discarding its remaining work.');
  }
  await cancelUnresolvedAudioChildren(jobId);
  const children = (await listStudioJobs()).filter((job) => childBelongsToParent(job, jobId));
  const completed = children.filter((job) => job.status === 'succeeded').length;
  return updateStudioJob(jobId, (current) => {
    const progress = { ...current.progress, completed };
    return {
      ...current,
      status: 'cancelled',
      stageLabel: deriveStageLabel({ kind: current.kind, status: 'cancelled', progress }),
      progress,
      completedAt: nowIso(),
      stages: current.stages.map((stage) => stage.status === 'succeeded'
        ? stage
        : { ...stage, status: 'skipped', completedAt: nowIso() })
    };
  });
}

export async function resumeConversationAudioJob(jobId: string): Promise<StudioJob> {
  const job = await readStudioJob(jobId);
  if (job.kind !== 'audio-child') throw new Error('This is not an individual audio job.');
  const { runId, conversationId } = childRequest(job);
  const run = await readRun(runId);
  const conversation = run.conversations.find((item) => item.id === conversationId);
  const resumed = await updateStudioJob(jobId, (current) => conversation?.audioFileName
    ? { ...current, status: 'succeeded', stageLabel: 'Audio complete', progress: { completed: 1, total: 1 }, error: undefined }
    : { ...current, status: 'queued', stageLabel: 'Queued for audio', progress: { completed: 0, total: 1, queued: 1 }, error: undefined });
  void pumpAudioJobs();
  return resumed;
}

export async function hasActiveConversationAudio(runId: string, conversationId: string): Promise<boolean> {
  return Boolean(await findActiveStudioJobByDeduplicationKey(`${runId}:${conversationId}`));
}

export async function waitForStudioJob(jobId: string): Promise<StudioJob> {
  const current = await readStudioJob(jobId);
  if (['succeeded', 'failed', 'paused', 'interrupted', 'cancelled'].includes(current.status)) return current;
  return new Promise((resolve) => {
    const unsubscribe = subscribeStudioEvents((event) => {
      if (event.job?.id !== jobId) return;
      if (['succeeded', 'failed', 'paused', 'interrupted', 'cancelled'].includes(event.job.status)) {
        unsubscribe();
        resolve(event.job);
      }
    });
  });
}

export function configureAudioSchedulerForTests(options: {
  concurrency?: number;
  executor?: typeof generateConversationAudio;
} = {}): void {
  audioConcurrency = options.concurrency ?? 3;
  audioExecutor = options.executor ?? generateConversationAudio;
  activeWorkers = 0;
  pumping = false;
  lastParentId = undefined;
  claimedJobIds.clear();
  deduplicationQueues.clear();
}

export async function waitForAudioSchedulerIdle(): Promise<void> {
  while (activeWorkers > 0 || pumping || claimedJobIds.size > 0) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
