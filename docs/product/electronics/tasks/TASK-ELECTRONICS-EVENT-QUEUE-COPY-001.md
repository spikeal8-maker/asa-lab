---
task_id: TASK-ELECTRONICS-EVENT-QUEUE-COPY-001
kind: repair
risk: high
semantic_change: 'no'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Remove a redundant owned runtime event-array copy

One bounded repair for remaining plan points3/7/9 and the20 timing failures.
The preceding arity-table experiment had no demonstrated benefit and its
runtime change is withdrawn. Do not combine that patch with this experiment.
Live execution status is only in current.yaml.

## Component and scope

Primary: `electronics.arduino.runtime`, `components/arduino-peripherals.yaml`.
Exact product file: `contexts/electronics/domain/arduino-program-runtime.ts`.
Inspect `advanceRuntime`: its local eventQueue already copies previous.eventQueue
before any write. The owned return path copies this new array a second time.
Prove whether any closure retains and later mutates the local array; only if
there is none, remove that second copy. Keep the first defensive copy, event
objects, order, sequence, truncation, queue limit, fault clearing and all public
state semantics. No event coalescing, history dropping or new runtime branch.

One focused test may be added in `contexts/electronics/testing/` if existing
ownership/retained-snapshot tests lack an actual mutation or truncation case.
Evidence belongs under `evidence/event-queue-copy-20261103/`.
No other source, workflow, dependencies, clock, physics, instruction cost,
yield policy, horizons, quality limits, cap or ownership admission changes.
No server, Docker, live DB, school data, foreign WIP or protected asset actions.

## Evidence and stopping boundary

1. Before mutation, inspect all eventQueue aliases/callback lifetimes and the
   retained-state/continuation tests. Missing isolation proof means STOP.
2. Use the existing8 full frozen no-delay/millis requests through the same
   production Vite ES Worker recipe, bounded paired counterbalanced measurements
   at most120s total. Full responses and states must match originals excluding
   only metrics.computeMs; inputs immutable. Keep exact patch/source/build hashes.
3. If benefit is absent or inconsistent, preserve evidence and withdraw the
   source patch without full CI or further variants. No native failures close.
4. If benefit is credible: ownership and saved-state mutation/truncation tests,
   existing runtime/clock/partition/peripheral regressions, unchanged-cap
   `pnpm gate:electronics-m1`, exact General CI and fresh independent review.
   Use unchanged native timing qualification before closing any of the20 cases.

This is a source-proven redundant allocation hypothesis, not a measured dominant
hotspot. The old CPU profile does not isolate snapshots or array copies as the
main cost. Do not claim all20 share this cause or start adjacent optimization.
