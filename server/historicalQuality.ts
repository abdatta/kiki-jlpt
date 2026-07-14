import type { CuratedConversation, TextModelInfo } from '../shared/types.ts';
import { labelHistoricalConversations } from './qualityControl.ts';
import { FINAL_DIALOGUE_QUALITY_RUBRIC_VERSION } from './prompt.ts';
import { listCuratedSets, updateCuratedSet } from './library.ts';
import { listRuns, mutateRun } from './storage.ts';
import { getAllowedVocabulary, readVocabulary } from './vocab.ts';

export type HistoricalQualityScope = 'curated-library' | 'saved-runs';
export const HISTORICAL_QUALITY_RUBRIC_VERSION = FINAL_DIALOGUE_QUALITY_RUBRIC_VERSION;

export async function labelHistoricalScope(options: {
  scope: HistoricalQualityScope;
  judgeModel: TextModelInfo;
  rejudge?: boolean;
  onProgress?: (counts: { processed: number; skipped: number; total: number }) => Promise<void> | void;
}) {
  const knownVocabulary = await readVocabulary();
  let processed = 0;
  let skipped = 0;
  const targets = options.scope === 'curated-library'
    ? (await listCuratedSets()).map((set) => ({ kind: 'curated' as const, setNumber: set.setNumber, id: String(set.setNumber), conversations: set.conversations }))
    : (await listRuns()).map((run) => ({ kind: 'run' as const, setNumber: run.setNumber, id: run.id, conversations: run.conversations }));
  const total = targets.reduce((count, target) => count + target.conversations.length, 0);
  for (const target of targets) {
    const eligible = target.conversations.filter((conversation) => options.rejudge || !conversation.qualityReview);
    skipped += target.conversations.length - eligible.length;
    if (!eligible.length) continue;
    const allowedVocabulary = await getAllowedVocabulary(target.setNumber);
    const labeled = await labelHistoricalConversations({
      setNumber: target.setNumber,
      conversations: eligible,
      allowedVocabulary,
      knownVocabulary,
      judgeModel: options.judgeModel,
      rubricVersion: HISTORICAL_QUALITY_RUBRIC_VERSION
    });
    const replacement = new Map(labeled.conversations.map((conversation) => [conversation.id, conversation]));
    if (target.kind === 'curated') {
      await updateCuratedSet(target.setNumber, (set) => ({ ...set, conversations: set.conversations.map((conversation) => (replacement.get(conversation.id) ?? conversation) as CuratedConversation) }));
    } else {
      await mutateRun(target.id, (run) => ({ ...run, conversations: run.conversations.map((conversation) => replacement.get(conversation.id) ?? conversation) }));
    }
    processed += eligible.length;
    await options.onProgress?.({ processed, skipped, total });
  }
  return { processed, skipped, total };
}
