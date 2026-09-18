---
task_id: TASK-ELECTRONICS-EOPT3F-001
kind: analysis/inventory
risk: high
semantic_change: no
roadmap_slice: E-OPT-3F
prerequisites:
  - E-OPT-3E accepted
acceptance_boundary: slice
review: independent
---

# E-OPT-3F — canonical runtime conformance

## Execution lock

This card is planned only. It is executable only when `docs/execution/current.yaml`
selects `TASK-ELECTRONICS-EOPT3F-001` with `status: in_progress`.
Creation of this card does not select or authorize E-OPT-3F.

## Goal

Prove the accepted canonical clock contract across runtime lifecycle and trace
boundaries after E-OPT-3E replay equivalence is accepted.

## Required conformance surface

The future characterization matrix must cover:
- reset;
- pause;
- resume;
- runtime input conformance;
- same-time input ordering;
- stale horizon rejection;
- stale generation/session rejection;
- continuation state;
- canonical replay segment boundaries.

The first pass is evidence/characterization. Production repair is not implicitly
authorized. A real production divergence must be reported and returned to the
controller for a separately bounded repair decision.

## Acceptance

1. Reset/pause/resume preserve canonical-time invariants.
2. Runtime input ordering, including same-time groups, remains deterministic.
3. Stale horizons and stale generation/session results fail closed.
4. Continuation and replay segment boundaries preserve normalized committed state.
5. Exact characterization evidence identifies any unsupported edge explicitly.
6. Independent review completes with no unresolved blocker.

## Explicitly forbidden scope

Do not use E-OPT-3F to implement or harden:
- solver / DeviceModel;
- Arduino runtime decomposition;
- Servo;
- HC-SR04 / PING;
- PIR;
- Serial;
- I2C / SPI;
- IR;
- NeoPixel;
- deployment.
