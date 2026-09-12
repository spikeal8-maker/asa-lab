# ASA Lab Electronics — Optimization and Development Plan v2

**Scope:** Electronics / Arduino only.
**Purpose:** dependency-ordered engineering programme. This document does not select the active task; `docs/execution/current.yaml` is the only active execution state.

## 0. Why v2 exists

The first plan had the right architecture but was not integrated into `main` before implementation began. As a result, the Worker milestone was completed before the planned portable-engine boundary and internal milestone names drifted.

Plan v2 reconciles reality without pretending missing prerequisites are complete.

Stable facts at v2 creation:

- reproducible Electronics benchmark/golden baseline exists;
- dedicated simulation Worker boundary exists and is used by the running workbench;
- Worker rollout has exact parity/regression/browser evidence;
- production deployment of that accepted Worker rollout has been proven through a separate deployment gate;
- portable engine boundary is still incomplete;
- canonical physical clock is still incomplete;
- timing-sensitive peripherals remain blocked on clock/runtime prerequisites.

Do not copy live SHA/CI/checkpoint into this plan. Historical evidence belongs in delivery evidence, Git history and issues.

## 1. Non-negotiable execution rules

1. One task implements one bounded concern.
2. Dependency edges below are hard gates.
3. A later stage may not start because it looks easier.
4. If the plan is wrong, perform a separate plan/design repair and stop.
5. Implementation work may not edit the plan to justify scope already taken.
6. Completion of one task never starts the next task automatically.
7. Git merge is not deployment.
8. Deployment is a separate task against an exact gated SHA.
9. New sensors/peripherals never invent UI/wall-clock timing to bypass missing canonical-time primitives.
10. Solver correctness beats benchmark speed; unsupported remains fail-closed.

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
                       |
                       v
              E-OPT-8 Portability Proof
                       |
                       v
              E-OPT-9 v1 Hardening Gate

E-OPT-7 UI/assets/performance is a bounded parallel lane only when explicitly selected;
it may not redefine engine/clock/runtime semantics.

DPL-* deployment gates are cross-cutting and occur only after accepted integration points.
```

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

**This is the next missing foundation.**

### Goal

Expose one intentionally supported Electronics engine contract that can be consumed without React, ASA Lab API, PostgreSQL or portal state.

### Required slices

E-OPT-1A — inventory current public exports/dependency graph.

E-OPT-1B — define stable engine types/facade around existing implementation; no physics rewrite.

E-OPT-1C — dependency-boundary tests proving pure engine imports do not pull Web/API/DB/UI concerns.

E-OPT-1D — direct Node/browser minimal consumer contract test.

E-OPT-1E — converge Worker evaluator onto the stable engine facade while preserving exact golden parity.

### Target API shape

The exact names are a design decision, but the capability surface must cover:

```text
create/describe engine
parse/validate document
compile/prepare topology
solve
advance to target simulation time
reset
capabilities/version descriptor
```

### Acceptance

- minimal consumer runs without React/ASA API/PostgreSQL;
- no electrical equation or Arduino semantic change is required to pass;
- E-OPT-0 goldens unchanged;
- Worker remains parity-equivalent;
- new engine public surface is smaller and intentional rather than re-exporting internal modules.

### Stop

After E-OPT-1 acceptance, report E-OPT-3 as next available. Do not start clock work in the same task/context.

## 5. E-OPT-2 — Dedicated Electronics Worker

**Capability state:** accepted early and integrated.

Stable requirements that future changes must preserve:

- versioned protocol and engine revision;
- request/generation/session isolation;
- bounded in-flight heavy work and coalescing;
- cancellation/stale-result rejection;
- crash/timeout failure containment;
- no silent synchronous heavy-solver fallback;
- direct-vs-Worker parity;
- production browser journey proves real Worker creation.

No further E-OPT-2 feature expansion is authorised by this plan alone. Worker changes are maintenance unless another stage explicitly requires them.

## 6. E-OPT-3 — Canonical Electronics Clock

**Blocked until E-OPT-1 is accepted.**

### Goal

One physical-time contract for circuit physics, Arduino execution, input events and peripherals. UI refresh/render cadence is presentation only.

### Existing foundation

Use the existing Arduino circuit scheduler as the orchestration foundation. Do not create a third independent scheduler.

### Required slices

E-OPT-3A — clock contract/trace model: simulation time, horizons, barriers, input events, display sampling.

E-OPT-3B — adapt live Worker controller to request horizons rather than defining physics through its ~100 ms presentation timer.

E-OPT-3C — unify Arduino scheduler/physics barriers with canonical time.

E-OPT-3D — deterministic trace/replay fixtures across different UI refresh cadences.

E-OPT-3E — reset/pause/resume/input-event semantics and stale horizon handling.

### Acceptance

Same initial document + same event trace + same versions must produce byte-equivalent committed simulation frames independent of UI cadence or render stalls.

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

Each peripheral is a separate task and must define owner SVG/provenance, terminals/electrical identity, runtime interface, timing dependencies, inspector/help, capability registry, focused tests, golden/reference fixture and browser evidence.

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

Create a standalone example outside ASA portal concerns that can load the engine, create/read a circuit, start the Worker, simulate, run one Arduino example and use in-memory persistence.

Produce `PORTING.md` from the proven example: public API, worker integration, document compatibility, model extension, host adapter and supported runtime baseline.

Claiming “portable” without this code proof is forbidden.

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

Every deployment task must prove exact target SHA, compose/env/schema delta, migration requirement, backup/rollback, candidate build/stack, post-deploy health/version/schema and external user path. Deploying a newer moving `main` merely because it exists is forbidden.

## 14. Task selection algorithm

Before implementation:

1. classify request through `START_HERE.md`;
2. resolve component IDs in `COMPONENT_MAP.yaml`;
3. check this plan's prerequisites;
4. create/select one bounded task card;
5. ensure active execution state authorises that task/scope;
6. read only mapped contracts/source/tests;
7. implement one slice;
8. run declared gate and bounded review;
9. STOP.

If step 3 fails, the correct output is `BLOCKED_BY <task>` — not coding around the dependency.

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

## 16. Immediate next sequence after v2 acceptance

The next owner-selectable implementation sequence is:

```text
E-OPT-1A inventory/dependency graph
→ E-OPT-1B stable engine facade
→ E-OPT-1C boundary tests
→ E-OPT-1D standalone minimal consumer
→ E-OPT-1E Worker convergence on facade
→ STOP / independent acceptance
→ E-OPT-3A canonical clock contract
```

No sensor/peripheral work belongs in this sequence.