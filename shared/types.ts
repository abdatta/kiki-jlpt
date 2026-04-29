export type ConversationStatus = 'draft' | 'approved' | 'rejected' | 'audio_generating' | 'audio_ready' | 'audio_failed';

export interface VocabItem {
  set: number;
  setTheme: string;
  withinSetNumber: number;
  japanese: string;
  reading: string;
  meaning: string;
  partOfSpeech: string;
  category: string;
}

export interface SetSummary {
  set: number;
  theme: string;
  count: number;
  cumulativeCount: number;
}

export interface ConversationLine {
  speaker: 'Speaker 1' | 'Speaker 2';
  tags: string[];
  japanese: string;
}

export interface EnglishLine {
  speaker: 'Speaker 1' | 'Speaker 2';
  english: string;
}

export interface PracticeConversation {
  id: string;
  number: number;
  title: string;
  scene: string;
  sampleContext: string;
  text: ConversationLine[];
  listeningQuestions: string[];
  answerKey: string[];
  englishTranslation: EnglishLine[];
  vocabularyUsed: string[];
  outOfVocabularyAudit: string[];
  simplerReplacementSuggestions: string[];
  status: ConversationStatus;
  audioFileName?: string;
  audioUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunAnalytics {
  currentSetTotal: number;
  currentSetUsedCount: number;
  currentSetMissingCount: number;
  currentSetMissingWords: string[];
  allowedVocabTotal: number;
  allowedVocabUsedCount: number;
  allowedVocabUsedPercentage: number;
  outOfAllowedCount: number;
  outOfAllowedWords: string[];
}

export interface PracticeRun {
  id: string;
  setNumber: number;
  conversationCount: number;
  allowedVocabCount: number;
  analytics: RunAnalytics;
  status: 'generated' | 'partial_audio' | 'complete';
  createdAt: string;
  updatedAt: string;
  conversations: PracticeConversation[];
}

export interface GenerateRequest {
  setNumber: number;
  conversationCount: number;
}

export interface GenerateResponse {
  run: PracticeRun;
}

export interface ApiError {
  error: string;
  detail?: string;
}
