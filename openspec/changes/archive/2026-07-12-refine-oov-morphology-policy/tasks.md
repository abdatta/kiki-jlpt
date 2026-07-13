## 1. Reviewed Audit Morphology

- [x] 1.1 Add explicit allowed equivalence for `いい`/`よい` across tokenizer basic and inflected forms.
- [x] 1.2 Match complete polite kinship spans and credit allowed `兄` or `姉` without emitting fragments.
- [x] 1.3 Accept reviewed adverbial `本当に` only when `本当` is allowed.
- [x] 1.4 Reject standalone prolonged-sound and other non-lexical debris before OOV counting.
- [x] 1.5 Add regression tests for accepted forms and for distinct `話`, `遊び`, counters, and compounds that must remain OOV.

## 2. Future Reference Resolution

- [x] 2.1 Add reviewed future-entry aliases for `すぐ`/`すぐに` and `ゆっくり`/`ゆっくりと`.
- [x] 2.2 Ensure aliases remain OOV below their assigned sets and resolve as future-set rather than external references.
- [x] 2.3 Version audit and resolver caches so policy changes refresh persisted evidence.

## 3. Historical Migration and Verification

- [x] 3.1 Run focused audit and resolver tests plus the complete unit and TypeScript/Vite build suite.
- [x] 3.2 Backfill every saved run and curated set and report all before/after OOV changes, unresolved terms, and discarded debris.
- [x] 3.3 Repeat the backfill to verify idempotence.
- [x] 3.4 Rebuild the static learner library and pass published-library consistency validation.
