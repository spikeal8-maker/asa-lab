# Scratch task cards

This directory contains small Scratch implementation/acceptance cards. It is not a work queue.
Readiness/order lives only in `../VSCR-M1-FORWARD-PLAN-2026-09-11.md`; active execution lives
only in `docs/execution/current.yaml` + explicit owner instruction.

Default flow:

```text
selected task
→ read only that task card
→ resolve its component IDs in ../COMPONENT_MAP.yaml
→ open only referenced subsystem card entries
→ read mapped canonical contract/source/tests
→ implement/review one slice
→ bounded self-review
→ STOP
```

Current executable/route cards:

```text
VSCR-M1-001.md    bounded-context extraction

VSCR-M1-002.md    milestone router only; not executable as one slice
VSCR-M1-002A.md   standalone build + minimal ASA host shell
VSCR-M1-002B.md   ASA branding + File/Extensions controls
VSCR-M1-002C.md   parent/iframe protocol boundary
VSCR-M1-002D.md   ScratchStorage/GUIStorage fixture adapter
VSCR-M1-002E.md   integrated acceptance + independent review
```

Later M1/M2/M3 coding cards are created only after their prerequisites are accepted and the
real preceding interfaces are known. Do not reconstruct a future implementation from Git
history, old PR comments or deleted historical planning files.

For a bounded post-implementation maintenance request use
`MAINTENANCE_TASK_TEMPLATE.md` together with the component index/card.

No task card stores current readiness status or current SHA/PR state.
