import { ListMusic } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { PracticeRun } from '../../shared/types.ts';

export interface SourceRunReference {
  sourceRunId?: string;
  sourceRunCreatedAt?: string;
  sourceRunColorIndex?: number;
}

export interface SourceRunMetadata {
  sourceRunId: string;
  label: string;
  targetRoute?: string;
  colorIndex: number;
  title: string;
  resolved: boolean;
}

export interface SourceRunDistributionRow extends SourceRunMetadata {
  count: number;
  percentage: number;
}

export function shortSourceRunId(sourceRunId: string): string {
  return `Run ${sourceRunId.slice(0, 8)}`;
}

export const sourceRunPaletteHues = [
  205, 22, 145, 270, 48, 180, 332, 232,
  82, 196, 8, 305, 118, 218, 38, 318
];

export function sourceRunPaletteIndex(sourceRunId: string): number {
  let hash = 0;
  for (const char of sourceRunId) {
    hash = Math.imul(31, hash) + char.charCodeAt(0);
  }
  return Math.abs(hash) % sourceRunPaletteHues.length;
}

function runHoverTitle(
  sourceRunId: string,
  label: string,
  run: Pick<PracticeRun, 'id' | 'createdAt'> & Partial<PracticeRun> | undefined
): string {
  if (!run) {
    return [
      `Source run: ${label}`,
      `Run ID: ${sourceRunId}`,
      'Run metadata unavailable.'
    ].join('\n');
  }

  const analytics = run.analytics;
  return [
    `Source run: ${label}`,
    `Run ID: ${run.id}`,
    run.textModel ? `Model: ${run.textModel.label}` : undefined,
    typeof run.setNumber === 'number' ? `Set: ${run.setNumber}` : undefined,
    run.status ? `Status: ${run.status}` : undefined,
    Array.isArray(run.conversations) ? `Conversations: ${run.conversations.length}` : undefined,
    typeof run.allowedVocabCount === 'number' ? `Allowed words: ${run.allowedVocabCount}` : undefined,
    analytics ? `Current set: ${analytics.currentSetUsedCount}/${analytics.currentSetTotal} used, ${analytics.currentSetMissingCount} missing` : undefined,
    analytics ? `Cumulative: ${analytics.allowedVocabUsedPercentage}% (${analytics.allowedVocabUsedCount}/${analytics.allowedVocabTotal})` : undefined,
    analytics ? `OOV: ${analytics.outOfAllowedCount}${analytics.outOfAllowedWords.length ? ` (${analytics.outOfAllowedWords.slice(0, 12).join(', ')}${analytics.outOfAllowedWords.length > 12 ? ', ...' : ''})` : ''}` : undefined,
    `Created: ${run.createdAt}`
  ].filter((line): line is string => Boolean(line)).join('\n');
}

export function resolveSourceRunMetadata(
  source: SourceRunReference,
  runs: readonly (Pick<PracticeRun, 'id' | 'createdAt'> & Partial<PracticeRun>)[],
  formatRunTitle: (value: string) => string,
  routeForRun: (runId: string) => string
): SourceRunMetadata | null {
  if (!source.sourceRunId) return null;

  const run = runs.find((item) => item.id === source.sourceRunId);
  const createdAt = run?.createdAt ?? source.sourceRunCreatedAt;
  const label = createdAt ? formatRunTitle(createdAt) || shortSourceRunId(source.sourceRunId) : shortSourceRunId(source.sourceRunId);

  return {
    sourceRunId: source.sourceRunId,
    label,
    colorIndex: source.sourceRunColorIndex ?? sourceRunPaletteIndex(source.sourceRunId),
    title: runHoverTitle(source.sourceRunId, label, run),
    targetRoute: run ? routeForRun(run.id) : undefined,
    resolved: Boolean(run)
  };
}

export function sourceRunDistribution(
  sources: readonly SourceRunReference[],
  runs: readonly (Pick<PracticeRun, 'id' | 'createdAt'> & Partial<PracticeRun>)[],
  formatRunTitle: (value: string) => string,
  routeForRun: (runId: string) => string
): SourceRunDistributionRow[] {
  const groups = new Map<string, { metadata: SourceRunMetadata; count: number; firstIndex: number }>();

  sources.forEach((source, index) => {
    const metadata = resolveSourceRunMetadata(source, runs, formatRunTitle, routeForRun);
    if (!metadata) return;
    const existing = groups.get(metadata.sourceRunId);
    if (existing) {
      existing.count += 1;
      if (existing.metadata.resolved || !metadata.resolved) return;
      existing.metadata = metadata;
      return;
    }
    groups.set(metadata.sourceRunId, { metadata, count: 1, firstIndex: index });
  });

  const total = Array.from(groups.values()).reduce((sum, group) => sum + group.count, 0);
  if (total === 0) return [];

  return Array.from(groups.values())
    .sort((a, b) => b.count - a.count || a.firstIndex - b.firstIndex)
    .map((group, index) => ({
      ...group.metadata,
      colorIndex: index % sourceRunPaletteHues.length,
      count: group.count,
      percentage: Math.round((group.count / total) * 100)
    }));
}

export function SourceRunLabel({ metadata }: { metadata: SourceRunMetadata | null }) {
  if (!metadata) return null;
  const style = { '--source-run-hue': sourceRunPaletteHues[metadata.colorIndex % sourceRunPaletteHues.length] } as CSSProperties;

  const content = (
    <>
      <ListMusic size={14} />
      <span>{metadata.label}</span>
    </>
  );

  return metadata.targetRoute ? (
    <a className="sourceRunLink" href={metadata.targetRoute} style={style} title={metadata.title}>
      {content}
    </a>
  ) : (
    <span className="sourceRunLabel unresolved" style={style} title={metadata.title}>
      {content}
    </span>
  );
}

export function SourceRunDistribution({ rows }: { rows: readonly SourceRunDistributionRow[] }) {
  if (rows.length <= 1) return null;

  return (
    <details className="sourceRunDistribution">
      <summary>
        <span>Source runs</span>
        <b>{rows.length} sources</b>
      </summary>
      <div className="sourceRunDistributionRows">
        {rows.map((row) => (
          <div
            className="sourceRunDistributionRow"
            key={row.sourceRunId}
            style={{
              '--source-run-hue': sourceRunPaletteHues[row.colorIndex % sourceRunPaletteHues.length],
              '--source-run-share': `${row.percentage}%`
            } as CSSProperties}
          >
            <SourceRunLabel metadata={row} />
            <span>{row.count} conversation{row.count === 1 ? '' : 's'}</span>
            <strong>{row.percentage}%</strong>
          </div>
        ))}
      </div>
    </details>
  );
}
