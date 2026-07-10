# Claude Text Generation Specification

## ADDED Requirements

### Requirement: Headless Claude CLI invocation
The studio SHALL generate text through the Claude provider by invoking the operator's authenticated Claude CLI non-interactively: print mode with JSON output, all built-in tools disabled, session persistence disabled, externally configured MCP servers excluded, and a neutral working directory so no project context is loaded. The generation prompt SHALL be delivered via standard input and the generation instructions as the session system prompt. On a Windows host the invocation SHALL run through WSL; the CLI path, WSL distribution, and call timeout SHALL be configurable through the environment.

#### Scenario: Successful structured generation
- **WHEN** a Claude model is selected and the provider is invoked with a prompt and JSON-only instructions
- **THEN** the CLI is spawned headless with tools disabled and no session persistence, the response envelope's result text is parsed as JSON, and the call returns parsed content, raw output, and provider statistics

#### Scenario: Quality-control calls use the same invocation
- **WHEN** any structured-JSON step (triage, repair, pick, re-roll, curation) targets a Claude model
- **THEN** the call flows through the shared Claude invocation with the step's own instructions as the system prompt

### Requirement: Curated Claude model options
The studio SHALL offer a curated set of Claude model options in the text-model list — by default the Fable, Opus, Sonnet, and Haiku aliases — because the CLI provides no model enumeration. The set SHALL be overridable through the environment with aliases or full model names. Resolving an unlisted Claude model id SHALL succeed leniently as a fallback option so previously saved runs and manually configured models remain usable; actual availability is validated by the CLI at generation time.

#### Scenario: Default options offered
- **WHEN** the operator opens the text-model list without a Claude environment override
- **THEN** Claude Fable, Claude Opus, Claude Sonnet, and Claude Haiku appear as selectable options

#### Scenario: Environment override narrows the list
- **WHEN** the Claude model list is overridden in the environment
- **THEN** only the configured aliases or model names appear as Claude options

#### Scenario: Unlisted Claude model id resolves
- **WHEN** a generation request references a Claude model id that is not in the configured list
- **THEN** the request resolves to a fallback-sourced Claude model rather than being rejected

### Requirement: Resolved model version capture
Because Claude options are aliases that track the latest model, the provider SHALL capture the exact model version reported in the generation response and include it, alongside the requested model, in the statistics of every Claude exchange.

#### Scenario: Alias resolves to exact version
- **WHEN** a generation requested with a Claude alias completes
- **THEN** the exchange statistics record both the requested alias and the exact model version that served the call

### Requirement: Claude failure surfacing
A Claude invocation SHALL be treated as failed when the process exits unsuccessfully, produces an unparseable envelope, reports an error in the envelope, returns an empty result, or exceeds the configured timeout. The failure SHALL surface an actionable message — preferring the envelope's own error text, such as a not-logged-in notice — on the recorded exchange, and SHALL NOT prevent other providers from operating.

#### Scenario: CLI not authenticated
- **WHEN** the WSL Claude CLI has no valid login
- **THEN** the generation fails with the CLI's login guidance visible on the failed exchange

#### Scenario: Call exceeds timeout
- **WHEN** a Claude call runs longer than the configured timeout
- **THEN** the process is terminated and the exchange records a timeout failure
