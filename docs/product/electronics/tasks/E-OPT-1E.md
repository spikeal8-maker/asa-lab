---
task_id: TASK-ELECTRONICS-EOPT1E-001
kind: implementation
risk: high
semantic_change: no
roadmap_slice: E-OPT-1E
prerequisites:
  - E-OPT-1D direct engine consumer contract accepted in main
acceptance_boundary: slice
review: self
---

# E-OPT-1E — Worker facade convergence

## Execution lock

Executable only when `docs/execution/current.yaml` selects exact task ID
`TASK-ELECTRONICS-EOPT1E-001` for the Electronics lane with `status: in_progress`.

## Goal

Converge Worker preflight/stateless solve entry points onto the stable
`@asa-lab/electronics/engine` facade while preserving exact existing results and Worker protocol.
Existing timed advance remains an internal/provisional bridge until E-OPT-3 defines canonical time.

## Component IDs

```text
electronics.engine.public-api
electronics.worker.protocol
```

## Minimal read set

```text
../START_HERE.md
../components/engine-worker-clock.yaml → electronics.engine.public-api + electronics.worker.protocol only
../ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md → E-OPT-1 only
./E-OPT-1B.md
./E-OPT-1C.md
./E-OPT-1D.md
contexts/electronics/engine.ts
apps/web/src/electronics/live-simulation.ts
apps/web/src/electronics/simulation-worker-evaluator.ts
apps/web/src/electronics/simulation-worker-protocol.ts
apps/web/src/electronics/testing/simulation-worker.spec.ts
contexts/electronics/testing/benchmark-corpus.spec.ts
```

## Expected write paths

```text
apps/web/src/electronics/live-simulation.ts
apps/web/src/electronics/simulation-worker-evaluator.ts
apps/web/src/electronics/testing/live-simulation.spec.ts
apps/web/src/electronics/testing/simulation-worker.spec.ts
```

Do not edit solver equations, canonical clock/runtime code, Arduino runtime, component models or Worker protocol shape in this slice.

## Required result

- stateless/preflight solve uses the stable `@asa-lab/electronics/engine` facade;
- Worker preflight reaches that same stable facade rather than importing the broad simulation surface for stateless solve;
- timed `advanceLiveSimulation(...)` remains explicitly provisional/internal and may continue using existing transient internals;
- Worker protocol/version and request/response DTOs do not change;
- result metadata and solver revision remain identical;
- benchmark/golden receipts remain unchanged.

## Acceptance

```text
1. Preflight/stateless Worker path calls the stable engine facade.
2. Timed advance is not promoted into the public engine contract.
3. Worker protocol/version is unchanged.
4. Direct and Worker results remain parity-equivalent for representative stateless fixtures.
5. Existing engine boundary/public-api/consumer tests remain green.
6. Existing Electronics focused/browser gates remain green.
7. E-OPT-0 goldens remain unchanged.
```

## Tests / gates

```text
pnpm exec vitest run apps/web/src/electronics/testing/live-simulation.spec.ts
pnpm exec vitest run apps/web/src/electronics/testing/simulation-worker.spec.ts
pnpm exec vitest run contexts/electronics/testing/engine-public-api.spec.ts contexts/electronics/testing/engine-boundary.spec.ts contexts/electronics/testing/engine-consumer-contract.spec.ts
pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-EOPT1E-001
pnpm gate:electronics-m1
pnpm gate:governance
```

## Explicitly not doing

```text
no Worker protocol redesign
no timed engine API
no canonical clock work
no solver/DeviceModel refactor
no Arduino runtime work
no component/peripheral work
no deployment
```

## Stop

After declared tests/gates pass, report E-OPT-1 accepted and E-OPT-3A as owner-selectable, then STOP.
Do not start canonical clock work in the same slice.
