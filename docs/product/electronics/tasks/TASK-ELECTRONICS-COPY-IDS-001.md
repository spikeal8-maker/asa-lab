---
task_id: TASK-ELECTRONICS-COPY-IDS-001
kind: repair
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Classroom audit point 1: bounded identifiers for copied components and wires

## Goal / authority

The owner selected point 1 of the 16–17 October classroom audit repair plan.
Repeated Duplicate and Copy/Paste must produce fresh bounded identifiers,
independent of the previous copy's ID, while retaining internal wire references.
Publish the verified change to main, report and stop. No production update.

## Component / contract

Primary: `electronics.persistence.project`; dependency: `electronics.ui.workbench`.
Read `components/ui-assets-persistence.yaml` and `README.md#5-circuitdocument`.
The existing 64-character identifier contract and server document validation remain.
No schema, API, revision, autosave schedule, recovery, solver or artwork changes.

## Expected write paths

- `apps/web/src/electronics/workbench-document.ts`: allocate the copy batch identity.
- `apps/web/src/electronics/use-electronics-workbench.ts`: both copy actions use it.
- `apps/web/src/electronics/testing/workbench-document.spec.ts`: repeated connected copies.
- `tests/electronics/copy-identifiers.spec.ts`: real use-case/controller save/reopen
  with an in-memory repository and canonical Electronics validation.
- This card and its selected child lane in `docs/execution/current.yaml`.
- `components/ui-assets-persistence.yaml`: register the cross-boundary test.

## Acceptance / focused evidence

1. Repeated copies of a connected group with initially 64-character IDs remain
   unique and within the canonical limit, including copied wire IDs.
   Generated copy labels also respect the existing 120-character limit: inspection
   found that suffix accumulation would otherwise invalidate this same repeated-copy flow.
2. Internal wires point to the matching newly copied components; originals and
   external connections retain their identities. Undo/history behaviour is unchanged.
3. The resulting document saves and reopens through the existing Project Core/API
   fixture without weakening canonical validation; this is not a production browser test.
4. Focused tests, changed-file lint/format, web typecheck/build and independent review.
   General exact-SHA CI is reported separately; unrelated failures do not expand scope.

## Stop

Existing malformed-document recovery is point 2, not this task. No Scratch,
authentication, database migration/live data, new deployment or next repair.
The mapped large controller is edited narrowly without decomposition or growth.
`NEXT_ALLOWED_TASK: STOP / OWNER REVIEW`.

## Implementation evidence, 2026-10-18

- The pure copy operation allocates one fresh UUID batch identity; callers no longer
  pass the source component's ID. Both Duplicate and Copy/Paste use this operation.
- Copy-generated names preserve a copy suffix within the existing 120-character limit.
- Workbench suite: 17 PASS, including 50 serialized generations of a connected group
  with 64-character original IDs and a 120-character original name; source immutability,
  unique bounded IDs and copied wire references are checked.
- Cross-boundary Project Core/controller fixture: 1 PASS, eight save/reopen generations
  with increasing revisions and exact canonical-document equality. A subsequent 65-character
  ID is still rejected without a write/revision advance. This uses an in-memory repository.
- Existing API validation suite: 8 PASS; existing HTTP-compatible client ID test: 1 PASS.
  Total relevant cases: 27 PASS. No cached test result is claimed.
- Changed-source/test ESLint, web typecheck, changed-file Prettier and routing validator: PASS.
- Web build and its five dependency builds: PASS, six tasks executed with Nx cache skipped.
- First fixture assertion was corrected to compare canonical model-enriched documents;
  the cross-boundary test was moved outside the apps to preserve Nx import boundaries.
- SELF_REVIEW: PASS. No layout, API/schema/permission, solver, autosave scheduling,
  existing-document migration or production change. New copy IDs persist through JSON/API.
- Exact published SHA, general CI and required independent review are recorded in the
  owner report after they actually complete. A real browser/production save journey
  is not claimed by the in-memory test above.
