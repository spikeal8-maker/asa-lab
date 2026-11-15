---
task_id: TASK-ELECTRONICS-INCREMENT-EXPRESSION-001
kind: repair
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Correct increment/decrement in expressions

Consolidated16/17, separate defect discovered by independent do-while review.
Planning until canonical selection. Existing prefix ++checks is parsed as two
unary pluses without mutation. Baseline80cf,2d84 anddo candidate all reproduce:
int total=0; int checks=0; setup while(++checks<3 && total<3) total++;
observedtotal3 checks0 withoutdiagnostics; expectedtotal2 checks3.

Implement proper prefix/postfix ++/-- value and mutation for supported writable
scalar lvalues, including parenthesized identifiers if supported by existing
expression grammar. Reject non-lvalues/const/invalid forms explicitly; do not
accept them as chains of unary operators. Preserve ordinary spaced unary signs,
operator precedence, typed overflow policy, scope and existing standalone/for
increment behavior. No generic expression refactor or new unsupported language.

Validate skipped branches without mutation; short-circuit and conditional
evaluation counts, call arguments, arithmetic/comparisons and nested scopes.
No PRNG or switch work. Source/runtime version, instruction costs, scheduler,
physics and old valid nonincrement-expression streams/state remain unchanged.
Capture BEFORE and compare old complete state/events/fingerprints.

Independent review rejected7ab3: pulseIn(n++,HIGH,5) reevaluates n++ on resume.
Controller authorizes narrowly OPTIONAL pending-instruction evaluation journal
only for new increment plus blocking-call instructions. Preserve true once-only
evaluation and visible pending n=3, including prior Serial/ADC/micros reads,
siblings/compound expressions, macros and multiple waiting calls. Do not choose
binding rollback approximation or reject otherwise supported valid arguments.
Cache completed token-evaluator subtrees, resume pending calls without replaying
effects. Existing state version/protocol stay; untouched old valid programs omit
the field byte-for-byte. Strict typed finite/bounded entries and PC/program/wait
association; clear on completion/fault/reset. Old broken unpublished increment-
wait continuations without journal must fail matching/reset, not resume twice.
Update only directly necessary state clone/validation paths, no generic runtime
redesign. Negative malformed-journal and JSON budget continuation proof required.

Actual Worker Serial/GPIO source examples plus direct parity, budgets1/2/7 and
JSON continuation, delay/loops/Stop/Reset/source edits; accurate diagnostics and
existing const/read tests. New independent finalSHA review and adversarial
cases. Fresh focused gate literalNX_SKIP_NX_CACHE=true types/build and fixed
caps222000/2000000. No capraise/dependencies/refactor/deferredcleanup/682,
foreign repairs, protected assets, server Docker DB or deployment.
One bounded candidate then STOP.
