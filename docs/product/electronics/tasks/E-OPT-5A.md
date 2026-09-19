---
task_id: TASK-ELECTRONICS-EOPT5A-DESIGN-001
kind: design-decision
risk: high
semantic_change: yes
roadmap_slice: E-OPT-5
prerequisites:
  - E-OPT-3A..3F accepted and integrated
  - TASK-ELECTRONICS-GOVERNANCE-003 accepted
acceptance_boundary: slice
review: independent
---

# E-OPT-5A — Arduino runtime backend strategy design spike

## Goal

Select the normative runtime architecture for E-OPT-5 Arduino Runtime Hardening without changing production runtime semantics.

The decision must compare exactly three architectural families:

1. continue the deterministic source-level TypeScript runtime;
2. AVR machine-code emulation;
3. a concrete hybrid source-level + AVR/reference/emulation architecture.

No candidate is preselected.

## Frozen evaluation criteria

The decision must evaluate all candidates against these criteria before selecting a strategy:

1. canonical determinism;
2. compatibility with the accepted E-OPT-3 clock;
3. Arduino sketch compatibility;
4. correctness against Uno / ATmega328P behavior;
5. diagnostics quality for students;
6. browser feasibility;
7. Worker compatibility;
8. state serialization / save-resume;
9. execution performance;
10. bundle/toolchain size;
11. memory cost;
12. startup/compile latency;
13. peripheral extensibility;
14. Serial feasibility;
15. pulseIn / micros feasibility;
16. PWM/timer feasibility;
17. failure isolation / infinite-loop protection;
18. licensing;
19. security / untrusted sketch handling;
20. portability;
21. implementation effort;
22. long-term maintenance cost.

Criteria may not be changed after a preferred candidate emerges unless the decision artifact explicitly records the reason.

## Hard constraints

Every accepted architecture must preserve:

- canonical physical time owned by the Electronics clock;
- no browser wall-clock as physics;
- no third independent scheduler;
- deterministic replay;
- Worker-compatible execution;
- bounded work / no UI freeze;
- serializable canonical state where required;
- stale-generation protection;
- explicit failure for unsupported behavior;
- server/reference verification;
- no arbitrary host JavaScript execution by user sketches.

Owner semantic correction adds two further hard constraints before independent review:

- `permissive_user_start_and_fail_local_errors`: learner-correctable circuit, wiring, code, compile, runtime or simulator-capability diagnostics may not disable Start or tear down the complete Electronics simulation session;
- `arduino_compile_success_required_to_replace_loaded_program`: editor source and loaded executable are distinct target concepts; only a successful compile/load may replace the executable program for a board.

These owner constraints were added after the initial candidate `038ece8f7af63f70b23270a6be1f8573889b9d88`. The initial 22 evaluation criteria remain unchanged. All three candidates must be re-evaluated against the added constraints before independent review. This chronology must remain explicit; the correction must not claim that the new owner constraints existed before the initial candidate.

Any candidate violating a hard constraint must be rejected regardless of Arduino compatibility.

## Required evidence

- factual baseline of current TypeScript source-level runtime and legacy clock bridge;
- existing supported/unsupported capability baseline;
- existing AVR GCC/simavr reference proof distinguished from a production AVR backend;
- compatibility matrix using existing Arduino tests/evidence;
- reproducible source-level measurements for parse/compile latency, execution throughput, memory/state size and serialized state size;
- browser/Worker feasibility for every candidate;
- server verification model for every candidate;
- E-OPT-6 prerequisite impact for Servo, HC-SR04/PING, PIR, Serial Monitor, I2C, SPI, IR and NeoPixel;
- security and licensing analysis;
- migration impact from legacy-ms-v1 / advanceArduinoRuntime to the selected architecture;
- exact selected strategy or exact BLOCKED_BY proof.

## Expected write paths

```text
docs/product/electronics/tasks/E-OPT-5A.md
docs/product/electronics/decisions/ARDUINO_RUNTIME_STRATEGY.md
docs/product/electronics/evidence/eopt5a-runtime-strategy.yaml
```

`docs/execution/current.yaml` is updated only from the canonical main control plane.

Minimal routing documentation may change only if the existing validator contract requires registration.

## Explicitly not doing

```text
no production Arduino runtime change
no arduino-model.ts change
no solver.ts change
no scheduler change
no capabilities change
no apps/web Electronics change
no test rewrite
no package.json change
no pnpm-lock.yaml change
no production Docker dependency change
no micros implementation
no pulseIn implementation
no Serial implementation
no Servo/I2C/SPI/IR/NeoPixel implementation
no legacy-ms-v1 removal
no advanceArduinoRuntime removal
no production caller migration
no E-OPT-5B
no E-OPT-4
no E-OPT-6/peripherals
no Issue #304 activation
no deployment
```

## Future implementation acceptance matrix

E-OPT-5A adds no implementation or tests. A later separately selected implementation slice must prove at minimum:

1. valid circuit + valid program → Start succeeds and simulation runs normally;
2. dangerous but supported circuit → Start succeeds and modeled physics/damage is shown;
3. wrong pin/wiring → Start succeeds and actual wrong behavior is shown;
4. Arduino syntax/compile error → lab Start succeeds, compile diagnostic is local, invalid new source does not execute;
5. previously loaded valid program A + invalid edited program B → B compile fails, A remains loaded/executable, laboratory continues;
6. valid Arduino code using an ASA-unsupported API → not mislabeled as compile error, local unsupported-capability diagnostic, no fabricated API result, lab remains active;
7. two Arduino boards with one broken → healthy board continues, failing board remains local;
8. non-Arduino subcircuit + broken Arduino program → electrical subcircuit remains simulatable.

The implementation slice must also distinguish genuine infrastructure failures that may stop a session: Worker crash, protocol/version mismatch, corrupt canonical continuation, unrecoverable internal engine failure, or a document that cannot be parsed into an Electronics document.

The exact post-runtime-fault retention semantics for last committed GPIO, `pinMode`, PWM and tone state are intentionally deferred to that implementation slice.

## Acceptance

1. The initial 22 evaluation criteria remain frozen; the later owner hard-constraint addition and re-evaluation chronology are explicit.
2. All three candidates are genuinely evaluated.
3. Hard constraints are checked explicitly.
4. Performance claims are reproducible.
5. External licensing/toolchain claims identify exact project/version/source where applicable.
6. Browser and Worker feasibility are explicit.
7. Canonical Electronics clock remains sole physical-time authority.
8. Legacy clock migration path is credible but not implemented.
9. Peripheral prerequisite impact is explicit.
10. One exact strategy is selected or the task is blocked by a named missing proof.
11. Production/test/runtime dependencies remain byte-identical.
12. Required governance/control-plane validators pass.
13. Independent review remains pending; the author does not self-accept.

## Stop

After a complete design candidate, Draft PR and validation, set the Electronics lane to `in_review` at `eopt5a_runtime_strategy_independent_review_pending`, keep `owner_acceptance: pending` and `next_task: null`, then STOP / CONTROLLER REVIEW.
