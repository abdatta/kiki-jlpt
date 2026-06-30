## Context

The studio's library balancing today flows through one path:

- `buildLibraryBalancePlan(setNumber)` (`server/libraryBalance.ts`) computes an authoritative deterministic plan: zero-coverage words, low-coverage/priority words, overrepresented words, mean/stddev, and a suggested conversation count.
- `buildLibraryComplementPrompt(...)` (`server/prompt.ts`) turns that plan into a prompt that supplies only word-count statistics — it deliberately omits the actual library conversation text.
- `/api/library/sets/:setNumber/complement/preview` and `/complement` (`server/index.ts`, via `getLibraryComplementContext`) build the prompt, call `generateTextBatch`, and persist a standalone audited run.
- `generateLibraryComplement` in `src/App.tsx` previews then generates and navigates to the new run for review.

Separately, AI curation already builds a richer, cached, prefetched view of a set in `buildAiCurationSnapshot(setNumber)` (`server/aiCuration.ts`). Its `snapshot.library` contains the curated conversations' learning content (id/title/scene/text/listeningQuestions) and a per-word `wordExposure` map, and `libraryContext()` is the trimmed shape already sent to a model. That snapshot is content-keyed and self-validating, so reusing it costs nothing when inputs are unchanged.

This change adds an AI-enabled balance mode that layers the snapshot's library content + exposure onto the authoritative deterministic plan, while keeping the existing stats-only mode intact.

## Goals / Non-Goals

**Goals:**
- Add an AI-enabled balance mode to the existing complement flow that grounds generation in real library content + exposure, not just counts.
- Keep the deterministic plan authoritative in both modes (model never recomputes counts).
- Keep the stats-only mode available and unchanged in behavior; default behavior for existing callers is unchanged.
- Let the operator override the suggested conversation count before generating, in both modes.
- Produce a normal reviewable run; never auto-add to the curated library.

**Non-Goals:**
- No change to the generator modal or the workflow "balancer" node (which self-balances a fresh run, a different target).
- No automatic curation, no Add-All integration, no learner-application or content-format changes.
- No change to how AI curation itself selects candidates.

## Decisions

**Extend the complement flow rather than add a generator-modal mode.** The complement flow is the only surface that already balances against the *curated library*, already suggests a count, and already lands as a reviewable run. Adding a fifth run-type to the generator modal would split the balancing concept across two surfaces. Alternative (new modal flow) rejected for UI and codebase simplicity.

**Two flows via a request mode, not separate endpoints.** Add `balanceMode: 'stats' | 'ai'` (default `'stats'`) and optional `conversationCount` to the complement request type in `shared/types.ts`. `/complement/preview` and `/complement` branch on the mode inside `getLibraryComplementContext`. This keeps the route surface, run shape, error handling, and provenance identical across modes. Alternative (separate `/complement/ai` endpoints) rejected as duplicative.

**Reuse `buildAiCurationSnapshot` for AI-mode context; reuse `libraryContext`'s trimmed shape.** The AI-balance prompt is built from two inputs: the authoritative `LibraryBalancePlan` (gap lists, overrepresented words) and the snapshot's library content + `wordExposure`. Reusing the cached snapshot keeps a single source of truth for exposure and avoids re-tokenizing. A new `buildAiLibraryBalancePrompt(setNumber, allowedVocabulary, balance, libraryContext)` lives in `server/prompt.ts` next to the existing builder. Alternative (compute a fresh library-content view) rejected — it would duplicate snapshot logic and exposure accounting.

**Authority and prompt shape.** The AI prompt states that deterministic counts/gap lists and exposure are authoritative and must not be recalculated, supplies the same zero/priority/overrepresented sections as the stats prompt, then adds the library conversation content with an explicit instruction to diversify scenes away from existing ones and repeat focal words only where natural. This mirrors the AI-curation pattern (deterministic evidence authoritative, model judgement layered on top).

**Count override.** The operator-supplied `conversationCount`, when present and in range, replaces `balance.suggestedConversationCount` before prompt construction and is used as the `generateTextBatch` target. When absent, the plan's suggestion is used (current behavior). Validation reuses the conversation-count bounds already enforced for generation.

## Risks / Trade-offs

- **Larger AI-mode prompt from including library content** → Bounded: only the curated set's conversations are included (no candidate pool, unlike full AI curation), reusing the already-trimmed `libraryContext` shape. Curated sets are small enough that a single prompt suffices; no batching is introduced.
- **Mode default could change existing behavior** → Default `balanceMode` to `'stats'` so existing requests and the stats-only button behave exactly as today.
- **AI mode returns too few usable conversations** → Reuse the existing complement failure path: report a retryable generation failure and leave the library unchanged (covered by the spec's failure scenario).
- **Invalid count override** → Validate against the supported range and reject with a descriptive error before any model call, consistent with existing generation validation.
- **Snapshot staleness vs. live plan** → The plan is rebuilt per request from current data; the snapshot is content-keyed and rebuilds when inputs change, so both reflect current library state at generation time.

## Migration Plan

Additive and backward-compatible. The request field defaults to stats-only, so no data migration or coordinated rollout is needed. Rollback is removing the AI branch and the request fields; persisted runs are ordinary runs regardless of mode.

## Resolved Decisions (UI)

- **Mode control: a toggle.** Use a two-option toggle (stats-only vs AI-enabled) on the existing complement control rather than two separate buttons, keeping the single balancing concept with one action. If a toggle proves more awkward than two adjacent buttons during implementation (state plumbing, layout), fall back to two buttons — code/UI simplicity wins the tie.
- **Audit exposure context: hidden by default, revealable.** AI-mode runs store the snapshot/exposure context in exchange stats. The run audit panel SHALL hide that exposure context by default and provide a button/disclosure to reveal it, so the audit stays uncluttered but the full grounding is inspectable on demand.
