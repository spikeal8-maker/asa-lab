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
- `apps/api/src/electronics-save-validation.spec.ts`: real use-case/controller save/reopen
  with an in-memory repository and canonical Electronics validation.
- This card and its selected child lane in `docs/execution/current.yaml`.

## Acceptance / focused evidence

1. Repeated copies of a connected group with initially 64-character IDs remain
   unique and within the canonical limit, including copied wire IDs.
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
