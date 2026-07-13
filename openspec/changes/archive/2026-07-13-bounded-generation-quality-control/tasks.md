# Tasks: Bounded Quality Control for Conversation Generation

## 1. Shared types and constants

- [x] 1.1 Add quality-control types to `shared/types.ts`: `ConversationQualityVerdict` (`pass | repair | regenerate` with rationale and flags), per-conversation quality metadata on `PracticeConversation` (`quality: 'good' | 'okay'`, `qualityDecision`, `pickerSelected`, `pickerConfidence`, `qualityFlags` — all optional/additive), pick-outcome and final-text-audit report types
- [x] 1.2 Extend the workflow audit node model in `shared/types.ts` per design D9: additive `callKind` (`generation | vocab-audit | triage | repair-candidate | dominance-gates | pick | reroll | final-audit | audio`), `stage: 'initial' | 'balance'`, `pass: 1 | 2`, `candidateIndex?`, `sequence`, and a typed node output summary block; document server-minted structural node IDs (`initial:triage`, `initial:repair-1`, `initial:pass2:pick`)
- [x] 1.3 Define threshold constants (initial-stage regenerate failure rate, shortfall pause thresholds with absolute-count guards) in a new `server/qualityControl.ts` module skeleton

## 2. Prompt builders

- [x] 2.1 Add a quality-triage prompt builder in `server/prompt.ts`: full batch with per-conversation deterministic evidence marked authoritative, structural-only `regenerate` guidance, curated exemplars via `libraryContext` when the set's library is non-empty, structured-JSON verdict shape
- [x] 2.2 Replace `buildRepairPrompt` (currently defined in `server/index.ts`) with a balanced repair prompt builder in `server/prompt.ts`: flagged conversations only, per-conversation audit findings plus triage rationales, balanced objective (naturalness, realism, level fit, OOV removal, natural vocabulary preservation, listening suitability), same-count same-shape return contract
- [x] 2.3 Add a picker prompt builder: per-conversation version sets (original + admissible candidates) with re-audit evidence attached, forced-choice instruction, `selectedQuality`/`confidence`/`flags` output shape
- [x] 2.4 Extend `server/prompt.test.ts` to cover the three new builders (evidence marked authoritative, exemplars included when available, pass conversations excluded from repair payloads)

## 3. Quality-control engine (`server/qualityControl.ts`)

- [x] 3.1 Implement triage invocation via `invokeStructuredJson` with response validation (every conversation receives exactly one verdict; unknown IDs rejected), the deterministic repair-need union (audit findings ∪ triage `repair`), and the deterministic-only fallback when the triage call fails (recorded for provenance)
- [x] 3.2 Implement repair-candidate generation: one repair payload over flagged conversations invoked twice independently; tolerate one failed call (proceed with survivor), tolerate both failing (retain originals with findings)
- [x] 3.3 Implement dominance gates: re-audit candidates per conversation, eliminate OOV-worsening candidates, flag `coverage_loss` by diffing current-set `vocabularyUsed`, auto-select when exactly one strictly best version remains
- [x] 3.4 Implement the batched picker tie-break with forced choice, plus the deterministic fallback (best audit, original on ties) when the pick call fails
- [x] 3.5 Implement bounded regeneration: drop `regenerate` conversations, single re-roll call per stage for the dropped count, re-rolled items flow through triage/repair/pick as a pass-2 sub-flow, second `regenerate` drops for good, shortfall carried in the stage result
- [x] 3.6 Implement quality labeling (`good`/`okay` per spec, including the deterministic gate-decided derivation) and the final-text-audit computation (counts, drops, re-rolls, label tallies, remaining OOV findings, uncovered words, coverage-loss flags, model-call failures with applied fallbacks, pick statistics, threshold evaluation)
- [x] 3.7 Ensure every step emits `conversationId`-keyed facts in its structured result (triage verdicts, gate eliminations, pick decisions, drop rationales) so audit nodes can power per-conversation tables and trace mode
- [x] 3.8 Add `server/qualityControl.test.ts` unit tests with an injected structured-JSON invoker (pattern from `server/aiCuration.test.ts`): verdict validation, pass-conversations-untouched, dominance gates, forced pick, fallbacks for each failed call type, re-roll bounding, threshold math on small batches

## 4. Generation flow integration and per-call provenance

- [x] 4.1 Restructure `generateTextBatch` in `server/index.ts` around audit → triage → repair ×2 → pick → label, keeping its signature; record triage verdicts, `repairCandidate` index, and pick outcomes in exchange stats alongside existing `repairAttempt`/`selectedForFinal` conventions
- [x] 4.2 Add a node-publishing callback to `generateTextBatch` and emit one workflow audit node per call/step via `updateWorkflowNode` at call start (`processing`) and completion, with structural IDs, exactly one exchange per model-call node, deterministic findings as gate-node outputs, and summary-first payloads (stat-line summary always present; heavy bodies attached at completion)
- [x] 4.3 Ensure `pass` conversations are carried through byte-identical (never resubmitted to repair) and per-conversation identity/numbering is preserved through candidate replacement
- [x] 4.4 Persist per-conversation quality metadata on saved runs for all three entrypoints (standard, workflow, library-complement) and a run-level audit summary for non-workflow runs
- [x] 4.5 Update consumers of the closed node-kind union for new kinds and legacy data: `workflowJobForRun` status derivation (its audio-scoped incompleteness checks and legacy-path errored-node checks must classify the new kinds without misreporting run status), the `updateWorkflowJob` stage mapping (`generator`/`balancer`/`audio` stage IDs), `workflowLlmExchanges`/`nodeOutputExchanges` extraction, and `reconcileWorkflowAuditNodes`
- [x] 4.6 Update the saved-node repair-rerun endpoint (`/workflow-nodes/:nodeId/repair`) to the scoped flow: flagged conversations only, two candidates, dominance-gated pick, appended per-call nodes and exchanges

## 5. Workflow final audit and audio gate

- [x] 5.1 Add the `final-audit` node to workflow orchestration in `runWorkflowJob`: compute the audit after the balancer, persist the report as node output and in the run's workflow audit, include it in checkpoints for resume
- [x] 5.2 Implement the gate: clean audit proceeds to audio unchanged; threshold trip transitions the job to `paused` with a stage label pointing at the audit report; resume continues into audio; verify legal-transition compatibility in `server/studioJobs.ts`
- [x] 5.3 Fail the initial stage with actionable guidance when the regenerate rate exceeds the failure threshold; surface the guidance in the job error and node output
- [x] 5.4 Update workflow stage labels/progress derivation for per-call nodes and shortfall-aware counts ("accepted M of N requested")
- [x] 5.5 Extend `server/studioJobs.test.ts` / `server/studioApi.test.ts`: pause-on-warning then resume-to-audio, checkpoint resume across the final-audit stage, shortfall run persistence, per-call node emission order and summary-first payloads, legacy jobs without per-call nodes still resume

## 6. Audit graph UI — structure and nodes

- [x] 6.1 Extend the audit route grammar to `#/studio/runs/:id/audit[/n/:nodeId][/c/:conversationId]`; selection writes the hash, loading the hash restores node selection and trace state
- [x] 6.2 Build the stage-lane layout replacing the 5-column `.workflowGraph`: stacked lanes for initial and balance stages (each with lane header eyebrow + rollup stat), full-width final-audit band, existing audio stage at the bottom; typographic arrows within lanes, fork column for the two repair candidates, indented pass-2 row for the re-roll sub-flow
- [x] 6.3 Build the two node species on top of the existing `.workflowNode` conventions: LLM-call cards (status-inflected bold title as the single header, compact output stats — one line, or a details-derived per-version stack on the gates/pick nodes, model + duration meta line) and compact code-background deterministic nodes; keep status-class-equals-status-string so existing recipes apply; skipped steps render dashed with explanatory stats, never removed
- [x] 6.4 Implement per-kind node stat lines from node output summaries (generation, vocab audit, triage, repair candidates, gates, pick, re-roll, final audit) and stage rollup sentences
- [x] 6.5 Implement live behavior: ghost-pending fixed steps at stage start, processing node animation and auto-follow, degraded-warning (amber) treatment for fallback-recovered calls vs error for run-stopping failures with downstream skipped, default inspector selection (processing node live / final audit done / first error failed)

## 7. Audit graph UI — inspectors, trace mode, review gate

- [x] 7.1 Rebuild the node inspector as per-kind deep dives (one node = one call; no Attempts tab for new runs): common frame (started/finished/model/duration cells, Prompt|Settings and Response|Metadata tabs) plus kind bodies — parsed conversations with OOV highlighting, vocab-audit findings table, triage verdict table with rationale reveals, repair before/after diffs vs original, gate elimination evidence, pick decision table with three-way comparison reveals, re-roll drop/replacement lineage, final-audit report with threshold met/tripped rows
- [x] 7.2 Build the conversation rail (chips with number, title, quality label, journey markers, dropped struck-through) and trace mode: node stat-line swap to conversation-scoped facts, dimming of untouched nodes, journey panel with version-to-version diffs and pick reasoning, inspector table auto-filtering, exit via All chip
- [x] 7.3 Add quality-label chips to run conversation rows that deep-link into trace mode; render pre-quality-control runs without labels
- [x] 7.4 Implement the paused-for-review presentation: final-audit band expands inline with threshold table, drop/shortfall summary, and actions (primary "Approve & generate audio", danger "Discard run", full-report link); audio lane dashed "Awaiting review"; standard paused treatment in the background-jobs tray
- [x] 7.5 Implement the legacy render path: reduced lane synthesized from stored exchanges (generate, vocab-audit, single repair node via the `repairAttempt` heuristic), pre-quality-control notice, Attempts tab retained only on synthesized legacy nodes
- [x] 7.6 Add responsive behavior at the existing 900px/560px breakpoints: lanes verticalize, fork column becomes sequential cards under a "parallel" eyebrow, conversation rail stays horizontally scrollable, deterministic chips collapse to single-line rows
- [x] 7.7 Style everything within the documented conventions in `src/styles.css` (node cards, status recipes, eyebrow labels, pills, code-bg machine styling, `.topBar`/pill header rules), adding only the new lane/fork/rail/journey classes
- [x] 7.8 Extend `src/studioCuration.test.tsx` (or a sibling test) to cover per-call node rendering, stat lines, trace mode annotation and journey panel, review-gate actions, legacy-run rendering, and deep-link restoration

## 8. Verification

- [x] 8.1 Run `npm run test:unit` and fix failures
- [x] 8.2 Run `npm run build` (typecheck + bundle) and fix failures
- [x] 8.3 Run `npm run library:check-published` to confirm curated/published content is unaffected
- [x] 8.4 Exercise one real workflow generation end-to-end in the studio (small count): verify per-call nodes stream live, node stat lines and deep dives render, trace mode follows a repaired conversation with diffs, the final audit renders and gates audio, a clean run reaches audio automatically, and pick-rate statistics are populated
- [x] 8.5 Open a pre-change run's audit view and verify the legacy path renders from stored exchanges with the pre-quality-control notice and functioning Attempts tab
