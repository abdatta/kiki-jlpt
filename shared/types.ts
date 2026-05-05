export type ConversationStatus = 'draft' | 'audio_generating' | 'audio_ready' | 'audio_failed';

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

export type TextModelProvider = 'gemini' | 'codex';

export interface TextModelInfo {
  id: string;
  provider: TextModelProvider;
  model: string;
  label: string;
  reasoningEffort?: string;
  source?: 'configured' | 'codex-api' | 'fallback' | 'legacy';
}

export interface LlmExchange {
  id: string;
  provider: TextModelProvider;
  model: string;
  label: string;
  instructions?: string;
  prompt: string;
  output?: string;
  stats?: unknown;
  requestedAt: string;
  receivedAt?: string;
  status: 'pending' | 'complete' | 'failed';
  error?: string;
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
  curatedId?: string;
  curatedAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CuratedConversation extends Omit<PracticeConversation, 'id' | 'audioFileName' | 'audioUrl'> {
  id: string;
  sourceRunId: string;
  sourceConversationId: string;
  setNumber: number;
  audioFileName: string;
  audioUrl: string;
  curatedAudioPath: string;
}

export interface CuratedSet {
  setNumber: number;
  analytics: RunAnalytics;
  conversations: CuratedConversation[];
  createdAt: string;
  updatedAt: string;
}

export interface LibraryRecommendationWord {
  japanese: string;
  reading: string;
  meaning: string;
  partOfSpeech: string;
  category: string;
  libraryCount: number;
}

export interface LibraryRecommendationCandidate {
  sourceRunId: string;
  sourceRunCreatedAt: string;
  score: number;
  targetWordCount: number;
  uncoveredWordCount: number;
  leastCoveredWords: LibraryRecommendationWord[];
  conversation: PracticeConversation;
}

export interface LibraryRecommendations {
  setNumber: number;
  targetWordCount: number;
  libraryConversationCount: number;
  candidateCount: number;
  leastCoveredWords: LibraryRecommendationWord[];
  recommendations: LibraryRecommendationCandidate[];
}

export interface LibraryBalanceWord {
  japanese: string;
  reading: string;
  meaning: string;
  partOfSpeech: string;
  category: string;
  libraryCount: number;
  targetCount: number;
  neededCount: number;
}

export interface LibraryBalancePlan {
  setNumber: number;
  targetWordCount: number;
  libraryConversationCount: number;
  zeroCount: number;
  lowCoverageCount: number;
  meanCount: number;
  standardDeviation: number;
  targetCount: number;
  preferredMaxConversationCount: number;
  suggestedConversationCount: number;
  requiredZeroWords: LibraryBalanceWord[];
  priorityWords: LibraryBalanceWord[];
  overrepresentedWords: LibraryBalanceWord[];
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
  textModel: TextModelInfo;
  analytics: RunAnalytics;
  status: 'generated' | 'partial_audio' | 'complete';
  llmExchanges?: LlmExchange[];
  createdAt: string;
  updatedAt: string;
  conversations: PracticeConversation[];
}

export interface GenerateRequest {
  setNumber: number;
  conversationCount: number;
  textModelId?: string;
}

export interface LibraryComplementGenerateRequest {
  textModelId?: string;
}

export interface GenerateResponse {
  run: PracticeRun;
}

export interface ApiError {
  error: string;
  detail?: string;
}
