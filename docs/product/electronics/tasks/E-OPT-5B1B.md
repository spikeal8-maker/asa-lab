---
task_id: TASK-ELECTRONICS-EOPT5B1B-LAST-GOOD-001
kind: implementation
risk: high
semantic_change: yes
roadmap_slice: E-OPT-5
prerequisites:
  - TASK-ELECTRONICS-EOPT5B1A-COMPILE-LOCALITY-001 accepted and integrated
acceptance_boundary: slice
review: independent
---

# E-OPT-5B1B — Last-good Arduino program

## Goal

Preserve the last successfully loaded Arduino program when the editor source becomes malformed.

## Required behavior

- valid A loads and runs;
- malformed B never executes and does not replace A;
- A continues while B's compile diagnostic remains board-local;
- with no previous loaded program, malformed source uses safe no-loaded state;
- valid C replaces A; a later malformed B continues C;
- an `arduinoSource`-only edit does not itself create a new canonical generation/reset;
- a real structural circuit edit still creates a new generation.

## Starting production scope

```text
contexts/electronics/domain/arduino-circuit-scheduler.ts
contexts/electronics/domain/simulation-input-digest.ts
apps/web/src/electronics/live-simulation-worker-controller.ts
```

Focused tests may change only where required for these production surfaces.

Do not change `arduino-program-runtime.ts`, `engine.ts`, or `solver.ts` if this contract is achievable without them.

## Explicitly not doing

- micros;
- Serial implementation;
- Servo;
- HC-SR04;
- other peripherals;
- runtime arithmetic-fault locality;
- unsupported ASA API locality;
- any later E-OPT-5 slice.
