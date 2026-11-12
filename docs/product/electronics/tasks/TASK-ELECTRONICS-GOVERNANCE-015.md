---
task_id: TASK-ELECTRONICS-GOVERNANCE-015
kind: plan/governance
risk: medium
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - TASK-ELECTRONICS-GOVERNANCE-010
  - Technical acceptance of production slices 553, 569, 570 and 571 after full checkpoint 006
acceptance_boundary: slice
review: independent
---

# Compact mandatory hygiene checkpoint 007 before recovery R10

Programme [#452](https://github.com/spikeal8-maker/asa-lab/issues/452), bounded
owner assignment [#1111](https://github.com/spikeal8-maker/asa-lab/issues/1111).
This is a required documentation dependency of the already requested first R10
repair. It does not extend the task into a catalogue audit or product cleanup.
Selection lives only in `docs/execution/current.yaml` on accepted main.

## One result and evidence for the trigger

Resolve the overdue three-slice checkpoint using the actual accepted source.
The last proven full checkpoint is 006 / #556. Accepted #553 plus separately
accepted #569/#570/#571 already exceed the interval. The latter three have
`technical_accepted` entries with exact General SUCCESS and new independent
review at 387a4d02294ac1ffc9309a5e4a24e2ceff64d84c. Do not count disputed
source-only pending work as accepted or replace historical counters in other lanes.
The limited #641/#778 responsibility reviews and GOV-014 routing repair did not
claim a full checkpoint. Preserve their scopes, all historical findings and debt.

## Exact read scope

Read root policy, router, AGENT_GUIDE §4.1, hygiene contract §§2–9,
`evidence/hygiene-baseline.yaml`, `evidence/hygiene-checkpoint-stabilization-006.yaml`,
and the relevant accepted-slice entries in current.yaml. Inspect the current
tracked production file inventory only for actual size/route changes and the
two existing retained legacy concerns. Do not preload every component or repeat
physical/browser measurements.

Also carry forward the inherited residual concerns recorded by checkpoint 006:
shared project-local-draft schemas 1/2 compatibility and the late Arduino media
refresh consumer. Preserve their retirement obligations by reference; a changed
disposition requires exact evidence, not omission from the newer checkpoint.

Record all seven contract categories:

1. The nine registered large production sources, exact Git blob byte sizes,
   growth against reviewed sizes and any newly unregistered >50,000-byte file.
2. Current callers and retirement conditions for the retained live-simulation
   helpers and legacy Arduino clock/runtime bridge. Unknown evidence forbids deletion.
3. New/deleted/orphaned routes against the actual component maps and validator.
4. Generated artifacts, generators and stale-output validation actually required.
5. Preservation of historical evidence and protected owner assets.
6. Actual removals, which are none in this documentation-only checkpoint.
7. Residual debt, including sources near the growth limit, without hiding it by
   increasing baseline sizes or silently splitting code.

## One author and one allowed write path

The selected author writes only:

`docs/product/electronics/evidence/hygiene-checkpoint-stabilization-007.yaml`

Controller owns this card and current.yaml. No product/test/workflow/dependency,
catalogue, generated, protected asset or other lane edits. No baseline size/limit
increase, deletion, deployment, database, backup or restore action. If an actual
violation requires another change, report exact evidence for controller scope
coordination instead of fixing it inside this inventory.

## Validation, independent review and stop

Run `pnpm agent:preflight --scope electronics-recovery-hygiene --check` with the
single evidence path and exact selected-card validation. Run full Electronics
routing, applicable governance, control-plane and diff checks; state local
remote-check limitations honestly. CI belongs to the exact published SHA.
An independent read-only reviewer verifies all seven categories, actual source
facts, preservation and final diff before the controller accepts the checkpoint.
Unchanged full-editor browser scenarios are not rerun for this docs-only task.

The author reports one candidate/evidence set and stops. The controller combines
accepted hygiene and sufficient R00 evidence before separately selecting R10.
Neither a prepared file nor a pending PR resolves the blocker; acceptance must
be recorded on main. Owner acceptance of the product and production deployment
remain separate. `NEXT_ALLOWED_TASK: STOP / CONTROLLER`.
