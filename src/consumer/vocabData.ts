import csvText from '../../jlpt_n5_master_vocab_by_set_clean.csv?raw';
import type { SetSummary } from '../../shared/types.ts';
import type { VocabCard } from './types.ts';

type CsvRow = Record<string, string>;

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value.length > 0)) rows.push(row);

  const [headers = [], ...records] = rows;
  const normalizedHeaders = headers.map((header) => header.replace(/^\uFEFF/, ''));
  return records.map((record) => (
    normalizedHeaders.reduce<CsvRow>((acc, header, index) => {
      acc[header] = record[index] ?? '';
      return acc;
    }, {})
  ));
}

function toNumber(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function requireNumber(value: string | undefined): number {
  return toNumber(value) ?? 0;
}

export const vocabCards: VocabCard[] = parseCsv(csvText)
  .map((row) => ({
    id: `vocab:${row.Set}:${row.Japanese}:${row.Reading}`,
    level: requireNumber(row.Set),
    setTheme: row['Set Theme'] ?? '',
    withinSetNumber: requireNumber(row['Within Set #']),
    japanese: row.Japanese ?? '',
    reading: row.Reading ?? '',
    romaji: row['Romaji Pronunciation'] ?? '',
    meaning: row.Meaning ?? '',
    partOfSpeech: row['Part of Speech'] ?? '',
    category: row.Category ?? '',
    frequencyRank: toNumber(row['Frequency Rank'])
  }))
  .filter((card) => card.level > 0 && card.japanese)
  .sort((a, b) => a.level - b.level || a.withinSetNumber - b.withinSetNumber);

export const levelSummaries: SetSummary[] = (() => {
  const grouped = new Map<number, VocabCard[]>();

  for (const card of vocabCards) {
    grouped.set(card.level, [...(grouped.get(card.level) ?? []), card]);
  }

  let cumulativeCount = 0;
  return [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .map(([set, cards]) => {
      cumulativeCount += cards.length;
      return {
        set,
        theme: cards[0]?.setTheme ?? '',
        count: cards.length,
        cumulativeCount
      };
    });
})();
