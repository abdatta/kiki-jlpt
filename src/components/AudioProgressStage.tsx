import { useEffect, useRef } from 'react';
import { Check, CircleAlert, Headphones, LoaderCircle, Pause, RefreshCw, X } from 'lucide-react';

export type AudioProgressItemStatus = 'pending' | 'processing' | 'done' | 'error' | 'skipped' | 'paused';

export interface AudioProgressItem {
  id: string;
  title: string;
  detail: string;
  status: AudioProgressItemStatus;
}

export type AudioProgressStageState = 'preparing' | 'ready' | 'running' | 'pausing' | 'paused' | 'idle';

export function audioProgressStageTitle(items: readonly AudioProgressItem[], state: AudioProgressStageState): string {
  const activeCount = items.filter((item) => item.status === 'processing').length;
  const doneCount = items.filter((item) => item.status === 'done').length;
  const failedCount = items.filter((item) => item.status === 'error').length;
  const skippedCount = items.filter((item) => item.status === 'skipped').length;
  const pausedCount = items.filter((item) => item.status === 'paused').length;
  const pendingCount = items.filter((item) => item.status === 'pending').length;

  if (state === 'pausing') return 'Pausing Audio';
  if (activeCount > 0) return 'Generating Audio';
  if (failedCount > 0) return 'Audio Generation Failed';
  if (items.length > 0 && doneCount === items.length) return 'Generated Audio';
  if (state === 'paused' || pausedCount > 0) return 'Audio Generation Paused';
  if (skippedCount > 0) return 'Audio Generation Stopped';
  if (state === 'preparing') return 'Checking Audio';
  if (state === 'ready') return 'Ready to Generate Audio';
  if (pendingCount > 0 && state !== 'running') return 'Audio Generation Incomplete';
  return 'Generating Audio';
}

function AudioProgressIcon({ status, size = 15 }: { status: AudioProgressItemStatus; size?: number }) {
  if (status === 'processing') return <RefreshCw className="spin" size={size} />;
  if (status === 'done') return <Check size={size} />;
  if (status === 'error') return <CircleAlert size={size} />;
  if (status === 'skipped') return <X size={size} />;
  return <Pause size={size} />;
}

export function AudioProgressStage({
  items,
  state,
  selectedItemId,
  onSelectItem,
  action
}: {
  items: AudioProgressItem[];
  state: AudioProgressStageState;
  selectedItemId?: string;
  onSelectItem?: (itemId: string) => void;
  action?: {
    label: string;
    loading?: boolean;
    onClick: () => void;
  };
}) {
  const activeCount = items.filter((item) => item.status === 'processing').length;
  const doneCount = items.filter((item) => item.status === 'done').length;
  const title = audioProgressStageTitle(items, state);
  const audioListRef = useRef<HTMLDivElement | null>(null);
  const activeItemIds = items.filter((item) => item.status === 'processing').map((item) => item.id).join('|');

  useEffect(() => {
    const list = audioListRef.current;
    if (!activeItemIds || !list) return;
    const activeItems = activeItemIds
      .split('|')
      .map((itemId) => list.querySelector<HTMLElement>(`[data-audio-item-id="${itemId}"]`))
      .filter((item): item is HTMLElement => Boolean(item));
    const lastActiveItem = activeItems[activeItems.length - 1];
    if (!lastActiveItem) return;

    requestAnimationFrame(() => {
      const listRect = list.getBoundingClientRect();
      const lastRect = lastActiveItem.getBoundingClientRect();
      const bottomOverflow = lastRect.bottom - listRect.bottom;
      if (bottomOverflow > 0) {
        list.scrollTo({
          top: Math.min(list.scrollHeight - list.clientHeight, list.scrollTop + bottomOverflow) + 5,
          behavior: 'smooth'
        });
      }
    });
  }, [activeItemIds]);

  return (
    <section className="workflowAudioStage" aria-label={title}>
      <div className="workflowAudioStageHeader">
        <span className="workflowNodeIcon">
          {activeCount > 0 ? <LoaderCircle className="spin" size={18} /> : <Headphones size={18} />}
        </span>
        <div>
          <strong>{title}</strong>
          <small>{doneCount} of {items.length} audio conversations done</small>
        </div>
        {action ? (
          <button className="workflowAudioRefreshButton" disabled={action.loading} onClick={action.onClick} type="button">
            {action.loading ? <RefreshCw className="spin" size={14} /> : <RefreshCw size={14} />}
            {action.label}
          </button>
        ) : null}
      </div>
      {items.length > 0 ? (
        <div className="workflowAudioList" ref={audioListRef}>
          {items.map((item, index) => {
            const content = (
              <>
                <span className="workflowAudioItemNumber">{index + 1}</span>
                <span className="workflowAudioItemText">
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                <span className="workflowAudioItemIcon" aria-hidden="true">
                  <AudioProgressIcon status={item.status} />
                </span>
              </>
            );
            const className = `workflowAudioItem ${item.status} ${selectedItemId === item.id ? 'selected' : ''}`;
            return onSelectItem ? (
              <button
                className={className}
                data-audio-item-id={item.id}
                key={item.id}
                onClick={() => onSelectItem(item.id)}
                type="button"
              >
                {content}
              </button>
            ) : (
              <div className={className} data-audio-item-id={item.id} key={item.id}>
                {content}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="workflowAudioListEmpty">Audio skipped</div>
      )}
    </section>
  );
}
