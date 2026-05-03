import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronRight,
  Eye,
  GraduationCap,
  Library,
  Play,
  RotateCcw,
  Settings,
  X
} from 'lucide-react';
import { buildSessionQueue, calculateNextStats, getBucket, getStats } from './deck.ts';
import { levelSummaries, vocabCards } from './vocabData.ts';
import { loadLibrary } from './library.ts';
import {
  loadQuestionStats,
  loadSettings,
  loadVocabStats,
  saveQuestionStats,
  saveSettings,
  saveVocabStats
} from './storage.ts';
import type {
  LearnerSettings,
  PracticeArea,
  PracticeCard,
  ReviewResult,
  StaticLibraryConversation,
  StaticLibraryManifest,
  StatsMap,
  VocabCard
} from './types.ts';
import './consumer.css';

type VocabPracticeCard = VocabCard & PracticeCard;

interface QuestionState {
  revealed: boolean;
  result: ReviewResult | null;
}

type MikanTheme = 'mikan-light' | 'mikan-dark';

function navFromHash(): PracticeArea {
  if (typeof window === 'undefined') return 'vocab';
  if (window.location.hash.includes('/conversations')) return 'conversations';
  if (window.location.hash.includes('/settings')) return 'settings';
  return 'vocab';
}

function deviceMikanTheme(): MikanTheme {
  if (typeof window === 'undefined') return 'mikan-light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'mikan-dark' : 'mikan-light';
}

function strengthLabel(cardId: string, stats: StatsMap): string {
  const bucket = getBucket(getStats(stats, cardId));
  return bucket[0].toUpperCase() + bucket.slice(1);
}

function applyReview(stats: StatsMap, id: string, result: ReviewResult): StatsMap {
  return {
    ...stats,
    [id]: calculateNextStats(getStats(stats, id), result)
  };
}

function VocabFlashcard({
  card,
  showKana,
  stats,
  onReview
}: {
  card: VocabPracticeCard;
  showKana: boolean;
  stats: StatsMap;
  onReview: (id: string, result: ReviewResult) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [result, setResult] = useState<ReviewResult | null>(null);

  useEffect(() => {
    setRevealed(false);
    setResult(null);
  }, [card.id]);

  function assess(nextResult: ReviewResult) {
    setResult(nextResult);
    window.setTimeout(() => onReview(card.id, nextResult), 260);
  }

  return (
    <article className={`practiceCard vocabCard ${revealed ? 'revealed' : ''} ${result ?? ''}`}>
      <div className="cardMeta">
        <span>{strengthLabel(card.id, stats)}</span>
        <span>{card.category || card.partOfSpeech || `Level ${card.level}`}</span>
      </div>

      <div className="vocabPrompt">
        {showKana && card.reading && card.reading !== card.japanese ? (
          <ruby>
            {card.japanese}
            <rt>{card.reading}</rt>
          </ruby>
        ) : (
          <span>{card.japanese}</span>
        )}
      </div>

      {revealed ? (
        <div className="vocabAnswer">
          <span>{card.japanese}</span>
          <strong>{card.meaning}</strong>
          <p>{card.romaji || card.reading}</p>
        </div>
      ) : null}

      <div className="actionRow fixedActions">
        {!revealed ? (
          <button className="primaryPracticeButton" onClick={() => setRevealed(true)}>
            <Eye size={18} />
            Reveal
          </button>
        ) : (
          <>
            <button className="missButton" disabled={Boolean(result)} onClick={() => assess('missed')}>
              <X size={18} />
              Missed
            </button>
            <button className="gotButton" disabled={Boolean(result)} onClick={() => assess('gotIt')}>
              <Check size={18} />
              Got It
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function VocabPage({
  level,
  showKana,
  stats,
  setStats
}: {
  level: number;
  showKana: boolean;
  stats: StatsMap;
  setStats: (stats: StatsMap) => void;
}) {
  const activeCards = useMemo<VocabPracticeCard[]>(() => (
    vocabCards
      .filter((card) => card.level === level)
      .map((card) => ({ ...card, kind: 'vocab', frequency: card.frequencyRank }))
  ), [level]);
  const [queue, setQueue] = useState<VocabPracticeCard[]>([]);
  const [index, setIndex] = useState(0);

  function startSession() {
    setQueue(buildSessionQueue(activeCards, stats, 15));
    setIndex(0);
  }

  useEffect(() => {
    startSession();
  }, [level]);

  function review(id: string, result: ReviewResult) {
    const nextStats = applyReview(stats, id, result);
    setStats(nextStats);
    saveVocabStats(nextStats);
    setIndex((current) => current + 1);
  }

  const current = queue[index];
  const complete = queue.length > 0 && index >= queue.length;

  return (
    <section className="practicePanel">
      <div className="panelHeader">
        <div>
          <p>Vocabulary</p>
          <h2>Level {level} words</h2>
        </div>
        <button className="iconTextButton" onClick={startSession} title="Restart session">
          <RotateCcw size={17} />
          Restart
        </button>
      </div>

      <div className="progressRail">
        <span>{queue.length ? Math.min(index + 1, queue.length) : 0} / {queue.length || activeCards.length}</span>
        <div>
          {queue.map((card, cardIndex) => (
            <i key={card.id} className={cardIndex < index ? 'done' : cardIndex === index ? 'current' : ''} />
          ))}
        </div>
      </div>

      {activeCards.length === 0 ? (
        <EmptyState title="No words in this level" body="Choose another level in Settings." />
      ) : complete ? (
        <CompletionPanel label="Vocabulary session complete" onNext={startSession} />
      ) : current ? (
        <VocabFlashcard card={current} showKana={showKana} stats={stats} onReview={review} />
      ) : null}
    </section>
  );
}

function QuestionCard({
  conversation,
  questionIndex,
  state,
  stats,
  onReveal,
  onReview
}: {
  conversation: StaticLibraryConversation;
  questionIndex: number;
  state: QuestionState;
  stats: StatsMap;
  onReveal: () => void;
  onReview: (result: ReviewResult) => void;
}) {
  const id = `conversation:${conversation.id}:q:${questionIndex}`;

  return (
    <article className={`questionCard ${state.revealed ? 'revealed' : ''} ${state.result ?? ''}`}>
      <div className="cardMeta">
        <span>Question {questionIndex + 1}</span>
        <span>{strengthLabel(id, stats)}</span>
      </div>
      <h3>{conversation.listeningQuestions[questionIndex]}</h3>
      {state.revealed ? <p>{conversation.answerKey[questionIndex] ?? 'No answer provided.'}</p> : null}
      <div className="actionRow">
        {!state.revealed ? (
          <button className="primaryPracticeButton" onClick={onReveal}>
            <Eye size={17} />
            Reveal
          </button>
        ) : (
          <>
            <button className="missButton" disabled={Boolean(state.result)} onClick={() => onReview('missed')}>
              <X size={17} />
            </button>
            <button className="gotButton" disabled={Boolean(state.result)} onClick={() => onReview('gotIt')}>
              <Check size={17} />
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function ConversationPractice({
  conversation,
  stats,
  setStats,
  onNext
}: {
  conversation: StaticLibraryConversation;
  stats: StatsMap;
  setStats: (stats: StatsMap) => void;
  onNext: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [played, setPlayed] = useState(false);
  const [showTranslations, setShowTranslations] = useState(false);
  const [questionStates, setQuestionStates] = useState<Record<number, QuestionState>>({});

  useEffect(() => {
    setPlayed(!conversation.audioUrl);
    setShowTranslations(false);
    setQuestionStates({});
  }, [conversation.id, conversation.audioUrl]);

  function playAudio() {
    if (!conversation.audioUrl) {
      setPlayed(true);
      return;
    }
    void audioRef.current?.play();
  }

  function reviewQuestion(questionIndex: number, result: ReviewResult) {
    const id = `conversation:${conversation.id}:q:${questionIndex}`;
    const nextStats = applyReview(stats, id, result);
    setStats(nextStats);
    saveQuestionStats(nextStats);
    setQuestionStates((current) => ({
      ...current,
      [questionIndex]: { revealed: true, result }
    }));
  }

  const allAttempted = conversation.listeningQuestions.length > 0
    && conversation.listeningQuestions.every((_, index) => questionStates[index]?.result);

  return (
    <div className="conversationPractice">
      <article className="listenCard">
        <div>
          <p>Listening Practice</p>
          <h2>{conversation.title}</h2>
          <span>{conversation.scene}</span>
        </div>
        <button className="roundPlayButton" onClick={playAudio} aria-label="Play conversation">
          <Play size={30} fill="currentColor" />
        </button>
        {conversation.audioUrl ? (
          <audio ref={audioRef} src={conversation.audioUrl} onEnded={() => setPlayed(true)}>
            <track kind="captions" />
          </audio>
        ) : null}
      </article>

      {played ? (
        <div className="questionGrid">
          {conversation.listeningQuestions.map((_, questionIndex) => (
            <QuestionCard
              key={`${conversation.id}:${questionIndex}`}
              conversation={conversation}
              questionIndex={questionIndex}
              state={questionStates[questionIndex] ?? { revealed: false, result: null }}
              stats={stats}
              onReveal={() => setQuestionStates((current) => ({ ...current, [questionIndex]: { revealed: true, result: null } }))}
              onReview={(result) => reviewQuestion(questionIndex, result)}
            />
          ))}
        </div>
      ) : (
        <p className="listenHint">Questions unlock when the audio finishes.</p>
      )}

      {allAttempted ? (
        <section className="transcriptPanel">
          <div className="panelHeader compact">
            <div>
              <p>Transcript</p>
              <h2>Japanese lines</h2>
            </div>
            <button className="iconTextButton" onClick={() => setShowTranslations((value) => !value)}>
              <BookOpen size={17} />
              {showTranslations ? 'Hide translations' : 'Show translations'}
            </button>
          </div>
          {conversation.text.map((line, index) => (
            <div className="transcriptPracticeLine" key={`${conversation.id}:line:${index}`}>
              <strong>{line.speaker}</strong>
              <span>{line.japanese}</span>
              {showTranslations ? <p>{conversation.englishTranslation[index]?.english ?? ''}</p> : null}
            </div>
          ))}
          <button className="primaryPracticeButton nextConversation" onClick={onNext}>
            Next Conversation
            <ChevronRight size={18} />
          </button>
        </section>
      ) : null}
    </div>
  );
}

function ConversationsPage({
  level,
  library,
  stats,
  setStats
}: {
  level: number;
  library: StaticLibraryManifest;
  stats: StatsMap;
  setStats: (stats: StatsMap) => void;
}) {
  const conversations = useMemo(() => library.conversations.filter((conversation) => conversation.level === level), [library, level]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [level, library.generatedAt]);

  const current = conversations[index % Math.max(1, conversations.length)];

  return (
    <section className="practicePanel widePanel">
      <div className="panelHeader">
        <div>
          <p>Conversations</p>
          <h2>Level {level} listening deck</h2>
        </div>
        <span className="libraryCount">{conversations.length} ready</span>
      </div>
      {conversations.length === 0 ? (
        <EmptyState title="No published conversations yet" body="Run the library export after approving conversations and generating audio in Listener Studio." />
      ) : (
        <ConversationPractice
          key={current.id}
          conversation={current}
          stats={stats}
          setStats={setStats}
          onNext={() => setIndex((currentIndex) => currentIndex + 1)}
        />
      )}
    </section>
  );
}

function SettingsPage({
  settings,
  setSettings,
  library
}: {
  settings: LearnerSettings;
  setSettings: (settings: LearnerSettings) => void;
  library: StaticLibraryManifest;
}) {
  function update(nextSettings: LearnerSettings) {
    setSettings(nextSettings);
    saveSettings(nextSettings);
  }

  return (
    <section className="practicePanel settingsPanel">
      <div className="panelHeader">
        <div>
          <p>Settings</p>
          <h2>Practice setup</h2>
        </div>
      </div>
      <label className="settingField">
        <span>Level</span>
        <select value={settings.level} onChange={(event) => update({ ...settings, level: Number(event.target.value) })}>
          {levelSummaries.map((summary) => (
            <option key={summary.set} value={summary.set}>
              Level {summary.set} - {summary.theme}
            </option>
          ))}
        </select>
      </label>
      <label className="toggleField">
        <input
          type="checkbox"
          checked={settings.showKana}
          onChange={(event) => update({ ...settings, showKana: event.target.checked })}
        />
        <span>Show kana above kanji on vocabulary cards</span>
      </label>
      <div className="settingsStats">
        <span>{vocabCards.filter((card) => card.level === settings.level).length} words in this level</span>
        <span>{library.conversations.filter((conversation) => conversation.level === settings.level).length} published conversations</span>
      </div>
    </section>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="practiceEmpty">
      <Library size={38} />
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

function CompletionPanel({ label, onNext }: { label: string; onNext: () => void }) {
  return (
    <div className="practiceEmpty complete">
      <Check size={42} />
      <h3>{label}</h3>
      <button className="primaryPracticeButton" onClick={onNext}>
        Start Next Session
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

export function ConsumerApp() {
  const [area, setArea] = useState<PracticeArea>(navFromHash);
  const [settings, setSettings] = useState<LearnerSettings>(() => loadSettings(levelSummaries[0]?.set ?? 1));
  const [mikanTheme, setMikanTheme] = useState<MikanTheme>(deviceMikanTheme);
  const [vocabStats, setVocabStats] = useState<StatsMap>(loadVocabStats);
  const [questionStats, setQuestionStats] = useState<StatsMap>(loadQuestionStats);
  const [library, setLibrary] = useState<StaticLibraryManifest>({ version: 1, generatedAt: '', conversations: [] });
  const [libraryError, setLibraryError] = useState<string | null>(null);

  useEffect(() => {
    const handleHashChange = () => setArea(navFromHash());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSchemeChange = () => setMikanTheme(media.matches ? 'mikan-dark' : 'mikan-light');
    handleSchemeChange();
    media.addEventListener('change', handleSchemeChange);
    return () => media.removeEventListener('change', handleSchemeChange);
  }, []);

  useEffect(() => {
    loadLibrary()
      .then((manifest) => {
        setLibrary(manifest);
        setLibraryError(null);
      })
      .catch((error) => setLibraryError(error instanceof Error ? error.message : String(error)));
  }, []);

  const levelSummary = levelSummaries.find((summary) => summary.set === settings.level);

  return (
    <main className="practiceShell" data-theme={mikanTheme}>
      <aside className="practiceSidebar">
        <div className="practiceBrand">
          <GraduationCap size={28} />
          <div>
            <h1>JLPT Practice</h1>
            <p>{levelSummary?.theme ?? 'Static study decks'}</p>
          </div>
        </div>
        <nav className="practiceNav">
          <a className={area === 'vocab' ? 'active' : ''} href="#/practice">
            <BookOpen size={18} />
            Vocabulary
          </a>
          <a className={area === 'conversations' ? 'active' : ''} href="#/practice/conversations">
            <Play size={18} />
            Conversations
          </a>
        </nav>
        <a className="studioLink" href="#">
          Listener Studio
        </a>
      </aside>

      <section className="practiceWorkspace">
        <a
          aria-label="Settings"
          className={`settingsIconLink ${area === 'settings' ? 'active' : ''}`}
          href="#/practice/settings"
          title="Settings"
        >
          <Settings size={20} />
        </a>
        {libraryError ? <div className="practiceError">{libraryError}</div> : null}
        {area === 'vocab' ? (
          <VocabPage level={settings.level} showKana={settings.showKana} stats={vocabStats} setStats={setVocabStats} />
        ) : null}
        {area === 'conversations' ? (
          <ConversationsPage level={settings.level} library={library} stats={questionStats} setStats={setQuestionStats} />
        ) : null}
        {area === 'settings' ? (
          <SettingsPage settings={settings} setSettings={setSettings} library={library} />
        ) : null}
      </section>
    </main>
  );
}
