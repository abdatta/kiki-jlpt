import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  AiCurationCandidateSnapshot,
  AiCurationConversation,
  AiCurationLibraryConversation,
  AiCurationRecommendation,
  AiCurationRecommendationLiveStatus,
  AiCurationReviewReconciliation,
  AiCurationResult,
  AiCurationReview,
  AiCurationReviewSummary,
  AiCurationSnapshot,
  CuratedConversation,
  CuratedSet,
  LlmExchange,
  PracticeConversation,
  PracticeRun,
  TextModelInfo,
  VocabItem
} from '../shared/types.ts';
import { CURATION_EVIDENCE_VERSION } from './languagePolicy.ts';
import { readCuratedSet } from './library.ts';
import { CURATION_REVIEWS_DIR } from './paths.ts';
import { listRuns } from './storage.ts';
import { invokeStructuredJson, type StructuredJsonInvoker, type StructuredJsonResult } from './structuredText.ts';
import { getAllowedVocabulary } from './vocab.ts';
import { analyzeConversationsWithVocabulary, type ConversationVocabularyAnalysis } from './vocabAudit.ts';

const DEFAULT_MAX_PROMPT_CHARS = 320_000;
const CURATOR_INSTRUCTIONS = 'Curate JLPT listening-practice conversations. Return only valid JSON matching the requested shape. Treat supplied deterministic vocabulary evidence as authoritative and never invent candidate IDs.';

type UnknownRecord = Record<string, unknown>;

interface BatchEvaluation {
  candidateKey: string;
  recommend: boolean;
  rationale: string;
  strengths: string[];
  concerns: string[];
}

interface CreateAiCurationOptions {
  invoker?: StructuredJsonInvoker;
  maxPromptChars?: number;
  storageRoot?: string;
  snapshot?: AiCurationSnapshot;
  targetConversationCount: number;
}

export class AiCurationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiCurationInputError';
  }
}

export class AiCurationExecutionError extends Error {
  review: AiCurationReview;

  constructor(message: string, review: AiCurationReview) {
    super(message);
    this.name = 'AiCurationExecutionError';
    this.review = review;
  }
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? value as UnknownRecord : {};
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value.map((item, index) => requiredString(item, `${label}[${index}]`));
}

function uniqueVocabulary(vocabulary: VocabItem[]): VocabItem[] {
  const seen = new Set<string>();
  return vocabulary.filter((item) => {
    if (seen.has(item.japanese)) return false;
    seen.add(item.japanese);
    return true;
  });
}

function sortedRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b, 'ja')));
}

function curationConversation(conversation: PracticeConversation): AiCurationConversation {
  const { status: _status, audioFileName: _audioFileName, audioUrl: _audioUrl, error: _error, ...content } = conversation;
  return content;
}

function curationLibraryConversation(conversation: CuratedConversation): AiCurationLibraryConversation {
  const {
    status: _status,
    audioFileName: _audioFileName,
    audioUrl: _audioUrl,
    error: _error,
    curatedAudioPath: _curatedAudioPath,
    ...content
  } = conversation;
  return content;
}

function learningContent(conversation: AiCurationConversation | PracticeConversation) {
  return {
    title: conversation.title,
    scene: conversation.scene,
    sampleContext: conversation.sampleContext,
    text: conversation.text,
    englishTranslation: conversation.englishTranslation,
    listeningQuestions: conversation.listeningQuestions,
    answerKey: conversation.answerKey
  };
}

function sameLearningContent(left: AiCurationConversation, right: PracticeConversation): boolean {
  return JSON.stringify(learningContent(left)) === JSON.stringify(learningContent(right));
}

interface CandidateSelection {
  candidateKey: string;
  run: PracticeRun;
  conversation: PracticeConversation;
}

// Single source of truth for which saved conversations are eligible candidates and in
// what order. Both the full snapshot build and the cheap cache-key fingerprint use this
// so the two can never disagree about candidate membership or ordering.
function selectCandidates(setNumber: number, librarySet: CuratedSet, runs: PracticeRun[]): CandidateSelection[] {
  const curatedSources = new Set(librarySet.conversations.map((conversation) => (
    `${conversation.sourceRunId}:${conversation.sourceConversationId}`
  )));
  const selection: CandidateSelection[] = [];
  for (const run of runs.filter((item) => item.setNumber === setNumber)) {
    for (const conversation of run.conversations) {
      const candidateKey = `${run.id}:${conversation.id}`;
      if (conversation.curatedId || curatedSources.has(candidateKey)) continue;
      selection.push({ candidateKey, run, conversation });
    }
  }
  selection.sort((a, b) => (
    b.run.createdAt.localeCompare(a.run.createdAt)
    || a.conversation.number - b.conversation.number
    || a.candidateKey.localeCompare(b.candidateKey)
  ));
  return selection;
}

interface SnapshotFingerprintInput {
  setNumber: number;
  library: Pick<CuratedConversation, 'id' | 'updatedAt' | 'sourceRunId' | 'sourceConversationId'>[];
  candidates: {
    candidateKey: string;
    conversation: Pick<
      PracticeConversation,
      'title' | 'scene' | 'sampleContext' | 'text' | 'englishTranslation' | 'listeningQuestions' | 'answerKey'
    >;
  }[];
}

// Hashes only conversation content and identities — deliberately independent of tokenizer
// output — so an identical fingerprint can be computed from cheap JSON reads alone. The
// serialization shape is intentionally stable; changing it would mark every persisted
// review stale.
function snapshotFingerprint(input: SnapshotFingerprintInput): string {
  const stable = {
    evidenceVersion: CURATION_EVIDENCE_VERSION,
    setNumber: input.setNumber,
    library: input.library.map((conversation) => ({
      id: conversation.id,
      updatedAt: conversation.updatedAt,
      sourceRunId: conversation.sourceRunId,
      sourceConversationId: conversation.sourceConversationId
    })),
    candidates: input.candidates.map((candidate) => ({
      candidateKey: candidate.candidateKey,
      evidenceVersion: CURATION_EVIDENCE_VERSION,
      content: {
        title: candidate.conversation.title,
        scene: candidate.conversation.scene,
        sampleContext: candidate.conversation.sampleContext,
        text: candidate.conversation.text,
        englishTranslation: candidate.conversation.englishTranslation,
        listeningQuestions: candidate.conversation.listeningQuestions,
        answerKey: candidate.conversation.answerKey
      }
    }))
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function fingerprintInput(setNumber: number, librarySet: CuratedSet, selection: CandidateSelection[]): SnapshotFingerprintInput {
  return {
    setNumber,
    library: librarySet.conversations,
    candidates: selection.map((item) => ({ candidateKey: item.candidateKey, conversation: item.conversation }))
  };
}

export async function buildAiCurationSnapshotFromData(
  setNumber: number,
  allowedVocabulary: VocabItem[],
  librarySet: CuratedSet,
  runs: PracticeRun[]
): Promise<AiCurationSnapshot> {
  const targetVocabulary = uniqueVocabulary(allowedVocabulary.filter((item) => item.set === setNumber));
  const wordExposure: Record<string, number> = Object.fromEntries(targetVocabulary.map((item) => [item.japanese, 0]));
  const libraryAnalysis = await analyzeConversationsWithVocabulary(setNumber, allowedVocabulary, librarySet.conversations);

  for (const conversation of librarySet.conversations) {
    const evidence = libraryAnalysis.evidenceByConversationId[conversation.id];
    for (const word of evidence?.currentSetUniqueWords ?? []) {
      wordExposure[word] = (wordExposure[word] ?? 0) + 1;
    }
  }

  const selection = selectCandidates(setNumber, librarySet, runs);
  const analysisByRunId = new Map<string, ConversationVocabularyAnalysis>();
  const candidates: AiCurationCandidateSnapshot[] = [];

  for (const { candidateKey, run, conversation } of selection) {
    let analysis = analysisByRunId.get(run.id);
    if (!analysis) {
      analysis = await analyzeConversationsWithVocabulary(setNumber, allowedVocabulary, run.conversations);
      analysisByRunId.set(run.id, analysis);
    }
    const evidence = analysis.evidenceByConversationId[conversation.id];
    const currentSetWords = evidence.currentSetUniqueWords;
    candidates.push({
      candidateKey,
      sourceRunId: run.id,
      sourceConversationId: conversation.id,
      sourceRunCreatedAt: run.createdAt,
      updatedAt: conversation.updatedAt,
      conversation: curationConversation(conversation),
      evidence,
      contribution: {
        uncoveredWords: currentSetWords.filter((word) => (wordExposure[word] ?? 0) === 0),
        underexposedWords: currentSetWords.filter((word) => {
          const count = wordExposure[word] ?? 0;
          return count > 0 && count < 2;
        }),
        currentSetWords
      }
    });
  }

  const withoutFingerprint: Omit<AiCurationSnapshot, 'fingerprint'> = {
    evidenceVersion: CURATION_EVIDENCE_VERSION,
    setNumber,
    candidateCount: candidates.length,
    candidateKeys: candidates.map((candidate) => candidate.candidateKey),
    candidates,
    library: {
      setNumber,
      updatedAt: librarySet.updatedAt,
      conversationCount: librarySet.conversations.length,
      conversationIds: librarySet.conversations.map((conversation) => conversation.id).sort(),
      wordExposure: sortedRecord(wordExposure),
      conversations: librarySet.conversations.map(curationLibraryConversation)
    }
  };

  return {
    ...withoutFingerprint,
    fingerprint: snapshotFingerprint(fingerprintInput(setNumber, librarySet, selection))
  };
}

interface CachedAiCurationSnapshot {
  key: string;
  snapshot: AiCurationSnapshot;
}

// One snapshot per set. The expensive part of building a snapshot is tokenizing every
// candidate through Kuromoji; freshness checks (latest review, history, opening a saved
// review) only need to know whether content changed. We compute a cheap content+vocabulary
// key from the JSON reads and skip the rebuild when it matches. The key is recomputed from
// current data on every call, so the cache is self-validating — a library edit, run edit,
// addition, or removal changes the key and forces a rebuild without any manual invalidation.
const snapshotCacheBySet = new Map<number, CachedAiCurationSnapshot>();
// Dedupes concurrent builds for the same set (e.g. a Queue-open prefetch racing the
// AI-curation navigation) so they share one computation instead of both tokenizing.
const snapshotBuildInFlight = new Map<number, Promise<AiCurationSnapshot>>();

function snapshotCacheKey(
  setNumber: number,
  allowedVocabulary: VocabItem[],
  librarySet: CuratedSet,
  selection: CandidateSelection[]
): string {
  const contentFingerprint = snapshotFingerprint(fingerprintInput(setNumber, librarySet, selection));
  // Folded in because the fingerprint intentionally ignores vocabulary, yet evidence and
  // word exposure depend on it. In practice vocabulary is process-stable, so this rarely changes.
  const vocabularyFingerprint = createHash('sha256')
    .update(JSON.stringify(allowedVocabulary.map((item) => [item.set, item.japanese])))
    .digest('hex');
  return `${contentFingerprint}:${vocabularyFingerprint}`;
}

export async function buildAiCurationSnapshot(setNumber: number): Promise<AiCurationSnapshot> {
  const inFlight = snapshotBuildInFlight.get(setNumber);
  if (inFlight) return inFlight;

  const build = (async (): Promise<AiCurationSnapshot> => {
    const [allowedVocabulary, librarySet, runs] = await Promise.all([
      getAllowedVocabulary(setNumber),
      readCuratedSet(setNumber),
      listRuns()
    ]);
    const selection = selectCandidates(setNumber, librarySet, runs);
    const key = snapshotCacheKey(setNumber, allowedVocabulary, librarySet, selection);
    const cached = snapshotCacheBySet.get(setNumber);
    if (cached && cached.key === key) return cached.snapshot;

    const snapshot = await buildAiCurationSnapshotFromData(setNumber, allowedVocabulary, librarySet, runs);
    snapshotCacheBySet.set(setNumber, { key, snapshot });
    return snapshot;
  })();

  snapshotBuildInFlight.set(setNumber, build);
  try {
    return await build;
  } finally {
    snapshotBuildInFlight.delete(setNumber);
  }
}

function conversationContent(candidate: AiCurationCandidateSnapshot) {
  const conversation = candidate.conversation;
  return {
    candidateKey: candidate.candidateKey,
    evidence: candidate.evidence,
    contribution: candidate.contribution,
    title: conversation.title,
    scene: conversation.scene,
    sampleContext: conversation.sampleContext,
    text: conversation.text,
    englishTranslation: conversation.englishTranslation,
    listeningQuestions: conversation.listeningQuestions,
    answerKey: conversation.answerKey
  };
}

export function libraryContext(snapshot: AiCurationSnapshot) {
  return {
    conversationCount: snapshot.library.conversationCount,
    wordExposure: snapshot.library.wordExposure,
    conversations: snapshot.library.conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      scene: conversation.scene,
      text: conversation.text,
      listeningQuestions: conversation.listeningQuestions
    }))
  };
}

// Trimmed, model-facing view of a curated set shared by AI curation and AI-balanced
// complement generation so both prompts ground on the same library shape.
export type AiCurationLibraryContext = ReturnType<typeof libraryContext>;

export function buildAiCurationPrompt(snapshot: AiCurationSnapshot, targetConversationCount: number): string {
  return `You are curating a portfolio of JLPT N5 listening conversations for Set ${snapshot.setNumber}.

Primary objective:
Choose exactly ${targetConversationCount} conversations that collectively teach current Set ${snapshot.setNumber} vocabulary efficiently and meaningfully. Vocabulary absent or underexposed in the current library is the strongest coverage opportunity, but do not reward awkward word stuffing, incidental mentions, or incoherent dialogue.

Also judge:
- natural beginner Japanese and a coherent everyday scene;
- whether current-set words are salient and supported by context;
- useful natural repetition;
- translation and listening-question quality;
- variety and low redundancy with both the library and other recommendations;

Rules:
- Deterministic evidence below is authoritative. Do not recalculate or alter counts.
- Consider every candidate before choosing the portfolio.
- Recommend only supplied candidateKey values, at most once each.
- Return exactly ${targetConversationCount} recommendations. When trade-offs are necessary, choose the strongest complementary portfolio of that exact size and disclose concerns.
- Prefer a complementary collection over an independent score ranking.

Current library:
${JSON.stringify(libraryContext(snapshot))}

Candidates (${snapshot.candidateCount}):
${JSON.stringify(snapshot.candidates.map(conversationContent))}

Return only this JSON shape:
{
  "summary": "Collection-level explanation, including important remaining gaps.",
  "recommendations": [
    {
      "candidateKey": "exact supplied candidateKey",
      "rationale": "Why this belongs in the next portfolio",
      "strengths": ["specific strength"],
      "concerns": ["specific concern, or an empty array"]
    }
  ]
}`;
}

export function validateAiCurationResponse(
  payload: unknown,
  snapshot: AiCurationSnapshot,
  targetConversationCount: number
): AiCurationResult {
  const record = asRecord(payload);
  const summary = requiredString(record.summary, 'summary');
  if (!Array.isArray(record.recommendations)) throw new Error('recommendations must be an array.');
  const candidateByKey = new Map(snapshot.candidates.map((candidate) => [candidate.candidateKey, candidate]));
  const seen = new Set<string>();
  const recommendations: AiCurationRecommendation[] = record.recommendations.map((value, index) => {
    const recommendation = asRecord(value);
    const candidateKey = requiredString(recommendation.candidateKey, `recommendations[${index}].candidateKey`);
    if (seen.has(candidateKey)) throw new Error(`Duplicate recommended candidate: ${candidateKey}`);
    const candidate = candidateByKey.get(candidateKey);
    if (!candidate) throw new Error(`Unknown or ineligible recommended candidate: ${candidateKey}`);
    seen.add(candidateKey);
    return {
      rank: index + 1,
      candidateKey,
      sourceRunId: candidate.sourceRunId,
      sourceConversationId: candidate.sourceConversationId,
      rationale: requiredString(recommendation.rationale, `recommendations[${index}].rationale`),
      strengths: stringArray(recommendation.strengths, `recommendations[${index}].strengths`),
      concerns: stringArray(recommendation.concerns, `recommendations[${index}].concerns`),
      contribution: candidate.contribution,
      evidence: candidate.evidence,
      conversation: candidate.conversation
    };
  });
  if (recommendations.length !== targetConversationCount) {
    throw new Error(`Expected exactly ${targetConversationCount} recommendations, received ${recommendations.length}.`);
  }
  return {
    summary,
    recommendations,
    projectedLeastCoveredWords: projectLeastCoveredWords(snapshot, recommendations)
  };
}

export function projectLeastCoveredWords(
  snapshot: AiCurationSnapshot,
  recommendations: AiCurationRecommendation[]
) {
  const projected = { ...snapshot.library.wordExposure };
  for (const recommendation of recommendations) {
    for (const word of new Set(recommendation.evidence.currentSetUniqueWords)) {
      projected[word] = (projected[word] ?? 0) + 1;
    }
  }
  return Object.keys(projected)
    .map((japanese) => ({
      japanese,
      currentLibraryCount: snapshot.library.wordExposure[japanese] ?? 0,
      projectedLibraryCount: projected[japanese] ?? 0
    }))
    .sort((a, b) => a.projectedLibraryCount - b.projectedLibraryCount || a.japanese.localeCompare(b.japanese, 'ja'));
}

export function reconcileAiCurationReview(
  review: AiCurationReview,
  current: AiCurationSnapshot,
  runs: PracticeRun[],
  librarySet: CuratedSet
): AiCurationReviewReconciliation {
  const recommendations = review.result?.recommendations ?? [];
  const runById = new Map(runs.map((run) => [run.id, run]));
  const currentCandidateKeys = new Set(current.candidateKeys);
  const reviewCandidateKeys = new Set(review.snapshot.candidateKeys);
  const currentLibrarySourceKeys = new Set(librarySet.conversations.map((conversation) => (
    `${conversation.sourceRunId}:${conversation.sourceConversationId}`
  )));
  const reviewLibrarySourceKeys = new Set(review.snapshot.library.conversations.map((conversation) => (
    `${conversation.sourceRunId}:${conversation.sourceConversationId}`
  )));

  const recommendationStates = recommendations.map((recommendation) => {
    const candidateKey = `${recommendation.sourceRunId}:${recommendation.sourceConversationId}`;
    const run = runById.get(recommendation.sourceRunId);
    const conversation = run?.conversations.find((item) => item.id === recommendation.sourceConversationId);
    const libraryReady = currentLibrarySourceKeys.has(candidateKey) || Boolean(conversation?.curatedId);
    const currentCandidate = currentCandidateKeys.has(candidateKey);
    let status: AiCurationRecommendationLiveStatus;
    let detail: string | undefined;
    let blocking = false;

    if (!run || !conversation) {
      status = 'missing_source';
      detail = !run ? 'Source run could not be loaded.' : 'Source conversation no longer exists.';
      blocking = true;
    } else if (libraryReady) {
      status = 'already_in_library';
      detail = 'Already in Library.';
    } else if (!sameLearningContent(recommendation.conversation, conversation)) {
      status = 'changed_source_content';
      detail = 'Source learning content changed since this review.';
      blocking = true;
    } else if (!currentCandidate) {
      status = 'not_current_candidate';
      detail = 'Source is no longer an eligible current candidate.';
      blocking = true;
    } else if (conversation.audioFileName) {
      status = 'addable_audio_ready';
    } else {
      status = 'addable_missing_audio';
    }

    return {
      candidateKey,
      sourceRunId: recommendation.sourceRunId,
      sourceConversationId: recommendation.sourceConversationId,
      status,
      audioReady: Boolean(conversation?.audioFileName),
      libraryReady,
      currentCandidate,
      blocking,
      detail
    };
  });

  const recommendationKeysToAdd = recommendationStates
    .filter((item) => item.status === 'addable_audio_ready' || item.status === 'addable_missing_audio')
    .map((item) => item.candidateKey);
  const remainingRecommendations = recommendations.filter((recommendation) => recommendationKeysToAdd.includes(recommendation.candidateKey));
  const blocked = recommendationStates.filter((item) => item.blocking);
  const newerCandidatesNotEvaluated = current.candidateKeys.filter((candidateKey) => !reviewCandidateKeys.has(candidateKey)).length;
  const librarySourcesAddedSinceReview = [...currentLibrarySourceKeys].filter((candidateKey) => !reviewLibrarySourceKeys.has(candidateKey)).length;
  const librarySourcesRemovedSinceReview = [...reviewLibrarySourceKeys].filter((candidateKey) => !currentLibrarySourceKeys.has(candidateKey)).length;
  const alreadyInLibrary = recommendationStates.filter((item) => item.status === 'already_in_library').length;
  const missingSource = recommendationStates.filter((item) => item.status === 'missing_source').length;
  const changedSourceContent = recommendationStates.filter((item) => item.status === 'changed_source_content').length;
  const notCurrentCandidate = recommendationStates.filter((item) => item.status === 'not_current_candidate').length;
  const actionable = review.status === 'complete'
    && recommendations.length > 0
    && remainingRecommendations.length > 0
    && blocked.length === 0;

  const blockingReasons: string[] = [];
  if (review.status !== 'complete') blockingReasons.push('Review did not complete.');
  if (recommendations.length === 0) blockingReasons.push('Review has no recommendations.');
  if (missingSource > 0) blockingReasons.push(`${missingSource} recommended source${missingSource === 1 ? '' : 's'} could not be loaded.`);
  if (changedSourceContent > 0) blockingReasons.push(`${changedSourceContent} recommended source${changedSourceContent === 1 ? '' : 's'} changed since review.`);
  if (notCurrentCandidate > 0) blockingReasons.push(`${notCurrentCandidate} recommendation${notCurrentCandidate === 1 ? ' is' : 's are'} no longer eligible.`);
  if (recommendations.length > 0 && remainingRecommendations.length === 0) blockingReasons.push('Every recommendation is already in Library.');

  const warnings: string[] = [];
  if (newerCandidatesNotEvaluated > 0) {
    warnings.push(`${newerCandidatesNotEvaluated} newer candidate${newerCandidatesNotEvaluated === 1 ? ' was' : 's were'} not evaluated by this review.`);
  }
  if (librarySourcesAddedSinceReview > 0 || librarySourcesRemovedSinceReview > 0) {
    warnings.push('The curated Library changed since this review.');
  }
  if (alreadyInLibrary > 0) {
    warnings.push(`${alreadyInLibrary} recommendation${alreadyInLibrary === 1 ? ' is' : 's are'} already in Library and will be skipped.`);
  }

  return {
    reviewId: review.id,
    setNumber: review.setNumber,
    actionable,
    actionLabel: actionable ? alreadyInLibrary > 0 ? 'Add Remaining' : 'Add All' : undefined,
    blockingReasons,
    warnings,
    counts: {
      totalRecommendations: recommendations.length,
      alreadyInLibrary,
      remainingToAdd: remainingRecommendations.length,
      audioReady: recommendationStates.filter((item) => (
        item.status === 'addable_audio_ready'
        || (item.status === 'addable_missing_audio' && item.audioReady)
      )).length,
      missingAudio: recommendationStates.filter((item) => item.status === 'addable_missing_audio' && !item.audioReady).length,
      blocked: blocked.length,
      missingSource,
      changedSourceContent,
      notCurrentCandidate,
      newerCandidatesNotEvaluated,
      librarySourcesAddedSinceReview,
      librarySourcesRemovedSinceReview
    },
    recommendations: recommendationStates,
    recommendationKeysToAdd,
    currentProjectedLeastCoveredWords: projectLeastCoveredWords(current, remainingRecommendations)
  };
}

function buildBatchPrompt(snapshot: AiCurationSnapshot, candidates: AiCurationCandidateSnapshot[]): string {
  return `Evaluate every supplied candidate for a later JLPT Set ${snapshot.setNumber} portfolio decision.
Use deterministic evidence as authoritative. Judge naturalness, target-word salience, repetition, question/translation quality, scene value, redundancy with the library, and concerns. Do not omit a candidate.

Library:
${JSON.stringify(libraryContext(snapshot))}

Candidates:
${JSON.stringify(candidates.map(conversationContent))}

Return only:
{"evaluations":[{"candidateKey":"exact key","recommend":true,"rationale":"evaluation","strengths":["strength"],"concerns":["concern"]}]}`;
}

function validateBatchResponse(payload: unknown, candidates: AiCurationCandidateSnapshot[]): BatchEvaluation[] {
  const record = asRecord(payload);
  if (!Array.isArray(record.evaluations)) throw new Error('evaluations must be an array.');
  const allowed = new Set(candidates.map((candidate) => candidate.candidateKey));
  const seen = new Set<string>();
  const evaluations = record.evaluations.map((value, index): BatchEvaluation => {
    const evaluation = asRecord(value);
    const candidateKey = requiredString(evaluation.candidateKey, `evaluations[${index}].candidateKey`);
    if (!allowed.has(candidateKey)) throw new Error(`Unknown batch candidate: ${candidateKey}`);
    if (seen.has(candidateKey)) throw new Error(`Duplicate batch candidate: ${candidateKey}`);
    if (typeof evaluation.recommend !== 'boolean') throw new Error(`evaluations[${index}].recommend must be boolean.`);
    seen.add(candidateKey);
    return {
      candidateKey,
      recommend: evaluation.recommend,
      rationale: requiredString(evaluation.rationale, `evaluations[${index}].rationale`),
      strengths: stringArray(evaluation.strengths, `evaluations[${index}].strengths`),
      concerns: stringArray(evaluation.concerns, `evaluations[${index}].concerns`)
    };
  });
  const missing = [...allowed].filter((key) => !seen.has(key));
  if (missing.length) throw new Error(`Batch response omitted candidates: ${missing.join(', ')}`);
  return evaluations;
}

function buildFinalBatchPrompt(
  snapshot: AiCurationSnapshot,
  evaluations: BatchEvaluation[],
  targetConversationCount: number
): string {
  const candidateFacts = Object.fromEntries(snapshot.candidates.map((candidate) => [candidate.candidateKey, {
    evidence: candidate.evidence,
    contribution: candidate.contribution
  }]));
  return `Select the final complementary JLPT Set ${snapshot.setNumber} portfolio of exactly ${targetConversationCount} conversations from grounded candidate evaluations.
Prioritize meaningful current-set learning, absent and underexposed words, naturalness, and collection variety. Deterministic facts are authoritative. Recommend only supplied keys, return each at most once, and return exactly ${targetConversationCount} recommendations.

Library:
${JSON.stringify(libraryContext(snapshot))}

Candidate facts:
${JSON.stringify(candidateFacts)}

Grounded evaluations (every candidate is present):
${JSON.stringify(evaluations)}

Return only:
{"summary":"collection-level explanation","recommendations":[{"candidateKey":"exact key","rationale":"why selected","strengths":["strength"],"concerns":["concern"]}]}`;
}

function candidateBatches(snapshot: AiCurationSnapshot, maxChars: number): AiCurationCandidateSnapshot[][] {
  const batches: AiCurationCandidateSnapshot[][] = [];
  let current: AiCurationCandidateSnapshot[] = [];
  let currentSize = 0;
  const budget = Math.max(20_000, Math.floor(maxChars * 0.55));

  for (const candidate of snapshot.candidates) {
    const size = JSON.stringify(conversationContent(candidate)).length;
    if (current.length && currentSize + size > budget) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(candidate);
    currentSize += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

function exchangeFor(
  textModel: TextModelInfo,
  prompt: string,
  requestedAt: string,
  result?: StructuredJsonResult,
  error?: string
): LlmExchange {
  const receivedAt = new Date().toISOString();
  return {
    id: `curation-${requestedAt.replace(/[-:.]/g, '')}-${Math.random().toString(36).slice(2, 7)}`,
    provider: textModel.provider,
    model: textModel.model,
    label: textModel.label,
    instructions: CURATOR_INSTRUCTIONS,
    prompt,
    output: result?.output,
    stats: result?.stats,
    requestedAt,
    receivedAt,
    status: error ? 'failed' : 'complete',
    error
  };
}

async function invokeAndRecord(
  prompt: string,
  textModel: TextModelInfo,
  invoker: StructuredJsonInvoker,
  exchanges: LlmExchange[]
): Promise<unknown> {
  const requestedAt = new Date().toISOString();
  try {
    const result = await invoker(prompt, textModel, CURATOR_INSTRUCTIONS);
    exchanges.push(exchangeFor(textModel, prompt, requestedAt, result));
    return result.parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    exchanges.push(exchangeFor(textModel, prompt, requestedAt, undefined, message));
    throw error;
  }
}

function reviewId(setNumber: number): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `curation-set-${String(setNumber).padStart(2, '0')}-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

function reviewDirectory(setNumber: number, storageRoot = CURATION_REVIEWS_DIR): string {
  return path.join(storageRoot, `set-${String(setNumber).padStart(2, '0')}`);
}

function reviewPath(setNumber: number, id: string, storageRoot = CURATION_REVIEWS_DIR): string {
  if (!/^curation-set-\d{2}-[A-Za-z0-9-]+$/.test(id)) throw new Error('Invalid curation review ID.');
  return path.join(reviewDirectory(setNumber, storageRoot), `${id}.json`);
}

export async function saveAiCurationReview(review: AiCurationReview, storageRoot = CURATION_REVIEWS_DIR): Promise<AiCurationReview> {
  await mkdir(reviewDirectory(review.setNumber, storageRoot), { recursive: true });
  await writeFile(reviewPath(review.setNumber, review.id, storageRoot), `${JSON.stringify(review, null, 2)}\n`, 'utf8');
  return review;
}

export async function readAiCurationReview(setNumber: number, id: string, storageRoot = CURATION_REVIEWS_DIR): Promise<AiCurationReview> {
  return JSON.parse(await readFile(reviewPath(setNumber, id, storageRoot), 'utf8')) as AiCurationReview;
}

function withFreshnessAgainstSnapshot(
  review: AiCurationReview,
  current: AiCurationSnapshot,
  runs?: PracticeRun[],
  librarySet?: CuratedSet
): AiCurationReview {
  const legacyTarget = review.result?.recommendations.length || Math.min(10, Math.max(1, current.candidateCount));
  const hydrated = hydrateProjectedCoverage({
    ...review,
    targetConversationCount: Number.isInteger(review.targetConversationCount) ? review.targetConversationCount : legacyTarget,
    stale: isAiCurationReviewStale(review, current)
  });
  if (!runs || !librarySet) return hydrated;
  return {
    ...hydrated,
    reconciliation: reconcileAiCurationReview(hydrated, current, runs, librarySet)
  };
}

async function withCurrentFreshness(review: AiCurationReview): Promise<AiCurationReview> {
  const [current, runs, librarySet] = await Promise.all([
    buildAiCurationSnapshot(review.setNumber),
    listRuns(),
    readCuratedSet(review.setNumber)
  ]);
  return withFreshnessAgainstSnapshot(review, current, runs, librarySet);
}

function hydrateProjectedCoverage(review: AiCurationReview): AiCurationReview {
  if (!review.result || Array.isArray(review.result.projectedLeastCoveredWords)) return review;
  return {
    ...review,
    result: {
      ...review.result,
      projectedLeastCoveredWords: projectLeastCoveredWords(review.snapshot, review.result.recommendations)
    }
  };
}

export function isAiCurationReviewStale(review: AiCurationReview, current: AiCurationSnapshot): boolean {
  return current.fingerprint !== review.snapshot.fingerprint;
}

export async function getAiCurationReview(setNumber: number, id: string): Promise<AiCurationReview> {
  return withCurrentFreshness(await readAiCurationReview(setNumber, id));
}

async function readAiCurationReviews(setNumber: number, storageRoot = CURATION_REVIEWS_DIR): Promise<AiCurationReview[]> {
  const directory = reviewDirectory(setNumber, storageRoot);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const reviews = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map(async (entry) => JSON.parse(await readFile(path.join(directory, entry.name), 'utf8')) as AiCurationReview));
  reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return reviews;
}

export async function listAiCurationReviewSummaries(
  setNumber: number,
  storageRoot = CURATION_REVIEWS_DIR,
  currentSnapshot?: AiCurationSnapshot
): Promise<AiCurationReviewSummary[]> {
  return (await getAiCurationReviewHistory(setNumber, storageRoot, currentSnapshot)).reviews;
}

export async function getAiCurationReviewHistory(
  setNumber: number,
  storageRoot = CURATION_REVIEWS_DIR,
  currentSnapshot?: AiCurationSnapshot
): Promise<{ reviews: AiCurationReviewSummary[]; latestReview: AiCurationReview | null }> {
  const reviews = await readAiCurationReviews(setNumber, storageRoot);
  if (reviews.length === 0) return { reviews: [], latestReview: null };
  const [current, runs, librarySet] = await Promise.all([
    currentSnapshot ?? buildAiCurationSnapshot(setNumber),
    listRuns(),
    readCuratedSet(setNumber)
  ]);
  const hydrated = reviews.map((storedReview) => withFreshnessAgainstSnapshot(storedReview, current, runs, librarySet));
  return { reviews: hydrated.map((review) => {
    return {
      id: review.id,
      setNumber: review.setNumber,
      targetConversationCount: review.targetConversationCount,
      status: review.status,
      stale: review.stale,
      textModel: review.textModel,
      candidateCount: review.snapshot.candidateCount,
      recommendationCount: review.result?.recommendations.length ?? 0,
      error: review.error,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt
    };
  }), latestReview: hydrated[0] };
}

export async function getLatestAiCurationReview(setNumber: number): Promise<AiCurationReview | null> {
  const reviews = await readAiCurationReviews(setNumber);
  return reviews[0] ? withCurrentFreshness(reviews[0]) : null;
}

export async function createAiCurationReview(
  setNumber: number,
  textModel: TextModelInfo,
  options: CreateAiCurationOptions
): Promise<AiCurationReview> {
  const invoker = options.invoker ?? invokeStructuredJson;
  const maxPromptChars = options.maxPromptChars ?? Number(process.env.CURATION_MAX_PROMPT_CHARS || DEFAULT_MAX_PROMPT_CHARS);
  const snapshot = options.snapshot ?? await buildAiCurationSnapshot(setNumber);
  const targetConversationCount = options.targetConversationCount;
  if (!Number.isInteger(targetConversationCount) || targetConversationCount < 1 || targetConversationCount > snapshot.candidateCount) {
    throw new AiCurationInputError(`Portfolio size must be an integer from 1 through ${snapshot.candidateCount}.`);
  }
  const timestamp = new Date().toISOString();
  const base = {
    id: reviewId(setNumber),
    setNumber,
    targetConversationCount,
    stale: false,
    textModel,
    snapshot,
    llmExchanges: [] as LlmExchange[],
    createdAt: timestamp,
    updatedAt: timestamp
  };

  try {
    const singlePrompt = buildAiCurationPrompt(snapshot, targetConversationCount);
    let result: AiCurationResult;
    if (singlePrompt.length <= maxPromptChars) {
      result = validateAiCurationResponse(
        await invokeAndRecord(singlePrompt, textModel, invoker, base.llmExchanges),
        snapshot,
        targetConversationCount
      );
    } else {
      const evaluations: BatchEvaluation[] = [];
      for (const batch of candidateBatches(snapshot, maxPromptChars)) {
        const prompt = buildBatchPrompt(snapshot, batch);
        evaluations.push(...validateBatchResponse(
          await invokeAndRecord(prompt, textModel, invoker, base.llmExchanges),
          batch
        ));
      }
      if (new Set(evaluations.map((evaluation) => evaluation.candidateKey)).size !== snapshot.candidateCount) {
        throw new Error('Candidate accounting failed during batched evaluation.');
      }
      const finalPrompt = buildFinalBatchPrompt(snapshot, evaluations, targetConversationCount);
      result = validateAiCurationResponse(
        await invokeAndRecord(finalPrompt, textModel, invoker, base.llmExchanges),
        snapshot,
        targetConversationCount
      );
    }

    return saveAiCurationReview({
      ...base,
      status: 'complete',
      result,
      updatedAt: new Date().toISOString()
    }, options.storageRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await saveAiCurationReview({
      ...base,
      status: 'failed',
      error: message,
      updatedAt: new Date().toISOString()
    }, options.storageRoot);
    throw new AiCurationExecutionError(message, failed);
  }
}
