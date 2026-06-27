import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { conversationVocabularyTerms, orderConversations, sortUnmasteredVocabularyCards } from './conversationOrdering.ts';
import { migrateConversationProgress, recordConversationCompletion } from './conversationProgress.ts';
import type {
  ConversationProgress,
  DirectionStats,
  StaticLibraryConversation,
  StatsMap,
  VocabCard
} from './types.ts';

function conversation(id: string, level: number, vocabularyUsed: string[]): StaticLibraryConversation {
  return {
    id,
    level,
    title: id,
    scene: '',
    text: [],
    englishTranslation: [],
    listeningQuestions: [],
    answerKey: [],
    vocabularyUsed
  };
}

function card(id: string, japanese: string, level = 1, reading = japanese): VocabCard {
  return {
    id,
    level,
    setTheme: '',
    withinSetNumber: 1,
    japanese,
    reading,
    romaji: '',
    meaning: `${japanese} meaning`,
    partOfSpeech: '',
    category: ''
  };
}

function strongStats(): DirectionStats {
  return {
    streak: 5,
    reviews: 5,
    recentResults: [1, 1, 1, 1, 1],
    ease: 2.5,
    intervalDays: 5,
    lastReviewedAt: 1,
    dueAt: 2
  };
}

describe('conversation vocabulary terms', () => {
  it('groups duplicate spellings and requires every eligible variant to be strong', () => {
    const watashi = card('watashi', '私', 1, 'わたし');
    const watakushi = card('watakushi', '私', 1, 'わたくし');
    const futureVariant = card('future', '私', 2, 'し');
    const conversationOne = conversation('one', 1, ['私', '私']);

    const partiallyMastered = conversationVocabularyTerms(conversationOne, [watashi, watakushi, futureVariant], {
      [watashi.id]: strongStats()
    });
    assert.equal(partiallyMastered.length, 1);
    assert.deepEqual(partiallyMastered[0].variants.map((variant) => variant.id), ['watashi', 'watakushi']);
    assert.equal(partiallyMastered[0].mastered, false);

    const fullyMastered = conversationVocabularyTerms(conversationOne, [watashi, watakushi, futureVariant], {
      [watashi.id]: strongStats(),
      [watakushi.id]: strongStats()
    });
    assert.equal(fullyMastered[0].mastered, true);
  });
});

describe('conversation ordering', () => {
  const cards = [card('x', 'x'), card('y', 'y'), card('z', 'z')];
  const conversations = [
    conversation('publish-a', 1, ['z']),
    conversation('publish-b', 1, ['x']),
    conversation('publish-c', 1, ['y', 'z']),
    conversation('publish-d', 1, [])
  ];

  it('keeps completed conversations first in completion order and ranks only unfinished ones', () => {
    const stats: StatsMap = { x: strongStats(), y: strongStats(), z: strongStats() };
    const ordered = orderConversations(conversations, ['publish-d', 'publish-a'], cards, stats);
    assert.deepEqual(ordered.map(({ id }) => id), ['publish-d', 'publish-a', 'publish-c', 'publish-b']);
  });

  it('reranks unfinished conversations as mastery changes and preserves publish order for ties', () => {
    const xMastered = orderConversations(conversations, [], cards, { x: strongStats() });
    assert.deepEqual(xMastered.map(({ id }) => id), ['publish-b', 'publish-a', 'publish-c', 'publish-d']);

    const yAndZMastered = orderConversations(conversations, [], cards, { y: strongStats(), z: strongStats() });
    assert.deepEqual(yAndZMastered.map(({ id }) => id), ['publish-c', 'publish-a', 'publish-b', 'publish-d']);
  });
});

describe('conversation vocabulary card ordering', () => {
  it('orders improving, needs-work, then new cards within a set', () => {
    const newCard = { ...card('new', '新'), withinSetNumber: 1 };
    const weakCard = { ...card('weak', '弱'), withinSetNumber: 3 };
    const improvingLater = { ...card('improving-later', '二'), withinSetNumber: 4 };
    const improvingEarlier = { ...card('improving-earlier', '一'), withinSetNumber: 2 };
    const stats: StatsMap = {
      weak: {
        ...strongStats(),
        streak: -1,
        reviews: 1,
        recentResults: [0]
      },
      'improving-later': {
        ...strongStats(),
        streak: 1,
        reviews: 1,
        recentResults: [1]
      },
      'improving-earlier': {
        ...strongStats(),
        streak: 1,
        reviews: 1,
        recentResults: [1]
      }
    };

    const ordered = sortUnmasteredVocabularyCards([newCard, weakCard, improvingLater, improvingEarlier], stats);
    assert.deepEqual(ordered.map(({ id }) => id), ['improving-earlier', 'improving-later', 'weak', 'new']);
  });
});

describe('legacy conversation progress migration', () => {
  const conversations = [
    conversation('set-02-published-a', 2, []),
    conversation('set-01-published-a', 1, []),
    conversation('set-01-published-b', 1, []),
    conversation('set-02-published-b', 2, [])
  ];

  it('converts legacy counts to the first conversations in publish order for each level', () => {
    const legacy: ConversationProgress = {
      completionOrderVersion: 0,
      completedConversationIds: ['set-01-old-a', 'set-02-old-a', 'set-01-old-b'],
      starredConversationIds: ['starred', 'starred']
    };

    assert.deepEqual(migrateConversationProgress(legacy, conversations), {
      completionOrderVersion: 1,
      completedConversationIds: ['set-02-published-a', 'set-01-published-a', 'set-01-published-b'],
      starredConversationIds: ['starred']
    });
  });

  it('leaves versioned completion order intact', () => {
    const current: ConversationProgress = {
      completionOrderVersion: 1,
      completedConversationIds: ['set-01-published-b', 'set-01-published-a'],
      starredConversationIds: []
    };

    assert.equal(migrateConversationProgress(current, conversations), current);
  });

  it('appends new completions once without moving an already completed conversation', () => {
    const current: ConversationProgress = {
      completionOrderVersion: 1,
      completedConversationIds: ['first', 'second'],
      starredConversationIds: []
    };

    const appended = recordConversationCompletion(current, 'third');
    assert.deepEqual(appended.completedConversationIds, ['first', 'second', 'third']);
    assert.equal(recordConversationCompletion(appended, 'first'), appended);
  });
});
