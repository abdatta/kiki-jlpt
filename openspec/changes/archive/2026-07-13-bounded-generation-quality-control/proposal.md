# Proposal: Bounded Quality Control for Conversation Generation

## Why

Generated batches currently receive only an out-of-vocabulary repair pass, so conversations that are lexically clean but stiff, incoherent, or drill-like survive into runs, consume audio budget, and burden curation. The existing repair also resubmits the entire batch and accepts on a batch-level score, so a repair that fixes one conversation can silently degrade another that previously passed.

This change adds a bounded quality-control layer around each text-generation stage: deterministic-evidence-grounded quality triage per conversation, a repair objective broadened to naturalness, independent repair candidates with a dominance-gated pick, honest quality labels, and a final audit that gates audio generation. Execution stays bounded — no repair or regeneration loops — and quota pressure is resolved by reported shortfall, never by force-accepting known-bad conversations.

## What Changes

- **Quality triage per conversation.** After each generated batch is deterministically audited, a single batched quality-review model call classifies every conversation as `PASS`, `REPAIR`, or `REGENERATE`, grounded on the authoritative deterministic evidence (the model never re-judges vocabulary facts) and calibrated with curated-library exemplars when available.
- **Scoped, balanced repair.** Only flagged conversations are sent for repair (fixing the current whole-batch regression vector). The repair objective covers naturalness, realism, level fit, and OOV reduction together. Two independent repair candidates are produced per repair round.
- **Dominance-gated picking.** For each repaired conversation, the best of {original, candidate 1, candidate 2} is selected: deterministic gates first (a candidate that worsens true OOV findings is never picked; assigned-coverage loss is flagged), then a batched model tie-break on naturalness among surviving candidates. Picking is forced — no candidate rejection, no additional loops.
- **Bounded regeneration handling with shortfall.** `REGENERATE` conversations are dropped and re-rolled at most once within their stage (initial and balance alike); conversations still unusable after the re-roll are dropped for good. Dropped initial slots are **not** transferred to the balance stage, and no conversation is ever force-accepted to hit the requested count — the run completes with a reported shortfall instead.
- **Quality labels.** Accepted conversations carry `quality: good | okay` plus picker confidence and flags; dropped conversations remain inspectable in stage provenance. There is no accepted-`bad` state.
- **Final audit gating audio.** After both text stages, a deterministic final audit reports count vs requested, coverage, distribution, remaining OOV findings, quality-label tallies, and coverage-loss flags. An excessive initial-stage regenerate rate fails the stage with actionable guidance; otherwise the workflow proceeds to audio automatically when the audit is clean, and pauses for operator review when warning thresholds trip (e.g. shortfall), reusing the existing paused/resume job machinery.
- **Provenance extensions.** Quality verdicts, repair candidates, picker outcomes, and pick-rate statistics are persisted in the existing exchange/audit provenance so the value of the second repair candidate is measurable from day one.
- **Per-call audit graph (new UI).** The run audit view is rebuilt around a generation flow graph in which **every model call is its own node** — generation, triage, each repair candidate, pick, re-roll, and each audio call — ending today's pattern of repair exchanges hidden inside the generator/balancer node outputs. Deterministic steps (vocabulary audit, dominance gates, final audit) appear as visually distinct machine-step nodes so the operator can see at a glance what was model judgment and what was ground truth. Every node carries a one-line output stat (e.g. triage `14 pass · 5 repair · 1 regen`; pick `orig 1 · c1 3 · c2 1`); clicking a node opens a per-kind deep-dive (prompt, response, per-conversation verdict/decision tables, diffs). The pipeline shape stays constant across runs — steps that weren't needed render as skipped, not hidden — so the graph itself teaches how the flowchart works.
- **Conversation trace mode.** A conversation rail above the graph lets the operator follow one conversation's journey end to end: nodes that touched it re-annotate with that conversation's fact (`#7: repair — "stilted register"`, `#7 → candidate 2 · okay`), untouched nodes dim, and a journey panel shows its version history with line-level diffs from generation through repair, pick, final audit, and audio.
- **Live per-call streaming and deep links.** Nodes appear and update live as each call starts and finishes (today the whole stage is opaque until it completes), and every node and conversation trace is addressable via the audit route for shareable deep links. Legacy runs render through the same shell from their stored exchanges, clearly marked as pre-quality-control recordings.

Studio-only change: the learner application, curated content format, and published library manifest are unaffected. Run persistence gains additive per-conversation quality metadata, a per-call workflow audit node model, and a run-level final-audit record.

## Capabilities

### New Capabilities

- `generation-quality-control`: Quality triage, balanced repair candidates, dominance-gated picking, quality labels, bounded regeneration with shortfall, and the final text audit for generated conversation batches.
- `generation-audit-graph`: The per-call generation flow graph — one audit node per model call and per deterministic step, node output summaries with per-kind deep dives, conversation trace mode, live per-call streaming, node/conversation deep links, the paused-for-review presentation, and legacy-run rendering.

### Modified Capabilities

- `content-generation`: The single whole-batch OOV repair requirement is replaced by the scoped quality-control flow (triage → repair flagged only → pick); the balanced generation workflow gains a final-audit stage that gates audio; generation provenance requirements extend to per-call audit nodes, quality verdicts, repair candidates, and picker outcomes.

## Impact

- **Server generation flow**: `generateTextBatch` in `server/index.ts` is restructured around the triage/repair/pick sequence; `buildRepairPrompt` is replaced by a balanced repair prompt over flagged conversations; new quality-triage and picker prompts (reusing the `structuredText.ts` structured-JSON invoker and the authoritative-evidence pattern from `aiCuration.ts`).
- **Workflow orchestration**: `runWorkflowJob` gains a final-audit stage node and the audio gate; the workflow audit node model in `shared/types.ts` moves from three coarse kinds (`generator`/`balancer`/`audio`) to one node per call/step with stage grouping and structural IDs; `generateTextBatch` publishes nodes mid-stage over the existing SSE job channel instead of dumping all exchanges at stage completion.
- **Studio UI**: the run audit view (`WorkflowAuditFlow` and the workflow graph/inspector in `src/App.tsx`) is rebuilt as the per-call audit graph with stage lanes, per-kind node inspectors, conversation trace mode, and the final-audit review gate; conversation rows surface quality labels; legacy runs keep a reduced rendering path. Reuses the existing studio visual vocabulary (node cards, status recipes, inspector, pills) per the documented conventions in `src/styles.css`.
- **LLM call budget**: +4 model calls per text stage in the common case, regardless of batch size (1 triage, 2 repair, 1 pick); a re-roll pass — bounded at one per stage — adds up to 5 more (the re-roll generation plus its own triage/repair/pick), for a worst case of ~10 calls per stage versus ~2 today.
- **Not affected**: learner app, curated library format, published manifest, audio scheduler internals, AI curation flow (it later benefits from quality labels as advisory signal, but that is out of scope here).
