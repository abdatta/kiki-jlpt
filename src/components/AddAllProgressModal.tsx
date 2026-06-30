import { X } from 'lucide-react';

export type AddAllItemStatus = 'pending' | 'processing' | 'done' | 'skipped' | 'error';

export interface AddAllProgressItem {
  candidateKey: string;
  title: string;
  audioStatus: AddAllItemStatus;
  libraryStatus: AddAllItemStatus;
  error?: string;
}

export interface AddAllProgress {
  stage: 'preparing' | 'audio' | 'library' | 'complete' | 'failed';
  items: AddAllProgressItem[];
  error?: string;
}

function progressStatusLabel(status: AddAllItemStatus): string {
  if (status === 'skipped') return 'Already ready';
  if (status === 'done') return 'Done';
  if (status === 'processing') return 'Working';
  if (status === 'error') return 'Failed';
  return 'Waiting';
}

export function AddAllProgressModal({ progress, onClose, onRetry }: {
  progress: AddAllProgress;
  onClose: () => void;
  onRetry: () => void;
}) {
  const active = progress.stage === 'preparing' || progress.stage === 'audio' || progress.stage === 'library';
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
        <p className="addAllStage">
          {progress.stage === 'preparing' ? 'Checking current conversation state...' : null}
          {progress.stage === 'audio' ? 'Generating all missing audio before adding to Library...' : null}
          {progress.stage === 'library' ? 'Audio is ready. Adding the portfolio to Library...' : null}
          {progress.stage === 'complete' ? 'Every recommendation is now in Library.' : null}
          {progress.stage === 'failed' ? progress.error : null}
        </p>
        <div className="addAllProgressList">
          <div className="addAllProgressHeader"><span>Conversation</span><span>Audio</span><span>Library</span></div>
          {progress.items.map((item) => (
            <div className="addAllProgressRow" key={item.candidateKey}>
              <span><strong>{item.title}</strong>{item.error ? <small>{item.error}</small> : null}</span>
              <span className={item.audioStatus}>{progressStatusLabel(item.audioStatus)}</span>
              <span className={item.libraryStatus}>{progressStatusLabel(item.libraryStatus)}</span>
            </div>
          ))}
        </div>
        <div className="modalActions">
          {progress.stage === 'failed' ? <button className="secondaryButton" onClick={onRetry}>Retry</button> : null}
          <button className="primaryButton" onClick={onClose} disabled={active}>{progress.stage === 'complete' ? 'Done' : 'Close'}</button>
        </div>
      </section>
    </div>
  );
}
