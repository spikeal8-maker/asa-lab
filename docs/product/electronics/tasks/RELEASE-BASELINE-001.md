---
task_id: TASK-ELECTRONICS-RELEASE-BASELINE-001
kind: repair
risk: high
semantic_change: no
roadmap_slice: null
prerequisites:
  - Owner requested portable release activation and resolution of existing Electronics gate failures
acceptance_boundary: slice
review: independent
---

# Restore the existing release baseline

Repair the existing Arduino editor/engine contract drift and classify the benchmark
receipt mismatch so the owner-requested portable release can pass the normal gates.
This does not accept a future Electronics milestone or authorize new peripherals.
The previous lane selection was E-OPT-5B1D / issue 319; its historical card and
evidence remain unchanged, and this repair does not claim its acceptance.

Primary component: `electronics.arduino.capabilities`, routed through
`../components/arduino-peripherals.yaml`. The bounded additional lookup is the
existing solver result and benchmark receipt to explain the reported fingerprint.

## Scope

- `apps/web/src/electronics/arduino-command-reference.ts`
- `apps/web/src/electronics/arduino-source-language.ts`
- `apps/web/src/api.ts` (existing optional Servo result only)
- `apps/web/src/electronics/testing/arduino-source-language.spec.ts`
- `apps/web/src/electronics/testing/live-simulation.spec.ts` (unsupported fixture;
  PIR now has an implemented model)
- `contexts/electronics/testing/benchmark-corpus.spec.ts`
- benchmark fixture/generator only if a result-by-result comparison justifies it
- hygiene baseline and a bounded review record for Arduino runtime growth

The code budget is three production files and three focused test files; the extra
fixture preserves the unsupported-circuit assertion after PIR gained a model. Existing
Servo/ultrasonic semantics are read from the registry/runtime, not invented here.
No solver equations, canonical time, runtime semantics, owner media, database or
permission changes. No blind golden regeneration and no disabled assertions.

## Acceptance and evidence

Run Electronics routing, focused editor tests, the complete Electronics tests,
uncached types/build and normal GitHub general/focused gates. A receipt correction
requires evidence identifying every changed field and independent review. Preserve
the original historical receipt when changing the current comparison format.

Read `../contracts/ENGINEERING_HYGIENE_CONTRACT.md` and update the reviewed size
only after recording current responsibilities and retained decomposition debt.
Stop this repair after the gates and review; deployment is the separately
owner-authorized portable activation operation.
