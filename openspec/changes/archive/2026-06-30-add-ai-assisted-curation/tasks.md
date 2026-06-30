## 1. Establish Deterministic Curation Evidence

- [x] 1.1 Add shared language-policy definitions for prompt-permitted grammar/function expressions, conjugation handling, tokenizer exclusions, and an approved common-name list, with a version identifier for calculated evidence.
- [x] 1.2 Extend vocabulary auditing to calculate canonical unique current-set words, cumulative allowed words, unique out-of-vocabulary words, and out-of-vocabulary occurrence counts without changing curated or published conversation records.
- [x] 1.3 Add shared curation-evidence API types and return evidence sidecars for run, library, and recommendation conversations while preserving existing `vocabularyUsed` and `outOfVocabularyAudit` compatibility fields.
- [x] 1.4 Add unit tests for duplicate vocabulary spellings, Set 2 current-versus-cumulative counts, conjugated vocabulary, prompt-permitted expressions, fillers, recognized proper nouns, approved ambiguous names, and true out-of-vocabulary occurrences.

## 2. Improve Generation Guidance

- [x] 2.1 Generate the prompt whitelist and approved-name guidance from the shared language policy so standard generation and auditing cannot drift.
- [x] 2.2 Revise the standard generation prompt to make current-set vocabulary meaningful focal content, encourage natural repetition and scene diversity, and discourage isolated word stuffing.
- [x] 2.3 Revise complementary generation prompts to retain zero/low-coverage priorities while allowing awkward priority words to be omitted or redistributed in favor of natural beginner dialogue.
- [x] 2.4 Add prompt-builder tests covering current-set focus, earlier-set support, shared exemptions, and the softened naturalness constraint for complementary batches.

## 3. Implement AI Curation Reviews

- [x] 3.1 Generalize the Gemini and Codex structured-JSON invocation paths so curation can reuse model selection, raw output, timing, statistics, and provider-specific instructions without conversation-generation assumptions.
- [x] 3.2 Define AI curation review, snapshot, recommendation, failure, freshness, and provenance types, including stable source-run/conversation identities and authoritative evidence references.
- [x] 3.3 Build the set-scoped candidate and library snapshot assembler so every non-curated same-set conversation is accounted for with full dialogue, translations, questions, answers, deterministic evidence, and library exposure context.
- [x] 3.4 Build the curator prompt and strict response validator for ordered portfolio selection, collection-level rationale, candidate strengths and concerns, empty recommendations, and rejection of unknown, duplicate, or ineligible identities.
- [x] 3.5 Add bounded-context execution that uses one model request when possible and complete-content evaluation batches plus a final portfolio pass when necessary, verifying that no eligible candidate is silently omitted.
- [x] 3.6 Persist successful and failed set-scoped curation reviews with model exchanges, evidence version, candidate/library fingerprints, and validated results; calculate stale status against current run and library state.
- [x] 3.7 Add server operations to create, retrieve, and retry AI curation reviews using the selected configured text model, returning safe validation/provider errors without mutating the curated library.
- [x] 3.8 Add unit and integration tests for candidate exclusion, all-candidate accounting, portfolio response validation, provider/parsing failure, persistence, and staleness after edits, deletion, addition, or removal.

## 4. Add the Studio Curation Experience

- [x] 4.1 Show current-set unique, cumulative allowed unique, and out-of-vocabulary evidence on generated, library, and recommendation conversation cards with inspectable word details.
- [x] 4.2 Replace final deterministic ordering on the Recommendations board with an explicit AI curation action that uses the selected text model while retaining deterministic gap summaries as evidence.
- [x] 4.3 Render the recommended portfolio order, collection summary, per-candidate rationale, strengths, concerns, and vocabulary contribution without automatically changing the library.
- [x] 4.4 Add loading, empty, failed, retry, saved-review, provenance-inspection, and stale-review states; require refresh after relevant candidate or library changes.
- [x] 4.5 Preserve the existing explicit per-conversation audio generation and Add to Library controls so recommendations still pass through audio-readiness, duplicate, and source-traceability validation.

## 5. Verify Compatibility and Behavior

- [x] 5.1 Run focused automated tests for evidence, prompt construction, curation snapshots, response validation, storage, freshness, and Studio result rendering.
- [x] 5.2 Run `npm test` and `npm run build`, resolving TypeScript, unit, and primary Studio build failures.
- [x] 5.3 Run `npm run build:practice` and `npm run library:check-published` to confirm learner behavior and the curated/published library schema remain compatible.
- [x] 5.4 Smoke-test standard and complementary generation prompt previews, AI curation with each configured provider available in the environment, malformed/provider failure recovery, stale-result detection, audio generation, and explicit library addition.

## 6. Revise Curation Flow

- [x] 6.1 Remove audio readiness and audio status from AI curation snapshots, prompts, candidate facts, fingerprinting, and model-facing tests.
- [x] 6.2 Calculate authoritative projected least-covered vocabulary for the complete recommended portfolio and test conversation-level exposure projection.
- [x] 6.3 Restore deterministic recommendations as the default Queue content and add a dedicated set-scoped AI curation route that loads saved reviews only after navigation.
- [x] 6.4 Add an explicit Add All workflow that generates all missing audio before adding the complete portfolio and presents per-conversation modal progress and retryable failure state.
- [x] 6.5 Render projected post-portfolio least-covered vocabulary on the AI curation page and update Studio rendering tests.
- [x] 6.6 Run focused tests, both production builds, publication checks, strict OpenSpec validation, and live route/workflow smoke tests.

## 7. Add Exact-Size Curation Preflight

- [x] 7.1 Add the requested exact portfolio size to curation requests, persisted reviews, prompts, and provenance, and reject requests outside the current candidate range.
- [x] 7.2 Enforce exactly N unique recommendations in both single-pass and batched final response validation with focused tests.
- [x] 7.3 Stop automatically starting a first review after Queue navigation and add model plus exact-size form controls constrained to the eligible candidate count.
- [x] 7.4 Verify request validation, saved-review defaults, production builds, strict OpenSpec validation, and the preflight flow in Studio.

## 8. Add Curation Review History

- [x] 8.1 Add newest-first curation history summary types and a set-scoped API while preserving full review-by-ID retrieval and legacy review compatibility.
- [x] 8.2 Add focused storage and history tests for ordering, metadata, freshness, and retained review files.
- [x] 8.3 Add Studio history selection, historical stale-result rendering, read-only action guards, and Use Settings behavior.
- [x] 8.4 Run focused tests, both production builds, publication checks, strict OpenSpec validation, and live history smoke tests.
