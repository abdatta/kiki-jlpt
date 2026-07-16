## REMOVED Requirements

### Requirement: Durable historical quality-label jobs
**Reason**: The operator-facing historical label/relabel workflow is retired after completing the backfill.

**Migration**: Existing persisted labels remain; no replacement job kind is introduced.

### Requirement: Serialized historical judge work
**Reason**: Without a Studio historical-label job, the generation queue no longer needs to schedule this work.

**Migration**: Normal generation serialization is unchanged.
