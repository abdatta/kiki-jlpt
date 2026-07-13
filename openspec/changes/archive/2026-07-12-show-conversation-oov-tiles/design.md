## Context

The deterministic server audit currently writes `vocabularyUsed` and `outOfVocabularyAudit` string arrays onto generated and curated conversations. The static publisher carries only `vocabularyUsed`, and the learner resolves those strings against cards through the conversation's level. Consequently later-set and external words cannot be explained in the conversation vocabulary modal even though the server has already detected them.

This change crosses audit, persistence, migration, publication, and learner UI boundaries. It must preserve the distinction between curriculum vocabulary and informational conversation references: OOV material must not enter flashcards or browser-local mastery state.

## Goals / Non-Goals

**Goals:**

- Produce stable, reviewable metadata for every learner-visible true OOV term.
- Distinguish future-set vocabulary from words outside the course.
- Keep proper nouns and cultural-reference exemptions out of the learner-facing OOV collection.
- Give historical and future conversations the same data shape.
- Reuse the existing conversation word-tile/detail interaction without changing curriculum progress.
- Make missing metadata visible and prevent incomplete curated content from being published.

**Non-Goals:**

- Adding OOV words to vocabulary flashcards, review scheduling, statistics, mastery, or level progression.
- Letting OOV words affect vocabulary-aware conversation ordering.
- Displaying proper nouns or cultural terms in the initial release.
- Automatically expanding the official vocabulary CSV.
- Trusting generation-model self-reported OOV metadata as authoritative.

## Decisions

### Persist authoritative enriched references on conversations

Add a versioned `vocabularyReferences` collection whose entries contain the audited surface, canonical form, reading, meaning, optional part of speech/category, classification (`future_set` or `external`), optional set number, and metadata source. `vocabularyUsed` and deterministic evidence remain authoritative for coverage and quality behavior.

Persisting resolved entries makes runs and curated content inspectable and keeps the static learner application independent of server or network lookups. A central resolver and catalog avoid inconsistent generation even though resolved values are materialized per conversation.

Alternative considered: publish OOV strings and resolve them in the browser. This was rejected because external words would require a browser dictionary, resolution would differ between Studio and Practice, and historical validation would be weaker.

### Resolve after the final deterministic audit

The server enriches the final audited OOV list after generation quality control, repairs, edits, and reanalysis. Resolution first searches the complete master vocabulary, including sets later than the conversation level. Remaining terms are resolved from a checked-in, reviewed supplemental catalog. Audit exemptions, including proper nouns and cultural references, are not candidates.

This sequencing avoids stale metadata when repair changes a transcript. The generation model does not become the source of truth. Model assistance may be used offline to draft catalog entries, but reviewed repository data is the runtime authority.

### Canonicalize without losing the encountered surface

Each reference retains the encountered surface for traceability while using canonical form for deduplication and lookup. Exact master-vocabulary matches take priority, followed by deterministic reading/canonical aliases and then supplemental catalog aliases. Duplicate occurrences collapse to one displayed reference per canonical word.

Canonicalization gives exact Japanese and tokenizer basic forms precedence over kana-reading aliases so homophones cannot be merged (for example, `思う` must not become `重い`). Kana forms such as `わかる` may resolve to the course spelling `分かる` when the reading alias is unambiguous.

Master-vocabulary entries containing a `～` marker are productive patterns rather than literal spellings. The audit matches their fixed prefix or suffix both when Kuromoji splits the expression into multiple tokens and when it returns one compound token, so forms such as `三月` and `五冊` receive coverage from `～月` and `～冊`. Approved names are likewise matched over complete surface spans before individual tokens are audited, preventing tokenizer fragments from becoming false OOV words.

### Publish a self-contained learner manifest

The static manifest includes the resolved reference objects needed by each conversation. Publication validates that every learner-visible OOV term has complete canonical, reading, and meaning fields. Curated conversations with unresolved learner-visible terms block publication with actionable word and conversation identifiers rather than producing incomplete tiles.

### Keep learner behavior informational

The conversation vocabulary control becomes a words-to-review control. Its count is the sum of non-strong in-course terms, future-set references, and external references. Future-set entries are grouped beneath their actual set number and external entries beneath `Outside Course Vocabulary`. Proper/cultural exemptions are absent and uncounted.

Only in-course terms expose mastery labels. Future-set and external tiles open the shared word-detail presentation but do not read or write review state. Ordering continues to calculate familiarity solely from in-course `vocabularyUsed` terms eligible through the conversation level.

### Provide an idempotent historical backfill

An operator-invoked batch path re-audits every saved run and curated set using current rules, resolves references, records before/after audit totals and resolution outcomes, and can safely be rerun. Publishing remains a separate explicit action. The batch report identifies changed counts, discarded invalid tokens, supplemental-catalog misses, and affected conversations.

### Reuse one metadata card for Studio vocabulary chips

Every Studio chip that represents a Japanese vocabulary word from conversation analytics, evidence, workflow balancing, recommendations, or projected coverage uses one shared hover/focus presentation. Course metadata comes from the complete master vocabulary and external metadata comes from enriched conversation references. Count/status chips that are not vocabulary words remain plain. The card contains lexical metadata only and never exposes learner-specific mastery or review state.

## Risks / Trade-offs

- [Tokenizer surfaces differ from dictionary canonical forms] -> Preserve surfaces, support reviewed aliases, and test inflected/compound examples before accepting catalog entries.
- [Supplemental meanings become inconsistent or incorrect] -> Keep the catalog reviewed, source-tagged, deterministic, and covered by validation tests.
- [Historical data contains malformed punctuation or encoding artifacts] -> Re-audit from transcript text and reject non-lexical candidates rather than converting old arrays directly into tiles.
- [A new unresolved term blocks publication] -> Return an actionable validation report while leaving the existing published manifest untouched.
- [Duplicated resolved metadata becomes stale] -> Version the resolver/catalog and refresh materialized references during reanalysis and curation publication checks.
- [Badge meaning changes] -> Rename its accessible/user-facing language to words to review and test counts across mastered, future-set, external, and exempt terms.

## Migration Plan

1. Add the reference types, catalog, resolver, validation, and tests while accepting legacy records without the new field.
2. Populate references automatically on every future audit-producing path.
3. Run the idempotent batch backfill across saved runs, inspect unresolved/invalid terms, and extend the reviewed catalog as needed.
4. Backfill curated sets and require zero unresolved learner-visible terms.
5. Update the static manifest format and learner compatibility normalization, then republish the library.
6. Deploy the modal and badge changes after the published manifest contains reference data.

Rollback consists of reverting the learner and publisher to ignore the additive field. Existing `vocabularyUsed` and OOV audit arrays remain intact, so curriculum and audit behavior continue to work.

## Open Questions

- Whether future-set headings should say only `Set N` or explicitly append `Future Vocabulary`; implementation can choose the clearest compact label without changing grouping behavior.
- Whether Studio should offer a dedicated supplemental-catalog review screen later; the initial release can use repository review and batch validation output.
