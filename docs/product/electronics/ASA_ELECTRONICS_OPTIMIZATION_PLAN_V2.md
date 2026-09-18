# ASA Lab Electronics — Optimization and Development Plan v2

**Scope:** Electronics / Arduino only.
**Purpose:** dependency-ordered engineering programme. This document does not select the active task; `docs/execution/current.yaml` is the only active execution state.

## 0. Why v2 exists

The first plan had the right architecture but was not integrated into `main` before implementation began. As a result, the Worker milestone was completed before the planned portable-engine boundary and internal milestone names drifted.

Plan v2 reconciles reality without pretending missing prerequisites are complete.

Historical facts at v2 creation (retained only to explain why v2 was needed):

- reproducible Electronics benchmark/golden baseline existed;
- dedicated simulation Worker boundary existed and was used by the running workbench;
- Worker rollout already had parity/regression/browser evidence;
- portable engine and canonical physical clock were incomplete at that time.

Reconciled capability baseline for this plan revision:

- E-OPT-0 baseline/golden/benchmark is accepted;
- E-OPT-1A..1E portable engine boundary is accepted and integrated;
- E-OPT-2 dedicated Worker boundary is accepted and integrated;
- E-OPT-3A canonical clock contract, E-OPT-3B public timed facade and E-OPT-3C scheduler/physics barrier convergence are accepted and integrated;
- E-OPT-3D..3F remain before E-OPT-3 is complete;
- timing-sensitive peripherals remain blocked on the remaining clock/runtime prerequisites.

Do not copy live SHA/CI/checkpoint into this plan. Historical evidence belongs in delivery evidence, Git history and issues.

## 1. Non-negotiable execution rules

Dependency edges below are acceptance prerequisites, never task authorization.
Behavioural execution rules are owned by [AGENT_GUIDE §§2–4](AGENT_GUIDE.md#2-one-concern-per-slice);
selection is owned by [DEVELOPMENT_SPEC §3](DEVELOPMENT_SPEC.md#3-development-selection).
No stage becomes active without its separately selected canonical execution task.

## 2. Programme dependency graph

```text
E-OPT-0 Baseline / golden / benchmark                    [accepted capability]
        |
        +-------------------------+
        |                         |
        v                         v
E-OPT-1 Portable Engine      E-OPT-2 Dedicated Worker     [accepted early]
Boundary                     execution boundary
        |                         |
        +------------+------------+
                     v
              E-OPT-3 Canonical Clock
                 /           \
                v             v
 E-OPT-4 Solver/DeviceModel   E-OPT-5 Arduino Runtime
 Hardening                    Hardening
                \             /
                 +-----+------+
                       v
              E-OPT-6 Peripherals

E-OPT-1 + E-OPT-2 + E-OPT-3 + required E-OPT-5 contracts
                       → E-OPT-8 Portability Proof
E-OPT-4 + selected E-OPT-6 coverage + E-OPT-7 evidence + E-OPT-8
                       → E-OPT-9 v1 Hardening Gate

E-OPT-7 UI/assets/performance is a bounded parallel lane only when explicitly selected;
it may not redefine engine/clock/runtime semantics.

DPL-* deployment gates are cross-cutting and occur only after accepted integration points.
```

### 2.1 Cross-cutting engineering hygiene checkpoints

The [Engineering Hygiene and Legacy Retirement Contract](contracts/ENGINEERING_HYGIENE_CONTRACT.md) is cross-cutting. A hygiene checkpoint is mandatory after every three accepted production-changing slices (`implementation`, `component/peripheral`, plus `maintenance`/`repair` that changed tracked production source) or before transition between major E-OPT stages, whichever occurs first. Canonical replacement of a provisional/legacy path may force an earlier checkpoint.

A due hygiene checkpoint blocks another production-changing slice until accepted, except for a bounded repair required to restore a broken governance/gate condition. Hygiene does not alter roadmap dependencies and never authorizes the next feature by itself.

## 3. E-OPT-0 — Baseline, golden corpus and benchmark harness

**Capability state:** accepted foundation.

Must continue to protect:

- golden deterministic fingerprints;
- DC/nonlinear/transient/motor/Arduino/invalid/unsupported/nonconvergent corpus;
- native and controlled low-end browser evidence;
- cold-load evidence;
- retained-memory evidence;
- quick CI benchmark integrity.

**Forbidden:** casually regenerating goldens to make a behaviour change pass.

**Stop:** any intentional golden change becomes its own reviewed solver/runtime task.

## 4. E-OPT-1 — Portable Engine Boundary

**Capability state:** accepted and integrated through E-OPT-1E.

### Goal

Expose one intentionally supported **structural/non-temporal** Electronics engine contract that can be consumed without React, ASA Lab API, PostgreSQL or portal state. Canonical timed advance is deliberately deferred until E-OPT-3 defines what simulation time, horizons and event barriers mean.

### Required slices

E-OPT-1A — non-semantic inventory of current public exports/dependency graph.
Concrete task card: [tasks/E-OPT-1A.md](tasks/E-OPT-1A.md); no facade design/implementation.

E-OPT-1B — define stable non-temporal engine types/facade around existing implementation; no physics rewrite and no final timed API.

E-OPT-1C — dependency-boundary tests proving pure engine imports do not pull Web/API/DB/UI concerns.

E-OPT-1D — direct Node/browser minimal consumer contract test for parse/validate/compile/solve/capabilities.

E-OPT-1E — converge Worker preflight/stateless solve entry points onto the stable facade while preserving exact golden parity. Existing timed advance remains an internal/provisional bridge until E-OPT-3.

### Target API shape

The exact names are a design decision, but the E-OPT-1 capability surface must cover only the stable non-temporal boundary:

```text
create/describe engine
parse/validate document
compile/prepare topology
solve/analyse a bounded snapshot
capabilities/version descriptor
```

`advanceTo(...)`, event horizons, timed reset/pause/resume and other physical-time semantics are **not** frozen in E-OPT-1. They are added only after E-OPT-3A accepts the canonical clock contract.

### Acceptance

- minimal consumer runs without React/ASA API/PostgreSQL;
- no electrical equation or Arduino semantic change is required to pass;
- E-OPT-0 goldens unchanged;
- Worker remains parity-equivalent;
- new engine public surface is smaller and intentional rather than re-exporting internal modules;
- temporal/advance methods remain explicitly internal/provisional until E-OPT-3 rather than being accidentally stabilised first.

### Stop

This stop boundary has been satisfied. E-OPT-1 is retained as an accepted foundation; further changes require a separately selected maintenance or dependent roadmap task.

## 5. E-OPT-2 — Dedicated Electronics Worker

**Capability state:** accepted early and integrated.

Preserve the [version domains](DEVELOPMENT_SPEC.md#12-independent-version-domains-and-capabilities),
[execution/failure contract](DEVELOPMENT_SPEC.md#13-determinism-and-execution-failures) and
[Worker acceptance evidence](DEVELOPMENT_SPEC.md#71-architecture-acceptance-evidence).
This stage's acceptance includes direct/Worker parity and a browser journey proving real Worker creation.

No further E-OPT-2 feature expansion is authorised by this plan alone. Worker changes are maintenance unless another stage explicitly requires them.

## 6. E-OPT-3 — Canonical Electronics Clock

**Capability state:** E-OPT-3A, E-OPT-3B and E-OPT-3C are accepted and integrated; E-OPT-3D, E-OPT-3E and E-OPT-3F remain.

### Goal

One physical-time contract for circuit physics, Arduino execution, input events and peripherals. UI refresh/render cadence is presentation only.

### Existing foundation

Use the existing Arduino circuit scheduler as the orchestration foundation. Do not create a third independent scheduler.

### Required slices

E-OPT-3A — accept the canonical clock/trace contract: simulation time, horizons, barriers,
input events, display sampling and the reset/pause/resume foundation before freezing timed APIs.

E-OPT-3B — extend the stable engine facade with canonical timed advance/event-horizon methods defined by E-OPT-3A. This is the first stage allowed to freeze a public timed API.

E-OPT-3C — unify Arduino scheduler/physics barriers with canonical time.

E-OPT-3D — converge Worker evaluator/controller onto the canonical timed facade and request horizons rather than defining physics through the ~100 ms presentation timer.

E-OPT-3E — deterministic trace/replay fixtures across different UI refresh cadences.

E-OPT-3F — prove reset/pause/resume/input-event conformance to E-OPT-3A and stale horizon handling.

### Acceptance

Prove the [determinism contract](DEVELOPMENT_SPEC.md#13-determinism-and-execution-failures)
with this stage's canonical-time and replay fixtures across UI cadences/render stalls.

### Stop

Do not start Servo/HC-SR04/interrupts/IR/NeoPixel in E-OPT-3.

## 7. E-OPT-4 — Solver and DeviceModel Hardening

**Blocked on E-OPT-3 for transient/timestep-sensitive acceptance; bounded static model cleanup may be separately selected only when it does not depend on time semantics.**

Required work:

- inventory legacy component-specific solver branches;
- move eligible behaviour into DeviceModel/profile registry;
- typed convergence/singularity/conditioning diagnostics;
- tolerance policy by model class;
- timestep convergence tests;
- numerical safety limits;
- analytical and datasheet/reference fixtures;
- independent reference validation where practical;
- browser/Worker parity through the same engine/model set.

**Acceptance:** every production-supported model has model identity, physical basis and deterministic reference evidence. Never claim SPICE-grade accuracy solely from green unit tests.

## 8. E-OPT-5 — Arduino Runtime Hardening

**Blocked on E-OPT-3.**

Logical subsystems:

- tokenizer/parser and IR/control flow;
- Uno numeric/value semantics;
- scopes/variables;
- builtins;
- GPIO/ADC/PWM;
- virtual clock/event queue;
- peripheral runtime;
- serializable state;
- diagnostics/capabilities.

Priority timing foundation:

```text
millis/micros
delay/delayMicroseconds
edge/event scheduling
timed PWM representation
pulseIn foundation
Serial runtime foundation
deterministic reset
bounded execution/infinite-loop protection
```

A separate design spike must compare continued source-level runtime vs AVR emulation vs hybrid using compatibility, size, speed, determinism, diagnostics, licensing and maintenance cost. The spike chooses; it does not automatically migrate the runtime.

## 9. E-OPT-6 — Sensors and Peripherals

**Blocked until the required E-OPT-3/E-OPT-5 primitives exist and are accepted.**

Default first-wave order:

```text
Servo SG90
HC-SR04 / PING ultrasonic
PIR
Serial Monitor
I2C foundation + selected common devices
SPI foundation
IR
NeoPixel / timing-sensitive output
```

Each peripheral is a separate task satisfying the
[extension contract](DEVELOPMENT_SPEC.md#14-component-and-peripheral-extension-contract),
with focused/reference tests and browser evidence for that peripheral.

No peripheral task authorises the next peripheral.

## 10. E-OPT-7 — UI / Assets / Maintainability

May run in parallel only when explicitly selected and when it preserves engine/runtime semantics.

Targets:

- lazy-load large editor/instrument/peripheral UI;
- reduce repeated parse/clone/canonicalize work;
- avoid document-wide derived recomputation;
- memoize by version/digest where safe;
- reduce catalog/SVG memory/loading;
- split oversized controller/UI hotspots by responsibility;
- remove duplicate hand-maintained registries.

Acceptance requires before/after bundle/runtime evidence, not line-count reduction.

## 11. E-OPT-8 — Portability Proof

**Blocked until E-OPT-1, E-OPT-2, E-OPT-3 and required Arduino runtime contracts are accepted.**

Deliver the [executable portability proof](DEVELOPMENT_SPEC.md#73-executable-portability-proof):
the runnable standalone example, reproducible commands and evidence-derived `PORTING.md`.
That contract defines the minimum proof; this stage owns its prerequisite acceptance boundary.

## 12. E-OPT-9 — Electronics v1 Hardening Gate

Final gate requires:

- boundaries and public API;
- engine unit/reference tests;
- golden corpus;
- Arduino corpus/capability coverage;
- solver quality checks;
- Worker parity;
- canonical clock replay determinism;
- performance budgets;
- browser E2E;
- standalone portability proof;
- generated component coverage;
- no unsupported silent fallback.

Only then may the product be described as a portable Electronics v1 foundation.

## 13. Deployment gate (DPL)

Deployment is not an E-OPT implementation stage. It is a separate release action after selected accepted milestones.

The deployment contract is owned by [DEVELOPMENT_SPEC §10](DEVELOPMENT_SPEC.md#10-deployment-contract)
and [DEPLOYMENT_TASK_TEMPLATE](tasks/DEPLOYMENT_TASK_TEMPLATE.md).

## 14. Task selection algorithm

Follow [DEVELOPMENT_SPEC §3](DEVELOPMENT_SPEC.md#3-development-selection).
This plan supplies only stage dependencies and acceptance boundaries to that algorithm.
An unmet prerequisite produces `BLOCKED_BY <task>`.

## 15. Plan change procedure

A plan change is valid only when a bounded governance/design task explains:

```text
what assumption changed
what evidence changed it
which dependency edges change
what already-implemented capability is affected
what remains blocked
how existing acceptance evidence remains valid or must be rerun
```

Then update this plan and routing before implementation resumes.

## 16. Current dependency shape after E-OPT-3C

Accepted foundations E-OPT-0, E-OPT-1, E-OPT-2 and E-OPT-3A..3C are not repeated as
future work. This is a dependency shape, not an execution queue: every arrow still ends at
STOP / owner selection, and only `docs/execution/current.yaml` activates a concrete task.

```text
mandatory hygiene checkpoint after accepted 3A/3B/3C
        |
        v
STOP / owner selection
        |
        v
E-OPT-3D Worker/controller canonical horizons
        |
        v
E-OPT-3E trace/replay determinism across presentation cadence
        |
        v
E-OPT-3F reset/pause/resume/input/stale-horizon conformance
        |
        v
mandatory hygiene checkpoint before leaving major E-OPT-3
        |
        +---------------------------+
        |                           |
        v                           v
E-OPT-4 Solver/DeviceModel    E-OPT-5 Arduino runtime
hardening                     hardening
        |                           |
        +-------------+-------------+
                      |
                      v
E-OPT-6 peripherals, one selected vertical slice at a time

Accepted E-OPT-1 + E-OPT-2 + E-OPT-3 + required E-OPT-5 contracts
                      |
                      v
E-OPT-8 standalone portability proof

E-OPT-7 UI/assets/maintainability is a separately selected bounded parallel lane.

E-OPT-4 + selected E-OPT-6 coverage + E-OPT-7 evidence + E-OPT-8
                      |
                      v
E-OPT-9 v1 hardening gate
```

E-OPT-4 and E-OPT-5 are sibling hardening programmes, not a mandatory
`4 → 5` serial queue. They may be decomposed into bounded slices and may overlap only where
their accepted contracts permit it. E-OPT-6 waits for the required accepted engine/runtime
primitives; no peripheral task is selected merely because its ARD requirement anchor exists.

E-OPT-8 keeps its independent prerequisite boundary from §§2 and 11; this diagram does not make
it wait for E-OPT-6 or E-OPT-7. E-OPT-7 may run in parallel only where §10 preserves
engine/runtime semantics, and it never auto-activates from this diagram.

Each major-stage transition remains subject to the cross-cutting hygiene rule in §2.1.
