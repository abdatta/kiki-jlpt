## 1. Prompt And Schema Updates

- [x] 1.1 Tighten `convo-generator-prompt.md` so unlisted Japanese content words are forbidden and naturalness is handled by simplifying wording or changing scenes.
- [x] 1.2 Add prompt guidance that encourages restrained model-selected Japanese cultural references, such as common places, cities, landmarks, and foods, when they fit the scene naturally.
- [x] 1.3 Apply the same hard vocabulary-boundary and cultural-reference declaration language to standard, workflow-primary, library-complement, and AI-balanced complementary prompts.
- [x] 1.4 Extend the generation JSON shape and shared types with optional generated proper-noun and cultural-reference metadata without breaking existing run files.
- [x] 1.5 Update conversation normalization to preserve optional proper-noun and cultural-reference metadata and default missing metadata safely.

## 2. Audit Policy And Evidence

- [x] 2.1 Add audit handling for approved generated names followed by permitted honorific suffixes such as `さん`.
- [x] 2.2 Add audit handling for model-declared cultural references, ensuring accepted declarations are exempt from true OOV but excluded from vocabulary coverage.
- [x] 2.3 Add guardrails that reject declarations for ordinary grammar, adjectives, verbs, adverbs, or later-set vocabulary that is not functioning as a proper noun or cultural reference.
- [x] 2.4 Add exemption evidence for approved names, model-declared cultural references, prompt-policy allowances, and rejected declarations.
- [x] 2.5 Keep true out-of-allowed content words separate from declared exemptions in curation evidence and aggregate analytics.
- [x] 2.6 Add unit tests for `けんさん`, `けんたさん`, accepted cultural references, rejected cultural-reference declarations, invalid proper-noun declarations, and later-set content words.

## 3. Vocabulary Quality Gate And Repair

- [x] 3.1 Define the vocabulary quality target policy, including a Set 2+ target of zero true content OOV after accepted proper-noun and cultural-reference exemptions without hard-failing usable batches.
- [x] 3.2 Implement a reusable generation-audit quality checker that returns offending conversations, line context, true OOV words, declared exemptions, and rejected declarations.
- [x] 3.3 Build a repair prompt that asks the selected text model to rewrite only offending conversations while preserving the required JSON shape, allowed vocabulary boundary, and valid cultural-reference declarations.
- [x] 3.4 Add a bounded repair loop to standard generation, background run generation, workflow primary generation, and library-complement generation.
- [x] 3.5 Ensure workflow checkpoints store repaired conversations and all generation/repair exchanges so resume does not repeat completed generation or repair calls.
- [x] 3.6 Preserve actionable quality details when the repair attempt does not improve the batch, while still saving the best usable audited result.

## 4. Studio Evidence And Wording

- [x] 4.1 Rename or clarify the Studio "New Words Introduced" label so it reads as out-of-allowed vocabulary rather than positive new vocabulary.
- [x] 4.2 Display true OOV findings separately from validated proper-name, declared cultural-reference, rejected declaration, or policy exemptions where audit details are shown.
- [x] 4.3 Preserve existing run and curated-library readability when older files do not include the new metadata or evidence fields.
- [x] 4.4 Mark workflow audit nodes and repair attempts when the latest repair failed or did not improve the audit, and allow rerunning repair for saved text-generation nodes when possible.

## 5. Verification

- [x] 5.1 Add prompt tests that assert hard vocabulary-boundary language and model-selected cultural-reference declaration guidance appear in standard and complementary prompts.
- [x] 5.2 Add generation pipeline tests for no-repair success, repair success, cultural-reference exemption success, rejected-declaration repair, and best-effort proceed-after-unimproved-repair behavior.
- [x] 5.3 Add workflow tests proving repaired checkpoints resume without repeating completed generation or repair calls.
- [x] 5.4 Add API coverage for rerunning repair on a saved workflow audit node and applying an improved result.
- [x] 5.5 Run `npm run test:unit`.
- [x] 5.6 Run `npm run build`.
- [x] 5.7 Run library publication checks if curated or published library output changes.
