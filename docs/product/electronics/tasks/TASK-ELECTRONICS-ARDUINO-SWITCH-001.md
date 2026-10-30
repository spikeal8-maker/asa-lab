---
task_id: TASK-ELECTRONICS-ARDUINO-SWITCH-001
kind: implementation
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Genuine Arduino switch/case control flow

Prepared next standalone slice for remaining requirement 6. Do not execute until
selected in current.yaml after the owner's switch/burnout regression repair.
No interpreter refactoring, old-function moves, guard/budget increase, server,
Docker, DB or unrelated repair. Broader C++ support remains explicitly bounded.

Primary Arduino runtime and capabilities. Implement integral `switch` selectors,
constant integral `case` labels, one optional `default`, grouped cases and real
fallthrough. A switch owns a shared lexical scope; explicit braced case bodies
may create their own. Preserve C++ legality of jumping across declarations;
unsupported forms must be rejected before any GPIO rather than misexecuted.

Use one atomic selector-dispatch instruction, evaluating the selector once, then
normal sequential instructions and jumps. Separate nearest breakable construct
from nearest enclosing loop: switch captures `break`, never a loop `continue`.
Nested switch/loop combinations, function-local switches and early returns must
retain correct targets and lexical scopes. No persisted duplicate selector value
or state-version bump is needed for atomic dispatch.

Use existing AVR scalar types/promotions/conversions. Validate label constants
as actual compile-time values, including numeric macros and supported const
integral bindings; existing validateOnly zero values cannot detect duplicates.
Reject floating selectors/labels, duplicate converted case values, duplicate
defaults and unsupported nonconstant labels. Preserve quote, brace, parentheses
and ternary-colon structure when finding labels. Do not claim enums, strings,
templates, pointers, goto or arbitrary constexpr functions.

Switch selectors must use the existing blocked-expression journal so Serial,
increment and random effects before pulseIn execute once across budgets/JSON.
Honor active helper instruction streams and fault-state validation. Explicitly
reject new dispatch instructions from the owned optimized runtime initially;
use the existing public fallback. Do not silently admit unimplemented opcodes.

Production boundary: arduino-program-runtime.ts and arduino-capabilities.ts;
optional cohesive NEW switch-syntax module for new code only. Read their mapped
contracts and preserve old full compilation/state/action/event bytes for programs
without switch. No unrelated API expansion or old parser extraction.

Focused proof: default absent/present/in middle, grouped/fallthrough cases,
nested switches, switch-inside-loop and loop-inside-switch break/continue,
uint32 and promotions, converted duplicates, actual constant labels, braced
locals/illegal initialization crossing, helper-local switch/return, selector
effects once, blocked selector and JSON resume at instruction budgets 1/2/7.
One actual Arduino display/Serial sketch must demonstrate real dispatch.

Candidate-first: after targeted correctness, ONE fresh Web build plus all caps
before the broad gate. Runtime source guard remains 153189; last source141778.
Arduino entry last1999997/2000000: inspect actual emitted cost, no minification
chase or limit raise. If blocked preserve the candidate and stop this slice.
Once budget-safe freeze one SHA, one uncached canonical electronics gate and
NEW independent exact-SHA review with representative actual native execution.
