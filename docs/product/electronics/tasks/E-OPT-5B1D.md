---
task_id: TASK-ELECTRONICS-EOPT5B1D-KNOWN-UNSUPPORTED-LOCALITY-001
kind: implementation
risk: high
semantic_change: yes
roadmap_slice: E-OPT-5
prerequisites:
  - TASK-ELECTRONICS-EOPT5B1C-UNSUPPORTED-LOCALITY-001 accepted and integrated
acceptance_boundary: slice
review: independent
---

# E-OPT-5B1D — Known unsupported Arduino capabilities are board-local

## Goal

Known valid Arduino/C++ constructs that ASA does not yet execute must not stop the shared Electronics simulation.

## Scope

Production:

```text
contexts/electronics/domain/arduino-circuit-scheduler.ts
```

Focused test:

```text
contexts/electronics/testing/arduino-circuit-scheduler.spec.ts
```

If another production file is required, STOP instead of expanding scope.

## Board-local categories

```text
member-call
unsupported-call
unsupported-syntax
preprocessor
```

`unknown-call` remains global fail-closed.

## Required behavior

- unsupported editor source never executes fabricated behavior;
- with last-good firmware, the previous loaded program continues;
- without last-good firmware, the board remains safe no-loaded;
- diagnostic remains board-local with `componentId`;
- valid peer boards and the electrical simulation continue.

## Explicitly deferred

- unknown-call locality;
- runtime arithmetic-fault locality;
- micros / pulseIn / random implementation;
- Serial runtime/monitor;
- Servo / HC-SR04;
- String/preprocessor/library runtime;
- I2C / SPI / IR / NeoPixel.
