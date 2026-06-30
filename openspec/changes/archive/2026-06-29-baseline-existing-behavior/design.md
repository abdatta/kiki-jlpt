## Context

JLPT Listener is an established brownfield application with two product surfaces: a studio that creates and curates practice material, and a static learner application that consumes published material and stores learning progress locally. OpenSpec was initialized after these behaviors existed, and there are no main specs to serve as a baseline.

The baseline is derived from the current UI flows, shared domain types, Express API behavior, persistence modules, curated content pipeline, and existing tests. Because the change spans both surfaces and the content lifecycle between them, a design record is useful even though no runtime implementation is planned.

## Goals / Non-Goals

**Goals:**

- Establish an auditable, testable specification of current observable behavior.
- Divide the product into stable capability boundaries that can receive future deltas.
- Capture important defaults, gates, failure states, and recovery behavior.
- Seed main specs through the normal OpenSpec change lifecycle.

**Non-Goals:**

- Change, refactor, or fix application behavior.
- Specify component structure, route names, file locations, visual styling, or other incidental implementation details.
- Claim that existing behavior is ideal; future corrections remain separate changes.
- Exhaustively specify internal helper algorithms when their details are not part of the observable contract.

## Decisions

### Use one auditable baseline change

The initial specs will be represented as `ADDED` requirements in a single `baseline-existing-behavior` change and later synced or archived into the main specs. This preserves provenance and uses the same lifecycle expected for future work.

Directly writing main specs was considered, but rejected because it would bypass the proposal, validation, review, and archive trail.

### Organize specs by product capability

The baseline uses five capability specs: vocabulary practice, listening practice, learning progression, content generation, and curated library. These boundaries follow user and operator responsibilities and remain useful even if modules or APIs are reorganized.

Splitting specs by frontend page, server module, or endpoint was considered, but rejected because those boundaries would couple requirements to the current implementation.

### Treat observable current behavior as the source for normative language

Existing behavior is translated into SHALL/MUST requirements only when it is supported by code or persisted data contracts. Important constants such as the default listening and level gates are captured because users experience them as product rules. Internal mechanics are described only where they materially affect results, ordering, recovery, or data integrity.

### Keep cross-capability responsibilities explicit

The learner's interaction behavior belongs to vocabulary or listening practice, while durable access and completion rules belong to learning progression. Studio generation owns draft runs and audio state; curated library owns approved copies and published manifests. References between specs are preferable to duplicating the same rule in multiple capabilities.

## Risks / Trade-offs

- **Existing defects may be mistaken for intended behavior** → Limit requirements to stable, observable contracts and correct questionable behavior through a later explicit change.
- **The codebase has sparse automated coverage for some workflows** → Validate the specs against both code paths and focused manual application checks before archiving.
- **Cross-capability rules can drift or be duplicated** → Assign each rule one primary capability and use scenarios in adjacent capabilities only for integration outcomes.
- **Exact product defaults may later become configurable** → State current defaults and supported configuration behavior without binding the specs to environment-variable names.

## Migration Plan

1. Review each delta spec against the current learner and studio behavior.
2. Run OpenSpec validation and the existing unit/build checks.
3. Perform focused manual checks for external generation, audio recovery, and publication where credentials and services are available.
4. Sync or archive the change to populate `openspec/specs/`.
5. Use future OpenSpec changes for all intentional requirement additions, modifications, and removals.

No runtime deployment, data migration, or rollback is required. If a baseline statement is found to be inaccurate before archive, correct the delta spec; after archive, correct it through a new change.

## Open Questions

There are no blocking design questions. Manual verification may identify behaviors that should be clarified before the baseline is archived.
