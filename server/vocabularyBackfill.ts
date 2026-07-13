import type { ConversationVocabularyValidationFailure } from '../shared/types.ts';
import { listCuratedSets, reanalyzeCuratedSet } from './library.ts';
import { listRuns, reanalyzeRun } from './storage.ts';
import { isLearnerVisibleVocabularyCandidate, validateConversationVocabularyReferences } from './vocabularyReferences.ts';

export interface VocabularyBackfillRecord {
  kind: 'run' | 'curated_set';
  id: string;
  beforeOov: number;
  afterOov: number;
  resolved: string[];
  unresolved: string[];
  discarded: string[];
  changed: boolean;
  error?: string;
}

export interface VocabularyBackfillReport {
  startedAt: string;
  completedAt: string;
  records: VocabularyBackfillRecord[];
  failures: ConversationVocabularyValidationFailure[];
}

function totalOov(conversations: Array<{ outOfVocabularyAudit: string[] }>): number {
  return conversations.reduce((sum, conversation) => sum + conversation.outOfVocabularyAudit.length, 0);
}

function summarize(kind: VocabularyBackfillRecord['kind'], id: string, before: Array<{ outOfVocabularyAudit: string[] }>, after: Array<{ outOfVocabularyAudit: string[]; vocabularyReferences?: Array<{ surface: string }> }>): VocabularyBackfillRecord {
  const audited = new Set(after.flatMap((conversation) => conversation.outOfVocabularyAudit));
  const previouslyAudited = new Set(before.flatMap((conversation) => conversation.outOfVocabularyAudit));
  const resolved = new Set(after.flatMap((conversation) => (conversation.vocabularyReferences ?? []).map((item) => item.surface)));
  const unresolved = [...audited].filter((surface) => isLearnerVisibleVocabularyCandidate(surface) && !resolved.has(surface));
  const discarded = [...new Set([...previouslyAudited, ...audited])].filter((surface) => !isLearnerVisibleVocabularyCandidate(surface));
  return {
    kind,
    id,
    beforeOov: totalOov(before),
    afterOov: totalOov(after),
    resolved: [...resolved].sort((a, b) => a.localeCompare(b, 'ja')),
    unresolved: unresolved.sort((a, b) => a.localeCompare(b, 'ja')),
    discarded: discarded.sort((a, b) => a.localeCompare(b, 'ja')),
    changed: totalOov(before) !== totalOov(after)
  };
}

export async function backfillConversationVocabularyReferences(): Promise<VocabularyBackfillReport> {
  const startedAt = new Date().toISOString();
  const records: VocabularyBackfillRecord[] = [];
  const failures: ConversationVocabularyValidationFailure[] = [];
  const runs = await listRuns();
  for (const run of runs) {
    try {
      const updated = await reanalyzeRun(run.id);
      records.push(summarize('run', run.id, run.conversations, updated.conversations));
      failures.push(...updated.conversations.flatMap(validateConversationVocabularyReferences));
    } catch (error) {
      records.push({ kind: 'run', id: run.id, beforeOov: totalOov(run.conversations), afterOov: totalOov(run.conversations), resolved: [], unresolved: [], discarded: [], changed: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const set of await listCuratedSets()) {
    try {
      const updated = await reanalyzeCuratedSet(set.setNumber);
      records.push(summarize('curated_set', String(set.setNumber), set.conversations, updated.conversations));
      failures.push(...updated.conversations.flatMap(validateConversationVocabularyReferences));
    } catch (error) {
      records.push({ kind: 'curated_set', id: String(set.setNumber), beforeOov: totalOov(set.conversations), afterOov: totalOov(set.conversations), resolved: [], unresolved: [], discarded: [], changed: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { startedAt, completedAt: new Date().toISOString(), records, failures };
}
