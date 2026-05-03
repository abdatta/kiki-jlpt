import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Check,
  CircleAlert,
  Disc3,
  Eye,
  FileAudio,
  Languages,
  LoaderCircle,
  ListMusic,
  Pencil,
  Play,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  X
} from 'lucide-react';
import type { ApiError, LlmExchange, PracticeConversation, PracticeRun, SetSummary, TextModelInfo } from '../shared/types.ts';
import { ConsumerApp } from './consumer/ConsumerApp.tsx';

type ConversationAction = 'approve' | 'reject' | 'audio' | 'delete-audio';
type BusyAction = 'generate' | `${ConversationAction}:${string}` | `save:${string}` | null;

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
  setNumber: number;
  conversationCount: number;
  textModelLabel: string;
  startedAt: string;
  completedAt?: string;
  status: GenerationSessionStatus;
  exchange?: LlmExchange;
  error?: string;
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

function transcriptForEdit(conversation: PracticeConversation): string {
  return conversation.text.map((line) => `${line.speaker}: [${line.tags.join(', ')}] ${line.japanese}`).join('\n');
}

function statusLabel(status: PracticeConversation['status']): string {
  return status.replaceAll('_', ' ');
}

function makeSessionId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `generation-${Date.now()}`;
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
          <h3>{session.status === 'failed' ? 'Generation failed' : 'Generating a new listening set'}</h3>
          <p>Set {session.setNumber} - {session.conversationCount} conversations - {session.textModelLabel}</p>
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

function StudioApp() {
  const [sets, setSets] = useState<SetSummary[]>([]);
  const [runs, setRuns] = useState<PracticeRun[]>([]);
  const [currentRun, setCurrentRun] = useState<PracticeRun | null>(null);
  const [textModels, setTextModels] = useState<TextModelInfo[]>([]);
  const [textModelId, setTextModelId] = useState('gemini');
  const [setNumber, setSetNumber] = useState(1);
  const [conversationCount, setConversationCount] = useState(4);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [generationSession, setGenerationSession] = useState<GenerationSession | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [revealedAnswers, setRevealedAnswers] = useState<Record<string, boolean>>({});
  const [revealedTranslations, setRevealedTranslations] = useState<Record<string, boolean>>({});

  const currentSet = useMemo(() => sets.find((item) => item.set === setNumber), [sets, setNumber]);
  const currentTextModel = useMemo(() => textModels.find((model) => model.id === textModelId), [textModels, textModelId]);
  const showRunContent = Boolean(currentRun && !generationSession);
  const currentExchange = currentRun?.llmExchanges?.[0];

  async function loadInitial() {
    const [setPayload, runPayload, modelPayload] = await Promise.all([
      api<{ sets: SetSummary[] }>('/api/sets'),
      api<{ runs: PracticeRun[] }>('/api/runs'),
      api<{ models: TextModelInfo[] }>('/api/text-models')
    ]);
    setSets(setPayload.sets);
    setRuns(runPayload.runs);
    setTextModels(modelPayload.models);
    setTextModelId((previous) => modelPayload.models.some((model) => model.id === previous) ? previous : 'gemini');
    setCurrentRun((previous) => previous ?? runPayload.runs[0] ?? null);
  }

  useEffect(() => {
    loadInitial().catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, []);

  useEffect(() => {
    setRevealedAnswers({});
    setRevealedTranslations({});
  }, [currentRun?.id]);

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

  async function generate() {
    const sessionId = makeSessionId();
    const modelLabel = currentTextModel?.label ?? (textModelId === 'gemini' ? 'Gemini' : textModelId);
    const requestBody = { setNumber, conversationCount, textModelId };
    setBusy('generate');
    setError(null);
    setEdit(null);
    setAuditOpen(false);
    setCurrentRun(null);
    setGenerationSession({
      id: sessionId,
      setNumber,
      conversationCount,
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
      setGenerationSession(null);
      await loadInitial();
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
    setRuns((existing) => [payload.run, ...existing.filter((run) => run.id !== payload.run.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  async function runAction(conversationId: string, action: ConversationAction) {
    if (!currentRun) return;
    if (action === 'delete-audio' && !window.confirm('Delete this generated audio? You can regenerate it afterward.')) {
      return;
    }

    const marker = `${action}:${conversationId}` as BusyAction;
    setBusy(marker);
    setError(null);
    try {
      const routeAction = action === 'delete-audio' ? 'audio' : action;
      const payload = await api<{ run: PracticeRun }>(
        `/api/runs/${encodeURIComponent(currentRun.id)}/conversations/${encodeURIComponent(conversationId)}/${routeAction}`,
        { method: action === 'delete-audio' ? 'DELETE' : 'POST' }
      );
      setCurrentRun(payload.run);
      await loadInitial();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      await refreshRun(currentRun.id).catch(() => undefined);
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

  return (
    <main className="appShell">
      <aside className="sideBar">
        <div className="brand">
          <ListMusic size={26} />
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
            <select value={setNumber} onChange={(event) => setSetNumber(Number(event.target.value))}>
              {sets.map((set) => (
                <option key={set.set} value={set.set}>
                  Set {set.set}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Conversations</span>
            <input min={4} max={30} type="number" value={conversationCount} onChange={(event) => setConversationCount(Number(event.target.value))} />
          </label>

          <label>
            <span>Text model</span>
            <select value={textModelId} onChange={(event) => setTextModelId(event.target.value)}>
              {textModels.length === 0 ? <option value="gemini">Gemini</option> : null}
              {textModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>

          <div className="setMeta">
            <strong>{currentSet?.theme ?? 'Vocabulary set'}</strong>
            <span>{currentSet ? `${currentSet.cumulativeCount} allowed words through Set ${currentSet.set}` : 'Loading vocab'}</span>
          </div>

          <button className="primaryButton" onClick={generate} disabled={busy === 'generate'}>
            {busy === 'generate' ? <RefreshCw className="spin" size={18} /> : <Sparkles size={18} />}
            Generate
          </button>
        </section>

        <section className="runList" aria-label="Generated runs">
          <div className="sectionHeader">
            <span>Runs</span>
            <button className="iconButton" onClick={() => loadInitial()} title="Refresh runs">
              <RefreshCw size={17} />
            </button>
          </div>
          {runs.length === 0 ? <p className="emptyText">No generated runs yet.</p> : null}
          {runs.map((run) => (
            <button
              key={run.id}
              className={`runButton ${currentRun?.id === run.id ? 'active' : ''}`}
              onClick={() => {
                setGenerationSession(null);
                setAuditOpen(false);
                refreshRun(run.id);
              }}
            >
              <span className="runButtonHeader">
                <span>Set {run.setNumber}</span>
                <time dateTime={run.createdAt}>{formatRunTime(run.createdAt)}</time>
              </span>
              <small>{run.conversations.length} conversations - {run.textModel.label}</small>
            </button>
          ))}
        </section>
      </aside>

      <section className="workspace">
        <header className="topBar">
          <div>
            <p className="eyebrow">{generationSession ? 'Generate, inspect, review' : 'Approve, then synthesize'}</p>
            <h2>{generationSession ? `Set ${generationSession.setNumber} generation` : currentRun ? `Set ${currentRun.setNumber} practice run` : 'Create a listening batch'}</h2>
          </div>
          {generationSession ? (
            <div className="runStats">
              <span>{generationSession.conversationCount} requested</span>
              <span>{generationSession.textModelLabel}</span>
              <span>{generationSession.status}</span>
            </div>
          ) : currentRun ? (
            <div className="runStats">
              <span>{currentRun.allowedVocabCount} allowed words</span>
              <span>{currentRun.textModel.label}</span>
              <span>{currentRun.status}</span>
              {currentExchange ? (
                <button className="auditToggle" onClick={() => setAuditOpen((open) => !open)}>
                  <Eye size={15} />
                  LLM audit
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

        {!generationSession && auditOpen && currentExchange ? <AuditLog exchange={currentExchange} /> : null}

        {showRunContent && currentRun ? (
          <section className="analyticsPanel" aria-label="Generation analytics">
            <div className="analyticsCard">
              <span>Current Set Missing</span>
              <strong>{currentRun.analytics.currentSetMissingCount}</strong>
              <p>{currentRun.analytics.currentSetUsedCount} of {currentRun.analytics.currentSetTotal} Set {currentRun.setNumber} words used</p>
              <div className="miniChips">
                {currentRun.analytics.currentSetMissingWords.length === 0 ? <span>None</span> : null}
                {currentRun.analytics.currentSetMissingWords.slice(0, 40).map((word) => (
                  <span key={word}>{word}</span>
                ))}
                {currentRun.analytics.currentSetMissingWords.length > 40 ? <span>+{currentRun.analytics.currentSetMissingWords.length - 40}</span> : null}
              </div>
            </div>

            <div className="analyticsCard">
              <span>Allowed Vocab Used</span>
              <strong>{currentRun.analytics.allowedVocabUsedPercentage}%</strong>
              <p>{currentRun.analytics.allowedVocabUsedCount} of {currentRun.analytics.allowedVocabTotal} words from Sets 1-{currentRun.setNumber}</p>
            </div>

            <div className="analyticsCard">
              <span>New Words Introduced</span>
              <strong>{currentRun.analytics.outOfAllowedCount}</strong>
              <p>Words not found in allowed Sets 1-{currentRun.setNumber}</p>
              <div className="miniChips warning">
                {currentRun.analytics.outOfAllowedWords.length === 0 ? <span>None</span> : null}
                {currentRun.analytics.outOfAllowedWords.map((word) => (
                  <span key={word}>{word}</span>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {!generationSession && !currentRun ? (
          <div className="blankState">
            <Disc3 size={42} />
            <h3>No batch selected</h3>
            <p>Choose a set and conversation count, then generate a review queue.</p>
          </div>
        ) : showRunContent && currentRun ? (
          <div className="conversationGrid">
            {currentRun.conversations.map((conversation) => {
              const isEditing = edit?.conversationId === conversation.id;
              return (
                <article className="conversationCard" key={conversation.id}>
                  <div className="cardHeader">
                    <div>
                      <span className="conversationNumber">Conversation {conversation.number}</span>
                      <h3>{conversation.title}</h3>
                    </div>
                    <span className={`statusPill ${conversation.status}`}>{statusLabel(conversation.status)}</span>
                  </div>

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
                          const key = translationKey(conversation.id, index);
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
                                onClick={() => toggleTranslation(conversation.id, index)}
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
                              const key = answerKey(conversation.id, questionIndex);
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
                              const key = answerKey(conversation.id, questionIndex);
                              const isRevealed = Boolean(revealedAnswers[key]);
                              return (
                                <button
                                  aria-label={`${isRevealed ? 'Hide' : 'Show'} answer for question ${questionIndex + 1}`}
                                  aria-pressed={isRevealed}
                                  className={isRevealed ? 'answerToggle active' : 'answerToggle'}
                                  key={key}
                                  onClick={() => toggleAnswer(conversation.id, questionIndex)}
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

                      {conversation.error ? <p className="conversationError">{conversation.error}</p> : null}
                      {conversation.audioUrl ? (
                        <div className="audioRow">
                          <audio controls src={conversation.audioUrl}>
                            <track kind="captions" />
                          </audio>
                          <button
                            className="audioDeleteButton"
                            onClick={() => runAction(conversation.id, 'delete-audio')}
                            disabled={busy === `delete-audio:${conversation.id}` || conversation.status === 'audio_generating'}
                            title="Delete audio so it can be regenerated"
                            aria-label="Delete generated audio"
                          >
                            {busy === `delete-audio:${conversation.id}` ? <RefreshCw className="spin" size={17} /> : <Trash2 size={17} />}
                          </button>
                        </div>
                      ) : null}

                      <div className="buttonRow">
                        <button
                          className="secondaryButton"
                          onClick={() =>
                            setEdit({
                              conversationId: conversation.id,
                              title: conversation.title,
                              scene: conversation.scene,
                              sampleContext: conversation.sampleContext,
                              transcript: transcriptForEdit(conversation)
                            })
                          }
                        >
                          <Pencil size={17} />
                          Edit
                        </button>
                        <button className="secondaryButton" onClick={() => runAction(conversation.id, 'reject')} disabled={busy === `reject:${conversation.id}`}>
                          <X size={17} />
                          Reject
                        </button>
                        <button className="secondaryButton positive" onClick={() => runAction(conversation.id, 'approve')} disabled={busy === `approve:${conversation.id}`}>
                          <Check size={17} />
                          Approve
                        </button>
                        <button
                          className="primaryButton compact"
                          onClick={() => runAction(conversation.id, 'audio')}
                          disabled={!['approved', 'audio_failed'].includes(conversation.status) || busy === `audio:${conversation.id}`}
                        >
                          {busy === `audio:${conversation.id}` || conversation.status === 'audio_generating' ? <RefreshCw className="spin" size={17} /> : <FileAudio size={17} />}
                          Audio
                        </button>
                        {conversation.audioUrl ? (
                          <a className="playLink" href={conversation.audioUrl} target="_blank" rel="noreferrer">
                            <Play size={16} />
                            Open
                          </a>
                        ) : null}
                      </div>
                    </>
                  )}
                </article>
              );
            })}
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
