## Context

The studio already has most of the raw machinery needed for assisted curation. Generated and edited conversations are tokenized with Kuromoji; each run stores allowed vocabulary matches and an out-of-vocabulary audit; the curated library calculates current-set coverage; and the recommendation service searches same-set runs while excluding sources already in the library. The current recommender then applies a fixed coverage weight and orders candidates independently.

That fixed ordering cannot judge whether target words are central to a coherent scene, whether phrasing is forced, whether questions and translations support learning, or whether a group of conversations works well as a collection. Conversely, a language model should not be trusted to count vocabulary or determine library membership. The design therefore separates deterministic evidence from model judgment.

The change is confined to the Studio and server. Existing Gemini and Codex provider selection is reused. Curated conversation JSON and the published learner manifest remain compatible.

## Goals / Non-Goals

**Goals:**

- Make generated conversations favor meaningful current-set vocabulary without incentivizing unnatural word stuffing.
- Calculate consistent, inspectable evidence for each conversation and provide that evidence as authoritative input to AI curation.
- Let a selected text model consider all eligible saved conversations, their complete learning content, and the current library before proposing an ordered portfolio.
- Preserve enough input and model provenance to explain, refresh, and troubleshoot a curation result.
- Keep all library changes under explicit operator control.

**Non-Goals:**

- Add recommendations to the curated library without an explicit operator action, or publish them automatically.
- Replace deterministic vocabulary auditing with model-generated counts.
- Evaluate speech quality from audio; this curator evaluates textual and pedagogical quality only, while missing audio is generated after selection.
- Personalize the curated library to an individual learner.
- Change learner application behavior or published library schemas.

## Decisions

### Build one authoritative curation-evidence layer

The server will derive a `ConversationCurationEvidence` record from the selected set, canonical vocabulary, tokenizer output, and shared language-policy exemptions. It will include at least:

- unique current-set words and their unique count;
- unique vocabulary from all allowed sets and its unique count;
- unique out-of-vocabulary words and occurrence count;
- current-library exposure counts and marginal zero/low-coverage contributions when evaluated as a candidate.

Vocabulary uniqueness will be keyed by canonical Japanese spelling, not CSV row count, because the vocabulary source contains duplicate spellings. The existing audit will expose the occurrence information needed by the evidence layer while preserving the current `vocabularyUsed` compatibility field. Evidence will be returned to Studio clients as a sidecar keyed by conversation identity and captured in curation reviews; it will not add fields to curated conversation records or the published manifest.

Allowed grammar/function expressions, conjugation handling, tokenizer-recognized proper nouns, and an approved common-name list will be defined as shared language policy used by both prompt builders and the audit. Restricting generated names to that approved list makes ambiguous names deterministic; relying only on tokenizer part-of-speech labels was rejected because valid names such as `さくら` may otherwise be reported as unknown vocabulary.

The model may quote or discuss these facts, but returned counts will never overwrite server-calculated evidence.

### Refine generation guidance without adding a second generation-stage model call

The standard and complementary prompts will explicitly tell the existing generation model to make current-set words meaningful anchors, repeat focal words only where natural, diversify scenes and combinations, and prefer an omitted priority word over an obviously forced line. Aggregate coverage remains a batch objective, but natural beginner listening material is the quality constraint.

A separate generate-extra-then-select model stage was considered. It would offer more choice before audio generation, but it adds cost, latency, workflow states, and selection semantics beyond the requested prompt refinement. The first implementation will improve the existing generation calls and use the reusable post-generation curator; a pre-audio selection stage can be proposed later if operating experience justifies it.

### Treat AI curation as portfolio selection, not independent scoring

The curation service will assemble a set-scoped snapshot containing:

- every saved same-set conversation not already represented in the curated library, including its source identity but no audio-readiness metadata;
- complete Japanese dialogue, translation, scene/context, questions, and answers;
- deterministic per-conversation evidence;
- current curated conversations and per-word conversation exposure counts.

The prompt will ask the model to choose a complementary collection of exactly the operator-selected size, with current-set vocabulary as the primary learning objective but naturalness, salience, repetition, scene variety, question quality, and redundancy as explicit considerations. The structured response will reference source IDs and provide an ordered recommendation, rationale, strengths, concerns, and a collection-level summary. The server will reject responses whose recommendation count differs from the requested size.

Using a model-authored numeric score as the primary contract was rejected because scores are difficult to calibrate across model versions and encourage false precision. The order, evidence, and explanation are the useful outputs.

### Reuse configured providers through a generic structured-JSON adapter

The existing provider paths already return parsed JSON for conversation generation. Their common behavior will be extracted or wrapped so the curator can request a different validated JSON schema while retaining provider/model selection, Codex instructions, Gemini JSON mode, timing, raw output, and usage statistics.

The curation output validator will reject malformed JSON, duplicate or unknown candidate identities, curated candidates, and structurally incomplete recommendations. Server evidence will be reattached by identity after validation rather than accepted from model output. A failed call or invalid response will create no library mutation and remain retryable.

### Consider all candidates with bounded-context staged evaluation

For a pool that fits the selected model's configured input budget, the service can perform one portfolio call. When it does not fit, the service will evaluate deterministic batches containing full candidate content, then perform a final portfolio pass over those grounded evaluations and the library context. Candidate accounting in the persisted snapshot will verify that every eligible candidate was included in exactly one evaluation batch.

Silently truncating to the current deterministic top 30 was rejected because it would violate the requirement to consider all existing generated conversations and could hide the nuanced candidates this change is intended to recover.

### Persist curation reviews independently from runs and detect staleness

An AI curation review spans multiple runs and a mutable curated set, so it will be stored as a set-scoped studio artifact rather than attached to one `PracticeRun`. A review will retain its ID, set number, status, selected model, LLM exchange(s), candidate source identities and update markers, library identities and update marker, deterministic evidence version, recommendations, and timestamps.

A reproducible fingerprint of the candidate and library snapshot will be compared with current state when a review is loaded or an operator acts from it. A mismatch marks the review stale and prompts regeneration. Staleness does not mutate or delete the historical review, and existing curation validation remains the final guard against duplicates or missing audio.

Keeping results only in React state was rejected because reloads would discard expensive model output and its audit trail.

Every saved review remains an immutable history entry. A lightweight set-scoped history endpoint returns newest-first summaries rather than every full prompt and snapshot; the existing review-by-ID endpoint supplies full details only for the selected entry. Historical results are rendered read-only even when stale, while a Use Settings action copies their model and exact requested size into the new-review preflight without mutating history or starting a request.

### Extend the existing Recommendations board

The Queue board will retain the existing deterministic recommendation ordering and gap summary as its default content. Its AI Curate action will navigate to a dedicated set-scoped AI curation route without starting a request. That route will load the latest saved review and expose preflight controls for model and exact portfolio size before a new, retry, or replacement review begins. It will present the recommended portfolio in order, collection summary, per-candidate reasoning and concerns, trusted evidence, projected post-portfolio least-covered words, freshness, and retry/refresh controls.

Audio readiness is deliberately omitted from curator snapshots, prompts, and model-facing candidate facts. It remains only an execution concern after selection. Recommendations are a draft decision aid: individual additions continue to use the existing library action, while an explicit Add All action first generates missing audio for the selected portfolio and then adds every recommendation. A modal reports per-conversation audio and curation progress and retains failures for retry.

Projected least-covered vocabulary is calculated deterministically from the current library exposure counts plus one conversation-level exposure for each recommended candidate. The model does not calculate or return this projection.

## Risks / Trade-offs

- **Model recommendations vary across providers or repeated calls** → Store full provenance and evidence snapshots, use a tightly structured rubric, and avoid presenting model scores as objective measurements.
- **Large candidate libraries exceed context limits** → Use complete-content evaluation batches followed by a grounded portfolio synthesis, with candidate accounting that prevents silent omission.
- **The model fabricates vocabulary facts or identifiers** → Treat server evidence as authoritative and reject any output that does not reference the supplied candidate identities exactly.
- **Prompt and audit exemptions drift again** → Generate both prompt whitelist text and audit exemptions from one shared language policy and version the evidence calculation.
- **Softer coverage language reduces raw batch coverage** → Retain deterministic coverage analytics and complement workflows, while making naturalness an explicit constraint rather than abandoning coverage goals.
- **A text-only curator approves content whose later synthesis is poor** → Keep audio QA as a separate post-selection operator step and let Add All stop visibly when synthesis fails.
- **Persisted recommendations become misleading after edits or curation** → Fingerprint both candidate and library snapshots and display stale state prominently.
- **Multiple model calls increase cost and latency** → Use a single call when the complete pool fits, batch only when necessary, and require an explicit operator action.

## Migration Plan

1. Add shared language-policy rules and deterministic evidence types/calculation while keeping existing conversation fields and curated content readable.
2. Calculate evidence on demand for saved runs and curated sets, and use the existing reanalysis actions to refresh persisted compatibility audit fields under the shared policy.
3. Refine the standard and complementary prompts from the shared policy.
4. Add generic structured model invocation, curation snapshot assembly, response validation, and review storage.
5. Add the AI curation API and update the Recommendations board with review, stale, error, and retry states.
6. Verify that adding/removing library items and publication remain backward compatible.

Rollback consists of removing the AI action and prompt refinements while leaving existing run, curated, and published formats readable. Set-scoped curation-review artifacts can be ignored without affecting library contents.

## Open Questions

None are blocking. Operational use can determine whether a later change should add pre-audio candidate generation/selection or multimodal audio-quality review.
