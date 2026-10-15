---
task_id: TASK-ELECTRONICS-SAVE-CONFLICT-001
kind: repair
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Point 4: bounded Electronics conflict reconciliation

## Goal and contract

Investigate the historical chain of 41 HTTP409 responses and repair confirmed
automatic repetition paths without overwriting concurrent work. Primary component:
`electronics.persistence.project` (cross_boundary); dependency: document merge.
Contracts: `README.md#17.1`, `README.md#5-circuitdocument`, existing server CAS and
mutation identity. Historical logs have no trigger/baseRevision/document: their
exact cause cannot be retroactively established.

## Bounded scope

Production paths: `apps/web/src/electronics/use-workbench-project-state.ts` and
`apps/web/src/electronics/workbench-autosave.ts`; supporting same-actor recovery isolation
uses `apps/web/src/electronics/electronics-project-recovery.ts` and the existing
canonical storage key in `apps/web/src/modules/project-local-draft.ts`. The shared
reader understands opt-in Electronics SHA-256 acknowledgements; other modules keep
their existing storage semantics. Full document schema stays unchanged.
Focused tests: existing workbench-project-state/workbench-autosave, new recovery suite,
plus document-merge compatibility. Justified exception to two focused test files:
the third suite proves tab namespace, reload/fresh recovery and copied session safety.
No server/API/schema, solver, assets, telemetry programme or deployment changes.

Inspect safe rebase after409, queued/exit writes, retry deadlines and repeated
contention. Automatic attempts must wait one minute after a conflict merge;
repeated rebases have a finite budget until a confirmed save. Non-advancing reads
cannot authorize another write. An explicit manual retry may recover a stopped
conflict; incompatible changes remain explicit and local work is retained.

## Acceptance / evidence

1. Reproduce a rapid409 repetition path before repair; aggregate the one historical
   chain without exporting student content or claiming its request triggers are known.
2. Independent concurrent edits merge and save; overlapping changes do not overwrite
   remote work. Verify two mounted editors, distinct actors and two same-actor tabs.
   Owned recovery copies must survive the other tab's write/ack/clear and both exits.
3. Lost reply, queued edits and repeated hide/exit cannot produce unbounded automatic
   writes. Respect both retry spacing and a finite rebase budget.
4. Focused tests and independent HIGH persistence review; exact-SHA general CI.
   Cancellation/unrelated CI failures are classified without chasing moving main.

SELF_REVIEW and limitations go into the dated point4 delivery report.
STOP after point4. Owner acceptance remains pending. No point5 or site update.

## Implementation evidence

Before fixes: non-advancing conflict plus hide events produced14PUT instead of1;
lost-reply readback remained dirty; same-actor two-editor test lost the second
editor's local durability after the first editor acknowledged/cleared its draft.
All three concrete regressions are repaired.

Final recovery/load verification:52 hook tests,6 recovery tests and7 generic
local draft compatibility tests PASS. Previously verified unchanged scheduler10
and document merge6 tests PASS. Each repeat followed a concrete changed dependency
or independent-review finding; no full local repository/browser reruns.
ESLint/routing/control-plane, exact published SHA CI and independent review evidence
are recorded in the dated owner report. No real PostgreSQL/browser load result is
claimed from mounted React and in-memory CAS tests.

Recovery retention: unconfirmed branches stay intact. Semantic acknowledgement
sweeps matching/included source branches across repeated reloads; exact-byte
fingerprints cannot hide a concurrent newer edit. Stored retired records/markers
may remain until storage cleanup; quota failures keep the durability indicator honest.
No new archive browser or bulk deletion policy is introduced in this slice.
