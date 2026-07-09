import { readFile } from 'node:fs/promises';
import { PROMPT_PATH } from './paths.ts';
import { formatVocabForPrompt } from './vocab.ts';
import type { LibraryBalancePlan, LibraryBalanceWord, VocabItem } from '../shared/types.ts';
import type { AiCurationLibraryContext } from './aiCuration.ts';
import { formatLanguagePolicyForPrompt } from './languagePolicy.ts';

const CONVERSATION_JSON_SHAPE = `{
  "conversations": [
    {
      "title": "Short English title",
      "scene": "One short English sentence describing the scene.",
      "sampleContext": "One short English sentence describing what is happening before the dialogue or how the speakers should sound.",
      "text": [
        {
          "speaker": "Speaker 1",
          "tags": ["friendly", "slow"],
          "japanese": "Japanese line"
        },
        {
          "speaker": "Speaker 2",
          "tags": ["curious", "slow"],
          "japanese": "Japanese line"
        }
      ],
      "listeningQuestions": [ "Question in English" ],
      "answerKey": [ "Answer in English" ],
      "declaredNonVocabularyTerms": [
        {
          "surface": "Japanese term exactly as used",
          "reading": "optional reading",
          "kind": "proper_noun or cultural_reference",
          "category": "person, place, city, region, landmark, institution, event, work_title, brand, food, or cultural_item",
          "rationale": "Short English reason this is a proper noun or cultural reference"
        }
      ],
      "englishTranslation": [
        {
          "speaker": "Speaker 1",
          "english": "English translation"
        }
      ]
    }
  ]
}`;

const CULTURAL_REFERENCE_GUIDANCE = `Cultural reference rules:
1. You may use a small number of very common Japanese proper nouns or cultural references when they fit the scene naturally, such as common places, cities, landmarks, foods, institutions, events, works/titles, brands, or cultural items.
2. These cultural references are for immersion only. They do not count as learned vocabulary and must not replace current-set vocabulary practice.
3. Do not use this exception for ordinary grammar, adjectives, verbs, adverbs, classroom glue, or later-set vocabulary that is not functioning as a proper noun or cultural reference.
4. Every proper noun or cultural reference outside the allowed vocabulary table must be listed in declaredNonVocabularyTerms for that conversation.`;

export async function buildGenerationPrompt(setNumber: number, conversationCount: number, allowedVocabulary: VocabItem[]): Promise<string> {
  const template = await readFile(PROMPT_PATH, 'utf8');

  return template
    .replaceAll('{{setNumber}}', String(setNumber))
    .replaceAll('{{conversationCount}}', String(conversationCount))
    .replaceAll('{{allowedVocabularyCount}}', String(allowedVocabulary.length))
    .replaceAll('{{allowedVocabularyTable}}', formatVocabForPrompt(allowedVocabulary))
    .replaceAll('{{languagePolicy}}', formatLanguagePolicyForPrompt());
}

function formatBalanceWords(words: LibraryBalanceWord[]): string {
  if (!words.length) return 'None';
  return words
    .map((word) => `${word.japanese} | ${word.reading || '-'} | ${word.meaning} | current library count ${word.libraryCount} | target ${word.targetCount} | needed ${word.neededCount}`)
    .join('\n');
}

export function buildLibraryComplementPrompt(
  setNumber: number,
  allowedVocabulary: VocabItem[],
  balance: LibraryBalancePlan,
  sourceLabel = 'curated library'
): string {
  return `You are helping create controlled JLPT N5 listening practice.

Goal:
Generate a small complementary batch of Japanese listening conversations for the existing ${sourceLabel}.
This is not a fresh full set. It must repair the existing batch's word distribution for Set ${setNumber}.

Current stage:
Set ${setNumber}

Allowed content vocabulary:
Use only words from Set 1 through Set ${setNumber} in the vocabulary table below.
Allowed vocabulary count: ${allowedVocabulary.length}

Allowed vocabulary table:
${formatVocabForPrompt(allowedVocabulary)}

Library balancing context:
- Existing ${sourceLabel} conversations for Set ${setNumber}: ${balance.libraryConversationCount}
- Tracked target words: Set ${setNumber} vocabulary only (${balance.targetWordCount} words)
- Current target-word mean count: ${balance.meanCount}
- Current target-word standard deviation: ${balance.standardDeviation}
- Words currently at zero count: ${balance.zeroCount}
- Low-coverage words below target count ${balance.targetCount}: ${balance.lowCoverageCount}
- Requested complementary batch size: ${balance.suggestedConversationCount}

Coverage accounting:
The current counts are conversation-level counts: a target word counts once for a conversation if it appears anywhere in that conversation.
Use repeated words naturally for listening practice, but do not rely on repeating a word many times in the same conversation to solve the balancing goal.

Required zero-count words:
Treat every word in this list as a strong coverage priority, unless the list says None. Cover as many as possible in meaningful contexts, but do not force an awkward use merely to clear the list.
${formatBalanceWords(balance.requiredZeroWords)}

Other priority underused words:
After covering every zero-count word, prefer these low-count words. Spread them across the batch so the combined library has a lower standard deviation.
${formatBalanceWords(balance.priorityWords.filter((word) => word.libraryCount > 0).slice(0, 80))}

Already overrepresented words:
Avoid making these words topic anchors. They may appear only when they are necessary for natural, beginner-friendly Japanese.
${formatBalanceWords(balance.overrepresentedWords)}

${formatLanguagePolicyForPrompt()}

${CULTURAL_REFERENCE_GUIDANCE}

Important rules:
1. Prioritize zero-count and underused current-set words, but omit or redistribute a priority word if using it would make the dialogue unnatural or incoherent.
2. Make selected priority words central and meaningful to their scenes rather than isolated mentions.
3. Use the other priority underused words as often as natural, favoring words with the largest needed count.
4. Keep the batch small and efficient: do not add filler conversations that do not improve useful coverage.
5. Vary scenes and vocabulary combinations, and repeat focal words only where natural.
6. Do not use Japanese content words outside the allowed vocabulary table, even if they are common JLPT N5 words from later sets.
7. If a natural sentence would require an unlisted Japanese content word, choose simpler wording or a different scene instead of using that word.
8. Keep the Japanese natural but beginner-friendly and avoid advanced grammar.
9. Speaker 1 is always female. If she is named, use only an approved female name from the language policy.
10. Speaker 2 is always male. If he is named, use only an approved male name from the language policy.

Delivery tag rules:
1. Every spoken line must include delivery tags.
2. Tags describe emotion, tone, pace, or feeling for TTS delivery.
3. Multiple tags are allowed.
4. Every tag list must end with "slow".
5. Tags are not Japanese vocabulary and do not count toward the vocabulary restriction.
6. Keep tags simple and useful, such as:
   friendly, curious, excited, polite, apologetic, gentle, calm, sleepy, soft, slow

Task:
Create exactly ${balance.suggestedConversationCount} mini conversations in Japanese.

Conversation requirements:
1. Each conversation should be around 20-40 seconds when spoken naturally.
2. Each conversation should have 6-10 spoken lines.
3. Use natural beginner Japanese, not robotic textbook fragments.
4. Each conversation should have a clear everyday situation.
5. Use only Speaker 1 and Speaker 2.
6. Do not use English inside Japanese spoken lines.
7. Use simple everyday themes that fit the allowed vocabulary.
8. Each conversation must include 4-6 listening questions. Questions should not be easy and must demonstrate comprehensive understanding of the conversation.
9. Each listening question must have a matching answer-key entry in the same order.

Return only valid JSON with this exact top-level shape:

{
  "conversations": [
    {
      "title": "Short English title",
      "scene": "One short English sentence describing the scene.",
      "sampleContext": "One short English sentence describing what is happening before the dialogue or how the speakers should sound.",
      "text": [
        {
          "speaker": "Speaker 1",
          "tags": ["friendly", "slow"],
          "japanese": "Japanese line"
        },
        {
          "speaker": "Speaker 2",
          "tags": ["curious", "slow"],
          "japanese": "Japanese line"
        }
      ],
      "listeningQuestions": [ "Question in English" ],
      "answerKey": [ "Answer in English" ],
      "declaredNonVocabularyTerms": [
        {
          "surface": "Japanese term exactly as used",
          "reading": "optional reading",
          "kind": "proper_noun or cultural_reference",
          "category": "person, place, city, region, landmark, institution, event, work_title, brand, food, or cultural_item",
          "rationale": "Short English reason this is a proper noun or cultural reference"
        }
      ],
      "englishTranslation": [
        {
          "speaker": "Speaker 1",
          "english": "English translation"
        }
      ]
    }
  ]
}

Final self-check before answering:
1. Did you cover as many zero-count words as natural dialogue permits, without forcing awkward lines?
2. Did you prioritize low-count words, make them meaningful to their scenes, and avoid overrepresented words where possible?
3. Did every spoken line include delivery tags?
4. Did every delivery tag list end with slow?
5. Does every conversation have 6-10 spoken lines?
6. Does every conversation have 4-6 listening questions and matching answers?
7. Are Speaker 1 names/references female and Speaker 2 names/references male?
8. Are the conversations natural and suitable for beginner listening practice?
9. Did you declare every out-of-table proper noun or cultural reference, and no ordinary vocabulary words?`;
}

export function buildAiLibraryBalancePrompt(
  setNumber: number,
  allowedVocabulary: VocabItem[],
  balance: LibraryBalancePlan,
  library: AiCurationLibraryContext
): string {
  return `You are an expert author creating controlled JLPT N5 listening practice that optimally balances an existing curated library.

Goal:
Author exactly ${balance.suggestedConversationCount} new Japanese listening conversations for Set ${setNumber} that best complement the existing curated library. Improve coverage of current-set vocabulary that is absent or underexposed, diversify scenes away from those already in the library, and use natural repetition rather than word stuffing. This is a complementary batch, not a fresh full set.

Authoritative inputs:
The deterministic balance plan and the per-word library exposure below are server-calculated and authoritative. Treat all supplied counts as fixed facts; never recompute or alter them. Use them only to decide what to reinforce.

Allowed content vocabulary:
Use only words from Set 1 through Set ${setNumber} in the vocabulary table below.
Allowed vocabulary count: ${allowedVocabulary.length}

Allowed vocabulary table:
${formatVocabForPrompt(allowedVocabulary)}

Library balancing context:
- Existing curated conversations for Set ${setNumber}: ${balance.libraryConversationCount}
- Tracked target words: Set ${setNumber} vocabulary only (${balance.targetWordCount} words)
- Current target-word mean count: ${balance.meanCount}
- Current target-word standard deviation: ${balance.standardDeviation}
- Words currently at zero count: ${balance.zeroCount}
- Low-coverage words below target count ${balance.targetCount}: ${balance.lowCoverageCount}
- Requested complementary batch size: ${balance.suggestedConversationCount}

Required zero-count words:
Treat every word in this list as a strong coverage priority, unless the list says None. Cover as many as possible in meaningful contexts, but do not force an awkward use merely to clear the list.
${formatBalanceWords(balance.requiredZeroWords)}

Other priority underused words:
After covering every zero-count word, prefer these low-count words. Spread them across the batch so the combined library has a lower standard deviation.
${formatBalanceWords(balance.priorityWords.filter((word) => word.libraryCount > 0).slice(0, 80))}

Already overrepresented words:
Avoid making these words topic anchors. They may appear only when they are necessary for natural, beginner-friendly Japanese.
${formatBalanceWords(balance.overrepresentedWords)}

Existing curated library (for redundancy avoidance and exposure awareness):
The wordExposure map gives the authoritative number of existing conversations that already use each current-set word. Read the existing conversations so your new scenes, situations, and dialogue do not duplicate them.
${JSON.stringify(library)}

${formatLanguagePolicyForPrompt()}

${CULTURAL_REFERENCE_GUIDANCE}

Important rules:
1. Prioritize zero-count and underused current-set words, but omit or redistribute a priority word if using it would make the dialogue unnatural or incoherent.
2. Make selected priority words central and meaningful to their scenes rather than isolated mentions.
3. Diversify scenes and situations away from those already in the existing library; do not retell or lightly reskin an existing conversation.
4. Repeat focal words only where natural; do not pad a conversation by repeating a word many times to inflate coverage.
5. Do not use Japanese content words outside the allowed vocabulary table, even if they are common JLPT N5 words from later sets.
6. If a natural sentence would require an unlisted Japanese content word, choose simpler wording or a different scene instead of using that word.
7. Keep the Japanese natural but beginner-friendly and avoid advanced grammar.
8. Speaker 1 is always female. If she is named, use only an approved female name from the language policy.
9. Speaker 2 is always male. If he is named, use only an approved male name from the language policy.

Delivery tag rules:
1. Every spoken line must include delivery tags.
2. Tags describe emotion, tone, pace, or feeling for TTS delivery.
3. Multiple tags are allowed.
4. Every tag list must end with "slow".
5. Tags are not Japanese vocabulary and do not count toward the vocabulary restriction.
6. Keep tags simple and useful, such as:
   friendly, curious, excited, polite, apologetic, gentle, calm, sleepy, soft, slow

Task:
Create exactly ${balance.suggestedConversationCount} mini conversations in Japanese.

Conversation requirements:
1. Each conversation should be around 20-40 seconds when spoken naturally.
2. Each conversation should have 6-10 spoken lines.
3. Use natural beginner Japanese, not robotic textbook fragments.
4. Each conversation should have a clear everyday situation.
5. Use only Speaker 1 and Speaker 2.
6. Do not use English inside Japanese spoken lines.
7. Use simple everyday themes that fit the allowed vocabulary.
8. Each conversation must include 4-6 listening questions. Questions should not be easy and must demonstrate comprehensive understanding of the conversation.
9. Each listening question must have a matching answer-key entry in the same order.

Return only valid JSON with this exact top-level shape:

${CONVERSATION_JSON_SHAPE}

Final self-check before answering:
1. Did you cover as many zero-count words as natural dialogue permits, without forcing awkward lines?
2. Did you prioritize low-count words, make them meaningful to their scenes, and avoid overrepresented words where possible?
3. Are your scenes distinct from the existing library conversations rather than duplicates?
4. Did every spoken line include delivery tags, and does every tag list end with slow?
5. Does every conversation have 6-10 spoken lines and 4-6 listening questions with matching answers?
6. Are Speaker 1 names/references female and Speaker 2 names/references male?
7. Did you declare every out-of-table proper noun or cultural reference, and no ordinary vocabulary words?`;
}
