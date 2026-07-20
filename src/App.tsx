import { Fragment, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Bot,
  BookOpen,
  Check,
  ChevronDown,
  CircleAlert,
  Clock,
  Disc3,
  Eye,
  Headphones,
  Info,
  Languages,
  LoaderCircle,
  ListMusic,
  Pause,
  Pencil,
  Plus,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Target,
  Trash2,
  Wrench,
  X
} from 'lucide-react';
import type {
  ApiError,
  AiCurationRecommendation,
  AiCurationReview,
  AiCurationReviewSummary,
  ConversationCurationEvidenceMap,
  CuratedConversation,
  CuratedSet,
  LibraryBalancePlan,
  LibraryComplementGenerateRequest,
  LibraryRecommendationCandidate,
  LibraryRecommendations,
  LlmExchange,
  PracticeConversation,
  PracticeRun,
  RunAnalytics,
  RunAudioGenerateRequest,
  SetSummary,
  StudioEvent,
  StudioJob,
  StudioRunShellSummary,
  StudioSnapshot,
  TextModelInfo,
  TextModelProvider,
  VocabItem,
  WorkflowAuditNode,
  WorkflowJob,
  WorkflowRepairResponse,
  WorkflowStartResponse
} from '../shared/types.ts';
import { BALANCE_CONVERSATION_COUNT_RANGE, RUN_CONVERSATION_COUNT_RANGE, describeCountRange, formatCountRange } from '../shared/generationLimits.ts';
import { BrandLogo } from './components/BrandLogo.tsx';
import { AddAllProgressModal, type AddAllProgress, type AddAllProgressItem } from './components/AddAllProgressModal.tsx';
import { AiCurationReconciliationPanel } from './components/AiCurationReconciliationPanel.tsx';
import { AudioProgressStage } from './components/AudioProgressStage.tsx';
import { StudioBackgroundJobs, type StudioToast } from './components/StudioBackgroundJobs.tsx';
import { shouldNotifyJobEvent } from './studioNotifications.ts';
import { selectStudioRunForSet } from './studioRunSelection.ts';
import { selectedCurationCandidateCount, toggleCurationRun } from './studioCurationScope.ts';
import {
  AiRecommendationReason,
  CurationEvidencePanel,
  StudioWordChip,
  type StudioWordMetadata,
  WordFrequencyDistribution
} from './components/CurationEvidence.tsx';
import {
  SourceRunDistribution,
  SourceRunLabel,
  resolveSourceRunMetadata,
  sourceRunDistribution,
  type SourceRunReference
} from './components/SourceRunProvenance.tsx';
import { planAddAllRecommendations } from './addAllAudio.ts';

const ConsumerApp = lazy(() => import('./consumer/ConsumerApp.tsx').then((module) => ({ default: module.ConsumerApp })));

type ConversationAction = 'audio' | 'delete-audio';
type BoardMode = 'runs' | 'library' | 'recommendations' | 'ai-curation';
type GenerateRunMode = 'workflow-max-audio' | 'workflow-audio' | 'workflow-text' | 'text-only';
type StudioRoute =
  | { boardMode: 'runs'; runId?: string; auditOpen: boolean; conversationId?: string }
  | { boardMode: 'recommendations'; setNumber: number }
  | { boardMode: 'ai-curation'; setNumber: number }
  | { boardMode: 'library'; setNumber: number };
type BusyAction =
  | 'preflight'
  | 'generate'
  | 'generate-complement'
  | 'ai-curation'
  | 'workflow'
  | `audio-all:${string}`
  | `${ConversationAction}:${string}`
  | `save:${string}`
  | `library-add:${string}`
  | `library-remove:${string}`
  | 'publish-library'
  | `delete-run:${string}`
  | `reanalyze-run:${string}`
  | `repair-node:${string}:${string}`
  | `reanalyze-library:${number}`
  | null;
type AudioPlaybackState = 'idle' | 'paused' | 'playing' | 'ended';

interface EditState {
  conversationId: string;
  title: string;
  scene: string;
  sampleContext: string;
  transcript: string;
}

type GenerationSessionStatus = 'running' | 'complete' | 'failed';

interface GenerationSession {
  id: string;
  title: string;
  detail: string;
  setNumber: number;
  conversationCount: number;
  textModelLabel: string;
  startedAt: string;
  completedAt?: string;
  status: GenerationSessionStatus;
  exchange?: LlmExchange;
  error?: string;
}

interface GenerateModalState {
  setNumber: number;
  conversationCount: string;
  textModelId: string;
  judgeModelId: string;
  runMode: GenerateRunMode;
}

type BalanceStrategy = 'stats' | 'ai';

interface BalanceModalState {
  textModelId: string;
  strategy: BalanceStrategy;
  conversationCount: string;
}

interface GenerateRunConfig {
  setNumber: number;
  conversationCount: number;
  textModelId: string;
  judgeModelId: string;
}

interface PracticeLibraryPublishStatus {
  stale: boolean;
  curatedGeneratedAt: string;
  publishedGeneratedAt: string;
  curatedConversationCount: number;
  publishedConversationCount: number;
}

const GENERATE_RUN_MODES: Array<{ id: GenerateRunMode; label: string; description: string }> = [
  {
    id: 'workflow-max-audio',
    label: 'Full pipeline + max audio',
    description: 'Generate, balance, then try to synthesize audio for the entire batch or until a usage limit.'
  },
  {
    id: 'workflow-audio',
    label: 'Full pipeline + 2 audio',
    description: 'Generate, balance, then synthesize audio for the first two conversations.'
  },
  {
    id: 'workflow-text',
    label: 'Full pipeline, text only',
    description: 'Generate and balance the run while skipping audio synthesis.'
  },
  {
    id: 'text-only',
    label: 'Draft text pass',
    description: 'Generate only the initial conversation batch without balancing or audio.'
  }
];

const BALANCE_STRATEGIES: Array<{ id: BalanceStrategy; label: string; description: string }> = [
  {
    id: 'stats',
    label: 'Stats only',
    description: 'Target missing and underused current-set words from deterministic coverage stats. The chosen model writes the conversations but is not shown your existing library.'
  },
  {
    id: 'ai',
    label: 'Stats + library context',
    description: 'Also give the model your curated conversations and per-word exposure, so it fills the same gaps while avoiding repeated scenes and adding meaningful variety.'
  }
];

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function decodeRoutePart(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function studioRunsRoute(runId?: string, auditOpen = false, conversationId?: string): string {
  if (!runId) return '#/studio/runs';
  const auditPath = auditOpen ? '/audit' : '';
  // The node inspector is a transient modal, so it is not URL-addressable; the
  // conversation trace annotates the whole graph and stays shareable.
  const conversationPath = auditOpen && conversationId ? `/c/${encodeURIComponent(conversationId)}` : '';
  return `#/studio/runs/${encodeURIComponent(runId)}${auditPath}${conversationPath}`;
}

function studioQueueRoute(setNumber: number): string {
  return `#/studio/queue/set/${encodeURIComponent(setNumber)}`;
}

function studioAiCurationRoute(setNumber: number): string {
  return `#/studio/ai-curation/set/${encodeURIComponent(setNumber)}`;
}

function studioLibraryRoute(setNumber: number): string {
  return `#/studio/library/set/${encodeURIComponent(setNumber)}`;
}

export function parseStudioRoute(hash = typeof window === 'undefined' ? '' : window.location.hash): StudioRoute {
  if (!hash || hash === '#' || hash === '#/' || hash === '#/studio') {
    return { boardMode: 'runs', auditOpen: false };
  }

  const [path] = hash.replace(/^#\/?/, '').split(/[?#]/);
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'studio') {
    return { boardMode: 'runs', auditOpen: false };
  }

  if (parts.length === 1 || (parts[1] === 'runs' && parts.length === 2)) {
    return { boardMode: 'runs', auditOpen: false };
  }

  if (parts[1] === 'runs' && parts.length >= 3 && (parts.length === 3 || parts[3] === 'audit')) {
    const runId = decodeRoutePart(parts[2]);
    if (!runId) return { boardMode: 'runs', auditOpen: false };
    let conversationId: string | undefined;
    // Legacy links may still carry an /n/<node> segment; parse it for the
    // conversation trace but ignore the node (the inspector is now a modal).
    for (let index = 4; index < parts.length - 1; index += 2) {
      if (parts[index] === 'c') conversationId = decodeRoutePart(parts[index + 1]);
    }
    return { boardMode: 'runs', runId, auditOpen: parts[3] === 'audit', conversationId };
  }

  if (parts[1] === 'queue' && parts[2] === 'set' && parts.length === 4) {
    const setNumber = parsePositiveInt(parts[3]);
    return setNumber ? { boardMode: 'recommendations', setNumber } : { boardMode: 'runs', auditOpen: false };
  }

  if (parts[1] === 'ai-curation' && parts[2] === 'set' && parts.length === 4) {
    const setNumber = parsePositiveInt(parts[3]);
    return setNumber ? { boardMode: 'ai-curation', setNumber } : { boardMode: 'runs', auditOpen: false };
  }

  if (parts[1] === 'library' && parts[2] === 'set' && parts.length === 4) {
    const setNumber = parsePositiveInt(parts[3]);
    return setNumber ? { boardMode: 'library', setNumber } : { boardMode: 'runs', auditOpen: false };
  }

  return { boardMode: 'runs', auditOpen: false };
}

function navigateToStudioRoute(route: string) {
  if (typeof window === 'undefined') return;
  if (window.location.hash === route) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  window.location.hash = route;
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {})
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload as ApiError;
    throw new Error(error.detail || error.error || response.statusText);
  }
  return payload as T;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function transcriptForEdit(conversation: PracticeConversation): string {
  return conversation.text.map((line) => `${line.speaker}: [${line.tags.join(', ')}] ${line.japanese}`).join('\n');
}

function statusLabel(status: PracticeConversation['status']): string {
  return status.replaceAll('_', ' ');
}

function audioSrc(conversation: PracticeConversation | CuratedConversation): string | undefined {
  if (!conversation.audioUrl) return undefined;
  const separator = conversation.audioUrl.includes('?') ? '&' : '?';
  return `${conversation.audioUrl}${separator}v=${encodeURIComponent(conversation.updatedAt)}`;
}

function makeSessionId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `generation-${Date.now()}`;
}

function workflowAudioSummary(audioCount: number): string {
  if (audioCount === 0) return 'Audio skipped';
  return `${audioCount} audio conversation${audioCount === 1 ? '' : 's'}`;
}

function splitWorkflowConversationTarget(totalConversationCount: number): { primaryConversationCount: number; balanceConversationCount: number } {
  const primaryConversationCount = Math.ceil(totalConversationCount * 2 / 3);
  return {
    primaryConversationCount,
    balanceConversationCount: totalConversationCount - primaryConversationCount
  };
}

function workflowPlanChips(job: WorkflowJob): string[] {
  return [
    `${job.requestedTotalConversationCount} requested`,
    `${job.primaryConversationCount} initial set`,
    `${job.balanceConversationCount} balancing`,
    job.audioRequestedCount === 0 ? 'Audio skipped' : `${job.audioRequestedCount} audio`,
    job.status
  ];
}

function makeClientWorkflowJob(setNumber: number, conversationCount: number, audioCount: number): WorkflowJob {
  const timestamp = new Date().toISOString();
  const { primaryConversationCount, balanceConversationCount } = splitWorkflowConversationTarget(conversationCount);
  return {
    id: makeSessionId(),
    status: 'running',
    setNumber,
    primaryConversationCount,
    balanceConversationCount,
    requestedTotalConversationCount: conversationCount,
    audioRequestedCount: audioCount,
    audioGeneratedCount: 0,
    audioErrors: [],
    nodes: [
      {
        id: 'generator',
        kind: 'generator',
        title: 'Generating Initial Set',
        status: 'pending'
      },
      {
        id: 'balancer',
        kind: 'balancer',
        title: 'Balancing Set',
        status: 'pending'
      },
      ...Array.from({ length: audioCount }, (_, index) => ({
        id: `audio-${index + 1}`,
        kind: 'audio' as const,
        title: `Conversation ${index + 1}`,
        status: 'pending' as const
      }))
    ],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function reconcileWorkflowAuditNodes(run: PracticeRun, nodes: WorkflowAuditNode[]): WorkflowAuditNode[] {
  const nonAudioNodes = nodes.filter((node) => node.kind !== 'audio');
  const audioNodes = nodes.filter((node) => node.kind === 'audio');
  const existingByConversationId = new Map<string, WorkflowAuditNode>();

  audioNodes.forEach((node) => {
    const conversationId = objectValue(node.input)?.conversationId;
    if (typeof conversationId === 'string') {
      existingByConversationId.set(conversationId, node);
    }
  });

  if (runHasMissingAudio(run) && run.conversations.length > audioNodes.length) {
    return [
      ...nonAudioNodes,
      ...run.conversations.map((conversation, index) => (
        workflowAudioNodeForConversation(
          conversation,
          index,
          existingByConversationId.get(conversation.id) ?? audioNodes[index]
        )
      ))
    ];
  }

  return [
    ...nonAudioNodes,
    ...audioNodes.map((node) => {
      const nodeIndex = Number(node.id.replace(/^audio-/, '')) - 1;
      const input = objectValue(node.input);
      const conversationId = typeof input?.conversationId === 'string' ? input.conversationId : undefined;
      const conversation = run.conversations.find((item) => item.id === conversationId) ?? run.conversations[nodeIndex];
      return conversation ? workflowAudioNodeForConversation(conversation, nodeIndex, node) : node;
    })
  ];
}

function workflowJobForRun(run: PracticeRun | null): WorkflowJob | null {
  if (!run) return null;
  if (run.workflowAudit) {
    const nodes = reconcileWorkflowAuditNodes(run, run.workflowAudit.nodes);
    const audioNodes = nodes.filter((node) => node.kind === 'audio');
    const audioErrors = audioNodes.filter((node) => node.status === 'error').map((node) => ({
      conversationId: String(objectValue(node.input)?.conversationId ?? node.id),
      error: node.error ?? 'Audio generation failed.'
    }));
    const hasActiveAudioConversation = run.conversations.some((conversation) => conversation.status === 'audio_generating');
    const hasProcessingAudio = audioNodes.some((node) => node.status === 'processing');
    const hasQueuedAudio = audioNodes.some((node) => node.status === 'pending');
    const hasIncompleteAudio = audioNodes.some((node) => node.status !== 'done');
    const status = run.workflowAudit.status === 'paused'
      ? 'paused'
      : hasProcessingAudio || (run.workflowAudit.status === 'running' && hasActiveAudioConversation && hasQueuedAudio)
      ? 'running'
      : audioErrors.length || (run.workflowAudit.audioRequestedCount > 0 && hasIncompleteAudio)
        ? 'failed'
        : run.workflowAudit.status;
    return {
      id: run.workflowAudit.jobId,
      status,
      setNumber: run.setNumber,
      primaryConversationCount: run.workflowAudit.primaryConversationCount,
      balanceConversationCount: run.workflowAudit.balanceConversationCount,
      requestedTotalConversationCount: run.workflowAudit.requestedTotalConversationCount,
      audioRequestedCount: audioNodes.length,
      audioGeneratedCount: audioNodes.filter((node) => node.status === 'done').length,
      audioErrors,
      nodes,
      run,
      createdAt: run.workflowAudit.createdAt,
      updatedAt: run.workflowAudit.updatedAt
    };
  }

  const exchanges = run.llmExchanges ?? [];
  if (exchanges.length < 2) return null;

  const primaryConversationCount = Math.max(1, Math.floor(run.conversations.length * 2 / 3));
  const balanceConversationCount = Math.max(0, run.conversations.length - primaryConversationCount);
  const audioConversations = runHasMissingAudio(run)
    ? run.conversations
    : run.conversations.slice(0, 2).filter((conversation) => conversation.audioFileName || conversation.error);
  const nodes: WorkflowAuditNode[] = [
    {
      id: 'generator',
      kind: 'generator',
      title: 'Generating Initial Set',
      status: exchanges[0].status === 'complete' ? 'done' : exchanges[0].status === 'failed' ? 'error' : 'pending',
      startedAt: exchanges[0].requestedAt,
      completedAt: exchanges[0].receivedAt,
      input: { model: exchanges[0].model, prompt: exchanges[0].prompt },
      output: exchanges[0],
      error: exchanges[0].error
    },
    {
      id: 'balancer',
      kind: 'balancer',
      title: 'Balancing Set',
      status: exchanges[1].status === 'complete' ? 'done' : exchanges[1].status === 'failed' ? 'error' : 'pending',
      startedAt: exchanges[1].requestedAt,
      completedAt: exchanges[1].receivedAt,
      input: { model: exchanges[1].model, prompt: exchanges[1].prompt },
      output: exchanges[1],
      error: exchanges[1].error
    },
    ...audioConversations.map((conversation, index) => workflowAudioNodeForConversation(conversation, index, {
      id: `audio-${index + 1}`,
      kind: 'audio',
      title: `Conversation ${index + 1}`,
      status: conversationHasAudio(conversation) ? 'done' : conversation.error ? 'error' : 'pending',
      startedAt: conversation.updatedAt,
      completedAt: conversation.updatedAt,
      input: {
        conversationId: conversation.id,
        conversationTitle: conversation.title
      },
      output: conversation.audioFileName ? {
        fileName: conversation.audioFileName,
        audioUrl: conversation.audioUrl
      } : undefined,
      error: conversation.error
    }))
  ];

  return {
    id: `run-${run.id}-workflow-audit`,
    status: nodes.some((node) => node.kind === 'audio' && node.status !== 'done') || nodes.some((node) => node.status === 'error') ? 'failed' : 'complete',
    setNumber: run.setNumber,
    primaryConversationCount,
    balanceConversationCount,
    requestedTotalConversationCount: run.conversations.length,
    audioRequestedCount: audioConversations.length,
    audioGeneratedCount: audioConversations.filter((conversation) => conversation.audioFileName).length,
    audioErrors: audioConversations.filter((conversation) => conversation.error).map((conversation) => ({
      conversationId: conversation.id,
      error: conversation.error ?? 'Audio generation failed.'
    })),
    nodes,
    run,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  };
}

function initialGenerateModalState(setNumber: number): GenerateModalState {
  return {
    setNumber,
    conversationCount: '',
    textModelId: '',
    judgeModelId: 'codex:gpt-5.6-sol',
    runMode: 'workflow-text'
  };
}

function formatAuditTime(value?: string): string {
  return value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Pending';
}

function formatClockTime(date: Date): string {
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatRunTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const daysAgo = Math.round((startOfLocalDay(now).getTime() - startOfLocalDay(date).getTime()) / dayMs);
  const time = formatClockTime(date);

  if (daysAgo === 0) return time;
  if (daysAgo === 1) return `Yesterday, ${time}`;
  if (daysAgo > 1 && daysAgo < 7) {
    return `${date.toLocaleDateString([], { weekday: 'long' })} ${time}`;
  }

  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

function formatRunHistoryTitle(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const daysAgo = Math.round((startOfLocalDay(now).getTime() - startOfLocalDay(date).getTime()) / dayMs);
  const time = formatClockTime(date);

  if (daysAgo === 0) return `Today, ${time}`;
  if (daysAgo === 1) return `Yesterday, ${time}`;
  if (daysAgo > 1 && daysAgo < 7) {
    return `${date.toLocaleDateString([], { weekday: 'long' })}, ${time}`;
  }

  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

function aiCurationReviewSummary(review: AiCurationReview): AiCurationReviewSummary {
  return {
    id: review.id,
    setNumber: review.setNumber,
    selectedRunIds: review.selectedRunIds ?? review.snapshot.selectedRunIds,
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
}

function aiCurationHistoryLabel(review: AiCurationReviewSummary, index: number): string {
  const prefix = index === 0 ? 'Latest · ' : '';
  return `${prefix}${formatRunHistoryTitle(review.createdAt)}`;
}

let selectMeasureCanvas: HTMLCanvasElement | null = null;

function measureSelectLabelWidth(text: string): number {
  if (typeof document === 'undefined') return text.length * 8;
  selectMeasureCanvas = selectMeasureCanvas ?? document.createElement('canvas');
  const context = selectMeasureCanvas.getContext('2d');
  if (!context) return text.length * 8;
  context.font = '800 13px Inter, ui-sans-serif, system-ui, sans-serif';
  return context.measureText(text).width;
}

// Native selects size to their widest option; this sizes to the SELECTED option so the
// picker expands/contracts as the choice changes (CSS field-sizing isn't universally supported).
function AutoWidthSelect({
  options,
  value,
  onChange,
  className,
  disabled,
  required,
  ariaLabel,
  title
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  ariaLabel?: string;
  title?: string;
}) {
  const selectedLabel = options.find((option) => option.value === value)?.label ?? '';
  // measured text + left padding (14) + arrow room (32) + small buffer
  const width = useMemo(() => Math.ceil(measureSelectLabelWidth(selectedLabel)) + 50, [selectedLabel]);
  return (
    <select
      aria-label={ariaLabel}
      className={className}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      required={required}
      style={{ width: `${width}px` }}
      title={title}
      value={value}
    >
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}

function coverageCountClass(count: number): string {
  if (count <= 0) return 'coverageCount0';
  if (count === 1) return 'coverageCount1';
  if (count === 2) return 'coverageCount2';
  if (count === 3) return 'coverageCount3';
  return 'coverageCount4';
}

function wordFrequency(words: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const word of words) {
    const cleaned = word.trim();
    if (!cleaned) continue;
    counts.set(cleaned, (counts.get(cleaned) ?? 0) + 1);
  }
  return counts;
}

// claude-sonnet-4-5-20250929 → "Sonnet 4.5"; claude-fable-5 → "Fable 5".
// Non-Claude identifiers pass through unchanged; exact ids stay in exchange stats.
export function formatClaudeModelVersion(modelId: string): string {
  const match = /^claude-([a-z]+)-(\d+(?:-\d+)*?)(?:-\d{8})?$/i.exec(modelId.trim());
  if (!match) return modelId;
  const family = match[1].charAt(0).toUpperCase() + match[1].slice(1);
  return `${family} ${match[2].replace(/-/g, '.')}`;
}

// Display form of a resolved model id. Claude ids keep their provider name
// ("Claude Fable 5") so runs stay distinguishable across Claude/GPT/Gemini;
// other providers' ids already carry theirs (gpt-…, gemini-…).
export function formatResolvedModel(modelId: string): string {
  const short = formatClaudeModelVersion(modelId);
  return short === modelId ? modelId : `Claude ${short}`;
}

// gpt-5.6-sol → "GPT 5.6 Sol"; gpt-5.5 → "GPT 5.5"; gpt-5.4-mini → "GPT 5.4 Mini".
// Every Codex option runs at medium effort, so the effort is not shown.
export function formatCodexModelName(modelId: string): string {
  const match = /^gpt-([0-9.]+)(?:-(.+))?$/i.exec(modelId.trim());
  if (!match) return modelId.toUpperCase();
  const suffix = match[2]
    ? match[2].split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
    : '';
  return suffix ? `GPT ${match[1]} ${suffix}` : `GPT ${match[1]}`;
}

// gemini-3-flash-preview → "Gemini 3"; gemini-3.5-flash → "Gemini 3.5";
// a bare "gemini" id → "Gemini".
export function formatGeminiModelName(modelId: string): string {
  const trimmed = modelId.trim();
  const match = /^gemini[-\s]?([0-9.]+)/i.exec(trimmed);
  if (match) return `Gemini ${match[1]}`;
  return /^gemini$/i.test(trimmed) ? 'Gemini' : trimmed;
}

function modelDisplayName(model: { provider: TextModelProvider; model: string; resolvedModel?: string; label?: string }): string {
  if (model.provider === 'claude') return model.resolvedModel ? formatResolvedModel(model.resolvedModel) : (model.label ?? model.model);
  if (model.provider === 'codex') return formatCodexModelName(model.model);
  return formatGeminiModelName(model.model);
}

function exchangeModelName(exchange?: LlmExchange, fallbackLabel?: string): string {
  if (!exchange) return fallbackLabel ?? 'Pending';
  return modelDisplayName(exchange);
}

function shortModelLabel(model: TextModelInfo): string {
  if (model.source === 'legacy') return model.label;
  return modelDisplayName(model);
}

function runModelDisplay(model: TextModelInfo): string {
  return shortModelLabel(model);
}

// In-progress run shells carry only a pre-baked label string (a picker id like
// `codex:gpt-5.5`, or a stored label like "GPT-5.6-Sol (Codex, medium)"), so
// normalise those shapes to the same clean names shown elsewhere.
export function cleanShellModelLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed.startsWith('codex:')) return formatCodexModelName(trimmed.slice('codex:'.length));
  if (trimmed.startsWith('claude:')) {
    const rest = trimmed.slice('claude:'.length);
    const resolved = formatResolvedModel(rest);
    return resolved.startsWith('Claude') ? resolved : `Claude ${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
  }
  if (/^gemini:?$/i.test(trimmed)) return 'Gemini';
  const parenthetical = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(trimmed);
  if (parenthetical) {
    const inside = parenthetical[2].trim();
    if (/^gemini-/i.test(inside)) return formatGeminiModelName(inside);
    if (/^gpt/i.test(parenthetical[1])) return formatCodexModelName(parenthetical[1].trim());
    return parenthetical[1].trim();
  }
  if (/^gpt-/i.test(trimmed)) return formatCodexModelName(trimmed);
  if (/^gemini-/i.test(trimmed)) return formatGeminiModelName(trimmed);
  return trimmed;
}

const TEXT_MODEL_PROVIDER_GROUPS: Array<{ provider: TextModelProvider; label: string }> = [
  { provider: 'gemini', label: 'Gemini' },
  { provider: 'codex', label: 'GPT' },
  { provider: 'claude', label: 'Claude' }
];

export function TextModelOptionGroups({ models }: { models: TextModelInfo[] }) {
  return (
    <>
      {TEXT_MODEL_PROVIDER_GROUPS
        .map((group) => ({ ...group, options: models.filter((model) => model.provider === group.provider) }))
        .filter((group) => group.options.length > 0)
        .map((group) => (
          <optgroup key={group.provider} label={group.label}>
            {group.options.map((model) => (
              <option key={model.id} value={model.id}>
                {shortModelLabel(model)}
              </option>
            ))}
          </optgroup>
        ))}
    </>
  );
}

type QualityCounts = Record<NonNullable<PracticeConversation['quality']>, number>;
type ConversationQualityReview = NonNullable<PracticeConversation['qualityReview']>;
type QualityReviewMap = Record<string, ConversationQualityReview>;

export function conversationQualityCounts(conversations: readonly Pick<PracticeConversation, 'quality'>[]): QualityCounts {
  return conversations.reduce<QualityCounts>((counts, conversation) => {
    if (conversation.quality) counts[conversation.quality] += 1;
    return counts;
  }, { good: 0, okay: 0, bad: 0 });
}

function RunMetricChip({ tone, value, label }: { tone: 'neutral' | 'coverage' | 'good' | 'okay' | 'bad' | 'missing' | 'oov'; value: string | number; label: string }) {
  return (
    <span className={`runMetricChip ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </span>
  );
}

function ConversationQualityBadge({
  quality,
  review,
  onClick
}: {
  quality?: PracticeConversation['quality'];
  review?: ConversationQualityReview;
  onClick?: () => void;
}) {
  if (!quality) return null;
  const label = onClick ? (
    <button className={`conversationQualityChip ${quality}`} onClick={onClick} type="button">{quality}</button>
  ) : <span className={`conversationQualityChip ${quality}`}>{quality}</span>;
  if (!review) return label;

  const verdictLabel = review.source === 'triage' ? 'Passed generation quality triage'
    : review.source === 'pick' ? 'Selected by the quality judge'
      : review.source === 'gate' ? 'Selected by deterministic quality gates'
        : review.source === 'fallback' ? 'Assigned by a provider fallback'
          : review.verdict === 'pass' ? 'Passed final dialogue review'
            : review.verdict === 'repair' ? 'Needs a meaningful dialogue improvement'
              : 'Has a structural dialogue problem';
  const provenance = [
    review.judgeModel ? shortModelLabel(review.judgeModel) : review.source ? review.source.replace('-', ' ') : undefined,
    review.rubricVersion,
    formatAuditTime(review.reviewedAt)
  ].filter(Boolean).join(' · ');
  return (
    <span className="conversationQualityBadge" tabIndex={onClick ? undefined : 0}>
      {label}
      <span className="conversationQualityTooltip" role="tooltip">
        <strong>{quality} · {verdictLabel}</strong>
        <p>{review.rationale}</p>
        {review.flags.length ? <span className="qualityReviewFlags"><b>Review notes</b>{review.flags.map((flag) => <em key={flag}>{flag.replaceAll('_', ' ')}</em>)}</span> : null}
        <small>{provenance}</small>
      </span>
    </span>
  );
}

function RunSummaryChips({ conversations, analytics }: { conversations: readonly PracticeConversation[]; analytics: PracticeRun['analytics'] }) {
  const quality = conversationQualityCounts(conversations);

  return (
    <div className="runSummaryChips">
      <span className="runMetricGroup quality" aria-label="Conversation quality">
        <RunMetricChip tone="neutral" value={conversations.length} label="Convos" />
        {quality.good > 0 ? <RunMetricChip tone="good" value={quality.good} label="Good" /> : null}
        {quality.okay > 0 ? <RunMetricChip tone="okay" value={quality.okay} label="Okay" /> : null}
        {quality.bad > 0 ? <RunMetricChip tone="bad" value={quality.bad} label="Bad" /> : null}
      </span>
      <span className="runMetricGroup findings" aria-label="Vocabulary coverage and findings">
        <RunMetricChip tone="missing" value={analytics.currentSetMissingCount} label="Missing" />
        <RunMetricChip tone="coverage" value={`${analytics.allowedVocabUsedPercentage}%`} label="Used" />
        <RunMetricChip tone="oov" value={analytics.outOfAllowedCount} label="OOV" />
      </span>
    </div>
  );
}

export function libraryCountsBySourceRun(sets: readonly CuratedSet[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const set of sets) {
    for (const conversation of set.conversations) {
      counts.set(conversation.sourceRunId, (counts.get(conversation.sourceRunId) ?? 0) + 1);
    }
  }
  return counts;
}

export function RunLibraryBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  const description = `${count} conversation${count === 1 ? '' : 's'} from this run in the library`;
  return (
    <span className="runLibraryBadge" title={description} aria-label={description}>
      <BookOpen size={11} aria-hidden />
      {count}
    </span>
  );
}

function formatAuditOutput(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
}

function formatAuditValue(value: unknown): string {
  if (value === undefined) return 'Pending';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseAuditJsonString(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function findStringPropertyDeep(value: unknown, propertyNames: string[], seen = new WeakSet<object>()): string | undefined {
  const item = parseAuditJsonString(value);
  if (!item || typeof item !== 'object') return undefined;
  if (seen.has(item)) return undefined;
  seen.add(item);

  if (Array.isArray(item)) {
    for (const entry of item) {
      const found = findStringPropertyDeep(entry, propertyNames, seen);
      if (found) return found;
    }
    return undefined;
  }

  const record = item as Record<string, unknown>;
  for (const propertyName of propertyNames) {
    const entry = record[propertyName];
    if (typeof entry === 'string' && entry.trim()) return entry;
  }

  for (const entry of Object.values(record)) {
    const found = findStringPropertyDeep(entry, propertyNames, seen);
    if (found) return found;
  }
  return undefined;
}

function findNumberPropertyDeep(value: unknown, propertyNames: string[], seen = new WeakSet<object>()): number | undefined {
  const item = parseAuditJsonString(value);
  if (!item || typeof item !== 'object') return undefined;
  if (seen.has(item)) return undefined;
  seen.add(item);

  if (Array.isArray(item)) {
    for (const entry of item) {
      const found = findNumberPropertyDeep(entry, propertyNames, seen);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  const record = item as Record<string, unknown>;
  for (const propertyName of propertyNames) {
    const entry = record[propertyName];
    if (typeof entry === 'number' && Number.isFinite(entry)) return entry;
  }

  for (const entry of Object.values(record)) {
    const found = findNumberPropertyDeep(entry, propertyNames, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

function omitStringPropertiesDeep(value: unknown, propertyNames: string[], seen = new WeakSet<object>()): unknown {
  const item = parseAuditJsonString(value);
  if (!item || typeof item !== 'object') return item;
  if (seen.has(item)) return '[Circular]';
  seen.add(item);

  if (Array.isArray(item)) {
    return item.map((entry) => omitStringPropertiesDeep(entry, propertyNames, seen));
  }

  const entries = Object.entries(item as Record<string, unknown>)
    .flatMap(([key, entry]) => {
      if (propertyNames.includes(key) && typeof entry === 'string') {
        return [];
      }
      return [[key, omitStringPropertiesDeep(entry, propertyNames, seen)] as const];
    });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function splitStringPropertyFromAuditValue(value: unknown, propertyNames: string[]): { text?: string; value?: unknown } {
  return {
    text: findStringPropertyDeep(value, propertyNames),
    value: omitStringPropertiesDeep(value, propertyNames)
  };
}

function splitPromptFromAuditValue(value: unknown): { prompt?: string; value?: unknown } {
  const result = splitStringPropertyFromAuditValue(value, ['prompt']);
  return {
    prompt: result.text,
    value: result.value
  };
}

function splitResponseFromAuditValue(value: unknown): { response?: string; value?: unknown } {
  const result = splitStringPropertyFromAuditValue(value, ['output', 'response', 'text']);
  return {
    response: result.text,
    value: result.value
  };
}

function workflowNodeTitle(node: WorkflowAuditNode): string {
  if (node.callKind) {
    if (node.status === 'error') return `${node.title} failed`;
    if (node.status === 'processing') return `${node.title}…`;
    return node.title;
  }
  if (node.kind === 'generator') {
    if (node.status === 'done') return 'Generated Initial Set';
    if (node.status === 'error') return 'Initial Set Failed';
    if (node.status === 'pending') return 'Initial Set Pending';
    return 'Generating Initial Set';
  }
  if (node.kind === 'balancer') {
    if (node.status === 'done') return 'Balanced Set';
    if (node.status === 'error') return 'Balancing Failed';
    if (node.status === 'pending') return 'Balancing Pending';
    return 'Balancing Set';
  }
  return node.title
    .replace('Audio LLM:', 'Conversation')
    .replace('Audio Agent: Conversation', 'Conversation');
}

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function workflowNodeDetail(node: WorkflowAuditNode): string {
  const summary = objectValue(node.output)?.summary;
  const statLine = typeof objectValue(summary)?.statLine === 'string' ? objectValue(summary)?.statLine as string : undefined;
  if (statLine) return statLine;
  if (node.callKind) {
    if (node.status === 'processing') return node.callKind === 'audio' ? 'Generating audio' : 'Running step';
    if (node.status === 'repairWarning') return 'Fallback applied';
    if (node.status === 'error') return node.error ?? 'Step failed';
    if (node.status === 'skipped') return 'Skipped';
    if (node.status === 'pending') return 'Queued';
  }
  if (node.kind === 'generator' || node.kind === 'balancer') {
    const conversations = workflowNodeConversations(node);
    const requestedConversationCount = findNumberPropertyDeep(node.input, ['requestedConversationCount']);
    if (node.status === 'done') {
      const count = conversations.length || findNumberPropertyDeep(node.output, ['conversationCount']) || 0;
      return `${node.kind === 'balancer' ? '+' : ''}${pluralize(count, 'conversation')}`;
    }
    if (node.status === 'processing') {
      return requestedConversationCount ? `Creating ${pluralize(requestedConversationCount, 'conversation')}` : 'Creating conversations';
    }
    if (node.status === 'error') return node.error ? 'Needs attention' : 'Generation failed';
    if (node.status === 'skipped') return 'Skipped';
    return 'Waiting to start';
  }

  const durationSeconds = findNumberPropertyDeep(node.output, ['durationSeconds', 'audioDurationSeconds']);
  if (node.status === 'done') return durationSeconds ? `${Math.round(durationSeconds)} seconds` : 'Audio ready';
  if (node.status === 'processing') return 'Generating audio';
  if (node.status === 'error') return 'Audio failed';
  if (node.status === 'skipped') return 'Skipped after failure';
  return 'Queued';
}

function workflowNodeDetailLines(node: WorkflowAuditNode): string[] {
  return deriveVersionStatLines(node) ?? [workflowNodeDetail(node)];
}

function versionPickLine(label: string, stats: { picked: number; good: number; okay: number }): string {
  if (!stats.picked) return `${label}: 0 picked`;
  const parts = [
    `${stats.picked} picked`,
    ...(stats.good ? [`${stats.good} good`] : []),
    ...(stats.okay ? [`${stats.okay} okay`] : [])
  ];
  return `${label}: ${parts.join(' · ')}`;
}

function repairGateLine(candidateIndex: 1 | 2, stats: { failed: boolean; eliminated: number; coverageLoss: number }): string {
  if (stats.failed) return `Repair ${candidateIndex}: call failed`;
  return `Repair ${candidateIndex}: ${stats.eliminated} eliminated · ${stats.coverageLoss} coverage-loss`;
}

/* Version-comparing nodes (dominance gates, version pick) render a per-version
   stat stack derived from the per-conversation facts persisted in their
   details. Display text is never stored, so runs of any age render alike. */
function deriveVersionStatLines(node: WorkflowAuditNode): string[] | undefined {
  const details = objectValue(objectValue(node.output)?.details);
  const records = (value: unknown): Record<string, unknown>[] =>
    (Array.isArray(value) ? value : []).map(objectValue).filter((record): record is Record<string, unknown> => record !== undefined);
  const recordsByConversation = (value: unknown): Record<string, unknown>[] =>
    Object.values(objectValue(value) ?? {}).flatMap(records);
  if (node.callKind === 'pick') {
    const picks = records(details?.picks);
    if (!picks.length) return undefined;
    const line = (label: string, source: string) => {
      const selected = picks.filter((pick) => pick.selected === source);
      const good = selected.filter((pick) => pick.selectedQuality === 'good').length;
      return versionPickLine(label, { picked: selected.length, good, okay: selected.length - good });
    };
    return [line('Original', 'original'), line('Repair 1', 'candidate1'), line('Repair 2', 'candidate2')];
  }
  if (node.callKind === 'dominance-gates') {
    const versions = recordsByConversation(details?.versionsByConversationId);
    if (!versions.length) return undefined;
    const eliminated = recordsByConversation(details?.eliminatedByConversationId);
    const line = (candidateIndex: 1 | 2) => {
      const source = `candidate${candidateIndex}`;
      return repairGateLine(candidateIndex, {
        failed: !versions.some((version) => version.source === source),
        eliminated: eliminated.filter((item) => item.source === source).length,
        coverageLoss: versions.filter((version) => version.source === source && Array.isArray(version.flags) && version.flags.includes('coverage_loss')).length
      });
    };
    return [line(1), line(2)];
  }
  return undefined;
}

function RepairFailureIcon({ size = 18 }: { size?: number }) {
  return (
    <span className="repairFailureIcon" style={{ '--repair-icon-size': `${size}px` } as React.CSSProperties} aria-hidden="true">
      <Wrench size={size} />
      <CircleAlert className="repairFailureIconBadge" size={Math.max(10, Math.round(size * 0.62))} />
    </span>
  );
}

function WorkflowStatusIcon({ node, size = 18 }: { node: WorkflowAuditNode; size?: number }) {
  if (node.status === 'processing') return <RefreshCw className="spin" size={size} />;
  if (workflowNodeHasRepairFailure(node)) return <RepairFailureIcon size={size} />;
  if (node.status === 'done') return <Check size={size} />;
  if (node.status === 'repairWarning') return <CircleAlert size={size} />;
  if (node.status === 'error') return <CircleAlert size={size} />;
  if (node.status === 'skipped') return <X size={size} />;
  return node.kind === 'audio' ? <Pause size={size} /> : <Sparkles size={size} />;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  const parsed = parseAuditJsonString(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
}

function isRunAnalytics(value: unknown): value is RunAnalytics {
  const record = objectValue(value);
  return Boolean(record
    && typeof record.currentSetTotal === 'number'
    && typeof record.currentSetUsedCount === 'number'
    && typeof record.currentSetMissingCount === 'number'
    && Array.isArray(record.currentSetMissingWords)
    && typeof record.allowedVocabTotal === 'number'
    && typeof record.allowedVocabUsedCount === 'number'
    && typeof record.allowedVocabUsedPercentage === 'number'
    && typeof record.outOfAllowedCount === 'number'
    && Array.isArray(record.outOfAllowedWords));
}

function workflowNodeAnalytics(node?: WorkflowAuditNode): RunAnalytics | undefined {
  const output = objectValue(node?.output);
  const analytics = output?.analytics;
  return isRunAnalytics(analytics) ? analytics : undefined;
}

function isPracticeConversationList(value: unknown): value is PracticeConversation[] {
  return Array.isArray(value) && value.every((item) => {
    const record = objectValue(item);
    return Boolean(record && Array.isArray(record.vocabularyUsed));
  });
}

function workflowNodeConversations(node?: WorkflowAuditNode): PracticeConversation[] {
  const output = objectValue(node?.output);
  return isPracticeConversationList(output?.conversations) ? output.conversations : [];
}

function isLlmExchange(value: unknown): value is LlmExchange {
  const record = objectValue(value);
  return Boolean(record
    && typeof record.id === 'string'
    && typeof record.prompt === 'string'
    && typeof record.requestedAt === 'string'
    && (record.status === 'pending' || record.status === 'complete' || record.status === 'failed'));
}

function workflowNodeExchanges(node?: WorkflowAuditNode): LlmExchange[] {
  const output = objectValue(node?.output);
  const exchanges = Array.isArray(output?.exchanges)
    ? output.exchanges.filter(isLlmExchange)
    : [];
  if (exchanges.length) return exchanges;
  return isLlmExchange(output?.exchange) ? [output.exchange] : isLlmExchange(node?.output) ? [node.output] : [];
}

function llmExchangeStats(exchange: LlmExchange): Record<string, unknown> {
  return exchange.stats && typeof exchange.stats === 'object' && !Array.isArray(exchange.stats)
    ? exchange.stats as Record<string, unknown>
    : {};
}

function isRepairExchange(exchange: LlmExchange): boolean {
  return typeof llmExchangeStats(exchange).repairAttempt === 'number';
}

function repairOutcome(exchange: LlmExchange): string | undefined {
  const outcome = llmExchangeStats(exchange).repairOutcome;
  return typeof outcome === 'string' ? outcome : undefined;
}

function exchangeHasRepairFailure(exchange: LlmExchange): boolean {
  if (!isRepairExchange(exchange)) return false;
  const outcome = repairOutcome(exchange);
  return exchange.status === 'failed' || outcome === 'provider_failed' || outcome === 'not_improved';
}

function workflowNodeHasRepairFailure(node?: WorkflowAuditNode): boolean {
  const repairs = workflowNodeExchanges(node).filter(isRepairExchange);
  const latestRepair = repairs.at(-1);
  return latestRepair ? exchangeHasRepairFailure(latestRepair) : false;
}

function workflowNodeCanRerunRepair(node?: WorkflowAuditNode): boolean {
  return Boolean(node
    && ((node.kind === 'generator' || node.kind === 'balancer')
      ? node.status === 'done' && workflowNodeHasRepairFailure(node)
      : ['repair-candidate', 'dominance-gates', 'pick'].includes(node.callKind ?? '')
        && ['done', 'repairWarning', 'error'].includes(node.status)));
}

function exchangeAttemptTitle(exchange: LlmExchange, index: number): string {
  const stats = llmExchangeStats(exchange);
  return typeof stats.repairAttempt === 'number' ? 'Repair' : index === 0 ? 'Initial' : `Attempt ${index + 1}`;
}

function vocabularyQualitySummary(value: unknown): string | undefined {
  const quality = objectValue(value);
  const issues = Array.isArray(quality?.issues) ? quality.issues : [];
  if (!quality || issues.length === 0) return quality?.passed === true ? '0 OOV' : undefined;
  const words = new Set<string>();
  let rejectedDeclarations = 0;
  for (const issue of issues) {
    const record = objectValue(issue);
    const trueWords = Array.isArray(record?.trueOutOfVocabularyWords) ? record.trueOutOfVocabularyWords : [];
    for (const word of trueWords) {
      if (typeof word === 'string' && word.trim()) words.add(word.trim());
    }
    const rejected = Array.isArray(record?.rejectedDeclarations) ? record.rejectedDeclarations : [];
    rejectedDeclarations += rejected.length;
  }
  const parts = [];
  parts.push(`${words.size} OOV`);
  if (rejectedDeclarations) parts.push(`${rejectedDeclarations} rejected`);
  return parts.join(', ');
}

function exchangeAttemptDetail(exchange: LlmExchange): string {
  const stats = llmExchangeStats(exchange);
  if (typeof stats.repairOutcome === 'string') return stats.repairOutcome.replace(/_/g, ' ');
  if (exchange.status === 'failed') return 'failed';
  return vocabularyQualitySummary(stats.vocabularyQuality ?? stats.finalVocabularyQuality) ?? exchange.status;
}

interface WorkflowDistributionStats {
  current: {
    missingCount: number;
    atMostOnceCount: number;
    atMostTwiceCount: number;
  };
  cumulative: {
    missingCount: number;
    atMostOnceCount: number;
    atMostTwiceCount: number;
  };
}

function exactOccurrenceBuckets(conversations: PracticeConversation[]): { once: number; twice: number } {
  const counts = new Map<string, number>();
  for (const conversation of conversations) {
    for (const word of conversation.vocabularyUsed) {
      const cleaned = word.trim();
      if (!cleaned) continue;
      counts.set(cleaned, (counts.get(cleaned) ?? 0) + 1);
    }
  }

  return {
    once: Array.from(counts.values()).filter((count) => count === 1).length,
    twice: Array.from(counts.values()).filter((count) => count === 2).length
  };
}

function workflowDistributionStats(
  node: WorkflowAuditNode | undefined,
  analytics: RunAnalytics | undefined,
  conversations: PracticeConversation[]
): WorkflowDistributionStats | undefined {
  const output = objectValue(node?.output);
  const persisted = objectValue(output?.distributionStats);
  if (
    typeof persisted?.missingCount === 'number'
    && typeof persisted.atMostOnceCount === 'number'
    && typeof persisted.atMostTwiceCount === 'number'
  ) {
    const cumulative = {
      missingCount: persisted.missingCount,
      atMostOnceCount: persisted.atMostOnceCount,
      atMostTwiceCount: persisted.atMostTwiceCount
    };
    const current = {
      missingCount: typeof persisted.currentSetMissingCount === 'number' ? persisted.currentSetMissingCount : analytics?.currentSetMissingCount ?? cumulative.missingCount,
      atMostOnceCount: typeof persisted.currentSetAtMostOnceCount === 'number' ? persisted.currentSetAtMostOnceCount : analytics?.currentSetMissingCount ?? cumulative.atMostOnceCount,
      atMostTwiceCount: typeof persisted.currentSetAtMostTwiceCount === 'number' ? persisted.currentSetAtMostTwiceCount : analytics?.currentSetMissingCount ?? cumulative.atMostTwiceCount
    };

    return {
      current,
      cumulative
    };
  }

  if (!analytics) return undefined;
  const exact = exactOccurrenceBuckets(conversations);
  const fallback = {
    missingCount: analytics.currentSetMissingCount,
    atMostOnceCount: analytics.currentSetMissingCount + exact.once,
    atMostTwiceCount: analytics.currentSetMissingCount + exact.once + exact.twice
  };
  return {
    current: fallback,
    cumulative: fallback
  };
}

function workflowAudioUrl(node?: WorkflowAuditNode): string | undefined {
  return findStringPropertyDeep(node?.output, ['audioUrl']);
}

function conversationHasAudio(conversation: PracticeConversation): boolean {
  return Boolean(conversation.audioFileName);
}

function runAudioReadyCount(run: PracticeRun): number {
  return run.conversations.filter(conversationHasAudio).length;
}

function runHasMissingAudio(run: PracticeRun): boolean {
  return run.conversations.some((conversation) => !conversationHasAudio(conversation));
}

function workflowAudioNodeForConversation(
  conversation: PracticeConversation,
  index: number,
  existingNode?: WorkflowAuditNode
): WorkflowAuditNode {
  const input = objectValue(existingNode?.input);
  const conversationAudioOutput = conversation.audioFileName && conversation.audioUrl
    ? {
        fileName: conversation.audioFileName,
        audioUrl: conversation.audioUrl
      }
    : undefined;
  const baseNode: WorkflowAuditNode = {
    ...(existingNode ?? {}),
    id: `audio-${index + 1}`,
    kind: 'audio',
    title: `Conversation ${index + 1}`,
    status: existingNode?.status ?? 'pending',
    input: {
      ...(input ?? {}),
      conversationId: conversation.id,
      conversationTitle: conversation.title
    }
  };

  if (conversationAudioOutput) {
    return {
      ...baseNode,
      status: 'done',
      output: {
        ...(objectValue(existingNode?.output) ?? {}),
        ...conversationAudioOutput
      },
      error: undefined
    };
  }
  if (existingNode?.status === 'done' && workflowAudioUrl(existingNode)) {
    return {
      ...baseNode,
      status: 'done',
      output: existingNode.output,
      error: undefined
    };
  }
  if (existingNode?.status === 'processing' || (!existingNode && conversation.status === 'audio_generating')) {
    return {
      ...baseNode,
      status: 'processing',
      output: undefined,
      error: undefined
    };
  }
  if (conversation.status === 'audio_failed' || conversation.error || existingNode?.status === 'error') {
    return {
      ...baseNode,
      status: 'error',
      output: undefined,
      error: conversation.error ?? existingNode?.error ?? 'Audio generation failed.'
    };
  }
  if (existingNode?.status === 'skipped') {
    return {
      ...baseNode,
      status: 'skipped',
      output: undefined,
      error: existingNode.error
    };
  }

  return {
    ...baseNode,
    status: 'pending',
    output: undefined,
    error: undefined
  };
}

function optimisticAudioRun(run: PracticeRun, mode: 'replace' | 'resume'): PracticeRun {
  const targetIds = new Set((mode === 'resume'
    ? run.conversations.filter((conversation) => !conversation.audioFileName)
    : run.conversations).map((conversation) => conversation.id));
  const audioTargets = run.conversations.filter((conversation) => targetIds.has(conversation.id));
  const activeTargetIds = new Set(audioTargets.slice(0, 3).map((conversation) => conversation.id));
  const nodes = run.workflowAudit?.nodes ?? workflowJobForRun(run)?.nodes ?? [];
  const audioNodes: WorkflowAuditNode[] = run.conversations.map((conversation, index) => {
    const existingNode = nodes.find((node) => node.id === `audio-${index + 1}`);
    return {
      id: `audio-${index + 1}`,
      kind: 'audio',
      title: `Conversation ${index + 1}`,
      status: !targetIds.has(conversation.id) ? 'done' : activeTargetIds.has(conversation.id) ? 'processing' : 'pending',
      input: {
        conversationId: conversation.id,
        conversationTitle: conversation.title
      },
      output: targetIds.has(conversation.id) ? undefined : existingNode?.output
    };
  });

  return {
    ...run,
    status: 'generated',
    conversations: run.conversations.map((conversation) => targetIds.has(conversation.id)
      ? {
        ...conversation,
        status: activeTargetIds.has(conversation.id) ? 'audio_generating' : 'draft',
        audioFileName: undefined,
        audioUrl: undefined,
        error: undefined
      }
      : conversation),
    workflowAudit: run.workflowAudit ? {
      ...run.workflowAudit,
      status: 'running',
      audioRequestedCount: run.conversations.length,
      audioGeneratedCount: run.conversations.length - targetIds.size,
      audioErrors: [],
      nodes: [
        ...run.workflowAudit.nodes.filter((node) => node.kind !== 'audio'),
        ...audioNodes
      ],
      updatedAt: new Date().toISOString()
    } : undefined,
    updatedAt: new Date().toISOString()
  };
}

function deltaText(before: number, after: number, suffix = ''): string {
  const delta = after - before;
  if (delta === 0) return `0${suffix}`;
  return `${delta > 0 ? '+' : ''}${delta}${suffix}`;
}

function percentageText(used: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((used / total) * 1000) / 10}%`;
}

function percentageValue(used: number, total: number): number {
  if (!total) return 0;
  return Math.round((used / total) * 1000) / 10;
}

function WorkflowMetricCard({
  label,
  value,
  detail,
  note,
  trend
}: {
  label: string;
  value: string;
  detail: string;
  note?: string;
  trend?: string;
}) {
  return (
    <div className="workflowMetricCard">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
      {note ? <small>{note}</small> : null}
      {trend ? <em>{trend}</em> : null}
    </div>
  );
}

function WorkflowStatsPanel({
  selectedNode,
  generatorNode,
  wordMetadata
}: {
  selectedNode: WorkflowAuditNode;
  generatorNode?: WorkflowAuditNode;
  wordMetadata?: Map<string, StudioWordMetadata>;
}) {
  const analytics = workflowNodeAnalytics(selectedNode);
  if (!analytics || selectedNode.kind === 'audio') return null;
  const generatorConversations = workflowNodeConversations(generatorNode);
  const selectedConversations = workflowNodeConversations(selectedNode);
  const generatorDistribution = workflowDistributionStats(
    generatorNode,
    workflowNodeAnalytics(generatorNode),
    generatorConversations
  );
  const selectedDistribution = workflowDistributionStats(
    selectedNode,
    analytics,
    selectedNode.kind === 'balancer' ? [...generatorConversations, ...selectedConversations] : selectedConversations
  );

  if (selectedNode.kind === 'balancer') {
    const before = workflowNodeAnalytics(generatorNode);
    if (!before || !generatorDistribution || !selectedDistribution) return null;
    const recoveredWords = before.currentSetMissingWords.filter((word) => !analytics.currentSetMissingWords.includes(word));
    const beforeCurrentSetCoverage = percentageValue(before.currentSetUsedCount, before.currentSetTotal);
    const afterCurrentSetCoverage = percentageValue(analytics.currentSetUsedCount, analytics.currentSetTotal);

    return (
      <section className="workflowStatsBlock" aria-label="Balance stats">
        <div className="workflowTabbedHeader">
          <span>Balance Stats</span>
        </div>
        <div className="workflowMetricGrid">
          <WorkflowMetricCard
            label="Allowed Coverage"
            value={`${percentageText(before.currentSetUsedCount, before.currentSetTotal)} -> ${percentageText(analytics.currentSetUsedCount, analytics.currentSetTotal)}`}
            detail={`${analytics.currentSetUsedCount} of ${analytics.currentSetTotal} current set words used`}
            note={`Cumulative: ${analytics.allowedVocabUsedPercentage}% (${analytics.allowedVocabUsedCount} of ${analytics.allowedVocabTotal})`}
            trend={deltaText(beforeCurrentSetCoverage, afterCurrentSetCoverage, '%')}
          />
          <WorkflowMetricCard
            label="Missing Words"
            value={`${generatorDistribution.current.missingCount} -> ${selectedDistribution.current.missingCount}`}
            detail="Words not used at all"
            note={`Cumulative: ${generatorDistribution.cumulative.missingCount} -> ${selectedDistribution.cumulative.missingCount}`}
            trend={deltaText(generatorDistribution.current.missingCount, selectedDistribution.current.missingCount)}
          />
          <WorkflowMetricCard
            label="Barely Touched"
            value={`${generatorDistribution.current.atMostOnceCount} -> ${selectedDistribution.current.atMostOnceCount}`}
            detail="Words used once or not yet used"
            note={`Cumulative: ${generatorDistribution.cumulative.atMostOnceCount} -> ${selectedDistribution.cumulative.atMostOnceCount}`}
            trend={deltaText(generatorDistribution.current.atMostOnceCount, selectedDistribution.current.atMostOnceCount)}
          />
          <WorkflowMetricCard
            label="Needs More Reps"
            value={`${generatorDistribution.current.atMostTwiceCount} -> ${selectedDistribution.current.atMostTwiceCount}`}
            detail="Words used two times or fewer"
            note={`Cumulative: ${generatorDistribution.cumulative.atMostTwiceCount} -> ${selectedDistribution.cumulative.atMostTwiceCount}`}
            trend={deltaText(generatorDistribution.current.atMostTwiceCount, selectedDistribution.current.atMostTwiceCount)}
          />
        </div>
        <div className="workflowStatsChips">
          <span>Recovered Words</span>
          <div className="miniChips coverage">
            {recoveredWords.length === 0 ? <span>None</span> : null}
            {recoveredWords.slice(0, 48).map((word) => <StudioWordChip key={word} word={word} metadata={wordMetadata?.get(word)} />)}
            {recoveredWords.length > 48 ? <span>+{recoveredWords.length - 48}</span> : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="workflowStatsBlock" aria-label="Generator stats">
      <div className="workflowTabbedHeader">
        <span>Generator Stats</span>
      </div>
      <div className="workflowMetricGrid">
        <WorkflowMetricCard
          label="Allowed Coverage"
          value={percentageText(analytics.currentSetUsedCount, analytics.currentSetTotal)}
          detail={`${analytics.currentSetUsedCount} of ${analytics.currentSetTotal} current set words used`}
          note={`Cumulative: ${analytics.allowedVocabUsedPercentage}% (${analytics.allowedVocabUsedCount} of ${analytics.allowedVocabTotal})`}
        />
        <WorkflowMetricCard
          label="Missing Words"
          value={String(selectedDistribution?.current.missingCount ?? analytics.currentSetMissingCount)}
          detail="Words not used at all"
          note={selectedDistribution ? `Cumulative: ${selectedDistribution.cumulative.missingCount}` : undefined}
        />
        <WorkflowMetricCard
          label="Barely Touched"
          value={String(selectedDistribution?.current.atMostOnceCount ?? analytics.currentSetMissingCount)}
          detail="Words used once or not yet used"
          note={selectedDistribution ? `Cumulative: ${selectedDistribution.cumulative.atMostOnceCount}` : undefined}
        />
        <WorkflowMetricCard
          label="Needs More Reps"
          value={String(selectedDistribution?.current.atMostTwiceCount ?? analytics.currentSetMissingCount)}
          detail="Words used two times or fewer"
          note={selectedDistribution ? `Cumulative: ${selectedDistribution.cumulative.atMostTwiceCount}` : undefined}
        />
      </div>
      <div className="workflowStatsChips">
        <span>Needs Balancing</span>
        <div className="miniChips">
          {analytics.currentSetMissingWords.length === 0 ? <span>None</span> : null}
          {analytics.currentSetMissingWords.slice(0, 48).map((word) => <StudioWordChip key={word} word={word} metadata={wordMetadata?.get(word)} />)}
          {analytics.currentSetMissingWords.length > 48 ? <span>+{analytics.currentSetMissingWords.length - 48}</span> : null}
        </div>
      </div>
    </section>
  );
}

function WorkflowAudioResponse({ audioUrl }: { audioUrl: string }) {
  return (
    <div className="workflowAudioResponse">
      <Headphones size={22} />
      <div>
        <strong>Generated audio</strong>
        <audio controls preload="metadata" src={audioUrl} />
      </div>
    </div>
  );
}

function WorkflowExchangeAttempts({
  exchanges,
  onRerunRepair,
  rerunRepairDisabled
}: {
  exchanges: LlmExchange[];
  onRerunRepair?: () => void;
  rerunRepairDisabled?: boolean;
}) {
  if (!exchanges.length) return <EmptyAuditPane label="No LLM attempts were captured for this node." />;
  const latestRepair = exchanges.filter(isRepairExchange).at(-1);
  const hasRepairFailure = latestRepair ? exchangeHasRepairFailure(latestRepair) : false;

  return (
    <div className="workflowAttemptList">
      {hasRepairFailure ? (
        <div className="workflowRepairNotice" role="status">
          <RepairFailureIcon size={18} />
          <span>Repair failed or did not improve this batch.</span>
        </div>
      ) : null}
      {exchanges.map((exchange, index) => {
        const stats = llmExchangeStats(exchange);
        const selected = stats.selectedForFinal === true;
        const repair = isRepairExchange(exchange);
        const repairWarning = exchangeHasRepairFailure(exchange);
        const promptId = `${exchange.id}-prompt`;
        const outputId = `${exchange.id}-output`;
        const metadataId = `${exchange.id}-metadata`;
        const output = formatAuditOutput(exchange.output);
        const outputError = exchange.status === 'failed' ? exchange.error : undefined;
        return (
          <details className={`workflowAttempt ${selected ? 'selected' : ''} ${repairWarning ? 'repairWarning' : ''}`} key={`${exchange.id}-${index}`} open={selected || index === exchanges.length - 1}>
            <summary>
              <span>
                <strong>
                  {repairWarning ? <RepairFailureIcon size={14} /> : null}
                  {exchangeAttemptTitle(exchange, index)}
                  {repair ? (
                    <Info
                      className="workflowAttemptInfoIcon"
                      size={14}
                      aria-label="Repair block information"
                      role="img"
                    >
                      <title>This repair block shows the prompt, output, and metadata for the model call that tried to fix vocabulary audit issues in this node's conversations. Rerun repair replaces this block with the latest repair attempt.</title>
                    </Info>
                  ) : null}
                </strong>
                <small>{exchangeAttemptDetail(exchange)}</small>
              </span>
              <span className="workflowAttemptBadges">
                {repairWarning && onRerunRepair ? (
                  <button className="workflowAttemptAction" disabled={rerunRepairDisabled} onClick={(event) => {
                    event.preventDefault();
                    onRerunRepair();
                  }} type="button">
                    {rerunRepairDisabled ? <RefreshCw className="spin" size={14} /> : <RotateCcw size={14} />}
                    Rerun repair
                  </button>
                ) : null}
                {selected ? <em>Final</em> : null}
                <em>{exchange.status}</em>
              </span>
            </summary>
            <div className="workflowAttemptBody">
              <div className="workflowAttemptMeta">
                <span>{exchange.label}</span>
                <span>{formatAuditTime(exchange.requestedAt)} &rarr; {formatAuditTime(exchange.receivedAt)}</span>
              </div>
              <details className="workflowAttemptReveal">
                <summary id={promptId}>Prompt</summary>
                <pre aria-labelledby={promptId}>{exchange.prompt}</pre>
              </details>
              <details className="workflowAttemptReveal">
                <summary id={outputId}>Output</summary>
                <pre aria-labelledby={outputId}>{output ?? outputError ?? 'No output returned.'}</pre>
              </details>
              {exchange.stats ? (
                <details className="workflowAttemptReveal">
                  <summary id={metadataId}>Metadata</summary>
                  <pre aria-labelledby={metadataId}>{formatAuditValue(exchange.stats)}</pre>
                </details>
              ) : null}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function PendingAuditOutput({ label }: { label: string }) {
  return (
    <div className="workflowPendingOutput" role="status">
      <span className="workflowPendingSpinner" aria-hidden="true" />
      <strong>{label}</strong>
    </div>
  );
}

function EmptyAuditPane({ label }: { label: string }) {
  return (
    <div className="workflowEmptyPane">
      <span>{label}</span>
    </div>
  );
}

function WorkflowTabs<T extends string>({
  active,
  onChange,
  tabs
}: {
  active: T;
  onChange: (tab: T) => void;
  tabs: Array<{ id: T; label: string; warning?: boolean }>;
}) {
  return (
    <div className="workflowTabs" role="tablist">
      {tabs.map((tab) => (
        <button
          aria-selected={active === tab.id}
          className={active === tab.id ? 'active' : ''}
          key={tab.id}
          onClick={() => onChange(tab.id)}
          role="tab"
          type="button"
        >
          {tab.warning ? <RepairFailureIcon size={13} /> : null}
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function workflowStatusText(status: WorkflowJob['status'] | WorkflowAuditNode['status']): string {
  if (status === 'done') return 'Done';
  if (status === 'processing') return 'Generating';
  if (status === 'pending') return 'Pending';
  if (status === 'error') return 'Failed';
  if (status === 'repairWarning') return 'Recovered with fallback';
  if (status === 'paused') return 'Paused for review';
  if (status === 'skipped') return 'Skipped';
  return status;
}

function WorkflowNodeButton({
  node,
  selected,
  onSelect,
  traceFact,
  dimmed = false
}: {
  node: WorkflowAuditNode;
  selected: boolean;
  onSelect: () => void;
  traceFact?: string;
  dimmed?: boolean;
}) {
  const repairWarning = workflowNodeHasRepairFailure(node);
  const exchange = workflowNodeExchanges(node)[0];
  const durationMs = node.startedAt && node.completedAt ? new Date(node.completedAt).getTime() - new Date(node.startedAt).getTime() : undefined;
  const deterministic = ['vocab-audit', 'dominance-gates', 'final-audit'].includes(node.callKind ?? '');
  const detailLines = traceFact ? [traceFact] : workflowNodeDetailLines(node);
  const meta = !deterministic && (exchange?.model || durationMs !== undefined)
    ? `${exchangeModelName(exchange, 'Model call')}${durationMs !== undefined ? ` · ${(durationMs / 1000).toFixed(1)}s` : ''}`
    : undefined;
  /* Multi-line stat stacks reclaim the redundant bold-title row (the eyebrow
     already names the step) and pull the meta up beside it, so the node's
     footprint stays the same as the single-line layout. */
  const stacked = detailLines.length > 1;
  return (
    <button className={`workflowNode ${node.status} ${deterministic ? 'deterministic' : 'llmCall'} ${repairWarning ? 'repairWarning' : ''} ${selected ? 'selected' : ''} ${dimmed ? 'dimmed' : ''}`} onClick={onSelect} type="button">
      <span className="workflowNodeIcon">
        <WorkflowStatusIcon node={node} />
      </span>
      <span className="workflowNodeBody">
        {stacked ? (
          <>
            <span className="workflowNodeHeaderRow">
              <strong>{workflowNodeTitle(node)}</strong>
              {meta ? <span className="workflowNodeMeta">{meta}</span> : node.status === 'skipped' ? <span className="workflowNodeMeta">skipped</span> : null}
            </span>
            <span className="workflowNodeStats">
              {detailLines.map((line) => <span key={line} title={line}>{line}</span>)}
            </span>
          </>
        ) : (
          <>
            <strong>{workflowNodeTitle(node)}</strong>
            <small>{detailLines[0]}</small>
            {meta ? <span className="workflowNodeMeta">{meta}</span> : null}
          </>
        )}
      </span>
    </button>
  );
}

function WorkflowAudioStage({
  nodes,
  jobStatus,
  selectedNodeId,
  onSelectNode,
  onRegenerateAudio,
  regenerateDisabled
}: {
  nodes: WorkflowAuditNode[];
  jobStatus: WorkflowJob['status'];
  selectedNodeId?: string;
  onSelectNode: (nodeId: string) => void;
  onRegenerateAudio?: () => void;
  regenerateDisabled?: boolean;
}) {
  const doneCount = nodes.filter((node) => node.status === 'done').length;
  const regenerateLabel = doneCount === nodes.length ? 'Regenerate all' : 'Generate missing';
  return (
    <AudioProgressStage
      items={nodes.map((node) => ({
        id: node.id,
        title: workflowNodeTitle(node),
        detail: workflowNodeDetail(node),
        status: node.status
      }))}
      state={jobStatus === 'running' ? 'running' : 'idle'}
      selectedItemId={selectedNodeId}
      onSelectItem={onSelectNode}
      action={onRegenerateAudio ? {
        label: regenerateLabel,
        loading: regenerateDisabled,
        onClick: onRegenerateAudio
      } : undefined}
    />
  );
}

function workflowConversationFact(node: WorkflowAuditNode, conversationId: string): unknown {
  return objectValue(objectValue(node.output)?.factsByConversationId)?.[conversationId];
}

function workflowConversationFactText(node: WorkflowAuditNode, conversationId: string): string | undefined {
  const fact = workflowConversationFact(node, conversationId);
  const record = objectValue(fact);
  if (!record) return undefined;
  if (typeof record.verdict === 'string') return `#${conversationId.replace(/^convo-0*/, '')}: ${record.verdict} — ${String(record.rationale ?? '')}`;
  if (typeof record.selected === 'string') return `#${conversationId.replace(/^convo-0*/, '')} → ${record.selected} · ${String(record.selectedQuality ?? '')}`;
  if (typeof record.candidate === 'string') return `#${conversationId.replace(/^convo-0*/, '')}: ${record.candidate}${record.selected === true ? ' - selected' : ' - not selected'}`;
  if (Array.isArray(record.admissible)) return `#${conversationId.replace(/^convo-0*/, '')}: ${record.admissible.join(', ')} admissible`;
  if (typeof record.quality === 'string') return `#${conversationId.replace(/^convo-0*/, '')}: ${record.quality}`;
  if (typeof record.outOfVocabularyUniqueCount === 'number') {
    const currentSetCount = typeof record.currentSetUniqueCount === 'number' ? ` - ${record.currentSetUniqueCount} current-set words` : '';
    return `#${conversationId.replace(/^convo-0*/, '')}: ${record.outOfVocabularyUniqueCount} OOV${currentSetCount}`;
  }
  const text = formatAuditValue(record).replace(/\s+/g, ' ');
  return text.length > 90 ? `${text.slice(0, 87)}…` : text;
}

// useLayoutEffect on the client (measure before paint to avoid a one-column
// flash), useEffect on the server (renderToStaticMarkup runs no effects anyway).
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function useMeasuredWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useIsomorphicLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

const SNAKE_CELL_MIN = 220;
const SNAKE_CELL_MAX = 280;
const SNAKE_COL_GAP = 44;

export type SnakeArrow = 'right' | 'left' | 'down' | 'none';

// Boustrophedon placement: even rows flow left→right, odd rows right→left so the
// odd row's first cell sits directly under the even row's last cell and the
// connector just turns straight down. `total` is needed so the final cell emits
// no trailing arrow.
export function snakeCellPlacement(index: number, cols: number, total: number): { column: number; row: number; arrow: SnakeArrow } {
  const row = Math.floor(index / cols);
  const posInRow = index % cols;
  const rightward = row % 2 === 0;
  const column = rightward ? posInRow + 1 : cols - posInRow;
  const arrow: SnakeArrow = index === total - 1 ? 'none' : posInRow === cols - 1 ? 'down' : rightward ? 'right' : 'left';
  return { column, row: row + 1, arrow };
}

export function snakeColumnCount(width: number, cellCount: number): number {
  if (width <= 0 || cellCount <= 0) return 1;
  const fit = Math.max(1, Math.min(cellCount, Math.floor((width + SNAKE_COL_GAP) / (SNAKE_CELL_MIN + SNAKE_COL_GAP))));
  // Balance the rows: keep the row count at its minimum for the fitting width,
  // then even out the columns so the flow wraps into a symmetrical block
  // (6 cells across a 4-wide fit become 3+3, not 4+2) rather than a long row
  // with a short stub.
  const rows = Math.ceil(cellCount / fit);
  return Math.max(1, Math.ceil(cellCount / rows));
}

// Fit as many fixed-width cells per row as the measured width allows; below one
// cell's min width the grid overflows its lane, which surfaces the lane's
// horizontal scrollbar.
function WorkflowSnakeFlow({ cells }: { cells: Array<{ key: string; content: ReactNode }> }) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const cols = snakeColumnCount(width, cells.length);
  return (
    <div ref={ref} className="workflowSnake" style={{ gridTemplateColumns: `repeat(${cols}, minmax(${SNAKE_CELL_MIN}px, ${SNAKE_CELL_MAX}px))` }}>
      {cells.map((cell, index) => {
        const placement = snakeCellPlacement(index, cols, cells.length);
        return (
          <div className="workflowSnakeCell" data-arrow={placement.arrow} key={cell.key} style={{ gridColumn: placement.column, gridRow: placement.row }}>
            {cell.content}
          </div>
        );
      })}
    </div>
  );
}

function WorkflowStageLane({
  stage,
  nodes,
  live = false,
  selectedNodeId,
  selectedConversationId,
  onSelectNode,
  rollup
}: {
  stage: 'initial' | 'balance';
  nodes: WorkflowAuditNode[];
  live?: boolean;
  selectedNodeId?: string;
  selectedConversationId?: string;
  onSelectNode: (nodeId: string) => void;
  rollup?: string;
}) {
  const renderNode = (node: WorkflowAuditNode) => {
    const traceFact = selectedConversationId ? workflowConversationFactText(node, selectedConversationId) : undefined;
    return <WorkflowNodeButton key={node.id} node={node} selected={selectedNodeId === node.id} onSelect={() => onSelectNode(node.id)} traceFact={traceFact} dimmed={Boolean(selectedConversationId && !traceFact)} />;
  };
  const renderPass = (pass: 1 | 2) => {
    const passNodes = nodes.filter((node) => node.callKind !== 'final-label' && (node.pass ?? 1) === pass).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    if (!passNodes.length) return null;
    // A pass that never ran collapses to a summary row. During a live run only
    // an explicitly all-skipped pass collapses, so upcoming ghost steps stay
    // visible; once the job settles, stale pending ghosts count as skipped.
    const anyRan = passNodes.some((node) => !['skipped', 'pending'].includes(node.status));
    const anySkipped = passNodes.some((node) => node.status === 'skipped');
    const allSkipped = !anyRan && anySkipped && (!live || passNodes.every((node) => node.status === 'skipped'));
    const repairs = passNodes.filter((node) => node.callKind === 'repair-candidate');
    const regular = passNodes.filter((node) => node.callKind !== 'repair-candidate');
    const before = regular.filter((node) => !['dominance-gates', 'pick'].includes(node.callKind ?? ''));
    const after = regular.filter((node) => ['dominance-gates', 'pick'].includes(node.callKind ?? ''));
    // An isolated skipped node renders as a full, greyed-out card in place; only
    // a whole skipped pass collapses into the summary row below.
    const cells: Array<{ key: string; content: ReactNode }> = [
      ...before.map((node) => ({ key: node.id, content: renderNode(node) })),
      ...(repairs.length ? [{
        key: `${stage}:pass${pass}:fork`,
        content: <div className="workflowRepairFork"><span>parallel</span>{repairs.map((node) => renderNode(node))}</div>
      }] : []),
      ...after.map((node) => ({ key: node.id, content: renderNode(node) }))
    ];
    const sequence = <WorkflowSnakeFlow cells={cells} />;
    if (allSkipped) {
      return (
        <details className={`workflowPassRow pass${pass} workflowPassCollapsed`} key={pass}>
          <summary>
            <span className="workflowPassLabel">{pass === 2 ? '↳ Pass 2 · re-roll' : `Stage ${stage} steps`} · skipped</span>
            <small>{pluralize(passNodes.length, 'step')} skipped — expand to inspect</small>
          </summary>
          {sequence}
        </details>
      );
    }
    return (
      <div className={`workflowPassRow pass${pass}`} key={pass}>
        {pass === 2 ? <span className="workflowPassLabel">↳ Pass 2 · re-roll</span> : null}
        {sequence}
      </div>
    );
  };
  return (
    <section className="workflowStageLane" aria-label={`${stage} quality-control stage`}>
      <header>
        <span className="eyebrow">Stage {stage === 'initial' ? '1' : '2'} · {stage}</span>
        <strong>{rollup ?? 'Waiting for stage results'}</strong>
      </header>
      {renderPass(1)}
      {renderPass(2)}
      {nodes.some((node) => node.callKind === 'final-label') ? (
        <div className="workflowPassRow workflowCompatibilityFinalLabel">
          <span className="workflowPassLabel">Legacy terminal label pass</span>
          <WorkflowSnakeFlow cells={nodes
            .filter((node) => node.callKind === 'final-label')
            .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
            .map((node) => ({ key: node.id, content: renderNode(node) }))} />
        </div>
      ) : null}
    </section>
  );
}

interface TraceOption {
  value: string;
  number?: number | string;
  title: string;
  quality?: 'good' | 'okay' | 'bad';
  repaired?: boolean;
  dropped?: boolean;
}

function TraceOptionContent({ option }: { option: TraceOption }) {
  if (!option.value) return <span className="traceAll">{option.title}</span>;
  return (
    <>
      <b className="traceNumber">{option.number ?? '–'}</b>
      <span className="traceTitle">{option.title}</span>
      {option.quality ? <em className={`conversationQualityChip ${option.quality}`}>{option.quality}</em> : null}
      {option.repaired ? <em className="traceChip repaired">repaired</em> : null}
      {option.dropped ? <em className="traceChip dropped">dropped</em> : null}
    </>
  );
}

function TraceSelect({
  options,
  value,
  onChange
}: {
  options: TraceOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [open, options, value]);

  function commit(next: string) {
    onChange(next || undefined as unknown as string);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') { setOpen(false); return; }
    if (!open && (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setOpen(true); return; }
    if (!open) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => Math.min(options.length - 1, index + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); }
    else if (event.key === 'Enter') { event.preventDefault(); commit(options[activeIndex]?.value ?? ''); }
  }

  return (
    <div className="traceSelect" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Conversation trace"
        className="traceSelectButton"
        onClick={() => setOpen((previous) => !previous)}
        onKeyDown={onKeyDown}
        type="button"
      >
        <span className="traceSelectValue"><TraceOptionContent option={selected} /></span>
        <ChevronDown className="traceSelectCaret" size={16} />
      </button>
      <ul className="traceSelectPopup" hidden={!open} role="listbox" tabIndex={-1}>
        {options.map((option, index) => (
          <li
            aria-selected={option.value === value}
            className={`${index === activeIndex ? 'active' : ''} ${option.value === value ? 'selected' : ''}`}
            key={option.value || 'all'}
            onClick={() => commit(option.value)}
            onMouseEnter={() => setActiveIndex(index)}
            role="option"
          >
            <TraceOptionContent option={option} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function WorkflowConversationRail({
  conversations,
  dropped,
  selectedConversationId,
  onSelectConversation
}: {
  conversations: PracticeConversation[];
  dropped: Array<{ conversationId?: string; number?: number; title?: string }>;
  selectedConversationId?: string;
  onSelectConversation: (conversationId?: string) => void;
}) {
  const options: TraceOption[] = [
    { value: '', title: 'All conversations' },
    ...conversations.map((conversation) => ({
      value: conversation.id,
      number: conversation.number,
      title: conversation.title,
      quality: conversation.quality,
      repaired: conversation.qualityDecision === 'repair'
    })),
    ...dropped.filter((conversation) => conversation.conversationId).map((conversation) => ({
      value: conversation.conversationId as string,
      number: conversation.number,
      title: conversation.title ?? (conversation.conversationId as string),
      dropped: true
    }))
  ];
  return (
    <div className="workflowTraceBar">
      <div className="workflowTraceControl">
        <span className="eyebrow">Trace</span>
        <TraceSelect options={options} value={selectedConversationId ?? ''} onChange={(next) => onSelectConversation(next || undefined)} />
      </div>
      <p>Follow one conversation through the pipeline: each step re-annotates with what happened to it (verdict, repair, pick), untouched steps dim, and its version history with diffs opens below the graph.</p>
    </div>
  );
}

function HighlightedAuditLine({ text, words }: { text: string; words: string[] }) {
  const matchedWords = words.filter(Boolean).sort((a, b) => b.length - a.length);
  if (!matchedWords.length) return <>{text}</>;
  const escaped = matchedWords.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'g');
  return <>{text.split(pattern).map((part, index) => matchedWords.includes(part) ? <mark key={`${part}-${index}`}>{part}</mark> : <Fragment key={`${part}-${index}`}>{part}</Fragment>)}</>;
}

function WorkflowKindDetails({ node, conversationId }: { node: WorkflowAuditNode; conversationId?: string }) {
  const output = objectValue(node.output);
  const details = objectValue(output?.details);
  const facts = objectValue(output?.factsByConversationId);
  const visibleFacts = conversationId && facts?.[conversationId] ? { [conversationId]: facts[conversationId] } : facts;
  const rows = node.callKind === 'triage' && Array.isArray(details?.verdicts) ? details.verdicts
    : node.callKind === 'pick' && Array.isArray(details?.picks) ? details.picks
    : undefined;
  if (['generation', 'reroll'].includes(node.callKind ?? '') && isPracticeConversationList(output?.conversations)) {
    const conversations = output.conversations.filter((conversation) => !conversationId || conversation.id === conversationId);
    return (
      <section className="workflowKindDetails">
        <h4>Parsed conversations</h4>
        <div className="workflowParsedConversations">
          {conversations.map((conversation) => <details key={conversation.id}><summary><strong>{conversation.id}</strong><span>{conversation.title}</span><ConversationQualityBadge quality={conversation.quality} /><em>{conversation.outOfVocabularyAudit.length} OOV</em></summary><div>{conversation.text.map((line, index) => <p key={index}><b>{line.speaker}</b><span><HighlightedAuditLine text={line.japanese} words={conversation.outOfVocabularyAudit} /></span></p>)}</div></details>)}
        </div>
      </section>
    );
  }
  if (node.callKind === 'repair-candidate' && Array.isArray(details?.comparisons)) {
    const comparisons = details.comparisons.map(objectValue).filter(Boolean).filter((item) => !conversationId || item?.conversationId === conversationId);
    return (
      <section className="workflowKindDetails">
        <h4>Before / after transcript</h4>
        <div className="workflowDiffList">
          {comparisons.map((comparison, index) => {
            const before = Array.isArray(comparison?.before) ? comparison.before.map(objectValue) : [];
            const after = Array.isArray(comparison?.after) ? comparison.after.map(objectValue) : [];
            const lineCount = Math.max(before.length, after.length);
            return <details key={String(comparison?.conversationId ?? index)}><summary>{String(comparison?.conversationId ?? '')}</summary><div>{Array.from({ length: lineCount }, (_, lineIndex) => {
              const beforeText = String(before[lineIndex]?.japanese ?? '');
              const afterText = String(after[lineIndex]?.japanese ?? '');
              return <p className={beforeText === afterText ? 'unchanged' : 'changed'} key={lineIndex}>{beforeText && beforeText !== afterText ? <del>{beforeText}</del> : null}{afterText ? <ins>{afterText}</ins> : null}</p>;
            })}</div></details>;
          })}
        </div>
      </section>
    );
  }
  if (node.callKind === 'final-audit') {
    const report = objectValue(details);
    const thresholds = Array.isArray(report?.thresholds) ? report.thresholds.map(objectValue).filter(Boolean) : [];
    return (
      <section className="workflowKindDetails">
        <h4>Threshold report</h4>
        <div className="workflowDecisionTable">
          {thresholds.map((threshold, index) => <div key={String(threshold?.id ?? index)}><strong>{String(threshold?.id ?? '')}</strong><span>{String(threshold?.detail ?? '')}</span><em className={String(threshold?.outcome ?? '')}>{String(threshold?.outcome ?? '')}</em></div>)}
        </div>
      </section>
    );
  }
  if (rows?.length) {
    const filtered = conversationId ? rows.filter((row) => objectValue(row)?.conversationId === conversationId) : rows;
    return (
      <section className="workflowKindDetails">
        <h4>{node.callKind === 'triage' ? 'Conversation verdicts' : 'Pick decisions'}</h4>
        <div className="workflowDecisionTable">
          {filtered.map((row, index) => {
            const record = objectValue(row);
            return <details key={String(record?.conversationId ?? index)}><summary><strong>{String(record?.conversationId ?? '')}</strong><span>{String(record?.verdict ?? record?.selected ?? '')}</span><em>{String(record?.selectedQuality ?? '')}</em></summary><pre>{formatAuditValue(record)}</pre></details>;
          })}
        </div>
      </section>
    );
  }
  if (visibleFacts && Object.keys(visibleFacts).length) {
    return <section className="workflowKindDetails"><h4>Per-conversation evidence</h4><pre>{formatAuditValue(visibleFacts)}</pre></section>;
  }
  return null;
}

function WorkflowJourney({ nodes, conversationId, onSelectNode }: { nodes: WorkflowAuditNode[]; conversationId: string; onSelectNode: (nodeId: string) => void }) {
  const touched = nodes.filter((node) => workflowConversationFact(node, conversationId));
  return (
    <section className="workflowJourney" aria-label={`Journey for ${conversationId}`}>
      <header><span className="eyebrow">Conversation trace</span><h4>{conversationId}</h4></header>
      {touched.length ? touched.map((node) => {
        const details = objectValue(objectValue(node.output)?.details);
        const comparison = Array.isArray(details?.comparisons)
          ? details.comparisons.map(objectValue).find((item) => item?.conversationId === conversationId)
          : undefined;
        const before = Array.isArray(comparison?.before) ? comparison.before.map(objectValue) : [];
        const after = Array.isArray(comparison?.after) ? comparison.after.map(objectValue) : [];
        const fact = objectValue(workflowConversationFact(node, conversationId));
        return (
          <div className="workflowJourneyStep" key={node.id}>
            <button onClick={() => onSelectNode(node.id)} type="button"><span>{node.callKind?.replaceAll('-', ' ')}</span><strong>{workflowConversationFactText(node, conversationId)}</strong>{fact?.rationale ? <small>{String(fact.rationale)}</small> : null}</button>
            {comparison ? <div className="workflowJourneyDiff">{Array.from({ length: Math.max(before.length, after.length) }, (_, index) => {
              const previous = String(before[index]?.japanese ?? '');
              const next = String(after[index]?.japanese ?? '');
              return previous === next ? null : <p key={index}>{previous ? <del>{previous}</del> : null}{next ? <ins>{next}</ins> : null}</p>;
            })}</div> : null}
          </div>
        );
      }) : <p>No per-call facts were recorded for this conversation.</p>}
    </section>
  );
}

function synthesizeLegacyAuditNodes(nodes: WorkflowAuditNode[]): WorkflowAuditNode[] {
  const synthesized = nodes.flatMap((node): WorkflowAuditNode[] => {
    if (node.kind === 'audio') return [node];
    const exchanges = workflowNodeExchanges(node);
    if (!exchanges.length) return [node];
    const generation = exchanges.find((exchange) => !isRepairExchange(exchange)) ?? exchanges[0];
    const repairs = exchanges.filter(isRepairExchange);
    const quality = llmExchangeStats(generation).vocabularyQuality;
    const baseTitle = node.kind === 'balancer' ? 'Balance' : 'Initial';
    const result: WorkflowAuditNode[] = [{
      ...node,
      id: `${node.id}:generate`,
      title: `${baseTitle} generation`,
      input: { ...objectValue(node.input), prompt: generation.prompt, model: generation.model },
      output: { exchange: generation, exchanges, conversations: workflowNodeConversations(node) }
    }];
    if (quality) {
      result.push({
        id: `${node.id}:vocab-audit`,
        kind: node.kind,
        title: `${baseTitle} vocabulary audit`,
        status: node.status,
        startedAt: generation.receivedAt,
        completedAt: generation.receivedAt,
        output: { vocabularyQuality: quality }
      });
    }
    if (repairs.length) {
      result.push({
        id: `${node.id}:repair`,
        kind: node.kind,
        title: `${baseTitle} repair`,
        status: repairs.at(-1)?.status === 'failed' ? 'error' : node.status,
        startedAt: repairs[0].requestedAt,
        completedAt: repairs.at(-1)?.receivedAt,
        input: { prompt: repairs[0].prompt, model: repairs[0].model },
        output: { exchange: repairs.at(-1), exchanges: repairs }
      });
    }
    return result;
  });
  return synthesized;
}

export function WorkflowAuditFlow({
  job,
  selectedNodeId,
  selectedConversationId,
  onSelectNode,
  onSelectConversation,
  onApprove,
  onRegenerateAudio,
  regenerateAudioDisabled,
  onRerunRepair,
  rerunRepairDisabled,
  onDiscard,
  wordMetadata
}: {
  job: WorkflowJob;
  selectedNodeId?: string;
  selectedConversationId?: string;
  onSelectNode: (nodeId: string) => void;
  onSelectConversation: (conversationId?: string) => void;
  onApprove?: () => void;
  onRegenerateAudio?: () => void;
  regenerateAudioDisabled?: boolean;
  onRerunRepair?: (nodeId: string) => void;
  rerunRepairDisabled?: boolean;
  onDiscard?: () => void;
  wordMetadata?: Map<string, StudioWordMetadata>;
}) {
  const [inputTab, setInputTab] = useState<'prompt' | 'settings'>('prompt');
  const [outputTab, setOutputTab] = useState<'response' | 'attempts' | 'metadata'>('response');
  // Opens only on an explicit node click (or a deep link that named a node at
  // mount); the auto-follow effect below moves the selection without popping
  // the dialog open.
  const [inspectorOpen, setInspectorOpen] = useState(() => Boolean(selectedNodeId));
  const outputDetailsRef = useRef<HTMLElement | null>(null);
  const isPerCallAudit = job.nodes.some((node) => Boolean(node.callKind));
  const inspectNode = useCallback((nodeId: string) => {
    onSelectNode(nodeId);
    setInspectorOpen(true);
  }, [onSelectNode]);
  // Auto-follow (default selection, live processing node) highlights the graph
  // without touching the URL, so it never leaves a `/n/<node>` deep link behind
  // that would re-open the modal on the next plain reload.
  const [autoFollowId, setAutoFollowId] = useState<string | undefined>(undefined);
  const displayNodes = useMemo(() => isPerCallAudit ? job.nodes : synthesizeLegacyAuditNodes(job.nodes), [isPerCallAudit, job.nodes]);
  const generator = displayNodes.find((node) => node.id === 'generator' || node.id === 'generator:generate');
  const balancer = displayNodes.find((node) => node.id === 'balancer' || node.id === 'balancer:generate');
  const initialNodes = displayNodes.filter((node) => node.stage === 'initial');
  const balanceNodes = displayNodes.filter((node) => node.stage === 'balance');
  const finalAuditNode = displayNodes.find((node) => node.callKind === 'final-audit');
  const audioNodes = displayNodes.filter((node) => node.kind === 'audio');
  const legacyTextNodes = displayNodes.filter((node) => node.kind !== 'audio');
  const highlightNodeId = selectedNodeId ?? autoFollowId;
  const highlightNode = highlightNodeId ? displayNodes.find((node) => node.id === highlightNodeId) : undefined;
  const selectedNode = selectedNodeId ? displayNodes.find((node) => node.id === selectedNodeId) : undefined;
  const selectedInput = splitPromptFromAuditValue(selectedNode?.input);
  const selectedOutput = splitResponseFromAuditValue(selectedNode?.output);
  const selectedExchanges = workflowNodeExchanges(selectedNode);
  const selectedHasRepairFailure = workflowNodeHasRepairFailure(selectedNode);
  const selectedCanRerunRepair = workflowNodeCanRerunRepair(selectedNode) && Boolean(onRerunRepair);
  const selectedAudioUrl = selectedNode?.kind === 'audio' ? workflowAudioUrl(selectedNode) : undefined;
  const selectedOutputMetadata = selectedNode?.kind === 'audio'
    ? omitStringPropertiesDeep(selectedNode.output, ['audioUrl'])
    : selectedNode?.error && selectedOutput.value !== undefined
      ? { error: selectedNode.error, output: selectedOutput.value }
      : selectedOutput.value;
  const selectedPrompt = selectedInput.prompt;
  const isOutputPending = selectedNode?.status === 'pending' || selectedNode?.status === 'processing';
  const finalAudit = job.run?.finalTextAudit ?? job.run?.workflowAudit?.finalTextAudit;
  const dropped = [
    ...(finalAudit?.stages.initial.dropped ?? []),
    ...(finalAudit?.stages.balance?.dropped ?? [])
  ];
  const initialRollup = finalAudit ? `${finalAudit.stages.initial.acceptedCount} accepted · ${finalAudit.stages.initial.picks.length} repaired · ${finalAudit.stages.initial.rerollGeneratedCount} re-rolled` : undefined;
  const balanceRollup = finalAudit?.stages.balance ? `${finalAudit.stages.balance.acceptedCount} accepted · ${finalAudit.stages.balance.picks.length} repaired · ${finalAudit.stages.balance.rerollGeneratedCount} re-rolled` : undefined;

  useEffect(() => {
    const processing = displayNodes.find((node) => node.status === 'processing');
    if (job.status === 'running' && processing) {
      setAutoFollowId(processing.id);
      return;
    }
    if (selectedNodeId) return;
    const fallback = job.status === 'failed'
      ? displayNodes.find((node) => node.status === 'error')
      : job.status === 'complete' || job.status === 'paused'
        ? finalAuditNode ?? generator ?? displayNodes.find((node) => node.status === 'done')
        : processing ?? displayNodes.find((node) => node.status !== 'pending');
    if (fallback) setAutoFollowId(fallback.id);
  }, [displayNodes, finalAuditNode, generator, job.status, selectedNodeId]);

  useEffect(() => {
    setInputTab('prompt');
    setOutputTab(!isPerCallAudit && selectedHasRepairFailure && selectedExchanges.length ? 'attempts' : 'response');
  }, [isPerCallAudit, selectedHasRepairFailure, selectedExchanges.length, selectedNodeId]);

  useEffect(() => {
    if (!inspectorOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setInspectorOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inspectorOpen]);

  function openRepairDetails() {
    setOutputTab('attempts');
    window.requestAnimationFrame(() => {
      outputDetailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  return (
    <section className={`workflowPanel ${job.status}`} aria-label="End-to-end workflow audit">
      <div className="workflowHeader">
        <div>
          <p className="eyebrow">{isPerCallAudit ? 'Per-call generation audit' : 'Legacy LLM audit'}</p>
          <h3>Generation quality flow</h3>
          <p>{finalAudit ? `${finalAudit.acceptedCount} of ${finalAudit.requestedCount} requested accepted` : `${pluralize(job.primaryConversationCount, 'primary conversation')} + ${pluralize(job.balanceConversationCount, 'balanced conversation')}`} · {workflowAudioSummary(job.audioRequestedCount)}</p>
        </div>
        <div className="workflowHeaderActions">
          {onDiscard ? (
            <button className="auditToggle danger" onClick={onDiscard} type="button">
              <Trash2 size={15} />
              Discard
            </button>
          ) : null}
          <span className={`workflowJobStatus ${job.status}`}>
            {job.status === 'running' ? <LoaderCircle className="spin" size={15} /> : job.status === 'failed' ? <CircleAlert size={15} /> : <Sparkles size={15} />}
            {job.status}
          </span>
        </div>
      </div>

      {isPerCallAudit ? (
        <div className="workflowAuditGraph">
          <WorkflowConversationRail conversations={job.run?.conversations ?? []} dropped={dropped} selectedConversationId={selectedConversationId} onSelectConversation={onSelectConversation} />
          <WorkflowStageLane stage="initial" nodes={initialNodes} live={job.status === 'running'} selectedNodeId={highlightNode?.id} selectedConversationId={selectedConversationId} onSelectNode={inspectNode} rollup={initialRollup} />
          <WorkflowStageLane stage="balance" nodes={balanceNodes} live={job.status === 'running'} selectedNodeId={highlightNode?.id} selectedConversationId={selectedConversationId} onSelectNode={inspectNode} rollup={balanceRollup} />
          {finalAuditNode ? (
            <section className={`workflowFinalAuditBand ${finalAudit?.outcome ?? finalAuditNode.status}`}>
              <WorkflowNodeButton node={finalAuditNode} selected={highlightNode?.id === finalAuditNode.id} onSelect={() => inspectNode(finalAuditNode.id)} traceFact={selectedConversationId ? workflowConversationFactText(finalAuditNode, selectedConversationId) : undefined} />
              {job.status === 'paused' && finalAudit ? (
                <div className="workflowReviewGate">
                  <div><span className="eyebrow">Paused for review</span><strong>{finalAudit.acceptedCount} of {finalAudit.requestedCount} accepted · {finalAudit.shortfallCount} short</strong></div>
                  <div className="workflowReviewThresholds">{finalAudit.thresholds.map((threshold) => <span className={threshold.outcome} key={threshold.id}>{threshold.id.replaceAll('-', ' ')}: {threshold.outcome}</span>)}</div>
                  <div className="workflowReviewActions"><button onClick={onApprove} type="button">Approve &amp; generate audio</button>{onDiscard ? <button className="danger" onClick={onDiscard} type="button">Discard run</button> : null}<button onClick={() => inspectNode(finalAuditNode.id)} type="button">Full report</button></div>
                </div>
              ) : null}
            </section>
          ) : null}
          <div className={job.status === 'paused' ? 'workflowAudioLane awaitingReview' : 'workflowAudioLane'}>
            {job.status === 'paused' ? <span className="workflowAwaitingReview">Awaiting review</span> : null}
            <WorkflowAudioStage nodes={audioNodes} jobStatus={job.status} selectedNodeId={highlightNode?.id} onSelectNode={inspectNode} onRegenerateAudio={onRegenerateAudio} regenerateDisabled={regenerateAudioDisabled} />
          </div>
          {selectedConversationId ? <WorkflowJourney nodes={job.nodes} conversationId={selectedConversationId} onSelectNode={inspectNode} /> : null}
        </div>
      ) : (
        <>
          <div className="workflowLegacyNotice"><Info size={16} /> Recorded before per-call quality auditing. This reduced graph is synthesized from stored exchanges.</div>
          <div className="workflowGraph">
            <div className="workflowLegacySequence">
              {legacyTextNodes.map((node, index) => <Fragment key={node.id}>{index ? <span className="workflowArrow" aria-hidden="true">&rarr;</span> : null}<WorkflowNodeButton node={node} selected={highlightNode?.id === node.id} onSelect={() => inspectNode(node.id)} /></Fragment>)}
            </div>
            <span className="workflowArrow branch" aria-hidden="true">&rarr;</span>
            <WorkflowAudioStage nodes={audioNodes} jobStatus={job.status} selectedNodeId={highlightNode?.id} onSelectNode={inspectNode} onRegenerateAudio={onRegenerateAudio} regenerateDisabled={regenerateAudioDisabled} />
          </div>
        </>
      )}

      {selectedNode && inspectorOpen ? (
        <div className="modalOverlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setInspectorOpen(false);
          }
        }}>
        <section className="workflowInspector workflowInspectorModal" role="dialog" aria-modal="true" aria-label={`${workflowNodeTitle(selectedNode)} audit details`}>
          <div className="workflowInspectorHeader">
            <span>{workflowNodeTitle(selectedNode)}</span>
            <span className="workflowInspectorHeaderMeta">
              <small>{workflowStatusText(selectedNode.status)}</small>
              <button className="iconButton" onClick={() => setInspectorOpen(false)} title="Close" type="button">
                <X size={18} />
              </button>
            </span>
          </div>
          {selectedHasRepairFailure ? (
            <div className="workflowRepairInspectorNotice" role="status">
              <RepairFailureIcon size={20} />
              <div>
                <strong>Repair failed</strong>
                <span>The latest repair attempt failed or did not improve this batch. Check the Repair tab below for the model exchange, outcome, and rerun option.</span>
              </div>
              {selectedExchanges.length ? (
                <button onClick={openRepairDetails} type="button">
                  Open Repair
                </button>
              ) : null}
            </div>
          ) : null}
          {isPerCallAudit && selectedCanRerunRepair ? (
            <div className="workflowScopedRepairAction">
              <span>Rerun the scoped two-candidate repair flow for this saved step.</span>
              <button disabled={rerunRepairDisabled} onClick={() => onRerunRepair?.(selectedNode.id)} type="button">Rerun repair</button>
            </div>
          ) : null}
          <div className="auditGrid">
            <div className="auditMeta">
              <span>Started</span>
              <strong>{formatAuditTime(selectedNode.startedAt)}</strong>
            </div>
            <div className="auditMeta">
              <span>Finished</span>
              <strong>{formatAuditTime(selectedNode.completedAt)}</strong>
            </div>
            <div className="auditMeta">
              <span>Kind</span>
              <strong>{selectedNode.kind}</strong>
            </div>
            <div className="auditMeta">
              <span>Status</span>
              <strong>{workflowStatusText(selectedNode.status)}</strong>
            </div>
          </div>
          <WorkflowKindDetails node={selectedNode} conversationId={selectedConversationId} />
          <section className="workflowTabbedBlock" aria-label="Input details">
            <div className="workflowTabbedHeader">
              <span>Input</span>
              <WorkflowTabs
                active={inputTab}
                onChange={setInputTab}
                tabs={[
                  { id: 'prompt', label: 'Prompt' },
                  { id: 'settings', label: 'Settings' }
                ]}
              />
            </div>
            <div className="workflowTabPane">
              {inputTab === 'prompt' ? (
                selectedPrompt ? (
                  <pre className="workflowPromptText">{selectedPrompt}</pre>
                ) : selectedNode.status === 'pending' ? (
                  <PendingAuditOutput label="Waiting for prompt" />
                ) : (
                  <EmptyAuditPane label="No prompt text was captured for this node." />
                )
              ) : selectedInput.value === undefined ? (
                <PendingAuditOutput label="Waiting for settings" />
              ) : (
                <pre>{formatAuditValue(selectedInput.value)}</pre>
              )}
            </div>
          </section>
          <section className="workflowTabbedBlock" aria-label="Output details" ref={outputDetailsRef}>
            <div className="workflowTabbedHeader">
              <span>Output</span>
              <WorkflowTabs
                active={outputTab}
                onChange={setOutputTab}
                tabs={[
                  { id: 'response', label: 'Response' },
                  ...(!isPerCallAudit && selectedExchanges.length ? [{ id: 'attempts' as const, label: selectedHasRepairFailure ? 'Repair' : 'Attempts', warning: selectedHasRepairFailure }] : []),
                  { id: 'metadata', label: 'Metadata' }
                ]}
              />
            </div>
            <div className="workflowTabPane">
              {outputTab === 'response' ? (
                selectedAudioUrl ? (
                  <WorkflowAudioResponse audioUrl={selectedAudioUrl} />
                ) : selectedOutput.response ? (
                  <pre className="workflowPromptText">{selectedOutput.response}</pre>
                ) : selectedNode.error ? (
                  <pre>{selectedNode.error}</pre>
                ) : isOutputPending ? (
                  <PendingAuditOutput label="Waiting for model output" />
                ) : (
                  <EmptyAuditPane label="No response text was returned for this node." />
                )
              ) : outputTab === 'attempts' ? (
                <WorkflowExchangeAttempts
                  exchanges={selectedExchanges}
                  onRerunRepair={selectedNode && selectedCanRerunRepair ? () => onRerunRepair?.(selectedNode.id) : undefined}
                  rerunRepairDisabled={rerunRepairDisabled}
                />
              ) : selectedOutputMetadata === undefined && isOutputPending ? (
                <PendingAuditOutput label="Waiting for output metadata" />
              ) : selectedOutputMetadata === undefined ? (
                <EmptyAuditPane label="No output metadata was captured for this node." />
              ) : (
                <pre>{formatAuditValue(selectedOutputMetadata)}</pre>
              )}
            </div>
          </section>
          <WorkflowStatsPanel selectedNode={selectedNode} generatorNode={generator} wordMetadata={wordMetadata} />
        </section>
        </div>
      ) : null}
    </section>
  );
}

function AuditStats({ stats }: { stats: unknown }) {
  const record = stats && typeof stats === 'object' ? stats as Record<string, unknown> : null;
  const balanceContext = record?.libraryBalanceContext;
  const rest = record
    ? Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'libraryBalanceContext'))
    : null;
  const hasRest = rest ? Object.keys(rest).length > 0 : false;

  return (
    <>
      {!record || hasRest ? (
        <div className="auditBlock">
          <span>Stats</span>
          <pre>{JSON.stringify(record ? rest : stats, null, 2)}</pre>
        </div>
      ) : null}
      {balanceContext ? (
        <details className="auditBlock auditRevealBlock">
          <summary>Show library exposure context</summary>
          <pre>{JSON.stringify(balanceContext, null, 2)}</pre>
        </details>
      ) : null}
    </>
  );
}

function AuditLog({ exchange, fallbackLabel }: { exchange?: LlmExchange; fallbackLabel?: string }) {
  const output = formatAuditOutput(exchange?.output);
  const outputError = exchange?.status === 'failed' ? exchange.error : undefined;
  const isWaitingForOutput = !output && !outputError;

  return (
    <details className="auditLog">
      <summary>
        <span>LLM exchange audit</span>
        <small>{exchange ? `${exchange.label} - ${exchange.status}` : `${fallbackLabel ?? 'LLM'} - preparing prompt`}</small>
      </summary>
      <div className="auditGrid">
        <div className="auditMeta">
          <span>Provider</span>
          <strong>{exchange?.provider ?? 'Pending'}</strong>
        </div>
        <div className="auditMeta">
          <span>Model</span>
          <strong>{exchangeModelName(exchange, fallbackLabel)}</strong>
        </div>
        <div className="auditMeta">
          <span>Sent</span>
          <strong>{formatAuditTime(exchange?.requestedAt)}</strong>
        </div>
        <div className="auditMeta">
          <span>Received</span>
          <strong>{formatAuditTime(exchange?.receivedAt)}</strong>
        </div>
      </div>

      {exchange?.instructions ? (
        <div className="auditBlock">
          <span>Instructions</span>
          <pre>{exchange.instructions}</pre>
        </div>
      ) : null}

      <div className="auditBlock">
        <span>Prompt</span>
        <pre>{exchange?.prompt ?? 'Preparing the exact prompt on the server.'}</pre>
      </div>

      <div className="auditBlock">
        <span>Output</span>
        {isWaitingForOutput ? (
          <div className="auditPending" role="status">
            <LoaderCircle className="spin" size={18} />
            <strong>Waiting for LLM response</strong>
          </div>
        ) : (
          <pre>{output ?? outputError ?? 'No output returned.'}</pre>
        )}
      </div>

      {exchange?.stats ? <AuditStats stats={exchange.stats} /> : null}
    </details>
  );
}

function AuditAudioActionPanel({
  run,
  disabled,
  onTryMaxAudio
}: {
  run: PracticeRun;
  disabled?: boolean;
  onTryMaxAudio: () => void;
}) {
  const doneCount = runAudioReadyCount(run);
  const totalCount = run.conversations.length;

  return (
    <section className="auditAudioAction" aria-label="Audio generation">
      <span className="workflowNodeIcon">
        {disabled ? <RefreshCw className="spin" size={18} /> : <Headphones size={18} />}
      </span>
      <div>
        <strong>Generated Audio</strong>
        <small>{doneCount} of {totalCount} audio conversations done</small>
      </div>
      <button className="workflowAudioRefreshButton" disabled={disabled} onClick={onTryMaxAudio} type="button">
        {disabled ? <RefreshCw className="spin" size={14} /> : <RefreshCw size={14} />}
        Generate missing
      </button>
    </section>
  );
}

function LoadingPanel({ session }: { session: GenerationSession }) {
  return (
    <section className={`agentPanel ${session.status}`} aria-live="polite">
      <div className="agentHero">
        <div className="agentAvatar">
          {session.status === 'failed' ? <CircleAlert size={24} /> : <Bot size={24} />}
        </div>
        <div>
          <p className="eyebrow">Generation request</p>
          <h3>{session.status === 'failed' ? 'Generation failed' : session.title}</h3>
          <p>{session.detail}</p>
        </div>
        <span className={`agentStatus ${session.status}`}>
          {session.status === 'running' ? <LoaderCircle className="spin" size={15} /> : <CircleAlert size={15} />}
          {session.status}
        </span>
      </div>
      <div className="loaderStrip">
        {session.status === 'running' ? <LoaderCircle className="spin" size={22} /> : <CircleAlert size={22} />}
        <span>{session.status === 'running' ? 'Waiting for the LLM response and saving the generated run.' : session.error}</span>
      </div>
      <AuditLog exchange={session.exchange} fallbackLabel={session.textModelLabel} />
    </section>
  );
}

export function GenerateModal({
  state,
  sets,
  textModels,
  busy,
  preflightError,
  onChange,
  onClose,
  onSubmit
}: {
  state: GenerateModalState;
  sets: SetSummary[];
  textModels: TextModelInfo[];
  busy: BusyAction;
  preflightError?: string | null;
  onChange: (state: GenerateModalState) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const selectedSet = sets.find((item) => item.set === state.setNumber);
  const judgeModels = textModels.some((model) => model.id === 'codex:gpt-5.6-sol')
    ? textModels
    : [...textModels, { id: 'codex:gpt-5.6-sol', provider: 'codex' as const, model: 'gpt-5.6-sol', label: 'GPT-5.6-Sol (recommended)', source: 'fallback' as const }];
  const conversationCount = Number(state.conversationCount);
  const isPreflighting = busy === 'preflight';
  const generatorLabel = textModels.find((model) => model.id === state.textModelId)?.label ?? state.textModelId;
  const judgeLabel = judgeModels.find((model) => model.id === state.judgeModelId)?.label ?? state.judgeModelId;
  const minConversationCount = RUN_CONVERSATION_COUNT_RANGE.min;
  const placeholder = `Select ${formatCountRange(RUN_CONVERSATION_COUNT_RANGE)}`;
  const canSubmit = busy === null
    && Number.isInteger(conversationCount)
    && conversationCount >= minConversationCount
    && conversationCount <= RUN_CONVERSATION_COUNT_RANGE.max
    && state.textModelId.length > 0
    && state.judgeModelId.length > 0;

  return (
    <div className="modalOverlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && busy === null) {
        onClose();
      }
    }}>
      <section className="generateModal" role="dialog" aria-modal="true" aria-labelledby="generate-modal-title">
        <div className="modalHeader">
          <div>
            <p className="eyebrow">Generation settings</p>
            <h2 id="generate-modal-title">Start a run</h2>
          </div>
          <button className="iconButton" onClick={onClose} disabled={busy !== null} title="Close" type="button">
            <X size={18} />
          </button>
        </div>

        <div className="modalFormGrid">
          <label>
            <span>Set</span>
            <select value={state.setNumber} disabled={busy !== null} onChange={(event) => onChange({ ...state, setNumber: Number(event.target.value) })}>
              {sets.map((set) => (
                <option key={set.set} value={set.set}>
                  Set {set.set}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Conversations</span>
            <input
              min={minConversationCount}
              max={RUN_CONVERSATION_COUNT_RANGE.max}
              placeholder={placeholder}
              type="number"
              disabled={busy !== null}
              value={state.conversationCount}
              onChange={(event) => onChange({ ...state, conversationCount: event.target.value })}
            />
          </label>

          <label className="modalWideField">
            <span>Generator model</span>
            <select value={state.textModelId} disabled={busy !== null} onChange={(event) => onChange({ ...state, textModelId: event.target.value })}>
              <option value="" disabled>Select a model</option>
              <TextModelOptionGroups models={textModels} />
            </select>
          </label>
          <label className="modalWideField">
            <span>Judge model</span>
            <select value={state.judgeModelId} disabled={busy !== null} onChange={(event) => onChange({ ...state, judgeModelId: event.target.value })}>
              <TextModelOptionGroups models={judgeModels} />
            </select>
          </label>
        </div>

        <div className="setMeta">
          <strong>{selectedSet?.theme ?? 'Vocabulary set'}</strong>
          <span>{selectedSet ? `${selectedSet.cumulativeCount} allowed words through Set ${selectedSet.set}` : 'Loading vocab'}</span>
        </div>

        <fieldset className="generateModes">
          <legend>Run type</legend>
          {GENERATE_RUN_MODES.map((mode) => (
            <label className={state.runMode === mode.id ? 'generateModeOption active' : 'generateModeOption'} key={mode.id}>
              <input
                checked={state.runMode === mode.id}
                disabled={busy !== null}
                name="generate-run-mode"
                onChange={() => onChange({ ...state, runMode: mode.id })}
                type="radio"
                value={mode.id}
              />
              <span>
                <strong>{mode.label}</strong>
                <small>{mode.description}</small>
              </span>
            </label>
          ))}
        </fieldset>

        {isPreflighting ? (
          <div className="preflightStatus" role="status" aria-live="polite">
            <LoaderCircle className="spin" size={20} />
            <span>
              <strong>Checking generator and judge</strong>
              <small>{generatorLabel} · {judgeLabel}. This can take up to one minute.</small>
            </span>
          </div>
        ) : preflightError ? (
          <div className="errorBanner" role="alert">
            <CircleAlert size={18} />
            <span>{preflightError}</span>
          </div>
        ) : null}

        <div className="modalActions">
          <button className="secondaryButton" onClick={onClose} disabled={busy !== null} type="button">
            Cancel
          </button>
          <button className="primaryButton" onClick={onSubmit} disabled={!canSubmit} type="button">
            {isPreflighting || busy === 'generate' || busy === 'workflow' ? <RefreshCw className="spin" size={18} /> : <Sparkles size={18} />}
            {isPreflighting ? 'Checking models…' : 'Generate'}
          </button>
        </div>
      </section>
    </div>
  );
}

function BalanceModal({
  state,
  setNumber,
  textModels,
  busy,
  suggestedCount,
  onChange,
  onClose,
  onSubmit
}: {
  state: BalanceModalState;
  setNumber: number;
  textModels: TextModelInfo[];
  busy: BusyAction;
  suggestedCount?: number;
  onChange: (state: BalanceModalState) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const trimmedCount = state.conversationCount.trim();
  const parsedCount = trimmedCount ? Number(trimmedCount) : undefined;
  const countValid = parsedCount === undefined
    || (Number.isInteger(parsedCount) && parsedCount >= BALANCE_CONVERSATION_COUNT_RANGE.min && parsedCount <= BALANCE_CONVERSATION_COUNT_RANGE.max);
  const canSubmit = busy === null && state.textModelId.length > 0 && countValid;

  return (
    <div className="modalOverlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && busy === null) {
        onClose();
      }
    }}>
      <section className="generateModal" role="dialog" aria-modal="true" aria-labelledby="balance-modal-title">
        <div className="modalHeader">
          <div>
            <p className="eyebrow">Library balancing</p>
            <h2 id="balance-modal-title">Balance Set {setNumber}</h2>
          </div>
          <button className="iconButton" onClick={onClose} disabled={busy !== null} title="Close" type="button">
            <X size={18} />
          </button>
        </div>

        <div className="modalFormGrid">
          <label className="modalWideField">
            <span>Model</span>
            <select value={state.textModelId} onChange={(event) => onChange({ ...state, textModelId: event.target.value })}>
              <option value="" disabled>Select a model</option>
              <TextModelOptionGroups models={textModels} />
            </select>
          </label>

          <label className="modalWideField">
            <span>Conversations</span>
            <input
              min={BALANCE_CONVERSATION_COUNT_RANGE.min}
              max={BALANCE_CONVERSATION_COUNT_RANGE.max}
              placeholder={suggestedCount ? `Suggested ${suggestedCount}` : 'Auto'}
              type="number"
              value={state.conversationCount}
              onChange={(event) => onChange({ ...state, conversationCount: event.target.value })}
            />
            <small className="modalFieldHint">Leave blank to use the suggested count from the balance plan.</small>
          </label>
        </div>

        <fieldset className="generateModes">
          <legend>Balancing strategy</legend>
          {BALANCE_STRATEGIES.map((strategy) => (
            <label className={state.strategy === strategy.id ? 'generateModeOption active' : 'generateModeOption'} key={strategy.id}>
              <input
                checked={state.strategy === strategy.id}
                name="balance-strategy"
                onChange={() => onChange({ ...state, strategy: strategy.id })}
                type="radio"
                value={strategy.id}
              />
              <span>
                <strong>{strategy.label}</strong>
                <small>{strategy.description}</small>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="modalActions">
          <button className="secondaryButton" onClick={onClose} disabled={busy !== null} type="button">
            Cancel
          </button>
          <button className="primaryButton" onClick={onSubmit} disabled={!canSubmit} type="button">
            {busy === 'generate-complement' ? <RefreshCw className="spin" size={18} /> : <Sparkles size={18} />}
            Balance
          </button>
        </div>
      </section>
    </div>
  );
}

function QualityBreakdown({ conversations }: { conversations: readonly PracticeConversation[] }) {
  const quality = conversationQualityCounts(conversations);
  const items = (['good', 'okay', 'bad'] as const)
    .map((kind) => ({ kind, label: kind === 'okay' ? 'Okay' : `${kind[0].toUpperCase()}${kind.slice(1)}`, count: quality[kind] }))
    .filter((item) => item.count > 0);
  const labeledCount = items.reduce((total, item) => total + item.count, 0);

  if (labeledCount === 0) return null;

  return (
    <section className="qualityBreakdown" aria-label="Conversation quality breakdown">
      {items.map((item) => (
        <span className={`qualityBreakdownSegment ${item.kind}`} key={item.kind} style={{ flexGrow: item.count }}>
          <strong>{item.count}</strong>
          <span>{item.label}</span>
        </span>
      ))}
    </section>
  );
}

function RunCardHeader({ createdAt, contextLabel, libraryCount = 0, statusIcon }: { createdAt: string; contextLabel: string; libraryCount?: number; statusIcon?: ReactNode }) {
  return (
    <span className="runCardHeader">
      <time className="runCardTimestamp" dateTime={createdAt}>
        {statusIcon ?? <Clock size={13} aria-hidden />}
        {formatRunHistoryTitle(createdAt)}
      </time>
      <span className="runCardMeta">
        <RunLibraryBadge count={libraryCount} />
        <span className="runCardContextBadge">{contextLabel}</span>
      </span>
    </span>
  );
}

function AnalyticsPanel({ analytics, setNumber, label, wordMetadata, conversations }: { analytics: PracticeRun['analytics']; setNumber: number; label: string; wordMetadata: Map<string, StudioWordMetadata>; conversations?: readonly PracticeConversation[] }) {
  return (
    <section className="analyticsPanel" aria-label={label}>
      {conversations ? <QualityBreakdown conversations={conversations} /> : null}
      <div className="analyticsCard">
        <span>Current Set Missing</span>
        <strong>{analytics.currentSetMissingCount}</strong>
        <p>{analytics.currentSetUsedCount} of {analytics.currentSetTotal} Set {setNumber} words used</p>
        <div className="miniChips">
          {analytics.currentSetMissingWords.length === 0 ? <span>None</span> : null}
          {analytics.currentSetMissingWords.slice(0, 40).map((word) => (
            <StudioWordChip key={word} word={word} metadata={wordMetadata.get(word)} />
          ))}
          {analytics.currentSetMissingWords.length > 40 ? <span>+{analytics.currentSetMissingWords.length - 40}</span> : null}
        </div>
      </div>

      <div className="analyticsCard">
        <span>Allowed Vocab Used</span>
        <strong>{analytics.allowedVocabUsedPercentage}%</strong>
        <p>{analytics.allowedVocabUsedCount} of {analytics.allowedVocabTotal} words from Sets 1-{setNumber}</p>
      </div>

      <div className="analyticsCard">
        <span>Out-of-Allowed Vocabulary</span>
        <strong>{analytics.outOfAllowedCount}</strong>
        <p>True content words not found in allowed Sets 1-{setNumber}</p>
        <div className="miniChips warning">
          {analytics.outOfAllowedWords.length === 0 ? <span>None</span> : null}
          {analytics.outOfAllowedWords.map((word) => (
            <StudioWordChip key={word} word={word} metadata={wordMetadata.get(word)} />
          ))}
        </div>
      </div>
    </section>
  );
}

function metadataWithConversationReferences(
  base: Map<string, StudioWordMetadata>,
  conversations: PracticeConversation[]
): Map<string, StudioWordMetadata> {
  const metadata = new Map(base);
  for (const conversation of conversations) {
    for (const reference of conversation.vocabularyReferences ?? []) {
      const value: StudioWordMetadata = {
        japanese: reference.japanese,
        reading: reference.reading,
        meaning: reference.meaning,
        set: reference.setNumber ?? 0,
        partOfSpeech: reference.partOfSpeech ?? '',
        category: reference.category ?? '',
        classification: reference.kind === 'future_set' ? 'Future set' : 'Outside course'
      };
      metadata.set(reference.surface, value);
      metadata.set(reference.japanese, value);
    }
  }
  return metadata;
}

function StudioApp() {
  const [studioRoute, setStudioRoute] = useState(parseStudioRoute);
  const [sets, setSets] = useState<SetSummary[]>([]);
  const [vocabulary, setVocabulary] = useState<VocabItem[]>([]);
  const vocabularyMetadata = useMemo(() => new Map<string, StudioWordMetadata>(
    vocabulary.map((item) => [item.japanese, item])
  ), [vocabulary]);
  const [runs, setRuns] = useState<PracticeRun[]>([]);
  const [studioJobs, setStudioJobs] = useState<StudioJob[]>([]);
  const [runShells, setRunShells] = useState<StudioRunShellSummary[]>([]);
  const [studioToasts, setStudioToasts] = useState<StudioToast[]>([]);
  const [studioRealtimeConnected, setStudioRealtimeConnected] = useState(false);
  const [librarySets, setLibrarySets] = useState<CuratedSet[]>([]);
  const [recommendations, setRecommendations] = useState<LibraryRecommendations | null>(null);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [aiCurationReview, setAiCurationReview] = useState<AiCurationReview | null>(null);
  const [aiCurationHistory, setAiCurationHistory] = useState<AiCurationReviewSummary[]>([]);
  const [aiCurationLoading, setAiCurationLoading] = useState(false);
  const [aiCurationContextLoading, setAiCurationContextLoading] = useState(false);
  const [aiCurationHistoryLoading, setAiCurationHistoryLoading] = useState(false);
  const [aiCurationTargetCount, setAiCurationTargetCount] = useState('10');
  const [aiCurationSelectedRunIds, setAiCurationSelectedRunIds] = useState<string[]>([]);
  const [currentRunEvidence, setCurrentRunEvidence] = useState<ConversationCurationEvidenceMap>({});
  const [currentLibraryEvidence, setCurrentLibraryEvidence] = useState<ConversationCurationEvidenceMap>({});
  const [historicalQualityReviews, setHistoricalQualityReviews] = useState<QualityReviewMap>({});
  const [libraryBalance, setLibraryBalance] = useState<LibraryBalancePlan | null>(null);
  const [libraryBalanceLoading, setLibraryBalanceLoading] = useState(false);
  const [balanceModal, setBalanceModal] = useState<BalanceModalState | null>(null);
  const [practicePublishStatus, setPracticePublishStatus] = useState<PracticeLibraryPublishStatus | null>(null);
  const [currentRun, setCurrentRun] = useState<PracticeRun | null>(null);
  const [boardMode, setBoardMode] = useState<BoardMode>(studioRoute.boardMode);
  const [textModels, setTextModels] = useState<TextModelInfo[]>([]);
  const [textModelId, setTextModelId] = useState('gemini');
  const [setNumber, setSetNumber] = useState(studioRoute.boardMode === 'runs' ? 1 : studioRoute.setNumber);
  const [conversationCount, setConversationCount] = useState(4);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [generationSession, setGenerationSession] = useState<GenerationSession | null>(null);
  const [generateModal, setGenerateModal] = useState<GenerateModalState | null>(null);
  const [generatePreflightError, setGeneratePreflightError] = useState<string | null>(null);
  const [addAllProgress, setAddAllProgress] = useState<AddAllProgress | null>(null);
  const [workflowJob, setWorkflowJob] = useState<WorkflowJob | null>(null);
  const [focusedShellJobId, setFocusedShellJobId] = useState<string | null>(null);
  const [selectedWorkflowNodeId, setSelectedWorkflowNodeId] = useState<string | undefined>();
  const [selectedWorkflowConversationId, setSelectedWorkflowConversationId] = useState<string | undefined>();
  const [auditOpen, setAuditOpen] = useState(studioRoute.boardMode === 'runs' && studioRoute.auditOpen);
  const [revealedAnswers, setRevealedAnswers] = useState<Record<string, boolean>>({});
  const [revealedTranslations, setRevealedTranslations] = useState<Record<string, boolean>>({});
  const [audioStates, setAudioStates] = useState<Record<string, AudioPlaybackState>>({});
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const addAllPauseRequestedRef = useRef(false);
  const addAllJobIdRef = useRef<string | undefined>(undefined);
  const addAllCandidateBySourceRef = useRef(new Map<string, string>());
  const pendingJobFocusRef = useRef<StudioJob | null>(null);
  const seenStudioEventIds = useRef(new Set<string>());
  const studioJobWaiters = useRef(new Map<string, (job: StudioJob) => void>());
  const initialStudioHydrationComplete = useRef(false);
  const aiCurationScopeSetRef = useRef<number | null>(null);

  const currentSet = useMemo(() => sets.find((item) => item.set === setNumber), [sets, setNumber]);
  const textModelOptions = useMemo(() => {
    if (!currentRun || textModels.some((model) => model.id === currentRun.textModel.id)) {
      return textModels;
    }
    return [currentRun.textModel, ...textModels];
  }, [currentRun, textModels]);
  const currentTextModel = useMemo(() => textModelOptions.find((model) => model.id === textModelId), [textModelOptions, textModelId]);
  const currentLibrarySet = useMemo(() => librarySets.find((item) => item.setNumber === setNumber), [librarySets, setNumber]);
  const currentLibraryBalance = libraryBalance?.setNumber === setNumber ? libraryBalance : null;
  const filteredRuns = useMemo(() => runs.filter((run) => run.setNumber === setNumber), [runs, setNumber]);
  const filteredRunShells = useMemo(() => runShells.filter((run) => run.setNumber === setNumber), [runShells, setNumber]);
  const activeShellJobId = workflowJob?.id ?? focusedShellJobId;
  const activeShellVisible = Boolean(activeShellJobId && filteredRunShells.some((shell) => shell.jobId === activeShellJobId));
  const activeStudioJobs = useMemo(() => studioJobs.filter((job) => ['queued', 'running', 'pausing'].includes(job.status)), [studioJobs]);
  const currentCuratedLibrarySets = useMemo(() => currentLibrarySet && currentLibrarySet.conversations.length > 0 ? [currentLibrarySet] : [], [currentLibrarySet]);
  const libraryCountBySourceRun = useMemo(() => libraryCountsBySourceRun(librarySets), [librarySets]);
  const currentRecommendations = recommendations?.setNumber === setNumber ? recommendations : null;
  const currentAiCurationReview = aiCurationReview?.setNumber === setNumber ? aiCurationReview : null;
  const aiCurationEligibleRuns = currentRecommendations?.eligibleRuns ?? currentAiCurationReview?.snapshot.eligibleRuns ?? [];
  const aiCurationAvailableRunIdSet = useMemo(() => new Set(aiCurationEligibleRuns.map((run) => run.runId)), [aiCurationEligibleRuns]);
  const aiCurationUnavailableSelectedRunIds = aiCurationSelectedRunIds.filter((runId) => !aiCurationAvailableRunIdSet.has(runId));
  const aiCurationCandidateCount = selectedCurationCandidateCount(aiCurationEligibleRuns, aiCurationSelectedRunIds);
  const latestAiCurationReviewId = aiCurationHistory[0]?.id;
  const isHistoricalAiCurationReview = Boolean(currentAiCurationReview && latestAiCurationReviewId && currentAiCurationReview.id !== latestAiCurationReviewId);
  const currentAiCurationReconciliation = currentAiCurationReview?.reconciliation;
  const canAddCurrentAiCurationReview = Boolean(currentAiCurationReview?.status === 'complete'
    && currentAiCurationReview.result?.recommendations.length
    && (isHistoricalAiCurationReview
      ? currentAiCurationReconciliation?.actionable
      : !currentAiCurationReview.stale));
  const aiCurationAddActionLabel = isHistoricalAiCurationReview
    ? currentAiCurationReconciliation?.actionLabel ?? 'Add Remaining'
    : 'Add All';
  const displayedProjectedCoverage = isHistoricalAiCurationReview && currentAiCurationReconciliation
    ? currentAiCurationReconciliation.currentProjectedLeastCoveredWords
    : currentAiCurationReview?.result?.projectedLeastCoveredWords ?? [];
  const [projectedCoverageView, setProjectedCoverageView] = useState<'current' | 'original'>('current');
  useEffect(() => {
    setProjectedCoverageView('current');
  }, [currentAiCurationReview?.id]);
  const projectedCoverageWords = isHistoricalAiCurationReview && projectedCoverageView === 'original'
    ? currentAiCurationReview?.result?.projectedLeastCoveredWords ?? []
    : displayedProjectedCoverage;
  const aiCurationVisibleRecommendations = currentAiCurationReview?.result?.recommendations ?? [];
  const librarySourceRunDistribution = useMemo(() => sourceRunDistribution(
    currentLibrarySet?.conversations.map((conversation) => ({ sourceRunId: conversation.sourceRunId })) ?? [],
    runs,
    formatRunHistoryTitle,
    studioRunsRoute
  ), [currentLibrarySet?.conversations, runs]);
  const recommendationSourceRunDistribution = useMemo(() => sourceRunDistribution(
    currentRecommendations?.recommendations.map((recommendation) => ({
      sourceRunId: recommendation.sourceRunId,
      sourceRunCreatedAt: recommendation.sourceRunCreatedAt
    })) ?? [],
    runs,
    formatRunHistoryTitle,
    studioRunsRoute
  ), [currentRecommendations?.recommendations, runs]);
  const aiCurationSourceRunDistribution = useMemo(() => sourceRunDistribution(
    aiCurationVisibleRecommendations.map((recommendation) => {
      const candidate = currentAiCurationReview?.snapshot.candidates.find((item) => item.candidateKey === recommendation.candidateKey);
      return {
        sourceRunId: recommendation.sourceRunId,
        sourceRunCreatedAt: candidate?.sourceRunCreatedAt
      };
    }),
    runs,
    formatRunHistoryTitle,
    studioRunsRoute
  ), [aiCurationVisibleRecommendations, currentAiCurationReview?.snapshot.candidates, runs]);
  const sourceRunColorIndexBySurface = useMemo(() => ({
    library: new Map(librarySourceRunDistribution.map((row) => [row.sourceRunId, row.colorIndex])),
    recommendations: new Map(recommendationSourceRunDistribution.map((row) => [row.sourceRunId, row.colorIndex])),
    aiCuration: new Map(aiCurationSourceRunDistribution.map((row) => [row.sourceRunId, row.colorIndex]))
  }), [librarySourceRunDistribution, recommendationSourceRunDistribution, aiCurationSourceRunDistribution]);
  const leastCoveredWordSet = useMemo(() => new Set(currentRecommendations?.leastCoveredWords.map((word) => word.japanese) ?? []), [currentRecommendations]);
  const showRunContent = Boolean(boardMode === 'runs' && currentRun && currentRun.setNumber === setNumber && !generationSession && !workflowJob);
  const showLibraryContent = Boolean(boardMode === 'library' && !generationSession);
  const showRecommendationsContent = Boolean(boardMode === 'recommendations' && !generationSession);
  const showAiCurationContent = Boolean(boardMode === 'ai-curation' && !generationSession);
  const currentExchanges = currentRun?.llmExchanges ?? [];
  const currentExchange = currentExchanges[0];
  const savedWorkflowJob = useMemo(() => workflowJobForRun(currentRun), [currentRun]);
  const visibleWorkflowJob = workflowJob ?? (auditOpen ? savedWorkflowJob : null);

  function applyRunGeneratorDefaults(run: PracticeRun) {
    setSetNumber(run.setNumber);
    setTextModelId(run.textModel.id);
  }

  async function refreshStudioSnapshot() {
    const payload = await api<{ snapshot: StudioSnapshot }>('/api/studio/snapshot');
    setRuns((current) => payload.snapshot.runs.map((run) => {
      const existing = current.find((item) => item.id === run.id);
      return existing && existing.updatedAt > run.updatedAt ? existing : run;
    }));
    setStudioJobs((current) => payload.snapshot.jobs.map((job) => {
      const existing = current.find((item) => item.id === job.id);
      return existing && existing.revision > job.revision ? existing : job;
    }));
    setRunShells(payload.snapshot.runSummaries.filter((summary): summary is StudioRunShellSummary => summary.kind === 'job'));
    setCurrentRun((previous) => previous
      ? payload.snapshot.runs.find((run) => run.id === previous.id) ?? previous
      : previous);
  }

  function dismissStudioToast(id: string) {
    setStudioToasts((current) => current.filter((toast) => toast.id !== id));
  }

  // Keeps the run-shell list live from job updates instead of depending solely on
  // snapshot refreshes, which can silently miss a beat on transient fetch failures.
  function applyJobToRunShells(job: StudioJob) {
    if (!['run-generation', 'workflow-generation', 'library-complement'].includes(job.kind)) return;
    setRunShells((current) => {
      if (job.status === 'cancelled' || job.status === 'succeeded') return current.filter((shell) => shell.jobId !== job.id);
      return current.map((shell) => shell.jobId === job.id && shell.updatedAt <= job.updatedAt
        ? {
            ...shell,
            status: job.status,
            stageLabel: job.stageLabel,
            progress: job.progress,
            updatedAt: job.updatedAt,
            resumable: job.status === 'paused' || job.status === 'interrupted' || job.status === 'failed'
          }
        : shell);
    });
  }

  async function commandStudioJob(jobId: string, command: 'pause' | 'resume' | 'cancel') {
    try {
      const payload = await api<{ job: StudioJob }>(`/api/studio/jobs/${encodeURIComponent(jobId)}/${command}`, { method: 'POST' });
      setStudioJobs((current) => [payload.job, ...current.filter((job) => job.id !== payload.job.id)]);
      applyJobToRunShells(payload.job);
      if (command === 'cancel') {
        if (focusedShellJobId === jobId) setFocusedShellJobId(null);
        if (workflowJob?.id === jobId) setWorkflowJob(null);
      }
      await refreshStudioSnapshot();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      const toastId = `job-command:${jobId}:${command}:${Date.now()}`;
      setStudioToasts((current) => [...current, {
        id: toastId,
        tone: 'error',
        title: command === 'pause' ? 'Pause failed' : command === 'resume' ? 'Resume failed' : 'Discard failed',
        detail: message
      }]);
      window.setTimeout(() => dismissStudioToast(toastId), 7000);
    }
  }

  function focusStudioJob(job: StudioJob) {
    pendingJobFocusRef.current = job;
    if (job.kind === 'add-all-audio') {
      navigateToStudioRoute(studioAiCurationRoute(job.setNumber ?? setNumber));
      return;
    }
    // A generation job carries its future runId before run.json exists; only
    // deep-link once the run is real, otherwise show its shell on the runs board.
    const runExists = Boolean(job.runId && runs.some((run) => run.id === job.runId));
    setFocusedShellJobId(runExists ? null : job.id);
    if (!runExists && job.setNumber) setSetNumber(job.setNumber);
    navigateToStudioRoute(studioRunsRoute(runExists ? job.runId : undefined));
  }

  function focusRunShell(shell: StudioRunShellSummary) {
    const job = studioJobs.find((item) => item.id === shell.jobId);
    if (job) {
      focusStudioJob(job);
      return;
    }
    setFocusedShellJobId(shell.jobId);
    navigateToStudioRoute(studioRunsRoute());
  }

  function discardGenerationShell(jobId: string) {
    if (!window.confirm('Discard this failed or paused generation? This removes the saved job shell and cannot be resumed afterward.')) return;
    void commandStudioJob(jobId, 'cancel');
  }

  async function waitForStudioJobClient(jobId: string): Promise<StudioJob> {
    const current = await api<{ job: StudioJob }>(`/api/studio/jobs/${encodeURIComponent(jobId)}`);
    if (['succeeded', 'failed', 'paused', 'interrupted', 'cancelled'].includes(current.job.status)) return current.job;
    return new Promise((resolve) => studioJobWaiters.current.set(jobId, resolve));
  }

  async function loadInitial() {
    const [setPayload, vocabularyPayload, snapshotPayload, modelPayload, libraryPayload, qualityReviewPayload] = await Promise.all([
      api<{ sets: SetSummary[] }>('/api/sets'),
      api<{ vocabulary: VocabItem[] }>('/api/vocabulary'),
      api<{ snapshot: StudioSnapshot }>('/api/studio/snapshot'),
      api<{ models: TextModelInfo[] }>('/api/text-models'),
      api<{ sets: CuratedSet[] }>('/api/library'),
      api<{ reviews: QualityReviewMap }>('/api/quality-reviews')
    ]);
    const runPayload = { runs: snapshotPayload.snapshot.runs };
    setSets(setPayload.sets);
    setVocabulary(vocabularyPayload.vocabulary);
    setRuns(runPayload.runs);
    setStudioJobs(snapshotPayload.snapshot.jobs);
    setRunShells(snapshotPayload.snapshot.runSummaries.filter((summary): summary is StudioRunShellSummary => summary.kind === 'job'));
    if (!initialStudioHydrationComplete.current) {
      const activeBeforeReload = new Set<string>(JSON.parse(sessionStorage.getItem('kiki-jlpt.studio.activeJobs') ?? '[]') as string[]);
      for (const job of snapshotPayload.snapshot.jobs.filter((item) => activeBeforeReload.has(item.id) && shouldNotifyJobEvent(item, 'hydration'))) {
        const toastId = `job:${job.id}:${job.status}`;
        const tone = job.status === 'succeeded' ? 'success' : job.status === 'failed' ? 'error' : 'warning';
        setStudioToasts((current) => current.some((toast) => toast.id === toastId) ? current : [...current, {
          id: toastId,
          tone,
          title: job.title,
          detail: job.stageLabel
        }]);
        window.setTimeout(() => dismissStudioToast(toastId), 7000);
      }
      initialStudioHydrationComplete.current = true;
    }
    setTextModels(modelPayload.models);
    setLibrarySets(libraryPayload.sets);
    setHistoricalQualityReviews(qualityReviewPayload.reviews);
    const routedRun = studioRoute.boardMode === 'runs' && studioRoute.runId
      ? runPayload.runs.find((run) => run.id === studioRoute.runId) ?? null
      : null;
    const defaultRun = studioRoute.boardMode === 'runs'
      ? routedRun ?? (!studioRoute.runId ? runPayload.runs[0] ?? null : null)
      : currentRun ?? runPayload.runs[0] ?? null;
    if (studioRoute.boardMode === 'runs' && defaultRun) {
      applyRunGeneratorDefaults(defaultRun);
    } else {
      setTextModelId((previous) => modelPayload.models.some((model) => model.id === previous) ? previous : 'gemini');
    }
    setCurrentRun((previous) => {
      if (studioRoute.boardMode === 'runs') return defaultRun;
      if (previous) return previous;
      return defaultRun;
    });
  }

  async function loadRecommendations(targetSet = setNumber) {
    setRecommendationsLoading(true);
    setError(null);
    setRecommendations((previous) => previous?.setNumber === targetSet ? previous : null);
    try {
      const payload = await api<{ recommendations: LibraryRecommendations }>(`/api/library/sets/${encodeURIComponent(targetSet)}/recommendations`);
      setRecommendations(payload.recommendations);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRecommendationsLoading(false);
    }
  }

  function applyAiCurationSettings(review: AiCurationReview) {
    setTextModelId(review.textModel.id);
    setAiCurationTargetCount(String(review.targetConversationCount ?? review.result?.recommendations.length ?? 1));
    setAiCurationSelectedRunIds(review.selectedRunIds ?? review.snapshot.selectedRunIds ?? [...new Set(review.snapshot.candidates.map((candidate) => candidate.sourceRunId))]);
    aiCurationScopeSetRef.current = review.setNumber;
  }

  async function loadAiCurationHistory(targetSet = setNumber): Promise<AiCurationReview | null> {
    const payload = await api<{ reviews: AiCurationReviewSummary[]; latestReview: AiCurationReview | null }>(
      `/api/library/sets/${encodeURIComponent(targetSet)}/ai-curation/history`
    );
    setAiCurationHistory(payload.reviews);
    setAiCurationReview(payload.latestReview);
    if (payload.latestReview) applyAiCurationSettings(payload.latestReview);
    return payload.latestReview;
  }

  async function openAiCurationHistoryReview(reviewId: string) {
    if (currentAiCurationReview?.id === reviewId) return;
    setAiCurationHistoryLoading(true);
    setError(null);
    try {
      const payload = await api<{ review: AiCurationReview }>(
        `/api/library/sets/${encodeURIComponent(setNumber)}/ai-curation/${encodeURIComponent(reviewId)}`
      );
      setAiCurationReview(payload.review);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setAiCurationHistoryLoading(false);
    }
  }

  async function loadRunEvidence(runId: string) {
    const payload = await api<{ run: PracticeRun; evidenceByConversationId: ConversationCurationEvidenceMap }>(`/api/runs/${encodeURIComponent(runId)}`);
    if (currentRun?.id === runId) setCurrentRunEvidence(payload.evidenceByConversationId);
  }

  async function loadLibraryEvidence(targetSet = setNumber) {
    const payload = await api<{ set: CuratedSet; evidenceByConversationId: ConversationCurationEvidenceMap }>(`/api/library/sets/${encodeURIComponent(targetSet)}`);
    if (targetSet !== setNumber) return;
    setCurrentLibraryEvidence(payload.evidenceByConversationId);
    setLibrarySets((existing) => [payload.set, ...existing.filter((item) => item.setNumber !== targetSet)].sort((a, b) => a.setNumber - b.setNumber));
  }

  async function runAiCuration(retry = false) {
    const targetConversationCount = Number(aiCurationTargetCount);
    if (aiCurationSelectedRunIds.length === 0 || aiCurationUnavailableSelectedRunIds.length > 0) {
      setError(aiCurationUnavailableSelectedRunIds.length > 0
        ? 'Remove unavailable generated runs before starting curation.'
        : 'Select at least one generated run.');
      return;
    }
    if (!Number.isInteger(targetConversationCount) || targetConversationCount < 1 || targetConversationCount > aiCurationCandidateCount) {
      setError(`Portfolio size must be an integer from 1 through ${aiCurationCandidateCount}.`);
      return;
    }
    setAiCurationLoading(true);
    setError(null);
    try {
      const reviewPath = retry && currentAiCurationReview
        ? `/api/library/sets/${encodeURIComponent(setNumber)}/ai-curation/${encodeURIComponent(currentAiCurationReview.id)}/retry`
        : `/api/library/sets/${encodeURIComponent(setNumber)}/ai-curation`;
      const payload = await api<{ review: AiCurationReview }>(reviewPath, {
        method: 'POST',
        body: JSON.stringify({ textModelId, targetConversationCount, selectedRunIds: aiCurationSelectedRunIds })
      });
      setAiCurationReview(payload.review);
      setAiCurationHistory((previous) => [aiCurationReviewSummary(payload.review), ...previous.filter((review) => review.id !== payload.review.id)]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      await loadAiCurationHistory().catch(() => undefined);
    } finally {
      setAiCurationLoading(false);
    }
  }

  function updateAddAllItem(candidateKey: string, patch: Partial<AddAllProgressItem>) {
    setAddAllProgress((previous) => previous ? {
      ...previous,
      items: previous.items.map((item) => item.candidateKey === candidateKey ? { ...item, ...patch } : item)
    } : previous);
  }

  async function loadAddAllSourceRuns(recommendations: AiCurationRecommendation[]) {
    const runsById = new Map<string, PracticeRun>();
    const unavailableRunIds = new Set<string>();
    await Promise.all(Array.from(new Set(recommendations.map((recommendation) => recommendation.sourceRunId))).map(async (sourceRunId) => {
      try {
        const payload = await api<{ run: PracticeRun }>(`/api/runs/${encodeURIComponent(sourceRunId)}`);
        runsById.set(sourceRunId, payload.run);
      } catch {
        unavailableRunIds.add(sourceRunId);
      }
    }));
    return { runsById, unavailableRunIds };
  }

  function addAllProgressItems(
    recommendations: AiCurationRecommendation[],
    plan: ReturnType<typeof planAddAllRecommendations>
  ): AddAllProgressItem[] {
    return recommendations.map((recommendation) => {
      const item = plan.find((planItem) => planItem.candidateKey === recommendation.candidateKey);
      return {
        candidateKey: recommendation.candidateKey,
        title: recommendation.conversation.title,
        audioStatus: item?.sourceError ? 'error' : item?.audioReady ? 'done' : 'pending',
        libraryStatus: item?.libraryReady ? 'done' : 'pending',
        audioDetail: item?.audioReady ? 'Already generated' : undefined,
        libraryDetail: item?.libraryReady ? 'Already added' : undefined,
        error: item?.sourceError
      };
    });
  }

  function actionableAiCurationRecommendations(review: AiCurationReview): AiCurationRecommendation[] {
    const recommendations = review.result?.recommendations ?? [];
    const keysToAdd = review.reconciliation?.recommendationKeysToAdd;
    if (!keysToAdd) return recommendations;
    const keySet = new Set(keysToAdd);
    return recommendations.filter((recommendation) => keySet.has(recommendation.candidateKey));
  }

  async function openAddAllAiRecommendations() {
    const review = currentAiCurationReview;
    const recommendationsToAdd = review ? actionableAiCurationRecommendations(review) : [];
    if (!review || !canAddCurrentAiCurationReview || recommendationsToAdd.length === 0) return;

    setError(null);
    addAllPauseRequestedRef.current = false;
    setAddAllProgress({
      stage: 'preparing',
      title: `${aiCurationAddActionLabel} recommendations`,
      items: recommendationsToAdd.map((recommendation) => ({
        candidateKey: recommendation.candidateKey,
        title: recommendation.conversation.title,
        audioStatus: 'pending',
        libraryStatus: 'pending'
      }))
    });

    try {
      const initialSources = await loadAddAllSourceRuns(recommendationsToAdd);
      const initialPlan = planAddAllRecommendations(recommendationsToAdd, initialSources.runsById, initialSources.unavailableRunIds);
      setAddAllProgress({
        stage: initialPlan.some((item) => item.sourceError) ? 'failed' : 'ready',
        title: `${aiCurationAddActionLabel} recommendations`,
        error: initialPlan.some((item) => item.sourceError) ? 'Some source conversations could not be loaded. Nothing was added to Library; retry to recheck.' : undefined,
        items: addAllProgressItems(recommendationsToAdd, initialPlan)
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setAddAllProgress((previous) => previous ? { ...previous, stage: 'failed', error: message } : previous);
      setError(message);
    }
  }

  function pauseAddAllAiRecommendations() {
    if (addAllProgress?.stage !== 'audio') return;
    addAllPauseRequestedRef.current = true;
    setAddAllProgress((previous) => previous?.stage === 'audio' ? { ...previous, stage: 'pausing' } : previous);
    if (addAllJobIdRef.current) void commandStudioJob(addAllJobIdRef.current, 'pause');
  }

  async function runAddAllAiRecommendations() {
    const review = currentAiCurationReview;
    const recommendationsToAdd = review ? actionableAiCurationRecommendations(review) : [];
    const runnableStage = addAllProgress?.stage === 'ready' || addAllProgress?.stage === 'paused' || addAllProgress?.stage === 'failed';
    if (!review || !runnableStage || !canAddCurrentAiCurationReview || recommendationsToAdd.length === 0) return;

    setError(null);
    addAllPauseRequestedRef.current = false;
    setAddAllProgress((previous) => previous ? {
      ...previous,
      stage: 'audio',
      error: undefined,
      items: previous.items.map((item) => item.audioStatus === 'done' ? item : {
        ...item,
        audioStatus: 'pending',
        audioDetail: undefined,
        error: undefined
      })
    } : previous);

    try {
      const initialSources = await loadAddAllSourceRuns(recommendationsToAdd);
      const initialPlan = planAddAllRecommendations(recommendationsToAdd, initialSources.runsById, initialSources.unavailableRunIds);
      setAddAllProgress((previous) => previous ? {
        ...previous,
        stage: initialPlan.some((item) => item.sourceError) ? 'failed' : 'audio',
        error: initialPlan.some((item) => item.sourceError) ? 'Some source conversations could not be loaded. Nothing was added to Library; retry to recheck.' : undefined,
        items: addAllProgressItems(recommendationsToAdd, initialPlan)
      } : previous);

      if (initialPlan.some((item) => item.sourceError)) return;

      const queuedRecommendations = recommendationsToAdd.filter((recommendation) => {
        const item = initialPlan.find((planItem) => planItem.candidateKey === recommendation.candidateKey);
        return item && !item.audioReady;
      });
      let audioJob: StudioJob | undefined;
      if (queuedRecommendations.length > 0) {
        addAllCandidateBySourceRef.current = new Map(queuedRecommendations.map((recommendation) => [
          `${recommendation.sourceRunId}:${recommendation.sourceConversationId}`,
          recommendation.candidateKey
        ]));
        for (const recommendation of queuedRecommendations) {
          updateAddAllItem(recommendation.candidateKey, {
            audioStatus: 'pending',
            audioDetail: 'Queued',
            error: undefined
          });
        }
        const started = await api<{ job: StudioJob }>('/api/studio/audio-batches', {
          method: 'POST',
          body: JSON.stringify({
            idempotencyKey: makeSessionId(),
            setNumber,
            title: `Add All audio for Set ${setNumber}`,
            items: queuedRecommendations.map((recommendation) => ({
              runId: recommendation.sourceRunId,
              conversationId: recommendation.sourceConversationId
            }))
          })
        });
        audioJob = started.job;
        addAllJobIdRef.current = audioJob.id;
        setStudioJobs((current) => [audioJob!, ...current.filter((job) => job.id !== audioJob!.id)]);
        audioJob = await waitForStudioJobClient(audioJob.id);
        addAllJobIdRef.current = undefined;
        addAllCandidateBySourceRef.current.clear();
      }

      if (audioJob?.status === 'failed') {
        setAddAllProgress((previous) => previous ? {
          ...previous,
          stage: 'failed',
          error: 'Audio generation stopped after a failure. Nothing new was added to Library; retry to resume missing audio.'
        } : previous);
        await loadInitial();
        return;
      }

      if (addAllPauseRequestedRef.current || audioJob?.status === 'paused' || audioJob?.status === 'interrupted') {
        addAllPauseRequestedRef.current = false;
        setAddAllProgress((previous) => previous ? {
          ...previous,
          stage: 'paused',
          error: undefined
        } : previous);
        await loadInitial();
        return;
      }

      const reconciledSources = await loadAddAllSourceRuns(recommendationsToAdd);
      const reconciledPlan = planAddAllRecommendations(recommendationsToAdd, reconciledSources.runsById, reconciledSources.unavailableRunIds);
      const audioIncomplete = reconciledPlan.some((item) => item.sourceError || !item.audioReady);
      if (audioIncomplete) {
        setAddAllProgress((previous) => previous ? {
          ...previous,
          stage: 'failed',
          error: 'Audio readiness could not be confirmed for the complete portfolio. Nothing was added to Library; retry to recheck.',
          items: previous.items.map((progressItem) => {
            const item = reconciledPlan.find((planItem) => planItem.candidateKey === progressItem.candidateKey);
            if (!item) return progressItem;
            return {
              ...progressItem,
              audioStatus: item.sourceError ? 'error' : item.audioReady ? 'done' : 'skipped',
              audioDetail: item.audioReady ? progressItem.audioDetail ?? 'Already generated' : item.sourceError ? 'Source unavailable' : 'Audio not ready',
              error: item.sourceError
            };
          })
        } : previous);
        return;
      }

      setAddAllProgress((previous) => previous ? {
        ...previous,
        stage: 'library',
        error: undefined,
        items: previous.items.map((progressItem) => {
          const item = reconciledPlan.find((planItem) => planItem.candidateKey === progressItem.candidateKey);
          return item ? {
            ...progressItem,
            audioStatus: 'done',
            audioDetail: progressItem.audioDetail ?? 'Already generated',
            libraryStatus: item.libraryReady ? 'done' : 'pending',
            libraryDetail: item.libraryReady ? 'Already added' : undefined,
            error: undefined
          } : progressItem;
        })
      } : previous);
      let libraryFailed = false;
      for (const recommendation of recommendationsToAdd) {
        const planItem = reconciledPlan.find((item) => item.candidateKey === recommendation.candidateKey);
        if (planItem?.libraryReady) continue;
        updateAddAllItem(recommendation.candidateKey, { libraryStatus: 'processing', libraryDetail: 'Adding', error: undefined });
        try {
          await api<{ run: PracticeRun }>(
            `/api/runs/${encodeURIComponent(recommendation.sourceRunId)}/conversations/${encodeURIComponent(recommendation.sourceConversationId)}/library`,
            { method: 'POST' }
          );
          updateAddAllItem(recommendation.candidateKey, { libraryStatus: 'done', libraryDetail: 'Added', error: undefined });
        } catch (caught) {
          libraryFailed = true;
          updateAddAllItem(recommendation.candidateKey, {
            libraryStatus: 'error',
            libraryDetail: 'Failed',
            error: caught instanceof Error ? caught.message : String(caught)
          });
        }
      }

      setAddAllProgress((previous) => previous ? {
        ...previous,
        stage: libraryFailed ? 'failed' : 'complete',
        error: libraryFailed ? 'Some conversations could not be added. Retry to finish the portfolio.' : undefined
      } : previous);
      await Promise.all([loadInitial(), loadRecommendations(), loadAiCurationHistory(), loadLibraryBalance(), loadPracticePublishStatus()]);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setAddAllProgress((previous) => previous ? { ...previous, stage: 'failed', error: message } : previous);
      setError(message);
    }
  }

  function openAiCuration() {
    navigateToStudioRoute(studioAiCurationRoute(setNumber));
  }

  async function loadLibraryBalance(targetSet = setNumber) {
    setLibraryBalanceLoading(true);
    setError(null);
    try {
      const payload = await api<{ balance: LibraryBalancePlan }>(`/api/library/sets/${encodeURIComponent(targetSet)}/balance`);
      setLibraryBalance(payload.balance);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLibraryBalanceLoading(false);
    }
  }

  async function loadPracticePublishStatus() {
    const payload = await api<{ status: PracticeLibraryPublishStatus }>('/api/library/publish/status');
    setPracticePublishStatus(payload.status);
  }

  useEffect(() => {
    Promise.all([
      loadInitial(),
      loadPracticePublishStatus()
    ]).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, []);

  useEffect(() => {
    if (!initialStudioHydrationComplete.current) return;
    sessionStorage.setItem('kiki-jlpt.studio.activeJobs', JSON.stringify(activeStudioJobs.map((job) => job.id)));
  }, [activeStudioJobs]);

  useEffect(() => {
    let disposed = false;
    let events: EventSource | null = null;
    let retryTimer: number | undefined;
    const onJob = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as StudioEvent;
      if (!event.job || seenStudioEventIds.current.has(event.id)) return;
      seenStudioEventIds.current.add(event.id);
      const job = event.job;
      if (job.kind === 'audio-child' && job.runId && job.conversationId) {
        const candidateKey = addAllCandidateBySourceRef.current.get(`${job.runId}:${job.conversationId}`);
        if (candidateKey) {
          updateAddAllItem(candidateKey, job.status === 'succeeded'
            ? { audioStatus: 'done', audioDetail: 'Audio ready', error: undefined }
            : job.status === 'failed'
              ? { audioStatus: 'error', audioDetail: 'Audio failed', error: job.error }
              : job.status === 'paused' || job.status === 'interrupted'
                ? { audioStatus: 'paused', audioDetail: 'Paused', error: undefined }
                : job.status === 'cancelled'
                  ? { audioStatus: 'skipped', audioDetail: 'Discarded', error: undefined }
                  : job.status === 'running'
                    ? { audioStatus: 'processing', audioDetail: 'Generating audio', error: undefined }
                    : { audioStatus: 'pending', audioDetail: 'Queued', error: undefined });
        }
      }
      if (['succeeded', 'failed', 'paused', 'interrupted', 'cancelled'].includes(job.status)) {
        studioJobWaiters.current.get(job.id)?.(job);
        studioJobWaiters.current.delete(job.id);
      }
      setStudioJobs((current) => {
        const existing = current.find((item) => item.id === job.id);
        return existing && existing.revision >= job.revision
          ? current
          : [job, ...current.filter((item) => item.id !== job.id)];
      });
      applyJobToRunShells(job);
      if (job.workflow) {
        // Update the pipeline audit only when it is already showing this job.
        // A running workflow must not steal the foreground from wherever the
        // operator navigated - its tray/shell entry reopens the audit on demand.
        setWorkflowJob((current) => current?.id === job.id ? job.workflow ?? current : current);
      }
      if (shouldNotifyJobEvent(job, 'live')) {
        const tone = job.status === 'succeeded' ? 'success' : job.status === 'failed' ? 'error' : 'warning';
        const toastId = `job:${job.id}:${job.status}`;
        setStudioToasts((current) => current.some((toast) => toast.id === toastId) ? current : [
          ...current,
          { id: toastId, tone, title: job.title, detail: job.stageLabel }
        ]);
        window.setTimeout(() => dismissStudioToast(toastId), 7000);
      }
      void refreshStudioSnapshot().catch(() => undefined);
    };
    const onRun = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as StudioEvent;
      if (!event.run || seenStudioEventIds.current.has(event.id)) return;
      seenStudioEventIds.current.add(event.id);
      const run = event.run;
      setRuns((current) => {
        const existing = current.find((item) => item.id === run.id);
        return existing && existing.updatedAt >= run.updatedAt
          ? current
          : [run, ...current.filter((item) => item.id !== run.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
      setCurrentRun((current) => current?.id === run.id && current.updatedAt < run.updatedAt ? run : current);
    };
    const connect = () => {
      if (disposed) return;
      events = new EventSource('/api/studio/events');
      events.onopen = () => {
        setStudioRealtimeConnected(true);
        // Converge after every (re)connect: events emitted while disconnected
        // are gone, so the snapshot is the recovery mechanism.
        void refreshStudioSnapshot().catch(() => undefined);
      };
      events.onerror = () => {
        setStudioRealtimeConnected(false);
        void refreshStudioSnapshot().catch(() => undefined);
        // EventSource gives up permanently when a reconnect lands while the
        // API is restarting and the dev proxy answers with a non-stream
        // response; rebuild the connection ourselves.
        if (events?.readyState === EventSource.CLOSED) {
          events.close();
          retryTimer = window.setTimeout(connect, 2000);
        }
      };
      events.addEventListener('job', onJob as EventListener);
      events.addEventListener('run', onRun as EventListener);
    };
    connect();
    return () => {
      disposed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      events?.close();
    };
  }, []);

  useEffect(() => {
    const handleHashChange = () => setStudioRoute(parseStudioRoute());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    setBoardMode(studioRoute.boardMode);
    setGenerationSession(null);
    setWorkflowJob(null);
    setSelectedWorkflowNodeId(undefined);
    setSelectedWorkflowConversationId(studioRoute.boardMode === 'runs' ? studioRoute.conversationId : undefined);
    setEdit(null);
    if (studioRoute.boardMode !== 'runs' || studioRoute.runId) setFocusedShellJobId(null);

    if (studioRoute.boardMode === 'runs') {
      setAuditOpen(studioRoute.auditOpen);
      return;
    }

    setAuditOpen(false);
    setSetNumber(studioRoute.setNumber);
  }, [studioRoute]);

  useEffect(() => {
    // Restores the foreground UI for a background job clicked in the tray, after the
    // route change above has settled (it resets workflowJob/session state on navigation).
    const job = pendingJobFocusRef.current;
    if (!job) return;
    if (job.kind === 'add-all-audio') {
      if (boardMode !== 'ai-curation') return;
      if (addAllProgress) {
        pendingJobFocusRef.current = null;
        return;
      }
      const review = currentAiCurationReview;
      if (!review) return;
      pendingJobFocusRef.current = null;
      if (review.status === 'complete') void openAddAllAiRecommendations();
      return;
    }
    if (boardMode !== 'runs') return;
    pendingJobFocusRef.current = null;
    if (job.kind === 'workflow-generation' && job.workflow) setWorkflowJob(job.workflow);
  }, [boardMode, addAllProgress, currentAiCurationReview, studioRoute]);

  useEffect(() => {
    if (studioRoute.boardMode !== 'runs') return;
    if (!studioRoute.runId) {
      const nextRun = selectStudioRunForSet(runs, setNumber);
      if (currentRun?.id !== nextRun?.id) {
        if (nextRun) {
          applyRunGeneratorDefaults(nextRun);
        }
        setCurrentRun(nextRun);
      }
      return;
    }

    if (currentRun?.id === studioRoute.runId) return;
    const listedRun = runs.find((run) => run.id === studioRoute.runId);
    if (listedRun) {
      applyRunGeneratorDefaults(listedRun);
      setCurrentRun(listedRun);
      return;
    }

    const shell = runShells.find((summary) => summary.id === studioRoute.runId);
    if (shell) {
      setCurrentRun(null);
      setFocusedShellJobId(shell.jobId);
      const job = studioJobs.find((item) => item.id === shell.jobId);
      if (job?.workflow) setWorkflowJob(job.workflow);
      return;
    }

    setCurrentRun(null);
    refreshRun(studioRoute.runId).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [currentRun, runShells, runs, setNumber, studioJobs, studioRoute]);

  useEffect(() => {
    if (boardMode === 'recommendations' && !generationSession) {
      loadRecommendations().catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
      // Warm the AI curation snapshot in the background so opening AI Curate from the Queue
      // is instant. Most operators reach AI Curate via the Queue, and the server caches the
      // result, so this only does real work the first time or after candidates/library change.
      void loadAiCurationHistory().catch(() => undefined);
    }
  }, [boardMode, generationSession, setNumber]);

  useEffect(() => {
    if (boardMode !== 'ai-curation' || generationSession) return;
    // If a Queue-open prefetch already loaded this set's context, show it immediately and
    // refresh quietly instead of blanking the page and blocking on a spinner.
    const haveContextForSet = aiCurationReview?.setNumber === setNumber
      || aiCurationHistory.some((review) => review.setNumber === setNumber);
    if (!haveContextForSet) {
      setAiCurationContextLoading(true);
      setAiCurationHistory([]);
      setAiCurationReview(null);
    }
    Promise.all([loadRecommendations(), loadAiCurationHistory()])
      .then(() => setAiCurationContextLoading(false))
      .catch((caught) => {
        setAiCurationContextLoading(false);
        setError(caught instanceof Error ? caught.message : String(caught));
      });
    // aiCurationReview/aiCurationHistory are intentionally read but not deps: this should run
    // on navigation (boardMode/setNumber), not whenever a curation run updates those states.
  }, [boardMode, generationSession, setNumber]);

  useEffect(() => {
    if (boardMode !== 'ai-curation' || !currentRecommendations) return;
    if (aiCurationScopeSetRef.current === setNumber) return;
    aiCurationScopeSetRef.current = setNumber;
    setAiCurationSelectedRunIds(currentRecommendations.eligibleRuns.map((run) => run.runId));
  }, [boardMode, currentRecommendations?.eligibleRuns, setNumber]);

  useEffect(() => {
    if (boardMode !== 'ai-curation' || !currentRecommendations) return;
    setAiCurationTargetCount((previous) => {
      const parsed = Number(previous);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= currentRecommendations.candidateCount) return previous;
      return currentRecommendations.candidateCount > 0 ? String(Math.min(10, currentRecommendations.candidateCount)) : '';
    });
  }, [boardMode, aiCurationCandidateCount, setNumber]);

  useEffect(() => {
    if (boardMode !== 'runs' || !currentRun) return;
    setCurrentRunEvidence({});
    loadRunEvidence(currentRun.id).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [boardMode, currentRun?.id]);

  useEffect(() => {
    if (boardMode !== 'library') return;
    setCurrentLibraryEvidence({});
    loadLibraryEvidence(setNumber).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [boardMode, setNumber, currentLibrarySet?.updatedAt]);

  useEffect(() => {
    if (boardMode === 'library' && !generationSession) {
      loadLibraryBalance().catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
    }
  }, [boardMode, generationSession, setNumber, currentLibrarySet?.updatedAt]);

  useEffect(() => {
    setRevealedAnswers({});
    setRevealedTranslations({});
    setAudioStates({});
  }, [boardMode, currentRun?.id, setNumber]);

  function answerKey(conversationId: string, questionIndex: number): string {
    return `${conversationId}:${questionIndex}`;
  }

  function toggleAnswer(conversationId: string, questionIndex: number) {
    const key = answerKey(conversationId, questionIndex);
    setRevealedAnswers((previous) => ({
      ...previous,
      [key]: !previous[key]
    }));
  }

  function translationKey(conversationId: string, lineIndex: number): string {
    return `${conversationId}:${lineIndex}`;
  }

  function toggleTranslation(conversationId: string, lineIndex: number) {
    const key = translationKey(conversationId, lineIndex);
    setRevealedTranslations((previous) => ({
      ...previous,
      [key]: !previous[key]
    }));
  }

  function setAudioState(conversationId: string, state: AudioPlaybackState) {
    setAudioStates((previous) => ({
      ...previous,
      [conversationId]: state
    }));
  }

  async function toggleAudioPlayback(conversationId: string) {
    const audio = audioRefs.current[conversationId];
    if (!audio) return;

    if (!audio.paused && !audio.ended) {
      audio.pause();
      return;
    }

    if (audio.ended || audioStates[conversationId] === 'ended') {
      audio.currentTime = 0;
    }

    try {
      await audio.play();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function audioButtonContent(conversationId: string) {
    const state = audioStates[conversationId] ?? 'idle';
    if (state === 'playing') {
      return (
        <>
          <Pause size={16} />
          Pause
        </>
      );
    }
    if (state === 'ended') {
      return (
        <>
          <RotateCcw size={16} />
          Replay
        </>
      );
    }
    if (state === 'paused') {
      return (
        <>
          <Play size={16} />
          Resume
        </>
      );
    }
    return (
      <>
        <Play size={16} />
        Play
      </>
    );
  }

  function actionKey(runId: string | undefined, conversationId: string): string {
    return runId ? `${runId}:${conversationId}` : conversationId;
  }

  function handleSetNumberChange(nextSetNumber: number) {
    setSetNumber(nextSetNumber);
    if (boardMode === 'ai-curation') {
      navigateToStudioRoute(studioAiCurationRoute(nextSetNumber));
    } else if (boardMode === 'recommendations') {
      navigateToStudioRoute(studioQueueRoute(nextSetNumber));
    } else if (boardMode === 'library') {
      navigateToStudioRoute(studioLibraryRoute(nextSetNumber));
    } else {
      const nextRun = selectStudioRunForSet(runs, nextSetNumber);
      setCurrentRun(nextRun);
      if (nextRun) {
        setTextModelId(nextRun.textModel.id);
      }
      navigateToStudioRoute(nextRun ? studioRunsRoute(nextRun.id) : studioRunsRoute());
    }
  }

  function navigateToRun(runId: string, audit = false) {
    navigateToStudioRoute(studioRunsRoute(runId, audit));
  }

  function selectWorkflowNode(nodeId: string) {
    // The inspector modal is transient local state, not a URL location.
    setSelectedWorkflowNodeId(nodeId);
  }

  function selectWorkflowConversation(conversationId?: string) {
    setSelectedWorkflowConversationId(conversationId);
    const runId = visibleWorkflowJob?.run?.id ?? visibleWorkflowJob?.runId ?? currentRun?.id;
    if (runId && (auditOpen || visibleWorkflowJob)) {
      navigateToStudioRoute(studioRunsRoute(runId, true, conversationId));
    }
  }

  function toggleAuditRoute() {
    if (!currentRun) return;
    navigateToRun(currentRun.id, !auditOpen);
  }

  function openGenerateModal() {
    setError(null);
    setGeneratePreflightError(null);
    setGenerateModal(initialGenerateModalState(setNumber));
  }

  function openBalanceModal() {
    setError(null);
    setBalanceModal({
      textModelId: textModels.some((model) => model.id === textModelId) ? textModelId : (textModels[0]?.id ?? ''),
      strategy: 'stats',
      conversationCount: ''
    });
  }

  async function submitGenerateModal() {
    if (!generateModal) return;
    const nextConversationCount = Number(generateModal.conversationCount);
    if (!Number.isInteger(nextConversationCount) || nextConversationCount < RUN_CONVERSATION_COUNT_RANGE.min || nextConversationCount > RUN_CONVERSATION_COUNT_RANGE.max || !generateModal.textModelId || !generateModal.judgeModelId) {
      setError('Choose a set, conversation count, generator, judge, and run type before generating.');
      return;
    }

    const config: GenerateRunConfig = {
      setNumber: generateModal.setNumber,
      conversationCount: nextConversationCount,
      textModelId: generateModal.textModelId,
      judgeModelId: generateModal.judgeModelId
    };
    setBusy('preflight');
    setError(null);
    setGeneratePreflightError(null);
    try {
      await api('/api/generation/preflight', { method: 'POST', body: JSON.stringify(config) });
    } catch (caught) {
      const message = `Model preflight failed: ${caught instanceof Error ? caught.message : String(caught)}`;
      setBusy(null);
      setError(message);
      setGeneratePreflightError(message);
      return;
    }
    setSetNumber(config.setNumber);
    setConversationCount(config.conversationCount);
    setTextModelId(config.textModelId);
    setBusy(null);
    setGeneratePreflightError(null);
    setGenerateModal(null);

    if (generateModal.runMode === 'text-only') {
      await generate(config);
      return;
    }

    if (generateModal.runMode === 'workflow-max-audio') {
      await generateWorkflow(config, config.conversationCount, 'max');
      return;
    }

    await generateWorkflow(config, generateModal.runMode === 'workflow-audio' ? 2 : 0, 'fixed');
  }

  async function generate(config: GenerateRunConfig) {
    const sessionId = makeSessionId();
    const requestModel = textModelOptions.find((model) => model.id === config.textModelId);
    const modelLabel = requestModel?.label ?? config.textModelId;
    const requestBody = { ...config, idempotencyKey: makeSessionId() };
    setBusy('generate');
    setError(null);
    setEdit(null);
    setAuditOpen(false);
    setWorkflowJob(null);
    setSelectedWorkflowNodeId(undefined);
    setBoardMode('runs');
    setCurrentRun(null);
    setGenerationSession({
      id: sessionId,
      title: 'Generating a new listening set',
      detail: `Set ${config.setNumber} - ${config.conversationCount} conversations - ${modelLabel}`,
      setNumber: config.setNumber,
      conversationCount: config.conversationCount,
      textModelLabel: modelLabel,
      startedAt: new Date().toISOString(),
      status: 'running'
    });
    try {
      const preview = await api<{ exchange: LlmExchange }>('/api/generate/preview', {
        method: 'POST',
        body: JSON.stringify(requestBody)
      });
      setGenerationSession((previous) => previous?.id === sessionId ? { ...previous, exchange: preview.exchange } : previous);

      await api<{ job: StudioJob }>('/api/generate/start', {
        method: 'POST',
        body: JSON.stringify(requestBody)
      });
      setBoardMode('runs');
      setGenerationSession(null);
      await refreshStudioSnapshot();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      setGenerationSession((previous) => previous?.id === sessionId
        ? {
            ...previous,
            status: 'failed',
            exchange: previous.exchange ? { ...previous.exchange, status: 'failed', error: message, receivedAt: new Date().toISOString() } : undefined,
            error: message,
            completedAt: new Date().toISOString()
          }
        : previous);
    } finally {
      setBusy(null);
    }
  }

  async function generateWorkflow(config: GenerateRunConfig, audioCount: number, audioMode: 'fixed' | 'max' = 'fixed') {
    const requestBody = { ...config, audioCount, audioMode, idempotencyKey: makeSessionId() };
    setBusy('workflow');
    setError(null);
    setEdit(null);
    setAuditOpen(false);
    setWorkflowJob(null);
    setSelectedWorkflowNodeId(undefined);
    setBoardMode('runs');
    setCurrentRun(null);
    setGenerationSession(null);
    const pendingJob = makeClientWorkflowJob(config.setNumber, config.conversationCount, requestBody.audioCount);
    setWorkflowJob(pendingJob);
    setSelectedWorkflowNodeId(undefined);
    try {
      const started = await api<WorkflowStartResponse>('/api/workflow/start', {
        method: 'POST',
        body: JSON.stringify(requestBody)
      });
      setWorkflowJob(started.job);
      setSelectedWorkflowNodeId(undefined);

      await refreshStudioSnapshot();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      setWorkflowJob((previous) => previous ? {
        ...previous,
        status: 'failed',
        error: message,
        updatedAt: new Date().toISOString(),
        nodes: previous.nodes.map((node) => node.status === 'processing' || node.id === 'generator'
          ? { ...node, status: 'error', completedAt: new Date().toISOString(), error: message }
          : node)
      } : previous);
    } finally {
      setBusy(null);
    }
  }

  async function submitBalanceModal() {
    if (!balanceModal) return;
    const { textModelId: modelId, strategy, conversationCount } = balanceModal;
    if (!modelId) {
      setError('Select a model for balancing.');
      return;
    }
    const trimmedCount = conversationCount.trim();
    const overrideCount = trimmedCount ? Number(trimmedCount) : undefined;
    if (overrideCount !== undefined && (!Number.isInteger(overrideCount) || overrideCount < BALANCE_CONVERSATION_COUNT_RANGE.min || overrideCount > BALANCE_CONVERSATION_COUNT_RANGE.max)) {
      setError(`Conversations to generate must be an integer ${describeCountRange(BALANCE_CONVERSATION_COUNT_RANGE)}.`);
      return;
    }
    const sessionId = makeSessionId();
    const isAiBalance = strategy === 'ai';
    const selectedBalanceModel = textModels.find((model) => model.id === modelId);
    const modelLabel = selectedBalanceModel?.label ?? modelId;
    const requestBody: LibraryComplementGenerateRequest = {
      textModelId: modelId,
      balanceMode: strategy,
      idempotencyKey: makeSessionId(),
      ...(overrideCount !== undefined ? { conversationCount: overrideCount } : {})
    };
    const modeLabel = isAiBalance ? 'library-aware' : 'stats-only';
    setBalanceModal(null);
    setBusy('generate-complement');
    setError(null);
    setEdit(null);
    setAuditOpen(false);
    setWorkflowJob(null);
    setSelectedWorkflowNodeId(undefined);
    setBoardMode('runs');
    setCurrentRun(null);
    setGenerationSession({
      id: sessionId,
      title: 'Generating a library balance batch',
      detail: `Set ${setNumber} - ${modeLabel} complementary batch - ${modelLabel}`,
      setNumber,
      conversationCount: overrideCount ?? currentLibraryBalance?.suggestedConversationCount ?? 0,
      textModelLabel: modelLabel,
      startedAt: new Date().toISOString(),
      status: 'running'
    });
    try {
      const preview = await api<{ exchange: LlmExchange; balance: LibraryBalancePlan }>(`/api/library/sets/${encodeURIComponent(setNumber)}/complement/preview`, {
        method: 'POST',
        body: JSON.stringify(requestBody)
      });
      setLibraryBalance(preview.balance);
      setGenerationSession((previous) => previous?.id === sessionId
        ? {
            ...previous,
            conversationCount: preview.balance.suggestedConversationCount,
            detail: `Set ${setNumber} - ${preview.balance.suggestedConversationCount} balance conversations - ${modelLabel}`,
            exchange: preview.exchange
          }
        : previous);

      const payload = await api<{ job: StudioJob; balance: LibraryBalancePlan }>(`/api/library/sets/${encodeURIComponent(setNumber)}/complement/start`, {
        method: 'POST',
        body: JSON.stringify(requestBody)
      });
      setLibraryBalance(payload.balance);
      setBoardMode('runs');
      setGenerationSession(null);
      await refreshStudioSnapshot();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      setGenerationSession((previous) => previous?.id === sessionId
        ? {
            ...previous,
            status: 'failed',
            exchange: previous.exchange ? { ...previous.exchange, status: 'failed', error: message, receivedAt: new Date().toISOString() } : undefined,
            error: message,
            completedAt: new Date().toISOString()
          }
        : previous);
    } finally {
      setBusy(null);
    }
  }

  async function refreshRun(runId = currentRun?.id) {
    if (!runId) return;
    const payload = await api<{ run: PracticeRun; evidenceByConversationId: ConversationCurationEvidenceMap }>(`/api/runs/${encodeURIComponent(runId)}`);
    setCurrentRun(payload.run);
    setCurrentRunEvidence(payload.evidenceByConversationId);
    applyRunGeneratorDefaults(payload.run);
    setRuns((existing) => [payload.run, ...existing.filter((run) => run.id !== payload.run.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  async function deleteRun(run: PracticeRun) {
    if (!window.confirm(`Delete this run from ${formatRunHistoryTitle(run.createdAt)}? This removes its generated conversations and audio files.`)) {
      return;
    }

    const marker = `delete-run:${run.id}` as BusyAction;
    setBusy(marker);
    setError(null);
    try {
      const payload = await api<{ deletedRunId: string; runs: PracticeRun[] }>(`/api/runs/${encodeURIComponent(run.id)}`, {
        method: 'DELETE'
      });
      setRuns(payload.runs);
      if (currentRun?.id === payload.deletedRunId) {
        const nextRun = selectStudioRunForSet(payload.runs, run.setNumber);
        setCurrentRun(nextRun);
        setWorkflowJob(null);
        setSelectedWorkflowNodeId(undefined);
        setAuditOpen(false);
        setEdit(null);
        navigateToStudioRoute(nextRun ? studioRunsRoute(nextRun.id) : studioRunsRoute());
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  async function reanalyzeCurrentRun() {
    if (!currentRun) return;
    const marker = `reanalyze-run:${currentRun.id}` as BusyAction;
    setBusy(marker);
    setError(null);
    try {
      const payload = await api<{ run: PracticeRun; evidenceByConversationId: ConversationCurationEvidenceMap }>(`/api/runs/${encodeURIComponent(currentRun.id)}/reanalyze`, { method: 'POST' });
      setCurrentRun(payload.run);
      setCurrentRunEvidence(payload.evidenceByConversationId);
      setRuns((existing) => [payload.run, ...existing.filter((run) => run.id !== payload.run.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  async function rerunWorkflowRepair(nodeId: string, runId = visibleWorkflowJob?.run?.id ?? currentRun?.id) {
    if (!runId) return;
    const marker = `repair-node:${runId}:${nodeId}` as BusyAction;
    setBusy(marker);
    setError(null);
    try {
      const payload = await api<WorkflowRepairResponse>(
        `/api/runs/${encodeURIComponent(runId)}/workflow-nodes/${encodeURIComponent(nodeId)}/repair`,
        { method: 'POST' }
      );
      setCurrentRun(payload.run);
      setCurrentRunEvidence(payload.evidenceByConversationId);
      setRuns((existing) => [payload.run, ...existing.filter((run) => run.id !== payload.run.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setSelectedWorkflowNodeId(nodeId);
      setAuditOpen(true);
      if (!payload.repairApplied) {
        setError(payload.repairOutcome === 'provider_failed'
          ? 'Repair rerun failed at the provider. The failed attempt was saved in audit history.'
          : 'Repair rerun completed, but it did not improve the vocabulary audit.');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      await refreshRun(runId).catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  async function reanalyzeCurrentLibrarySet() {
    const marker = `reanalyze-library:${setNumber}` as BusyAction;
    setBusy(marker);
    setError(null);
    try {
      const payload = await api<{ set: CuratedSet; evidenceByConversationId: ConversationCurationEvidenceMap }>(`/api/library/sets/${encodeURIComponent(setNumber)}/reanalyze`, { method: 'POST' });
      setLibrarySets((existing) => [payload.set, ...existing.filter((set) => set.setNumber !== payload.set.setNumber)].sort((a, b) => a.setNumber - b.setNumber));
      setCurrentLibraryEvidence(payload.evidenceByConversationId);
      await loadLibraryBalance(payload.set.setNumber);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  async function runAction(conversationId: string, action: ConversationAction, sourceRunId = currentRun?.id) {
    if (!sourceRunId) return;
    const sourceRun = currentRun?.id === sourceRunId ? currentRun : runs.find((run) => run.id === sourceRunId) ?? null;
    const conversation = sourceRun?.conversations.find((item) => item.id === conversationId);
    if (action === 'delete-audio' && !window.confirm('Delete this generated audio? You can regenerate it afterward.')) {
      return;
    }
    if (action === 'audio' && conversation?.audioFileName && !window.confirm('Regenerate this audio? The existing recording will be permanently replaced only after the new recording generates successfully.')) {
      return;
    }

    const marker = `${action}:${actionKey(sourceRunId, conversationId)}` as BusyAction;
    setBusy(marker);
    setError(null);
    try {
      const routeAction = action === 'delete-audio' ? 'audio' : action;
      const payload = await api<{ run: PracticeRun }>(
        `/api/runs/${encodeURIComponent(sourceRunId)}/conversations/${encodeURIComponent(conversationId)}/${routeAction}`,
        {
          method: action === 'delete-audio' ? 'DELETE' : 'POST',
          ...(action === 'audio' ? { body: JSON.stringify({ idempotencyKey: makeSessionId() }) } : {})
        }
      );
      if (currentRun?.id === sourceRunId) {
        setCurrentRun(payload.run);
      }
      await loadInitial();
      if (boardMode === 'recommendations') {
        await loadRecommendations();
      }
      if (boardMode === 'library') {
        await loadLibraryBalance();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      await refreshRun(sourceRunId).catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  async function regenerateAllAudio(runId = visibleWorkflowJob?.run?.id ?? currentRun?.id) {
    if (!runId) return;
    const sourceRun = visibleWorkflowJob?.run?.id === runId ? visibleWorkflowJob.run : currentRun?.id === runId ? currentRun : runs.find((run) => run.id === runId) ?? null;
    if (!sourceRun) return;
    const mode = runHasMissingAudio(sourceRun) ? 'resume' : 'replace';
    const confirmation = mode === 'replace'
      ? 'Regenerate all audio for this run? Existing audio files will be replaced.'
      : 'Generate audio for missing conversations? Existing audio will be kept.';
    if (!window.confirm(confirmation)) {
      return;
    }

    const marker = `audio-all:${runId}` as BusyAction;
    setBusy(marker);
    setError(null);
    const optimisticRun = optimisticAudioRun(sourceRun, mode);
    setCurrentRun(optimisticRun);
    setRuns((existing) => [optimisticRun, ...existing.filter((run) => run.id !== optimisticRun.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setWorkflowJob(null);
    setAuditOpen(true);
    const applyLatestRun = (latestRun: PracticeRun) => {
      setCurrentRun((previous) => previous?.id === latestRun.id ? latestRun : previous);
      setRuns((existing) => [latestRun, ...existing.filter((run) => run.id !== latestRun.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setWorkflowJob(null);
      setAuditOpen(true);
    };
    try {
      const payload = await api<{ run: PracticeRun; job: StudioJob }>(`/api/runs/${encodeURIComponent(runId)}/audio`, {
        method: 'POST',
        body: JSON.stringify({ mode, idempotencyKey: makeSessionId() } satisfies RunAudioGenerateRequest)
      });
      applyLatestRun(payload.run);
      setStudioJobs((current) => [payload.job, ...current.filter((job) => job.id !== payload.job.id)]);
      await refreshStudioSnapshot();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      await refreshRun(runId).catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  async function addToLibrary(conversationId: string, sourceRunId = currentRun?.id) {
    if (!sourceRunId) return;
    const marker = `library-add:${actionKey(sourceRunId, conversationId)}` as BusyAction;
    setBusy(marker);
    setError(null);
    try {
      const payload = await api<{ run: PracticeRun }>(
        `/api/runs/${encodeURIComponent(sourceRunId)}/conversations/${encodeURIComponent(conversationId)}/library`,
        { method: 'POST' }
      );
      if (currentRun?.id === sourceRunId) {
        setCurrentRun(payload.run);
      }
      await loadInitial();
      if (boardMode === 'recommendations') {
        await loadRecommendations();
      }
      if (boardMode === 'library') {
        await loadLibraryBalance();
      }
      await loadPracticePublishStatus();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      await refreshRun(sourceRunId).catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  async function removeFromLibrary(conversation: CuratedConversation) {
    if (!window.confirm('Remove this conversation from Library? The generated run will become editable again if it still exists.')) {
      return;
    }

    const marker = `library-remove:${conversation.id}` as BusyAction;
    setBusy(marker);
    setError(null);
    try {
      await api<{ removed: CuratedConversation; run?: PracticeRun | null }>(
        `/api/library/${encodeURIComponent(conversation.id)}`,
        { method: 'DELETE' }
      );
      await loadInitial();
      if (currentRun?.id === conversation.sourceRunId) {
        await refreshRun(currentRun.id).catch(() => undefined);
      }
      if (boardMode === 'recommendations') {
        await loadRecommendations();
      }
      if (boardMode === 'library') {
        await loadLibraryBalance(conversation.setNumber);
      }
      await loadPracticePublishStatus();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  async function publishPracticeLibrary() {
    setBusy('publish-library');
    setError(null);
    try {
      const payload = await api<{ status: PracticeLibraryPublishStatus }>('/api/library/publish', { method: 'POST' });
      setPracticePublishStatus(payload.status);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  async function saveEdit() {
    if (!currentRun || !edit) return;
    setBusy(`save:${edit.conversationId}`);
    setError(null);
    try {
      const payload = await api<{ run: PracticeRun }>(
        `/api/runs/${encodeURIComponent(currentRun.id)}/conversations/${encodeURIComponent(edit.conversationId)}`,
        {
          method: 'PUT',
          body: JSON.stringify(edit)
        }
      );
      setCurrentRun(payload.run);
      setEdit(null);
      await loadInitial();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  function renderConversationCard(
    conversation: PracticeConversation | CuratedConversation,
    source: 'run' | 'library' | 'recommendation',
    recommendation?: AiCurationRecommendation,
    deterministicRecommendation?: LibraryRecommendationCandidate,
    historicalReadonly = false
  ) {
    const sourceRunReference: SourceRunReference = recommendation
      ? {
          sourceRunId: recommendation.sourceRunId,
          sourceRunCreatedAt: currentAiCurationReview?.snapshot.candidates.find((item) => item.candidateKey === recommendation.candidateKey)?.sourceRunCreatedAt,
          sourceRunColorIndex: sourceRunColorIndexBySurface.aiCuration.get(recommendation.sourceRunId)
        }
      : deterministicRecommendation
        ? {
            sourceRunId: deterministicRecommendation.sourceRunId,
            sourceRunCreatedAt: deterministicRecommendation.sourceRunCreatedAt,
            sourceRunColorIndex: sourceRunColorIndexBySurface.recommendations.get(deterministicRecommendation.sourceRunId)
          }
        : source === 'library'
          ? {
              sourceRunId: (conversation as CuratedConversation).sourceRunId,
              sourceRunColorIndex: sourceRunColorIndexBySurface.library.get((conversation as CuratedConversation).sourceRunId)
            }
          : {};
    const sourceRunId = sourceRunReference.sourceRunId ?? (source === 'run' ? currentRun?.id : undefined);
    const sourceConversationId = recommendation?.sourceConversationId
      ?? deterministicRecommendation?.conversation.id
      ?? (source === 'library' ? (conversation as CuratedConversation).sourceConversationId : conversation.id);
    const qualityReview = conversation.qualityReview ?? (sourceRunId ? historicalQualityReviews[`${sourceRunId}/${sourceConversationId}`] : undefined);
    const sourceRunMetadata = source === 'run' ? null : resolveSourceRunMetadata(sourceRunReference, runs, formatRunHistoryTitle, studioRunsRoute);
    const itemKey = actionKey(sourceRunId, conversation.id);
    const isEditing = source === 'run' && edit?.conversationId === conversation.id;
    const isLibraryCard = source === 'library';
    const isRecommendationCard = source === 'recommendation';
    const isReadonly = isLibraryCard || Boolean(conversation.curatedId) || historicalReadonly;
    const canAddToLibrary = source === 'run' && conversation.status === 'audio_ready' && Boolean(conversation.audioFileName);
    const canAddRecommendationToLibrary = isRecommendationCard && conversation.status === 'audio_ready' && Boolean(conversation.audioFileName);
    const audioJob = studioJobs.find((job) => job.runId === sourceRunId && job.conversationId === conversation.id && ['queued', 'running', 'pausing', 'paused', 'interrupted'].includes(job.status));
    const canRetryAudio = conversation.status === 'audio_failed' || Boolean(conversation.error) || audioJob?.status === 'interrupted';
    const isAudioBusy = busy === `audio:${itemKey}` || conversation.status === 'audio_generating' || (Boolean(audioJob) && !canRetryAudio);
    const isAudioGenerating = isAudioBusy;
    const isDeleteBusy = busy === `delete-audio:${itemKey}`;
    const currentAudioSrc = audioSrc(conversation);
    const hasAudio = Boolean(currentAudioSrc);
    const evidence = recommendation?.evidence ?? deterministicRecommendation?.evidence
      ?? (source === 'run' ? currentRunEvidence[conversation.id] : source === 'library' ? currentLibraryEvidence[conversation.id] : undefined);
    const outOfVocabularyWords = evidence?.outOfVocabularyUniqueWords ?? conversation.outOfVocabularyAudit;
    const conversationWordMetadata = metadataWithConversationReferences(vocabularyMetadata, [conversation]);
    const deterministicCoverageWords = deterministicRecommendation?.leastCoveredWords.filter((word) => leastCoveredWordSet.has(word.japanese)) ?? [];
    const deterministicWordIncreases = deterministicRecommendation ? wordFrequency(conversation.vocabularyUsed) : new Map<string, number>();

    return (
      <article className={isReadonly ? 'conversationCard readonly' : 'conversationCard'} key={itemKey}>
        <div className="cardHeader">
          <div>
            <span className="conversationNumber">Conversation {conversation.number}</span>
            <h3>{conversation.title}</h3>
          </div>
          <div className="cardHeaderMeta">
            {!isLibraryCard ? <span className={`statusPill ${conversation.status}`}>{recommendation ? `AI pick ${recommendation.rank}` : deterministicRecommendation ? `score ${deterministicRecommendation.score}` : statusLabel(conversation.status)}</span> : null}
            <ConversationQualityBadge
              quality={conversation.quality}
              review={qualityReview}
              onClick={conversation.quality && source === 'run' && currentRun ? () => navigateToStudioRoute(studioRunsRoute(currentRun.id, true, conversation.id)) : undefined}
            />
            <SourceRunLabel metadata={sourceRunMetadata} />
          </div>
        </div>

        {recommendation ? (
          <div className="recommendationMeta">
            <div>
              <span>New to Library</span>
              <strong>{recommendation.contribution.uncoveredWords.length}</strong>
            </div>
            <div>
              <span>Set Words</span>
              <strong>{recommendation.evidence.currentSetUniqueCount}</strong>
            </div>
            <div>
              <span>OOV</span>
              <strong>{recommendation.evidence.outOfVocabularyUniqueCount}</strong>
            </div>
          </div>
        ) : null}

        {deterministicRecommendation ? (
          <div className="recommendationMeta">
            <div><span>Uncovered</span><strong>{deterministicRecommendation.uncoveredWordCount}</strong></div>
            <div><span>Target Words</span><strong>{deterministicRecommendation.targetWordCount}</strong></div>
            <div><span>Score</span><strong>{deterministicRecommendation.score}</strong></div>
          </div>
        ) : null}

        {recommendation ? <AiRecommendationReason recommendation={recommendation} /> : null}

        {isEditing && edit ? (
          <div className="editForm">
            <label>
              <span>Title</span>
              <input value={edit.title} onChange={(event) => setEdit({ ...edit, title: event.target.value })} />
            </label>
            <label>
              <span>Scene</span>
              <input value={edit.scene} onChange={(event) => setEdit({ ...edit, scene: event.target.value })} />
            </label>
            <label>
              <span>Sample context</span>
              <input value={edit.sampleContext} onChange={(event) => setEdit({ ...edit, sampleContext: event.target.value })} />
            </label>
            <label>
              <span>Transcript</span>
              <textarea rows={7} value={edit.transcript} onChange={(event) => setEdit({ ...edit, transcript: event.target.value })} />
            </label>
            <div className="buttonRow">
              <button className="secondaryButton" onClick={() => setEdit(null)}>
                <X size={17} />
                Cancel
              </button>
              <button className="primaryButton compact" onClick={saveEdit} disabled={busy === `save:${conversation.id}`}>
                <Save size={17} />
                Save
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="sceneText">{conversation.scene}</p>
            <div className="transcriptBlock">
              {conversation.text.map((line, index) => {
                const key = translationKey(itemKey, index);
                const isRevealed = Boolean(revealedTranslations[key]);
                return (
                  <div className="transcriptLine" key={key}>
                    <strong>{line.speaker}</strong>
                    <span>[{line.tags.join(', ')}]</span>
                    <div className={isRevealed ? 'translationCard revealed' : 'translationCard'}>
                      <div className="translationCardInner">
                        <span className="translationFace japaneseFace">{line.japanese}</span>
                        <span className="translationFace englishFace">{conversation.englishTranslation[index]?.english ?? 'No translation provided'}</span>
                      </div>
                    </div>
                    <button
                      aria-label={`${isRevealed ? 'Hide' : 'Show'} translation for line ${index + 1}`}
                      aria-pressed={isRevealed}
                      className={isRevealed ? 'translationToggle active' : 'translationToggle'}
                      onClick={() => toggleTranslation(itemKey, index)}
                      title={`${isRevealed ? 'Hide' : 'Show'} translation`}
                      type="button"
                    >
                      <Languages size={16} />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="detailStrip">
              <div>
                <span>Questions</span>
                <ol>
                  {conversation.listeningQuestions.map((question, questionIndex) => {
                    const key = answerKey(itemKey, questionIndex);
                    const isRevealed = Boolean(revealedAnswers[key]);
                    return (
                      <li className={isRevealed ? 'answerCard revealed' : 'answerCard'} key={key}>
                        <div className="answerCardInner">
                          <span className="answerFace questionFace">{question}</span>
                          <span className="answerFace answerFaceBack">{conversation.answerKey[questionIndex] ?? 'No answer provided'}</span>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
              <div className="answerToggleColumn">
                <span>Show Answers</span>
                <div className="answerButtons">
                  {conversation.listeningQuestions.map((question, questionIndex) => {
                    const key = answerKey(itemKey, questionIndex);
                    const isRevealed = Boolean(revealedAnswers[key]);
                    return (
                      <button
                        aria-label={`${isRevealed ? 'Hide' : 'Show'} answer for question ${questionIndex + 1}`}
                        aria-pressed={isRevealed}
                        className={isRevealed ? 'answerToggle active' : 'answerToggle'}
                        key={key}
                        onClick={() => toggleAnswer(itemKey, questionIndex)}
                        title={`${isRevealed ? 'Hide' : 'Show'} answer`}
                        type="button"
                      >
                        <Eye size={17} />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <CurationEvidencePanel evidence={evidence} metadata={conversationWordMetadata} />

            <div className="vocabChips warning">
              {outOfVocabularyWords.length === 0 ? <span>None</span> : null}
              {outOfVocabularyWords.map((word) => (
                <StudioWordChip key={word} word={word} metadata={conversationWordMetadata.get(word)} />
              ))}
            </div>

            {recommendation ? (
              <div className="vocabChips coverage">
                {recommendation.contribution.uncoveredWords.map((word) => <StudioWordChip className="coverageCount0" key={`new-${word}`} word={word} metadata={conversationWordMetadata.get(word)} adornment={<b>new</b>} />)}
                {recommendation.contribution.underexposedWords.map((word) => <StudioWordChip className="coverageCount1" key={`low-${word}`} word={word} metadata={conversationWordMetadata.get(word)} adornment={<b>low</b>} />)}
              </div>
            ) : deterministicRecommendation ? (
              <div className="vocabChips coverage">
                {deterministicCoverageWords.slice(0, 12).map((word) => (
                  <StudioWordChip className={coverageCountClass(word.libraryCount)} key={word.japanese} word={word.japanese} metadata={conversationWordMetadata.get(word.japanese)} adornment={<b>{deterministicWordIncreases.get(word.japanese) ?? 1}</b>} />
                ))}
              </div>
            ) : null}

            {conversation.error ? <p className="conversationError">{conversation.error}</p> : null}
            {currentAudioSrc ? (
              <div className="audioRow single">
                <audio
                  controls
                  onEnded={() => setAudioState(itemKey, 'ended')}
                  onPause={(event) => {
                    if (!event.currentTarget.ended) {
                      setAudioState(itemKey, event.currentTarget.currentTime > 0 ? 'paused' : 'idle');
                    }
                  }}
                  onPlay={() => setAudioState(itemKey, 'playing')}
                  onSeeked={(event) => {
                    if (!event.currentTarget.paused || event.currentTarget.ended) return;
                    setAudioState(itemKey, event.currentTarget.currentTime > 0 ? 'paused' : 'idle');
                  }}
                  ref={(node) => {
                    audioRefs.current[itemKey] = node;
                  }}
                  src={currentAudioSrc}
                >
                  <track kind="captions" />
                </audio>
              </div>
            ) : null}

            <div className="buttonRow">
              {hasAudio ? (
                <>
                  <button className="playLink" onClick={() => toggleAudioPlayback(itemKey)} type="button">
                    {audioButtonContent(itemKey)}
                  </button>
                  <button
                    className="primaryButton compact"
                    onClick={() => runAction(conversation.id, 'audio', sourceRunId)}
                    disabled={isReadonly || isAudioBusy}
                    title={historicalReadonly ? 'Historical reviews are read-only.' : isReadonly ? 'Remove it from Library before regenerating audio.' : 'Regenerate audio'}
                  >
                    {isAudioGenerating ? <RefreshCw className="spin" size={17} /> : <RefreshCw size={17} />}
                    {isAudioBusy ? 'Generating' : 'Regenerate'}
                  </button>
                  <button
                    className="secondaryButton danger"
                    onClick={() => runAction(conversation.id, 'delete-audio', sourceRunId)}
                    disabled={isReadonly || isAudioBusy || isDeleteBusy}
                    title={isReadonly ? 'Remove it from Library before deleting audio.' : 'Delete generated audio'}
                  >
                    {isDeleteBusy ? <RefreshCw className="spin" size={17} /> : <Trash2 size={17} />}
                    Delete
                  </button>
                  {source === 'run' || source === 'recommendation' ? (
                    conversation.curatedId ? (
                      <button className="secondaryButton" disabled title="Remove it from the Library board to edit this source again.">
                        <BookOpen size={17} />
                        In Library
                      </button>
                    ) : (
                      <button
                        className="secondaryButton positive"
                        onClick={() => addToLibrary(conversation.id, sourceRunId)}
                        disabled={historicalReadonly || !(canAddToLibrary || canAddRecommendationToLibrary) || busy === `library-add:${itemKey}`}
                        title={historicalReadonly ? 'Historical reviews are read-only.' : canAddToLibrary || canAddRecommendationToLibrary ? 'Add to Library' : 'Generate audio before adding to Library'}
                      >
                        {busy === `library-add:${itemKey}` ? <RefreshCw className="spin" size={17} /> : <Plus size={17} />}
                        Library
                      </button>
                    )
                  ) : (
                    <button className="secondaryButton danger" onClick={() => removeFromLibrary(conversation as CuratedConversation)} disabled={busy === `library-remove:${conversation.id}`}>
                      {busy === `library-remove:${conversation.id}` ? <RefreshCw className="spin" size={17} /> : <Trash2 size={17} />}
                      Remove
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    className="primaryButton compact"
                    onClick={() => runAction(conversation.id, 'audio', sourceRunId)}
                    disabled={isReadonly || isAudioBusy}
                    title={historicalReadonly ? 'Historical reviews are read-only.' : 'Generate audio'}
                  >
                    {isAudioGenerating ? <RefreshCw className="spin" size={17} /> : <Headphones size={17} />}
                    {isAudioBusy ? 'Generating' : 'Generate'}
                  </button>
                  <button
                    className="secondaryButton"
                    disabled={isReadonly || isRecommendationCard}
                    onClick={() => {
                      if (!isReadonly && !isRecommendationCard) {
                        setEdit({
                          conversationId: conversation.id,
                          title: conversation.title,
                          scene: conversation.scene,
                          sampleContext: conversation.sampleContext,
                          transcript: transcriptForEdit(conversation)
                        });
                      }
                    }}
                    title={isRecommendationCard ? 'Open the source run to edit this conversation.' : isReadonly ? 'Remove it from Library to edit this conversation.' : 'Edit conversation'}
                  >
                    <Pencil size={17} />
                    Edit
                  </button>
                  {isRecommendationCard && sourceRunId ? (
                    <a className="secondaryButton" href={studioRunsRoute(sourceRunId)}>
                      <ListMusic size={17} />
                      Open Run
                    </a>
                  ) : null}
                </>
              )}
            </div>
          </>
        )}
      </article>
    );
  }

  return (
    <main className="appShell">
      <StudioBackgroundJobs
        jobs={studioJobs}
        connected={studioRealtimeConnected}
        toasts={studioToasts}
        onPause={(jobId) => commandStudioJob(jobId, 'pause')}
        onResume={(jobId) => commandStudioJob(jobId, 'resume')}
        onCancel={(jobId) => commandStudioJob(jobId, 'cancel')}
        onFocus={focusStudioJob}
        onDismissToast={dismissStudioToast}
      />
      {generateModal ? (
        <GenerateModal
          state={generateModal}
          sets={sets}
          textModels={textModels}
          busy={busy}
          preflightError={generatePreflightError}
          onChange={(state) => {
            setGeneratePreflightError(null);
            setGenerateModal(state);
          }}
          onClose={() => {
            setGeneratePreflightError(null);
            setGenerateModal(null);
          }}
          onSubmit={submitGenerateModal}
        />
      ) : null}
      {balanceModal ? (
        <BalanceModal
          state={balanceModal}
          setNumber={setNumber}
          textModels={textModels}
          busy={busy}
          suggestedCount={currentLibraryBalance?.suggestedConversationCount}
          onChange={setBalanceModal}
          onClose={() => setBalanceModal(null)}
          onSubmit={submitBalanceModal}
        />
      ) : null}
      {addAllProgress ? (
        <AddAllProgressModal
          progress={addAllProgress}
          onClose={() => setAddAllProgress(null)}
          onRun={runAddAllAiRecommendations}
          onPause={pauseAddAllAiRecommendations}
        />
      ) : null}
      <aside className="sideBar">
        <div className="brand">
          <BrandLogo className="brandLogo" title="Kiki JLPT" />
          <div>
            <div className="brandTitle">
              <h1>Kiki JLPT <span>Studio</span></h1>
            </div>
          </div>
        </div>
        <a className="sideSwitch" href="#/practice">
          Open Practice
        </a>

        <section className="generatorPanel">
          <div className="sidebarSetCard">
            <label className="sidebarSetPicker">
              <span>Set</span>
              <select value={setNumber} onChange={(event) => handleSetNumberChange(Number(event.target.value))}>
                {sets.map((set) => (
                  <option key={set.set} value={set.set}>
                    Set {set.set}
                  </option>
                ))}
              </select>
            </label>

            <div className="setMeta">
              <strong>{currentSet?.theme ?? 'Vocabulary set'}</strong>
              <span>{currentSet ? `${currentSet.cumulativeCount} allowed words through Set ${currentSet.set}` : 'Loading vocab'}</span>
            </div>
          </div>

          <div className="sidebarActions">
            <button className="primaryButton" onClick={openGenerateModal} disabled={busy !== null}>
              {busy === 'preflight' || busy === 'generate' || busy === 'workflow' ? <RefreshCw className="spin" size={18} /> : <Sparkles size={18} />}
              Generate
            </button>
          </div>
        </section>

        <div className="boardTabs" aria-label="Boards">
          <a className={boardMode === 'runs' ? 'active' : ''} href={studioRunsRoute(currentRun?.setNumber === setNumber ? currentRun.id : filteredRuns[0]?.id)}>
            <ListMusic size={16} />
            Runs
          </a>
          <a className={boardMode === 'recommendations' || boardMode === 'ai-curation' ? 'active' : ''} href={studioQueueRoute(setNumber)}>
            <Target size={16} />
            Queue
          </a>
          <a
            className={`${boardMode === 'library' ? 'active' : ''} ${practicePublishStatus?.stale ? 'stale' : ''}`}
            href={studioLibraryRoute(setNumber)}
            title={practicePublishStatus?.stale ? 'Library has unpublished updates.' : 'Library'}
          >
            <BookOpen size={16} />
            Library
            {practicePublishStatus?.stale ? <span className="tabDot" aria-label="Unpublished updates" /> : null}
          </a>
        </div>

        <section className="runList" aria-label="Generated runs">
          <div className="sectionHeader">
            <span>Runs</span>
            <button className="iconButton" onClick={() => loadInitial()} title="Refresh runs">
              <RefreshCw size={17} />
            </button>
          </div>
          {filteredRuns.length === 0 && filteredRunShells.length === 0 ? <p className="emptyText">No generated runs for Set {setNumber}.</p> : null}
          {filteredRunShells.map((shell) => (
            <div
              className={`runButton runJobShell ${shell.status} ${shell.jobId === activeShellJobId ? 'active' : ''}`}
              key={shell.jobId}
              onClick={() => focusRunShell(shell)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                focusRunShell(shell);
              }}
              role="button"
              tabIndex={0}
            >
              <RunCardHeader
                createdAt={shell.createdAt}
                contextLabel={cleanShellModelLabel(shell.modelLabel)}
                statusIcon={['running', 'pausing'].includes(shell.status) ? <RefreshCw className="spin" size={13} />
                  : shell.status === 'queued' ? <Clock size={13} />
                  : shell.status === 'paused' ? <Pause size={13} />
                  : <CircleAlert size={13} />}
              />
              <small>{shell.stageLabel}</small>
              {shell.resumable ? (
                <span className="runJobActions">
                  <button
                    className="runJobAction"
                    onClick={(event) => {
                      event.stopPropagation();
                      void commandStudioJob(shell.jobId, 'resume');
                    }}
                    type="button"
                  >
                    <Play size={13} /> Resume
                  </button>
                  <button
                    className="runJobAction danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      discardGenerationShell(shell.jobId);
                    }}
                    type="button"
                  >
                    <Trash2 size={13} /> Discard
                  </button>
                </span>
              ) : null}
            </div>
          ))}
          {filteredRuns.map((run) => {
            const liveJob = studioJobs.find((job) => job.runId === run.id && job.kind !== 'audio-child' && ['queued', 'running', 'pausing', 'paused', 'interrupted'].includes(job.status));
            return (
              <a
                key={run.id}
                className={`runButton ${boardMode === 'runs' && currentRun?.id === run.id && !activeShellVisible ? 'active' : ''}`}
                href={studioRunsRoute(run.id)}
              >
                <RunCardHeader
                  createdAt={run.createdAt}
                  contextLabel={`${shortModelLabel(run.textModel)}${run.judgeModel ? ` · judge ${shortModelLabel(run.judgeModel)}` : ''}`}
                  libraryCount={libraryCountBySourceRun.get(run.id) ?? 0}
                  statusIcon={liveJob && ['queued', 'running', 'pausing'].includes(liveJob.status) ? <RefreshCw className="spin" size={13} /> : undefined}
                />
                {liveJob ? <small>{liveJob.stageLabel}</small> : <RunSummaryChips conversations={run.conversations} analytics={run.analytics} />}
              </a>
            );
          })}
        </section>

        <section className="runList" aria-label="Library sets">
          <div className="sectionHeader">
            <span>Library</span>
            <button className="iconButton" onClick={() => loadInitial()} title="Refresh library">
              <RefreshCw size={17} />
            </button>
          </div>
          {currentCuratedLibrarySets.length === 0 ? <p className="emptyText">No curated conversations for Set {setNumber}.</p> : null}
          {currentCuratedLibrarySets.map((set) => (
            <a
              key={set.setNumber}
              className={`runButton ${boardMode === 'library' && setNumber === set.setNumber ? 'active' : ''}`}
              href={studioLibraryRoute(set.setNumber)}
            >
              <RunCardHeader createdAt={set.updatedAt} contextLabel={`Set ${set.setNumber}`} />
              <RunSummaryChips conversations={set.conversations} analytics={set.analytics} />
            </a>
          ))}
        </section>
      </aside>

      <section className="workspace">
        <header className="topBar">
          <div>
            <p className="eyebrow">{workflowJob ? 'Live pipeline audit' : visibleWorkflowJob ? 'Saved pipeline audit' : generationSession ? 'Generate, inspect, review' : boardMode === 'library' ? 'Curated listening shelf' : boardMode === 'ai-curation' ? 'AI portfolio review' : boardMode === 'recommendations' ? 'Coverage recommendation queue' : 'Generate, edit, synthesize'}</p>
            <h2>
              {visibleWorkflowJob
                ? `Set ${visibleWorkflowJob.setNumber} workflow`
                : generationSession
                ? `Set ${generationSession.setNumber} generation`
                : boardMode === 'library'
                  ? `Set ${setNumber} Library`
                  : boardMode === 'ai-curation'
                    ? `Set ${setNumber} AI Curation`
                  : boardMode === 'recommendations'
                    ? `Set ${setNumber} Recommendations`
                  : currentRun
                    ? `Set ${currentRun.setNumber} practice run`
                    : 'Create a listening batch'}
            </h2>
          </div>
          {workflowJob ? (
            <div className="runStats">
              {workflowPlanChips(workflowJob).map((chip) => <span key={chip}>{chip}</span>)}
            </div>
          ) : generationSession ? (
            <div className="runStats">
              <span>{generationSession.conversationCount} requested</span>
              <span>{generationSession.textModelLabel}</span>
              <span>{generationSession.status}</span>
            </div>
          ) : boardMode === 'library' ? (
            <div className="runStats libraryHeader">
              <span>{currentLibrarySet?.conversations.length ?? 0} curated</span>
              <span>{currentLibraryBalance ? `${currentLibraryBalance.suggestedConversationCount} suggested` : `Set ${setNumber}`}</span>
              <button
                className={`publishBadge ${practicePublishStatus?.stale ? 'stale' : 'fresh'}`}
                onClick={publishPracticeLibrary}
                disabled={busy === 'publish-library' || !practicePublishStatus?.stale}
                title={practicePublishStatus?.stale ? 'Publish the latest Library updates.' : 'The latest Library updates are published.'}
              >
                {busy === 'publish-library' ? (
                  <RefreshCw className="spin" size={15} />
                ) : practicePublishStatus?.stale ? (
                  <CircleAlert size={15} />
                ) : (
                  <Check size={15} />
                )}
                {busy === 'publish-library'
                  ? 'Publishing'
                  : practicePublishStatus?.stale
                    ? 'Publish Updates'
                    : practicePublishStatus
                      ? 'Published'
                      : 'Checking'}
              </button>
              <button className="auditToggle" onClick={openBalanceModal} disabled={busy === 'generate-complement' || libraryBalanceLoading}>
                {busy === 'generate-complement' || libraryBalanceLoading ? <RefreshCw className="spin" size={15} /> : <Sparkles size={15} />}
                Balance
              </button>
              <button className="auditToggle" onClick={reanalyzeCurrentLibrarySet} disabled={busy === `reanalyze-library:${setNumber}`}>
                {busy === `reanalyze-library:${setNumber}` ? <RefreshCw className="spin" size={15} /> : <RefreshCw size={15} />}
                Reanalyze
              </button>
            </div>
          ) : boardMode === 'recommendations' ? (
            <div className="runStats">
              <span>{currentRecommendations?.libraryConversationCount ?? currentLibrarySet?.conversations.length ?? 0} curated</span>
              <span>{currentRecommendations?.candidateCount ?? 0} candidates</span>
              <button className="auditToggle" onClick={openAiCuration}>
                <Sparkles size={15} />
                AI Curate
              </button>
              <button className="auditToggle" onClick={() => loadRecommendations()} disabled={recommendationsLoading}>
                {recommendationsLoading ? <RefreshCw className="spin" size={15} /> : <RefreshCw size={15} />}
                Refresh
              </button>
            </div>
          ) : boardMode === 'ai-curation' ? (
            <div className="runStats stackedHeader">
              <div className="stackedHeaderRow stackedHeaderRowPrimary">
                <span>{currentAiCurationReview?.snapshot.library.conversationCount ?? currentLibrarySet?.conversations.length ?? 0} curated</span>
                <span>{aiCurationCandidateCount} candidates</span>
                {isHistoricalAiCurationReview ? <span className="historicalReviewBadge">Historical · read only</span> : null}
                <select
                  aria-label="Curation history"
                  className="curationHistorySelect"
                  disabled={aiCurationContextLoading || aiCurationHistoryLoading || aiCurationHistory.length === 0}
                  onChange={(event) => void openAiCurationHistoryReview(event.target.value)}
                  value={currentAiCurationReview?.id ?? ''}
                >
                  {aiCurationHistory.length === 0 ? <option value="">No saved reviews</option> : null}
                  {aiCurationHistory.map((review, index) => (
                    <option key={review.id} value={review.id}>{aiCurationHistoryLabel(review, index)}</option>
                  ))}
                </select>
                {canAddCurrentAiCurationReview ? (
                  <button className="auditToggle positive" onClick={openAddAllAiRecommendations} disabled={Boolean(addAllProgress)}>
                    <Plus size={15} />
                    {aiCurationAddActionLabel}
                  </button>
                ) : null}
                <a className="auditToggle" href={studioQueueRoute(setNumber)}>
                  <ArrowLeft size={15} />
                  Queue
                </a>
              </div>
              <div className="stackedHeaderRow">
                {isHistoricalAiCurationReview && currentAiCurationReview ? (
                  <button className="auditToggle" onClick={() => applyAiCurationSettings(currentAiCurationReview)} type="button">
                    Use Settings
                  </button>
                ) : null}
                <details className="curationRunScope">
                  <summary>
                    Runs {aiCurationSelectedRunIds.length}/{aiCurationEligibleRuns.length} · {aiCurationCandidateCount} candidates
                  </summary>
                  <div className="curationRunScopePopover">
                    <div className="curationRunScopeActions">
                      <button type="button" onClick={() => setAiCurationSelectedRunIds(aiCurationEligibleRuns.map((run) => run.runId))}>Select all</button>
                      <button type="button" onClick={() => setAiCurationSelectedRunIds([])}>Clear</button>
                    </div>
                    {aiCurationEligibleRuns.map((run) => (
                      <label key={run.runId}>
                        <input
                          checked={aiCurationSelectedRunIds.includes(run.runId)}
                          onChange={(event) => setAiCurationSelectedRunIds((previous) => toggleCurationRun(previous, run.runId, event.target.checked))}
                          type="checkbox"
                        />
                        <span>{formatRunHistoryTitle(run.createdAt)}</span>
                        <small>{run.eligibleCandidateCount} eligible · {run.textModel.label}</small>
                      </label>
                    ))}
                    {aiCurationUnavailableSelectedRunIds.map((runId) => (
                      <label className="unavailable" key={runId}>
                        <input checked disabled type="checkbox" />
                        <span>Unavailable run</span>
                        <small>{runId}</small>
                      </label>
                    ))}
                  </div>
                </details>
                <form
                  className="aiCurationControls"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void runAiCuration(!isHistoricalAiCurationReview && currentAiCurationReview?.status === 'failed');
                  }}
                >
                  <AutoWidthSelect
                    ariaLabel="AI curator model"
                    className="curationModelSelect"
                    disabled={aiCurationLoading || aiCurationContextLoading || aiCurationHistoryLoading}
                    onChange={setTextModelId}
                    required
                    value={textModels.some((model) => model.id === textModelId) ? textModelId : 'gemini'}
                    options={textModels.map((model) => ({ value: model.id, label: shortModelLabel(model) }))}
                  />
                  <label className="curationCountField">
                    <span>Size</span>
                    <input
                      aria-label="Exact portfolio size"
                      disabled={aiCurationLoading || aiCurationContextLoading || aiCurationHistoryLoading || aiCurationCandidateCount === 0 || aiCurationUnavailableSelectedRunIds.length > 0}
                      max={aiCurationCandidateCount || undefined}
                      min={1}
                      onChange={(event) => setAiCurationTargetCount(event.target.value)}
                      required
                      step={1}
                      type="number"
                      value={aiCurationTargetCount}
                    />
                  </label>
                  <button className="auditToggle" type="submit" disabled={aiCurationLoading || aiCurationContextLoading || aiCurationHistoryLoading || aiCurationCandidateCount === 0 || aiCurationUnavailableSelectedRunIds.length > 0}>
                    {aiCurationLoading || aiCurationContextLoading ? <RefreshCw className="spin" size={15} /> : <Sparkles size={15} />}
                    {aiCurationContextLoading || aiCurationHistoryLoading ? 'Loading' : aiCurationLoading ? 'Curating' : isHistoricalAiCurationReview ? 'Start new' : currentAiCurationReview?.status === 'failed' ? 'Retry AI' : currentAiCurationReview ? 'Re-curate' : 'Start Curation'}
                  </button>
                </form>
              </div>
            </div>
          ) : currentRun ? (
            <div className="runStats">
              <span>{currentRun.allowedVocabCount} allowed words</span>
              <span>{runModelDisplay(currentRun.textModel)}</span>
              <span>{currentRun.status}</span>
              <button className="auditToggle" onClick={reanalyzeCurrentRun} disabled={busy === `reanalyze-run:${currentRun.id}`}>
                {busy === `reanalyze-run:${currentRun.id}` ? <RefreshCw className="spin" size={15} /> : <RefreshCw size={15} />}
                Reanalyze
              </button>
              <button className="auditToggle danger" onClick={() => deleteRun(currentRun)} disabled={busy === `delete-run:${currentRun.id}`}>
                {busy === `delete-run:${currentRun.id}` ? <RefreshCw className="spin" size={15} /> : <Trash2 size={15} />}
                Delete
              </button>
              {currentExchange || savedWorkflowJob ? (
                <button className="auditToggle" onClick={toggleAuditRoute}>
                  <Eye size={15} />
                  {auditOpen ? 'Hide audit' : savedWorkflowJob ? 'LLM audit' : currentExchanges.length > 1 ? 'LLM audits' : 'LLM audit'}
                </button>
              ) : null}
            </div>
          ) : null}
        </header>

        {error ? (
          <div className="errorBanner">
            <CircleAlert size={18} />
            <span>{error}</span>
          </div>
        ) : null}

        {generationSession ? <LoadingPanel session={generationSession} /> : null}

        {visibleWorkflowJob ? (
          <WorkflowAuditFlow
            job={visibleWorkflowJob}
            selectedNodeId={selectedWorkflowNodeId}
            selectedConversationId={selectedWorkflowConversationId}
            onSelectNode={selectWorkflowNode}
            onSelectConversation={selectWorkflowConversation}
            onApprove={visibleWorkflowJob.status === 'paused' ? () => commandStudioJob(visibleWorkflowJob.id, 'resume') : undefined}
            onRegenerateAudio={visibleWorkflowJob.run && visibleWorkflowJob.status !== 'running' ? () => regenerateAllAudio(visibleWorkflowJob.run?.id) : undefined}
            regenerateAudioDisabled={Boolean(visibleWorkflowJob.run && busy === `audio-all:${visibleWorkflowJob.run.id}`)}
            onRerunRepair={visibleWorkflowJob.run && visibleWorkflowJob.status !== 'running' ? (nodeId) => rerunWorkflowRepair(nodeId, visibleWorkflowJob.run?.id) : undefined}
            rerunRepairDisabled={Boolean(visibleWorkflowJob.run && selectedWorkflowNodeId && busy === `repair-node:${visibleWorkflowJob.run.id}:${selectedWorkflowNodeId}`)}
            onDiscard={visibleWorkflowJob.status === 'paused'
              ? () => commandStudioJob(visibleWorkflowJob.id, 'cancel')
              : !visibleWorkflowJob.run && visibleWorkflowJob.status === 'failed' ? () => discardGenerationShell(visibleWorkflowJob.id) : undefined}
            wordMetadata={vocabularyMetadata}
          />
        ) : null}

        {boardMode === 'runs' && !generationSession && auditOpen && !visibleWorkflowJob && currentExchanges.length > 0 ? (
          <>
            {currentExchanges.map((exchange) => (
              <AuditLog exchange={exchange} key={exchange.id} />
            ))}
            {currentRun && runHasMissingAudio(currentRun) ? (
              <AuditAudioActionPanel
                run={currentRun}
                disabled={busy === `audio-all:${currentRun.id}`}
                onTryMaxAudio={() => regenerateAllAudio(currentRun.id)}
              />
            ) : null}
          </>
        ) : null}

        {showRunContent && currentRun ? <AnalyticsPanel analytics={currentRun.analytics} setNumber={currentRun.setNumber} label="Generation analytics" wordMetadata={metadataWithConversationReferences(vocabularyMetadata, currentRun.conversations)} conversations={currentRun.conversations} /> : null}

        {showLibraryContent && currentLibrarySet ? <AnalyticsPanel analytics={currentLibrarySet.analytics} setNumber={setNumber} label="Library analytics" wordMetadata={metadataWithConversationReferences(vocabularyMetadata, currentLibrarySet.conversations)} /> : null}

        {showLibraryContent && currentLibraryBalance ? (
          <section className="recommendationSummary" aria-label="Library balance plan">
            <div>
              <span>Balance Priority</span>
              <div className="miniChips coverage">
                {currentLibraryBalance.priorityWords.slice(0, 24).map((word) => (
                  <StudioWordChip className={coverageCountClass(word.libraryCount)} key={word.japanese} word={word.japanese} metadata={vocabularyMetadata.get(word.japanese)} adornment={<b>{word.libraryCount}</b>} />
                ))}
                {currentLibraryBalance.priorityWords.length === 0 ? <span>Balanced</span> : null}
              </div>
            </div>
            <div>
              <span>Plan</span>
              <strong>{currentLibraryBalance.suggestedConversationCount}</strong>
              <p>{currentLibraryBalance.zeroCount} zero - stdev {currentLibraryBalance.standardDeviation}</p>
            </div>
          </section>
        ) : null}

        {showRecommendationsContent ? (
          recommendationsLoading && !currentRecommendations ? (
            <div className="blankState">
              <RefreshCw className="spin" size={42} />
              <h3>Loading recommendations</h3>
            </div>
          ) : currentRecommendations ? (
            <>
              <section className="recommendationSummary" aria-label="Recommendation summary">
                <div>
                  <span>Least Covered</span>
                  <div className="miniChips coverage">
                    {currentRecommendations.leastCoveredWords.slice(0, 24).map((word) => (
                      <StudioWordChip className={coverageCountClass(word.libraryCount)} key={word.japanese} word={word.japanese} metadata={vocabularyMetadata.get(word.japanese)} adornment={<b>{word.libraryCount}</b>} />
                    ))}
                  </div>
                </div>
                <div>
                  <span>Queue</span>
                  <strong>{currentRecommendations.recommendations.length}</strong>
                  <p>{currentRecommendations.targetWordCount} Set {setNumber} words tracked</p>
                </div>
              </section>
              <SourceRunDistribution rows={recommendationSourceRunDistribution} />
              <div className="conversationGrid">
                {currentRecommendations.recommendations.map((recommendation) => renderConversationCard(recommendation.conversation, 'recommendation', undefined, recommendation))}
              </div>
            </>
          ) : (
            <div className="blankState">
              <Target size={42} />
              <h3>No Recommendations for Set {setNumber}</h3>
              <p>Generate more Set {setNumber} runs or remove already curated conversations from Library.</p>
            </div>
          )
        ) : null}

        {showAiCurationContent ? (
          aiCurationContextLoading || aiCurationHistoryLoading || (recommendationsLoading && !currentRecommendations) ? (
            <div className="blankState"><RefreshCw className="spin" size={42} /><h3>Loading curation context</h3></div>
          ) : aiCurationLoading ? (
            <div className="blankState">
              <RefreshCw className="spin" size={42} />
              <h3>AI is curating the portfolio</h3>
              <p>Reviewing every eligible conversation against the current Set {setNumber} library.</p>
            </div>
          ) : !currentAiCurationReview ? (
            <div className="blankState">
              <Sparkles size={42} />
              <h3>Ready for AI Curation</h3>
              <p>Choose a model and an exact portfolio size above, then start curation across all {aiCurationCandidateCount} eligible conversations.</p>
            </div>
          ) : currentAiCurationReview.status === 'failed' ? (
            <>
              <div className="errorBanner">
                <CircleAlert size={18} />
                <span>{currentAiCurationReview.error ?? 'AI curation failed.'}</span>
                {!isHistoricalAiCurationReview ? <button className="secondaryButton" onClick={() => runAiCuration(true)}>Retry</button> : null}
              </div>
              {currentAiCurationReview.llmExchanges.map((exchange) => <AuditLog exchange={exchange} key={exchange.id} />)}
            </>
          ) : currentAiCurationReview.stale && !isHistoricalAiCurationReview ? (
            <div className="blankState staleCuration">
              <CircleAlert size={42} />
              <h3>Saved curation is out of date</h3>
              <p>A candidate's learning content or the Set {setNumber} library changed. Re-run AI curation before using this portfolio.</p>
              <button className="primaryButton compact" onClick={() => runAiCuration()}><Sparkles size={17} />Re-curate</button>
            </div>
          ) : (
            <>
              {isHistoricalAiCurationReview ? (
                currentAiCurationReconciliation ? (
                  <AiCurationReconciliationPanel reconciliation={currentAiCurationReconciliation} stale={currentAiCurationReview.stale} />
                ) : (
                  <div className="historicalReviewNotice">
                    <Eye size={18} />
                    <span>This is a historical snapshot{currentAiCurationReview.stale ? ' with stale context' : ''}. Use Settings to prepare a new review with the same model and size, or continue with the reconciled remaining recommendations below.</span>
                  </div>
                )
              ) : null}
              <section className="aiCurationSummary" aria-label="AI curation summary">
                <div>
                  <div className="aiCurationSummaryHeader">
                    <span>Portfolio rationale</span>
                    <span className="aiCurationProvenance" title="AI curation provenance">
                      <Bot size={14} />
                      {currentAiCurationReview.textModel.label} · exactly {currentAiCurationReview.targetConversationCount} of {currentAiCurationReview.snapshot.candidateCount} · {(currentAiCurationReview.selectedRunIds ?? currentAiCurationReview.snapshot.selectedRunIds).length} source runs · evidence v{currentAiCurationReview.snapshot.evidenceVersion}
                    </span>
                  </div>
                  <p>{currentAiCurationReview.result?.summary}</p>
                </div>
              </section>
              <section className="recommendationSummary projectedCoverageSummary" aria-label="Projected portfolio coverage">
                <div>
                  <span>Current Least Covered</span>
                  <div className="miniChips coverage">
                    {currentRecommendations?.leastCoveredWords.slice(0, 24).map((word) => (
                      <StudioWordChip className={coverageCountClass(word.libraryCount)} key={word.japanese} word={word.japanese} metadata={vocabularyMetadata.get(word.japanese)} adornment={<b>{word.libraryCount}</b>} />
                    ))}
                  </div>
                </div>
                <div>
                  {isHistoricalAiCurationReview ? (
                    <select
                      aria-label="Projected coverage view"
                      className="coverageViewSelect"
                      onChange={(event) => setProjectedCoverageView(event.target.value as 'current' | 'original')}
                      value={projectedCoverageView}
                    >
                      <option value="current">After {aiCurationAddActionLabel}</option>
                      <option value="original">Original Snapshot</option>
                    </select>
                  ) : (
                    <span>After Add All</span>
                  )}
                  <div className="miniChips coverage">
                    {projectedCoverageWords.slice(0, 24).map((word) => (
                      <StudioWordChip className={coverageCountClass(word.projectedLibraryCount)} key={word.japanese} word={word.japanese} metadata={vocabularyMetadata.get(word.japanese)} adornment={<b>{word.projectedLibraryCount}</b>} />
                    ))}
                  </div>
                </div>
              </section>
              <WordFrequencyDistribution words={projectedCoverageWords} />
              {currentAiCurationReview.llmExchanges.map((exchange) => <AuditLog exchange={exchange} key={exchange.id} />)}
              {currentAiCurationReview.result?.recommendations.length ? (
                <>
                  <SourceRunDistribution rows={aiCurationSourceRunDistribution} />
                  <div className="conversationGrid">
                    {aiCurationVisibleRecommendations.map((recommendation) => {
                      const liveCandidate = currentRecommendations?.recommendations.find((candidate) => (
                        candidate.sourceRunId === recommendation.sourceRunId
                        && candidate.conversation.id === recommendation.sourceConversationId
                      ));
                      const sourceConversation = liveCandidate?.conversation
                        ?? runs.find((run) => run.id === recommendation.sourceRunId)?.conversations.find((conversation) => conversation.id === recommendation.sourceConversationId)
                        ?? { ...recommendation.conversation, status: 'draft' as const };
                      return renderConversationCard(
                        sourceConversation,
                        'recommendation',
                        recommendation,
                        undefined,
                        isHistoricalAiCurationReview
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="blankState"><Target size={42} /><h3>No conversations recommended</h3><p>The curator did not find a strong next addition.</p></div>
              )}
            </>
          )
        ) : null}

        {showLibraryContent ? (
          currentLibrarySet && currentLibrarySet.conversations.length > 0 ? (
            <>
              <SourceRunDistribution rows={librarySourceRunDistribution} />
              <div className="conversationGrid">
                {currentLibrarySet.conversations.map((conversation) => renderConversationCard(conversation, 'library'))}
              </div>
            </>
          ) : (
            <div className="blankState">
              <BookOpen size={42} />
              <h3>No Library items for Set {setNumber}</h3>
              <p>Generate audio from a run, then add conversations to Library.</p>
            </div>
          )
        ) : boardMode === 'runs' && !generationSession && !visibleWorkflowJob && !currentRun ? (
          <div className="blankState">
            <Disc3 size={42} />
            <h3>No batch selected</h3>
            <p>Choose a set, then open Generate to configure the next run.</p>
          </div>
        ) : showRunContent && currentRun ? (
          <div className="conversationGrid">
            {currentRun.conversations.map((conversation) => renderConversationCard(conversation, 'run'))}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function currentSide(): 'studio' | 'practice' {
  if (typeof window === 'undefined') return 'studio';
  return window.location.hash.startsWith('#/practice') ? 'practice' : 'studio';
}

export function App() {
  const [side, setSide] = useState(currentSide);

  useEffect(() => {
    const handleHashChange = () => setSide(currentSide());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    document.title = side === 'practice' ? 'Kiki JLPT Practice' : 'Kiki JLPT Studio';
  }, [side]);

  return side === 'practice' ? <Suspense fallback={null}><ConsumerApp /></Suspense> : <StudioApp />;
}
