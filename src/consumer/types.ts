import type { ConversationLine, EnglishLine } from '../../shared/types.ts';

export type PracticeArea = 'vocab' | 'conversations';
export type ReviewResult = 'gotIt' | 'missed';
export type StrengthBucket = 'new' | 'weak' | 'improving' | 'strong';
export type CardKind = 'vocab' | 'question';
export type ThemeId =
  | 'matcha-light'
  | 'matcha-dark'
  | 'ink-light'
  | 'ink-dark'
  | 'sakura-light'
  | 'sakura-dark'
  | 'mikan-light'
  | 'mikan-dark'
  | 'minato-light'
  | 'minato-dark'
  | 'sumire-light'
  | 'sumire-dark';

export interface VocabCard {
  id: string;
  level: number;
  setTheme: string;
  withinSetNumber: number;
  japanese: string;
  reading: string;
  romaji: string;
  meaning: string;
  partOfSpeech: string;
  category: string;
  frequencyRank?: number;
}

export interface PracticeCard {
  id: string;
  kind: CardKind;
  frequency?: number;
}

export interface DirectionStats {
  streak: number;
  reviews: number;
  recentResults: Array<0 | 1>;
  ease: number;
  intervalDays: number;
  lastReviewedAt: number | null;
  dueAt: number;
}

export type StatsMap = Record<string, DirectionStats>;

export interface ConversationProgress {
  completionOrderVersion: 0 | 1;
  completedConversationIds: string[];
  starredConversationIds: string[];
}

export interface StaticLibraryConversation {
  id: string;
  level: number;
  title: string;
  scene: string;
  sampleContext?: string;
  audioUrl?: string;
  text: ConversationLine[];
  englishTranslation: EnglishLine[];
  listeningQuestions: string[];
  answerKey: string[];
  vocabularyUsed: string[];
  createdAt?: string;
}

export interface StaticLibraryManifest {
  version: number;
  generatedAt: string;
  conversations: StaticLibraryConversation[];
}
