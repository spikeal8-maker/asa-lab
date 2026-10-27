---
task_id: TASK-ELECTRONICS-NUMERIC-CONDITIONAL-001
kind: implementation
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Numeric C++ conditional value expressions

Consolidated16, issue787, parent703/452. Next smallest functional language gap,
smaller than switch/case. One bounded implementation, no parser refactoring.
Primary: official WG21 cplusplus/draft tag n3337 source/expressions.tex expr.cond
https://github.com/cplusplus/draft/blob/n3337/source/expressions.tex#L3501

Support numeric value a ? b : c with correct precedence below logical OR and
right associativity, within existing initializer/assignment RHS/condition/
argument/macro/parenthesized contexts. Condition executes once, only selected
arm executes, both arms syntax/type validate. Same numeric operand types retain
type; differing numeric types use existing AVR usual conversions/commonType and
convertValue. Reject malformed/empty arms, unsupported text/pointer/class/void,
conditional lvalue assignment or increment target, GNU a ?: b and new comma/
assignment expressions. These are explicit ASA subset boundaries, not full C++.

Minimal tokenizer/parser conditional precedence level plus small prepared syntax
node/evaluator and safe owned admission. Existing suppressed evaluation must avoid
unselected RNG/Serial.read/increment/zero-division/waits while still rejecting
unknown names/wrong arity. No new instructions/runtime fields/state version/
protocol/cost/cadence. Journal must resume a selected blocking arm without
repeating condition/prefix or switching arms after a changed binding. Do not
weaken token/span/forged-state validation. Owned and fallback paths both covered.

BEFORE edits capture old compiled streams, complete states/results/events and
fingerprints for representative do/shortcircuit/macros/RNG/increment/pending
programs. AFTER byte equality and old JSON continuation. New tests precedence,
right nesting, numeric same/mixed bool/byte/int16/uint16/long32/uint32/float,
only-selected effects, malformed/unsupported forms, JSON/budgets1/2/7 and large.
Actual production Worker/client/controller Serial/GPIO and pending selector/
Stop/Reset/source edit1440/390, reusing existing loops browser fixture.

Production scope arduino-program-runtime.ts; directly relevant capability/help
only if currently false or required for measurable support. Reuse numeric helpers;
values helper only if necessary. Existing expression/correctness/random/loops
and command reference tests, existing arduino-loops.browser.mjs plus evidence.
No new command card merely for decoration or unrelated help rewrite.

Focused tests first, format/lint changed files, ONE final gate:electronics-m1
with NX_SKIP_NX_CACHE=true plus bundle:check and independent final-SHA review.
Current fixed caps222000/2000000 and reviewed runtime guard153189B remain. No
cap raise, unrelated cleanup, moving old functions/files, deferred candidates,
new dependencies/workflows, server/Docker/DB/ports/protected assets or foreign edits.
If budget fails report measured cause before any response; no microbuild chase.
Classifier A/B repair only, no foreign CI repair. Executor publishes one coherent
candidate and stops; controller owns currentyaml and programme sequence.

Owner explicitly directs continued independent work while main is unavailable:
preserve reviewed candidates and select further bounded work in a controller
programme branch if a foreign baseline blocks main, without altering foreign
state or claiming main integration. Normal main-first selection applies when
available. Source proof is separate from installed/owner/release/whole-C++ claims.
