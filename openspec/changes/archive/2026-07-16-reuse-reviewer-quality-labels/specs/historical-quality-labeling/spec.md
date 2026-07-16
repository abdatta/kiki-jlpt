## REMOVED Requirements

### Requirement: Non-destructive historical quality labeling
**Reason**: Past runs and curated content have been labeled, so Studio no longer needs a routine operator-facing mutation path for historical quality metadata.

**Migration**: Existing labels and review provenance remain readable. Exceptional maintenance may use the command-line backfill helper.

### Requirement: Label-only historical processing
**Reason**: The dedicated Studio historical-label operation is removed with its controls and API.

**Migration**: Existing conversation content and labels are unchanged.

### Requirement: Scoped and repeat-safe historical coverage
**Reason**: Curated-library, saved-run, and rejudge scopes are no longer exposed as Studio operations.

**Migration**: No data migration is required because completed labels remain persisted.

### Requirement: Historical-label provenance and failures
**Reason**: There is no longer a durable Studio historical-label job whose progress or failures must be presented.

**Migration**: Stored per-conversation review provenance remains inspectable.
