---
task_id: TASK-ELECTRONICS-EOPT3B-001
kind: implementation
risk: high
semantic_change: yes
roadmap_slice: E-OPT-3B
prerequisites:
  - E-OPT-3A canonical clock contract accepted in main
acceptance_boundary: slice
review: independent
---

# E-OPT-3B — canonical timed engine facade

## Execution lock

Executable only when `docs/execution/current.yaml` selects exact task ID
`TASK-ELECTRONICS-EOPT3B-001` for the Electronics lane with `status: in_progress`.

## Goal

Extend the stable `@asa-lab/electronics/engine` facade with the first public timed API that conforms to the accepted canonical clock/trace contract. Freeze only the engine-level time/horizon semantics required by E-OPT-3A; do not migrate Arduino orchestration, Worker transport or UI cadence in this slice.

## Component IDs

```text
electronics.engine.public-api
electronics.clock.canonical
electronics.transient.runtime
```

## Minimal read set

```text
../START_HERE.md
../AGENT_GUIDE.md → §§6-10, 12-13 only
../DEVELOPMENT_SPEC.md → §§1.3, 7.1, 8 and 13 only
../ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md → E-OPT-3 only
../contracts/CANONICAL_CLOCK_CONTRACT.md
../components/engine-worker-clock.yaml → mapped components above only
./E-OPT-3A.md
contexts/electronics/engine.ts
contexts/electronics/domain/simulation.ts
contexts/electronics/domain/arduino-circuit-scheduler.ts
contexts/electronics/testing/engine-public-api.spec.ts
contexts/electronics/testing/engine-boundary.spec.ts
```

Expand only when one unresolved timed-facade question cannot be answered from this set.

## Expected write paths

```text
contexts/electronics/engine.ts
contexts/electronics/domain/**
contexts/electronics/testing/engine-*.spec.ts
```

Any new domain file must remain inside the Electronics bounded context and must not import React, Web/API/DB/portal state or Worker host code.

## Required result

The public engine facade must expose canonical timed concepts defined by E-OPT-3A, including:

```text
integer-microsecond canonical horizon
requested horizon vs committed horizon
versioned/serializable continuation state boundary
ordered append-only input events
ready vs yielded vs fault completion semantics
reset/pause/resume state semantics at the engine boundary
```

Exact API names are part of this slice and become the stable timed contract after acceptance.

## Acceptance

```text
1. Public timed API uses canonical integer microseconds, not wall-clock milliseconds.
2. Requested and committed horizons are distinct and explicit.
3. Yielded work cannot be represented as a successful result for the requested horizon.
4. Timed continuation/state is versioned and serializable at the public boundary.
5. Input trace ordering is explicit and deterministic.
6. Existing non-temporal facade remains backward-compatible.
7. No React/API/DB/UI/Worker-host dependency enters the engine boundary.
8. No Arduino scheduling convergence, Worker protocol migration or UI timer migration occurs in this slice.
9. Existing E-OPT-0 goldens remain unchanged unless a separate reviewed semantic task explicitly authorizes a change.
10. Independent review completes with no unresolved semantic defect.
```

## Tests / gates

```text
pnpm exec vitest run contexts/electronics/testing/engine-public-api.spec.ts contexts/electronics/testing/engine-boundary.spec.ts
pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-EOPT3B-001
pnpm gate:electronics-m1
pnpm gate:governance
```

Add the smallest focused timed-facade tests necessary to prove the accepted E-OPT-3A invariants without broadening into E-OPT-3C/3D.

## Explicitly not doing

```text
no Arduino scheduler convergence
no Worker protocol redesign
no Worker/controller horizon migration
no useElectronicsWorkbench cadence migration
no solver/DeviceModel refactor
no peripheral implementation
no Servo/HC-SR04/interrupt/IR/NeoPixel work
no deployment
```

## Stop

After implementation, focused/full Electronics gates and independent semantic review pass, report E-OPT-3C as owner-selectable and STOP. Do not migrate Arduino/runtime scheduling in the same task.
