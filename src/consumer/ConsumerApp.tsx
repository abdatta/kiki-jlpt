import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, Dispatch, ReactNode, SetStateAction } from 'react';
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  Headphones,
  Languages,
  Library,
  ListOrdered,
  Lock,
  Pause,
  Play,
  RotateCcw,
  Settings,
  SkipBack,
  SkipForward,
  Star,
  Trophy,
  X
} from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo.tsx';
import { buildSessionQueue, calculateNextStats, getBucket, getStats } from './deck.ts';
import { levelSummaries, vocabCards } from './vocabData.ts';
import { loadLibrary } from './library.ts';
import {
  loadSettings,
  loadVocabStats,
  loadConversationPlaybackSpeed,
  loadConversationProgress,
  saveConversationPlaybackSpeed,
  saveConversationProgress,
  saveSettings,
  saveVocabStats
} from './storage.ts';
import type {
  LearnerSettings,
  PracticeArea,
  PracticeCard,
  ConversationProgress,
  ReviewResult,
  StaticLibraryConversation,
  StaticLibraryManifest,
  StatsMap,
  VocabCard
} from './types.ts';
import './consumer.css';

type VocabPracticeCard = VocabCard & PracticeCard;
const LEVEL_LISTENING_TARGET = 20;
const PRACTICE_ONLY = import.meta.env.VITE_PRACTICE_ONLY === 'true';
const CONVERSATION_PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25] as const;

function envRatio(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, 1);
}

const LISTENING_UNLOCK_RATIO = envRatio(import.meta.env.VITE_LISTENING_UNLOCK_RATIO, 0.5);
const LISTENING_UNLOCK_PERCENT = percent(LISTENING_UNLOCK_RATIO);
const LEVEL_MASTERY_RATIO = envRatio(import.meta.env.VITE_LEVEL_MASTERY_RATIO, 0.8);
const LEVEL_MASTERY_PERCENT = percent(LEVEL_MASTERY_RATIO);

function normalizePlaybackSpeed(speed: number): number {
  return CONVERSATION_PLAYBACK_SPEEDS.some((option) => option === speed) ? speed : 1;
}

interface QuestionState {
  revealed: boolean;
  result: ReviewResult | null;
}

type MikanTheme = 'mikan-light' | 'mikan-dark';

interface LevelProgress {
  level: number;
  theme: string;
  vocabTotal: number;
  strongVocabCount: number;
  vocabMasteryRatio: number;
  listeningAttemptCount: number;
  listeningUnlocked: boolean;
  complete: boolean;
  unlocked: boolean;
}

interface VocabWordStat {
  card: VocabPracticeCard;
  reviews: number;
  streak: number;
  accuracy: number;
}

interface VocabStatsAnalysis {
  strong: VocabWordStat[];
  improving: VocabWordStat[];
  weak: VocabWordStat[];
  newWords: VocabPracticeCard[];
}

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

function isKanji(char: string): boolean {
  return /[\u3400-\u9FFF]/u.test(char);
}

function isJapaneseKanaText(value: string): boolean {
  return /^[\u3040-\u30FFー]+$/u.test(value);
}

function tokenizeForFurigana(value: string): Array<{ text: string; kanji: boolean }> {
  const tokens: Array<{ text: string; kanji: boolean }> = [];

  for (const char of value) {
    const kanji = isKanji(char);
    const previous = tokens[tokens.length - 1];
    if (previous && previous.kanji === kanji) {
      previous.text += char;
    } else {
      tokens.push({ text: char, kanji });
    }
  }

  return tokens;
}

function furiganaParts(japanese: string, reading: string): Array<{ text: string; reading?: string }> {
  if (!reading || reading === japanese || !japanese.split('').some(isKanji)) {
    return [{ text: japanese }];
  }

  const tokens = tokenizeForFurigana(japanese);
  let readingIndex = 0;

  return tokens.map((token, index) => {
    if (!token.kanji) {
      if (isJapaneseKanaText(token.text)) {
        const foundAt = reading.indexOf(token.text, readingIndex);
        if (foundAt >= readingIndex) {
          readingIndex = foundAt + token.text.length;
        }
      }
      return { text: token.text };
    }

    const nextKanaToken = tokens.slice(index + 1).find((item) => !item.kanji && isJapaneseKanaText(item.text));
    const nextKanaIndex = nextKanaToken ? reading.indexOf(nextKanaToken.text, readingIndex) : -1;
    const rubyText = nextKanaIndex >= readingIndex ? reading.slice(readingIndex, nextKanaIndex) : reading.slice(readingIndex);
    readingIndex = nextKanaIndex >= readingIndex ? nextKanaIndex : reading.length;
    return { text: token.text, reading: rubyText || undefined };
  });
}

function applyReview(stats: StatsMap, id: string, result: ReviewResult): StatsMap {
  return {
    ...stats,
    [id]: calculateNextStats(getStats(stats, id), result)
  };
}

function statAccuracy(cardStats: ReturnType<typeof getStats>): number {
  if (cardStats.reviews === 0) return 0;
  const recent = cardStats.recentResults;
  if (recent.length > 0) {
    return recent.reduce<number>((sum, value) => sum + value, 0) / recent.length;
  }
  return cardStats.streak > 0 ? 1 : 0;
}

function analyzeVocabStats(cards: VocabPracticeCard[], stats: StatsMap): VocabStatsAnalysis {
  const analysis: VocabStatsAnalysis = {
    strong: [],
    improving: [],
    weak: [],
    newWords: []
  };

  for (const card of cards) {
    const cardStats = getStats(stats, card.id);
    if (cardStats.reviews === 0) {
      analysis.newWords.push(card);
      continue;
    }

    const item = {
      card,
      reviews: cardStats.reviews,
      streak: cardStats.streak,
      accuracy: statAccuracy(cardStats)
    };

    const bucket = getBucket(cardStats);
    if (bucket === 'strong') {
      analysis.strong.push(item);
    } else if (bucket === 'weak') {
      analysis.weak.push(item);
    } else {
      analysis.improving.push(item);
    }
  }

  analysis.strong.sort((a, b) => b.accuracy - a.accuracy || b.streak - a.streak);
  analysis.improving.sort((a, b) => b.accuracy - a.accuracy || b.reviews - a.reviews);
  analysis.weak.sort((a, b) => a.accuracy - b.accuracy || a.streak - b.streak);
  analysis.newWords.sort((a, b) => (a.frequency ?? Number.POSITIVE_INFINITY) - (b.frequency ?? Number.POSITIVE_INFINITY));
  return analysis;
}

function percent(value: number): number {
  return Math.round(value * 100);
}

function targetProgressPercent(value: number, target: number): number {
  if (target <= 0) return 100;
  return Math.min(100, (value / target) * 100);
}

function routeForArea(area: PracticeArea): string {
  if (area === 'conversations') return '#/practice/conversations';
  if (area === 'settings') return '#/practice/settings';
  return '#/practice';
}

function buildLevelProgress(vocabStats: StatsMap, conversationProgress: ConversationProgress, library: StaticLibraryManifest): LevelProgress[] {
  let previousLevelsComplete = true;
  const completedConversationIds = new Set(conversationProgress.completedConversationIds);

  return levelSummaries.map((summary) => {
    const cards = vocabCards.filter((card) => card.level === summary.set);
    const strongVocabCount = cards.filter((card) => getBucket(getStats(vocabStats, card.id)) === 'strong').length;
    const vocabMasteryRatio = cards.length > 0 ? strongVocabCount / cards.length : 0;
    const listeningAttemptCount = library.conversations
      .filter((conversation) => conversation.level === summary.set && completedConversationIds.has(conversation.id))
      .length;
    const unlocked = previousLevelsComplete;
    const complete = vocabMasteryRatio >= LEVEL_MASTERY_RATIO && listeningAttemptCount >= LEVEL_LISTENING_TARGET;

    if (!complete) {
      previousLevelsComplete = false;
    }

    return {
      level: summary.set,
      theme: summary.theme,
      vocabTotal: cards.length,
      strongVocabCount,
      vocabMasteryRatio,
      listeningAttemptCount,
      listeningUnlocked: vocabMasteryRatio >= LISTENING_UNLOCK_RATIO,
      complete,
      unlocked
    };
  });
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

  const promptParts = showKana ? furiganaParts(card.japanese, card.reading) : [{ text: card.japanese }];

  return (
    <article className={`practiceCard vocabCard ${revealed ? 'revealed' : ''} ${result ?? ''}`}>
      <div className="cardMeta">
        <span>{strengthLabel(card.id, stats)}</span>
        <span>{card.category || card.partOfSpeech || `Level ${card.level}`}</span>
      </div>

      <div className="vocabPrompt">
        <span className="furiganaWord">
          {promptParts.map((part, index) => (
            part.reading ? (
              <ruby key={`${part.text}:${index}`}>
                {part.text}
                <rt>{part.reading}</rt>
              </ruby>
            ) : (
              <span key={`${part.text}:${index}`}>{part.text}</span>
            )
          ))}
        </span>
      </div>

      {revealed ? (
        <div className="vocabAnswer">
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

function WordStatTile({ item, onSelect }: { item: VocabWordStat; onSelect: (item: VocabWordStat) => void }) {
  return (
    <button className="wordStatTile" onClick={() => onSelect(item)} type="button">
      <strong>{item.card.japanese}</strong>
      <span>{Math.round(item.accuracy * 100)}%</span>
    </button>
  );
}

function NewWordTile({ card, onSelect }: { card: VocabPracticeCard; onSelect: (card: VocabPracticeCard) => void }) {
  return (
    <button className="wordStatTile newWordTile" onClick={() => onSelect(card)} type="button">
      <strong>{card.japanese}</strong>
      <span>New</span>
    </button>
  );
}

function WordStatSection({
  title,
  count,
  children
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="wordStatSection">
      <header>
        <h3>{title}</h3>
        <span>{count}</span>
      </header>
      {count === 0 ? <p className="emptyStatText">Nothing here yet.</p> : children}
    </section>
  );
}

function WordDetailModal({
  selected,
  onClose
}: {
  selected: VocabWordStat | VocabPracticeCard;
  onClose: () => void;
}) {
  const isReviewed = 'accuracy' in selected;
  const card = isReviewed ? selected.card : selected;

  return (
    <div className="wordDetailModal" role="dialog" aria-modal="true" aria-labelledby="word-detail-title">
      <button className="statsModalBackdrop" aria-label="Close word details" onClick={onClose} type="button" />
      <section className="wordDetailPanel">
        <header>
          <div>
            <p>Word details</p>
            <h3 id="word-detail-title">{card.japanese}</h3>
            <span>{card.romaji || card.reading}</span>
          </div>
          <button className="modalCloseButton" aria-label="Close word details" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>
        <div className="wordMeaningBox">
          <span>Meaning</span>
          <strong>{card.meaning}</strong>
        </div>
        <div className="wordDetailGrid">
          <div>
            <span>Reading</span>
            <strong>{card.reading || '-'}</strong>
          </div>
          <div>
            <span>Category</span>
            <strong>{card.category || card.partOfSpeech || '-'}</strong>
          </div>
          {isReviewed ? (
            <>
              <div>
                <span>Accuracy</span>
                <strong>{Math.round(selected.accuracy * 100)}%</strong>
              </div>
              <div>
                <span>Reviews</span>
                <strong>{selected.reviews}</strong>
              </div>
              <div>
                <span>Streak</span>
                <strong>{selected.streak > 0 ? `+${selected.streak}` : selected.streak}</strong>
              </div>
            </>
          ) : (
            <div>
              <span>Status</span>
              <strong>New</strong>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function VocabStatsModal({
  level,
  theme,
  progress,
  analysis,
  onClose
}: {
  level: number;
  theme: string;
  progress: LevelProgress;
  analysis: VocabStatsAnalysis;
  onClose: () => void;
}) {
  const [showNewWords, setShowNewWords] = useState(false);
  const [selectedWord, setSelectedWord] = useState<VocabWordStat | VocabPracticeCard | null>(null);
  const progressPercent = percent(progress.vocabMasteryRatio);
  const progressLabel = progress.complete
    ? 'Next Level Unlocked'
    : progress.vocabMasteryRatio >= LISTENING_UNLOCK_RATIO
      ? `Unlock next level at ${LEVEL_MASTERY_PERCENT}%`
      : `Unlock Conversations at ${LISTENING_UNLOCK_PERCENT}%`;

  return (
    <div className="statsModal" role="dialog" aria-modal="true" aria-labelledby="word-stats-title">
      <button className="statsModalBackdrop" aria-label="Close word stats" onClick={onClose} type="button" />
      <section className="statsModalPanel">
        <header className="statsModalHeader">
          <div>
            <p>Level {level}</p>
            <h2 id="word-stats-title">{theme}</h2>
          </div>
          <button className="modalCloseButton" aria-label="Close word stats" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>

        <div className="statsProgressSummary">
          <div>
            <span>{progressPercent}%</span>
            <strong>{progressLabel}</strong>
          </div>
          <i><b style={{ width: `${Math.min(100, progressPercent)}%` }} /></i>
        </div>

        <WordStatSection title="Strong" count={analysis.strong.length}>
          <div className="wordStatList">{analysis.strong.map((item) => <WordStatTile key={item.card.id} item={item} onSelect={setSelectedWord} />)}</div>
        </WordStatSection>

        <WordStatSection title="Improving" count={analysis.improving.length}>
          <div className="wordStatList">{analysis.improving.map((item) => <WordStatTile key={item.card.id} item={item} onSelect={setSelectedWord} />)}</div>
        </WordStatSection>

        <WordStatSection title="Needs Work" count={analysis.weak.length}>
          <div className="wordStatList">{analysis.weak.map((item) => <WordStatTile key={item.card.id} item={item} onSelect={setSelectedWord} />)}</div>
        </WordStatSection>

        <section className="wordStatSection">
          <header>
            <h3>New Words</h3>
            <div className="newWordsControls">
              <span>{analysis.newWords.length}</span>
              <button
                aria-label={showNewWords ? 'Hide new words' : 'Show new words'}
                aria-pressed={showNewWords}
                className={showNewWords ? 'active' : ''}
                onClick={() => setShowNewWords((value) => !value)}
                type="button"
              >
                <Eye size={16} />
              </button>
            </div>
          </header>
          {showNewWords ? (
            analysis.newWords.length === 0 ? <p className="emptyStatText">All words have appeared.</p> : (
              <div className="wordStatList">{analysis.newWords.map((card) => <NewWordTile key={card.id} card={card} onSelect={setSelectedWord} />)}</div>
            )
          ) : (
            <p className="emptyStatText">Hidden by default.</p>
          )}
        </section>

        {selectedWord ? <WordDetailModal selected={selectedWord} onClose={() => setSelectedWord(null)} /> : null}
      </section>
    </div>
  );
}

function ProgressMeter({
  label,
  value,
  target,
  complete
}: {
  label: string;
  value: string;
  target: string;
  complete: boolean;
}) {
  return (
    <div className={complete ? 'unlockMeter done' : 'unlockMeter'}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <i><b style={{ width: target }} /></i>
    </div>
  );
}

function LevelUnlockModal({
  level,
  nextLevel,
  progress,
  reason,
  onClose
}: {
  level: number;
  nextLevel: number | null;
  progress: LevelProgress;
  reason: 'listening' | 'vocab';
  onClose: () => void;
}) {
  const listeningComplete = progress.listeningAttemptCount >= LEVEL_LISTENING_TARGET;
  const vocabComplete = progress.vocabMasteryRatio >= LEVEL_MASTERY_RATIO;
  const listeningRemaining = Math.max(0, LEVEL_LISTENING_TARGET - progress.listeningAttemptCount);
  const strongVocabTarget = Math.ceil(progress.vocabTotal * LEVEL_MASTERY_RATIO);
  const strongVocabRemaining = Math.max(0, strongVocabTarget - progress.strongVocabCount);
  const hasVocabGate = LEVEL_MASTERY_RATIO > 0;
  const title = reason === 'listening'
    ? `${listeningRemaining} more listening ${listeningRemaining === 1 ? 'exercise' : 'exercises'} to go`
    : strongVocabRemaining > 0
      ? `${strongVocabRemaining} more strong ${strongVocabRemaining === 1 ? 'word' : 'words'} needed`
      : 'Vocabulary requirement met';
  const vocabRequirementText = hasVocabGate
    ? `make ${LEVEL_MASTERY_PERCENT}% of this level's vocabulary strong`
    : 'meet this build\'s vocabulary requirement';

  return (
    <div className="statsModal" role="dialog" aria-modal="true" aria-labelledby="level-unlock-title">
      <button className="statsModalBackdrop" aria-label="Close level progress" onClick={onClose} type="button" />
      <section className="statsModalPanel levelUnlockPanel">
        <header className="statsModalHeader">
          <div>
            <p>Level {level} progress</p>
            <h2 id="level-unlock-title">{title}</h2>
          </div>
          <button className="modalCloseButton" aria-label="Close level progress" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>

        <p className="unlockModalIntro">
          {nextLevel ? `Level ${nextLevel} opens when both requirements are complete.` : 'This is the final published level for now.'}
        </p>

        <div className="unlockMeterGrid">
          <ProgressMeter
            label="Listening"
            value={`${Math.min(progress.listeningAttemptCount, LEVEL_LISTENING_TARGET)} / ${LEVEL_LISTENING_TARGET}`}
            target={`${targetProgressPercent(progress.listeningAttemptCount, LEVEL_LISTENING_TARGET)}%`}
            complete={listeningComplete}
          />
          <ProgressMeter
            label="Vocabulary"
            value={hasVocabGate ? `${percent(progress.vocabMasteryRatio)}% / ${LEVEL_MASTERY_PERCENT}%` : 'No gate'}
            target={`${targetProgressPercent(progress.vocabMasteryRatio, LEVEL_MASTERY_RATIO)}%`}
            complete={vocabComplete}
          />
        </div>

        <p className="unlockModalRule">
          Finish 20 listening conversations and {vocabRequirementText} to unlock the next level.
        </p>
      </section>
    </div>
  );
}

function VocabPage({
  level,
  showKana,
  stats,
  setStats,
  progress
}: {
  level: number;
  showKana: boolean;
  stats: StatsMap;
  setStats: (stats: StatsMap) => void;
  progress: LevelProgress;
}) {
  const activeCards = useMemo<VocabPracticeCard[]>(() => (
    vocabCards
      .filter((card) => card.level === level)
      .map((card) => ({ ...card, kind: 'vocab', frequency: card.frequencyRank }))
  ), [level]);
  const statsAnalysis = useMemo(() => analyzeVocabStats(activeCards, stats), [activeCards, stats]);
  const [queue, setQueue] = useState<VocabPracticeCard[]>([]);
  const [index, setIndex] = useState(0);
  const [statsOpen, setStatsOpen] = useState(false);

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
    <section className="practicePanel vocabPanel">
      <div className="panelHeader">
        <div>
          <p>Level {level}</p>
          <h2>{progress.theme}</h2>
        </div>
        <button
          className="progressBadge"
          onClick={() => setStatsOpen(true)}
          style={{ '--progress': `${Math.min(100, percent(progress.vocabMasteryRatio))}%` } as CSSProperties}
          type="button"
        >
          <span>{percent(progress.vocabMasteryRatio)}% Progress</span>
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

      <div className="vocabCardStage">
        {activeCards.length === 0 ? (
          <EmptyState title="No words in this level" body="Choose another level in Settings." />
        ) : complete ? (
          <CompletionPanel label="Vocabulary session complete" onNext={startSession} />
        ) : current ? (
          <VocabFlashcard card={current} showKana={showKana} stats={stats} onReview={review} />
        ) : null}
      </div>

      {statsOpen ? (
        <VocabStatsModal
          level={level}
          theme={progress.theme}
          progress={progress}
          analysis={statsAnalysis}
          onClose={() => setStatsOpen(false)}
        />
      ) : null}
    </section>
  );
}

function QuestionCard({
  conversation,
  questionIndex,
  state,
  onReveal,
  onReview
}: {
  conversation: StaticLibraryConversation;
  questionIndex: number;
  state: QuestionState;
  onReveal: () => void;
  onReview: (result: ReviewResult) => void;
}) {
  return (
    <article className={`questionCard ${state.revealed ? 'revealed' : ''} ${state.result ?? ''}`}>
      <div className="cardMeta">
        <span>Question {questionIndex + 1}</span>
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
  isCompleted,
  isStarred,
  playbackSpeed,
  onPlaybackSpeedChange,
  onComplete,
  onToggleStar,
  onNext
}: {
  conversation: StaticLibraryConversation;
  isCompleted: boolean;
  isStarred: boolean;
  playbackSpeed: number;
  onPlaybackSpeedChange: (speed: number) => void;
  onComplete: (conversationId: string) => void;
  onToggleStar: (conversationId: string) => void;
  onNext: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speedMenuRef = useRef<HTMLDivElement | null>(null);
  const [played, setPlayed] = useState(false);
  const [hasCompletedInitialPlay, setHasCompletedInitialPlay] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSpeedMenuOpen, setIsSpeedMenuOpen] = useState(false);
  const [visibleTranslations, setVisibleTranslations] = useState<Record<number, boolean>>({});
  const [questionStates, setQuestionStates] = useState<Record<number, QuestionState>>({});
  const completionNotifiedRef = useRef(false);

  useEffect(() => {
    const completedOrNoAudio = isCompleted || !conversation.audioUrl;
    setPlayed(completedOrNoAudio);
    setHasCompletedInitialPlay(isCompleted || !conversation.audioUrl);
    setIsPlaying(false);
    setVisibleTranslations({});
    setQuestionStates({});
    completionNotifiedRef.current = false;
  }, [conversation.id, conversation.audioUrl]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed;
    }
  }, [conversation.id, playbackSpeed]);

  useEffect(() => {
    if (!isSpeedMenuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!speedMenuRef.current?.contains(event.target as Node)) {
        setIsSpeedMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsSpeedMenuOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSpeedMenuOpen]);

  function skipAudio(seconds: number) {
    const audio = audioRef.current;
    if (!hasCompletedInitialPlay) return;
    if (!conversation.audioUrl || !audio) {
      setPlayed(true);
      return;
    }

    const upperBound = Number.isFinite(audio.duration) ? audio.duration : Number.POSITIVE_INFINITY;
    audio.currentTime = Math.min(Math.max(audio.currentTime + seconds, 0), upperBound);
  }

  async function toggleAudioPlayback() {
    if (!conversation.audioUrl) {
      setPlayed(true);
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;

    if (!audio.paused && !audio.ended) {
      audio.pause();
      return;
    }

    if (audio.ended) {
      audio.currentTime = 0;
    }

    audio.playbackRate = playbackSpeed;
    try {
      await audio.play();
    } catch {
      setIsPlaying(false);
    }
  }

  function reviewQuestion(questionIndex: number, result: ReviewResult) {
    setQuestionStates((current) => ({
      ...current,
      [questionIndex]: { revealed: true, result }
    }));
  }

  function retryConversation() {
    audioRef.current?.pause();
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
    setPlayed(false);
    setIsPlaying(false);
    setVisibleTranslations({});
    setQuestionStates({});
    completionNotifiedRef.current = false;
  }

  function toggleTranslation(lineIndex: number) {
    setVisibleTranslations((current) => ({
      ...current,
      [lineIndex]: !current[lineIndex]
    }));
  }

  const allAttempted = conversation.listeningQuestions.length > 0
    && conversation.listeningQuestions.every((_, index) => questionStates[index]?.result);
  const shouldShowTranscript = isCompleted || allAttempted;
  const hasAnsweredAny = Object.values(questionStates).some((state) => Boolean(state.result));
  const canStar = isStarred || isCompleted || hasCompletedInitialPlay;

  useEffect(() => {
    if (allAttempted && !completionNotifiedRef.current) {
      completionNotifiedRef.current = true;
      onComplete(conversation.id);
    }
  }, [allAttempted, conversation.id, onComplete]);

  return (
    <div className="conversationPractice">
      <article className="listenCard">
        <h2>{conversation.title}</h2>
        <span>{conversation.scene}</span>
        <div className="listenControls" aria-label="Conversation audio controls">
          <div className="playerSpeedMenu" ref={speedMenuRef}>
            <button
              className="playerControlButton speedButton"
              aria-label={`Playback speed ${playbackSpeed}x`}
              type="button"
              aria-haspopup="listbox"
              aria-expanded={isSpeedMenuOpen}
              onClick={() => setIsSpeedMenuOpen((open) => !open)}
            >
              {playbackSpeed}x
            </button>
            {isSpeedMenuOpen ? (
              <div className="playerSpeedMenuList" role="listbox" aria-label="Conversation playback speed">
                {CONVERSATION_PLAYBACK_SPEEDS.map((speed) => (
                  <button
                    className={playbackSpeed === speed ? 'active' : ''}
                    key={speed}
                    role="option"
                    aria-selected={playbackSpeed === speed}
                    onClick={() => {
                      onPlaybackSpeedChange(speed);
                      setIsSpeedMenuOpen(false);
                    }}
                    type="button"
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button className="playerControlButton" onClick={() => skipAudio(-5)} type="button" aria-label="Back 5 seconds" disabled={!hasCompletedInitialPlay}>
            <SkipBack size={19} fill="currentColor" />
          </button>
          <button className="roundPlayButton" onClick={toggleAudioPlayback} type="button" aria-label={isPlaying ? 'Pause conversation' : 'Play conversation'}>
            {isPlaying ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" />}
          </button>
          <button className="playerControlButton" onClick={() => skipAudio(5)} type="button" aria-label="Forward 5 seconds" disabled={!hasCompletedInitialPlay}>
            <SkipForward size={19} fill="currentColor" />
          </button>
          <button
            className={isStarred ? 'conversationStarButton active' : 'conversationStarButton'}
            onClick={() => onToggleStar(conversation.id)}
            type="button"
            aria-label={isStarred ? 'Unstar conversation' : 'Star conversation'}
            aria-pressed={isStarred}
            disabled={!canStar}
            title={canStar ? (isStarred ? 'Unstar conversation' : 'Star conversation') : 'Finish listening to star'}
          >
            <Star size={19} fill={isStarred ? 'currentColor' : 'none'} />
          </button>
        </div>
        {conversation.audioUrl ? (
          <audio
            ref={audioRef}
            src={conversation.audioUrl}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => {
              setPlayed(true);
              setHasCompletedInitialPlay(true);
              setIsPlaying(false);
            }}
          >
            <track kind="captions" />
          </audio>
        ) : null}
      </article>

      {played ? (
        <>
          {hasAnsweredAny ? (
            <div className="questionActionBar">
              <button className="iconTextButton" onClick={retryConversation} type="button">
                <RotateCcw size={17} />
                Retry
              </button>
            </div>
          ) : null}
          <div className="questionGrid">
            {conversation.listeningQuestions.map((_, questionIndex) => (
              <QuestionCard
                key={`${conversation.id}:${questionIndex}`}
                conversation={conversation}
                questionIndex={questionIndex}
                state={questionStates[questionIndex] ?? { revealed: false, result: null }}
                onReveal={() => setQuestionStates((current) => ({ ...current, [questionIndex]: { revealed: true, result: null } }))}
                onReview={(result) => reviewQuestion(questionIndex, result)}
              />
            ))}
          </div>
        </>
      ) : (
        <p className="listenHint">Questions unlock when the audio finishes.</p>
      )}

      {shouldShowTranscript ? (
        <section className="transcriptPanel">
          <div className="panelHeader compact">
            <div>
              <p>Transcript</p>
            </div>
          </div>
          {conversation.text.map((line, index) => (
            <div className="transcriptPracticeLine" key={`${conversation.id}:line:${index}`}>
              <div className="transcriptLineHeader">
                <strong>{line.speaker}</strong>
                <button
                  className={visibleTranslations[index] ? 'lineTranslationButton active' : 'lineTranslationButton'}
                  onClick={() => toggleTranslation(index)}
                  type="button"
                  aria-label={visibleTranslations[index] ? 'Hide translation' : 'Show translation'}
                >
                  <Languages size={16} />
                </button>
              </div>
              <span>{line.japanese}</span>
              {visibleTranslations[index] ? <p>{conversation.englishTranslation[index]?.english ?? ''}</p> : null}
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
  conversationProgress,
  setConversationProgress,
  progress,
  nextProgress,
  onOpenNextLevel
}: {
  level: number;
  library: StaticLibraryManifest;
  conversationProgress: ConversationProgress;
  setConversationProgress: Dispatch<SetStateAction<ConversationProgress>>;
  progress: LevelProgress;
  nextProgress: LevelProgress | null;
  onOpenNextLevel: (level: number) => void;
}) {
  const [playbackSpeed, setPlaybackSpeed] = useState(() => normalizePlaybackSpeed(loadConversationPlaybackSpeed()));
  const [isStarredModalOpen, setIsStarredModalOpen] = useState(false);
  const [unlockModalReason, setUnlockModalReason] = useState<'listening' | 'vocab' | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const allConversations = useMemo(() => library.conversations.filter((conversation) => conversation.level === level), [library, level]);
  const completedIds = useMemo(() => new Set(conversationProgress.completedConversationIds), [conversationProgress.completedConversationIds]);
  const starredIds = useMemo(() => new Set(conversationProgress.starredConversationIds), [conversationProgress.starredConversationIds]);
  const starredConversations = useMemo(() => allConversations.filter((conversation) => starredIds.has(conversation.id)), [allConversations, starredIds]);
  const conversations = allConversations;
  const emptyBody = PRACTICE_ONLY
    ? 'Published conversations will appear after the curated library is exported.'
    : 'Run the library export after approving conversations and generating audio in Kiki JLPT Studio.';

  useEffect(() => {
    const firstUncompleted = conversations.find((conversation) => !completedIds.has(conversation.id)) ?? conversations[0] ?? null;
    setSelectedConversationId(firstUncompleted?.id ?? null);
  }, [level, library.generatedAt, conversations, completedIds]);

  const current = conversations.find((conversation) => conversation.id === selectedConversationId) ?? conversations.find((conversation) => !completedIds.has(conversation.id)) ?? conversations[0];
  const currentConversationIndex = current ? conversations.findIndex((conversation) => conversation.id === current.id) + 1 : 0;
  const completedConversationIdsForLevel = conversationProgress.completedConversationIds.filter((id) => allConversations.some((conversation) => conversation.id === id));
  const currentCompletedIndex = current ? completedConversationIdsForLevel.indexOf(current.id) : -1;
  const listeningComplete = progress.listeningAttemptCount >= LEVEL_LISTENING_TARGET;
  const nextLevelNumber = nextProgress?.level ?? null;
  const levelProgressLabel = progress.complete && nextLevelNumber
    ? `Level ${nextLevelNumber} unlocked!`
    : listeningComplete
      ? 'Vocabulary needed'
      : `${Math.max(0, LEVEL_LISTENING_TARGET - progress.listeningAttemptCount)} more to unlock!`;
  const listeningProgressWidth = `${targetProgressPercent(progress.listeningAttemptCount, LEVEL_LISTENING_TARGET)}%`;
  const previousConversationId = currentCompletedIndex > 0
    ? completedConversationIdsForLevel[currentCompletedIndex - 1]
    : completedConversationIdsForLevel[completedConversationIdsForLevel.length - 1];
  const canGoPrevious = Boolean(previousConversationId && previousConversationId !== current?.id);
  const canGoNext = Boolean(current && completedIds.has(current.id) && conversations.length > 1);

  function updatePlaybackSpeed(speed: number) {
    setPlaybackSpeed(speed);
    saveConversationPlaybackSpeed(speed);
  }

  function completeConversation(conversationId: string) {
    setConversationProgress((currentProgress) => {
      const withoutCurrent = currentProgress.completedConversationIds.filter((id) => id !== conversationId);
      const nextProgress = {
        ...currentProgress,
        completedConversationIds: [...withoutCurrent, conversationId]
      };
      saveConversationProgress(nextProgress);
      return nextProgress;
    });
  }

  function toggleStarConversation(conversationId: string) {
    setConversationProgress((currentProgress) => {
      const starred = new Set(currentProgress.starredConversationIds);
      if (starred.has(conversationId)) {
        starred.delete(conversationId);
      } else {
        starred.add(conversationId);
      }

      const nextProgress = {
        ...currentProgress,
        starredConversationIds: Array.from(starred)
      };
      saveConversationProgress(nextProgress);
      return nextProgress;
    });
  }

  function showNextConversation() {
    if (!current) return;
    const currentIndex = conversations.findIndex((conversation) => conversation.id === current.id);
    const nextUncompleted = conversations
      .slice(currentIndex + 1)
      .find((conversation) => !completedIds.has(conversation.id))
      ?? conversations.find((conversation) => !completedIds.has(conversation.id) && conversation.id !== current.id)
      ?? conversations[(currentIndex + 1) % conversations.length];
    setSelectedConversationId(nextUncompleted?.id ?? null);
  }

  function handleLevelProgressClick() {
    if (progress.complete && nextLevelNumber) {
      onOpenNextLevel(nextLevelNumber);
      return;
    }

    setUnlockModalReason(listeningComplete ? 'vocab' : 'listening');
  }

  function openStarredConversation(conversationId: string) {
    setSelectedConversationId(conversationId);
    setIsStarredModalOpen(false);
  }

  return (
    <section className="practicePanel widePanel">
      <div className="panelHeader">
        <div>
          <p>Level {level}</p>
          <h2>{progress.theme}</h2>
        </div>
        <button
          className={progress.complete ? 'levelProgressBadge complete' : 'levelProgressBadge'}
          onClick={handleLevelProgressClick}
          style={{ '--progress': listeningProgressWidth } as CSSProperties}
          type="button"
        >
          <span>{levelProgressLabel}</span>
        </button>
      </div>
      {progress.listeningUnlocked && conversations.length > 0 ? (
        <div className="conversationToolbar">
          <button className="prevConversationButton" onClick={() => setSelectedConversationId(previousConversationId ?? null)} type="button" disabled={!canGoPrevious}>
            <ChevronLeft size={17} />
            Prev
          </button>
          <div
            className="starredPickerButton"
            aria-label={`Conversation ${currentConversationIndex} of ${conversations.length}`}
          >
            <span className="conversationPlaylistStatus">
              <ListOrdered size={18} />
              <span className="conversationPositionText">{currentConversationIndex} / {conversations.length}</span>
            </span>
            <button
              className="conversationStarredStatus"
              onClick={() => setIsStarredModalOpen(true)}
              type="button"
              aria-label={`Open starred conversations (${starredConversations.length})`}
            >
              <Star size={18} fill={starredConversations.length > 0 ? 'currentColor' : 'none'} />
              <span>{starredConversations.length}</span>
            </button>
          </div>
          <button className="nextConversationButton" onClick={showNextConversation} type="button" disabled={!canGoNext}>
            Next
            <ChevronRight size={17} />
          </button>
        </div>
      ) : null}
      {!progress.listeningUnlocked ? (
        <LockedPanel
          title={`Listening unlocks at ${LISTENING_UNLOCK_PERCENT}% vocabulary mastery`}
          body={`You have ${progress.strongVocabCount} of ${Math.ceil(progress.vocabTotal * LISTENING_UNLOCK_RATIO)} required strong words (${percent(progress.vocabMasteryRatio)}%). Keep practicing Level ${level} vocabulary to unlock conversations.`}
        />
      ) : allConversations.length === 0 ? (
        <EmptyState title="No published conversations yet" body={emptyBody} />
      ) : (
        <ConversationPractice
          key={current.id}
          conversation={current}
          isCompleted={completedIds.has(current.id)}
          isStarred={starredIds.has(current.id)}
          playbackSpeed={playbackSpeed}
          onPlaybackSpeedChange={updatePlaybackSpeed}
          onComplete={completeConversation}
          onToggleStar={toggleStarConversation}
          onNext={showNextConversation}
        />
      )}
      {isStarredModalOpen ? (
        <StarredConversationModal
          conversations={starredConversations}
          selectedConversationId={current?.id ?? null}
          onSelect={openStarredConversation}
          onClose={() => setIsStarredModalOpen(false)}
        />
      ) : null}
      {unlockModalReason ? (
        <LevelUnlockModal
          level={level}
          nextLevel={nextLevelNumber}
          progress={progress}
          reason={unlockModalReason}
          onClose={() => setUnlockModalReason(null)}
        />
      ) : null}
    </section>
  );
}

function StarredConversationModal({
  conversations,
  selectedConversationId,
  onSelect,
  onClose
}: {
  conversations: StaticLibraryConversation[];
  selectedConversationId: string | null;
  onSelect: (conversationId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="statsModal" role="dialog" aria-modal="true" aria-labelledby="starred-conversations-title">
      <button className="statsModalBackdrop" aria-label="Close starred conversations" onClick={onClose} type="button" />
      <section className="statsModalPanel starredConversationPanel">
        <header className="statsModalHeader">
          <div>
            <h2 id="starred-conversations-title">Starred conversations</h2>
          </div>
          <button className="modalCloseButton" aria-label="Close starred conversations" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>
        {conversations.length === 0 ? (
          <p className="emptyStatText starredEmptyText">Star conversations after listening to revisit them here.</p>
        ) : (
          <div className="starredConversationList">
            {conversations.map((conversation, index) => {
              const isSelected = conversation.id === selectedConversationId;
              return (
                <button
                  className={isSelected ? 'starredConversationItem active' : 'starredConversationItem'}
                  key={conversation.id}
                  onClick={() => onSelect(conversation.id)}
                  type="button"
                >
                  <span>
                    <strong>{index + 1}. {conversation.title}</strong>
                    <em>{conversation.scene}</em>
                  </span>
                  {isSelected ? <Check size={18} /> : <ChevronRight size={18} />}
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function SettingsPage({
  settings,
  setSettings,
  library,
  levelProgress
}: {
  settings: LearnerSettings;
  setSettings: (settings: LearnerSettings) => void;
  library: StaticLibraryManifest;
  levelProgress: LevelProgress[];
}) {
  function update(nextSettings: LearnerSettings) {
    setSettings(nextSettings);
    saveSettings(nextSettings);
  }

  const selectedProgress = levelProgress.find((progress) => progress.level === settings.level) ?? levelProgress[0];

  return (
    <section className="practicePanel settingsPanel">
      <div className="panelHeader">
        <div>
          <p>Settings</p>
          <h2>Practice setup</h2>
        </div>
      </div>

      <section className="settingsBlock">
        <div className="settingsBlockHeader">
          <div>
            <span>Level ladder</span>
            <h3>Choose your current level</h3>
          </div>
          <Trophy size={22} />
        </div>
        <p className="settingsHelp">
          Listening opens after {LISTENING_UNLOCK_PERCENT}% of a level's words are strong. The next level opens after {LEVEL_MASTERY_PERCENT}% strong vocabulary and 20 completed listening conversations.
        </p>
        <div className="levelButtonGrid">
          {levelProgress.map((progress) => {
            const isSelected = settings.level === progress.level;
            return (
              <button
                aria-pressed={isSelected}
                className={`levelButton ${isSelected ? 'active' : ''} ${progress.unlocked ? '' : 'locked'}`}
                disabled={!progress.unlocked}
                key={progress.level}
                onClick={() => update({ ...settings, level: progress.level })}
                type="button"
              >
                <span className="levelButtonTop">
                  <strong>Level {progress.level}</strong>
                  {progress.unlocked ? progress.complete ? <Check size={17} /> : null : <Lock size={16} />}
                </span>
                <span className="levelTheme">{progress.theme}</span>
                <span className="levelMeters">
                  <i><b style={{ width: `${Math.min(100, percent(progress.vocabMasteryRatio))}%` }} /></i>
                  <em>{percent(progress.vocabMasteryRatio)}% vocab</em>
                </span>
                <span className="levelListening">{Math.min(progress.listeningAttemptCount, LEVEL_LISTENING_TARGET)} / {LEVEL_LISTENING_TARGET} listening</span>
              </button>
            );
          })}
        </div>
      </section>

      {selectedProgress ? (
        <section className="settingsBlock compactBlock">
          <div className="progressRuleGrid">
            <div className={selectedProgress.listeningUnlocked ? 'ruleCard done' : 'ruleCard'}>
              <span>{percent(selectedProgress.vocabMasteryRatio)}%</span>
              <strong>Listening access</strong>
              <p>{selectedProgress.listeningUnlocked ? 'Unlocked for this level.' : `${Math.max(0, Math.ceil(selectedProgress.vocabTotal * LISTENING_UNLOCK_RATIO) - selectedProgress.strongVocabCount)} more strong words needed.`}</p>
            </div>
            <div className={selectedProgress.complete ? 'ruleCard done' : 'ruleCard'}>
              <span>{selectedProgress.listeningAttemptCount}</span>
              <strong>Next level</strong>
              <p>{selectedProgress.complete ? 'Next level is open.' : `Reach ${LEVEL_MASTERY_PERCENT}% strong vocab and 20 completed listening conversations.`}</p>
            </div>
          </div>
        </section>
      ) : null}

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

function LockedPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="practiceEmpty lockedPanel">
      <Lock size={38} />
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
  const [lastPracticeArea, setLastPracticeArea] = useState<PracticeArea>('vocab');
  const [settings, setSettings] = useState<LearnerSettings>(() => loadSettings(levelSummaries[0]?.set ?? 1));
  const [mikanTheme, setMikanTheme] = useState<MikanTheme>(deviceMikanTheme);
  const [vocabStats, setVocabStats] = useState<StatsMap>(loadVocabStats);
  const [conversationProgress, setConversationProgress] = useState<ConversationProgress>(loadConversationProgress);
  const [library, setLibrary] = useState<StaticLibraryManifest>({ version: 1, generatedAt: '', conversations: [] });
  const [libraryError, setLibraryError] = useState<string | null>(null);

  useEffect(() => {
    const handleHashChange = () => setArea(navFromHash());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    if (area !== 'settings') {
      setLastPracticeArea(area);
    }
  }, [area]);

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

  const levelProgress = useMemo(() => buildLevelProgress(vocabStats, conversationProgress, library), [vocabStats, conversationProgress, library]);
  const currentProgress = levelProgress.find((progress) => progress.level === settings.level) ?? levelProgress[0];
  const nextProgress = levelProgress.find((progress) => progress.level === settings.level + 1) ?? null;
  const settingsHref = area === 'settings' ? routeForArea(lastPracticeArea) : '#/practice/settings';

  useEffect(() => {
    if (!currentProgress || currentProgress.unlocked) return;
    const fallback = levelProgress.find((progress) => progress.unlocked) ?? levelProgress[0];
    if (!fallback) return;
    const nextSettings = { ...settings, level: fallback.level };
    setSettings(nextSettings);
    saveSettings(nextSettings);
  }, [currentProgress, levelProgress, settings]);

  function openLevelVocab(level: number) {
    const nextSettings = { ...settings, level };
    setSettings(nextSettings);
    saveSettings(nextSettings);
    window.location.hash = routeForArea('vocab');
  }

  return (
    <main className="practiceShell" data-theme={mikanTheme}>
      <aside className="practiceSidebar">
        <div className="practiceHeaderBar">
          <div className="practiceBrand">
            <BrandLogo className="practiceBrandLogo" title="Kiki JLPT" />
            <div>
              <div className="practiceBrandTitle">
                <h1>Kiki JLPT</h1>
              </div>
            </div>
          </div>
          <a
            aria-label={area === 'settings' ? 'Close settings' : 'Settings'}
            className={`settingsIconLink ${area === 'settings' ? 'active closeSettings' : ''}`}
            href={settingsHref}
            title={area === 'settings' ? 'Close settings' : 'Settings'}
          >
            {area === 'settings' ? <X size={20} /> : <Settings size={20} />}
          </a>
        </div>
        <nav className="practiceNav">
          <a className={area === 'vocab' ? 'active' : ''} href="#/practice">
            <BookOpen size={18} />
            Vocabulary
          </a>
          <a
            className={area === 'conversations' ? 'active' : ''}
            href="#/practice/conversations"
          >
            <Headphones size={18} />
            Conversations
          </a>
        </nav>
        {PRACTICE_ONLY ? null : (
          <a className="studioLink" href="#">
            Kiki JLPT Studio
          </a>
        )}
      </aside>

      <section className="practiceWorkspace">
        {libraryError ? <div className="practiceError">{libraryError}</div> : null}
        {area === 'vocab' ? (
          <VocabPage level={settings.level} showKana={settings.showKana} stats={vocabStats} setStats={setVocabStats} progress={currentProgress} />
        ) : null}
        {area === 'conversations' ? (
          <ConversationsPage
            level={settings.level}
            library={library}
            conversationProgress={conversationProgress}
            setConversationProgress={setConversationProgress}
            progress={currentProgress}
            nextProgress={nextProgress}
            onOpenNextLevel={openLevelVocab}
          />
        ) : null}
        {area === 'settings' ? (
          <SettingsPage settings={settings} setSettings={setSettings} library={library} levelProgress={levelProgress} />
        ) : null}
      </section>
    </main>
  );
}
