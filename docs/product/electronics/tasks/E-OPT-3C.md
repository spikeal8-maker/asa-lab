---
task_id: TASK-ELECTRONICS-EOPT3C-001
kind: implementation
risk: high
semantic_change: yes
roadmap_slice: E-OPT-3C
prerequisites:
  - E-OPT-3B canonical timed engine facade accepted in main
acceptance_boundary: slice
review: independent
---

# E-OPT-3C — Arduino scheduler and physics canonical barrier convergence

## Execution lock

Executable only when `docs/execution/current.yaml` selects exact task ID
`TASK-ELECTRONICS-EOPT3C-001` for the Electronics lane with `status: in_progress`.

## Goal

Converge the existing Arduino circuit scheduler and circuit-physics advance onto the accepted canonical clock/barrier semantics without changing the public timed engine contract accepted in E-OPT-3B. The scheduler must become the single internal orchestration foundation for canonical circuit time whether an Arduino participant is present or not.

Do not migrate Worker/controller transport or UI cadence in this slice; those belong to E-OPT-3D.

## Component IDs

```text
electronics.clock.canonical
electronics.arduino.runtime
electronics.transient.runtime
electronics.engine.public-api
```

## Minimal read set

```text
../START_HERE.md
../AGENT_GUIDE.md → §§6-10, 12-13 only
../DEVELOPMENT_SPEC.md → §§1.3, 7.1, 8 and 13 only
../ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md → E-OPT-3 only
../contracts/CANONICAL_CLOCK_CONTRACT.md
../components/engine-worker-clock.yaml → mapped components above only
./E-OPT-3B.md
contexts/electronics/engine.ts
contexts/electronics/domain/arduino-circuit-scheduler.ts
contexts/electronics/domain/arduino-program-runtime.ts
contexts/electronics/domain/simulation.ts
contexts/electronics/testing/engine-timed-api.spec.ts
contexts/electronics/testing/arduino-circuit-scheduler.spec.ts
```

Expand only when one unresolved barrier/scheduler question cannot be answered from this set.

## Expected write paths

```text
contexts/electronics/domain/arduino-circuit-scheduler.ts
contexts/electronics/domain/arduino-program-runtime.ts
contexts/electronics/domain/simulation.ts
contexts/electronics/engine.ts
contexts/electronics/testing/*clock*.spec.ts
contexts/electronics/testing/*scheduler*.spec.ts
contexts/electronics/testing/engine-timed-api.spec.ts
```

Changing `contexts/electronics/engine.ts` is allowed only to preserve the already accepted E-OPT-3B contract while internal scheduler coverage converges. Do not rename or redesign the public timed API in this slice.

## Required result

The existing scheduler foundation must implement the E-OPT-3A barrier model consistently for circuit physics and Arduino runtime:

```text
integer-microsecond canonical time
requested horizon vs committed horizon
physics advance to barrier t
ordered input application at t
electrical observation at t
all due runtime participants consume the same committed frame
atomic participant commit
bounded same-time emitted work before logical-time advance
ready vs yielded vs fault completion
```

The scheduler must also support canonical circuit-only advancement when no Arduino participant is present, so the accepted E-OPT-3B timed facade does not require a board merely to advance transient physics.

## Acceptance

```text
1. One internal scheduler/orchestration path owns canonical timed circuit advance; no third scheduler is introduced.
2. Canonical time remains integer microseconds throughout scheduler/runtime barriers.
3. Requested and committed horizons remain distinct; yielded work never reports success for the requested horizon.
4. Circuit physics advances to each barrier before due runtime participants consume the observation at that same barrier.
5. Same-time input ordering remains deterministic and append-only according to E-OPT-3A.
6. Participant updates commit atomically; partial barrier state is not externally observable.
7. Circuit-only timed advance works without requiring an Arduino component.
8. Existing Arduino sketches preserve accepted behaviour/goldens unless a separately reviewed semantic change explicitly authorizes a change.
9. The public E-OPT-3B engine API shape remains backward-compatible; this slice converges internals rather than redesigning the facade.
10. No Worker/controller/UI cadence migration occurs in this slice.
11. No peripheral-specific Servo/HC-SR04/interrupt/IR/NeoPixel implementation occurs.
12. Independent semantic review completes with no unresolved blocking defect.
```

## Tests / gates

```text
pnpm exec vitest run contexts/electronics/testing/engine-timed-api.spec.ts contexts/electronics/testing/arduino-circuit-scheduler.spec.ts
pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-EOPT3C-001
pnpm gate:electronics-m1
pnpm gate:governance
```

Add the smallest focused barrier tests required to prove circuit-only advance, Arduino+physics same-frame ordering, yield/resume and fault preservation. Do not broaden into E-OPT-3D Worker transport or UI cadence tests.

## Explicitly not doing

```text
no Worker protocol/controller horizon migration
no useElectronicsWorkbench presentation-timer migration
no solver/DeviceModel hardening
no broad Arduino runtime decomposition
no peripheral implementation
no Servo/HC-SR04/interrupt/IR/NeoPixel work
no deployment
```

## Stop

After scheduler/physics barrier convergence, focused/full Electronics gates and independent semantic review pass, report E-OPT-3D as owner-selectable and STOP. Do not migrate Worker/controller timing in the same task.
