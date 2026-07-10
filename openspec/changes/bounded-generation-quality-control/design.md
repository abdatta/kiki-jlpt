# Design: Bounded Quality Control for Conversation Generation

## Context

Every text-generation path (standard run generation, workflow generation, library-complement generation) flows through `generateTextBatch` in `server/index.ts`: provider call → `normalizeGeneratedConversations` → `evaluateVocabularyQuality` (deterministic kuromoji audit from `server/vocabAudit.ts`) → at most one repair attempt → accept-if-improved.

Three properties of the current system shape this design:

1. **OOV is deterministic ground truth.** `analyzeConversationsWithVocabulary` produces authoritative per-conversation evidence, including validated proper-noun/cultural-reference exemptions with POS guardrails. No model call needs to (or should) re-judge vocabulary facts. The AI curation prompt already establishes the pattern: deterministic evidence is supplied as authoritative and models are told not to recalculate it.
2. **The run is a candidate pool, not the product.** Conversations reach learners only through curation into the curated library. Coverage debt left by a shortfall reappears automatically in the next `buildLibraryBalancePlan`, so a single run does not need to resolve all quota/coverage/naturalness tension internally. Quota is already soft: `normalizeGeneratedConversations` slices to the expected count but never backfills a short response.
3. **The current repair has a regression vector.** `buildRepairPrompt` resubmits the entire batch and the accept decision compares batch-level `qualityIssueScore`, so a repair that fixes one conversation while degrading a previously clean one still nets "improved" and replaces everything.

4. **Audit presentation hides the call topology.** The workflow audit node model has exactly three kinds (`generator | balancer | audio` in `shared/types.ts`); repair exchanges are buried inside the generator/balancer node's `output.exchanges` array and surfaced only through a nested "Attempts" tab four clicks deep with no addressable route. Call roles are inferred from fragile stats heuristics (`repairAttempt` present ⇒ repair). With the QC layer multiplying calls per stage (~2 → up to ~10 including a full re-roll pass), the bundled model becomes unreadable — and `generateTextBatch` runs opaquely between the stage's `processing` → `done` writes, so intermediate calls are invisible until the stage finishes. The SSE transport itself already supports per-node live updates (`updateWorkflowNode` → `StudioJob.workflow` → job events).

## Goals / Non-Goals

**Goals:**

- Catch and remove structurally bad conversations before they consume audio budget and curation attention.
- Broaden repair beyond OOV to naturalness/realism/level fit without introducing repair or regeneration loops.
- Make quality tradeoffs visible (labels, flags, final audit) instead of hidden behind averages.
- Repair only what the audit and triage flag; never let repair touch a passing conversation.
- Keep the LLM call budget flat per stage regardless of batch size (+4 calls in the common case; a single bounded re-roll pass adds at most 5 more).
- Instrument the pick step so the value of the second repair candidate is measurable.
- Make the whole pipeline elegantly auditable from the UI: every model call is its own graph node (never bundled under a stage node), every node shows a one-line output stat, every node deep-dives to its full evidence, and one conversation's journey can be traced end to end.
- Stream per-call progress live so a running workflow reads as nodes lighting up, not an opaque stage.

**Non-Goals:**

- No forced acceptance of known-bad conversations to hit the requested count (shortfall is reported instead).
- No slot transfer from the initial stage to the balance stage.
- No pre-generation vocabulary/scenario planning and no word-grouping planner for the balancer (explicitly deferred; see Risks).
- No changes to AI curation, the curated library format, the published manifest, or the learner app.
- No changes to audio scheduling internals — only *when* the audio stage is allowed to start.

## Decisions

### D1. Deterministic-first evidence flow

All lexical facts (true OOV words, exemptions, coverage, `vocabularyUsed`) come from the deterministic audit and are supplied to every model call as authoritative context. The quality triage and picker judge only the subjective residue: naturalness, scenario coherence, realism, JLPT level fit, listening-question quality.

*Why:* the audit is ground truth and already exists; asking a model to re-derive it invites contradiction. This also collapses the "picker over/under-weights OOV" risk — the picker cannot misjudge what it is not asked to judge.

*Alternative considered:* a single omniscient quality agent judging everything, as in the original draft proposal. Rejected: it duplicates deterministic work, is less reliable, and its rubric becomes a tuning burden.

### D2. One batched triage call per stage batch

After audit, one structured-JSON model call (via `invokeStructuredJson` in `server/structuredText.ts`, same infrastructure as AI curation) receives the full batch with per-conversation deterministic evidence attached and returns a per-conversation verdict: `pass`, `repair`, or `regenerate`, each with rationale and flags.

- OOV-driven repair eligibility is decided deterministically (existing `vocabularyQualityThreshold` semantics: true-OOV findings gate for Set ≥ 2). A conversation can be `repair` because the audit found OOVs, because triage found fixable naturalness issues, or both. The repair-need union is computed in code, not left to the model.
- `regenerate` is reserved for structural verdicts (unrealistic scenario, vocabulary-list feel, severe topic jumps, clearly above-level grammar). The model cannot mark a conversation `regenerate` for OOV reasons alone; excessive-OOV regeneration thresholds, if ever needed, are deterministic.
- When the curated library for the set is non-empty, the prompt includes 2–3 curated conversations via the existing `libraryContext` shape as calibration exemplars ("this is the quality bar").

If the triage call fails or returns an unusable response, the stage falls back to deterministic-only behavior — conversations with audit findings are treated as `repair`, all others as `pass` — and the failure is recorded in provenance and surfaced in the final audit. Generation never fails because the judge call failed.

*Why one call:* AI curation already demonstrates that one call can reliably judge dozens of candidates with per-item structured output. Per-conversation calls would scale cost linearly for no accuracy evidence.

### D3. Repair only flagged conversations, two independent candidates, balanced objective

The repair prompt contains only the flagged conversations (with their per-conversation audit findings and triage rationales), the allowed vocabulary table, and a balanced objective: improve naturalness and realism, keep JLPT level, remove true OOV words, preserve assigned/current-set vocabulary where it fits naturally, stay suitable for listening audio. The same prompt is invoked twice as independent provider calls (not two labeled variants in one response), producing candidate sets 1 and 2.

*Why two identical-objective candidates rather than specialized ones:* specialized candidates (OOV-focused vs naturalness-focused) are lopsided by construction, forcing the picker to choose which problem to tolerate. Independent balanced attempts give genuinely comparable alternatives. Whether the second candidate earns its cost is an open empirical question — see D7 (instrumentation) and the Risks section.

*Why this fixes the regression vector:* passing conversations are never resubmitted, so they can no longer be degraded by a batch-level accept.

### D4. Dominance-gated per-conversation pick

For each flagged conversation, the candidate pool is {original, candidate 1, candidate 2}. Selection is two-phase:

1. **Deterministic gates (code, free):** re-audit both candidates. A candidate with more true-OOV findings than the best available candidate is eliminated. A candidate that loses previously present current-set vocabulary is retained but flagged `coverage_loss`. If exactly one candidate survives with a strictly better audit than the rest, it wins without a model call for that conversation.
2. **Model tie-break (one batched call):** all conversations whose pick is not deterministically decided are judged in a single structured-JSON call — pick the most natural, level-appropriate version; attach `selectedQuality: good | okay`, `confidence: high | medium | low`, and flags. The pick is forced: the model must choose one of the supplied versions and cannot request regeneration or another repair round.

When the gate decides alone (no tie-break call), the quality label is derived deterministically: `good` when the selected version resolves all audit findings and triage raised no naturalness concerns, otherwise `okay`; picker confidence is recorded only when a tie-break actually ran, and the decision is marked gate-decided in provenance.

*Why forced pick is safe:* the original is always in the pool, so the floor is "no worse than before repair." The Quality triage (D2) is the only authority that can remove a conversation from the run.

*Why the picker is load-bearing, not optional:* once the repair objective includes naturalness, the existing deterministic accept gate (`qualityIssueScore` strictly improved) would reject naturalness-only repairs. The deterministic score remains a *constraint* (phase 1) but can no longer totally order candidates; the model tie-break replaces the old batch-level accept.

### D5. Bounded regeneration with shortfall — no slot transfer, no forced accepts

- Initial stage: `regenerate` conversations are dropped from the batch. If any were dropped, at most **one** re-roll generation call requests replacements (fresh scenarios, normal initial-stage objective, count = dropped count). Re-rolled conversations flow through the same audit → triage → repair → pick sequence, except a re-rolled conversation that triages `regenerate` is dropped for good.
- Balance stage: same triage flow; `regenerate` conversations are dropped (one re-roll permitted, same rule). No conversation is ever accepted with a known structural verdict to satisfy the count.
- The run persists with whatever accepted conversations remain; the final audit reports `acceptedCount` vs `requestedCount` explicitly.

*Why shortfall over forced accept:* the requested count is already soft in the current system (short provider responses are not backfilled), the curated library is the real product, and coverage gaps recur automatically in the next balance plan. A force-accepted bad conversation pollutes the candidate pool, wastes audio, and is rejected by curation anyway — paying for an outcome shortfall gives for free.

*Why no slot transfer:* the balance stage is the most constrained, most artificiality-prone stage, and its prompt explicitly fights filler ("do not add filler conversations that do not improve useful coverage"). Dropped initial slots are count debt, not coverage debt; inflating the balancer with them works against its own instructions.

### D6. Final audit stage gating audio

A new deterministic final-audit step runs after both text stages and before any audio work, aggregating: accepted vs requested counts per stage, drop/re-roll tallies, quality-label tallies, remaining true-OOV findings, current-set coverage and distribution (reusing `calculateRunAnalytics` / `calculateWorkflowDistributionStats`), coverage-loss flags from picks, and any model-call failures with the fallbacks that recovered them.

Gate behavior in the balanced workflow:

- **Clean** (no threshold trips): proceed to audio automatically — same operator experience as today.
- **Warning thresholds trip**: the job transitions to `paused` with a stage label directing the operator to the audit report. Resume proceeds to audio; discard cancels. This reuses the existing paused/resume machinery in `server/studioJobs.ts` (legal transitions already support it) rather than inventing a new approval flow.

Initial thresholds (constants, tunable): initial-stage `regenerate` rate > 30% fails the stage with guidance; total shortfall > 20% of requested, or any post-re-roll drops in the balance stage, pause for review. Because balance batches are small (~10), thresholds are evaluated on absolute counts alongside percentages (e.g. shortfall ≥ 2 conversations).

*Why gate audio and not text:* audio is the cost that cannot be recovered by re-rolling text, and today it starts unconditionally right after the balancer. Text stages remain fully automatic.

### D7. Provenance and instrumentation via existing exchange stats

All new decisions are persisted in the shapes that already exist:

- Exchange stats gain `qualityTriage` (verdicts + rationales), `repairCandidate: 1 | 2`, and picker outcome fields, alongside the existing `repairAttempt` / `repairOutcome` / `selectedForFinal` conventions.
- Accepted conversations gain persisted quality metadata: `quality: 'good' | 'okay'`, `qualityDecision: 'pass' | 'repair'`, `pickerSelected: 'original' | 'candidate1' | 'candidate2'`, `pickerConfidence` (present when a tie-break ran), `qualityFlags[]` (additive fields in `shared/types.ts`).
- The workflow audit gains a `final-audit` node whose output is the full audit report; dropped conversations remain inspectable in the stage node outputs (they are not part of `run.conversations`).
- Pick outcomes are aggregated in the final-audit report (how often candidate 2 won, how often the deterministic gate decided alone) so the cost of the second repair candidate is reviewable per run without extra tooling.

### D8. Scope of application

The triage → repair → pick sequence lives inside `generateTextBatch`, so standard generation, workflow generation, and library-complement generation all benefit. The final-audit stage and audio gate apply to the balanced workflow (the only path that chains text to audio automatically). Standard and complement runs persist the same per-conversation quality metadata and a run-level audit summary but have no gate (they have no automatic audio).

Set 1 keeps its existing OOV leniency (`vocabularyQualityThreshold` = ∞); naturalness triage applies to all sets.

### D9. Per-call audit node data model

`WorkflowAuditNode` is generalized from three coarse kinds to **one node per model call and per deterministic step**, with additive fields:

- `callKind`: `generation | vocab-audit | triage | repair-candidate | dominance-gates | pick | reroll | final-audit | audio`
- `stage`: `initial | balance` (absent on `final-audit`/`audio`), `pass`: `1 | 2` (re-roll sub-flow is pass 2), `candidateIndex?: 1 | 2`, `sequence` for ordering
- Node IDs are **server-minted structural IDs** (`initial:triage`, `initial:repair-1`, `initial:pass2:pick`, `final-audit`, `audio-7`) — never derived from `LlmExchange.id`, whose millisecond-timestamp scheme can collide, and stable enough to serve as deep-link anchors.
- Each LLM-call node carries exactly **one** exchange; deterministic nodes carry their structured findings as `output`. Per-conversation facts inside node outputs (triage verdicts, gate eliminations, pick decisions, drop rationales) are keyed by `conversationId` — this is what powers both the per-kind inspector tables and conversation trace mode.
- Every node output includes a small **summary block** (the stat-line fields) that is always present as soon as the node completes, independent of the heavy payload.

*Why restructure rather than keep bundling exchanges:* role-by-stats-heuristic (`repairAttempt` present ⇒ repair) does not scale to six call roles; per-call nodes make the topology a data fact instead of a UI inference, and give live streaming and deep links for free. Existing consumers that branch on the closed `WorkflowNodeKind` union — `workflowJobForRun`'s status derivation (incomplete-audio and, on the legacy exchange-synthesized path, any errored node currently drive the synthesized failure status; it must classify the new kinds without misreporting), the `updateWorkflowJob` stage mapping (`generator`/`balancer`/`audio` stage IDs), `workflowLlmExchanges`' generator/balancer filter, and the repair-rerun endpoint's node-output expectations — are updated as part of this change; the legacy three-kind data remains readable through its own render path (D12).

### D10. Audit graph UX — stage lanes, two node species, per-kind inspectors

The run audit route (`#/studio/runs/:runId/audit`) renders the new graph in place of the current 5-column `.workflowGraph`, keeping the `.workflowPanel`/`.workflowHeader` shell. The route grammar extends to `#/studio/runs/:id/audit[/n/:nodeId][/c/:conversationId]` so every call and every conversation trace is addressable — fixing today's "four clicks deep, nothing linkable" problem.

**Layout — a vertical stack of horizontal stage lanes:**

```
[ header · status pill · counts ]
[ conversation rail: (All) [1 ✓good] [2 ⚒okay] [3 ↻] … ]

┌ STAGE 1 · INITIAL SET ──────────── 17 accepted · 4 repaired · 1 re-rolled ┐
│ [Generate] → ⟨Vocab audit⟩ → [Triage] → [Repair c1]  → ⟨Gates⟩ → [Pick]  │
│                                          [Repair c2]                      │
│   ↳ PASS 2 · RE-ROLL                                                      │
│   [Re-roll] → ⟨Vocab audit⟩ → [Triage] → (repairs skipped) → [Pick]       │
└────────────────────────────────────────────────────────────────────────────┘
┌ STAGE 2 · BALANCE ────────────────────────── (same lane template) ────────┐
└────────────────────────────────────────────────────────────────────────────┘
╔ FINAL AUDIT (full-width deterministic band; review gate lives here) ═══════╗
┌ AUDIO (existing grouped audio stage — each TTS call its own selectable row)┐
```

- Two identical lanes make it self-evident that the pipeline runs the same sequence twice; the final audit and audio sit below as run-level steps. Within a lane, nodes connect with the existing typographic `.workflowArrow`; the repair pair renders as a **fork column** (two stacked sibling cards, one arrow in, one arrow out) — genuinely parallel, never nested. The re-roll sub-flow is an indented second row inside the same lane with its own full node sequence.
- **Two node species.** LLM-call nodes keep the full `.workflowNode` card treatment plus a meta line (model short-name + duration) that only they get. Deterministic nodes (vocab audit, gates, final audit) are compact, code-background (`--studio-code-bg`) "machine steps" with no model chip. The at-a-glance grammar: *big warm cards = model calls (cost money, can be wrong); small code-tinted chips = deterministic ground truth (free).* All nodes keep the status-class-equals-status-string convention, so existing recipes (pending / conic-border processing / done / error / dashed skipped / amber repairWarning) apply unchanged.
- **Constant shape.** Steps that were not needed render as `skipped` (dashed) with honest stat lines ("Skipped — all passed"), never removed — a run where everything passed shows a mostly-green lane with a skipped repair fork, and the graph itself teaches the flowchart. Only unused re-roll rows collapse to a single compact skipped chip.
- **Node anatomy:** eyebrow call-kind + status icon, status-inflected title, the one-line **output stat** (the load-bearing element — e.g. generation `20 conversations · 3 with OOV`; triage `14 pass · 5 repair · 1 regen`; repair candidate `5 convos · OOV 7→2`; gates `c2 out on 2 · 1 coverage-loss`; pick `orig 1 · c1 3 · c2 1 · 4 good/1 okay`; re-roll `2 replacements · 1 dropped for good`; final audit `38/40 accepted · coverage 96% · PASS`), then the model/duration meta line on LLM nodes.
- **Interaction: master–detail, no modals.** Clicking a node selects it (existing focus-ring treatment), updates the hash, and renders the inspector below the graph. Because one node = one call, the **"Attempts" tab is retired** for new runs — each node's inspector is exactly its own call: common frame (started/finished/model/duration meta cells, Prompt|Settings input tabs, Response|Metadata output tabs) plus a per-kind body: parsed-conversation rows with OOV highlighting (generation), findings table (vocab audit), per-conversation verdict table with rationale reveals (triage), before→after OOV deltas and line-level diffs vs original (repair candidates), elimination-evidence matrix (gates), decision table with chosen-version pill, decided-by `gate`/`tie-break` chip, quality/confidence/flags and three-way comparison reveals (pick), drop rationales and replacement lineage (re-roll), the full report with threshold met/tripped rows (final audit), and the existing audio response panel (audio).
- **Default selection** (change from today's empty-until-click): live run → the processing node, auto-following; finished run → the final-audit node; failed run → the first errored node. The inspector is never empty.

### D11. Conversation trace mode

A horizontally scrollable **conversation rail** sits above the lanes: one chip per conversation (number square + short title + quality/journey badges: `good`/`okay`, `⚒ repaired`, `↻ re-rolled`, `dropped` struck through). Selecting a chip enters trace mode:

1. Nodes that never touched the conversation dim; nodes that did swap their stat line for the conversation-scoped fact (`#7: repair — "stilted register"`, `#7: OOV 3→0`, `#7 → candidate 2 · okay`).
2. The inspector becomes a **journey panel**: a vertical timeline of that conversation's touchpoints, each step expanding to its evidence — transcript at that point, verdicts, line-level diffs between consecutive versions (generated → repaired → picked), pick reasoning, drop rationale, audio player. Clicking a journey step selects and scrolls to the corresponding graph node.
3. Node inspectors opened during trace auto-filter their tables to that conversation.

Dropped conversations keep their chip (danger, struck through); their journey ends at an explicit terminal step ("Dropped after second regenerate"), with evidence still reachable — this is where "honest about quality" becomes tangible in the UI. Entry points: the rail, any `#N` chip inside inspector tables, and quality-label chips on run conversation rows deep-linking to `…/audit/c/<conversationId>`.

*Why trace mode is load-bearing:* batch-level nodes answer "what did the pipeline do"; the operator's real question during curation is "why does conversation #7 read the way it does." Both views come from the same `conversationId`-keyed node outputs (D9) — no extra persistence.

### D12. Live streaming, review-gate presentation, and legacy rendering

- **Live per-call streaming.** `generateTextBatch` gains a node-publishing callback and calls `updateWorkflowNode` at each call's start (`processing`) and completion, instead of dumping all exchanges when the stage finishes. The transport needs no changes. Because every node patch re-ships the whole node array (full prompts and conversations) over SSE and rewrites the StudioJob JSON, node payloads are **summary-first**: the stat-line summary always rides the node; heavy bodies (prompts, full outputs, per-conversation tables) are attached at node completion, and the emitter avoids re-serializing unchanged sibling payloads where the existing update path allows.
- **Ghost pipeline.** When a stage starts, all its fixed steps render immediately as `pending` — the full flowchart shape is visible from the first second; conditional steps flip to `skipped` (not removed) if triage flags nothing.
- **Degradation semantics.** Amber `repairWarning` treatment = the call failed but the pipeline continued on a fallback (triage fallback, one dead repair candidate); danger `error` = the failure stopped the run, and downstream nodes flip to `skipped`. This keeps red meaning "the run needs you" rather than "a retry happened".
- **Paused-for-review gate.** When the final audit trips thresholds (D6), the final-audit band expands inline into the review card — threshold table with met/tripped pills, drop list, shortfall summary — with the action row: primary "Approve & generate audio", danger "Discard run", and a link to the full report in the inspector. The audio lane renders dashed ("Awaiting review"); the job tray shows the standard paused treatment so the gate is discoverable from anywhere.
- **Legacy runs.** Runs recorded under the three-kind model render through the same shell as a reduced lane synthesized from stored exchanges (initial exchange → Generate node, `vocabularyQuality` → vocab-audit node, `repairAttempt` exchanges → a single Repair node), marked with an info notice ("Recorded before per-call auditing"); triage/gates/pick nodes are never invented, and the old Attempts tab survives only on these synthesized nodes. No data migration.

## Risks / Trade-offs

- **[Triage/picker naturalness judgment is uncalibrated model opinion]** → Ground both prompts with deterministic evidence (D1) and curated exemplars (D2); persist rationales so bad verdicts are auditable; thresholds convert systemic misjudgment into visible warnings rather than silent drops.
- **[Second repair candidate may not earn its cost]** → D7 instruments pick rates from day one. If candidate 2 rarely wins across real runs, drop to one repair call — the design degrades cleanly (pool of two).
- **[Shortfall could leave zero-coverage words unhoused]** → Acceptable by design: the library-level balance loop re-surfaces those words in the next complement plan. The final audit lists missing words explicitly so the operator knows.
- **[Repair may still not fix balance-stage unnaturalness caused by incompatible word groupings]** → Known limitation; the deterministic plan packs zero-count words by count (`REQUIRED_ZERO_WORDS_PER_CONVERSATION`) with no semantic compatibility. If balance-stage conversations dominate `repair`/`regenerate` verdicts after this ships (measurable from D7 data), the next change is a word-grouping planning step before balance generation — deliberately out of scope here.
- **[More model calls per stage (~2 → ~6 typical, ~10 worst case with a full re-roll pass)]** → Calls are batch-level, not per-conversation; the re-roll pass is bounded at one per stage; text-generation is already serialized by the generation gate, so wall-clock impact is bounded and provider cost stays modest relative to the audio it protects.
- **[Paused-for-review adds an operator interruption]** → Only on threshold trips; a clean run behaves exactly as today. Threshold constants are deliberately permissive at first.
- **[Larger checkpoint/run payloads (candidates, verdicts)]** → Candidates are transient within the stage; only the selected conversation plus decision metadata and exchanges persist, consistent with today's practice of persisting all exchanges.
- **[SSE payload amplification from per-call nodes]** → Node count grows ~5× and every node patch re-ships all node payloads over the job channel; mitigated by summary-first node outputs (D12), heavy bodies attached only at node completion, and the existing revision-guarded client updates. If payloads still prove heavy in practice, the fallback is lazy-loading node bodies over REST while keeping summaries on the channel — an implementation swap, not a UX change.
- **[Closed `WorkflowNodeKind` union is consumed by status derivation and stage mapping]** → `workflowJobForRun` status derivation (audio-scoped incompleteness checks plus errored-node checks on the legacy synthesis path), the `updateWorkflowJob` stage mapping, `workflowLlmExchanges`, and the repair-rerun endpoint are enumerated in tasks and covered by tests including legacy-data fixtures; legacy three-kind data never routes through the new-kind logic (D12).
- **[Graph density could overwhelm on small screens]** → Lanes stack and verticalize at the existing 900px breakpoint (fork column becomes two sequential cards under a "parallel" eyebrow); the conversation rail stays a horizontal scroll strip; deterministic chips collapse to single-line rows at 560px. The vertical-first lane structure degrades more gracefully than today's rotated-arrow hack.

## Migration Plan

Additive rollout, no data migration:

1. New types and prompt builders land alongside existing ones; `generateTextBatch` is restructured behind the same signature, so callers are unchanged.
2. Old runs lack quality metadata; UI treats absent metadata as "pre-quality-control run" and renders as today.
3. The workflow audit node model is extended additively (`callKind`/`stage`/`pass`/`candidateIndex`/`sequence` on new nodes); persisted three-kind runs are detected by the absence of `callKind` and routed to the legacy render path — no node data is rewritten.
4. Rollback = revert the server change; persisted new fields are additive and ignored by old code.

## Open Questions

- Should the paused-for-review gate also offer "regenerate balance stage" as a resume option, or is resume/discard enough for v1? (v1: resume/discard only.)
- Exact threshold constants — start permissive (30% regenerate fail, shortfall ≥ 2 and > 20% pause) and tune from real run data.
- Should triage/picker calls use the run's selected text model or a fixed cheaper judge model? (v1: same model as the run, via existing `textModels.ts` resolution — one fewer configuration surface.)
