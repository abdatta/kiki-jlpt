## 1. Verify Requirement Traceability

- [x] 1.1 Trace the vocabulary-practice, listening-practice, and learning-progression requirements to the current learner UI, ordering, scheduling, migration, and browser-storage behavior; correct any unsupported statement.
- [x] 1.2 Trace the content-generation requirements to request validation, provider exchange, workflow, editing, audio recovery, audit, and run-storage behavior; correct any unsupported statement.
- [x] 1.3 Trace the curated-library requirements to curation, source locking, analysis, recommendation, balancing, and publication behavior; correct any unsupported statement.

## 2. Verify Existing Behavior

- [x] 2.1 Run the unit and primary application build checks with `npm test` and resolve any baseline-spec discrepancy they expose without changing runtime behavior in this change.
- [x] 2.2 Run the learner production build with `npm run build:practice` and verify the generated static library remains publishable with `npm run library:check-published`.
- [x] 2.3 Smoke-test the learner flows for vocabulary review, listening unlock, sequential conversation completion, replay, starring, and persisted progress.
- [x] 2.4 Smoke-test the studio flows for run inspection, conversation editing, audio state, curation, library analysis, and publication; verify external generation failure and recovery where configured credentials permit.

## 3. Finalize the Baseline

- [x] 3.1 Reconcile all verification findings in the five delta specs while keeping implementation details and proposed future behavior out of the baseline.
- [x] 3.2 Run strict OpenSpec validation for the change and confirm all proposal capabilities have exactly one corresponding delta spec.
