import { useEffect, useMemo, useState } from 'react';
import { Check, CircleAlert, Disc3, FileAudio, ListMusic, Pencil, Play, RefreshCw, Save, Sparkles, X } from 'lucide-react';
import type { ApiError, PracticeConversation, PracticeRun, SetSummary } from '../shared/types.ts';

type BusyAction = 'generate' | `approve:${string}` | `reject:${string}` | `audio:${string}` | `save:${string}` | null;

interface EditState {
  conversationId: string;
  title: string;
  scene: string;
  sampleContext: string;
  transcript: string;
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

export function App() {
  const [sets, setSets] = useState<SetSummary[]>([]);
  const [runs, setRuns] = useState<PracticeRun[]>([]);
  const [currentRun, setCurrentRun] = useState<PracticeRun | null>(null);
  const [setNumber, setSetNumber] = useState(1);
  const [conversationCount, setConversationCount] = useState(4);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);

  const currentSet = useMemo(() => sets.find((item) => item.set === setNumber), [sets, setNumber]);

  async function loadInitial() {
    const [setPayload, runPayload] = await Promise.all([
      api<{ sets: SetSummary[] }>('/api/sets'),
      api<{ runs: PracticeRun[] }>('/api/runs')
    ]);
    setSets(setPayload.sets);
    setRuns(runPayload.runs);
    setCurrentRun((previous) => previous ?? runPayload.runs[0] ?? null);
  }

  useEffect(() => {
    loadInitial().catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, []);

  async function generate() {
    setBusy('generate');
    setError(null);
    try {
      const payload = await api<{ run: PracticeRun }>('/api/generate', {
        method: 'POST',
        body: JSON.stringify({ setNumber, conversationCount })
      });
      setCurrentRun(payload.run);
      await loadInitial();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
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

  async function runAction(conversationId: string, action: 'approve' | 'reject' | 'audio') {
    if (!currentRun) return;
    const marker = `${action}:${conversationId}` as BusyAction;
    setBusy(marker);
    setError(null);
    try {
      const payload = await api<{ run: PracticeRun }>(
        `/api/runs/${encodeURIComponent(currentRun.id)}/conversations/${encodeURIComponent(conversationId)}/${action}`,
        { method: 'POST' }
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
            <h1>JLPT Listener</h1>
            <p>N5 listening batches from your set ladder</p>
          </div>
        </div>

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
              onClick={() => refreshRun(run.id)}
            >
              <span>Set {run.setNumber}</span>
              <small>{run.conversations.length} conversations</small>
            </button>
          ))}
        </section>
      </aside>

      <section className="workspace">
        <header className="topBar">
          <div>
            <p className="eyebrow">Approve, then synthesize</p>
            <h2>{currentRun ? `Set ${currentRun.setNumber} practice run` : 'Create a listening batch'}</h2>
          </div>
          {currentRun ? (
            <div className="runStats">
              <span>{currentRun.allowedVocabCount} allowed words</span>
              <span>{currentRun.status}</span>
            </div>
          ) : null}
        </header>

        {error ? (
          <div className="errorBanner">
            <CircleAlert size={18} />
            <span>{error}</span>
          </div>
        ) : null}

        {currentRun ? (
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

        {!currentRun ? (
          <div className="blankState">
            <Disc3 size={42} />
            <h3>No batch selected</h3>
            <p>Choose a set and conversation count, then generate a review queue.</p>
          </div>
        ) : (
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
                        {conversation.text.map((line, index) => (
                          <p key={`${conversation.id}-${index}`}>
                            <strong>{line.speaker}</strong>
                            <span>[{line.tags.join(', ')}]</span>
                            {line.japanese}
                          </p>
                        ))}
                      </div>

                      <div className="detailStrip">
                        <div>
                          <span>Questions</span>
                          <ol>
                            {conversation.listeningQuestions.map((question) => (
                              <li key={question}>{question}</li>
                            ))}
                          </ol>
                        </div>
                        <div>
                          <span>Audit</span>
                          <p>{conversation.outOfVocabularyAudit.join(', ') || 'None'}</p>
                        </div>
                      </div>

                      <div className="vocabChips">
                        {conversation.vocabularyUsed.slice(0, 18).map((word) => (
                          <span key={word}>{word}</span>
                        ))}
                        {conversation.vocabularyUsed.length > 18 ? <span>+{conversation.vocabularyUsed.length - 18}</span> : null}
                      </div>

                      {conversation.error ? <p className="conversationError">{conversation.error}</p> : null}
                      {conversation.audioUrl ? (
                        <audio controls src={conversation.audioUrl}>
                          <track kind="captions" />
                        </audio>
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
        )}
      </section>
    </main>
  );
}
