## Why

OpenSpec was added after the application was already functional, so there is no checked-in specification of the behavior that future changes must preserve. A one-time baseline is needed to make the current product behavior explicit before subsequent work is managed as spec deltas.

## What Changes

- Document the existing learner vocabulary and listening-practice behavior.
- Document current level progression and browser-local learning progress.
- Document the studio's conversation, balancing, audio, and audit workflows.
- Document curation, coverage analysis, and static-library publication behavior.
- Establish these documents as a behavioral baseline only; this change does not intentionally alter runtime behavior, APIs, or persisted data.

## Capabilities

### New Capabilities

- `vocabulary-practice`: Vocabulary review sessions, answer assessment, scheduling, and vocabulary statistics in the learner application.
- `listening-practice`: Conversation discovery, audio playback, comprehension review, translations, retrying, and starring in the learner application.
- `learning-progression`: Persistent learning state, level access, listening unlocks, completion, and mastery indicators.
- `content-generation`: Studio run creation, model-driven conversation generation, vocabulary balancing, audio generation, editing, auditability, and run lifecycle management.
- `curated-library`: Curating generated conversations, analyzing library coverage, recommending or generating complements, and publishing the static practice library.

### Modified Capabilities

None. No main specifications currently exist.

## Impact

The change adds OpenSpec planning and baseline specification artifacts and enriches `openspec/config.yaml` with project context. It documents behavior implemented across the learner UI, studio UI, Express API, browser storage, run storage, curated content, and published library pipeline. No production code, API contract, dependency, or stored-data change is intended.
