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
When the lane is `in_review`, this card is review-only: no additional production scope is
authorized. A review-found production repair must return to an explicitly executable
`in_progress` checkpoint before editing.

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

## Acceptance-repair expansion

Activating the canonical Worker boundary can expose assumptions that were previously hidden by
the legacy timed path. The following additional paths are permitted **only** for the smallest
acceptance repair required to preserve the already accepted E-OPT-3A/3B/3C semantics and make
the E-OPT-3D gates truthful:

```text
contexts/electronics/domain/arduino-circuit-scheduler.ts
contexts/electronics/testing/arduino-circuit-scheduler.spec.ts
contexts/electronics/testing/engine-timed-api.spec.ts
apps/web/src/electronics/testing/workbench-presentation.spec.ts
e2e/electronics-simulation.spec.ts
docs/product/electronics/evidence/hygiene-baseline.yaml
docs/product/electronics/generated/component-coverage.json
```

Allowed acceptance repairs are limited to defects directly exposed by canonical Worker
convergence, such as zero-horizon continuation, yielded-target completion, append-only live-input
ordering/retiming, passive no-source observations required by supported instruments, and carried
physical state required for an already supported failure model.

This expansion does **not** authorize a new solver family, broad scheduler redesign, E-OPT-3E
cadence/replay completion, E-OPT-3F conformance completion, E-OPT-4 DeviceModel hardening,
E-OPT-5 runtime decomposition, or any new peripheral. Generated coverage is regenerated only
when the bounded acceptance evidence changes; the hygiene baseline may change only to classify
the exact bridge made obsolete or still retained by this slice.

Any repair outside these paths/causes is a scope expansion and requires a separately selected
task or design decision.

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

## Delegated automated behavioural acceptance

For this slice, manual owner preview is waived. Owner acceptance is explicitly delegated to reproducible automated evidence and requires all of the following on the final exact candidate SHA:

```text
1. exact-SHA automated behavioural evidence passes;
2. required exact-SHA Electronics and governance CI passes;
3. independent semantic review/rereview passes;
4. unresolved BLOCKING findings = 0.
```

The behavioural evidence must include the permanent real-browser Arduino Reset-after-progress scenario and the existing representative UI evidence for Arduino live inputs, multimeter resistance, and persistent motor failure, plus the Worker passive no-source regression and controller same-timestamp retiming regression.

This delegation does not authorize product repair, a new feature, E-OPT-3E, E-OPT-3F, peripheral work, deployment, or acceptance before the evidence is complete. `owner_acceptance` remains `pending` until the automated acceptance record is complete and the merge/closure boundary is executed.

## Tests / gates

```text
pnpm exec vitest run apps/web/src/electronics/testing/simulation-worker.spec.ts apps/web/src/electronics/testing/live-simulation-worker-controller.spec.ts
pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-EOPT3D-001
pnpm gate:electronics-m1
pnpm gate:electronics-m1:browser
pnpm gate:governance
```

Add only focused transport/controller tests and behavioural acceptance evidence needed for canonical horizons, reset, yield/fault, live-input ordering and stale-response preservation.
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