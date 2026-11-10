---
task_id: TASK-ELECTRONICS-FIELD-PINCH-ORACLE-001
kind: repair
risk: low
semantic_change: 'no'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Exercise native pinch in the field boundary browser cases

The narrow field boundary cases wait for a zoom button that the compact
editor hides. Use a two-finger gesture at the centre of the canvas and
check the same visible scale increase as the desktop button.

Keep the original pan, opaque body hit, native drag, full draft save,
and cookies-only reopen checks at every boundary. Verify the gesture
and downstream actions in Chromium at both narrow widths. The scope
covers the existing browser test with its current timeout.
