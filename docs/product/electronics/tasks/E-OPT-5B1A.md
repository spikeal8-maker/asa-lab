---
task_id: TASK-ELECTRONICS-EOPT5B1A-COMPILE-LOCALITY-001
kind: implementation
risk: high
semantic_change: yes
roadmap_slice: E-OPT-5B1A
prerequisites:
  - TASK-ELECTRONICS-EOPT5A-DESIGN-001 accepted and integrated
acceptance_boundary: slice
review: independent
---

# E-OPT-5B1A — Arduino compile failure is board-local

## Execution lock

This task is executable only when `docs/execution/current.yaml` selects
`TASK-ELECTRONICS-EOPT5B1A-COMPILE-LOCALITY-001` with `status: in_progress`.

## Goal

Implement exactly this accepted E-OPT-5 behavior:

```text
Arduino compile error != global Electronics simulation fault
```

A syntax/compile failure on one Arduino must not stop the shared Electronics
simulation. The invalid source is not executed; that board uses a safe
no-loaded-program/reset runtime state; its diagnostic remains visible and
board-local; valid peer boards and the electrical circuit continue.

## Production scope

Only:

```text
contexts/electronics/domain/arduino-circuit-scheduler.ts
```

Focused test source only:

```text
contexts/electronics/testing/arduino-circuit-scheduler.spec.ts
```

If another production file is required, STOP instead of expanding scope.

## Acceptance

1. One invalid Arduino returns `ready` or `yielded`, never global `fault`.
2. Its compile diagnostic identifies the board `componentId`.
3. Invalid source produces no GPIO/runtime events.
4. With one valid and one invalid Arduino, the valid board continues executing.
5. Reusing the returned state with the same invalid source at a later horizon is
   a valid continuation and does not become `invalid_clock_continuation`.
6. The compile diagnostic remains in `ArduinoCircuitClockAdvance.diagnostics`.
7. No last-good executable semantics are implemented in this slice.

## Explicitly forbidden

- controller/UI changes;
- `contexts/electronics/engine.ts`;
- `simulation-input-digest.ts`;
- `arduino-program-runtime.ts`;
- `solver.ts`;
- package or lockfile changes;
- last-good firmware;
- editor-source / loaded-source persistence;
- source edit while already running;
- runtime arithmetic-fault locality;
- unsupported ASA API locality;
- micros / Serial / Servo / I2C / SPI / IR / NeoPixel;
- E-OPT-5B1B or later slices.
