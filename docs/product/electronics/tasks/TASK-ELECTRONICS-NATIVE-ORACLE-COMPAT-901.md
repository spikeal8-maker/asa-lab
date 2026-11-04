---
task_id: TASK-ELECTRONICS-NATIVE-ORACLE-COMPAT-901
kind: maintenance
risk: low
semantic_change: no
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Preserve native contracts in E11 and F2 qualification

Issue901 is a bounded test-only dependency of the owner-requested issue836
full browser qualification. Exact7d6a0ee7 run41322585807 completed196 tests:
146PASS/50FAIL before cancellation. It is not full acceptance.

Eight stopped E11 fit/zoom cases dereference a descendant of the existing
switch selection rect; the selection primitive itself has no such descendant.
Both F2 cases observe a trusted Save event but expect obsolete title metadata.
These are separate from actual outline pixels, wire interception and clock
failures. Do not classify or waive those remaining failures through this repair.

## Selected scope

- `e2e/electronics-selection-outline.spec.ts`: explicitly handle a selection
  primitive itself or its genuine wrapper. Preserve all geometry, pixel,
  transform, native-input, persistence and whole-case assertions.
- `e2e/electronics-interactions.spec.ts`: record and assert the existing stable
  native Save button identity instead of obsolete title metadata. Preserve
  trusted input, pointer type, event counts, full-document CAS and reopen.
- Add narrow adversarial source/DOM contract checks under `tests/electronics/`
  if needed to reject unrelated nodes and incorrect Save targets.

No production, workflow, package, lockfile, timeouts, retries, suite filters,
canonical thresholds, protected assets, server, database or foreign WIP edits.
Do not fix actual outline geometry or runtime timing inside this slice.

## Evidence

One source author, focused contract checks, actual existing primitive DOM
coverage and independent final source review. Full unchanged strict browser
qualification is still required on the final combined836 candidate before
acceptance. A corrected oracle or green unit check alone closes neither836
nor the remaining native failures. Executor reports its exact SHA and STOP.
