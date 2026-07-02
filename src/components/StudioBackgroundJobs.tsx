import { CircleAlert, Clock, Pause, Play, RefreshCw, X } from 'lucide-react';
import type { StudioJob } from '../../shared/types.ts';

export interface StudioToast {
  id: string;
  tone: 'success' | 'error' | 'warning';
  title: string;
  detail: string;
}

export function StudioBackgroundJobs({
  jobs,
  connected,
  toasts,
  onPause,
  onResume,
  onCancel,
  onFocus,
  onDismissToast
}: {
  jobs: StudioJob[];
  connected: boolean;
  toasts: StudioToast[];
  onPause: (jobId: string) => void;
  onResume: (jobId: string) => void;
  onCancel: (jobId: string) => void;
  onFocus: (job: StudioJob) => void;
  onDismissToast: (toastId: string) => void;
}) {
  const controllableKinds = ['audio-batch', 'add-all-audio', 'run-generation', 'workflow-generation', 'library-complement'];
  const activeJobs = jobs.filter((job) => ['queued', 'running', 'pausing'].includes(job.status));
  const resumableParents = jobs.filter((job) => controllableKinds.includes(job.kind) && ['paused', 'interrupted'].includes(job.status));
  const trayJobs = [...activeJobs, ...resumableParents];
  const statusRank: Partial<Record<StudioJob['status'], number>> = { running: 0, pausing: 0, queued: 1, paused: 2, interrupted: 3 };
  const visibleJobs = trayJobs
    .filter((job) => job.kind !== 'audio-child' || !job.parentJobId)
    // Working job first, then the waiting queue in start (FIFO) order, then resumable work.
    .sort((a, b) => ((statusRank[a.status] ?? 4) - (statusRank[b.status] ?? 4)) || a.createdAt.localeCompare(b.createdAt))
    .slice(0, 5);
  const queuedCount = activeJobs.filter((job) => job.status === 'queued').length;

  return (
    <>
      {visibleJobs.length > 0 ? (
        <aside className="backgroundJobTray" aria-live="polite" aria-label="Background work">
          {!connected ? <small className="backgroundJobTrayStatus">Reconnecting…</small> : null}
          {visibleJobs.map((job) => {
            const working = job.status === 'running' || job.status === 'pausing';
            const determinate = job.progress.total > 1;
            const percent = determinate ? Math.min(100, Math.round((job.progress.completed / Math.max(1, job.progress.total)) * 100)) : 0;
            return (
              <div className={`backgroundJobRow ${job.status}`} key={job.id}>
                <button className="backgroundJobRowMain" onClick={() => onFocus(job)} title="Open in Studio" type="button">
                  <span className="backgroundJobRowTitle">
                    {working ? <RefreshCw className="spin" size={13} />
                      : job.status === 'queued' ? <Clock size={13} />
                      : job.status === 'paused' ? <Pause size={13} />
                      : <CircleAlert size={13} />}
                    <strong>{job.title}</strong>
                  </span>
                  <span className="backgroundJobRowStage">{job.stageLabel}</span>
                  {job.status === 'queued' ? null : determinate ? (
                    <span className="backgroundJobBar"><span className="backgroundJobBarFill" style={{ width: `${percent}%` }} /></span>
                  ) : working ? (
                    <span className="backgroundJobBar"><span className="backgroundJobBarFill indeterminate" /></span>
                  ) : null}
                </button>
                {(() => {
                  const isAudioParent = job.kind === 'audio-batch' || job.kind === 'add-all-audio';
                  const isGeneration = ['run-generation', 'workflow-generation', 'library-complement'].includes(job.kind);
                  const canPause = (isAudioParent && job.status === 'running')
                    || (isGeneration && (job.status === 'running' || job.status === 'queued'));
                  const canResume = (isAudioParent || isGeneration) && (job.status === 'paused' || job.status === 'interrupted');
                  const canDiscard = (isAudioParent && (job.status === 'paused' || job.status === 'interrupted'))
                    || (isGeneration && ['queued', 'running', 'pausing', 'paused', 'interrupted'].includes(job.status));
                  if (!canPause && !canResume && !canDiscard) return null;
                  return (
                    <span className="backgroundJobRowActions">
                      {canPause ? (
                        <button className="iconButton" onClick={() => onPause(job.id)} title="Pause background job" type="button">
                          <Pause size={14} />
                        </button>
                      ) : null}
                      {canResume ? (
                        <button className="iconButton" onClick={() => onResume(job.id)} title="Resume background job" type="button">
                          <Play size={14} />
                        </button>
                      ) : null}
                      {canDiscard ? (
                        <button className="iconButton" onClick={() => onCancel(job.id)} title="Discard remaining work" type="button">
                          <X size={14} />
                        </button>
                      ) : null}
                    </span>
                  );
                })()}
              </div>
            );
          })}
          {queuedCount > 0 ? <small className="backgroundJobQueueCount">{queuedCount} queued</small> : null}
        </aside>
      ) : null}
      <div className="studioToastStack" aria-live="polite">
        {toasts.map((toast) => (
          <div className={`studioToast ${toast.tone}`} key={toast.id}>
            <div>
              <strong>{toast.title}</strong>
              <span>{toast.detail}</span>
            </div>
            <button className="iconButton" onClick={() => onDismissToast(toast.id)} aria-label="Dismiss notification" type="button">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
