import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ConversationQualityVerdictValue, TextModelInfo } from '../shared/types.ts';
import { OUTPUTS_DIR } from './paths.ts';

export interface QualityReviewSummary {
  verdict: ConversationQualityVerdictValue;
  rationale: string;
  flags: string[];
  judgeModel: TextModelInfo;
  rubricVersion: string;
  reviewedAt: string;
}

interface HistoricalQualityReportResult {
  verdict: ConversationQualityVerdictValue;
  rationale: string;
  flags: string[];
  judgedAt: string;
}

interface HistoricalQualityReport {
  model: TextModelInfo;
  rubricVersion: string;
  results: Record<string, HistoricalQualityReportResult>;
}

const HISTORICAL_QUALITY_REPORT_PATH = path.join(
  OUTPUTS_DIR,
  'quality-backfills',
  'set-2-plus-gpt-5.6-sol-dialogue-quality-v6.json'
);

/**
 * Historical review rationale deliberately remains in the batch report rather
 * than being copied into every run or curated-set JSON record. The Studio can
 * surface it on demand without expanding those content records.
 */
export async function readHistoricalQualityReviewIndex(): Promise<Record<string, QualityReviewSummary>> {
  const source = await readFile(HISTORICAL_QUALITY_REPORT_PATH, 'utf8').catch(() => undefined);
  if (!source) return {};

  let report: HistoricalQualityReport;
  try {
    report = JSON.parse(source) as HistoricalQualityReport;
  } catch {
    return {};
  }

  if (!report.model || !report.rubricVersion || !report.results) return {};

  return Object.fromEntries(Object.entries(report.results).flatMap(([key, result]) => {
    if (!result?.verdict || !result.rationale || !result.judgedAt) return [];
    return [[key, {
      verdict: result.verdict,
      rationale: result.rationale,
      flags: result.flags ?? [],
      judgeModel: report.model,
      rubricVersion: report.rubricVersion,
      reviewedAt: result.judgedAt
    }]];
  }));
}
