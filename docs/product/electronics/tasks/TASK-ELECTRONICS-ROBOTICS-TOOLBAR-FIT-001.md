---
task_id: TASK-ELECTRONICS-ROBOTICS-TOOLBAR-FIT-001
kind: repair
risk: low
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - TASK-ROBOTICS-FIELD-CAMERA-001
  - https://github.com/spikeal8-maker/asa-lab/pull/1098#issuecomment-6841706381
  - https://github.com/spikeal8-maker/asa-lab/pull/1098#issuecomment-6841862586
acceptance_boundary: slice
review: independent
---

# Compact toolbar fit for the Robotics integration dependency

Tracking: [#1122](https://github.com/spikeal8-maker/asa-lab/issues/1122), a bounded
dependency of [#1096](https://github.com/spikeal8-maker/asa-lab/issues/1096) within
[#1071](https://github.com/spikeal8-maker/asa-lab/issues/1071).

## Goal and boundary

Correct the review-found B presentation defect introduced by preserving the
shared Duplicate control: at 1181x900 while running, the clock covers 12.21875px
of Mirror. This is one dependency of FIELD-CAMERA-001, not a new Electronics
milestone or acceptance of unfinished E1. Canonical selection lives only in
`docs/execution/current.yaml`; this card alone grants no runtime write.

## Component and minimal context

Route through `../START_HERE.md` and `../COMPONENT_MAP.yaml` to
`components/ui-assets-persistence.yaml`: `electronics.ui.workbench`, ASA-owned,
area risk medium. This repair is low-risk presentation with no runtime semantics.
Read the existing compact desktop rules in `apps/web/src/electronics/workbench.css`,
their direct-child markup in `WorkbenchHeader.tsx`, and the wrapper/dimension
boundary in `apps/web/src/robotics/RoboticsElectronicsToolbar.tsx` and `robotics.css`.
The existing regression is `e2e/electronics-simulation.spec.ts` compact controls;
its assertions and fixtures are read-only for this repair.

## Only production write path

`apps/web/src/electronics/workbench.css`

Within the existing 981-1459px media query, scope the 34px button width to
`.workbench-toolbar.breadboard > .workbench-breadboard-tools > .workbench-tool`.
Keep the existing shared 36px rule: the Robotics native-tools wrapper must not
match the new direct-child selector. Preserve the right group, clock text,
toolbar height, global header, Save/avatar, inspector, catalogue and mobile UI.

## Acceptance and evidence

- All four existing cases complete: text desktop-wide, text desktop-compact,
  blocks-text all-widths and blocks all-widths, including later viewports and
  stopped/running/native-menu phases. No clipping or unintended hit ownership.
- Preserve exact 17/8/6 counts, exactly one Duplicate, complete desktop captions,
  icon/text bounds, geometry assertions, budgets and timeouts.
- No Worker, engine, physical clock, model, program, persistence, API or schema
  change; no Robotics button-size change or deployment claim.

Run exact-path preflight for the selected child lane and validate its exact task
with `pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-ROBOTICS-TOOLBAR-FIT-001`.
Use changed-file formatting, source/diff checks and final plan verification.
The existing Electronics R4-M1 s3 browser command is
`NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1:browser --shard=3/4 --workers=1`.
Keep applicable required integration CI. The separate ui-679-557 gate does not
cover these compact cases. Do not create a local stack or run engine experiments
to replace the existing exact-candidate CI evidence.

## Review and stop

Perform bounded self-review, publish a frozen candidate, and obtain independent
exact-SHA review. Keep D2-R2 and all protected owner files read-only. Do not merge,
deploy, change other tests or start another repair automatically. STOP for the
controller after the selected slice and report.
