import { X } from 'lucide-react';
import { AudioProgressStage, type AudioProgressItemStatus } from './AudioProgressStage.tsx';

export type AddAllItemStatus = AudioProgressItemStatus;

export interface AddAllProgressItem {
  candidateKey: string;
  title: string;
  audioStatus: AddAllItemStatus;
  libraryStatus: AddAllItemStatus;
  audioDetail?: string;
  libraryDetail?: string;
  error?: string;
}

export interface AddAllProgress {
  stage: 'preparing' | 'ready' | 'audio' | 'pausing' | 'paused' | 'library' | 'complete' | 'failed';
  items: AddAllProgressItem[];
  error?: string;
}

function libraryStatusLabel(status: AddAllItemStatus, detail?: string): string {
  if (detail) return detail;
  if (status === 'skipped') return 'Stopped';
  if (status === 'done') return 'Done';
  if (status === 'processing') return 'Working';
  if (status === 'error') return 'Failed';
  return 'Waiting';
}

function audioDetail(item: AddAllProgressItem): string {
  if (item.audioDetail) return item.audioDetail;
  if (item.audioStatus === 'processing') return 'Generating audio';
  if (item.audioStatus === 'done') return 'Audio ready';
  if (item.audioStatus === 'error') return item.error ?? 'Audio failed';
  if (item.audioStatus === 'skipped') return 'Skipped after failure';
  if (item.audioStatus === 'paused') return 'Paused';
  return 'Queued';
}

export function AddAllProgressModal({ progress, onClose, onRun, onPause }: {
  progress: AddAllProgress;
  onClose: () => void;
  onRun: () => void;
  onPause: () => void;
}) {
  const active = progress.stage === 'preparing' || progress.stage === 'audio' || progress.stage === 'pausing' || progress.stage === 'library';
  const allAudioReady = progress.items.length > 0 && progress.items.every((item) => item.audioStatus === 'done');
  const showLibraryProgress = progress.stage === 'library'
    || progress.stage === 'complete'
    || (progress.stage === 'failed' && progress.items.every((item) => item.audioStatus === 'done'));
  return (
    <div className="modalOverlay" role="presentation">
      <section className="generateModal addAllModal" role="dialog" aria-modal="true" aria-labelledby="add-all-modal-title">
        <div className="modalHeader">
          <div>
            <p className="eyebrow">Portfolio workflow</p>
            <h2 id="add-all-modal-title">Add all recommendations</h2>
          </div>
          <button className="iconButton" onClick={onClose} disabled={active} title="Close" type="button"><X size={18} /></button>
        </div>
        {progress.error ? <p className="addAllStage error">{progress.error}</p> : null}
        <AudioProgressStage
          items={progress.items.map((item) => ({
            id: item.candidateKey,
            title: item.title,
            detail: audioDetail(item),
            status: item.audioStatus
          }))}
          state={progress.stage === 'preparing'
            ? 'preparing'
            : progress.stage === 'ready'
              ? 'ready'
              : progress.stage === 'audio'
                ? 'running'
                : progress.stage === 'pausing'
                  ? 'pausing'
                  : progress.stage === 'paused'
                    ? 'paused'
                    : 'idle'}
        />
        {showLibraryProgress ? (
          <section className="addAllLibraryStage" aria-label="Library additions">
            <div className="addAllLibraryHeader">
              <div>
                <strong>{progress.stage === 'complete' ? 'Added to Library' : progress.stage === 'library' ? 'Adding to Library' : 'Library Additions Incomplete'}</strong>
                <small>{progress.items.filter((item) => item.libraryStatus === 'done').length} of {progress.items.length} conversations added</small>
              </div>
            </div>
            <div className="addAllProgressList">
              {progress.items.map((item, index) => (
                <div className={`addAllProgressRow ${item.libraryStatus}`} key={item.candidateKey}>
                  <span className="workflowAudioItemNumber">{index + 1}</span>
                  <span><strong>{item.title}</strong>{item.libraryStatus === 'error' && item.error ? <small>{item.error}</small> : null}</span>
                  <span className={item.libraryStatus}>{libraryStatusLabel(item.libraryStatus, item.libraryDetail)}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        <div className="modalActions">
          <button className="secondaryButton" onClick={onClose} disabled={active}>{progress.stage === 'complete' ? 'Done' : 'Close'}</button>
          {progress.stage === 'ready' ? <button className="primaryButton" onClick={onRun}>{allAudioReady ? 'Add to Library' : 'Start generation'}</button> : null}
          {progress.stage === 'audio' ? <button className="primaryButton" onClick={onPause}>Pause</button> : null}
          {progress.stage === 'pausing' ? <button className="primaryButton" disabled>Pausing...</button> : null}
          {progress.stage === 'paused' ? <button className="primaryButton" onClick={onRun}>Resume</button> : null}
          {progress.stage === 'failed' ? <button className="primaryButton" onClick={onRun}>Retry</button> : null}
        </div>
      </section>
    </div>
  );
}
