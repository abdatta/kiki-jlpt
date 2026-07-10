# Proposal: Add Claude Text Provider

## Why

The Studio can generate conversations only through Gemini (API key) and Codex (OAuth session reuse), while an authenticated Claude Code CLI subscription already sits unused in WSL. Adding Claude as a third text provider gives the operator access to the strongest current conversation-writing models (Fable, Opus, Sonnet, Haiku) at zero marginal cost, and a live smoke test has already proven the headless CLI path works end to end from this machine.

## What Changes

- **Claude text provider.** A new provider invokes the `claude` CLI headless (print mode, JSON output, all tools disabled, no session persistence, MCP servers excluded, neutral working directory) through WSL, piping the prompt via stdin and passing generation instructions as the system prompt. Structured-JSON generation, conversation generation, and every quality-control call work through it exactly as they do for Gemini and Codex.
- **Curated Claude model options.** The model picker offers the four Claude aliases — Fable, Opus, Sonnet, Haiku — as a curated static list (the CLI has no model-enumeration command; aliases track the latest model automatically). The list and the CLI path are environment-overridable.
- **Resolved model version on generations.** At picker time only the alias is known. Each generation response reports the exact model that served it (e.g. `claude-haiku-4-5-20251001`); the provider captures this and records it in the exchange statistics so runs are marked with the true model version, not just the alias.
- **Provider-grouped model pickers.** Studio model dropdowns group options under provider headings — Gemini, GPT, and Claude — instead of one flat list.
- Studio-only change: the learner application, curated content format, and published library manifest are unaffected. No new npm dependencies; the provider shells out to the CLI.

## Capabilities

### New Capabilities

- `claude-text-generation`: Claude CLI provider behavior — headless invocation contract, isolation and safety flags, subscription-auth handling, curated alias model options, resolved-model-version capture, and failure surfacing.

### Modified Capabilities

- `content-generation`: Model selection requirements gain provider-grouped option presentation; generation provenance requirements gain recording of the provider-reported resolved model version alongside the requested model.

## Impact

- **Server**: new `server/claudeText.ts` (CLI spawn + envelope parsing); `server/textModels.ts` gains Claude options and `claude:` id resolution; `server/structuredText.ts` and the conversation-generation dispatch in `server/index.ts` gain a Claude branch; `shared/types.ts` extends `TextModelProvider` with `'claude'`.
- **Studio UI**: the model `<select>` controls in `src/App.tsx` render provider `<optgroup>`s; exchange/audit views need no changes (stats flow through existing generic rendering).
- **Configuration**: new optional env vars for the CLI path (WSL absolute path), model list override, and WSL invocation; documented in `.env.example`.
- **Dependencies/systems**: requires WSL with a logged-in `claude` CLI on the host running the server; generation draws from the operator's Claude subscription quota.
