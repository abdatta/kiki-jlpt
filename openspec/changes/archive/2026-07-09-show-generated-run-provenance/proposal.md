## Why

Studio lists such as Library, deterministic Queue, and AI curation can mix conversations that originated from several generated runs. Operators need to see which generated run each mixed-list conversation came from, and whether a portfolio is dominated by one run, without opening every item individually.

## What Changes

- Show compact, clickable generated-run provenance on conversations when they are displayed outside their own generated run.
- Use the same relative timestamp format as generated run titles, such as `Today, 00:28`, `Yesterday, 17:57`, or `Jul 2, 12:44`.
- Add a collapsible source-run distribution view for mixed conversation lists, showing each contributing generated run's conversation count and share.
- Keep the distribution hidden by default and reveal it from an explicit control.
- Do not change curation, recommendation ranking, audio generation, or published learner-library formats.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `curated-library`: Studio review surfaces expose source generated-run provenance and contribution distribution for mixed curated and recommendation lists.

## Impact

- Affects the Studio UI for Library, deterministic Queue, and AI curation recommendation views.
- Reuses existing source identifiers on curated and recommended conversations; no storage or API format change is expected.
- No new dependencies.
- No impact to the static learner application or published library manifest.
