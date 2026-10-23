---
task_id: TASK-ELECTRONICS-ARDUINO-LOG-ERROR-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Owner request to implement point 4 of the 23 October log-based optimization plan
acceptance_boundary: slice
review: independent
---

# Arduino editor error from classroom logs

## Goal and component

Repair the repeated browser exception mapped from the installed release to the
ScratchBlocks editor. Component: `electronics.ui.arduino-editor`, routed through
`../COMPONENT_MAP.yaml` to `../components/ui-assets-persistence.yaml`.
Execution selection lives only in `docs/execution/current.yaml`.

## Evidence and scope

Installed revision `6e80e3f3e87a8f815ac6b254fd0b3ffa942db2d3`:
30 TypeError reports identify ArduinoCodePanel-BLDbiImP.js:2325:53490.
Exact encrypted release symbols map this coordinate to ScratchBlocks 2.1.19
workspace delete menu message replacement (`DELETE_X_BLOCKS.replace`).
The observed coordinate proves the failing expression; determine and reproduce
its missing message cause before claiming the incident repaired.

Read the router, component card, selected Arduino README section and exact
editor/message initialization sources only. Expected production budget is at
most five files and two focused test files; map any new ownership explicitly.

## Acceptance

- Reproduce the demonstrated missing-message failure and prevent recurrence.
- Preserve Blockly operations, existing Russian UI, workspace serialization,
  generated Arduino code and persistence behavior.
- Run focused tests and required real browser evidence in GitHub; do not replace
  the defect with swallowed exceptions or change simulation/physical clocks.
- Independent review of final source; normal verified main publication; report
  evidence and remaining limits, then STOP.

## Forbidden

No simulation/clock tuning, parallel task repairs, schema/auth changes, protected
asset replacement, deployment, live data changes or automatic next point.

NEXT_ALLOWED_TASK: STOP / OWNER REVIEW
