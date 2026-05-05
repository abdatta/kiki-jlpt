import { readFile } from 'node:fs/promises';
import { PROMPT_PATH } from './paths.ts';
import { formatVocabForPrompt } from './vocab.ts';
import type { LibraryBalancePlan, LibraryBalanceWord, VocabItem } from '../shared/types.ts';

export async function buildGenerationPrompt(setNumber: number, conversationCount: number, allowedVocabulary: VocabItem[]): Promise<string> {
  const template = await readFile(PROMPT_PATH, 'utf8');

  return template
    .replaceAll('{{setNumber}}', String(setNumber))
    .replaceAll('{{conversationCount}}', String(conversationCount))
    .replaceAll('{{allowedVocabularyCount}}', String(allowedVocabulary.length))
    .replaceAll('{{allowedVocabularyTable}}', formatVocabForPrompt(allowedVocabulary));
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
  balance: LibraryBalancePlan
): string {
  return `You are helping create controlled JLPT N5 listening practice.

Goal:
Generate a small complementary batch of Japanese listening conversations for the existing curated library.
This is not a fresh full set. It must repair the library's word distribution for Set ${setNumber}.

Current stage:
Set ${setNumber}

Allowed content vocabulary:
Use only words from Set 1 through Set ${setNumber} in the vocabulary table below.
Allowed vocabulary count: ${allowedVocabulary.length}

Allowed vocabulary table:
${formatVocabForPrompt(allowedVocabulary)}

Library balancing context:
- Existing curated library conversations for Set ${setNumber}: ${balance.libraryConversationCount}
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
Every word in this list must appear at least once somewhere in the returned batch, unless the list says None.
${formatBalanceWords(balance.requiredZeroWords)}

Other priority underused words:
After covering every zero-count word, prefer these low-count words. Spread them across the batch so the combined library has a lower standard deviation.
${formatBalanceWords(balance.priorityWords.filter((word) => word.libraryCount > 0).slice(0, 80))}

Already overrepresented words:
Avoid making these words topic anchors. They may appear only when they are necessary for natural, beginner-friendly Japanese.
${formatBalanceWords(balance.overrepresentedWords)}

Allowed grammar/function whitelist:

Particles:
は, が, を, に, で, へ, と, も, の, か, ね, よ, から, まで, より, だけ

Polite forms:
です, でした, ではありません, じゃありません, ます, ません, ました, ませんでした

Basic grammar:
て-form, ください, ましょう, たいです, から, そして, でも, もう, まだ

Question words:
Question words are allowed only if they are in the allowed vocabulary table.

Conjugations:
Conjugations of learned verbs/adjectives are allowed and do not count as new words.

Important rules:
1. Every required zero-count word must appear in the overall returned batch so no tracked target word remains at zero after combining this batch with the library.
2. Use the other priority underused words as often as natural, favoring words with the largest needed count.
3. Keep the batch small and efficient: do not add filler conversations that do not improve coverage.
4. Do not use Japanese content words outside the allowed vocabulary table.
5. Common Japanese personal names are allowed and do not count as vocabulary.
6. Do not introduce new words outside the vocabulary table unless necessary to keep a sentence natural.
7. Keep the Japanese natural but beginner-friendly.
8. Avoid advanced grammar.
9. Speaker 1 is always female. If she is named or referred to by name, use a common Japanese female name.
10. Speaker 2 is always male. If he is named or referred to by name, use a common Japanese male name.

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
1. Did every required zero-count word appear at least once in the Japanese dialogue?
2. Did you prioritize low-count words and avoid overrepresented words where possible?
3. Did every spoken line include delivery tags?
4. Did every delivery tag list end with slow?
5. Does every conversation have 6-10 spoken lines?
6. Does every conversation have 4-6 listening questions and matching answers?
7. Are Speaker 1 names/references female and Speaker 2 names/references male?
8. Are the conversations natural and suitable for beginner listening practice?`;
}
