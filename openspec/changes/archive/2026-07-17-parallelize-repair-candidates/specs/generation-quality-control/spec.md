## MODIFIED Requirements

### Requirement: Scoped balanced repair with independent candidates
The studio SHALL send only conversations marked `repair` to the selected generator model for repair; conversations with `pass` verdicts MUST NOT be resubmitted or altered by repair. The repair objective SHALL jointly cover naturalness, realism, target JLPT level fit, removal of true out-of-allowed words, natural preservation of current-set vocabulary, and listening suitability. The studio SHALL obtain two repair candidates per repair round through independent generator-provider calls using the same balanced objective, and MUST NOT request differently specialized candidates from a single call. The two candidate calls SHALL be dispatched concurrently rather than serially, and each call's outcome SHALL be resolved independently so that neither the success nor the failure of one candidate depends on or blocks the other. The completion order of the two concurrent calls MUST NOT affect the recorded candidate pool, the selected version, or the mapping of persisted exchanges to their candidate slots. Repair SHALL run at most one round per conversation per stage.

#### Scenario: Only flagged conversations are repaired
- **WHEN** a batch contains both passing and repair-marked conversations
- **THEN** the repair request contains only the repair-marked conversations with their findings
- **AND** passing conversations are carried through unchanged

#### Scenario: Two independent candidates produced
- **WHEN** repair runs for a set of flagged conversations
- **THEN** two independent calls through the selected generator each return a full candidate version of every flagged conversation

#### Scenario: Candidates are dispatched concurrently
- **WHEN** repair runs for a set of flagged conversations
- **THEN** the second candidate's generator call is in flight before the first candidate's call has completed, rather than starting only after the first returns

#### Scenario: Completion order does not affect the outcome
- **WHEN** the two concurrent candidate calls complete in either order
- **THEN** the candidate pool offered to the dominance gates, the version ultimately selected, and each exchange's recorded candidate slot are identical regardless of which call finished first

#### Scenario: One repair call fails
- **WHEN** one of the two concurrent generator repair calls fails or returns unusable conversations
- **THEN** picking proceeds with the surviving candidate pool regardless of which candidate failed
- **AND** the failed exchange is recorded in provenance

#### Scenario: Both repair calls fail
- **WHEN** both concurrent generator repair calls fail
- **THEN** the original conversations are retained with their findings recorded, and generation does not fail
