---
task_id: TASK-ELECTRONICS-SEVEN-SEGMENT-REPAIR-001
kind: repair
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Urgent raw seven-segment display and Arduino execution

Owner screenshot shows raw seven-segment display on Uno driven by multiple HIGH
blocks in forever, with actual Worker timeout banner. This is not evidence that
the existing eight LED branch model is absent. Reproduce before any repair.
PLANNED until controller selects this slice on main; current analog/UI scopes
remain independent, no opportunistic changes to them or paused682 candidates.

First phase is bounded causal diagnosis: actual catalog/owner terminal mapping,
proper common cathode/anode, current-limited reference and screenshot-like wiring,
all segments and patterns0-9, direct engine plus actual Worker+renderer. Include
the screenshot's tight nine HIGH writes with duplicate12, no artificial delay,
few/many blocks, and finite horizon/instruction budget/Stop/Reset. Record actual
timeout or electrical fault, runtime/solver/native frame timing and cause.
Do not blame wiring from pixels or announce a cause without reproduction.

Return minimal cause-based production proposal before edits. Potential scope is
existing seven-segment model/solver branch and scheduler/runtime path actually
responsible, or existing visual result consumer if confirmed. No global runtime
rewrite, new generic peripherals or import of old timing experiments. Distinguish
raw segmented LEDs from unrelated generic serial-display blocks. No timeout raise,
hidden warmup, inserted delays, reduced precision/physics rate, fake brightness,
unsupported topology success or silently truncated valid execution.

Preserve numerical/KCL/source quality, real overcurrent/burn/reverse errors and
common polarity; no owner asset edits. Complete state/event determinism across
budget/JSON/directWorker and valid old projects, repeated startup/Stop/Reset and
actual1440/390 visible segments. Required fresh focused/native/types/build/budget
gate with NX_SKIP_NX_CACHE=true and NEW independent finalSHA review; fixedcaps
222000/2000000. Full installed/SaveCAS/owner/release acceptance separate.
One bounded candidate and final convergence then STOP. No refactoring/server/
Docker/liveDB/deployment/foreign source/dependency/workflow/asset changes.
