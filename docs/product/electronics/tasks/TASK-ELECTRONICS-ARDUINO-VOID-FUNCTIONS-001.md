---
task_id: TASK-ELECTRONICS-ARDUINO-VOID-FUNCTIONS-001
kind: implementation
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Real scalar-parameter void helpers for Arduino display sketches

Prepared dependency of the owner's display programme; not executable until
selected in current.yaml. Diagnostic 817 proves ordinary `showDigit(int)` fails
compilation. Support genuine source functions used by display/scan helpers,
without replacing the user's code with macros or silently expanding its text.
This slice does not claim arbitrary C++ functions, arrays, overloads or all C++.

Primary `electronics.arduino.runtime`, dependency `electronics.arduino.capabilities`;
exact Arduino component entries and runtime state/journal/scheduler contracts apply.
Preserve old compiled instructions, correct legacy admission/state bytes,
canonical time and GPIO/library semantics. Explicitly reproduced admission
defects below are intentional corrections, not silently pruned oracle cases.

## Bounded language surface

Ordinary nonrecursive `void` definitions with scalar value parameters, existing
supported scalar types/const semantics, explicit compatible prototypes, nested
nonrecursive calls, local variables, supported loops and early `return;`.
Collect signatures before execution, including definitions below callers as
normal Arduino sketch helpers. Reject mismatched signatures/arity, name conflicts,
unsupported parameter forms, recursion and malformed bodies before GPIO runs.
Non-void returns, helper calls as value expressions, references/pointers, arrays,
overloading, default parameters and templates remain explicitly unsupported;
do not admit them merely because a name is defined.

Preserve exact canonical generated adapter behavior (including ultrasonic and
Servo) before generic helper admission. Initial 824 inspection found current
ultrasonic dispatch can ignore an arbitrary conflicting body by builtin name;
capture that separate BEFORE admission defect and reject such bodies before GPIO.
Do not claim its former behavior is preserved or silently omit it from evidence.
Existing direct intrinsic calls without definitions remain unchanged. A matching
builtin name alone must not bypass validation or replace the user's body meaning.
Parse comments/strings/braces without mistaking their text for definitions.

Use proper call frames/instruction streams or an equivalently correct compiler
lowering. Plain textual inlining under caller scopes is not equivalent: a callee
must see shared globals and its own locals, never caller locals by dynamic lookup.
Evaluate every argument once in caller context, finish any blocked argument before
entry, convert to the declared parameter type, and restore caller locals on return.

Calls, returns and function-local actions use the existing interpreter and clock.
Delay/pulseIn/Serial and JSON continuation inside a helper must retain the correct
PC, scopes and expression journal. Pending replay identity includes call context;
`Serial.read()` or increments before a blocking argument cannot execute twice.
Journal helper-call argument evaluation whenever a blocking expression is possible,
including `analogRead()` before a blocked second argument; the old narrow
increment/random regex is not sufficient. Fault snapshots must keep coherent
callee PC and frames and remain faulted on re-advance, without an accidental reset.
No new clock, wall timer, synthetic delay or hidden instruction-cost waiver.

## Source boundary

- `contexts/electronics/domain/arduino-program-runtime.ts`: compile table,
  call/return, scope isolation, snapshot/validation/resume and optimized admission.
- New cohesive `contexts/electronics/domain/arduino-user-functions.ts` if useful
  for signatures/definitions/call-graph validation; no old-function relocation.
- `contexts/electronics/domain/arduino-capabilities.ts`: admit only helper code
  accepted by the real compiler; concise accurate unsupported diagnostics.

Optional call fields appear only for helper execution. Old version-7 states and
old instruction streams remain byte-identical; do not bump versions or persist
duplicated global scopes. Forged/stale/unknown call frames fail closed. Initially
route helper programs through the existing public interpreter fallback if owned
optimization cannot preserve these semantics; explicitly reject the new program
kind from the optimized route rather than accidentally admitting new instructions.

## Proof

Focused tests for global/caller shadowing, value conversion/const, nested and
forward helper calls, early return and helper-local break/continue, argument-once
effects, blocking arguments/helper waits, JSON resumption across tiny budgets,
multi-board isolation and malformed/forged frames. Capture full legacy compiled
instruction/state/event oracles before editing and compare after without pruning.
Include existing numeric macros, quoted braces/question marks, Servo and exact
ultrasonic adapter sources in that oracle, not only simple GPIO sketches.

Then real one-Uno 1/2/3/4 display text helper sketches with actual counters/carry
and scan waits, plus a small real Worker/Stage pilot using the already corrected
optical pipeline. Compare logical values/current/duty against genuine linear
Blockly and linear text; different source instruction timelines need not have
identical serialized state. Report model/wall time honestly; no realtime claim
from slower fallback execution.

Focused first; one `NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1`, all bundle
budgets and new independent final-SHA review. Do not increase runtime source
guards or bundle caps. No solver/optical/cadence/thermal repair, foreign changes,
refactoring, dependencies, toolchain installation, server, Docker or DB.
If the bounded language surface needs a new physical/protocol invariant, STOP.
