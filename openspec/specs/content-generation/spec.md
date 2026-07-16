# Content Generation Specification

## Purpose

Defines how the studio validates, generates, audits, edits, voices, and manages practice-conversation runs.
## Requirements
### Requirement: Provider-grouped model selection
Studio text-model pickers SHALL present model options grouped under provider headings, ordered Gemini, GPT, Claude, with each option listed inside its provider's group. The generation modal SHALL present separate Generator model and Judge model pickers using those grouped options. The Judge model SHALL default to GPT-5.6-Sol (`codex:gpt-5.6-sol`) and an operator MAY select a different available model. A historical run whose generator or judge model is absent from the current option list SHALL remain selectable or displayable inside its provider's group.

#### Scenario: Grouped generator and judge pickers
- **WHEN** the operator opens the generation modal
- **THEN** both model pickers show options under Gemini, GPT, and Claude group headings in that order
- **AND** the Judge model defaults to GPT-5.6-Sol

#### Scenario: Historical model stays selectable
- **WHEN** the operator views a run generated or judged with a model no longer offered
- **THEN** that model appears selectable or displayable within its provider's group

### Requirement: Resolved model version provenance
When a provider reports the exact model version that served a generation, the generation exchange SHALL record that resolved version, and the run's stored model information SHALL be stamped with the resolved version from its first successful generation exchange. Surfaces that display a run's or exchange's model identity SHALL show the resolved version when present, and MAY present it in a shortened human-readable form (model family and version, date suffix omitted) provided the exact identifier remains inspectable in the exchange statistics.

#### Scenario: Run stamped with resolved version
- **WHEN** a run is generated with a model alias and the provider reports the exact serving model version
- **THEN** the persisted run's model information includes the resolved version alongside the alias-based selection

#### Scenario: Audit shows the per-call version
- **WHEN** the operator inspects a generation exchange whose provider reported a resolved model version
- **THEN** the audit surface displays that resolved version

### Requirement: Validated generation requests
The studio SHALL require a positive vocabulary set containing vocabulary, resolvable generator and judge models, successful role-appropriate model probes, and an integer conversation count within the supported mode's range before generation. Standard generation SHALL accept 4 through 30 conversations; workflow generation SHALL accept 6 through 30 total conversations. Generated conversation vocabulary SHALL be constrained and audited against the vocabulary allowed through the selected set. The start endpoint SHALL resolve both selected models again and SHALL reject an invalid request without creating a run.

#### Scenario: Valid generation request
- **WHEN** an operator selects a valid set, an in-range conversation count, and available generator and judge models whose probes succeeded
- **THEN** the system prepares generation using vocabulary allowed through that set

#### Scenario: Probe blocks a start
- **WHEN** either the generator or judge probe fails because of authentication, usage limits, model availability, or invalid structured output
- **THEN** the Studio identifies the failing role with actionable feedback and does not create a generation job

#### Scenario: Invalid generation request
- **WHEN** the set, count, generator model, or judge model is invalid at start time
- **THEN** the system rejects the request with a descriptive validation error and does not create a run

### Requirement: Conversation generation and normalization
The studio SHALL invoke the selected provider, normalize usable conversations from its response, audit their vocabulary deterministically, and pass the audited batch through the generation quality-control flow (evidence-grounded triage, scoped balanced repair with independent candidates, dominance-gated pick, and bounded regeneration with reported shortfall, as defined by the generation-quality-control capability) before persisting accepted conversations as a run. For Set 2 and later, generated batches SHOULD target zero true out-of-allowed content words after deterministic prompt-policy, validated proper-noun, and declared cultural-reference exemptions, but remaining true OOV findings SHALL be treated as auditable quality findings rather than a hard generation failure. Repair MUST NOT resubmit or alter conversations whose triage verdict is `pass`. It SHALL reject a provider response that contains no usable conversations.

#### Scenario: Provider returns usable conversations within vocabulary targets
- **WHEN** a configured provider returns at least one usable generated conversation whose deterministic audit has no true out-of-allowed content findings and whose triage verdict is `pass`
- **THEN** the system normalizes and audits the conversations and saves a run with generation analytics and quality labels

#### Scenario: Provider returns repairable content
- **WHEN** a generated batch contains conversations with true out-of-allowed content words or repairable quality findings
- **THEN** the system sends only the flagged conversations, their audit findings, triage rationales, and allowed-vocabulary constraints for balanced repair
- **AND** re-normalizes and re-audits each repair candidate before picking

#### Scenario: Pick improves a flagged conversation
- **WHEN** a repair candidate for a flagged conversation survives the deterministic gates and is selected by the pick
- **THEN** the system persists the selected candidate for that conversation with its quality label and pick provenance

#### Scenario: Repair does not improve a flagged conversation
- **WHEN** no repair candidate for a flagged conversation is admissible or preferred over the original
- **THEN** the system retains the original conversation for that slot
- **AND** exposes the repair exchanges and remaining findings in generation provenance and analytics

#### Scenario: Passing conversations are never degraded by repair
- **WHEN** repair runs for a batch containing conversations with `pass` verdicts
- **THEN** those conversations are persisted exactly as generated regardless of repair outcomes for other conversations

#### Scenario: Provider returns no usable conversations
- **WHEN** the provider response cannot produce any usable conversation
- **THEN** the system reports a generation failure and does not save an empty successful run

### Requirement: Generation provenance and auditability
The studio SHALL retain the selected generator and judge provider/model identities, prompts, outputs, request and response times, available provider statistics, vocabulary analytics, vocabulary quality results, quality triage verdicts and rationales, repair-candidate exchanges, pick outcomes, repair attempts, final text audit reports, and workflow-stage state needed to inspect how a run was produced. A provider-resolved model version SHALL be retained on the associated role and exchange when supplied. Workflow provenance SHALL be recorded at per-call granularity: each model call and each deterministic step is its own audit node with a stable structural identifier, stage membership, ordering, and an output summary, and each model-call node carries exactly one exchange (per the generation-audit-graph capability). When repair occurs, the initial generation exchange and each repair-candidate exchange SHALL remain inspectable in order, per-conversation pick decisions SHALL identify which version was selected and why, and final run analytics SHALL be calculated from the selected final audited conversations rather than from superseded text.

#### Scenario: Inspect a completed generation without repair
- **WHEN** an operator opens the audit information for a generated run that did not need repair
- **THEN** the system exposes the generator and judge identities, their role-specific exchanges, vocabulary analytics, vocabulary quality result, and triage verdicts

#### Scenario: Inspect a completed generation with repair
- **WHEN** an operator opens the audit information for a generated run that required repair
- **THEN** the system exposes the initial generation exchange, each generator-backed repair-candidate exchange, each judge-backed quality exchange, the per-conversation pick decisions, and the final vocabulary analytics used to save the run

#### Scenario: Inspect a completed generation with remaining vocabulary findings
- **WHEN** a generation completes with true out-of-allowed content remaining after the quality-control flow
- **THEN** the durable run exposes the original exchange, repair-candidate exchanges, selected final payload, remaining true out-of-allowed content findings, and pick outcomes needed to adjust the prompt

#### Scenario: Rerun a failed saved repair
- **WHEN** an operator inspects a saved workflow whose latest repair attempt failed or did not improve the audit
- **THEN** the affected repair node (or, for a legacy run, the synthesized node's attempts view) identifies the unresolved repair problem
- **AND** the operator can rerun repair when the run has no unfinished background work and the run retains the required prompt, conversation, and audit data
- **AND** a successful rerun appends the new repair nodes and exchanges, updates the selected final payload, refreshes analytics, and clears stale audio from changed conversations

#### Scenario: Inspect an in-progress workflow
- **WHEN** an asynchronous workflow is running
- **THEN** the system reports the pending, processing, completed, failed, or skipped state of each per-call workflow node as calls start and finish, not only at stage completion

### Requirement: Role-appropriate model preflight
Before accepting a new standard or workflow generation start, the Studio SHALL perform a disposable generator probe using the normal structured conversation-generation invocation path and a disposable judge probe using the normal structured quality-judgment invocation path. Each probe SHALL validate a minimal response for its role and SHALL persist no run, conversation, exchange, audit node, or background job. The Studio SHALL present per-role progress and results.

#### Scenario: Both role probes succeed
- **WHEN** the selected generator and judge each produce valid minimal responses through their role-specific invocation paths
- **THEN** the Studio enables the operator to start the requested generation

#### Scenario: Identical model selected for both roles
- **WHEN** an operator selects the same model as generator and judge
- **THEN** the Studio runs and reports both role-specific probes before enabling start

### Requirement: Durable generation entrypoints
Every Studio entrypoint that creates a generated run, including standard generation and library-complement generation, SHALL create a durable job-backed run shell before invoking a text provider. The shell SHALL retain the requested set, model, count, operation kind, status, and failure information until the run completes or the operator deletes it.

#### Scenario: Start standard generation
- **WHEN** the operator submits standard text generation
- **THEN** an in-progress run appears immediately and remains discoverable after browser refresh

#### Scenario: Start library-complement generation
- **WHEN** the operator submits a library-complement generation request
- **THEN** a durable run shell records the operation before the complementary text provider call begins

#### Scenario: Text generation fails before conversations exist
- **WHEN** a text provider fails before a run can contain conversations
- **THEN** the run shell remains visible with failure and retry information rather than disappearing

### Requirement: Balanced generation workflow
The studio SHALL support a workflow that assigns two thirds of the requested total, rounded up, to a primary batch and assigns the remainder to a complementary balancing batch. It SHALL calculate vocabulary-distribution needs between batches and optionally generate audio for a requested subset. Fixed audio mode SHALL accept zero through five audio targets, while maximum audio mode SHALL target the requested conversation total. After both text stages, the workflow SHALL compute the final text audit before any audio work: when no warning threshold trips, audio SHALL proceed automatically; when a warning threshold trips, the job SHALL pause for operator review with the audit report, and resuming SHALL proceed to audio. Dropped conversations SHALL reduce the combined run's conversation count rather than being backfilled across stages, and the audit SHALL report accepted versus requested totals. The workflow SHALL preserve a combined run, durable stage checkpoints, and stage-level audit record. It SHALL expose the run immediately, continue through browser refresh, and permit manual resume from the first incomplete stage after interruption.

#### Scenario: Generate with balancing
- **WHEN** an operator starts a workflow for a requested total conversation count
- **THEN** the system generates the primary and balancing portions through the quality-control flow, combines and renumbers their accepted conversations, and records distribution analytics

#### Scenario: Start workflow asynchronously
- **WHEN** an operator starts the background workflow
- **THEN** the system immediately persists and returns a trackable run job before the primary provider call and makes its evolving status available until completion, failure, or interruption

#### Scenario: Persist the primary checkpoint
- **WHEN** primary generation completes successfully
- **THEN** the system persists its exchange and normalized conversations before beginning balancing

#### Scenario: Resume after balancing was interrupted
- **WHEN** the primary checkpoint exists and the operator resumes an interruption in the balancing stage
- **THEN** the system reuses the primary checkpoint and does not repeat primary generation

#### Scenario: Clean audit proceeds to audio
- **WHEN** both text stages complete and the final text audit trips no warning threshold
- **THEN** the workflow proceeds to its audio stage automatically

#### Scenario: Audit warning pauses before audio
- **WHEN** the final text audit trips a warning threshold such as excessive shortfall
- **THEN** the job pauses before any audio work with a stage label directing the operator to the audit report
- **AND** resuming the job proceeds to audio while discarding cancels the workflow

#### Scenario: Report live workflow progress
- **WHEN** any per-call node in the generation, balance, final-audit, or audio stages changes state
- **THEN** the Studio updates the run stage, node states, and audio count through the shared realtime job channel

### Requirement: Conversation editing invalidates audio
The studio SHALL allow title, scene, context, and transcript edits on a non-curated conversation. A content edit SHALL remove the conversation's generated audio reference, return it to draft state, and require audio regeneration.

#### Scenario: Edit a draft or voiced conversation
- **WHEN** an operator saves content changes to a non-curated conversation
- **THEN** the system persists the text changes and clears any prior audio and audio error

#### Scenario: Edit a curated conversation
- **WHEN** an operator attempts to edit a conversation currently in the curated library
- **THEN** the system rejects the edit because the source is read-only while curated

### Requirement: Individual audio generation recovery
The studio SHALL allow audio to be generated or regenerated for an eligible individual conversation through the shared durable audio scheduler and SHALL persist queued, active, success, failure, or interruption state. A request for a conversation that already has queued or running audio SHALL attach to that work without another provider call. A failed or interrupted request SHALL retain an actionable error and allow a later retry.

#### Scenario: Audio generation succeeds
- **WHEN** the speech provider successfully generates audio for an eligible conversation
- **THEN** the system atomically stores the audio reference and marks the conversation audio-ready

#### Scenario: Audio generation fails
- **WHEN** the speech provider fails to generate audio
- **THEN** the system marks the conversation audio-failed, records the error, and publishes the updated run and job state

#### Scenario: Duplicate audio request
- **WHEN** audio is requested again for a conversation whose audio job is queued or running
- **THEN** the request returns the existing job and does not invoke the speech provider again

#### Scenario: Refresh during individual audio
- **WHEN** the browser refreshes while individual audio is active
- **THEN** generation continues on the server and the reloaded Studio recovers its live state

### Requirement: Batch audio generation recovery
The studio SHALL support replacing all run audio or resuming only missing audio through the shared durable audio scheduler. Resume mode SHALL preserve existing completed audio. Batch processing SHALL run at most three speech calls globally, persist each successful call as it completes, identify failures, and mark work not started after a stopping failure as skipped rather than falsely complete. Browser refresh SHALL not stop the batch, and an interrupted batch SHALL be manually resumable from persisted file readiness.

#### Scenario: Resume missing audio
- **WHEN** an operator resumes audio generation for a partially voiced run
- **THEN** the system targets only conversations without audio and retains existing audio

#### Scenario: Batch audio call fails
- **WHEN** an audio request fails during a batch configured to stop starting new work
- **THEN** the system preserves prior successes, records the failed conversation, skips unstarted targets in that batch, and reports a partial failure

#### Scenario: Refresh during batch audio
- **WHEN** the browser refreshes while a batch has running or queued audio
- **THEN** the server continues scheduling the batch and the Studio rehydrates its current counts and row statuses

#### Scenario: Resume an interrupted batch
- **WHEN** the operator resumes a batch interrupted by an API restart
- **THEN** the system reconciles persisted files and schedules only unresolved conversations

### Requirement: Run lifecycle management
The studio SHALL list, retrieve, reanalyze, and delete persisted runs. Reanalysis SHALL recompute vocabulary audits and analytics from current vocabulary rules without regenerating conversation text.

#### Scenario: Reanalyze a run
- **WHEN** an operator requests reanalysis of a saved run
- **THEN** the system refreshes its conversation audits and aggregate analytics while retaining its generated content

#### Scenario: Delete a run
- **WHEN** an operator deletes an eligible run
- **THEN** the system removes its persisted run data and associated generated audio

### Requirement: Studio set-scoped run selection
The Studio interface SHALL keep the operator-selected vocabulary set as the active generation context in Runs mode. When the selected set has generated runs, the Studio MAY select the newest matching run. When the selected set has no generated runs, the Studio SHALL keep that set selected and show the empty run state instead of switching to a different set's run.

#### Scenario: Selected set has generated runs
- **WHEN** an operator selects a set that has one or more generated runs
- **THEN** the Studio selects a run from that set
- **AND** keeps the sidebar set selector on that set

#### Scenario: Selected set has no generated runs
- **WHEN** an operator selects a set that has no generated runs
- **THEN** the Studio keeps the sidebar set selector on the selected set
- **AND** shows the empty run state for that set
- **AND** does not switch to another set because that set has a newer run

### Requirement: Natural current-set generation guidance
The studio SHALL instruct standard and complementary conversation-generation models to prioritize meaningful use of vocabulary from the selected current set while using earlier allowed sets as supporting language. The guidance SHALL treat the allowed vocabulary table as the hard boundary for Japanese content words except for a restrained number of model-selected proper nouns and cultural references that are explicitly declared in the response. If a natural line would require an unlisted content word that is neither allowed vocabulary nor a declared proper noun or cultural reference, the model SHALL choose simpler wording or a different scene instead of introducing that word. Common later-set N5 words SHALL remain forbidden until their set is reached unless they are functioning as a declared cultural reference rather than ordinary vocabulary. The guidance SHALL encourage limited, natural use of common Japanese cultural references for immersion, while making clear that they do not count toward vocabulary coverage. The guidance SHALL favor coherent beginner conversations, natural repetition, and varied situations over forcing priority words into unsuitable dialogue, while retaining aggregate vocabulary coverage as a batch objective. When an AI-balanced complementary prompt is prepared, the studio SHALL additionally supply the existing curated library's conversation content and per-word exposure so the model can author conversations that improve coverage of absent and underexposed current-set words while avoiding redundancy with existing scenes and over-repetition, treating the deterministic plan and exposure as authoritative inputs it does not recalculate.

#### Scenario: Generate a standard batch
- **WHEN** the studio prepares a standard or primary generation prompt for a selected set
- **THEN** the prompt identifies current-set vocabulary as the primary learning focus and instructs the model to use it naturally and meaningfully rather than maximizing isolated mentions
- **AND** instructs the model not to introduce Japanese content words outside the allowed vocabulary table
- **AND** permits the model to choose and declare a restrained number of common Japanese proper nouns or cultural references for immersion without counting them as vocabulary coverage

#### Scenario: Generate a complementary batch
- **WHEN** the studio prepares a complementary prompt from zero-coverage and underexposed vocabulary
- **THEN** the prompt supplies those priorities but permits the model to omit or redistribute a word when including it would produce an unnatural conversation
- **AND** instructs the model to choose a different line or scene rather than use unlisted Japanese content words
- **AND** permits declared cultural references only when they fit the scene naturally

#### Scenario: Generate an AI-balanced complementary batch
- **WHEN** the studio prepares an AI-balanced complementary prompt for a set
- **THEN** the prompt supplies the deterministic zero-coverage and underexposed priorities together with the existing library conversations' learning content and per-word exposure, and instructs the model to author new conversations that fill those gaps while diversifying scenes away from existing ones and repeating focal words only where natural
- **AND** treats later-set vocabulary as unavailable even when it would be common or convenient

#### Scenario: Reuse earlier vocabulary
- **WHEN** a generated conversation needs supporting language from an earlier allowed set
- **THEN** the prompt permits that vocabulary without treating it as equivalent to meaningful current-set exposure

#### Scenario: Natural wording would need unavailable vocabulary
- **WHEN** a conversation idea would require a Japanese content word outside the allowed vocabulary table
- **THEN** the prompt instructs the model to use the word only if it is functioning as a proper noun or cultural reference and is declared in the response metadata
- **AND** otherwise simplify the wording or choose a different everyday situation

#### Scenario: Use model-selected cultural references
- **WHEN** the studio prepares a generation prompt
- **THEN** the prompt may encourage restrained model-selected use of common Japanese cultural references such as places, cities, landmarks, or foods
- **AND** requires the response to declare each such reference with a category and short rationale
- **AND** states that those references are audit exemptions rather than learned vocabulary coverage

### Requirement: Deterministic conversation curation evidence
The studio SHALL calculate authoritative per-conversation curation evidence from the conversation text, vocabulary source, shared language policy, reviewed morphology policy, and generated metadata. The evidence SHALL report unique current-set vocabulary, unique cumulative allowed vocabulary, true out-of-allowed content words and occurrences, and any non-vocabulary exemptions that explain why a token was not counted as true OOV. Unique vocabulary SHALL be deduplicated by canonical Japanese spelling. Out-of-vocabulary evidence SHALL exclude shared prompt-permitted grammar and function expressions, valid conjugations, reviewed lexical allomorphs, reviewed compositional morphology, tokenizer-recognized proper nouns and fillers, invalid non-lexical tokenizer fragments, approved generated names, validated approved-name surfaces with honorific suffixes, and declared proper nouns or cultural references that pass audit guardrails. Model-declared proper nouns and cultural references SHALL be treated as helper metadata only and MUST NOT count as vocabulary coverage. After each final audit produced by generation, quality repair, editing, or reanalysis, the studio SHALL enrich true OOV terms from deterministic vocabulary sources and persist complete future-set or external conversation references; generation-model self-reporting MUST NOT replace this enrichment.

#### Scenario: Inspect an analyzed conversation
- **WHEN** an operator reviews a generated, recommended, or curated conversation
- **THEN** the studio exposes its current-set unique count and words, cumulative allowed unique count and words, true out-of-allowed content evidence, validated exemption evidence, and resolved learner-facing references

#### Scenario: Distinguish current and earlier sets
- **WHEN** a Set 2 conversation uses words from Sets 1 and 2
- **THEN** its current-set evidence counts only unique Set 2 spellings while its cumulative evidence counts unique allowed spellings from both sets

#### Scenario: Audit permitted language
- **WHEN** a conversation contains a permitted grammar expression, valid conjugation, reviewed equivalent or composition, filler, or approved proper name that is not a literal vocabulary-table entry
- **THEN** the system does not count that permitted content as true out-of-allowed content

#### Scenario: Reject non-lexical tokenizer output
- **WHEN** tokenization produces punctuation-like debris from otherwise permitted filler text
- **THEN** the system excludes it from true OOV evidence and aggregate totals

#### Scenario: Audit a productive vocabulary pattern
- **WHEN** an allowed vocabulary entry contains a `～` prefix or suffix marker and a conversation uses a matching compound in one or multiple tokenizer tokens
- **THEN** the system credits the pattern entry and does not count the matching compound as true out-of-allowed content

#### Scenario: Audit an approved name split by the tokenizer
- **WHEN** an approved name surface spans multiple tokenizer tokens
- **THEN** the system exempts the complete name span and does not report its token fragments as true out-of-allowed content

#### Scenario: Audit approved name with honorific suffix
- **WHEN** a conversation contains an approved generated name with a permitted honorific suffix such as `さん`
- **THEN** the system treats that surface as an approved-name exemption rather than true out-of-allowed content

#### Scenario: Audit declared cultural reference
- **WHEN** a conversation contains a declared cultural proper noun or cultural reference outside the vocabulary table
- **THEN** the system treats that surface as a cultural-reference exemption rather than true out-of-allowed content when it appears in the conversation and passes audit guardrails
- **AND** does not count it as current-set or cumulative vocabulary coverage

#### Scenario: Validate model-declared proper nouns
- **WHEN** a generation response declares a proper noun or cultural reference that appears in the conversation and fits an allowed declaration category
- **THEN** the system may record it as a validated exemption
- **AND** excludes it from true out-of-allowed content analytics

#### Scenario: Reject invalid proper-noun declarations
- **WHEN** a generation response declares an ordinary content word as a proper noun or cultural reference but the audit guardrails reject that declaration
- **THEN** the system counts the word according to deterministic audit rules and does not let the declaration suppress true out-of-allowed content evidence

#### Scenario: Enrich after final audit
- **WHEN** generation, quality repair, editing, or reanalysis produces a final true OOV list
- **THEN** the studio resolves and persists future-set and external references from deterministic vocabulary sources after the transcript is final

#### Scenario: Refresh evidence after content or policy changes
- **WHEN** a conversation is edited or an operator reanalyzes a saved run or curated set
- **THEN** the studio recalculates curation evidence and vocabulary references using the current vocabulary, shared language policy, reviewed morphology policy, validated metadata, and reviewed supplemental catalog

#### Scenario: Supply evidence to a model
- **WHEN** deterministic evidence is included in a generation audit, repair request, or AI curation request
- **THEN** server-calculated values remain authoritative and model-returned counts cannot replace them
