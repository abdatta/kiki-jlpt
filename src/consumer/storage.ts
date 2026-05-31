import type { ConversationProgress, LearnerSettings, StatsMap } from './types.ts';

const SETTINGS_KEY = 'kiki-jlpt.practice.settings';
const VOCAB_STATS_KEY = 'kiki-jlpt.practice.vocabStats';
const CONVERSATION_PROGRESS_KEY = 'kiki-jlpt.practice.conversationProgress';
const CONVERSATION_PLAYBACK_SPEED_KEY = 'kiki-jlpt.practice.conversationPlaybackSpeed';

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

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
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

export function loadConversationProgress(): ConversationProgress {
  const stored = readJson<Partial<ConversationProgress>>(CONVERSATION_PROGRESS_KEY, {});
  return {
    completedConversationIds: Array.isArray(stored.completedConversationIds)
      ? uniqueStrings(stored.completedConversationIds.filter((id): id is string => typeof id === 'string'))
      : [],
    starredConversationIds: Array.isArray(stored.starredConversationIds)
      ? uniqueStrings(stored.starredConversationIds.filter((id): id is string => typeof id === 'string'))
      : []
  };
}

export function saveConversationProgress(progress: ConversationProgress): void {
  writeJson(CONVERSATION_PROGRESS_KEY, {
    completedConversationIds: uniqueStrings(progress.completedConversationIds),
    starredConversationIds: uniqueStrings(progress.starredConversationIds)
  });
}

export function loadConversationPlaybackSpeed(fallback = 1): number {
  const stored = readJson<number>(CONVERSATION_PLAYBACK_SPEED_KEY, fallback);
  return typeof stored === 'number' && Number.isFinite(stored) ? stored : fallback;
}

export function saveConversationPlaybackSpeed(speed: number): void {
  writeJson(CONVERSATION_PLAYBACK_SPEED_KEY, speed);
}
