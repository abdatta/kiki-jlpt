import type { LearnerSettings, StatsMap } from './types.ts';

const SETTINGS_KEY = 'jlpt-listener.practice.settings';
const VOCAB_STATS_KEY = 'jlpt-listener.practice.vocabStats';
const QUESTION_STATS_KEY = 'jlpt-listener.practice.questionStats';

function readJson<TValue>(key: string, fallback: TValue): TValue {
  if (typeof window === 'undefined') return fallback;

  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as TValue : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function loadSettings(fallbackLevel: number): LearnerSettings {
  const stored = readJson<Partial<LearnerSettings>>(SETTINGS_KEY, {});
  return {
    level: typeof stored.level === 'number' && Number.isFinite(stored.level) ? stored.level : fallbackLevel,
    showKana: typeof stored.showKana === 'boolean' ? stored.showKana : true
  };
}

export function saveSettings(settings: LearnerSettings): void {
  writeJson(SETTINGS_KEY, settings);
}

export function loadVocabStats(): StatsMap {
  return readJson<StatsMap>(VOCAB_STATS_KEY, {});
}

export function saveVocabStats(stats: StatsMap): void {
  writeJson(VOCAB_STATS_KEY, stats);
}

export function loadQuestionStats(): StatsMap {
  return readJson<StatsMap>(QUESTION_STATS_KEY, {});
}

export function saveQuestionStats(stats: StatsMap): void {
  writeJson(QUESTION_STATS_KEY, stats);
}
