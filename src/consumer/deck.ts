import type { DirectionStats, PracticeCard, ReviewResult, StatsMap, StrengthBucket } from './types.ts';

export const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_EASE = 2.5;
const MIN_EASE = 1.3;
const RECENT_RESULTS_LIMIT = 10;
const MIN_RECENT_REVIEWS_FOR_STRONG = 5;

export function createEmptyStats(): DirectionStats {
  return {
    streak: 0,
    reviews: 0,
    recentResults: [],
    ease: DEFAULT_EASE,
    intervalDays: 0,
    lastReviewedAt: null,
    dueAt: 0
  };
}

export function getStats(stats: StatsMap, cardId: string): DirectionStats {
  return { ...createEmptyStats(), ...(stats[cardId] ?? {}) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function calculateNextStats(current: DirectionStats, result: ReviewResult, reviewedAt = Date.now()): DirectionStats {
  const isGotIt = result === 'gotIt';
  const nextReviews = current.reviews + 1;
  const recentResults = [...current.recentResults, isGotIt ? 1 : 0].slice(-RECENT_RESULTS_LIMIT) as Array<0 | 1>;
  const base: DirectionStats = {
    streak: isGotIt ? current.streak + 1 : -1,
    reviews: nextReviews,
    recentResults,
    ease: isGotIt ? clamp(current.ease + 0.1, MIN_EASE, 3) : Math.max(MIN_EASE, current.ease - 0.2),
    intervalDays: 0,
    lastReviewedAt: reviewedAt,
    dueAt: reviewedAt
  };

  if (!isGotIt) return base;

  let intervalDays = 1;
  if (current.reviews === 1) {
    intervalDays = 3;
  } else if (current.reviews >= 2) {
    intervalDays = Math.max(4, Math.round(Math.max(1, current.intervalDays) * current.ease));
  }

  return {
    ...base,
    intervalDays,
    dueAt: reviewedAt + intervalDays * DAY_IN_MS
  };
}

function accuracy(stats: DirectionStats): number {
  if (stats.reviews === 0) return 0.5;
  const recent = stats.recentResults;
  if (recent.length >= MIN_RECENT_REVIEWS_FOR_STRONG) {
    return recent.reduce<number>((sum, value) => sum + value, 0) / recent.length;
  }
  return Math.max(0, Math.min(1, stats.streak > 0 ? 0.7 : 0.35));
}

export function getBucket(stats: DirectionStats): StrengthBucket {
  if (stats.reviews === 0) return 'new';
  const currentAccuracy = accuracy(stats);
  if (currentAccuracy < 0.6 || stats.streak < 0) return 'weak';
  if (currentAccuracy > 0.8 && stats.streak >= 3 && stats.recentResults.length >= MIN_RECENT_REVIEWS_FOR_STRONG) return 'strong';
  return 'improving';
}

export function shuffleCards<TCard>(cards: TCard[]): TCard[] {
  const shuffled = [...cards];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }

  return shuffled;
}

function pickRandomCard<TCard>(cards: TCard[]): TCard | null {
  if (cards.length === 0) return null;
  return cards[Math.floor(Math.random() * cards.length)];
}

function pickRandomCards<TCard>(cards: TCard[], count: number): TCard[] {
  return shuffleCards(cards).slice(0, Math.max(0, count));
}

function pickNewCards<TCard extends PracticeCard>(cards: TCard[], count: number): TCard[] {
  const ranked = cards.filter((card) => typeof card.frequency === 'number' && Number.isFinite(card.frequency));
  const unranked = cards.filter((card) => typeof card.frequency !== 'number' || !Number.isFinite(card.frequency));
  const selected: TCard[] = [];
  let remainingRanked = [...ranked];
  let remainingUnranked = [...unranked];

  while (selected.length < count && (remainingRanked.length > 0 || remainingUnranked.length > 0)) {
    const shouldPickRanked = remainingRanked.length > 0 && (remainingUnranked.length === 0 || Math.random() < remainingRanked.length / (remainingRanked.length + remainingUnranked.length));

    if (shouldPickRanked) {
      const bestRank = Math.min(...remainingRanked.map((card) => card.frequency ?? Number.POSITIVE_INFINITY));
      const selectedCard = pickRandomCard(remainingRanked.filter((card) => card.frequency === bestRank));
      if (!selectedCard) break;
      selected.push(selectedCard);
      remainingRanked = remainingRanked.filter((card) => card.id !== selectedCard.id);
      continue;
    }

    const selectedCard = pickRandomCard(remainingUnranked);
    if (!selectedCard) break;
    selected.push(selectedCard);
    remainingUnranked = remainingUnranked.filter((card) => card.id !== selectedCard.id);
  }

  return selected;
}

function buildSessionQueueFromBuckets<TCard extends PracticeCard>(
  buckets: Record<StrengthBucket, TCard[]>,
  sessionSize: number
): TCard[] {
  const baseStrongTarget = Math.min(3, buckets.strong.length);
  const nonStrongTarget = sessionSize - baseStrongTarget;
  const learningPoolSize = buckets.weak.length + buckets.improving.length;
  const learningTarget = Math.min(nonStrongTarget, learningPoolSize);
  const remainingAfterLearning = nonStrongTarget - learningTarget;
  const newTarget = Math.min(2, remainingAfterLearning, buckets.new.length);
  const remainingAfterNew = remainingAfterLearning - newTarget;
  const extraStrongTarget = Math.min(remainingAfterNew, Math.max(0, buckets.strong.length - baseStrongTarget));
  const extraNewTarget = Math.min(remainingAfterNew - extraStrongTarget, Math.max(0, buckets.new.length - newTarget));
  const weakTarget = Math.min(buckets.weak.length, learningTarget);
  const improvingTarget = Math.min(buckets.improving.length, learningTarget - weakTarget);

  return shuffleCards([
    ...pickRandomCards(buckets.strong, baseStrongTarget + extraStrongTarget),
    ...pickRandomCards(buckets.weak, weakTarget),
    ...pickRandomCards(buckets.improving, improvingTarget),
    ...pickNewCards(buckets.new, newTarget + extraNewTarget)
  ]);
}

export function buildSessionQueue<TCard extends PracticeCard>(
  cards: TCard[],
  stats: StatsMap,
  sessionSize = 15
): TCard[] {
  if (cards.length <= sessionSize) return shuffleCards(cards);

  const buckets = cards.reduce<Record<StrengthBucket, TCard[]>>((acc, card) => {
    acc[getBucket(getStats(stats, card.id))].push(card);
    return acc;
  }, {
    new: [],
    weak: [],
    improving: [],
    strong: []
  });

  return buildSessionQueueFromBuckets(buckets, sessionSize);
}
