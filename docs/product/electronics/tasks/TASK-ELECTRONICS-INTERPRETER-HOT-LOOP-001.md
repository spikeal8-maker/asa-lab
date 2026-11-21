---
task_id: TASK-ELECTRONICS-INTERPRETER-HOT-LOOP-001
kind: repair
risk: high
semantic_change: 'no'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Remove repeated built-in arity table allocation

Owner resumes the remaining20 timing failures and remaining plan points3/7/9.
This is one bounded interpreter repair, not acceptance of all20 or a new scheduler.
Execution status lives only in current.yaml.

## Component and cause

Primary: `electronics.arduino.runtime` in `components/arduino-peripherals.yaml`.
Existing actual continuation profile in
`evidence/realtime-compute-cause-20261102/` attributes time to the interpreter;
`validateCallArguments` rebuilds two fixed records and their range arrays on
every invocation, including runtime millis/micros calls. Prepare those same
private immutable lookup tables once. Preserve exact values, lookup precedence,
error text, expression/command distinction and dynamic function shadow checks.
Do not fix unrelated parser/API behaviour or promise real-time performance.

## Minimal context and exact write paths

- `contexts/electronics/domain/arduino-program-runtime.ts`: only arity metadata
  and its lookup in `validateCallArguments`.
- At most one focused test file under `contexts/electronics/testing/` if an
  uncovered semantic edge actually needs regression coverage.
- Evidence under `docs/product/electronics/evidence/interpreter-arity-20261103/`.

Read the mapped runtime contract and AGENT_GUIDE sections5–13. No decomposition,
dependencies, workflow edits, limits, instruction costs, clocks, physics, worker
protocol, horizons, event ordering, quality thresholds or yield-policy changes.
No server, Docker, live DB, school data or owner asset operations.

## Acceptance

1. Narrow before/after full actual saved no-delay and independent-millis requests
   from the existing replay: compare complete responses/state/events/quality and
   optical outputs, excluding only nondeterministic computeMs. Inputs immutable.
2. Bounded paired production Vite Worker measurements using the prior canonical
   build recipe and same requests; preserve cold/order effects and raw timings.
   No indefinite profiling or speed claim from an isolated synthetic call loop.
3. Existing runtime/correctness/clock/partition/peripheral tests, focused
   `pnpm gate:electronics-m1`, unchanged caps and exact source General CI.
4. New independent exact-source semantic and evidence review. Actual unchanged
   application timing qualification is required to close any of the20 failures;
   parity or a cheaper allocation alone closes none of them.

If no measurable benefit is established, preserve the bounded evidence and stop
without merging a speculative optimization. Do not weaken timing assertions,
raise budgets or perform adjacent cleanup to make this slice pass.
