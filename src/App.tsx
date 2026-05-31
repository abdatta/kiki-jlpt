import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  BookOpen,
  Check,
  CircleAlert,
  Disc3,
  Eye,
  Headphones,
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
  X
} from 'lucide-react';
import type {
  ApiError,
  CuratedConversation,
  CuratedSet,
  LibraryBalancePlan,
  LibraryRecommendationCandidate,
  LibraryRecommendations,
  LlmExchange,
  PracticeConversation,
  PracticeRun,
  RunAnalytics,
  SetSummary,
  TextModelInfo,
  WorkflowAuditNode,
  WorkflowJob,
  WorkflowStartResponse,
  WorkflowStatusResponse
} from '../shared/types.ts';
import { BrandLogo } from './components/BrandLogo.tsx';
import { ConsumerApp } from './consumer/ConsumerApp.tsx';

type ConversationAction = 'audio' | 'delete-audio';
type BoardMode = 'runs' | 'library' | 'recommendations';
type GenerateRunMode = 'workflow-max-audio' | 'workflow-audio' | 'workflow-text' | 'text-only';
type StudioRoute =
  | { boardMode: 'runs'; runId?: string; auditOpen: boolean }
  | { boardMode: 'recommendations'; setNumber: number }
  | { boardMode: 'library'; setNumber: number };
type BusyAction =
  | 'generate'
  | 'generate-complement'
  | 'workflow'
  | `audio-all:${string}`
  | `${ConversationAction}:${string}`
  | `save:${string}`
  | `library-add:${string}`
  | `library-remove:${string}`
  | 'publish-library'
  | `delete-run:${string}`
  | `reanalyze-run:${string}`
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
  runMode: GenerateRunMode;
}

interface GenerateRunConfig {
  setNumber: number;
  conversationCount: number;
  textModelId: string;
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

function studioRunsRoute(runId?: string, auditOpen = false): string {
  if (!runId) return '#/studio/runs';
  return `#/studio/runs/${encodeURIComponent(runId)}${auditOpen ? '/audit' : ''}`;
}

function studioQueueRoute(setNumber: number): string {
  return `#/studio/queue/set/${encodeURIComponent(setNumber)}`;
}

function studioLibraryRoute(setNumber: number): string {
  return `#/studio/library/set/${encodeURIComponent(setNumber)}`;
}

function parseStudioRoute(hash = typeof window === 'undefined' ? '' : window.location.hash): StudioRoute {
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

  if (parts[1] === 'runs' && (parts.length === 3 || (parts.length === 4 && parts[3] === 'audit'))) {
    const runId = decodeRoutePart(parts[2]);
    return runId ? { boardMode: 'runs', runId, auditOpen: parts[3] === 'audit' } : { boardMode: 'runs', auditOpen: false };
  }

  if (parts[1] === 'queue' && parts[2] === 'set' && parts.length === 4) {
    const setNumber = parsePositiveInt(parts[3]);
    return setNumber ? { boardMode: 'recommendations', setNumber } : { boardMode: 'runs', auditOpen: false };
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
  return nodes.map((node) => {
    if (node.kind !== 'audio') return node;

    const nodeIndex = Number(node.id.replace(/^audio-/, '')) - 1;
    const input = objectValue(node.input);
    const conversationId = typeof input?.conversationId === 'string' ? input.conversationId : undefined;
    const conversation = run.conversations.find((item) => item.id === conversationId) ?? run.conversations[nodeIndex];
    if (!conversation) return node;

    const baseNode: WorkflowAuditNode = {
      ...node,
      title: `Conversation ${nodeIndex + 1}`,
      input: {
        ...(input ?? {}),
        conversationId: conversation.id,
        conversationTitle: conversation.title
      }
    };
    const conversationAudioOutput = conversation.audioFileName && conversation.audioUrl
      ? {
        fileName: conversation.audioFileName,
        audioUrl: conversation.audioUrl
      }
      : undefined;

    if (conversationAudioOutput || node.status === 'done' || workflowAudioUrl(node)) {
      return {
        ...baseNode,
        status: 'done',
        output: node.output ?? conversationAudioOutput,
        error: undefined
      };
    }
    if (node.status === 'processing') {
      return { ...baseNode, status: 'processing', error: undefined };
    }
    if (node.status === 'error') {
      return {
        ...baseNode,
        status: 'error',
        output: undefined,
        error: node.error ?? conversation.error ?? 'Audio generation failed.'
      };
    }
    if (node.status === 'skipped') {
      return {
        ...baseNode,
        status: 'skipped',
        output: undefined,
        error: node.error
      };
    }
    if (conversation.status === 'audio_failed' || conversation.error) {
      return {
        ...baseNode,
        status: 'error',
        output: undefined,
        error: conversation.error ?? node.error ?? 'Audio generation failed.'
      };
    }

    return {
      ...baseNode,
      status: 'pending',
      output: undefined,
      error: undefined
    };
  });
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
    const status = hasProcessingAudio || (run.workflowAudit.status === 'running' && hasActiveAudioConversation && hasQueuedAudio)
      ? 'running'
      : audioErrors.length || hasIncompleteAudio
        ? 'failed'
        : run.workflowAudit.status;
    return {
      id: run.workflowAudit.jobId,
      status,
      setNumber: run.setNumber,
      primaryConversationCount: run.workflowAudit.primaryConversationCount,
      balanceConversationCount: run.workflowAudit.balanceConversationCount,
      requestedTotalConversationCount: run.workflowAudit.requestedTotalConversationCount,
      audioRequestedCount: run.workflowAudit.audioRequestedCount,
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
  const audioConversations = run.conversations.slice(0, 2).filter((conversation) => conversation.audioFileName || conversation.error);
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
    ...audioConversations.map((conversation, index) => ({
      id: `audio-${index + 1}`,
      kind: 'audio' as const,
      title: `Conversation ${index + 1}`,
      status: conversation.audioFileName ? 'done' as const : 'error' as const,
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
    status: nodes.some((node) => node.status === 'error') ? 'failed' : 'complete',
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

function shortModelLabel(model: TextModelInfo): string {
  const effort = model.reasoningEffort ? model.reasoningEffort.slice(0, 3) : undefined;
  if (model.provider === 'codex') {
    const match = /GPT[-\s]?([\d.]+)/i.exec(model.label) ?? /gpt-([\d.]+)/i.exec(model.model);
    const name = match ? `GPT-${match[1]}` : model.model.toUpperCase();
    return effort ? `${name} (${effort})` : name;
  }
  return model.model.replace(/^gemini-/i, 'Gemini ');
}

function runHistorySummary(run: PracticeRun): string {
  return `${run.conversations.length} convos · ${run.analytics.currentSetMissingCount} Missing · ${run.analytics.allowedVocabUsedPercentage}% Used · ${run.analytics.outOfAllowedCount} New`;
}

function libraryHistorySummary(set: CuratedSet): string {
  return `${set.conversations.length} convos · ${set.analytics.currentSetMissingCount} Missing · ${set.analytics.allowedVocabUsedPercentage}% Used · ${set.analytics.outOfAllowedCount} New`;
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

function WorkflowStatusIcon({ node, size = 18 }: { node: WorkflowAuditNode; size?: number }) {
  if (node.status === 'processing') return <RefreshCw className="spin" size={size} />;
  if (node.status === 'done') return <Check size={size} />;
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

function workflowAudioNeedsResume(nodes: WorkflowAuditNode[]): boolean {
  return nodes.some((node) => node.kind === 'audio' && node.status !== 'done');
}

function optimisticAudioRun(run: PracticeRun, mode: 'replace' | 'resume'): PracticeRun {
  const targetIds = new Set((mode === 'resume'
    ? run.conversations.filter((conversation) => conversation.status !== 'audio_ready' || !conversation.audioFileName)
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
        status: 'audio_generating',
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
  generatorNode
}: {
  selectedNode: WorkflowAuditNode;
  generatorNode?: WorkflowAuditNode;
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
            {recoveredWords.slice(0, 48).map((word) => <span key={word}>{word}</span>)}
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
          {analytics.currentSetMissingWords.slice(0, 48).map((word) => <span key={word}>{word}</span>)}
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
  tabs: Array<{ id: T; label: string }>;
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
  if (status === 'skipped') return 'Skipped';
  return status;
}

function WorkflowNodeButton({
  node,
  selected,
  onSelect
}: {
  node: WorkflowAuditNode;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button className={`workflowNode ${node.status} ${selected ? 'selected' : ''}`} onClick={onSelect} type="button">
      <span className="workflowNodeIcon">
        <WorkflowStatusIcon node={node} />
      </span>
      <span>
        <strong>{workflowNodeTitle(node)}</strong>
        <small>{workflowNodeDetail(node)}</small>
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
  const activeCount = nodes.filter((node) => node.status === 'processing').length;
  const doneCount = nodes.filter((node) => node.status === 'done').length;
  const failedCount = nodes.filter((node) => node.status === 'error').length;
  const skippedCount = nodes.filter((node) => node.status === 'skipped').length;
  const pendingCount = nodes.filter((node) => node.status === 'pending').length;
  const regenerateLabel = doneCount === nodes.length ? 'Regenerate all' : 'Generate missing';
  const audioListRef = useRef<HTMLDivElement | null>(null);
  const activeNodeIds = nodes.filter((node) => node.status === 'processing').map((node) => node.id).join('|');
  const audioStageTitle = activeCount > 0
    ? 'Generating Audio'
    : failedCount > 0
      ? 'Audio Generation Failed'
      : nodes.length > 0 && doneCount === nodes.length
        ? 'Generated Audio'
        : skippedCount > 0
          ? 'Audio Generation Stopped'
          : pendingCount > 0 && jobStatus !== 'running'
            ? 'Audio Generation Incomplete'
            : 'Generating Audio';

  useEffect(() => {
    const list = audioListRef.current;
    if (!activeNodeIds || !list) return;
    const activeNodeIdList = activeNodeIds.split('|');
    const lastActiveNodeId = activeNodeIdList[activeNodeIdList.length - 1];
    const activeItems = activeNodeIdList
      .map((nodeId) => list.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`))
      .filter((item): item is HTMLElement => Boolean(item));
    const lastActiveItem = activeItems[activeItems.length - 1];
    if (!lastActiveItem) return;

    requestAnimationFrame(() => {
      const listRect = list.getBoundingClientRect();
      const lastRect = lastActiveItem.getBoundingClientRect();
      const bottomOverflow = lastRect.bottom - listRect.bottom;
      if (bottomOverflow > 0) {
        list.scrollTo({
          top: Math.min(list.scrollHeight - list.clientHeight, list.scrollTop + bottomOverflow) + 5,
          behavior: 'smooth'
        });
      }
    });
  }, [activeNodeIds]);

  return (
    <section className="workflowAudioStage" aria-label={audioStageTitle}>
      <div className="workflowAudioStageHeader">
        <span className="workflowNodeIcon">
          {activeCount > 0 ? <LoaderCircle className="spin" size={18} /> : <Headphones size={18} />}
        </span>
        <div>
          <strong>{audioStageTitle}</strong>
          <small>{doneCount} of {nodes.length} audio conversations done</small>
        </div>
        {onRegenerateAudio ? (
          <button className="workflowAudioRefreshButton" disabled={regenerateDisabled} onClick={onRegenerateAudio} type="button">
            {regenerateDisabled ? <RefreshCw className="spin" size={14} /> : <RefreshCw size={14} />}
            {regenerateLabel}
          </button>
        ) : null}
      </div>
      {nodes.length > 0 ? (
        <div className="workflowAudioList" ref={audioListRef}>
          {nodes.map((node, index) => (
            <button
              className={`workflowAudioItem ${node.status} ${selectedNodeId === node.id ? 'selected' : ''}`}
              data-node-id={node.id}
              key={node.id}
              onClick={() => onSelectNode(node.id)}
              type="button"
            >
              <span className="workflowAudioItemNumber">{index + 1}</span>
              <span className="workflowAudioItemText">
                <strong>{workflowNodeTitle(node)}</strong>
                <small>{workflowNodeDetail(node)}</small>
              </span>
              <span className="workflowAudioItemIcon" aria-hidden="true">
                <WorkflowStatusIcon node={node} size={15} />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="workflowAudioListEmpty">Audio skipped</div>
      )}
    </section>
  );
}

function WorkflowAuditFlow({
  job,
  selectedNodeId,
  onSelectNode,
  onRegenerateAudio,
  regenerateAudioDisabled
}: {
  job: WorkflowJob;
  selectedNodeId?: string;
  onSelectNode: (nodeId: string) => void;
  onRegenerateAudio?: () => void;
  regenerateAudioDisabled?: boolean;
}) {
  const [inputTab, setInputTab] = useState<'prompt' | 'settings'>('prompt');
  const [outputTab, setOutputTab] = useState<'response' | 'metadata'>('response');
  const generator = job.nodes.find((node) => node.id === 'generator');
  const balancer = job.nodes.find((node) => node.id === 'balancer');
  const audioNodes = job.nodes.filter((node) => node.kind === 'audio');
  const selectedNode = selectedNodeId ? job.nodes.find((node) => node.id === selectedNodeId) : undefined;
  const selectedInput = splitPromptFromAuditValue(selectedNode?.input);
  const selectedOutput = splitResponseFromAuditValue(selectedNode?.output);
  const selectedAudioUrl = selectedNode?.kind === 'audio' ? workflowAudioUrl(selectedNode) : undefined;
  const selectedOutputMetadata = selectedNode?.kind === 'audio'
    ? omitStringPropertiesDeep(selectedNode.output, ['audioUrl'])
    : selectedOutput.value;
  const selectedPrompt = selectedInput.prompt;
  const isOutputPending = selectedNode?.status === 'pending' || selectedNode?.status === 'processing';

  useEffect(() => {
    setInputTab('prompt');
    setOutputTab('response');
  }, [selectedNodeId]);

  return (
    <section className={`workflowPanel ${job.status}`} aria-label="End-to-end workflow audit">
      <div className="workflowHeader">
        <div>
          <p className="eyebrow">Live LLM pipeline</p>
          <h3>Initial set to balance to audio</h3>
          <p>{pluralize(job.primaryConversationCount, 'primary conversation')} + {pluralize(job.balanceConversationCount, 'balanced conversation')} - {workflowAudioSummary(job.audioRequestedCount)}</p>
        </div>
        <span className={`workflowJobStatus ${job.status}`}>
          {job.status === 'running' ? <LoaderCircle className="spin" size={15} /> : job.status === 'failed' ? <CircleAlert size={15} /> : <Sparkles size={15} />}
          {job.status}
        </span>
      </div>

      <div className="workflowGraph">
        {generator ? <WorkflowNodeButton node={generator} selected={selectedNode?.id === generator.id} onSelect={() => onSelectNode(generator.id)} /> : null}
        <span className="workflowArrow" aria-hidden="true">&rarr;</span>
        {balancer ? <WorkflowNodeButton node={balancer} selected={selectedNode?.id === balancer.id} onSelect={() => onSelectNode(balancer.id)} /> : null}
        <span className="workflowArrow branch" aria-hidden="true">&rarr;</span>
        <WorkflowAudioStage
          nodes={audioNodes}
          jobStatus={job.status}
          selectedNodeId={selectedNode?.id}
          onSelectNode={onSelectNode}
          onRegenerateAudio={onRegenerateAudio}
          regenerateDisabled={regenerateAudioDisabled}
        />
      </div>

      {selectedNode ? (
        <section className="workflowInspector" aria-label={`${workflowNodeTitle(selectedNode)} audit details`}>
          <div className="workflowInspectorHeader">
            <span>{workflowNodeTitle(selectedNode)}</span>
            <small>{workflowStatusText(selectedNode.status)}</small>
          </div>
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
          <section className="workflowTabbedBlock" aria-label="Output details">
            <div className="workflowTabbedHeader">
              <span>Output</span>
              <WorkflowTabs
                active={outputTab}
                onChange={setOutputTab}
                tabs={[
                  { id: 'response', label: 'Response' },
                  { id: 'metadata', label: 'Metadata' }
                ]}
              />
            </div>
            <div className="workflowTabPane">
              {outputTab === 'response' ? (
                selectedNode.error ? (
                  <pre>{selectedNode.error}</pre>
                ) : selectedAudioUrl ? (
                  <WorkflowAudioResponse audioUrl={selectedAudioUrl} />
                ) : selectedOutput.response ? (
                  <pre className="workflowPromptText">{selectedOutput.response}</pre>
                ) : isOutputPending ? (
                  <PendingAuditOutput label="Waiting for model output" />
                ) : (
                  <EmptyAuditPane label="No response text was returned for this node." />
                )
              ) : selectedNode.error ? (
                <pre>{formatAuditValue({ error: selectedNode.error })}</pre>
              ) : selectedOutputMetadata === undefined && isOutputPending ? (
                <PendingAuditOutput label="Waiting for output metadata" />
              ) : selectedOutputMetadata === undefined ? (
                <EmptyAuditPane label="No output metadata was captured for this node." />
              ) : (
                <pre>{formatAuditValue(selectedOutputMetadata)}</pre>
              )}
            </div>
          </section>
          <WorkflowStatsPanel selectedNode={selectedNode} generatorNode={generator} />
        </section>
      ) : null}
    </section>
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
          <strong>{exchange?.model ?? fallbackLabel ?? 'Pending'}</strong>
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

      {exchange?.stats ? (
        <div className="auditBlock">
          <span>Stats</span>
          <pre>{JSON.stringify(exchange.stats, null, 2)}</pre>
        </div>
      ) : null}
    </details>
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

function GenerateModal({
  state,
  sets,
  textModels,
  busy,
  onChange,
  onClose,
  onSubmit
}: {
  state: GenerateModalState;
  sets: SetSummary[];
  textModels: TextModelInfo[];
  busy: BusyAction;
  onChange: (state: GenerateModalState) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const selectedSet = sets.find((item) => item.set === state.setNumber);
  const conversationCount = Number(state.conversationCount);
  const isWorkflowMode = state.runMode !== 'text-only';
  const minConversationCount = isWorkflowMode ? 6 : 4;
  const placeholder = isWorkflowMode ? 'Select 6-30' : 'Select 4-30';
  const canSubmit = busy === null
    && Number.isInteger(conversationCount)
    && conversationCount >= minConversationCount
    && conversationCount <= 30
    && state.textModelId.length > 0;

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
            <select value={state.setNumber} onChange={(event) => onChange({ ...state, setNumber: Number(event.target.value) })}>
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
              max={30}
              placeholder={placeholder}
              type="number"
              value={state.conversationCount}
              onChange={(event) => onChange({ ...state, conversationCount: event.target.value })}
            />
          </label>

          <label className="modalWideField">
            <span>Text model</span>
            <select value={state.textModelId} onChange={(event) => onChange({ ...state, textModelId: event.target.value })}>
              <option value="" disabled>Select a model</option>
              {textModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
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

        <div className="modalActions">
          <button className="secondaryButton" onClick={onClose} disabled={busy !== null} type="button">
            Cancel
          </button>
          <button className="primaryButton" onClick={onSubmit} disabled={!canSubmit} type="button">
            {busy === 'generate' || busy === 'workflow' ? <RefreshCw className="spin" size={18} /> : <Sparkles size={18} />}
            Generate
          </button>
        </div>
      </section>
    </div>
  );
}

function AnalyticsPanel({ analytics, setNumber, label }: { analytics: PracticeRun['analytics']; setNumber: number; label: string }) {
  return (
    <section className="analyticsPanel" aria-label={label}>
      <div className="analyticsCard">
        <span>Current Set Missing</span>
        <strong>{analytics.currentSetMissingCount}</strong>
        <p>{analytics.currentSetUsedCount} of {analytics.currentSetTotal} Set {setNumber} words used</p>
        <div className="miniChips">
          {analytics.currentSetMissingWords.length === 0 ? <span>None</span> : null}
          {analytics.currentSetMissingWords.slice(0, 40).map((word) => (
            <span key={word}>{word}</span>
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
        <span>New Words Introduced</span>
        <strong>{analytics.outOfAllowedCount}</strong>
        <p>Words not found in allowed Sets 1-{setNumber}</p>
        <div className="miniChips warning">
          {analytics.outOfAllowedWords.length === 0 ? <span>None</span> : null}
          {analytics.outOfAllowedWords.map((word) => (
            <span key={word}>{word}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

function StudioApp() {
  const [studioRoute, setStudioRoute] = useState(parseStudioRoute);
  const [sets, setSets] = useState<SetSummary[]>([]);
  const [runs, setRuns] = useState<PracticeRun[]>([]);
  const [librarySets, setLibrarySets] = useState<CuratedSet[]>([]);
  const [recommendations, setRecommendations] = useState<LibraryRecommendations | null>(null);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [libraryBalance, setLibraryBalance] = useState<LibraryBalancePlan | null>(null);
  const [libraryBalanceLoading, setLibraryBalanceLoading] = useState(false);
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
  const [workflowJob, setWorkflowJob] = useState<WorkflowJob | null>(null);
  const [selectedWorkflowNodeId, setSelectedWorkflowNodeId] = useState<string | undefined>();
  const [auditOpen, setAuditOpen] = useState(studioRoute.boardMode === 'runs' && studioRoute.auditOpen);
  const [revealedAnswers, setRevealedAnswers] = useState<Record<string, boolean>>({});
  const [revealedTranslations, setRevealedTranslations] = useState<Record<string, boolean>>({});
  const [audioStates, setAudioStates] = useState<Record<string, AudioPlaybackState>>({});
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});

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
  const currentCuratedLibrarySets = useMemo(() => currentLibrarySet && currentLibrarySet.conversations.length > 0 ? [currentLibrarySet] : [], [currentLibrarySet]);
  const currentRecommendations = recommendations?.setNumber === setNumber ? recommendations : null;
  const leastCoveredWordSet = useMemo(() => new Set(currentRecommendations?.leastCoveredWords.map((word) => word.japanese) ?? []), [currentRecommendations]);
  const showRunContent = Boolean(boardMode === 'runs' && currentRun && currentRun.setNumber === setNumber && !generationSession && !workflowJob);
  const showLibraryContent = Boolean(boardMode === 'library' && !generationSession);
  const showRecommendationsContent = Boolean(boardMode === 'recommendations' && !generationSession);
  const currentExchanges = currentRun?.llmExchanges ?? [];
  const currentExchange = currentExchanges[0];
  const savedWorkflowJob = useMemo(() => workflowJobForRun(currentRun), [currentRun]);
  const visibleWorkflowJob = workflowJob ?? (auditOpen ? savedWorkflowJob : null);

  function applyRunGeneratorDefaults(run: PracticeRun) {
    setSetNumber(run.setNumber);
    setTextModelId(run.textModel.id);
  }

  async function loadInitial() {
    const [setPayload, runPayload, modelPayload, libraryPayload] = await Promise.all([
      api<{ sets: SetSummary[] }>('/api/sets'),
      api<{ runs: PracticeRun[] }>('/api/runs'),
      api<{ models: TextModelInfo[] }>('/api/text-models'),
      api<{ sets: CuratedSet[] }>('/api/library')
    ]);
    setSets(setPayload.sets);
    setRuns(runPayload.runs);
    setTextModels(modelPayload.models);
    setLibrarySets(libraryPayload.sets);
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
    const handleHashChange = () => setStudioRoute(parseStudioRoute());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    setBoardMode(studioRoute.boardMode);
    setGenerationSession(null);
    setWorkflowJob(null);
    setSelectedWorkflowNodeId(undefined);
    setEdit(null);

    if (studioRoute.boardMode === 'runs') {
      setAuditOpen(studioRoute.auditOpen);
      return;
    }

    setAuditOpen(false);
    setSetNumber(studioRoute.setNumber);
  }, [studioRoute]);

  useEffect(() => {
    if (studioRoute.boardMode !== 'runs') return;
    if (!studioRoute.runId) {
      const nextRun = runs[0] ?? null;
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

    setCurrentRun(null);
    refreshRun(studioRoute.runId).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [currentRun, runs, setNumber, studioRoute]);

  useEffect(() => {
    if (boardMode === 'recommendations' && !generationSession) {
      loadRecommendations().catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
    }
  }, [boardMode, generationSession, setNumber]);

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
    if (boardMode === 'recommendations') {
      navigateToStudioRoute(studioQueueRoute(nextSetNumber));
    } else if (boardMode === 'library') {
      navigateToStudioRoute(studioLibraryRoute(nextSetNumber));
    } else {
      const nextRun = runs.find((run) => run.setNumber === nextSetNumber) ?? null;
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

  function toggleAuditRoute() {
    if (!currentRun) return;
    navigateToRun(currentRun.id, !auditOpen);
  }

  function openGenerateModal() {
    setError(null);
    setGenerateModal(initialGenerateModalState(setNumber));
  }

  async function submitGenerateModal() {
    if (!generateModal) return;
    const nextConversationCount = Number(generateModal.conversationCount);
    const minConversationCount = generateModal.runMode === 'text-only' ? 4 : 6;
    if (!Number.isInteger(nextConversationCount) || nextConversationCount < minConversationCount || nextConversationCount > 30 || !generateModal.textModelId) {
      setError('Choose a set, conversation count, model, and run type before generating.');
      return;
    }

    const config: GenerateRunConfig = {
      setNumber: generateModal.setNumber,
      conversationCount: nextConversationCount,
      textModelId: generateModal.textModelId
    };
    setSetNumber(config.setNumber);
    setConversationCount(config.conversationCount);
    setTextModelId(config.textModelId);
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
    const requestBody = config;
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

      const payload = await api<{ run: PracticeRun }>('/api/generate', {
        method: 'POST',
        body: JSON.stringify(requestBody)
      });
      setCurrentRun(payload.run);
      setBoardMode('runs');
      setGenerationSession(null);
      await loadInitial();
      navigateToRun(payload.run.id);
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
    const requestBody = { ...config, audioCount, audioMode };
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

      let latest = started.job;
      while (latest.status === 'running') {
        await new Promise((resolve) => setTimeout(resolve, 700));
        const payload = await api<WorkflowStatusResponse>(`/api/workflow/jobs/${encodeURIComponent(started.job.id)}`);
        latest = payload.job;
        setWorkflowJob(latest);
      }

      if (latest.run) {
        setCurrentRun(latest.run);
        await loadInitial();
        await refreshRun(latest.run.id).catch(() => undefined);
        navigateToRun(latest.run.id);
      }
      if (latest.audioErrors.length > 0) {
        setError(`Pipeline finished, but ${latest.audioErrors.length} audio file${latest.audioErrors.length === 1 ? '' : 's'} failed to generate.`);
      } else if (latest.status === 'failed') {
        setError(latest.error ?? 'Pipeline failed.');
      }
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

  async function generateLibraryComplement() {
    const sessionId = makeSessionId();
    const modelLabel = currentTextModel?.label ?? (textModelId === 'gemini' ? 'Gemini' : textModelId);
    const requestBody = { textModelId };
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
      detail: `Set ${setNumber} - choosing a small complementary batch - ${modelLabel}`,
      setNumber,
      conversationCount: currentLibraryBalance?.suggestedConversationCount ?? 0,
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

      const payload = await api<{ run: PracticeRun; balance: LibraryBalancePlan }>(`/api/library/sets/${encodeURIComponent(setNumber)}/complement`, {
        method: 'POST',
        body: JSON.stringify(requestBody)
      });
      setLibraryBalance(payload.balance);
      setCurrentRun(payload.run);
      setBoardMode('runs');
      setGenerationSession(null);
      await loadInitial();
      navigateToRun(payload.run.id);
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
    const payload = await api<{ run: PracticeRun }>(`/api/runs/${encodeURIComponent(runId)}`);
    setCurrentRun(payload.run);
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
        const nextRun = payload.runs[0] ?? null;
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
      const payload = await api<{ run: PracticeRun }>(`/api/runs/${encodeURIComponent(currentRun.id)}/reanalyze`, { method: 'POST' });
      setCurrentRun(payload.run);
      setRuns((existing) => [payload.run, ...existing.filter((run) => run.id !== payload.run.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  async function reanalyzeCurrentLibrarySet() {
    const marker = `reanalyze-library:${setNumber}` as BusyAction;
    setBusy(marker);
    setError(null);
    try {
      const payload = await api<{ set: CuratedSet }>(`/api/library/sets/${encodeURIComponent(setNumber)}/reanalyze`, { method: 'POST' });
      setLibrarySets((existing) => [payload.set, ...existing.filter((set) => set.setNumber !== payload.set.setNumber)].sort((a, b) => a.setNumber - b.setNumber));
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
        { method: action === 'delete-audio' ? 'DELETE' : 'POST' }
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
    const sourceNodes = visibleWorkflowJob?.run?.id === runId ? visibleWorkflowJob.nodes : workflowJobForRun(sourceRun)?.nodes ?? [];
    const mode: 'replace' | 'resume' = workflowAudioNeedsResume(sourceNodes) ? 'resume' : 'replace';
    const confirmation = mode === 'replace'
      ? 'Regenerate all audio for this run? Existing audio files will be replaced.'
      : 'Generate audio for unfinished conversations? Existing successful audio will be kept.';
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
    let audioRequestSettled = false;
    const applyLatestRun = (latestRun: PracticeRun) => {
      setCurrentRun((previous) => previous?.id === latestRun.id ? latestRun : previous);
      setRuns((existing) => [latestRun, ...existing.filter((run) => run.id !== latestRun.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setWorkflowJob(null);
      setAuditOpen(true);
    };
    const pollRunWhileGenerating = async () => {
      while (!audioRequestSettled) {
        await delay(700);
        if (audioRequestSettled) return;
        try {
          const latest = await api<{ run: PracticeRun }>(`/api/runs/${encodeURIComponent(runId)}`);
          applyLatestRun(latest.run);
        } catch {
          // The final request handles user-visible errors; transient polling failures can be ignored.
        }
      }
    };
    const polling = pollRunWhileGenerating();
    try {
      const payload = await api<{ run: PracticeRun }>(`/api/runs/${encodeURIComponent(runId)}/audio`, {
        method: 'POST',
        body: JSON.stringify({ mode })
      }).finally(() => {
        audioRequestSettled = true;
      });
      await polling;
      applyLatestRun(payload.run);
    } catch (caught) {
      audioRequestSettled = true;
      await polling;
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
    recommendation?: LibraryRecommendationCandidate
  ) {
    const sourceRunId = recommendation?.sourceRunId ?? (source === 'run' ? currentRun?.id : undefined);
    const itemKey = actionKey(sourceRunId, conversation.id);
    const isEditing = source === 'run' && edit?.conversationId === conversation.id;
    const isLibraryCard = source === 'library';
    const isRecommendationCard = source === 'recommendation';
    const isReadonly = isLibraryCard || Boolean(conversation.curatedId);
    const canAddToLibrary = source === 'run' && conversation.status === 'audio_ready' && Boolean(conversation.audioFileName);
    const canAddRecommendationToLibrary = isRecommendationCard && conversation.status === 'audio_ready' && Boolean(conversation.audioFileName);
    const isAudioBusy = busy === `audio:${itemKey}` || conversation.status === 'audio_generating';
    const isDeleteBusy = busy === `delete-audio:${itemKey}`;
    const currentAudioSrc = audioSrc(conversation);
    const hasAudio = Boolean(currentAudioSrc);
    const recommendationWordIncreases = recommendation ? wordFrequency(conversation.vocabularyUsed) : new Map<string, number>();
    const recommendationCoverageWords = recommendation?.leastCoveredWords.filter((word) => leastCoveredWordSet.has(word.japanese)) ?? [];

    return (
      <article className={isReadonly ? 'conversationCard readonly' : 'conversationCard'} key={itemKey}>
        <div className="cardHeader">
          <div>
            <span className="conversationNumber">Conversation {conversation.number}</span>
            <h3>{conversation.title}</h3>
          </div>
          <span className={`statusPill ${conversation.status}`}>{isLibraryCard ? 'in library' : isRecommendationCard ? `score ${recommendation?.score ?? 0}` : statusLabel(conversation.status)}</span>
        </div>

        {recommendation ? (
          <div className="recommendationMeta">
            <div>
              <span>Uncovered</span>
              <strong>{recommendation.uncoveredWordCount}</strong>
            </div>
            <div>
              <span>Target Words</span>
              <strong>{recommendation.targetWordCount}</strong>
            </div>
            <div>
              <span>Run</span>
              <strong>{formatRunTime(recommendation.sourceRunCreatedAt)}</strong>
            </div>
          </div>
        ) : null}

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

            <div className="vocabChips warning">
              {conversation.outOfVocabularyAudit.length === 0 ? <span>None</span> : null}
              {conversation.outOfVocabularyAudit.map((word) => (
                <span key={word}>{word}</span>
              ))}
            </div>

            {recommendation ? (
              <div className="vocabChips coverage">
                {recommendationCoverageWords.slice(0, 12).map((word) => (
                  <span className={coverageCountClass(word.libraryCount)} key={word.japanese}>
                    {word.japanese}
                    <b>{recommendationWordIncreases.get(word.japanese) ?? 1}</b>
                  </span>
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
                    title={isReadonly ? 'Remove it from Library before regenerating audio.' : 'Regenerate audio'}
                  >
                    {isAudioBusy ? <RefreshCw className="spin" size={17} /> : <RefreshCw size={17} />}
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
                        disabled={!(canAddToLibrary || canAddRecommendationToLibrary) || busy === `library-add:${itemKey}`}
                        title={canAddToLibrary || canAddRecommendationToLibrary ? 'Add to Library' : 'Generate audio before adding to Library'}
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
                  >
                    {isAudioBusy ? <RefreshCw className="spin" size={17} /> : <Headphones size={17} />}
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
      {generateModal ? (
        <GenerateModal
          state={generateModal}
          sets={sets}
          textModels={textModels}
          busy={busy}
          onChange={setGenerateModal}
          onClose={() => setGenerateModal(null)}
          onSubmit={submitGenerateModal}
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
          <label>
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

          <button className="primaryButton" onClick={openGenerateModal} disabled={busy !== null}>
            {busy === 'generate' || busy === 'workflow' ? <RefreshCw className="spin" size={18} /> : <Sparkles size={18} />}
            Generate
          </button>
        </section>

        <div className="boardTabs" aria-label="Boards">
          <a className={boardMode === 'runs' ? 'active' : ''} href={studioRunsRoute(currentRun?.setNumber === setNumber ? currentRun.id : filteredRuns[0]?.id)}>
            <ListMusic size={16} />
            Runs
          </a>
          <a className={boardMode === 'recommendations' ? 'active' : ''} href={studioQueueRoute(setNumber)}>
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
          {filteredRuns.length === 0 ? <p className="emptyText">No generated runs for Set {setNumber}.</p> : null}
          {filteredRuns.map((run) => (
            <a
              key={run.id}
              className={`runButton ${boardMode === 'runs' && currentRun?.id === run.id ? 'active' : ''}`}
              href={studioRunsRoute(run.id)}
            >
              <span className="runButtonHeader">
                <span>{formatRunHistoryTitle(run.createdAt)}</span>
                <time dateTime={run.createdAt}>{shortModelLabel(run.textModel)}</time>
              </span>
              <small>{runHistorySummary(run)}</small>
            </a>
          ))}
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
              <span className="runButtonHeader">
                <span>{formatRunHistoryTitle(set.updatedAt)}</span>
                <time dateTime={set.updatedAt}>Set {set.setNumber}</time>
              </span>
              <small>{libraryHistorySummary(set)}</small>
            </a>
          ))}
        </section>
      </aside>

      <section className="workspace">
        <header className="topBar">
          <div>
            <p className="eyebrow">{workflowJob ? 'Live pipeline audit' : visibleWorkflowJob ? 'Saved pipeline audit' : generationSession ? 'Generate, inspect, review' : boardMode === 'library' ? 'Curated listening shelf' : boardMode === 'recommendations' ? 'Coverage recommendation queue' : 'Generate, edit, synthesize'}</p>
            <h2>
              {visibleWorkflowJob
                ? `Set ${visibleWorkflowJob.setNumber} workflow`
                : generationSession
                ? `Set ${generationSession.setNumber} generation`
                : boardMode === 'library'
                  ? `Set ${setNumber} Library`
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
            <div className="runStats">
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
              <button className="auditToggle" onClick={generateLibraryComplement} disabled={busy === 'generate-complement' || libraryBalanceLoading}>
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
              <button className="auditToggle" onClick={() => loadRecommendations()} disabled={recommendationsLoading}>
                {recommendationsLoading ? <RefreshCw className="spin" size={15} /> : <RefreshCw size={15} />}
                Refresh
              </button>
            </div>
          ) : currentRun ? (
            <div className="runStats">
              <span>{currentRun.allowedVocabCount} allowed words</span>
              <span>{currentRun.textModel.label}</span>
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
            onSelectNode={setSelectedWorkflowNodeId}
            onRegenerateAudio={visibleWorkflowJob.run && visibleWorkflowJob.status !== 'running' ? () => regenerateAllAudio(visibleWorkflowJob.run?.id) : undefined}
            regenerateAudioDisabled={Boolean(visibleWorkflowJob.run && busy === `audio-all:${visibleWorkflowJob.run.id}`)}
          />
        ) : null}

        {boardMode === 'runs' && !generationSession && auditOpen && !visibleWorkflowJob && currentExchanges.length > 0 ? (
          <>
            {currentExchanges.map((exchange) => (
              <AuditLog exchange={exchange} key={exchange.id} />
            ))}
          </>
        ) : null}

        {showRunContent && currentRun ? <AnalyticsPanel analytics={currentRun.analytics} setNumber={currentRun.setNumber} label="Generation analytics" /> : null}

        {showLibraryContent && currentLibrarySet ? <AnalyticsPanel analytics={currentLibrarySet.analytics} setNumber={setNumber} label="Library analytics" /> : null}

        {showLibraryContent && currentLibraryBalance ? (
          <section className="recommendationSummary" aria-label="Library balance plan">
            <div>
              <span>Balance Priority</span>
              <div className="miniChips coverage">
                {currentLibraryBalance.priorityWords.slice(0, 24).map((word) => (
                  <span className={coverageCountClass(word.libraryCount)} key={word.japanese}>
                    {word.japanese}
                    <b>{word.libraryCount}</b>
                  </span>
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
          ) : currentRecommendations && currentRecommendations.recommendations.length > 0 ? (
            <>
              <section className="recommendationSummary" aria-label="Recommendation summary">
                <div>
                  <span>Least Covered</span>
                  <div className="miniChips coverage">
                    {currentRecommendations.leastCoveredWords.slice(0, 24).map((word) => (
                      <span className={coverageCountClass(word.libraryCount)} key={word.japanese}>
                        {word.japanese}
                        <b>{word.libraryCount}</b>
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <span>Queue</span>
                  <strong>{currentRecommendations.recommendations.length}</strong>
                  <p>{currentRecommendations.targetWordCount} Set {setNumber} words tracked</p>
                </div>
              </section>
              <div className="conversationGrid">
                {currentRecommendations.recommendations.map((recommendation) => renderConversationCard(recommendation.conversation, 'recommendation', recommendation))}
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

        {showLibraryContent ? (
          currentLibrarySet && currentLibrarySet.conversations.length > 0 ? (
            <div className="conversationGrid">
              {currentLibrarySet.conversations.map((conversation) => renderConversationCard(conversation, 'library'))}
            </div>
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

  return side === 'practice' ? <ConsumerApp /> : <StudioApp />;
}
