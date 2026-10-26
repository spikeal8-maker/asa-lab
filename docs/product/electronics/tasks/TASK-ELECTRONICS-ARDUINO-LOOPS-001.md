---
task_id: TASK-ELECTRONICS-ARDUINO-LOOPS-001
kind: repair
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Owner23 item1: correct Arduino for, while and nested loops

Owner explicitly selects item1 after5 and SPDT verification: implement and carefully
verify loops. Functional correction only, no refactoring or file redistribution.
Separate from paused682 wall-clock/CI experiments; do not import their candidates.

First establish concrete failing valid sketches and preserve BEFORE. Repair only
loop compilation/execution needed by ordinary for/while and nesting. Check finite,
zero-iteration and empty/infinite loops, positive/negative steps, omitted for parts,
block/single-statement bodies, nearest-loop break/continue, lexical scope/shadowing,
if/else inside loops, delay/delayMicroseconds continuation, GPIO and Serial order.
Unsupported syntax must fail closed honestly; no full C++ support claim.

Allowed production paths: contexts/electronics/domain/arduino-program-runtime.ts,
arduino-capabilities.ts, and apps/web/src/electronics/arduino-blocks.ts only for a
demonstrated loop-generation defect. Supporting dedicated loop/runtime/state,
diagnostics and Blockly tests and one actual browser/Worker verification fixture.
Return a concise cause/proposal before editing production; controller may narrow
scope without asking owner again. No architecture changes, generic cleanup, new
runtime representation unless essential and independently reviewed; preserve
existing numeric semantics, persisted state compatibility and valid old projects.

Same program must yield identical complete state/events across scheduler budgets,
serialized continuations and direct/Worker execution. No arbitrary iteration cap
that silently truncates valid loops, no busy browser hang, loss of delay position,
fake output or advance past horizon. Preserve Stop/Reset/source-generation safety,
finite values, fail-closed invalid programs and item5 exact diagnostic coordinates.
Blockly for/repeat/while/until/forever controls must generate executable correct
code, including nested variable scope and round-trip legacy saved workspace.

Required: BEFORE regressions, golden expected GPIO/Serial and final values,
continuation/budget equivalence, invalid and infinite/yield safety, actual Worker
and browser desktop1440/mobile390 run/stop/reset/source edit where applicable.
Clearly separate controller ports from real application proof; no fake Worker or
claim of server SaveCAS. Fresh NX_SKIP_NX_CACHE=true gate:electronics-m1, exact
bundle:check caps222000/2000000, relevant format/lint/type checks and NEW independent
exact-final-SHA review. Classify Windows corepack.cmd EINVAL as infrastructure and
use canonical Linux focused CI if encountered; no foreign test/CI repair.

One bounded implementation, final convergence and review then STOP. No dependencies,
workflows, solver physics/timing tolerance changes, assets, live DB, Docker/server,
deployment or foreign changes. User defers refactoring/hygiene until functional
requirements are implemented; fixed bundle limits remain. General/release/installed
and owner acceptance remain separate; unrelated failed CI cannot expand this scope.
