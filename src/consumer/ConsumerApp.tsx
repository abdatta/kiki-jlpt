import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, Dispatch, ReactNode, SetStateAction } from 'react';
import {
  BookOpen,
  Check,
  CheckCheck,
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
  SkipBack,
  SkipForward,
  Star,
  TriangleAlert,
  Trophy,
  X
} from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo.tsx';
import { buildSessionQueue, calculateNextStats, getBucket, getStats } from './deck.ts';
import { conversationVocabularyTerms, orderConversations, sortUnmasteredVocabularyCards } from './conversationOrdering.ts';
import type { ConversationVocabularyTerm } from './conversationOrdering.ts';
import { completedConversationIds, migrateConversationProgress, recordConversationCompletion } from './conversationProgress.ts';
import { levelSummaries, vocabCards } from './vocabData.ts';
import { loadLibrary } from './library.ts';
import {
  loadLevel,
  loadVocabStats,
  loadConversationPlaybackSpeed,
  loadConversationProgress,
  saveConversationPlaybackSpeed,
  saveConversationProgress,
  saveLevel,
  saveVocabStats
} from './storage.ts';
import type {
  PracticeArea,
  PracticeCard,
  ConversationProgress,
  ReviewResult,
  StaticLibraryConversation,
  StaticLibraryManifest,
  StatsMap,
  VocabCard
} from './types.ts';

type VocabPracticeCard = VocabCard & PracticeCard;
const LEVEL_LISTENING_TARGET = 20;
const PRACTICE_ONLY = import.meta.env.VITE_PRACTICE_ONLY === 'true';
const CONVERSATION_PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25] as const;

function OpenAIBlossomIcon({ size = 17 }: { size?: number }) {
  return (
    <svg aria-hidden="true" fill="none" height={size} viewBox="146 226 268 267" width={size} xmlns="http://www.w3.org/2000/svg">
      <path
        d="M249.176 323.434V298.276C249.176 296.158 249.971 294.569 251.825 293.509L302.406 264.381C309.29 260.409 317.5 258.555 325.973 258.555C357.75 258.555 377.877 283.185 377.877 309.399C377.877 311.253 377.877 313.371 377.611 315.49L325.178 284.771C322.001 282.919 318.822 282.919 315.645 284.771L249.176 323.434ZM367.283 421.415V361.301C367.283 357.592 365.694 354.945 362.516 353.092L296.048 314.43L317.763 301.982C319.617 300.925 321.206 300.925 323.058 301.982L373.639 331.112C388.205 339.586 398.003 357.592 398.003 375.069C398.003 395.195 386.087 413.733 367.283 421.412V421.415ZM233.553 368.452L211.838 355.742C209.986 354.684 209.19 353.095 209.19 350.975V292.718C209.19 264.383 230.905 242.932 260.301 242.932C271.423 242.932 281.748 246.641 290.49 253.26L238.321 283.449C235.146 285.303 233.555 287.951 233.555 291.659V368.455L233.553 368.452ZM280.292 395.462L249.176 377.985V340.913L280.292 323.436L311.407 340.913V377.985L280.292 395.462ZM300.286 475.968C289.163 475.968 278.837 472.259 270.097 465.64L322.264 435.449C325.441 433.597 327.03 430.949 327.03 427.239V350.445L349.011 363.155C350.865 364.213 351.66 365.802 351.66 367.922V426.179C351.66 454.514 329.679 475.965 300.286 475.965V475.968ZM237.525 416.915L186.944 387.785C172.378 379.31 162.582 361.305 162.582 343.827C162.582 323.436 174.763 305.164 193.563 297.485V357.861C193.563 361.571 195.154 364.217 198.33 366.071L264.535 404.467L242.82 416.915C240.967 417.972 239.377 417.972 237.525 416.915ZM234.614 460.343C204.689 460.343 182.71 437.833 182.71 410.028C182.71 407.91 182.976 405.792 183.238 403.672L235.405 433.863C238.582 435.715 241.763 435.715 244.938 433.863L311.407 395.466V420.622C311.407 422.742 310.612 424.331 308.758 425.389L258.179 454.519C251.293 458.491 243.083 460.343 234.611 460.343H234.614ZM300.286 491.854C332.329 491.854 359.073 469.082 365.167 438.892C394.825 431.211 413.892 403.406 413.892 375.073C413.892 356.535 405.948 338.529 391.648 325.552C392.972 319.991 393.766 314.43 393.766 308.87C393.766 271.003 363.048 242.666 327.562 242.666C320.413 242.666 313.528 243.723 306.644 246.109C294.725 234.457 278.307 227.042 260.301 227.042C228.258 227.042 201.513 249.815 195.42 280.004C165.761 287.685 146.694 315.49 146.694 343.824C146.694 362.362 154.638 380.368 168.938 393.344C167.613 398.906 166.819 404.467 166.819 410.027C166.819 447.894 197.538 476.231 233.024 476.231C240.172 476.231 247.058 475.173 253.943 472.788C265.859 484.441 282.278 491.854 300.286 491.854Z"
        fill="currentColor"
      />
    </svg>
  );
}

function envRatio(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, 1);
}

const LISTENING_UNLOCK_RATIO = envRatio(import.meta.env.VITE_LISTENING_UNLOCK_RATIO, 0.5);
const LISTENING_UNLOCK_PERCENT = percent(LISTENING_UNLOCK_RATIO);
const LEVEL_MASTERY_RATIO = envRatio(import.meta.env.VITE_LEVEL_MASTERY_RATIO, 0.9);
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
  card: VocabCard;
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
  return 'vocab';
}

function levelLadderFromHash(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.hash.includes('/level') || window.location.hash.includes('/settings');
}

function deviceMikanTheme(): MikanTheme {
  if (typeof window === 'undefined') return 'mikan-light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'mikan-dark' : 'mikan-light';
}

function strengthLabel(cardId: string, stats: StatsMap): string {
  const bucket = getBucket(getStats(stats, cardId));
  return bucket[0].toUpperCase() + bucket.slice(1);
}

function strengthStatusLabel(cardId: string, stats: StatsMap): string {
  const bucket = getBucket(getStats(stats, cardId));
  if (bucket === 'weak') return 'Needs Work';
  return bucket[0].toUpperCase() + bucket.slice(1);
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

function wordDetailSelection(card: VocabCard, stats: StatsMap): VocabWordStat | VocabCard {
  const cardStats = getStats(stats, card.id);
  if (cardStats.reviews === 0) return card;
  return {
    card,
    reviews: cardStats.reviews,
    streak: cardStats.streak,
    accuracy: statAccuracy(cardStats)
  };
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

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isConversationUnlocked(
  conversations: StaticLibraryConversation[],
  conversationIndex: number,
  completedIds: Set<string>
): boolean {
  if (conversationIndex < 0 || conversationIndex >= conversations.length) return false;
  return conversations.slice(0, conversationIndex).every((conversation) => completedIds.has(conversation.id));
}

function defaultConversationId(conversations: StaticLibraryConversation[], completedIds: Set<string>): string | null {
  const firstUnlockedUncompleted = conversations.find((conversation, index) => (
    !completedIds.has(conversation.id) && isConversationUnlocked(conversations, index, completedIds)
  ));
  return firstUnlockedUncompleted?.id ?? conversations[conversations.length - 1]?.id ?? null;
}

function routeForArea(area: PracticeArea): string {
  if (area === 'conversations') return '#/practice/conversations';
  return '#/practice';
}

function levelKanji(level: number): string {
  const numerals = ['\u96f6', '\u4e00', '\u4e8c', '\u4e09', '\u56db', '\u4e94', '\u516d', '\u4e03', '\u516b', '\u4e5d'];
  if (!Number.isInteger(level) || level < 0) return String(level);
  if (level < 10) return numerals[level];
  if (level === 10) return '\u5341';
  if (level < 20) return `\u5341${numerals[level % 10]}`;
  if (level < 100) {
    const ones = level % 10;
    return `${numerals[Math.floor(level / 10)]}\u5341${ones === 0 ? '' : numerals[ones]}`;
  }
  return String(level);
}

function levelLabel(level: number): string {
  return `${levelKanji(level)} Level ${level}`;
}

function buildLevelProgress(vocabStats: StatsMap, conversationProgress: ConversationProgress, library: StaticLibraryManifest): LevelProgress[] {
  let previousLevelsComplete = true;

  return levelSummaries.map((summary) => {
    const cards = vocabCards.filter((card) => card.level === summary.set);
    const levelConversations = library.conversations.filter((conversation) => conversation.level === summary.set);
    const completedIds = completedConversationIds(levelConversations, conversationProgress.completedConversationIds);
    const strongVocabCount = cards.filter((card) => getBucket(getStats(vocabStats, card.id)) === 'strong').length;
    const vocabMasteryRatio = cards.length > 0 ? strongVocabCount / cards.length : 0;
    const listeningAttemptCount = levelConversations.filter((conversation) => completedIds.has(conversation.id)).length;
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
  stats,
  onReview
}: {
  card: VocabPracticeCard;
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
        <span>{card.category || card.partOfSpeech || levelLabel(card.level)}</span>
      </div>

      <div className="vocabPrompt">
        <span>{card.japanese}</span>
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

function WordTile({
  card,
  label,
  isNew = false,
  onSelect
}: {
  card: VocabCard;
  label?: string;
  isNew?: boolean;
  onSelect: () => void;
}) {
  return (
    <button className={isNew ? 'wordStatTile newWordTile' : 'wordStatTile'} onClick={onSelect} type="button">
      <strong>{card.japanese}</strong>
      {label ? <span>{label}</span> : null}
    </button>
  );
}

function WordStatSection({
  title,
  qualifier,
  count,
  children
}: {
  title: string;
  qualifier?: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="wordStatSection">
      <header>
        <h3>{title}{qualifier ? <small>{qualifier}</small> : null}</h3>
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
  selected: VocabWordStat | VocabCard;
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
            <p>{card.informationalKind === 'external' ? 'Outside Course Vocabulary' : `Set ${card.level}`} · Word details</p>
            <h3 id="word-detail-title">{card.japanese}</h3>
            <span>{card.romaji || card.reading}</span>
          </div>
          <button className="modalCloseButton" aria-label="Close word details" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>
        <div className="wordDetailGrid">
          <div className="wordMeaningBox">
            <span>Meaning</span>
            <strong>{card.meaning}</strong>
          </div>
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
              <strong>{card.informationalKind ? 'Conversation reference' : 'New'}</strong>
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
  const [selectedWord, setSelectedWord] = useState<VocabWordStat | VocabCard | null>(null);
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
            <p>{levelLabel(level)}</p>
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
          <div className="wordStatList">{analysis.strong.map((item) => <WordTile card={item.card} key={item.card.id} label={`${Math.round(item.accuracy * 100)}%`} onSelect={() => setSelectedWord(item)} />)}</div>
        </WordStatSection>

        <WordStatSection title="Improving" count={analysis.improving.length}>
          <div className="wordStatList">{analysis.improving.map((item) => <WordTile card={item.card} key={item.card.id} label={`${Math.round(item.accuracy * 100)}%`} onSelect={() => setSelectedWord(item)} />)}</div>
        </WordStatSection>

        <WordStatSection title="Needs Work" count={analysis.weak.length}>
          <div className="wordStatList">{analysis.weak.map((item) => <WordTile card={item.card} key={item.card.id} label={`${Math.round(item.accuracy * 100)}%`} onSelect={() => setSelectedWord(item)} />)}</div>
        </WordStatSection>

        <section className="wordStatSection">
          <header>
            <h3>New Words</h3>
            <div className="hiddenWordsControls">
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
              <div className="wordStatList">{analysis.newWords.map((card) => <WordTile card={card} isNew key={card.id} label="New" onSelect={() => setSelectedWord(card)} />)}</div>
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
            <p>{levelLabel(level)} progress</p>
            <h2 id="level-unlock-title">{title}</h2>
          </div>
          <button className="modalCloseButton" aria-label="Close level progress" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>

        <p className="unlockModalIntro">
          {nextLevel ? `${levelLabel(nextLevel)} opens when both requirements are complete.` : 'This is the final published level for now.'}
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
  stats,
  setStats,
  progress
}: {
  level: number;
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
          <p>{levelLabel(level)}</p>
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
          <EmptyState title="No words in this level" body="Choose another level from the level ladder." />
        ) : complete ? (
          <CompletionPanel label="Vocabulary session complete" onNext={startSession} />
        ) : current ? (
          <VocabFlashcard card={current} stats={stats} onReview={review} />
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

function wordsToReviewLabel(count: number): string {
  if (count === 0) return 'No words to review';
  return `${count} ${count === 1 ? 'word' : 'words'} to review`;
}

function ConversationVocabularyModal({
  conversation,
  terms,
  stats,
  onClose
}: {
  conversation: StaticLibraryConversation;
  terms: ConversationVocabularyTerm[];
  stats: StatsMap;
  onClose: () => void;
}) {
  const [showMasteredWords, setShowMasteredWords] = useState(false);
  const [selectedWord, setSelectedWord] = useState<VocabWordStat | VocabCard | null>(null);
  const unmasteredCardsByLevel = new Map<number, VocabCard[]>();
  const masteredCardsByLevel = new Map<number, VocabCard[]>();

  for (const term of terms) {
    for (const card of term.variants) {
      const cardsByLevel = getBucket(getStats(stats, card.id)) === 'strong'
        ? masteredCardsByLevel
        : unmasteredCardsByLevel;
      cardsByLevel.set(card.level, [...(cardsByLevel.get(card.level) ?? []), card]);
    }
  }

  const unmasteredLevelGroups = [...unmasteredCardsByLevel.entries()]
    .sort(([a], [b]) => a - b)
    .map(([setNumber, cards]) => [setNumber, sortUnmasteredVocabularyCards(cards, stats)] as const);
  const masteredLevelGroups = [...masteredCardsByLevel.entries()]
    .sort(([a], [b]) => a - b)
    .map(([setNumber, cards]) => [
      setNumber,
      [...cards].sort((a, b) => a.withinSetNumber - b.withinSetNumber || a.id.localeCompare(b.id))
    ] as const);
  const unmasteredTermCount = terms.filter((term) => !term.mastered).length;
  const masteredCardCount = [...masteredCardsByLevel.values()].reduce((count, cards) => count + cards.length, 0);
  const references = conversation.vocabularyReferences ?? [];
  const futureSetNumbers = [...new Set(references.filter((reference) => reference.kind === 'future_set').map((reference) => reference.setNumber!))].sort((a, b) => a - b);
  const externalReferences = references.filter((reference) => reference.kind === 'external');
  const referenceCard = (reference: (typeof references)[number]): VocabCard => ({
    id: `reference:${reference.kind}:${reference.japanese}`,
    level: reference.setNumber ?? conversation.level,
    setTheme: '',
    withinSetNumber: 0,
    japanese: reference.japanese,
    reading: reference.reading,
    romaji: '',
    meaning: reference.meaning,
    partOfSpeech: reference.partOfSpeech ?? '',
    category: reference.category ?? '',
    informationalKind: reference.kind
  });

  return (
    <div className="statsModal" role="dialog" aria-modal="true" aria-labelledby="conversation-vocabulary-title">
      <button className="statsModalBackdrop" aria-label="Close conversation vocabulary" onClick={onClose} type="button" />
      <section className="statsModalPanel conversationVocabularyPanel">
        <header className="statsModalHeader">
          <div>
            <p>{conversation.title}</p>
            <h2 id="conversation-vocabulary-title">{wordsToReviewLabel(unmasteredTermCount + (conversation.vocabularyReferences?.length ?? 0))}</h2>
          </div>
          <button className="modalCloseButton" aria-label="Close conversation vocabulary" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>

        {unmasteredLevelGroups.length === 0 ? (
          <p className="emptyStatText conversationVocabularyEmpty">Every tracked vocabulary word in this conversation is strong.</p>
        ) : (
          unmasteredLevelGroups.map(([setNumber, cards]) => (
            <WordStatSection title={`Set ${setNumber}`} count={cards.length} key={setNumber}>
              <div className="wordStatList">
                {cards.map((card) => (
                  <WordTile
                    card={card}
                    isNew={getBucket(getStats(stats, card.id)) === 'new'}
                    key={card.id}
                    label={strengthStatusLabel(card.id, stats)}
                    onSelect={() => setSelectedWord(wordDetailSelection(card, stats))}
                  />
                ))}
              </div>
            </WordStatSection>
          ))
        )}

        {futureSetNumbers.map((setNumber) => {
          const group = references.filter((reference) => reference.kind === 'future_set' && reference.setNumber === setNumber);
          return (
            <WordStatSection title={`Set ${setNumber}`} qualifier="Future Set" count={group.length} key={`future-${setNumber}`}>
              <div className="wordStatList">
                {group.map((reference) => {
                  const card = referenceCard(reference);
                  return <WordTile card={card} key={card.id} onSelect={() => setSelectedWord(card)} />;
                })}
              </div>
            </WordStatSection>
          );
        })}

        {externalReferences.length ? (
          <WordStatSection title="Extra Vocab" qualifier="Outside Course" count={externalReferences.length}>
            <div className="wordStatList">
              {externalReferences.map((reference) => {
                const card = referenceCard(reference);
                return <WordTile card={card} key={card.id} onSelect={() => setSelectedWord(card)} />;
              })}
            </div>
          </WordStatSection>
        ) : null}

        <section className="wordStatSection">
          <header>
            <h3>Mastered Words</h3>
            <div className="hiddenWordsControls">
              <span>{masteredCardCount}</span>
              <button
                aria-label={showMasteredWords ? 'Hide mastered words' : 'Show mastered words'}
                aria-pressed={showMasteredWords}
                className={showMasteredWords ? 'active' : ''}
                onClick={() => setShowMasteredWords((value) => !value)}
                type="button"
              >
                <Eye size={16} />
              </button>
            </div>
          </header>
          {showMasteredWords ? (
            masteredLevelGroups.length === 0 ? (
              <p className="emptyStatText">No mastered words yet.</p>
            ) : (
              masteredLevelGroups.map(([setNumber, cards]) => (
                <WordStatSection title={`Set ${setNumber}`} count={cards.length} key={setNumber}>
                  <div className="wordStatList">
                    {cards.map((card) => (
                      <WordTile
                        card={card}
                        key={card.id}
                        label="Strong"
                        onSelect={() => setSelectedWord(wordDetailSelection(card, stats))}
                      />
                    ))}
                  </div>
                </WordStatSection>
              ))
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

function ConversationPractice({
  conversation,
  vocabularyTerms,
  vocabStats,
  isCompleted,
  isStarred,
  playbackSpeed,
  onPlaybackSpeedChange,
  onComplete,
  onToggleStar,
  onNext,
  canGoNext
}: {
  conversation: StaticLibraryConversation;
  vocabularyTerms: ConversationVocabularyTerm[];
  vocabStats: StatsMap;
  isCompleted: boolean;
  isStarred: boolean;
  playbackSpeed: number;
  onPlaybackSpeedChange: (speed: number) => void;
  onComplete: (conversationId: string) => void;
  onToggleStar: (conversationId: string) => void;
  onNext: () => void;
  canGoNext: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speedMenuRef = useRef<HTMLDivElement | null>(null);
  const [played, setPlayed] = useState(false);
  const [hasCompletedInitialPlay, setHasCompletedInitialPlay] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSpeedMenuOpen, setIsSpeedMenuOpen] = useState(false);
  const [isVocabularyModalOpen, setIsVocabularyModalOpen] = useState(false);
  const [visibleTranslations, setVisibleTranslations] = useState<Record<number, boolean>>({});
  const [questionStates, setQuestionStates] = useState<Record<number, QuestionState>>({});
  const completionNotifiedRef = useRef(false);

  useEffect(() => {
    const completedOrNoAudio = isCompleted || !conversation.audioUrl;
    setPlayed(completedOrNoAudio);
    setHasCompletedInitialPlay(isCompleted || !conversation.audioUrl);
    setIsPlaying(false);
    setIsVocabularyModalOpen(false);
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
    ? conversation.listeningQuestions.every((_, index) => questionStates[index]?.result)
    : played;
  const shouldShowTranscript = isCompleted || allAttempted;
  const hasAnsweredAny = Object.values(questionStates).some((state) => Boolean(state.result));
  const canStar = isStarred || isCompleted || hasCompletedInitialPlay;
  const unmasteredTerms = vocabularyTerms.filter((term) => !term.mastered);
  const wordsToReviewCount = unmasteredTerms.length + (conversation.vocabularyReferences?.length ?? 0);

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
        <button
          className="conversationVocabularyPill"
          aria-label={wordsToReviewLabel(wordsToReviewCount)}
          onClick={() => setIsVocabularyModalOpen(true)}
          title={wordsToReviewLabel(wordsToReviewCount)}
          type="button"
        >
          {wordsToReviewCount === 0 ? (
            <CheckCheck size={18} />
          ) : (
            <>
              <TriangleAlert size={15} />
              <span>{wordsToReviewCount}</span>
            </>
          )}
        </button>
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
                <div className="transcriptLineActions">
                  <a
                    className="lineActionButton"
                    href={`https://chatgpt.com/?q=${encodeURIComponent(`${line.japanese} - breakdown & explain`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Break down and explain line ${index + 1} in ChatGPT`}
                    title="Break down and explain in ChatGPT"
                  >
                    <OpenAIBlossomIcon />
                  </a>
                  <button
                    className={visibleTranslations[index] ? 'lineActionButton active' : 'lineActionButton'}
                    onClick={() => toggleTranslation(index)}
                    type="button"
                    aria-label={visibleTranslations[index] ? 'Hide translation' : 'Show translation'}
                  >
                    <Languages size={16} />
                  </button>
                </div>
              </div>
              <span>{line.japanese}</span>
              {visibleTranslations[index] ? <p>{conversation.englishTranslation[index]?.english ?? ''}</p> : null}
            </div>
          ))}
          <button className="primaryPracticeButton nextConversation" onClick={onNext} disabled={!canGoNext}>
            Next Conversation
            <ChevronRight size={18} />
          </button>
        </section>
      ) : null}
      {isVocabularyModalOpen ? (
        <ConversationVocabularyModal
          conversation={conversation}
          terms={vocabularyTerms}
          stats={vocabStats}
          onClose={() => setIsVocabularyModalOpen(false)}
        />
      ) : null}
    </div>
  );
}

function ConversationsPage({
  level,
  library,
  vocabStats,
  conversationProgress,
  setConversationProgress,
  progress,
  nextProgress,
  onOpenNextLevel
}: {
  level: number;
  library: StaticLibraryManifest;
  vocabStats: StatsMap;
  conversationProgress: ConversationProgress;
  setConversationProgress: Dispatch<SetStateAction<ConversationProgress>>;
  progress: LevelProgress;
  nextProgress: LevelProgress | null;
  onOpenNextLevel: (level: number) => void;
}) {
  const [playbackSpeed, setPlaybackSpeed] = useState(() => normalizePlaybackSpeed(loadConversationPlaybackSpeed()));
  const [navigatorFilter, setNavigatorFilter] = useState<'all' | 'starred' | null>(null);
  const [unlockModalReason, setUnlockModalReason] = useState<'listening' | 'vocab' | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const allConversations = useMemo(() => library.conversations.filter((conversation) => conversation.level === level), [library, level]);
  const starredIds = useMemo(() => new Set(conversationProgress.starredConversationIds), [conversationProgress.starredConversationIds]);
  const starredConversations = useMemo(() => allConversations.filter((conversation) => starredIds.has(conversation.id)), [allConversations, starredIds]);
  const conversations = useMemo(() => orderConversations(
    allConversations,
    conversationProgress.completedConversationIds,
    vocabCards,
    vocabStats
  ), [allConversations, conversationProgress.completedConversationIds, vocabStats]);
  const completedIds = useMemo(
    () => completedConversationIds(conversations, conversationProgress.completedConversationIds),
    [conversationProgress.completedConversationIds, conversations]
  );
  const navigatorConversations = useMemo(() => {
    const completed = conversations.filter((conversation) => completedIds.has(conversation.id));
    const currentInProgress = conversations.find((conversation) => !completedIds.has(conversation.id));
    return currentInProgress ? [...completed, currentInProgress] : completed;
  }, [conversations, completedIds]);
  const navigatorStarredCount = useMemo(
    () => navigatorConversations.filter((conversation) => starredIds.has(conversation.id)).length,
    [navigatorConversations, starredIds]
  );
  const emptyBody = PRACTICE_ONLY
    ? 'Published conversations will appear after the curated library is exported.'
    : 'Run the library export after approving conversations and generating audio in Kiki JLPT Studio.';

  useEffect(() => {
    setSelectedConversationId((currentId) => {
      const currentSelectedIndex = conversations.findIndex((conversation) => conversation.id === currentId);
      if (currentId && isConversationUnlocked(conversations, currentSelectedIndex, completedIds)) {
        return currentId;
      }

      return defaultConversationId(conversations, completedIds);
    });
  }, [level, library.generatedAt, conversations, completedIds]);

  const selectedConversationIndex = conversations.findIndex((conversation) => conversation.id === selectedConversationId);
  const fallbackConversationId = defaultConversationId(conversations, completedIds);
  const fallbackConversationIndex = conversations.findIndex((conversation) => conversation.id === fallbackConversationId);
  const currentIndex = isConversationUnlocked(conversations, selectedConversationIndex, completedIds)
    ? selectedConversationIndex
    : fallbackConversationIndex;
  const current = currentIndex >= 0 ? conversations[currentIndex] : undefined;
  const currentVocabularyTerms = useMemo(
    () => current ? conversationVocabularyTerms(current, vocabCards, vocabStats) : [],
    [current, vocabStats]
  );
  const currentConversationIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
  const listeningComplete = progress.listeningAttemptCount >= LEVEL_LISTENING_TARGET;
  const nextLevelNumber = nextProgress?.level ?? null;
  const levelProgressLabel = progress.complete && nextLevelNumber
    ? 'Next level unlocked!'
    : listeningComplete
      ? 'Vocabulary needed'
      : `${progress.listeningAttemptCount}/${LEVEL_LISTENING_TARGET} Completed`;
  const listeningProgressWidth = `${targetProgressPercent(progress.listeningAttemptCount, LEVEL_LISTENING_TARGET)}%`;
  const previousConversationId = isConversationUnlocked(conversations, currentIndex - 1, completedIds)
    ? conversations[currentIndex - 1]?.id ?? null
    : null;
  const nextConversationId = isConversationUnlocked(conversations, currentIndex + 1, completedIds)
    ? conversations[currentIndex + 1]?.id ?? null
    : null;
  const canGoPrevious = Boolean(previousConversationId);
  const canGoNext = Boolean(nextConversationId);

  function updatePlaybackSpeed(speed: number) {
    setPlaybackSpeed(speed);
    saveConversationPlaybackSpeed(speed);
  }

  function completeConversation(conversationId: string) {
    setConversationProgress((currentProgress) => {
      const nextProgress = recordConversationCompletion(currentProgress, conversationId);
      if (nextProgress === currentProgress) return currentProgress;
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
    if (!nextConversationId) return;
    setSelectedConversationId(nextConversationId);
  }

  function handleLevelProgressClick() {
    if (progress.complete && nextLevelNumber) {
      onOpenNextLevel(nextLevelNumber);
      return;
    }

    setUnlockModalReason(listeningComplete ? 'vocab' : 'listening');
  }

  function selectNavigatorConversation(conversationId: string) {
    setSelectedConversationId(conversationId);
    setNavigatorFilter(null);
  }

  return (
    <section className="practicePanel widePanel">
      <div className="panelHeader">
        <div>
          <p>{levelLabel(level)}</p>
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
          <div className="starredPickerButton">
            <button
              className="conversationPlaylistStatus"
              onClick={() => setNavigatorFilter('all')}
              type="button"
              aria-label={`Browse conversations (${currentConversationIndex} of ${conversations.length})`}
            >
              <ListOrdered size={18} />
              <span className="conversationPositionText">{currentConversationIndex} / {conversations.length}</span>
            </button>
            <button
              className="conversationStarredStatus"
              onClick={() => setNavigatorFilter('starred')}
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
          body={`You have ${progress.strongVocabCount} of ${Math.ceil(progress.vocabTotal * LISTENING_UNLOCK_RATIO)} required strong words (${percent(progress.vocabMasteryRatio)}%). Keep practicing ${levelLabel(level)} vocabulary to unlock conversations.`}
        />
      ) : allConversations.length === 0 ? (
        <EmptyState title="No published conversations yet" body={emptyBody} />
      ) : current ? (
        <ConversationPractice
          key={current.id}
          conversation={current}
          vocabularyTerms={currentVocabularyTerms}
          vocabStats={vocabStats}
          isCompleted={completedIds.has(current.id)}
          isStarred={starredIds.has(current.id)}
          playbackSpeed={playbackSpeed}
          onPlaybackSpeedChange={updatePlaybackSpeed}
          onComplete={completeConversation}
          onToggleStar={toggleStarConversation}
          onNext={showNextConversation}
          canGoNext={canGoNext}
        />
      ) : (
        <EmptyState title="No available conversation" body="Choose another level from the level ladder." />
      )}
      {navigatorFilter ? (
        <ConversationNavigatorModal
          conversations={navigatorConversations}
          starredIds={starredIds}
          starredCount={navigatorStarredCount}
          selectedConversationId={current?.id ?? null}
          initialFilter={navigatorFilter}
          onSelect={selectNavigatorConversation}
          onClose={() => setNavigatorFilter(null)}
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

function ConversationNavigatorModal({
  conversations,
  starredIds,
  starredCount,
  selectedConversationId,
  initialFilter,
  onSelect,
  onClose
}: {
  conversations: StaticLibraryConversation[];
  starredIds: Set<string>;
  starredCount: number;
  selectedConversationId: string | null;
  initialFilter: 'all' | 'starred';
  onSelect: (conversationId: string) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'starred'>(initialFilter);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollEdges, setScrollEdges] = useState({ atTop: true, atBottom: true });

  function syncScrollEdges() {
    const list = listRef.current;
    if (!list) return;
    const atTop = list.scrollTop <= 0;
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
    setScrollEdges((current) => (current.atTop === atTop && current.atBottom === atBottom ? current : { atTop, atBottom }));
  }

  useLayoutEffect(() => {
    const list = listRef.current;
    const row = activeRowRef.current;
    if (list && row) {
      const rowRect = row.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      list.scrollTop += (rowRect.top - listRect.top) - (list.clientHeight - row.clientHeight) / 2;
    }
    syncScrollEdges();
  }, []);

  useEffect(() => {
    syncScrollEdges();
    const settleTimer = setTimeout(syncScrollEdges, 360);
    return () => clearTimeout(settleTimer);
  }, [filter]);

  const numberedConversations = conversations.map((conversation, index) => ({
    conversation,
    number: index + 1,
    isStarred: starredIds.has(conversation.id)
  }));
  const visibleCount = filter === 'starred' ? starredCount : conversations.length;

  return (
    <div className="statsModal" role="dialog" aria-modal="true" aria-labelledby="conversation-navigator-title">
      <button className="statsModalBackdrop" aria-label="Close conversations" onClick={onClose} type="button" />
      <section className="statsModalPanel starredConversationPanel">
        <div className="navigatorHeader">
          <header className="statsModalHeader">
            <div>
              <h2 id="conversation-navigator-title">Conversations</h2>
            </div>
            <button className="modalCloseButton" aria-label="Close conversations" onClick={onClose} type="button">
              <X size={18} />
            </button>
          </header>
          <div className="conversationFilter" role="group" aria-label="Filter conversations" data-active={filter}>
            <span className="conversationFilterIndicator" aria-hidden="true" />
            <button
              className={filter === 'all' ? 'conversationFilterOption active' : 'conversationFilterOption'}
              onClick={() => setFilter('all')}
              type="button"
              aria-pressed={filter === 'all'}
            >
              All <span>{conversations.length}</span>
            </button>
            <button
              className={filter === 'starred' ? 'conversationFilterOption active' : 'conversationFilterOption'}
              onClick={() => setFilter('starred')}
              type="button"
              aria-pressed={filter === 'starred'}
            >
              <Star size={14} fill={starredCount > 0 ? 'currentColor' : 'none'} /> Starred <span>{starredCount}</span>
            </button>
          </div>
        </div>
        <div
          className="starredConversationList"
          ref={listRef}
          onScroll={syncScrollEdges}
          data-at-top={scrollEdges.atTop}
          data-at-bottom={scrollEdges.atBottom}
        >
          {numberedConversations.map(({ conversation, number, isStarred }) => {
            const isSelected = conversation.id === selectedConversationId;
            const rowHidden = filter === 'starred' && !isStarred;
            return (
              <div className="conversationRow" data-hidden={rowHidden} aria-hidden={rowHidden} key={conversation.id}>
                <div className="conversationRowInner">
                  <button
                    className={isSelected ? 'starredConversationItem active' : 'starredConversationItem'}
                    ref={isSelected ? activeRowRef : undefined}
                    onClick={() => onSelect(conversation.id)}
                    tabIndex={rowHidden ? -1 : undefined}
                    type="button"
                  >
                    <span>
                      <strong>{number}. {conversation.title}</strong>
                      <em>{conversation.scene}</em>
                    </span>
                    <span className="conversationItemMeta">
                      {isStarred ? <Star className="conversationItemStar" size={16} fill="currentColor" aria-hidden="true" /> : null}
                      {isSelected ? <Check size={18} /> : <ChevronRight size={18} />}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {visibleCount === 0 ? (
          <p className="emptyStatText starredEmptyText">
            {filter === 'starred'
              ? 'Star conversations after listening to revisit them here.'
              : 'Finish a conversation to see it here.'}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function LevelLadderPanel({
  level,
  setLevel,
  levelProgress,
  onClose
}: {
  level: number;
  setLevel: (level: number) => void;
  levelProgress: LevelProgress[];
  onClose: () => void;
}) {
  function chooseLevel(nextLevel: number) {
    setLevel(nextLevel);
    saveLevel(nextLevel);
    onClose();
  }

  return (
    <section className="practicePanel levelLadderPanel">
      <div className="levelLadderHeader">
        <div>
          <span>Level ladder</span>
          <h2 id="level-ladder-title">Choose your current level</h2>
        </div>
        <Trophy size={22} />
        <button className="levelCloseButton" onClick={onClose} aria-label="Close level ladder" title="Close level ladder" type="button">
          <X size={20} />
        </button>
      </div>

      <p className="levelLadderHelp">
        Listening opens after {LISTENING_UNLOCK_PERCENT}% of a level's words are strong. The next level opens after {LEVEL_MASTERY_PERCENT}% strong vocabulary and 20 completed listening conversations.
      </p>
      <div className="levelButtonGrid">
        {levelProgress.map((progress) => {
          const isSelected = level === progress.level;
          return (
            <button
              aria-pressed={isSelected}
              className={`levelButton ${isSelected ? 'active' : ''} ${progress.unlocked ? '' : 'locked'}`}
              disabled={!progress.unlocked}
              key={progress.level}
              onClick={() => chooseLevel(progress.level)}
              type="button"
            >
              <span className="levelButtonTop">
                <strong>{levelLabel(progress.level)}</strong>
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
  const [isLevelLadderOpen, setIsLevelLadderOpen] = useState(levelLadderFromHash);
  const [level, setLevel] = useState(() => loadLevel(levelSummaries[0]?.set ?? 1));
  const [mikanTheme, setMikanTheme] = useState<MikanTheme>(deviceMikanTheme);
  const [vocabStats, setVocabStats] = useState<StatsMap>(loadVocabStats);
  const [conversationProgress, setConversationProgress] = useState<ConversationProgress>(loadConversationProgress);
  const [library, setLibrary] = useState<StaticLibraryManifest>({ version: 3, generatedAt: '', conversations: [] });
  const [libraryError, setLibraryError] = useState<string | null>(null);

  useEffect(() => {
    const handleHashChange = () => {
      const nextLevelLadderOpen = levelLadderFromHash();
      setIsLevelLadderOpen(nextLevelLadderOpen);
      if (!nextLevelLadderOpen) {
        setArea(navFromHash());
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    setLastPracticeArea(area);
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
        setConversationProgress((currentProgress) => {
          const migratedProgress = migrateConversationProgress(currentProgress, manifest.conversations);
          if (migratedProgress !== currentProgress) {
            saveConversationProgress(migratedProgress);
          }
          return migratedProgress;
        });
        setLibraryError(null);
      })
      .catch((error) => setLibraryError(error instanceof Error ? error.message : String(error)));
  }, []);

  const levelProgress = useMemo(() => buildLevelProgress(vocabStats, conversationProgress, library), [vocabStats, conversationProgress, library]);
  const currentProgress = levelProgress.find((progress) => progress.level === level) ?? levelProgress[0];
  const nextProgress = levelProgress.find((progress) => progress.level === level + 1) ?? null;
  const levelLadderCloseHref = routeForArea(lastPracticeArea);
  const libraryReady = library.generatedAt !== '' || library.conversations.length > 0;

  useEffect(() => {
    if (!libraryReady) return;
    if (!currentProgress || currentProgress.unlocked) return;
    const fallback = levelProgress.find((progress) => progress.unlocked) ?? levelProgress[0];
    if (!fallback) return;
    setLevel(fallback.level);
    saveLevel(fallback.level);
  }, [currentProgress, levelProgress, libraryReady]);

  function openLevelVocab(level: number) {
    setLevel(level);
    saveLevel(level);
    window.location.hash = routeForArea('vocab');
  }

  function closeLevelLadder() {
    setIsLevelLadderOpen(false);
    if (levelLadderFromHash()) {
      window.location.hash = levelLadderCloseHref;
    }
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
          <button
            aria-label={`Change level. Current ${levelLabel(level)}`}
            className={`headerIconButton levelNavLink ${isLevelLadderOpen ? 'active' : ''}`}
            onClick={() => setIsLevelLadderOpen(true)}
            title={`Change level. Current ${levelLabel(level)}`}
            type="button"
          >
            <span className="levelNavKanji" aria-hidden="true">{levelKanji(level)}</span>
            <span>Level {level}</span>
          </button>
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
          <VocabPage level={level} stats={vocabStats} setStats={setVocabStats} progress={currentProgress} />
        ) : null}
        {area === 'conversations' ? (
          <ConversationsPage
            level={level}
            library={library}
            vocabStats={vocabStats}
            conversationProgress={conversationProgress}
            setConversationProgress={setConversationProgress}
            progress={currentProgress}
            nextProgress={nextProgress}
            onOpenNextLevel={openLevelVocab}
          />
        ) : null}
      </section>
      {isLevelLadderOpen ? (
        <div className="levelLadderModal" role="dialog" aria-modal="true" aria-labelledby="level-ladder-title">
          <button className="levelLadderModalBackdrop" aria-label="Close level ladder" onClick={closeLevelLadder} type="button" />
          <LevelLadderPanel level={level} setLevel={setLevel} levelProgress={levelProgress} onClose={closeLevelLadder} />
        </div>
      ) : null}
    </main>
  );
}
