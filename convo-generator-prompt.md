You are helping create controlled JLPT N5 listening practice.

Goal:
Generate mini Japanese conversations for listening practice using only vocabulary the learner has already reached.

Current stage:
Set {{setNumber}}

Allowed content vocabulary:
Use only words from Set 1 through Set {{setNumber}} in the vocabulary table below.
Allowed vocabulary count: {{allowedVocabularyCount}}

Allowed vocabulary table:
{{allowedVocabularyTable}}

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
1. Do not use Japanese content words outside the allowed vocabulary table.
2. Common Japanese personal names are allowed and do not count as vocabulary.
3. Do not introduce new words outside the vocabulary table unless necessary to keep a sentence natural.
4. Do not include romaji.
5. Keep the Japanese natural but beginner-friendly.
6. Avoid advanced grammar.
7. Reuse vocabulary naturally across conversations for repeated listening exposure.
8.  Prefer current Set {{setNumber}} words when possible, while using earlier set words for natural glue.
9.  If the requested number of conversations is too small to cover all allowed words, maximize useful variety instead of forcing unnatural lines.
10. Try your best to cover all words in the current Set {{setNumber}}. Ideally we should have 100% coverage.
11. Speaker 1 is always female. If she is named or referred to by name, use a common Japanese female name.
12. Speaker 2 is always male. If he is named or referred to by name, use a common Japanese male name.
13. Do not give Speaker 1 male names or masculine self-reference. Do not give Speaker 2 female names or feminine self-reference.

Delivery tag rules:
1. Every spoken line must include delivery tags.
2. Tags describe emotion, tone, pace, or feeling for TTS delivery.
3. Multiple tags are allowed.
4. Every tag list must end with "slow".
5. Tags are not Japanese vocabulary and do not count toward the vocabulary restriction.
6. Keep tags simple and useful, such as:
   friendly, curious, excited, polite, apologetic, gentle, calm, sleepy, soft, slow

Task:
Create exactly {{conversationCount}} mini conversations in Japanese.

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
      "listeningQuestions": [ "Question in English" ] /* array of 4-6 questions */,
      "answerKey": [ "Answer in English" ] /* answer for each question */,
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
1. Did every spoken line include delivery tags?
2. Did every delivery tag list end with slow?
3. Does every conversation have 6-10 spoken lines?
4. Does every conversation have 4-6 listening questions and matching answers?
5. Are Speaker 1 names/references female and Speaker 2 names/references male?
6. Are the conversations natural and suitable for beginner listening practice?
