---
task_id: TASK-ELECTRONICS-KEYBOARD-UI-001
kind: repair
risk: medium
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Owner23 item14: complete small workbench keyboard commands

Owner explicitly returns to simplest visible corrections. Implement R rotate,
M mirror and Ctrl/Meta+Enter Run/Stop using existing public controller actions.
Preserve physical-key English/Russian behavior, editable/C++ focus, native
buttons, existing shortcuts and Space panning. Ignore repeated new toggle commands
and composing input. Do not alter simulation, clocks, models or persistence.

Allowed production paths: workbench-shortcuts.ts, use-electronics-workbench.ts
and optional title-only key hints in WorkbenchHeader.tsx under apps/web/src/electronics.
Supporting scope: existing shortcut tests, one dedicated native browser fixture,
its component-map registration and a concise evidence receipt. One author only.

Keep222000 and all other bundle caps. No deferred752/753 candidate integration,
other cleanup, product area, dependency/workflow/schema/asset/server/DB changes.
If needed, compact only the same keyboard lookup/dispatch responsibility with
exhaustive preservation tests; do not introduce arbitrary chunk relocation.

Verify actual BEFORE then native1440/390 keyboard events through the real
production command consumer, callback counts/state, focus/editor exclusions,
repeat/composition, other shortcuts and Space panning. Scoped unit/lint/type/build
and actual bundle check are required, then NEW independent exact-SHA review.
No full-stack persistence test is required for reusing unchanged commands.
Classify unrelated General failures without repairing foreign modules or chasing
main; scoped UI evidence is not repository/release/installed acceptance.

Return one bounded candidate and self-review then STOP. Controller handles
source integration after required scoped evidence/review, preserving foreign main.
