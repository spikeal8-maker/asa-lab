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

## Hard constraints

Every candidate was evaluated against these non-negotiable constraints:

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

## Frozen evaluation criteria

The E-OPT-5A task card froze these 22 criteria before candidate evaluation:

canonical determinism; E-OPT-3 clock compatibility; sketch compatibility; Uno/ATmega328P correctness; student diagnostics; browser feasibility; Worker compatibility; state serialization; execution performance; bundle/toolchain size; memory cost; startup/compile latency; peripheral extensibility; Serial feasibility; pulseIn/micros feasibility; PWM/timer feasibility; failure isolation; licensing; security; portability; implementation effort; long-term maintenance cost.

The criteria were not changed after a preferred candidate emerged.

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

## Editor source vs loaded executable program

The Arduino editor source and the executable program loaded into a virtual board are distinct target concepts:

```text
editor source
!=
last successfully loaded executable program
```

Target compile/load semantics:

```text
valid program A compiles and loads successfully
→ A becomes the executable program

user edits source to invalid program B
→ B compile fails
→ B is not executed
→ B does not replace A
→ A remains the last successfully loaded executable
→ the whole Electronics simulation continues
```

If no program has ever compiled and loaded successfully:

```text
compile failure
→ no fabricated program executes
→ board remains in a defined no-loaded-program/reset state
→ the whole Electronics simulation continues
```

E-OPT-5A does not define the exact GPIO reset values for that no-loaded-program/reset state. Those pin-level semantics belong to a later bounded implementation slice.

Two error classes are normative and must remain distinct.

### Arduino compile error

Examples include a missing semicolon, broken syntax or an invalid declaration.

A real compile error means the edited Arduino source did not compile. The new source is not loaded and is not executed. It cannot replace a previously loaded executable program.

### ASA simulation capability unsupported

Valid Arduino source may use a feature that ASA Lab does not yet simulate, for example `micros()`, `pulseIn()`, Serial or Servo.

When the source is valid Arduino code, this is **not** an Arduino compile error. It is an ASA simulation capability diagnostic. ASA Lab must not fabricate a return value or partial behavior for the unsupported capability, but the global Electronics simulation remains running.

This section is a design contract only. The compile/load separation and no-loaded-program/reset behavior are **not implemented by E-OPT-5A**.

## Owner-constraint re-evaluation before independent review

Chronology is explicit:

```text
initial candidate selected before owner clarification
→ owner constraints added later
→ all three strategies re-evaluated before independent review
```

This re-evaluation is intentionally limited to two owner constraints:

1. learner-correctable circuit/program errors must not block or tear down the whole Electronics simulation;
2. editor source and the last successfully loaded executable program are distinct states.

It does not repeat the original 22-criterion evaluation.

### Candidate A — SOURCE_LEVEL

Overall owner-constraint result: **PASS**.

| Question | Result | Reason |
| --- | --- | --- |
| A. Global simulation remains running on compile/runtime error | PASS | Compile/runtime diagnostics can be scoped to one board while the Electronics session and independent circuit state continue. |
| B. Editor source and loaded executable stored separately | PASS | Source text and serializable runtime/program identity can be represented as separate board-owned state without changing the global scheduler. |
| C. Failed compile preserves previous executable | PASS | Compilation can commit a new executable identity only on success; failure leaves the previously loaded program identity unchanged. |
| D. One Arduino failure isolated from another board/rest of circuit | PASS | Board runtime/diagnostics can remain per-board while all boards advance under the shared scheduler. |
| E. ASA unsupported capability distinct from real compile error | PASS | The source-level front end can distinguish syntax/compile diagnostics from valid-but-unsupported API/capability diagnostics. |
| F. One canonical Electronics clock preserved | PASS | Compile/load state does not require a second clock; execution remains subordinate to `instruction-us-v1` and the canonical Electronics scheduler. |

SOURCE_LEVEL can therefore implement all newly required semantics:

- separate editor-source and loaded-program state;
- last-known-good executable preservation;
- local board fault handling;
- global simulation continuation;
- compile error distinct from unsupported ASA capability;

without introducing a second scheduler or violating the canonical Electronics clock.

### Candidate B — AVR

Overall owner-constraint result: **CONDITIONAL**.

| Question | Result | Reason |
| --- | --- | --- |
| A. Global simulation remains running on compile/runtime error | CONDITIONAL | The compiler/emulator lifecycle must convert board failures into local board state rather than a global execution failure. |
| B. Editor source and loaded executable stored separately | PASS | The compile → binary → load boundary naturally allows editor source and loaded image to be distinct. |
| C. Failed compile preserves previous executable | PASS | A failed compilation can leave the prior loaded ELF/HEX image untouched. |
| D. One Arduino failure isolated from another board/rest of circuit | CONDITIONAL | Each board needs independent emulator/image/runtime state and fault containment. |
| E. ASA unsupported capability distinct from real compile error | CONDITIONAL | Valid code may compile while ASA lacks a peripheral/circuit bridge; the product must classify that separately from compiler diagnostics. |
| F. One canonical Electronics clock preserved | CONDITIONAL | AVR cycle execution must be driven to scheduler-owned horizons; emulator/native wall-clock may never become a second physics clock. |

AVR satisfies the two owner rules only if the production design adds explicit per-board load/runtime state, local fault containment, post-compile capability classification and a strict cycle-to-canonical-clock adapter.

### Candidate C — HYBRID

Overall owner-constraint result: **CONDITIONAL**.

| Question | Result | Reason |
| --- | --- | --- |
| A. Global simulation remains running on compile/runtime error | CONDITIONAL | Both backends must expose board-local failure without escalating learner errors to global session failure. |
| B. Editor source and loaded executable stored separately | CONDITIONAL | Loaded executable identity must include backend identity as well as program identity and remain distinct from editor source. |
| C. Failed compile preserves previous executable | CONDITIONAL | Failed compile/backend selection must not replace or silently switch the previously loaded executable/backend pair. |
| D. One Arduino failure isolated from another board/rest of circuit | CONDITIONAL | Isolation must work identically across two backend state models. |
| E. ASA unsupported capability distinct from real compile error | CONDITIONAL | A unified diagnostic taxonomy must distinguish compiler failure, backend-selection failure and ASA capability gaps. |
| F. One canonical Electronics clock preserved | CONDITIONAL | Both backends must be subordinated to exactly one scheduler/clock adapter; neither backend may own independent physical time. |

HYBRID can meet the owner rules, but only by adding backend-discriminated loaded-program state and duplicated fault/capability semantics while still maintaining one canonical clock.

### Re-selected strategy under the owner constraints

```text
SELECTED: SOURCE_LEVEL
```

SOURCE_LEVEL remains selected **after** re-evaluation, not because it was selected before the owner clarification. It is the only evaluated family that satisfies all six questions directly within the already accepted single-clock/single-scheduler architecture. AVR and HYBRID remain feasible only conditionally on additional load-state, isolation and clock-adapter architecture.

The selected SOURCE_LEVEL design must therefore treat the following as required future implementation semantics:

```text
editor source != loaded executable
failed compile preserves last-known-good executable
learner compile/runtime fault is board-local
global Electronics simulation continues
compile error != ASA capability unsupported
all execution remains under one canonical Electronics clock
```

No implementation is performed by this re-evaluation.

## Rejected alternatives

### AVR production backend

Rejected for current E-OPT-5 because its broader compatibility does not justify adding compiler/toolchain distribution, binary lifecycle, emulator continuation state, source mapping and MCU-to-circuit bridging when the declared product scope is an educational subset.

### Hybrid production backend

Rejected because it creates two production truths, dual state formats and a multiplied parity/maintenance matrix without demonstrated product need.

## Selected strategy

```text
SELECTED: SOURCE_LEVEL
```

Why selected:

- after owner clarification, SOURCE_LEVEL passes all six owner-constraint questions directly;
- it can represent editor source, loaded executable identity and last-known-good program as separate per-board state;
- learner compile/runtime faults can remain local while the global Electronics session continues;
- compile errors and valid-but-unsupported ASA capabilities can remain distinct diagnostic classes;
- these semantics require no second scheduler and preserve the single canonical Electronics clock;
- it still preserves accepted E-OPT-3 clock/Worker/replay/state semantics and student-readable diagnostics;
- it requires no new runtime/compiler dependency and keeps AVR available as an independent hardware-oriented reference oracle.

## Known limits

- no full arbitrary Arduino C++;
- no register-level compatibility guarantee;
- source-level timing is deterministic, not AVR-cycle exact;
- I2C/SPI/IR/NeoPixel remain substantial future work;
- hardware-sensitive claims continue to require reference evidence.

## Required next implementation slice

When separately selected, the next E-OPT-5 implementation slice should be bounded to **canonical source-level runtime convergence**:

1. define canonical `instruction-us-v1` production initialization/entry;
2. migrate `arduino-model.ts` and solver snapshot/stateless legacy callers;
3. preserve reset-on-incompatible-runtime-state behavior;
4. prove `legacy-ms-v1` production callers reach zero;
5. keep unsupported capability claims fail-closed;
6. run focused canonical clock/Arduino/Worker parity gates.

That implementation is **not started** by E-OPT-5A.

## Explicit non-goals

No production code, dependencies, compiler/emulator integration, runtime capability implementation, E-OPT-5B, E-OPT-4, peripherals, Issue #304 activation or deployment.
