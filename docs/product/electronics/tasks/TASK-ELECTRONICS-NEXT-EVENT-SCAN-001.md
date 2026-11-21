---
task_id: TASK-ELECTRONICS-NEXT-EVENT-SCAN-001
kind: repair
risk: high
semantic_change: 'no'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Compute the next scheduled time once per dispatch

Owner resumes remaining20 timing failures and plan points3/7/9. Production CPU
profile `evidence/production-cpu-20261103/REPORT.md` identifies the scheduler as
substantial work. The synchronous guard-batch design was rejected before edits;
this repair preserves every existing guard and public step boundary.

Primary: `electronics.arduino.scheduler`, `components/arduino-peripherals.yaml`.
Only product path: `contexts/electronics/domain/arduino-circuit-scheduler.ts`.
At the main dispatch loop, nextTime currently scans boards/inputs/sensors/tones
and physics in the while condition, then immediately performs the same scan for
the body timestamp without an intervening mutation. Replace this with a for-loop
timestamp initialized by nextTime and refreshed in its update clause. Remove
only the duplicate body call. All continue paths recompute after the body's
mutations. Keep the final readiness scan fresh and all inner tone/physics scans.

Read exact nextTime/due selectors and the loop's continue/break/return/closure
paths before edits; selectors must be pure for supported input. No timestamp
cache across mutations, new object/metadata, model trust, guard omission, batch
API, event coalescing, clock cost, horizon, budget, quality, tolerance or cap
change. No new feature, refactoring, dependencies, workflow, server, Docker,
live DB, school data, protected asset or foreign test changes.

## Evidence

- Same complete actual8 frozen Worker requests, bounded counterbalanced
  production Vite before/after measurement (160 or320 responses,120s maximum).
  Complete responses/states/quality/optical outputs equal originals excluding
  only metrics.computeMs; caller inputs immutable. No new CPU profile.
- Existing scheduler/clock/partition/peripheral and public engine tests run
  unchanged. No new test that simply mirrors this loop rewrite. The occupied
  engine-timed-api source is read/run only, never edited by this task.
- Credible gain is required before full `pnpm gate:electronics-m1`, unchanged
  caps, exact General CI, fresh independent exact-source/evidence review and
  unchanged native application timing qualification. Any closed timing case
  requires its real original assertion to pass, not just a compute benchmark.
- Without gain, withdraw the patch and preserve concise evidence at
  `evidence/next-event-scan-20261103/`; no repeated variants or costly rerun.

The scalar rewrite is a source-supported redundancy hypothesis, not proof that
all20 failures share this cause. Preserve every existing unsupported/fault path.
