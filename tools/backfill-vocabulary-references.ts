import { backfillConversationVocabularyReferences } from '../server/vocabularyBackfill.ts';

const report = await backfillConversationVocabularyReferences();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.records.some((record) => record.error)) process.exitCode = 1;
