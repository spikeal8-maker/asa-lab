---
task_id: TASK-ELECTRONICS-CROSS-TAB-DRAFT-SAFETY-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Preserve accepted save recovery 526 and autosave cadence 459
  - "Owner first problem only: preserve pupil work"
acceptance_boundary: slice
review: independent
---

# E01 — one tab must not erase another tab's unsaved recovery copy

Programme #452; accepted #526 remains accepted. This repair covers only the late save confirmation cleanup of a different local recovery document for the same pupil/project.

## Component

`electronics.persistence.project` in `../components/ui-assets-persistence.yaml`.

## Goal and evidence

A sends a save; B edits the full schematic and Arduino sketch while A is pending; A receives confirmation; B closes without a successful save. Reopening must retain B's full local document with truthful conflict/local/server status. Do not imply historical work was recovered or guarantee global atomic localStorage transactions.

## Minimal read set

Root policy and Electronics router; owner registry E01/SAV-01–12; accepted SAVE-RECOVERY-001 evidence; mapped persistence component; production cleanup calls and shared storage callers.

## Expected write paths

- apps/web/src/electronics/use-workbench-project-state.ts
- apps/web/src/modules/project-local-draft.ts
- apps/web/src/electronics/testing/workbench-project-state.spec.ts
- apps/web/src/modules/testing/project-local-draft.spec.ts
- e2e/electronics-simulation.spec.ts (one directed two-tab case; retain every existing case)
- canonical generated component-coverage digest only if existing browser source hash requires it

Two production files; two focused test files plus explicit real-browser regression case. Shared module compatibility is required; no caller semantics changes outside Electronics.

## Acceptance

1. Exact-SHA built production-browser BEFORE and AFTER of the same two-tab action, full documents/sketches and actual server revisions/local recovery records.
2. All Electronics load/sync/merge/save cleanup preserves a different unconfirmed recovery document; same confirmed document still cleans up.
3. Focused storage/mounted tests, diff-check, gate:electronics-m1, gate:electronics-m1:browser and gate:repository on final version; frozen dependencies and literal NX_SKIP_NX_CACHE=true.
4. NEW independent review of final actual SHA/GitHub state, then report and STOP. No next task.

An explicitly selected diagnostic-only workflow derived from the unchanged canonical isolated browser recipe may run ONLY this new case before/after, retaining original assertions/timeouts/build inputs/artifact provenance. It does not replace any ordinary gate and is not integrated as a product change.

## Forbidden

No solver/Arduino behaviour, visual/field/PSU/asset repair, auth/API/schema/RLS change, timeout/assertion weakening, package/dependency updates, foreign-module repair, installation/Docker/DB/network/backup action, protected assets or owner data. Preserve paused field544 candidate a126dc75620eefb6c6f63b5fc2521b4338829688 and all other candidates.

NEXT_ALLOWED_TASK: STOP
