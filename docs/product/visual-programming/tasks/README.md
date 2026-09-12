# Scratch task cards

This directory contains small Scratch implementation/acceptance/design cards. It is not a
work queue. Readiness/order lives only in `../VSCR-M1-FORWARD-PLAN-2026-09-11.md`; active
execution state lives only in `docs/execution/current.yaml`.

An owner instruction may authorise selecting/updating a task in the control plane, but does
not bypass `current.yaml`. Coding/review/design work starts only when the exact task ID is
selected there **and** `task.status` is `in_progress`.

M1-001 historical note: its post-implementation review-only pass was performed in the same
authoring agent context, so it is recorded as repeated bounded self-review + owner acceptance,
not independent review. From M1-002C onward, HIGH/CRITICAL independent review is literal.

Default flow:

```text
current.yaml selects exact task with task.status = in_progress
→ read only that task card
→ resolve its component IDs in ../COMPONENT_MAP.yaml
→ open only referenced subsystem card entries
→ read mapped canonical contract/source/tests/evidence
→ implement/review/decide one slice
→ bounded self-review
→ required independent review for HIGH/CRITICAL
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

Templates:

```text
MAINTENANCE_TASK_TEMPLATE.md  bounded post-implementation repair/change
DESIGN_TASK_TEMPLATE.md       prerequisite dependency/contract decision such as M1-004P/005P/007P
```

Later M1/M2/M3 coding/design cards are created only after their prerequisites are accepted and
the real preceding interfaces are known. Do not reconstruct a future implementation from Git
history, old PR comments or deleted historical planning files.

For a bounded post-implementation maintenance request use
`MAINTENANCE_TASK_TEMPLATE.md` together with the component index/card, and select the exact
maintenance task/scope in `current.yaml` before editing.

For a readiness row marked `DESIGN CARD REQUIRED`, instantiate a concrete VSCR card from
`DESIGN_TASK_TEMPLATE.md`, review its bounded scope, then select that exact design task in
`current.yaml`. Never perform design-gate work directly from the roadmap.

No task card stores current readiness status or current SHA/PR state.
