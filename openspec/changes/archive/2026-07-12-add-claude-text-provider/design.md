# Design: Add Claude Text Provider

## Context

The Studio dispatches all text generation through two seams: `invokeStructuredJson` in `server/structuredText.ts` (quality control, curation) and the conversation-generation branch in `server/index.ts` (initial/balance batches, repair reruns). Both switch on `TextModelInfo.provider` (`'gemini' | 'codex'`) and return `{ parsed, output, stats }`. Model options come from `getTextModelOptions()` in `server/textModels.ts`, served at `/api/text-models`, and rendered as flat `<select>` lists in `src/App.tsx`.

A live spike (2026-07-09, claude CLI 2.1.203 in WSL at `/home/abd/.local/bin/claude`) verified the headless path end to end. Verified facts this design relies on:

- Working invocation: prompt via stdin, `-p --model <alias> --output-format json --tools "" --no-session-persistence`, subscription auth picked up automatically. `wsl.exe` does not propagate Windows env vars, so nothing can shadow the login.
- The JSON envelope carries `result` (text), `is_error`, `subtype`, `usage`, `modelUsage` (keyed by the **resolved full model id**, e.g. `claude-haiku-4-5-20251001`), `total_cost_usd`, `duration_ms`, `session_id`.
- `--bare` breaks subscription auth ("Not logged in") — must not be used. Isolation is achieved instead with `--tools ""`, `--strict-mcp-config`, and a neutral working directory (`wsl.exe --cd /tmp`) so no project CLAUDE.md, MCP servers, or hooks load.
- No model-enumeration command exists (docs + CLI confirmed). `--model` accepts aliases (`fable`, `opus`, `sonnet`, `haiku`) or full model names; aliases track the latest model.
- Spawn overhead ≈ 2.4 s per call; error responses still produce a parseable envelope (`is_error: true`, message in `result`).

## Goals / Non-Goals

**Goals:**

- Claude usable everywhere a text model is used today: standard generation, workflow (initial/balance), quality control (triage/repair/pick/re-roll), library complement, saved-node repair rerun, AI curation.
- Picker lists the four aliases; the exact serving model version is captured per call and recorded on the run.
- Model dropdowns grouped by provider: Gemini, GPT, Claude.
- No new npm dependencies; no learner-app or content-format changes.

**Non-Goals:**

- `--json-schema` structured output (prompts already define shapes and are parsed with the shared fence-stripping pattern; threading real schemas through the prompt builders is a separate improvement).
- Streaming output, cost budgeting (`--max-budget-usd`), and Claude-based TTS.
- Automatic login management — the operator keeps the WSL CLI logged in.

## Decisions

### D1 — Spawn the CLI headless; do not reuse OAuth tokens

Codex-style token reuse is unsupported for Anthropic subscription OAuth, while headless `claude -p` is the documented programmatic surface. `server/claudeText.ts` spawns the CLI per call with `node:child_process`:

- **Windows host** (the current dev setup): `spawn('wsl.exe', ['--cd', '/tmp', '--', cliPath, ...args])`. Optional `CLAUDE_WSL_DISTRO` adds `-d <distro>`.
- **Linux/WSL host**: spawn `cliPath` directly with `cwd` set to the OS temp dir.
- `cliPath` comes from `CLAUDE_CLI_PATH` (default `claude`; the `.env.example` documents the WSL absolute path since the binary is not on the non-login PATH).

Flag set (exactly the smoke-tested one, plus MCP exclusion): `-p --model <model> --output-format json --tools "" --no-session-persistence --strict-mcp-config --system-prompt <instructions> --fallback-model sonnet` (fallback omitted when sonnet is the requested model, falling back to haiku instead). The prompt is written to stdin (10 MB CLI cap; our prompts are ≤ ~200 KB). **`--bare` is never used** (breaks subscription auth). No `--max-turns` (tools are disabled, so turns cannot loop).

### D2 — Envelope parsing and error contract

Success requires: exit code 0, parseable JSON on stdout, `is_error === false`, and non-empty `result`. The `result` string is parsed with the same fence-stripping JSON extraction used by the other providers. Failures throw an `Error` whose message prefers the envelope's `result`/`subtype` (e.g. "Not logged in · Please run /login") over raw stderr, so operators see actionable text in the exchange error. A configurable timeout (`CLAUDE_CLI_TIMEOUT_MS`, default 10 minutes) kills the process and reports a timeout error; partial stdout is included in stats for auditability.

`stats` is the envelope minus the bulky `result` field: `usage`, `modelUsage`, `total_cost_usd`, `duration_ms`, `session_id`, `subtype`, plus `requestedModel` and `resolvedModel`.

### D3 — Resolved model version: alias at pick time, exact id at generation time

The picker can only offer aliases (no enumeration API). The first key of the envelope's `modelUsage` object is the exact model that served the call (verified: alias `haiku` → `claude-haiku-4-5-20251001`). Chosen recording scheme, additive across all providers:

- `LlmExchange` gains optional `resolvedModel?: string` — set on every Claude exchange (and available to other providers later; Gemini already reports `modelVersion` in stats).
- `TextModelInfo` gains optional `resolvedModel?: string` — the run's stored `textModel` is stamped with the resolved id from the first successful generation exchange, so the run itself is marked with the true model version while its picker id/label stay alias-based.
- UI: run and audit surfaces that show a model name display `resolvedModel` when present (e.g. "Claude Sonnet · claude-sonnet-5"); the exchange inspector meta line shows the per-call resolved model.

Alternative rejected: resolving the alias up front with a probe call (costs quota per picker load and can drift between pick time and generation time).

### D4 — Curated model options with env override

`server/textModels.ts` adds a static list mirroring the Gemini/Codex option shape: ids `claude:fable | claude:opus | claude:sonnet | claude:haiku`, labels `Claude Fable/Opus/Sonnet/Haiku`, `source: 'configured'`. `CLAUDE_TEXT_MODELS` (comma-separated aliases or full model names, default `fable,opus,sonnet,haiku`) overrides the list. `resolveTextModel` accepts any `claude:<model>` id — unknown values pass through as `source: 'fallback'` (same lenience as Codex ids), letting the CLI validate actual availability; plan-gated models fail at generation time with the envelope's error message surfaced.

### D5 — Provider-grouped pickers via `<optgroup>`

Both model `<select>` controls in `src/App.tsx` render one `<optgroup>` per provider in fixed order Gemini → GPT → Claude (labels: "Gemini", "GPT", "Claude"), options grouped by `TextModelInfo.provider`. The existing legacy-run injection (prepending `currentRun.textModel` when absent from the fetched list) folds the injected option into its provider's group, creating the group if needed. A shared grouping helper keeps the two pickers consistent. Native `<optgroup>` needs no new CSS beyond what the themed `<select>` already has.

### D6 — Dispatch and instructions

`TextModelProvider` gains `'claude'`. `invokeStructuredJson` and the conversation dispatch in `server/index.ts` switch on provider explicitly (gemini / codex / claude) instead of the current binary ternary. `CLAUDE_TEXT_INSTRUCTIONS` mirrors `CODEX_TEXT_INSTRUCTIONS` ("return only valid JSON…") and is passed as `--system-prompt`; per-call instructions from `invokeStructuredJson` take precedence, matching Codex behavior.

## Risks / Trade-offs

- [CLI login expires or machine lacks WSL] → Generation fails fast with the envelope's "Not logged in" message surfaced in the run/exchange error; other providers unaffected. Documented in `.env.example`.
- [Envelope shape drifts across CLI versions] → Parser only requires `is_error` + `result`; everything else is passed through opportunistically into stats. Unknown fields are preserved, missing ones tolerated.
- [Per-call process spawn overhead (~2.4 s)] → Negligible against multi-second generation calls; no pooling needed. Parallel calls (two repair candidates) spawn independent processes safely.
- [Subscription quota exhaustion mid-run] → Surfaces as a failed exchange like any provider error; the bounded quality-control flow already tolerates failed calls with deterministic fallbacks.
- [Plan-gated aliases (e.g. fable) in the default picker list] → Kept per operator request; a failed call reports the CLI's availability error, and `CLAUDE_TEXT_MODELS` can trim the list.
- [Windows/WSL coupling in tests] → `claudeText.ts` accepts an injectable spawn/runner so unit tests never touch WSL; CI (Linux) runs the direct-spawn path only in unit form.

## Migration Plan

Additive, no data migration: existing runs deserialize unchanged (`resolvedModel` optional). Rollback = removing the provider branch; stored `claude:*` runs still render via the legacy-model injection path.

## Open Questions

None blocking. Post-MVP candidates: thread real JSON schemas to `--json-schema`, per-call effort control if the CLI exposes one, and populating `resolvedModel` for Gemini/Codex exchanges.
