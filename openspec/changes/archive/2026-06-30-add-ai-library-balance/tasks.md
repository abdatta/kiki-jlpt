## 1. Shared types

- [x] 1.1 Extend the complement request type in `shared/types.ts` (`LibraryComplementGenerateRequest`) with `balanceMode?: 'stats' | 'ai'` (default `'stats'`) and optional `conversationCount?: number`.

## 2. Server: AI-balance prompt

- [x] 2.1 Add `buildAiLibraryBalancePrompt(setNumber, allowedVocabulary, balance, libraryContext)` to `server/prompt.ts` that supplies the authoritative deterministic plan (zero/priority/overrepresented words) plus the curated library's conversation content and per-word exposure, instructing the model to fill gaps, diversify scenes away from existing ones, repeat focal words only where natural, and never recalculate counts.
- [x] 2.2 Reuse the trimmed library-context shape from `server/aiCuration.ts` (`libraryContext`) for the AI prompt's library section; export or extract it so both modules share one shape.
- [x] 2.3 Add a prompt-builder test in `server/prompt.test.ts` asserting the AI-balance prompt includes the gap priorities, the library conversation content + exposure, the variety/non-redundancy guidance, and the authoritative-counts instruction.

## 3. Server: endpoint wiring

- [x] 3.1 Update `getLibraryComplementContext` in `server/index.ts` to accept the request body's `balanceMode` and optional `conversationCount`, validate the count against the supported range, and apply the override to `balance.suggestedConversationCount` and the generation target.
- [x] 3.2 In AI mode, build the snapshot via `buildAiCurationSnapshot(setNumber)`, derive its library context, and use `buildAiLibraryBalancePrompt`; in stats mode keep `buildLibraryComplementPrompt`. Default to stats mode when `balanceMode` is absent.
- [x] 3.3 Ensure `/complement/preview` and `/complement` both branch on mode and that AI-mode runs retain the balance plan and snapshot/exposure context in the exchange stats for audit provenance.
- [x] 3.4 Confirm the existing "no usable conversations" / provider-failure path returns a retryable error and leaves the library unchanged in both modes.

## 4. Client: complement controls

- [x] 4.1 Add a balance-mode toggle (stats-only vs AI-enabled) and a conversation-count override input to the complement controls in `src/App.tsx`. Prefer a toggle; fall back to two adjacent buttons only if that is materially simpler.
- [x] 4.2 Update `generateLibraryComplement` to send `balanceMode` and the override `conversationCount` in both the preview and generate request bodies, and reflect the chosen mode/count in the generation-session status text.
- [x] 4.3 In the run audit panel, hide the AI-mode exposure/snapshot context by default and add a button/disclosure to reveal it.
- [x] 4.4 Verify the generated run still lands as a normal reviewable run (navigate-to-run, no auto-curation) in both modes.

## 5. Verification

- [x] 5.1 Run `npm run test:unit` and fix any failures from the new prompt test and existing prompt/curation tests.
- [x] 5.2 Run `npm run build` (typecheck + vite build) to confirm shared-type and server/client changes compile.
- [ ] 5.3 Smoke-test in the studio: preview + generate a stats-only complement and an AI-enabled complement for a set, exercise a count override, and confirm both produce reviewable runs without changing the curated library.
