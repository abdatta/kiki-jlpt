## MODIFIED Requirements

### Requirement: Uniform final dialogue-quality labels
Every selected conversation saved by a new generation SHALL receive its final `good`, `okay`, or `bad` label from the same versioned dialogue-only rubric and prompt used by historical rejudgment. This final label SHALL be judged after repair and version selection, SHALL use the selected judge model, and SHALL not be derived from operational repair routing, deterministic vocabulary evidence, listening questions, answer keys, translations, generator identity, or an earlier label. Operational triage and deterministic evidence MAY still route content through repair without determining the final label.

#### Scenario: Final label after repair
- **WHEN** generation triage routes a conversation through repair and a final version is selected
- **THEN** the selected delivered dialogue is judged with the shared final-label prompt
- **AND** its final label is directly mapped from that judgment rather than inherited from the triage or picker decision

#### Scenario: Comparable historical and new labels
- **WHEN** identical delivered dialogue is judged historically or at the end of a new generation with the same judge model and rubric version
- **THEN** both paths submit the same final-label prompt payload and apply the same label mapping

### Requirement: Evidence-grounded quality triage
After a generated batch is deterministically audited, the studio SHALL obtain a quality verdict for every conversation in the batch: `pass`, `repair`, or `regenerate`. Verdicts SHALL be produced by the run's selected quality-judge model through a quality-review call that receives each conversation together with its authoritative deterministic vocabulary evidence, and model output MUST NOT override deterministic lexical facts. The `regenerate` verdict SHALL be reserved for structural defects (unrealistic scenario, vocabulary-list feel, forced unrelated word groupings, severe topic jumps, clearly above-level grammar); a conversation MUST NOT be marked `regenerate` for vocabulary findings alone. Repair eligibility SHALL be the union of deterministic vocabulary findings (per the existing set-level threshold) and repairable triage findings. When the curated library for the set is non-empty, the triage request SHALL include curated exemplar conversations as the calibration reference for naturalness. Each verdict SHALL carry a rationale that is persisted in generation provenance.

#### Scenario: Clean conversation passes
- **WHEN** a generated conversation has no true out-of-allowed vocabulary findings and the selected judge finds it natural, coherent, and level-appropriate
- **THEN** the conversation is accepted without repair and labeled `good`

#### Scenario: Fixable issues route to repair
- **WHEN** a conversation has true out-of-allowed vocabulary findings, repairable naturalness issues, or both
- **THEN** the conversation is marked `repair` and enters the repair-and-pick flow with its audit findings and triage rationale attached

#### Scenario: Structurally flawed conversation routes to regenerate
- **WHEN** the selected judge finds a conversation structurally unusable
- **THEN** the conversation is marked `regenerate` with a rationale and does not enter the repair flow

#### Scenario: Vocabulary facts remain authoritative
- **WHEN** the quality-review response asserts vocabulary usage that contradicts the deterministic audit
- **THEN** the deterministic evidence prevails and the model assertion is ignored

#### Scenario: Quality review call fails
- **WHEN** the selected judge call fails or returns an unusable response
- **THEN** the stage falls back to deterministic-only behavior, treating conversations with vocabulary findings as `repair` and all others as `pass`
- **AND** the failure is recorded in generation provenance and surfaced in the final text audit

### Requirement: Scoped balanced repair with independent candidates
The studio SHALL send only conversations marked `repair` to the selected generator model for repair; conversations with `pass` verdicts MUST NOT be resubmitted or altered by repair. The repair objective SHALL jointly cover naturalness, realism, target JLPT level fit, removal of true out-of-allowed words, natural preservation of current-set vocabulary, and listening suitability. The studio SHALL obtain two repair candidates per repair round through independent generator-provider calls using the same balanced objective, and MUST NOT request differently specialized candidates from a single call. Repair SHALL run at most one round per conversation per stage.

#### Scenario: Only flagged conversations are repaired
- **WHEN** a batch contains both passing and repair-marked conversations
- **THEN** the repair request contains only the repair-marked conversations with their findings
- **AND** passing conversations are carried through unchanged

#### Scenario: Two independent candidates produced
- **WHEN** repair runs for a set of flagged conversations
- **THEN** two independent calls through the selected generator each return a full candidate version of every flagged conversation

#### Scenario: One repair call fails
- **WHEN** one of the two generator repair calls fails or returns unusable conversations
- **THEN** picking proceeds with the surviving candidate pool
- **AND** the failed exchange is recorded in provenance

#### Scenario: Both repair calls fail
- **WHEN** both generator repair calls fail
- **THEN** the original conversations are retained with their findings recorded, and generation does not fail

### Requirement: Dominance-gated forced pick
For each repaired conversation the studio SHALL select exactly one version from the original and the available repair candidates. Selection SHALL apply deterministic gates first: every candidate is re-audited, a candidate with more true out-of-allowed findings than the best available version MUST NOT be selected, and a candidate that drops previously used current-set vocabulary SHALL be flagged `coverage_loss`. When deterministic gates leave more than one admissible version, the selected quality-judge model SHALL pick the most natural level-appropriate version and attach a selected quality of `good` or `okay`, a confidence level, and flags. The pick SHALL be forced: the picker MUST NOT reject all versions, request another repair round, or mark a conversation for regeneration.

#### Scenario: Deterministic gate decides alone
- **WHEN** re-auditing leaves exactly one version with strictly fewer true out-of-allowed findings than all others
- **THEN** that version is selected without a model tie-break

#### Scenario: Model tie-break among admissible versions
- **WHEN** deterministic gates leave multiple admissible versions for a conversation
- **THEN** the selected judge picks one based on naturalness and level fit and records its selected quality, confidence, and flags

#### Scenario: Repair candidate loses coverage
- **WHEN** the selected version no longer uses a current-set word the original used
- **THEN** the conversation is flagged `coverage_loss` and the lost words are reflected in the final text audit

#### Scenario: Picker call fails
- **WHEN** the selected judge pick call fails or returns an unusable response
- **THEN** the deterministically best-audited version is selected, preferring the original on ties
- **AND** the failure is recorded in provenance

### Requirement: Bounded regeneration with reported shortfall
Conversations marked `regenerate` SHALL be dropped from their stage batch. After triage of a stage batch, the studio SHALL perform at most one re-roll generation call through the selected generator requesting replacements for the dropped count using the stage's normal objective; re-rolled conversations SHALL flow through the same audit, judge triage, generator repair, and judge pick sequence, except that a re-rolled conversation marked `regenerate` SHALL be dropped without another re-roll. Dropped initial-stage slots MUST NOT be transferred to the balance stage, and the studio MUST NOT accept a conversation with a known `regenerate` verdict to satisfy the requested count. A run whose accepted count is below the requested count SHALL complete with the shortfall reported rather than fail.

#### Scenario: Initial-stage drop and re-roll
- **WHEN** the initial batch triage marks conversations `regenerate`
- **THEN** those conversations are dropped, one generator re-roll call requests that many replacements, and usable replacements join the batch through the standard quality flow

#### Scenario: Re-rolled conversation fails again
- **WHEN** a re-rolled conversation is marked `regenerate`
- **THEN** it is dropped for good and no further regeneration occurs for that slot

#### Scenario: Run completes short
- **WHEN** drops leave the accepted total below the requested total
- **THEN** the run persists with the accepted conversations and the final text audit reports accepted versus requested counts and drop reasons

#### Scenario: Re-roll call fails
- **WHEN** the selected generator re-roll call fails
- **THEN** the stage proceeds with its accepted conversations and the shortfall is reported
