---
task_id: TASK-ELECTRONICS-EOPT5B1C-UNSUPPORTED-LOCALITY-001
kind: implementation
risk: high
semantic_change: yes
roadmap_slice: E-OPT-5
prerequisites:
  - TASK-ELECTRONICS-EOPT5B1B-LAST-GOOD-001 accepted and integrated
acceptance_boundary: slice
review: independent
---

# E-OPT-5B1C — Unsupported Arduino capability is board-local

## Goal

A valid Arduino program that uses an ASA-unsupported capability must not stop the shared Electronics simulation.

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

## Required behavior

- `member-call` / `Serial.println(...)` is a board-local unsupported diagnostic;
- unsupported source never executes fabricated behavior;
- without last-good firmware the board stays in safe no-loaded state;
- with last-good firmware the previous loaded program keeps running;
- valid peers and the electrical simulation continue.

## Explicitly deferred

- ambiguous `unknown-call` locality;
- runtime arithmetic-fault locality;
- micros / pulseIn;
- Serial Monitor/runtime;
- Servo / HC-SR04;
- I2C / SPI / IR / NeoPixel.
