---
task_id: TASK-ELECTRONICS-EOPT3D-001
kind: implementation
risk: high
semantic_change: yes
roadmap_slice: E-OPT-3D
prerequisites:
  - E-OPT-3C canonical scheduler and physics barrier convergence accepted in main
  - TASK-ELECTRONICS-GOVERNANCE-001 accepted hygiene checkpoint in main
acceptance_boundary: slice
review: independent
---

# E-OPT-3D - Worker/controller canonical horizon convergence

## Execution lock

Executable only when `docs/execution/current.yaml` selects exact task ID
`TASK-ELECTRONICS-EOPT3D-001` for the Electronics lane with `status: in_progress`.

## Goal

Converge Worker protocol/client/evaluator/controller and the smallest host request adapter onto the accepted canonical timed engine facade. Worker transport must carry explicit integer-microsecond requested horizons and canonical timed state rather than treating `simulationTimeMs` plus a previous legacy `SolveResult` as physical-time continuation.

This slice changes Worker/host timing transport. It does not redefine the E-OPT-3A clock contract or redesign the E-OPT-3B public timed facade.
## Component IDs

```text
electronics.clock.canonical
electronics.engine.public-api
electronics.worker.runtime
electronics.transient.runtime
```

## Minimal read set

```text
../START_HERE.md
../AGENT_GUIDE.md -> sections 4, 6-10, 11-13
../DEVELOPMENT_SPEC.md -> sections 1.3, 7.1, 8, 11.1 and 13
../ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md -> E-OPT-3 only
../contracts/CANONICAL_CLOCK_CONTRACT.md -> sections 1-3, 6, 8-13
../contracts/ENGINEERING_HYGIENE_CONTRACT.md -> legacy/decomposition rules
../evidence/hygiene-baseline.yaml -> current Worker timing legacy concerns
./E-OPT-3C.md
contexts/electronics/engine.ts
apps/web/src/electronics/simulation-worker-protocol.ts
apps/web/src/electronics/simulation-worker-client.ts
apps/web/src/electronics/simulation-worker-evaluator.ts
apps/web/src/electronics/live-simulation-worker-controller.ts
```
## Expected write paths

```text
apps/web/src/electronics/simulation-worker-protocol.ts
apps/web/src/electronics/simulation-worker-client.ts
apps/web/src/electronics/simulation-worker-evaluator.ts
apps/web/src/electronics/live-simulation-worker-controller.ts
apps/web/src/electronics/use-electronics-workbench.ts
apps/web/src/electronics/testing/simulation-worker.spec.ts
apps/web/src/electronics/testing/live-simulation-worker-controller.spec.ts
```

`use-electronics-workbench.ts` is a reviewed decomposition candidate above the hygiene threshold. Keep its change surgical: only host horizon conversion/request plumbing. Do not use this slice to decompose the workbench controller.

## Required result

```text
host scheduling -> integer requestedHorizonMicroseconds
Worker request -> generation/session + document + requested horizon + compatible timed state
Worker evaluator -> advanceElectronicsToHorizon(...)
Worker response -> ready/yielded/fault + requested/committed horizons + canonical state
controller -> commits only current-generation canonical responses
presentation callback -> only a ready observation for the requested horizon
```

Worker `computeMs` and delivery latency remain metrics only. There is no silent synchronous heavy fallback.
## Acceptance

```text
1. Worker advance transport no longer uses simulationTimeMs as canonical state.
2. Requested horizons crossing the Worker boundary are non-negative safe integer microseconds.
3. Worker timed execution delegates to the accepted E-OPT-3B timed engine facade.
4. Canonical timed state/continuation crosses requests instead of previous legacy SolveResult continuation.
5. ready/yielded/fault and requested/committed horizon relationships survive transport unchanged.
6. yielded/fault responses are never published as completed UI results for the requested horizon.
7. stale/superseded generation responses cannot replace the controller's last committed state/result.
8. Direct timed engine and Worker timed evaluator agree for the same document/state/horizon.
9. The host presentation timer may schedule requests but cannot supply floating-point physical deltas to the Worker.
10. No synchronous heavy simulation fallback is added.
11. Existing browser Worker creation and current-generation cancellation behavior remain covered.
12. Independent semantic review completes with no unresolved blocking defect.
```

## Tests / gates

```text
pnpm exec vitest run apps/web/src/electronics/testing/simulation-worker.spec.ts apps/web/src/electronics/testing/live-simulation-worker-controller.spec.ts
pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-EOPT3D-001
pnpm gate:electronics-m1
pnpm gate:electronics-m1:browser
pnpm gate:governance
```

Add only focused transport/controller tests needed for canonical horizons, yield/fault and stale-response preservation.
## Explicitly not doing

```text
no E-OPT-3E full replay/cadence equivalence programme
no E-OPT-3F pause/resume/reset/input/stale-horizon conformance programme
no solver/DeviceModel hardening
no Arduino runtime decomposition
no peripheral implementation
no Servo/HC-SR04/interrupt/IR/NeoPixel work
no unrelated UI decomposition
no deployment/restart
```

`live-simulation.ts` is an `active-legacy-bridge` in the hygiene baseline. Do not delete it merely because Worker timed execution stops calling it. Retirement requires the hygiene deletion proof and may remain blocked until E-OPT-3F or other callers/tests are migrated.

## Stop

After Worker/controller canonical horizon convergence, focused/full Electronics gates and independent semantic review pass, report E-OPT-3E as owner-selectable and STOP. Do not start replay/cadence work in the same task.