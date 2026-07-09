## Context

Generation currently relies on prompt instructions plus a deterministic audit after the model returns. The audit is authoritative, but a run is saved even when the audit finds many out-of-allowed content words. In the recent Set 3 runs, both models covered every current-set word while introducing 26-29 unique out-of-allowed words, mostly later-set N5 vocabulary that felt natural in school scenes.

The existing vocabulary audit already separates allowed vocabulary, prompt-permitted grammar/function words, tokenizer-recognized proper nouns, and approved generated names. It does not yet handle some realistic approved-name surfaces such as `けんさん`, and generation responses do not preserve model-declared proper nouns for validation. The current policy also has no explicit way to allow high-value model-selected cultural references, such as well-known Japanese places, cities, landmarks, or foods, when they are outside the staged vocabulary table.

## Goals / Non-Goals

**Goals:**

- Make Set 2+ generated runs stay as close as practical to allowed content vocabulary, targeting zero true out-of-allowed content words after deterministic exemptions without blocking otherwise usable batches.
- Encourage limited, model-selected use of common Japanese cultural proper nouns and cultural references so learners encounter cultural context without polluting OOV metrics.
- Keep deterministic audit evidence authoritative; model-declared metadata may help classification but cannot override server rules.
- Repair otherwise usable generated conversations instead of throwing away full batches when only a few lines violate vocabulary limits.
- Preserve generation provenance so operators can see original output, repair attempts, final output, and remaining audit findings.
- Improve terminology so "new words" does not hide whether a finding is a true OOV content word, an approved name, or an audit exemption.

**Non-Goals:**

- Reorder the N5 vocabulary sets or add bridge words to Set 3 as part of this change.
- Treat arbitrary undeclared Japanese place, brand, food, or culture words as exempt from audit.
- Guarantee semantic perfection of generated Japanese beyond the existing beginner-friendly and audit constraints.
- Change the learner app's practice flow.
- Trust model-reported proper nouns without deterministic validation.

## Decisions

1. Treat the allowed vocabulary table as a hard content-word boundary in prompts.

   The prompt should remove the current "unless necessary to keep a sentence natural" escape hatch and instead instruct the model to choose a simpler line or scene when a natural sentence would require unlisted content. It should explicitly say common later-set N5 words are still forbidden until their set is reached.

   Alternative considered: add a broad bridge-word allowlist. That would lower the metric quickly, but it weakens the staged syllabus and makes "allowed vocabulary" less transparent.

2. Add vocabulary quality classification after each audit.

   The audit result should classify findings into true out-of-allowed content, validated person-name exemptions, model-declared cultural-reference exemptions, prompt-policy exemptions, and likely tokenizer artifacts when the server can prove the exemption. Approved names with honorific suffixes such as `けんさん` should be exempted deterministically. Model-declared cultural references should be recorded separately and excluded from true OOV metrics when they appear verbatim in the conversation, use an allowed category, and are not clearly ordinary grammar or vocabulary leakage.

   Alternative considered: ask the model to classify all OOV words. This is useful as metadata, but it is not reliable enough to drive analytics by itself.

3. Add one best-effort repair attempt before a generated batch is persisted.

   After normalization and audit, generation entrypoints should run one repair pass when true content OOV remains. The repair prompt should include only the offending conversations, the offending lines, the true OOV list, the allowed vocabulary context, and the unchanged JSON shape. After repair, the server re-normalizes and re-audits. If the repair improves the audit, persist the repaired batch; if it does not improve or the repair call fails, persist the original audited batch and surface remaining OOV as quality findings rather than a generation failure.

   Alternative considered: fail immediately on OOV. That keeps quality high but wastes otherwise good generated content and makes one-line leaks expensive.

4. Preserve generation provenance for original and repaired text.

   The existing `llmExchanges` structure can store the initial generation and subsequent repair exchanges in order. Workflow checkpoints should persist the repaired batch and exchange history for each stage so resume does not repeat completed repair work.

   Alternative considered: overwrite the original exchange. That makes debugging prompt failures harder and hides why a run needed repair.

5. Accept optional model-declared proper nouns as helper metadata.

   The generation schema can add optional metadata per conversation or line for proper nouns and cultural references. Normalization should preserve it in a typed field, and the audit should only exempt a declaration if it appears in the Japanese text and fits a bounded category such as person, place, city, region, landmark, institution, event, work/title, brand, or food/cultural item. Invalid declarations should remain visible as true OOV.

   Alternative considered: skip proper-noun metadata and rely only on Kuromoji. The recent `けんさん` and `けんたさん` examples show tokenizer behavior is inconsistent for kana names.

6. Use category-bounded model-selected cultural references instead of a fixed allowlist.

   The prompt should not present a fixed menu of cultural terms. Instead, it should allow the model to choose a small number of very common Japanese cultural references when natural, require each one to be declared with category and short rationale, and forbid using this mechanism for ordinary adjectives, verbs, adverbs, classroom glue, or later-set vocabulary that is not functioning as a proper noun or cultural reference. Declared references should never count as learned vocabulary coverage.

   Alternative considered: maintain a curated allowlist. That makes validation easier, but it prevents the generation model from choosing culturally appropriate references for a scene and turns immersion into another static vocabulary list.

## Risks / Trade-offs

- More provider calls and slower generation -> Cap repair attempts and repair only offending conversations instead of the whole batch.
- Repair may reduce current-set coverage while removing OOV -> Re-audit coverage after repair and include current-set missing/coverage in the final analytics; future balancing can address coverage gaps.
- A best-effort Set 2+ OOV target may still save imperfect batches -> Keep the remaining findings prominent in analytics and provenance, and use prompt/repair iteration to drive the rate toward zero over time.
- Model-declared proper nouns or cultural references could be abused to hide vocabulary leaks -> Require explicit declarations, bounded categories, verbatim text matches, separate evidence, and repair for ordinary content words mislabeled as cultural references.
- Cultural references could grow into a hidden second vocabulary syllabus -> Keep usage restrained, separately categorized, excluded from coverage credit, and visible in Studio evidence.
- Existing runs may show different OOV counts after reanalysis -> Treat this as expected policy evolution and keep original generation provenance intact.

## Migration Plan

- Existing runs remain readable with missing proper-noun or cultural-reference metadata defaulting to an empty list.
- Reanalysis applies the new audit rules and may lower counts for approved-name artifacts such as `けんさん`.
- Curated and published content formats remain backward-compatible; optional metadata can be omitted when building learner-facing library output if it is not needed there.
- Rollback can disable repair attempts by configuration while leaving prompt and audit improvements in place.

## Open Questions

- Should Set 1 use the same best-effort repair trigger later, or should the tiny earliest vocabulary base keep a looser quality target?
- Should tokenizer-artifact classification be displayed separately in the Studio, or only excluded when the server can deterministically prove the intended approved form?
- What maximum number of declared cultural references should be allowed per conversation or batch before the repair loop asks the model to simplify?
