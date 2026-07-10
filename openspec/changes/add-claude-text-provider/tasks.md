# Tasks: Add Claude Text Provider

## 1. Shared types and configuration

- [x] 1.1 Extend `TextModelProvider` in `shared/types.ts` with `'claude'`, add optional `resolvedModel?: string` to `TextModelInfo` and `LlmExchange`, and extend `TextModelInfo['source']` if a new source kind is needed
- [x] 1.2 Document new env vars in `.env.example`: `CLAUDE_CLI_PATH` (WSL absolute path with a comment that the binary is not on the non-login PATH), `CLAUDE_WSL_DISTRO`, `CLAUDE_TEXT_MODELS`, `CLAUDE_CLI_TIMEOUT_MS`

## 2. Claude CLI invocation module

- [x] 2.1 Create `server/claudeText.ts` with `generateClaudeStructuredJson(prompt, model, instructions)` and `CLAUDE_TEXT_INSTRUCTIONS`: build the verified flag set (`-p --model <model> --output-format json --tools "" --no-session-persistence --strict-mcp-config --system-prompt <instructions>`, plus `--fallback-model` per design D1; never `--bare`), spawn via `wsl.exe --cd <tmp> -- <cliPath> ...` on win32 (with optional `-d <distro>`) or `<cliPath>` directly elsewhere, pipe the prompt through stdin, and support an injectable runner for tests
- [x] 2.2 Implement envelope handling per design D2: enforce timeout with process kill, treat non-zero exit / unparseable stdout / `is_error` / empty `result` as failures with actionable messages (prefer envelope `result` text), parse `result` with the shared fence-stripping JSON extraction, and build stats from the envelope minus `result` including `requestedModel` and `resolvedModel` (first `modelUsage` key)
- [x] 2.3 Add `server/claudeText.test.ts` with an injected runner covering: successful parse with resolvedModel capture, not-logged-in envelope error surfaced, non-zero exit with stderr, unparseable stdout, empty result, timeout kill, and win32 vs linux argv construction (including stdin delivery and absence of `--bare`)

## 3. Model options and resolution

- [x] 3.1 Add curated Claude options to `server/textModels.ts`: default `fable,opus,sonnet,haiku` labeled Claude Fable/Opus/Sonnet/Haiku, `CLAUDE_TEXT_MODELS` override (aliases or full names), ids `claude:<model>`
- [x] 3.2 Extend `resolveTextModel` to resolve any `claude:<model>` id (configured list first, lenient fallback for unlisted ids) and keep gemini/codex behavior unchanged
- [x] 3.3 Add unit coverage for Claude option listing, env override, and lenient resolution (extend the existing test suite that covers text models, or add `server/textModels.test.ts` to the `test:unit` list if none exists)

## 4. Dispatch integration

- [x] 4.1 Add the Claude branch to `invokeStructuredJson` in `server/structuredText.ts` (explicit three-way provider switch)
- [x] 4.2 Add the Claude branch to the conversation-generation dispatch and instructions selection in `server/index.ts` (standard generation, workflow batches, library complement, and the saved-node repair rerun path)
- [x] 4.3 Stamp resolved model versions per design D3: set `resolvedModel` on Claude exchanges from provider stats, and stamp the run's stored `textModel.resolvedModel` from the first successful generation exchange across all run-creating entrypoints

## 5. Studio UI

- [x] 5.1 Group both text-model `<select>` controls in `src/App.tsx` by provider via a shared helper rendering `<optgroup>`s in fixed order Gemini → GPT → Claude, folding the legacy current-run model injection into its provider group
- [x] 5.2 Display `resolvedModel` where run/exchange model identity is shown (run header/meta and exchange inspector meta line) when present
- [x] 5.3 Extend `src/studioCuration.test.tsx` (or sibling) to cover grouped picker rendering, legacy-model injection into a group, and resolved-version display

## 6. Verification

- [x] 6.1 Run `npm run test:unit` and fix failures
- [x] 6.2 Run `npm run build` (typecheck + bundle) and fix failures
- [x] 6.3 Exercise one real Claude generation end to end in the Studio (small count, haiku alias): verify the picker groups render, generation succeeds through WSL, the run is stamped with the resolved model version, and the audit view shows Claude exchange stats
