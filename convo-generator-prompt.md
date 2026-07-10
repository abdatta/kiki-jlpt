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

{{languagePolicy}}

Important rules:
1. Vocabulary from current Set {{setNumber}} is the primary learning focus. Make current-set words meaningful to each scene rather than isolated mentions.
2. Aim to cover the current set across the batch, but never force a word into an unnatural line. If the requested batch is too small, prefer a smaller amount of strong, useful coverage.
3. Use earlier-set vocabulary as natural supporting language, not as a substitute for meaningful current-set exposure.
4. Give focal current-set words useful context and repeat them only where the repetition sounds natural.
5. Vary situations and vocabulary combinations across conversations so the batch is not repetitive.
6. Do not use Japanese content words outside the allowed vocabulary table, even if they are common JLPT N5 words from later sets.
7. If a natural sentence would require an unlisted Japanese content word, choose simpler wording or a different scene instead of using that word.
8. Keep the Japanese natural but beginner-friendly and avoid advanced grammar.
9. Speaker 1 is always female. If she is named, use only an approved female name from the language policy.
10. Speaker 2 is always male. If he is named, use only an approved male name from the language policy.

Cultural reference rules:
1. You may use a small number of very common Japanese proper nouns or cultural references when they fit the scene naturally, such as common places, cities, landmarks, foods, institutions, events, works/titles, brands, or cultural items.
2. These cultural references are for immersion only. They do not count as learned vocabulary and must not replace current-set vocabulary practice.
3. Do not use this exception for ordinary grammar, adjectives, verbs, adverbs, classroom glue, or later-set vocabulary that is not functioning as a proper noun or cultural reference.
4. Every proper noun or cultural reference outside the allowed vocabulary table must be listed in declaredNonVocabularyTerms for that conversation.


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
2. Each conversation should have 8-10 spoken lines.
3. Use natural beginner Japanese, not robotic textbook fragments.
4. Each conversation should have a clear everyday situation.
5. Use only Speaker 1 and Speaker 2.
6. Do not use English inside Japanese spoken lines.
7. Use simple everyday themes that fit the allowed vocabulary.
8. Each conversation must include 5-8 listening questions. Questions should not be easy and must demonstrate comprehensive understanding of the conversation.
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
      "listeningQuestions": [ "Question in English" ] /* array of 5-8 questions */,
      "answerKey": [ "Answer in English" ] /* answer for each question */,
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
1. Did every spoken line include delivery tags?
2. Did every delivery tag list end with slow?
3. Does every conversation have 8-10 spoken lines?
4. Does every conversation have 5-8 listening questions and matching answers?
5. Are Speaker 1 names/references female and Speaker 2 names/references male?
6. Are the conversations natural and suitable for beginner listening practice?
7. Are current-set words meaningful to the scenes rather than inserted only for coverage?
8. Did the batch vary situations and avoid awkward word stuffing?
9. Did you declare every out-of-table proper noun or cultural reference, and no ordinary vocabulary words?
