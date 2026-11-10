---
task_id: TASK-ELECTRONICS-OWNED-STABLE-LOOPS-001
kind: repair
risk: high
semantic_change: 'no'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Account for stable Arduino loop iterations in the owned scheduler

Use the exact instruction cost of complete, electrically stable Arduino
loops to reduce Worker computation in the owner's no-delay and
`millis()` cases. The scheduler opts in for its private runtime. A loop
of prepared literal digital writes can repeat when the target output
levels already match. A `millis()` loop must first complete an
event-free iteration within the same millisecond and leave the same
global bindings and pin state.

Keep partial iterations on the existing interpreter. Preserve the
instruction budget, clock boundaries, continuation bytes, GPIO events,
and public action arrays. The model and wall time thresholds stay fixed.
Check prepared and fallback cases with low budgets and the unsigned
`millis()` rollover. Compare the complete Worker responses for both
saved sketches and verify their outputs and timing in Chromium before
integration.
