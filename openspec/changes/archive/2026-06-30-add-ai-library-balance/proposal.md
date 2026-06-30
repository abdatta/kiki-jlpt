## Why

The studio can already balance the curated library by generating a complementary batch, but that flow is driven only by deterministic word-count statistics: it knows which current-set words are absent, underexposed, or overrepresented, yet it never sees the actual conversations already in the library. As a result it can chase coverage numbers but cannot reason about scene/theme redundancy or natural repetition against what learners will really hear. AI curation already assembles a far richer, cached view of the library (full conversation content plus per-word exposure plus gap lists) to *select* among pre-generated candidates. We want that same depth of judgement applied to *generating* new, optimally balanced content.

## What Changes

- Add an **AI-enabled library balance** generation option alongside the existing **stats-only** complement flow. Both remain available; the operator chooses which to run.
- The AI-enabled flow reuses the cached AI-curation snapshot (actual library conversation content, per-word exposure, and uncovered/underexposed gap lists) so the model generates new conversations that fill coverage gaps, avoid duplicating existing scenes and themes, and repeat focal words only where natural.
- Deterministic balance facts stay authoritative: the model is supplied zero-coverage, low-coverage, and overrepresented vocabulary as fixed inputs and never recalculates counts.
- The conversation count is suggested from the balance plan but the operator MAY override it before generating (both flows).
- Output is unchanged: the AI-enabled flow produces a normal, audited, reviewable run that is not auto-added to the curated library.
- The flow is surfaced from the existing library "Generate complement" area, not the generator modal, keeping one balancing concept that the operator can run in a stats-only or AI-enabled mode.

## Capabilities

### New Capabilities
<!-- None: this extends existing balancing and generation-guidance behavior. -->

### Modified Capabilities
- `curated-library`: The library balancing requirement gains an AI-enabled balance mode that grounds complement generation in the curated snapshot's conversation content and exposure, retains the deterministic plan as authoritative, keeps the stats-only mode available, and supports an operator-overridable conversation count.
- `content-generation`: The current-set generation guidance requirement gains a scenario for an AI-balanced complementary prompt that additionally supplies existing library conversation content and per-word exposure so the model can author for coverage while avoiding redundancy and over-repetition.

## Impact

- **Surface**: Studio only (no learner-application changes). Curated and published content formats are unchanged; this only adds another way to produce a run.
- **Server**: `server/prompt.ts` (new AI-balance prompt builder), `server/index.ts` (`/api/library/sets/:setNumber/complement` and `/complement/preview` accept a mode/flag and use the AI-balance prompt + snapshot when requested), reuse of `server/aiCuration.ts` `buildAiCurationSnapshot`, and `server/libraryBalance.ts` for the authoritative plan.
- **Client**: `src/App.tsx` `generateLibraryComplement` and the complement controls gain a mode selector and a count override.
- **Shared**: `shared/types.ts` request type for the complement endpoints gains a balance-mode and optional count field.
- **No new dependencies.**
