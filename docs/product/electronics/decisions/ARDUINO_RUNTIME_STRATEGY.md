# Arduino Runtime Strategy вЂ” E-OPT-5A

**Task:** `TASK-ELECTRONICS-EOPT5A-DESIGN-001`
**Roadmap:** E-OPT-5 вЂ” Arduino Runtime Hardening
**Decision date:** 2026-09-19
**Evaluated baseline:** `f8752c6e54bdd2489a6de5ce3a43c2260be9819e`

## Decision

```text
SELECTED: SOURCE_LEVEL
```

ASA Lab will continue the existing deterministic source-level TypeScript Arduino runtime as the production execution architecture for E-OPT-5.

The production clock profile converges on `instruction-us-v1` under the accepted canonical Electronics scheduler. AVR machine-code execution remains an independent reference/parity technique rather than the product runtime. A production hybrid backend is not selected.

This is not a claim of full Arduino C++ compatibility. The production contract remains an explicit educational subset with fail-closed unsupported behavior.

## Context

Current production/runtime facts:

- `arduino-program-runtime.ts` owns parser/runtime/state;
- `arduino-values.ts` models the current Uno-oriented numeric subset;
- `arduino-circuit-scheduler.ts` owns canonical scheduling/barriers;
- the canonical scheduler requires `instruction-us-v1`;
- `advanceArduinoRuntime(...)` still explicitly selects `legacy-ms-v1`;
- external production callers of that legacy wrapper include `arduino-model.ts` and `solver.ts`;
- runtime state is serializable and separate from the saved schematic document;
- incompatible clock profiles already restart rather than reusing incompatible continuation state.

Compatibility baseline run during this spike:

```text
pnpm exec vitest run   contexts/electronics/testing/arduino-correctness.spec.ts   contexts/electronics/testing/arduino-runtime-state.spec.ts   contexts/electronics/testing/arduino-values.spec.ts   contexts/electronics/testing/arduino-execution-clock.spec.ts   contexts/electronics/testing/arduino-circuit-scheduler.spec.ts   contexts/electronics/testing/arduino-capabilities.spec.ts   --reporter=dot
```

Result: **6 test files / 148 tests PASS**. No test source changed.

## Current capability baseline

Supported or intentionally limited today:

- `setup` / `loop`;
- `pinMode`;
- `digitalWrite` / `digitalRead`;
- `analogRead`;
- limited `analogWrite`;
- `delay`;
- `delayMicroseconds`;
- limited `millis`;
- GPIO / ADC;
- limited PWM;
- limited `tone` / `noTone`;
- bounded numeric/control-flow subset;
- serializable runtime state;
- `instruction-us-v1` canonical scheduler path.

Currently unsupported or outside the implemented subset:

- `micros()`;
- `pulseIn()`;
- `Serial.begin/print/println/available/read`;
- Servo runtime;
- I2C;
- SPI;
- IR;
- NeoPixel;
- full String/char semantics;
- `switch/case`;
- `do...while`;
- `random/randomSeed`;
- arbitrary Arduino C++ compatibility.

## Hard constraints and owner correction chronology

The initial candidate `038ece8f7af63f70b23270a6be1f8573889b9d88` was evaluated against these non-negotiable constraints:

1. canonical physical time remains owned by the Electronics clock;
2. browser wall-clock never becomes physics;
3. no third independent scheduler;
4. deterministic replay remains valid;
5. Worker-compatible execution;
6. bounded work / no UI freeze;
7. serializable canonical state where required;
8. stale generation protection;
9. unsupported behavior fails explicitly;
10. server/reference verification remains possible;
11. user sketches cannot execute arbitrary host JavaScript.

After that initial candidate, the owner added an explicit product requirement before independent review. Two related hard constraints are therefore added now:

12. `permissive_user_start_and_fail_local_errors` — learner-correctable circuit, wiring, compile, runtime or simulator-capability errors may not disable Start or tear down the complete Electronics simulation session;
13. `arduino_compile_success_required_to_replace_loaded_program` — editor source and the board's loaded executable are distinct target concepts; only a successful compile/load may replace the executable program.

This chronology is intentional. The correction does **not** claim that constraints 12–13 existed before the initial candidate. All three architectural candidates are re-evaluated against them below before independent review.

## Frozen evaluation criteria

The E-OPT-5A task card froze these 22 evaluation criteria before the initial candidate:

canonical determinism; E-OPT-3 clock compatibility; sketch compatibility; Uno/ATmega328P correctness; student diagnostics; browser feasibility; Worker compatibility; state serialization; execution performance; bundle/toolchain size; memory cost; startup/compile latency; peripheral extensibility; Serial feasibility; pulseIn/micros feasibility; PWM/timer feasibility; failure isolation; licensing; security; portability; implementation effort; long-term maintenance cost.

Those 22 evaluation criteria were not changed after a preferred candidate emerged. The owner correction adds hard product invariants, not retrospective scoring criteria.

## Owner invariant — simulation remains startable for learner errors

The product invariant is normative, not UI advice:

```text
fail-closed calculation != fail-to-start simulation
```

Once an Electronics document is open and the editor can create a runtime session, learner-correctable errors must not disable Start. This includes wrong wiring, open circuit, reverse polarity, overcurrent/overvoltage, component damage, wrong Arduino pin, Arduino compile/runtime diagnostics, unsupported ASA Arduino APIs and unsupported modeled topology/component capability.

After Start, the simulation session is entered even when one subsystem cannot provide a trustworthy result. That subsystem must fail closed locally, report a local diagnostic and avoid fabricated values. A diagnostic is not itself permission to tear down the complete laboratory.

This preserves the existing mathematical decisions: unsupported topology remains fail-closed; dangerous supported circuits remain calculable; solve status remains separate from health/damage/presentation; and post-failure calculation continues for the remaining supported circuit.

### Infrastructure failure remains distinct

The permissive-start invariant does not require the product to ignore infrastructure failures. The session may stop when the document cannot be parsed/loaded as an Electronics document, Worker/engine infrastructure is unavailable, protocol/version state is corrupt, canonical continuation is corrupt, or an unrecoverable internal engine failure occurs.

```text
learner mistake != infrastructure failure
```

### Arduino compile/load semantics

Editor source and loaded executable are distinct target states:

```text
edit source
→ compile
→ only successful compile/load may replace loaded executable
```

A real syntax/compile error means the new invalid source does not execute and cannot emit partial new GPIO. The compile diagnostic is shown with source location. If valid program A was already loaded and edited program B fails compilation, A remains the last successfully loaded executable and the electrical laboratory continues running. If no program has ever loaded successfully, compile failure must not invent firmware; the board remains in a defined reset/default executable state while the electrical laboratory remains active.

The exact reset/default pins and post-runtime-fault retention of last committed GPIO, `pinMode`, PWM and tone are deferred to the next bounded implementation slice.

### Simulator capability diagnostics are not compile errors

Valid Arduino source using an ASA-unsupported API such as `micros()`, `pulseIn()`, Serial, Servo or I2C must not be mislabeled as an Arduino compile error merely because ASA cannot yet simulate it. It is an ASA simulation capability diagnostic. The unsupported call must not be partially simulated or return fabricated data, but the laboratory session remains active.

### Wrong wiring and dangerous circuits

Wrong pins, missing ground, reverse polarity or an undersized resistor are not compile failures and are not Start blockers. Code executes according to the actual program and the circuit according to the actual wiring. The learner sees the modeled result: no light, a different pin changing, no sensor response, overcurrent, heating or damage.

### Multi-board isolation

For multiple Arduino boards, source, compile/load state, runtime state, diagnostics and program identity are per-board while physical time remains one canonical Electronics clock. A compile/runtime failure on board B must not automatically stop healthy board A, an independent non-Arduino subcircuit or the whole simulation session.

### Current implementation conformance

The current UI already has the correct starting direction: the Start button is disabled by transient editor `busy` state rather than electrical/program diagnostics, and `toggleSimulation()` enters the running session immediately before calculations complete.

However, current live Worker controller behavior is not yet fully conformant: any canonical `executionStatus = fault` enters `fail(...)`, which clears the active generation and cancels it.

```text
CURRENT_ALWAYS_START_CONFORMANCE: incomplete
```

E-OPT-5A does not change this code. The next bounded E-OPT-5 implementation slice must separate learner-local board/subsystem failure from infrastructure/session failure.

## Existing AVR reference foundation

The repository already contains a real independent AVR reference proof:

```text
tools/run-arduino-numeric-reference.sh
```

It pins Arduino AVR core 1.8.6, AVR GCC 7.3.0-atmel3.6.1-arduino7, ATmega328P at 16 MHz, simavr and gdb-avr. The repository README records the historical reference run with simavr `1.6+dfsg-3` and gdb-avr `12.1-1+b5`.

That is an independent truth source for selected numeric semantics, not a production AVR backend.

For browser AVR feasibility, this spike reviewed AVR8js. As of 2026-09-19 the npm registry reports `avr8js 0.21.1`, MIT licensed, with no runtime dependencies. Its own documentation states that it implements the AVR CPU core for browser/Node use but requires precompiled machine code and separate functional models for external hardware.

External sources reviewed:

- https://www.npmjs.com/package/avr8js
- https://github.com/wokwi/avr8js
- https://github.com/buserror/simavr
- https://github.com/arduino/ArduinoCore-avr/releases
- https://github.com/arduino/toolchain-avr

No external package was added to ASA Lab.

## Measured source-level evidence

A temporary untracked Vitest harness was used and removed after measurement. Repository status returned clean.

Environment:

```text
Node v24.14.1
Vitest v3.2.7
Windows host
activation SHA f8752c6e54bdd2489a6de5ce3a43c2260be9819e
```

Representative sketch:

```cpp
unsigned long count=0;
void setup(){pinMode(13,OUTPUT);}
void loop(){count++;digitalWrite(13,count%2);delayMicroseconds(10);}
```

Protocol:

- 50 parse/compile warmups;
- 1,000 calls to `analyseArduinoProgramSyntax`;
- 20 execution warmups;
- 200 fresh executions to a 20 ms canonical horizon;
- work quantum 16,384 instructions;
- state size measured as UTF-8 JSON bytes and Node V8 serialization bytes.

Observed:

| Measurement | Result |
| --- | ---: |
| Parse/compile total, 1,000 runs | 33.253 ms |
| Parse/compile mean | 0.033253 ms |
| Execution total, 200 Г— 20 ms horizons | 1871.983 ms |
| Execution mean per fresh 20 ms horizon | 9.359913 ms |
| Simulated ms / wall-clock ms | 2.137Г— |
| Mean work quanta per run | 1 |
| Final loop iterations | 1429 |
| Rolling event queue length | 256 |
| JSON state size | 24,295 bytes |
| V8 serialized state size | 21,721 bytes |
| Clock profile | instruction-us-v1 |
| Final virtual time | 20 ms |

These values characterize this host and representative sketch only; they are not universal performance guarantees.

## Candidate A вЂ” source-level TypeScript runtime

Architecture:

```text
Arduino educational subset
  -> TypeScript parser/runtime/state
  -> instruction-us-v1
  -> canonical Arduino circuit scheduler
  -> GPIO/timed events/circuit coupling
```

Strengths:

- already integrated with accepted E-OPT-3 time/scheduler semantics;
- deterministic replay, bounded work quantum/yield and serializable continuation already exist;
- existing Worker path consumes the canonical scheduler boundary;
- source-level unsupported/syntax/runtime diagnostics are student-readable;
- no native compiler or machine-code toolchain is required in the browser;
- missing E-OPT-5 timing primitives can be added without another scheduler.

Limits:

- not arbitrary Arduino C++;
- language/API expansion has ongoing source-level compatibility cost;
- `instruction-us-v1` is deterministic microsecond execution, not AVR cycle emulation;
- register-level code and arbitrary third-party libraries remain unsupported unless modeled.

E-OPT-5 timing path:

- `micros()`: expose canonical microsecond time;
- `pulseIn()`: bounded suspension over timestamped edge/input history with timeout;
- Serial: deterministic serialized RX/TX buffers/events with UI adapter;
- Servo/PWM/tone: canonical timed output events;
- protocols/peripherals: separate bounded slices.

Browser: **yes, proven**.
Worker: **yes, proven**.
Server/reference: shared TypeScript runtime plus AVR reference parity where needed.
Per-tick server round trip: **no**.

## Candidate B вЂ” AVR machine-code emulation

Concrete feasibility family:

```text
Arduino source
  -> AVR compiler/core
  -> ELF/HEX
  -> AVR8js 0.21.1 or equivalent AVR emulator
  -> GPIO/timer/UART/SPI/TWI bridge
  -> canonical Electronics clock
```

The current simavr path remains reference-only. simavr is GPL-3.0 and native; it is not suitable as the browser live backend.

Strengths:

- broader potential C/C++ / Arduino core compatibility;
- closer register/timer/interrupt behavior;
- browser/Node ATmega328P execution is feasible with AVR8js.

Required additional architecture:

- bounded compiler/toolchain path;
- versioned compiler/core artifacts;
- compile caching/latency limits;
- cycle-to-canonical-horizon adapter;
- GPIO/timer/UART/SPI/TWI to circuit bridge;
- complete emulator continuation serialization or deterministic replay contract;
- source mapping and student-facing runtime diagnostics;
- compiler/emulator sandbox and resource quotas.

Browser runtime: **yes in principle via AVR8js**.
Browser source compilation: **not provided by AVR8js; separate compiler path required**.
Worker runtime: **feasible**.
Server verification: feasible, but cross-emulator equivalence must be explicit.

Licensing:

- AVR8js 0.21.1: MIT;
- simavr: GPL-3.0;
- Arduino AVR core/reference material contains component-level LGPL/GPL notices rather than one simple redistribution surface;
- AVR GCC/toolchain redistribution carries GNU licensing obligations.

Why not selected: candidate B can satisfy the hard constraints, but adds compiler/toolchain distribution, binary lifecycle, emulator-state serialization, hardware bridging and source-map diagnostics before the declared educational subset requires those costs. The existing AVR reference path already supplies hardware-oriented independent truth.

## Candidate C вЂ” hybrid production runtime

Concrete evaluated shape:

```text
source-level backend for supported educational subset
+
AVR machine-code backend for broader sketches
+
one canonical clock/GPIO/peripheral adapter
```

Backend identity would have to be part of runtime state; continuation could never silently switch backend.

Strengths:

- source-level diagnostics for the subset;
- path to broader compatibility;
- cross-backend parity opportunities.

Costs:

- two production execution truths;
- duplicated API/peripheral parity work;
- backend-discriminated state;
- multiplied test matrix;
- normative backend-selection rules per sketch;
- compiler/security/licensing costs from Candidate B remain.

Why not selected: technically feasible only with a strict single-clock/single-adapter contract, but it creates duplicate production semantics before evidence shows that the extra compatibility justifies the maintenance burden.

## Owner-correction re-evaluation of all three candidates

The owner invariant was added after the initial candidate, so every architectural family was re-evaluated before independent review.

### Candidate A — SOURCE_LEVEL re-evaluation

**Can Start remain unconditional for learner errors?** Yes. Session creation can remain independent of per-board compile/runtime diagnostics; board/subsystem diagnostics become local runtime observations rather than Start authorization.

**Can board compile failure remain local?** Yes. Compile/load state can be stored per Arduino component instead of returning one global session fault merely because one source is invalid.

**Can last-good executable be separate from editor source?** Yes. The source-level compiler already produces an internal compiled instruction representation during evaluation. The target architecture must persist/identify the last successfully compiled executable representation separately from current editor source and replace it only after successful compilation.

**Can unsupported ASA APIs remain capability diagnostics rather than fake compile errors?** Yes. The existing capability registry already distinguishes unsupported APIs. The future compile/load pipeline must preserve the distinction between real source syntax/compile failure and valid source outside ASA simulation capability.

**Can multiple boards fail independently?** Yes. Program identity, compiled/load state, runtime continuation and diagnostics can be keyed per board under one canonical scheduler.

**Can canonical replay include program identity/load transitions deterministically?** Yes. Program identity/load success becomes canonical per-board runtime/session state. Load transitions occur at deterministic controller/scheduler boundaries; editor wall-clock does not become physics.

Required source-level architecture:

```text
editor source
  -> compile/validate
  -> on success: commit new per-board loaded program identity + executable
  -> on failure: keep previous loaded executable and local diagnostic
  -> canonical instruction-us-v1 scheduler
  -> local board fault/capability status
  -> global Electronics session continues
```

This adds state separation and fault locality but does not require abandoning the accepted canonical clock.

### Candidate B — AVR re-evaluation

AVR naturally exposes a compile → binary → load boundary, so last-successfully-loaded firmware semantics are straightforward. A failed compile/upload need not replace the previous image.

However, Candidate B still requires the same product-level decisions:

- per-board last loaded image and source identity;
- failed compile/upload locality;
- no whole-lab shutdown for one bad board;
- electrical simulation continuation;
- deterministic binary-load transition under the canonical Electronics clock;
- serializable/replayable MCU image/runtime state.

The real compiler boundary is useful but does not automatically solve permissive Start or multi-board isolation. The previously identified compiler/toolchain, browser, state, bridge, security and licensing costs remain.

### Candidate C — HYBRID re-evaluation

Hybrid can implement last-known-good behavior only if loaded program state additionally records backend identity. A compile failure must not change backend, loaded executable or canonical program identity. A successful backend switch would require an explicit deterministic load transition and reset/incompatibility rule.

This strengthens the original objection: permissive local failure is feasible, but the product would own two independent executable/state formats plus backend-selection/load-transition semantics. The owner invariant therefore increases, rather than reduces, the duplicated truth and maintenance cost of Candidate C.

### Re-evaluation result

All three candidates can be designed to satisfy the added owner invariant. The new requirement does not force AVR or hybrid.

```text
SELECTED AFTER OWNER RE-EVALUATION: SOURCE_LEVEL
```

SOURCE_LEVEL remains selected because it can add real compile/load separation, last-known-good executable identity and fail-local board diagnostics while preserving the already accepted single canonical clock, Worker/replay model and one production execution truth.

## Criteria comparison

| Criterion | A вЂ” source-level | B вЂ” AVR | C вЂ” hybrid |
| --- | --- | --- | --- |
| Canonical determinism | Strong/proven | Conditional on adapter | Conditional on both backends |
| E-OPT-3 clock | Native fit | Adapter required | Strict shared adapter required |
| Sketch compatibility | Educational subset | Broadest potential | Broad but backend-dependent |
| Uno correctness | Selective/reference-validated | Stronger MCU potential, not automatic | Mixed |
| Student diagnostics | Strongest | Compiler good; runtime lower-level | Hardest to unify |
| Browser feasibility | Proven | Runtime yes; compiler separate | Feasible but heavier |
| Worker compatibility | Proven | Feasible | Feasible with dual backend |
| State serialization | Proven | Major design work | Hardest |
| Performance | Measured adequate sample | Not measured locally | Not measured; dual overhead |
| Bundle/toolchain | No new dependency | Emulator + compiler/core path | A + B |
| Memory | ~24 KB JSON state sample | MCU/peripheral state + binary | Largest surface |
| Startup/compile latency | ~0.033 ms parse sample | C/C++ compile required | Backend-dependent |
| Peripheral extensibility | Explicit models | MCU peripherals help; external models remain | Broadest but duplicated |
| Serial | Bounded buffers/events | UART helps; UI bridge remains | Dual semantics |
| pulseIn/micros | Natural canonical-time extension | Core/timer path possible | Dual semantics |
| PWM/timer | Abstract timed event model | More MCU-faithful | Dual model |
| Infinite-loop isolation | Existing work quantum | Emulator instruction budget required | Both |
| Licensing | No new runtime surface | MIT + GNU/core obligations | Same as B plus A |
| Security | Bounded parser/runtime | Compiler + binary/emulator surface | Largest surface |
| Portability | Browser/Worker/Node | Runtime portable; compiler boundary | Conditional |
| Implementation effort | Lowest | High | Highest |
| Maintenance cost | Lowest for declared subset | High | Highest |

## E-OPT-6 prerequisite matrix

| Peripheral | A вЂ” source-level | B вЂ” AVR | C вЂ” hybrid |
| --- | --- | --- | --- |
| Servo SG90 | bounded microsecond timed output + model | MCU timer path + external servo model | dual parity |
| HC-SR04/PING | micros + pulseIn + edge scheduling + model | MCU timing + external echo bridge | dual edge semantics |
| PIR | bounded digital input event | GPIO + external model | little dual-backend benefit |
| Serial Monitor | serialized RX/TX buffers/events | UART + UI bridge | dual serial semantics |
| I2C | protocol/API + device models | TWI helps; devices still modeled | high parity burden |
| SPI | protocol/API + device models | SPI helps; devices still modeled | high parity burden |
| IR | timed edge protocol + model | MCU timing + external model | dual timing semantics |
| NeoPixel | timing-sensitive output abstraction | cycle path attractive + LED model | compatibility benefit, high runtime cost |

No peripheral is implemented by this decision.

## Numeric/reference truth

The selected policy is:

```text
source-level production semantics
+ independent AVR reference fixtures for hardware-sensitive claims
+ explicit unsupported behavior outside the accepted subset
```

Green source-level unit tests alone are not hardware-accuracy proof. Likewise, AVR emulation is not automatically correct without matching Arduino core, timer/I/O models, external circuit coupling and canonical clock synchronization.

## Diagnostics/student UX

Source-level remains preferred because it can provide bounded syntax-subset, unsupported API, line-oriented and runtime budget/arithmetic/clock diagnostics directly in student terms.

AVR compilation can provide real C++ compiler diagnostics, but runtime/peripheral faults are lower-level and require source-map normalization. Hybrid requires one diagnostic taxonomy across both engines.

## Security

Source-level already has parser/runtime limits, work quanta and Worker cancellation without arbitrary host JS.

AVR production would additionally expose an untrusted compiler input surface, resource-intensive compilation, binary validation and emulator instruction budgeting. Hybrid combines both surfaces.

## Legacy clock convergence impact

### Can legacy-ms-v1 be retired?

Yes, but only in a separately selected implementation slice after all production callers migrate and parity is proven.

### What replaces advanceArduinoRuntime?

A canonical source-level `instruction-us-v1` entry point and/or scheduler-owned timed advancement. Exact API naming is deferred to implementation.

### arduino-model.ts

Migrate its legacy wrapper call to the canonical source-level state/advance contract or scheduler-supplied state.

### solver.ts stateless/snapshot path

Replace fallback creation through `advanceArduinoRuntime('')` with canonical `instruction-us-v1` state initialization/snapshot.

### Does instruction-us-v1 remain canonical?

Yes.

### Migration shape

Additive code migration with deliberate reset of incompatible **runtime-only** continuation state. No saved schematic/document migration is required by this decision. A `legacy-ms-v1` continuation must not be reinterpreted as `instruction-us-v1`.

### Old tests

Legacy-wrapper coverage in `arduino-correctness.spec.ts`, `arduino-runtime-state.spec.ts`, `arduino-values.spec.ts` and `arduino-execution-clock.spec.ts` must later be classified as retained legacy regression proof, migrated canonical coverage or AVR reference parity coverage.

## Rejected alternatives

### AVR production backend

Rejected for current E-OPT-5 because its broader compatibility does not justify adding compiler/toolchain distribution, binary lifecycle, emulator continuation state, source mapping and MCU-to-circuit bridging when the declared product scope is an educational subset.

### Hybrid production backend

Rejected because it creates two production truths, dual state formats and a multiplied parity/maintenance matrix without demonstrated product need.

## Selected strategy

```text
SELECTED: SOURCE_LEVEL
```

Why selected after owner correction:

- satisfies the original hard constraints and the added permissive-start/compile-load constraints with the least new architecture;
- can represent editor source separately from the last successfully loaded executable;
- can keep a failed compile local to one board without replacing last-good program state;
- can keep unsupported ASA APIs as capability diagnostics rather than fabricated compile errors/results;
- can isolate multiple board runtime/compile failures while retaining one canonical Electronics clock;
- preserves accepted E-OPT-3 clock/Worker/replay/state semantics;
- measured baseline is adequate for the representative sketch;
- preserves student-readable diagnostics;
- requires no new runtime/compiler dependency;
- keeps AVR available as an independent hardware-oriented reference oracle.

## Known limits

- no full arbitrary Arduino C++;
- no register-level compatibility guarantee;
- source-level timing is deterministic, not AVR-cycle exact;
- I2C/SPI/IR/NeoPixel remain substantial future work;
- hardware-sensitive claims continue to require reference evidence.

## Required next implementation slice

When separately selected, the next E-OPT-5 implementation slice should be bounded to **canonical source-level runtime convergence plus permissive fail-local session semantics**:

1. define canonical `instruction-us-v1` production initialization/entry;
2. introduce explicit per-board editor-source versus last-successfully-loaded executable/program identity;
3. allow only successful compile/load to replace the loaded executable;
4. keep prior loaded program A executable when edited program B fails compilation;
5. keep a board with no successful firmware in a defined reset/default executable state after compile failure;
6. distinguish real syntax/compile errors from valid Arduino source unsupported by ASA simulation capability;
7. localize board compile/runtime/capability diagnostics without tearing down the global Electronics session;
8. define exact retention/reset semantics for last committed GPIO, `pinMode`, PWM and tone after a local board runtime fault;
9. support deterministic per-board program-load identity/transitions under the canonical clock and replay model;
10. migrate `arduino-model.ts` and solver snapshot/stateless legacy callers;
11. preserve reset-on-incompatible-runtime-state behavior;
12. prove `legacy-ms-v1` production callers reach zero;
13. keep unsupported calculation/API behavior fail-closed locally with no fabricated result;
14. run focused canonical clock/Arduino/Worker parity gates.

Future acceptance must cover these cases:

| Case | Required result |
| --- | --- |
| valid circuit + valid program | Start succeeds; simulation runs |
| dangerous but supported circuit | Start succeeds; modeled physics/damage is shown |
| wrong pin/wiring | Start succeeds; actual wrong behavior is shown |
| Arduino syntax/compile error | lab Start succeeds; diagnostic local; invalid new source does not execute |
| valid A loaded + invalid edited B | B compile fails; A remains loaded/executable; lab continues |
| valid source using ASA-unsupported API | capability diagnostic, not fake compile error; no fabricated API result; lab remains active |
| two boards, one broken | healthy board continues; broken-board diagnostic remains local |
| non-Arduino subcircuit + broken Arduino | electrical subcircuit remains simulatable |

Infrastructure failure remains separately allowed to stop a session: Worker crash, protocol/version mismatch, corrupt canonical continuation, unrecoverable internal engine failure, or document parse/load failure.

That implementation is **not started** by E-OPT-5A.

## Explicit non-goals

No production code, dependencies, compiler/emulator integration, runtime capability implementation, E-OPT-5B, E-OPT-4, peripherals, Issue #304 activation or deployment.
