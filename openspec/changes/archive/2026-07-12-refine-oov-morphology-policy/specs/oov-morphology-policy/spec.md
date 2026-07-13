## ADDED Requirements

### Requirement: Reviewed allowed-form equivalence
The deterministic audit SHALL treat only reviewed lexical allomorphs and inflections as the same curriculum vocabulary entry. It MUST credit the allowed canonical word and MUST NOT create OOV evidence for an accepted equivalent form.

#### Scenario: Audit the good allomorph
- **WHEN** `いい` is allowed and a conversation uses `よい` or an inflection whose tokenizer basic form is `よい`
- **THEN** the audit credits `いい` and does not report `よい` as OOV

#### Scenario: Preserve a distinct derived word
- **WHEN** a surface shares a stem with an allowed word but has a distinct lexical meaning or part of speech, such as noun `話` versus verb `話す`
- **THEN** the audit does not infer equivalence without a reviewed rule

### Requirement: Reviewed compositional morphology
The audit SHALL permit reviewed grammatical composition around allowed vocabulary while matching the complete surface span. Initial reviewed compositions SHALL include polite kinship `お + allowed kinship term + さん` and adverbial `に` on allowed `本当`.

#### Scenario: Audit a polite kinship expression
- **WHEN** `兄` or `姉` is allowed and the transcript uses `お兄さん` or `お姉さん`
- **THEN** the audit credits the allowed base kinship word and does not report tokenizer fragments or the polite expression as OOV

#### Scenario: Audit an allowed adverbial form
- **WHEN** `本当` is allowed and the transcript uses `本当に`
- **THEN** the audit credits `本当` and does not report `本当に` as OOV

### Requirement: Non-lexical audit rejection
The audit SHALL reject punctuation-like and malformed tokenizer candidates before counting true OOV occurrences.

#### Scenario: Audit a drawn-out filler
- **WHEN** a filler such as `んー` yields a standalone prolonged-sound mark token
- **THEN** the audit does not add that mark to OOV words, occurrences, references, or aggregate totals

### Requirement: Reviewed future-entry aliases
The reference resolver SHALL map reviewed surface variants to their complete master-vocabulary entries without making those entries available before their assigned set.

#### Scenario: Resolve an adverb variant to a future set
- **WHEN** a below-Set-6 conversation contains audited `すぐ` and the master entry is Set 6 `すぐに`
- **THEN** the system records a Set 6 future reference for `すぐに`

#### Scenario: Resolve an adverb particle variant
- **WHEN** a below-Set-8 conversation contains audited `ゆっくり` and the master entry is Set 8 `ゆっくりと`
- **THEN** the system records a Set 8 future reference for `ゆっくりと`
