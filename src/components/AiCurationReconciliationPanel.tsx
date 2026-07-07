import { Eye } from 'lucide-react';
import type { AiCurationReviewReconciliation } from '../../shared/types.ts';

export function AiCurationReconciliationPanel({ reconciliation, stale }: {
  reconciliation: AiCurationReviewReconciliation;
  stale?: boolean;
}) {
  const { counts } = reconciliation;
  const chips = [
    { count: counts.remainingToAdd, label: 'remaining' },
    { count: counts.alreadyInLibrary, label: 'in Library' },
    { count: counts.missingAudio, label: 'need audio' },
    { count: counts.blocked, label: 'blocked' }
  ].filter((chip) => chip.label === 'remaining' || chip.count > 0);
  const notes = [
    `This is a historical snapshot${stale ? ' with stale context' : ''}. Use Settings to prepare a new review with the same model and size, or continue with the reconciled remaining recommendations below.`,
    ...reconciliation.blockingReasons,
    ...reconciliation.warnings
  ];

  return (
    <section className="historicalReviewPanel" aria-label="Historical curation reconciliation">
      <div className="historicalReviewPanelHeader">
        <Eye size={16} />
        <span className="historicalReviewPanelTitle">Historical review</span>
        <div className="miniChips coverage">
          {chips.map((chip) => <span key={chip.label}>{chip.count}<b>{chip.label}</b></span>)}
        </div>
        <span className={`historicalReviewStatus ${reconciliation.actionable ? 'ready' : 'blocked'}`}>
          {reconciliation.actionable ? `${reconciliation.actionLabel} ready` : 'Review only'}
        </span>
      </div>
      <p>{notes.join(' ')}</p>
    </section>
  );
}
