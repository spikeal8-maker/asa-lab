---
task_id: TASK-ELECTRONICS-SYNC-BATCH-GUARDS-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Revalidate owned models at bounded synchronous batch boundaries

Owner resumes remaining20 timing failures and plan points3/7/9. Native
production CPU evidence in `evidence/production-cpu-20261103/REPORT.md` identifies
228.049ms exclusive model-definition validation. It already runs once per public
clock-request step. Do not remove it or cache trust across public steps/yields.

## Component and bounded path set

Primary: `electronics.engine.public-api` in `components/engine-worker-clock.yaml`.
Dependencies: `electronics.worker.protocol` and `electronics.arduino.scheduler`.
Three existing boundaries are necessary for one cohesive owned-batch repair:

- `contexts/electronics/engine.ts`: callback-free bounded synchronous batch API.
- `contexts/electronics/domain/arduino-circuit-scheduler.ts`: original producer
  validation may be reused only inside that owned synchronous operation.
- `apps/web/src/electronics/simulation-worker-evaluator.ts`: use the batch while
  preserving the existing8ms cooperative deadline/cancellation/publication rules.
- At most two existing focused test files: engine-timed-api and simulation-worker
  tests. Update exact component symbols only if the public API mapping needs it.
- Evidence under `evidence/sync-batch-guards-20261103/`.

No model/solver equation, physical step, runtime instruction, event, quality,
history, clone admission, source getter, clock/horizon, cap, dependency, workflow
or startup/audio change. No server, Docker, live DB, school or owner assets.

## Required safety proof before edits

Author first reports the call/alias proof and independent reviewer checks it.
The new batch accepts no user callback or caller-asserted trusted flag. Only
already admitted private cloned data and original producers can use cached
validation. Every original canonical internal step still executes. Bound the
operation by the existing8ms host deadline and at most64 canonical steps; this
is a cooperative work grouping, not a new physics/instruction/time budget.
There is no await, externally reachable getter or arbitrary callback while the
validation lease is active. Leave the lease in finally on success/error/fault.

Existing public session.step always performs fresh validation. Every batch
entry, actual host yield, public return and later step starts a fresh validation
boundary. Mutations between calls, even if later restored, must retain existing
sticky fallback and nonpromotion behavior. Invalid/unowned/overridden-producer
routes use the original step path. Do not expose a generic callback-based trust
window to callers or silently rely on a new convention for safety.

Cancellation/generation/input behavior must preserve absence of stale output;
isCurrent cannot invoke arbitrary code inside the validation window. Explain
any changed polling locations and demonstrate the native Worker single-thread
boundary. Public older APIs and their return/state partitions remain unchanged.
If these invariants cannot be proved in this path set, STOP before a patch.

## Acceptance

1. Exact before/after same frozen production Worker workload, full160 or320
   response/state/quality/optical equality excluding only metrics.computeMs,
   caller immutability and bounded counterbalanced performance measurement.
   No further profiler; no unchanged rerun or benefit claim from isolated loops.
2. Existing ownership/retained-state/partition/parity tests; new targeted tests
   for model mutation between public steps/batches, after yields, fallback,
   dispose, cancellation and exception lease cleanup. No weakened assertions.
3. Original runtime/clock/peripheral regressions, unchanged caps and
   `pnpm gate:electronics-m1`, exact General CI, fresh independent source review.
   Preserve all foreign main source and classify unrelated CI rather than fix it.
4. Unchanged native application timing qualification before closing any of20
   failures. A measured compute improvement alone closes none of those cases.

Absent credible gain, withdraw the patch and preserve evidence. No broad
refactor, guard removal, freezing caller models, global trust memoization,
deadline increase, clock reanchor or discarded simulation debt is authorized.
