---
task_id: TASK-ELECTRONICS-DO-WHILE-001
kind: implementation
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Arduino C++ do…while

Consolidated17 bounded portion only. Catalogue until canonical main selection.
Existing for/while source and clock behavior remain intact. Add post-test loop
using current compiler instructions, scope unwinding and continuation budgets;
no new state version/protocol, scheduler cadence, cost or physics changes.

Read-only cause: capability and unsupported-syntax scan reject do, and runtime
controlledStatement/compiler have no post-test branch. Implement do body
while(condition); including braced/single/empty bodies, nested if/else/loops,
continue to condition and break to end. Require final semicolon and correct
diagnostic source ranges. Keep unrelated switch/goto/random unsupported.

Exact paths existing arduino-program-runtime.ts, arduino-capabilities.ts and
directly related command reference text/example. Tests existing loop suites and
native arduino-loops.browser.mjs. No parser refactor or file redistribution.

Prove false executes body once, repeated condition, nearest break/continue,
local shadowing/unwind before condition, nested dangling else, malformed syntax,
comments, delays, infinite bounded yield and Stop/Reset. Compare budgets1/2/7
and large, JSON continuation and state/program compatibility. Capture old
sketch state/events/fingerprints BEFORE and compare byte-exact after; preserve
old compiled streams. Real production Worker/client/controller executes generated
or textual observable do-sketch with Serial/GPIO and source/lifecycle changes.
Independent finalSHA review includes meaningful negative and old-behavior proof.

Update only new do capability and help accurately, with executable contextual
example; no claim fullC++ or AVR compatibility. Fresh focused gate literal
NX_SKIP_NX_CACHE=true, types/build and fixed caps222000/2000000. No capraise,
dependencies, deferredcleanup, foreign fixes, protected assets, server Docker DB
deployment or random/switch implementation. One bounded candidate then STOP.
