import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { CSV_PATH } from './paths.ts';
import type { SetSummary, VocabItem } from '../shared/types.ts';

type CsvRow = Record<string, string>;

let cache: VocabItem[] | null = null;

function toNumber(value: string | undefined, fallback = 0): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rowToVocab(row: CsvRow): VocabItem {
  return {
    set: toNumber(row.Set),
    setTheme: row['Set Theme'] ?? '',
    withinSetNumber: toNumber(row['Within Set #']),
    japanese: row.Japanese ?? '',
    reading: row.Reading ?? '',
    meaning: row.Meaning ?? '',
    partOfSpeech: row['Part of Speech'] ?? '',
    category: row.Category ?? ''
  };
}

export async function readVocabulary(): Promise<VocabItem[]> {
  if (cache) return cache;
  const csv = await readFile(CSV_PATH, 'utf8');
  const records = parse(csv, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: false
  }) as CsvRow[];

  cache = records.map(rowToVocab).filter((item) => item.set > 0 && item.japanese);
  return cache;
}

export async function getSetSummaries(): Promise<SetSummary[]> {
  const vocab = await readVocabulary();
  const grouped = new Map<number, VocabItem[]>();

  for (const item of vocab) {
    grouped.set(item.set, [...(grouped.get(item.set) ?? []), item]);
  }

  let cumulativeCount = 0;
  return [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .map(([set, items]) => {
      cumulativeCount += items.length;
      return {
        set,
        theme: items[0]?.setTheme ?? '',
        count: items.length,
        cumulativeCount
      };
    });
}

export async function getAllowedVocabulary(setNumber: number): Promise<VocabItem[]> {
  const vocab = await readVocabulary();
  return vocab.filter((item) => item.set <= setNumber).sort((a, b) => a.set - b.set || a.withinSetNumber - b.withinSetNumber);
}

export function formatVocabForPrompt(vocab: VocabItem[]): string {
  return vocab
    .map((item) => `Set ${item.set} | ${item.japanese} | ${item.meaning}`)
    .join('\n');
}
