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

export type TextModelProvider = 'gemini' | 'codex' | 'claude';

export interface TextModelInfo {
  id: string;
  provider: TextModelProvider;
  model: string;
  label: string;
  reasoningEffort?: string;
  source?: 'configured' | 'codex-api' | 'fallback' | 'legacy';
  /** Exact model version reported by the provider once a generation ran (aliases like `sonnet` resolve at call time). */
  resolvedModel?: string;
}

export interface LlmExchange {
  id: string;
  provider: TextModelProvider;
  model: string;
  label: string;
  resolvedModel?: string;
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

export type DeclaredNonVocabularyKind = 'proper_noun' | 'cultural_reference';

export type DeclaredNonVocabularyCategory =
  | 'person'
  | 'place'
  | 'city'
  | 'region'
  | 'landmark'
  | 'institution'
  | 'event'
  | 'work_title'
  | 'brand'
  | 'food'
  | 'cultural_item';

export interface DeclaredNonVocabularyTerm {
  surface: string;
  reading?: string;
  kind: DeclaredNonVocabularyKind;
  category: DeclaredNonVocabularyCategory;
  rationale?: string;
}

export type VocabularyExemptionKind =
  | 'proper_noun'
  | 'cultural_reference'
  | 'approved_name'
  | 'language_policy';

export interface VocabularyAuditExemption {
  surface: string;
  kind: VocabularyExemptionKind;
  category?: DeclaredNonVocabularyCategory;
  rationale?: string;
}

export interface VocabularyAuditRejectedDeclaration {
  surface: string;
  kind: DeclaredNonVocabularyKind;
  category: DeclaredNonVocabularyCategory;
  reason: string;
}

export const CONVERSATION_VOCABULARY_REFERENCE_VERSION = 1 as const;
export type ConversationVocabularyReferenceKind = 'future_set' | 'external';
export type ConversationVocabularyReferenceSource = 'master_vocabulary' | 'supplemental_catalog';

export interface ConversationVocabularyReference {
  version: typeof CONVERSATION_VOCABULARY_REFERENCE_VERSION;
  surface: string;
  japanese: string;
  reading: string;
  meaning: string;
  kind: ConversationVocabularyReferenceKind;
  source: ConversationVocabularyReferenceSource;
  setNumber?: number;
  partOfSpeech?: string;
  category?: string;
}

export interface ConversationVocabularyValidationFailure {
  conversationId: string;
  surface: string;
  reason: 'unresolved' | 'incomplete_metadata' | 'invalid_candidate';
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
  declaredNonVocabularyTerms?: DeclaredNonVocabularyTerm[];
  vocabularyUsed: string[];
  outOfVocabularyAudit: string[];
  vocabularyReferences?: ConversationVocabularyReference[];
  simplerReplacementSuggestions: string[];
  quality?: 'good' | 'okay';
  qualityDecision?: 'pass' | 'repair';
  pickerSelected?: QualityVersionSource;
  pickerConfidence?: PickerConfidence;
  qualityFlags?: string[];
  status: ConversationStatus;
  audioFileName?: string;
  audioUrl?: string;
  curatedId?: string;
  curatedAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationCurationEvidence {
  evidenceVersion: string;
  setNumber: number;
  currentSetTotal: number;
  currentSetUniqueCount: number;
  currentSetUniqueWords: string[];
  allowedVocabTotal: number;
  allowedVocabUniqueCount: number;
  allowedVocabUniqueWords: string[];
  vocabularyOccurrences: Record<string, number>;
  outOfVocabularyUniqueCount: number;
  outOfVocabularyUniqueWords: string[];
  outOfVocabularyOccurrenceCount: number;
  vocabularyExemptions?: VocabularyAuditExemption[];
  rejectedVocabularyDeclarations?: VocabularyAuditRejectedDeclaration[];
}

export type ConversationQualityVerdictValue = 'pass' | 'repair' | 'regenerate';
export type QualityVersionSource = 'original' | 'candidate1' | 'candidate2';
export type PickerConfidence = 'high' | 'medium' | 'low';

export interface ConversationQualityVerdict {
  conversationId: string;
  verdict: ConversationQualityVerdictValue;
  rationale: string;
  flags: string[];
}

export interface ConversationPickOutcome {
  conversationId: string;
  selected: QualityVersionSource;
  selectedQuality: 'good' | 'okay';
  decidedBy: 'gate' | 'tie-break' | 'fallback';
  confidence?: PickerConfidence;
  rationale: string;
  flags: string[];
  eliminated: Array<{
    source: QualityVersionSource;
    reason: string;
  }>;
}

export interface QualityControlFailure {
  stage: 'initial' | 'balance';
  pass: 1 | 2;
  callKind: 'triage' | 'repair-candidate' | 'pick' | 'reroll';
  candidateIndex?: 1 | 2;
  error: string;
  fallback: string;
}

export interface DroppedConversationAudit {
  conversationId: string;
  number: number;
  title: string;
  stage: 'initial' | 'balance';
  pass: 1 | 2;
  rationale: string;
  flags: string[];
}

export interface QualityStageAudit {
  stage: 'initial' | 'balance';
  requestedCount: number;
  generatedCount: number;
  acceptedCount: number;
  regenerateCount: number;
  rerollRequestedCount: number;
  rerollGeneratedCount: number;
  dropped: DroppedConversationAudit[];
  verdicts: ConversationQualityVerdict[];
  picks: ConversationPickOutcome[];
  failures: QualityControlFailure[];
}

export interface FinalTextAuditThreshold {
  id: 'initial-regenerate-rate' | 'total-shortfall' | 'balance-post-reroll-drop';
  outcome: 'met' | 'tripped';
  measured: number;
  limit: number;
  unit: 'count' | 'rate';
  action: 'fail' | 'pause';
  detail: string;
}

export interface FinalTextAuditReport {
  requestedCount: number;
  acceptedCount: number;
  shortfallCount: number;
  stages: {
    initial: QualityStageAudit;
    balance?: QualityStageAudit;
  };
  qualityLabels: { good: number; okay: number };
  remainingOutOfVocabulary: Array<{ conversationId: string; words: string[] }>;
  uncoveredCurrentSetWords: string[];
  coverageLosses: Array<{ conversationId: string; words: string[] }>;
  modelCallFailures: QualityControlFailure[];
  pickStatistics: {
    original: number;
    candidate1: number;
    candidate2: number;
    gateDecided: number;
    tieBreakDecided: number;
    fallbackDecided: number;
  };
  distributionStats?: Record<string, number>;
  thresholds: FinalTextAuditThreshold[];
  outcome: 'pass' | 'pause' | 'fail';
  guidance?: string;
  createdAt: string;
}

export type ConversationCurationEvidenceMap = Record<string, ConversationCurationEvidence>;

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
  evidence: ConversationCurationEvidence;
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

export interface AiCurationWordContribution {
  uncoveredWords: string[];
  underexposedWords: string[];
  currentSetWords: string[];
}

export type AiCurationConversation = Omit<
  PracticeConversation,
  'status' | 'audioFileName' | 'audioUrl' | 'error'
>;

export interface AiCurationLibraryConversation extends AiCurationConversation {
  sourceRunId: string;
  sourceConversationId: string;
  setNumber: number;
}

export interface AiCurationCandidateSnapshot {
  candidateKey: string;
  sourceRunId: string;
  sourceConversationId: string;
  sourceRunCreatedAt: string;
  updatedAt: string;
  conversation: AiCurationConversation;
  evidence: ConversationCurationEvidence;
  contribution: AiCurationWordContribution;
}

export interface AiCurationProjectedWord {
  japanese: string;
  currentLibraryCount: number;
  projectedLibraryCount: number;
}

export interface AiCurationLibrarySnapshot {
  setNumber: number;
  updatedAt: string;
  conversationCount: number;
  conversationIds: string[];
  wordExposure: Record<string, number>;
  conversations: AiCurationLibraryConversation[];
}

export interface AiCurationSnapshot {
  fingerprint: string;
  evidenceVersion: string;
  setNumber: number;
  candidateCount: number;
  candidateKeys: string[];
  candidates: AiCurationCandidateSnapshot[];
  library: AiCurationLibrarySnapshot;
}

export interface AiCurationRecommendation {
  rank: number;
  candidateKey: string;
  sourceRunId: string;
  sourceConversationId: string;
  rationale: string;
  strengths: string[];
  concerns: string[];
  contribution: AiCurationWordContribution;
  evidence: ConversationCurationEvidence;
  conversation: AiCurationConversation;
}

export interface AiCurationResult {
  summary: string;
  recommendations: AiCurationRecommendation[];
  projectedLeastCoveredWords: AiCurationProjectedWord[];
}

export type AiCurationRecommendationLiveStatus =
  | 'already_in_library'
  | 'addable_audio_ready'
  | 'addable_missing_audio'
  | 'missing_source'
  | 'changed_source_content'
  | 'not_current_candidate';

export interface AiCurationRecommendationReconciliation {
  candidateKey: string;
  sourceRunId: string;
  sourceConversationId: string;
  status: AiCurationRecommendationLiveStatus;
  audioReady: boolean;
  libraryReady: boolean;
  currentCandidate: boolean;
  blocking: boolean;
  detail?: string;
}

export interface AiCurationReconciliationCounts {
  totalRecommendations: number;
  alreadyInLibrary: number;
  remainingToAdd: number;
  audioReady: number;
  missingAudio: number;
  blocked: number;
  missingSource: number;
  changedSourceContent: number;
  notCurrentCandidate: number;
  newerCandidatesNotEvaluated: number;
  librarySourcesAddedSinceReview: number;
  librarySourcesRemovedSinceReview: number;
}

export interface AiCurationReviewReconciliation {
  reviewId: string;
  setNumber: number;
  actionable: boolean;
  actionLabel?: 'Add All' | 'Add Remaining';
  blockingReasons: string[];
  warnings: string[];
  counts: AiCurationReconciliationCounts;
  recommendations: AiCurationRecommendationReconciliation[];
  recommendationKeysToAdd: string[];
  currentProjectedLeastCoveredWords: AiCurationProjectedWord[];
}

export type AiCurationReviewStatus = 'complete' | 'failed';

export interface AiCurationReview {
  id: string;
  setNumber: number;
  targetConversationCount: number;
  status: AiCurationReviewStatus;
  stale: boolean;
  textModel: TextModelInfo;
  snapshot: AiCurationSnapshot;
  llmExchanges: LlmExchange[];
  result?: AiCurationResult;
  reconciliation?: AiCurationReviewReconciliation;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiCurationReviewSummary {
  id: string;
  setNumber: number;
  targetConversationCount: number;
  status: AiCurationReviewStatus;
  stale: boolean;
  textModel: TextModelInfo;
  candidateCount: number;
  recommendationCount: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiCurationRequest {
  textModelId?: string;
  targetConversationCount?: number;
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
  finalTextAudit?: FinalTextAuditReport;
  workflowAudit?: WorkflowRunAudit;
  createdAt: string;
  updatedAt: string;
  conversations: PracticeConversation[];
}

export interface GenerateRequest {
  setNumber: number;
  conversationCount: number;
  textModelId?: string;
  idempotencyKey?: string;
}

export interface RunAudioGenerateRequest {
  mode?: 'replace' | 'resume';
  idempotencyKey?: string;
}

export interface LibraryComplementGenerateRequest {
  textModelId?: string;
  balanceMode?: 'stats' | 'ai';
  conversationCount?: number;
  idempotencyKey?: string;
}

export type WorkflowAudioMode = 'fixed' | 'max';

export interface WorkflowGenerateRequest extends GenerateRequest {
  audioCount?: number;
  audioMode?: WorkflowAudioMode;
}

export type WorkflowNodeStatus = 'pending' | 'processing' | 'done' | 'repairWarning' | 'error' | 'skipped';
export type WorkflowJobStatus = 'running' | 'paused' | 'complete' | 'failed';
export type WorkflowAuditCallKind =
  | 'generation'
  | 'vocab-audit'
  | 'triage'
  | 'repair-candidate'
  | 'dominance-gates'
  | 'pick'
  | 'reroll'
  | 'final-audit'
  | 'audio';
export type WorkflowNodeKind = 'generator' | 'balancer' | WorkflowAuditCallKind;

export interface WorkflowNodeOutputSummary {
  statLine: string;
  conversationCount?: number;
  passCount?: number;
  repairCount?: number;
  regenerateCount?: number;
  acceptedCount?: number;
  requestedCount?: number;
  oovBefore?: number;
  oovAfter?: number;
  eliminatedCount?: number;
  coverageLossCount?: number;
  originalWins?: number;
  candidate1Wins?: number;
  candidate2Wins?: number;
  goodCount?: number;
  okayCount?: number;
  replacementCount?: number;
  droppedCount?: number;
  thresholdOutcome?: 'pass' | 'pause' | 'fail';
  durationMs?: number;
}

export interface WorkflowAuditNodeOutput {
  summary: WorkflowNodeOutputSummary;
  exchange?: LlmExchange;
  conversations?: PracticeConversation[];
  factsByConversationId?: Record<string, unknown>;
  details?: unknown;
  [key: string]: unknown;
}

export interface WorkflowAuditNode {
  id: string;
  kind: WorkflowNodeKind;
  callKind?: WorkflowAuditCallKind;
  stage?: 'initial' | 'balance';
  pass?: 1 | 2;
  candidateIndex?: 1 | 2;
  sequence?: number;
  title: string;
  status: WorkflowNodeStatus;
  startedAt?: string;
  completedAt?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface WorkflowJob {
  id: string;
  runId?: string;
  status: WorkflowJobStatus;
  setNumber: number;
  primaryConversationCount: number;
  balanceConversationCount: number;
  requestedTotalConversationCount: number;
  audioRequestedCount: number;
  audioGeneratedCount: number;
  audioErrors: Array<{ conversationId: string; error: string }>;
  nodes: WorkflowAuditNode[];
  run?: PracticeRun;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRunAudit {
  jobId: string;
  status: WorkflowJobStatus;
  primaryConversationCount: number;
  balanceConversationCount: number;
  requestedTotalConversationCount: number;
  audioRequestedCount: number;
  audioGeneratedCount: number;
  audioErrors: Array<{ conversationId: string; error: string }>;
  finalTextAudit?: FinalTextAuditReport;
  nodes: WorkflowAuditNode[];
  createdAt: string;
  updatedAt: string;
}

export interface GenerateResponse {
  run: PracticeRun;
}

export interface WorkflowGenerateResponse {
  run: PracticeRun;
  primaryConversationCount: number;
  balanceConversationCount: number;
  requestedTotalConversationCount: number;
  audioRequestedCount: number;
  audioGeneratedCount: number;
  audioErrors: Array<{ conversationId: string; error: string }>;
}

export interface WorkflowStartResponse {
  job: WorkflowJob;
}

export interface WorkflowStatusResponse {
  job: WorkflowJob;
}

export interface WorkflowRepairResponse {
  run: PracticeRun;
  repairApplied: boolean;
  repairOutcome: 'improved' | 'not_improved' | 'provider_failed';
  exchange: LlmExchange;
  evidenceByConversationId: ConversationCurationEvidenceMap;
}

export type StudioJobKind =
  | 'run-generation'
  | 'workflow-generation'
  | 'library-complement'
  | 'audio-single'
  | 'audio-batch'
  | 'add-all-audio'
  | 'audio-child';

export type StudioJobStatus =
  | 'queued'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'interrupted'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type StudioJobStageStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'interrupted';

export interface StudioJobStage {
  id: string;
  label: string;
  status: StudioJobStageStatus;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface StudioJobProgress {
  completed: number;
  total: number;
  queued?: number;
  running?: number;
  failed?: number;
}

export interface StudioJob {
  id: string;
  idempotencyKey: string;
  kind: StudioJobKind;
  status: StudioJobStatus;
  title: string;
  detail: string;
  stageLabel: string;
  setNumber?: number;
  runId?: string;
  conversationId?: string;
  parentJobId?: string;
  dependentParentJobIds?: string[];
  deduplicationKey?: string;
  stopOnFailure?: boolean;
  revision: number;
  progress: StudioJobProgress;
  stages: StudioJobStage[];
  request?: unknown;
  checkpoint?: unknown;
  workflow?: WorkflowJob;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface StudioRunShellSummary {
  kind: 'job';
  id: string;
  jobId: string;
  setNumber: number;
  title: string;
  modelLabel: string;
  requestedConversationCount: number;
  status: StudioJobStatus;
  stageLabel: string;
  progress: StudioJobProgress;
  createdAt: string;
  updatedAt: string;
  resumable: boolean;
}

export interface StudioCompletedRunSummary {
  kind: 'run';
  id: string;
  run: PracticeRun;
}

export type StudioRunSummary = StudioRunShellSummary | StudioCompletedRunSummary;

export interface StudioSnapshot {
  generatedAt: string;
  revision: number;
  runs: PracticeRun[];
  runSummaries: StudioRunSummary[];
  jobs: StudioJob[];
}

export interface StudioEvent {
  id: string;
  type: 'job' | 'run' | 'snapshot';
  revision: number;
  emittedAt: string;
  job?: StudioJob;
  run?: PracticeRun;
}

export interface StudioJobCommandResponse {
  job: StudioJob;
  attached?: boolean;
}

export interface ApiError {
  error: string;
  detail?: string;
}
