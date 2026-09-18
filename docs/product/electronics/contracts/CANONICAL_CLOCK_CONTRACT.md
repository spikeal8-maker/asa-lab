# ASA Lab Electronics — Canonical Clock and Trace Contract v1

**Roadmap:** E-OPT-3A  
**Scope:** Electronics physical time, Arduino/runtime ordering, input trace, Worker horizons and committed results.  
**Status:** accepted semantic contract; E-OPT-3A is integrated in `main`. Any incompatible semantic change requires an explicit versioned contract revision.

This document owns canonical time semantics. E-OPT-3B subsequently introduced the public timed engine facade that implements this contract; later runtime, Worker and UI adapters must conform to it and may not make presentation cadence authoritative.

## 1. Clock authority

Electronics has one logical physical-time authority.

- Canonical time is a non-negative integer count of **microseconds** from the current simulation reset.
- Floating-point milliseconds may exist only at adapters; they are not canonical state.
- A host converting elapsed milliseconds to canonical time uses deterministic integer microseconds and must never accumulate floating-point deltas into physics state.
- Wall-clock time, `performance.now()`, `setInterval`, animation frames and render cadence are presentation/host inputs only.
- The existing Arduino circuit scheduler is the orchestration foundation. E-OPT-3 must converge other timed paths onto it rather than create another scheduler.

Implementations may enforce a declared finite upper bound on canonical time. Non-finite, negative or out-of-range horizons fail before state mutation.

## 2. Horizon vocabulary

A **requested horizon** `H` is the logical time the caller asks the engine to reach.

A **committed horizon** `C` is the greatest logical time through which all canonical events, runtime work and ordering obligations have been accepted. Always `C <= H`.

A **physical checkpoint** is the latest committed transient/physical integration state. It may be earlier than `C` when there are no physical barriers between that checkpoint and `C`.

An **observation frame** is an electrical result sampled at an exact logical horizon. A frame may be calculated from a prior physical checkpoint without mutating that checkpoint. Presentation sampling therefore cannot change later physics.

A request is:

- `ready` only when `C == H` and a complete observation frame at `H` is available;
- `yielded` when bounded work stops with `C < H`; no result may be presented as the result for `H`;
- `fault` when the requested advance cannot be accepted; the caller's previously committed canonical state remains authoritative.

E-OPT-3A fixed these semantics but not API names. E-OPT-3B subsequently froze the version-1 public timed engine surface; incompatible API or semantic changes require an explicit contract revision and compatibility plan.

## 3. Canonical state

A continuation capable of future timed work must be versioned and serializable. Semantically it contains:

- clock-contract/profile identity;
- canonical document identity and executable-version identities required by the determinism contract;
- committed horizon;
- ordered input history and the first unapplied input position;
- physical checkpoint when the selected model set has timed physical state;
- each runtime/controller state participating in the same clock.

Continuation is valid only for the same compatible document/program/model/runtime identities. A structural document change, program change, incompatible model/profile change or incompatible state version requires reset/new generation rather than silent reuse.

## 4. Input trace

Runtime input is an append-only ordered trace.

Each event has:

1. a canonical microsecond timestamp;
2. a stable target/operation identity;
3. a value/payload validated by the owning capability;
4. an implicit stable sequence equal to its position in the accepted trace.

Timestamps are non-decreasing. Events sharing a timestamp are ordered by accepted trace sequence, never by object iteration, locale, thread scheduling or host arrival race.

After horizon `C` is committed, a continuation cannot accept a newly inserted event at or before `C`. Changing the past requires reset/replay from an earlier accepted initial state.

Only declared runtime controls are trace events. Structural circuit edits or program edits start a new compatible generation/reset unless a later accepted contract explicitly defines otherwise.

## 5. Barrier ordering

For each canonical event time `t`, processing is deterministic and follows this causal order:

1. advance physical state from its previous checkpoint to `t` using inputs and runtime outputs committed before `t`;
2. apply all external input events at `t` in trace order;
3. obtain one electrical observation at `t`;
4. every runtime participant due at `t` consumes that same pre-update electrical observation;
5. runtime participant updates are committed together after all due participants have consumed the frame;
6. emitted same-time work is processed through deterministic bounded zero-duration barriers before logical time moves forward.

Participant iteration and emitted-event ordering use stable identity ordering where an order is observable. A peer cannot observe another peer's future update inside the same shared barrier.

If any mandatory physics/quality/runtime check fails before the barrier commits, that barrier does not partially commit.

## 6. Physics barriers and UI horizons

Physics integration barriers are chosen by engine/model rules, not by UI refresh frequency.

A UI-requested horizon between canonical physical barriers may be observed without committing a new physical checkpoint. Reaching the same final horizon through different UI request partitions must not alter the normalized final state or result.

Therefore, for equal canonical initial state, event trace and final horizon:

```text
advance(0 → H)
advance(0 → h1 → h2 → ... → H)
advance with different bounded-work budgets and resume points
```

must converge to byte-equivalent normalized committed state/result, excluding transport IDs, wall-clock metrics and presentation-only sampling metadata.

## 7. Arduino/runtime semantics

Arduino execution and circuit physics share the same canonical horizon/barriers.

- Arduino virtual time cannot advance beyond the committed circuit horizon.
- Due boards at one barrier consume the same electrical frame before their updates commit.
- Runtime yield is not a successful horizon result.
- Runtime faults withhold an uncommitted step.
- Future peripherals, interrupts, `pulseIn`, Servo, IR, NeoPixel and similar timing-sensitive capabilities must schedule through canonical events/barriers rather than host timers.

E-OPT-3A does not add those capabilities.

## 8. Pause, resume, reset and cancellation

**Pause** freezes canonical state. No logical time passes merely because wall-clock time passes while paused.

**Resume** continues from exactly the paused canonical state. The wall-clock duration of the pause is not added to simulation time.

**Reset** starts a new canonical generation at time zero, clears prior physical/runtime continuation and applied runtime-input history, and initializes from the selected canonical document/program defaults. Reset is distinct from pause/resume.

**Generation cancellation** invalidates in-flight transport work but does not rewrite the last committed canonical state. A cancelled or stale response cannot commit.

A host action called “stop” must map explicitly to pause, reset or cancellation semantics; it cannot ambiguously mix them inside the engine.

## 9. Worker horizon contract

Worker transport does not own time semantics.

A timed Worker request is interpreted against explicit generation/session/document identity, a requested canonical horizon, compatible continuation and any newly appended canonical input events.

A Worker response is committable only when all of the following match the host's still-current request context:

- protocol compatibility;
- engine/runtime/model identities;
- generation/session;
- canonical document/continuation identity;
- requested/committed horizon relationship.

Stale, superseded, cancelled, crashed or timed-out Worker work cannot commit. There is no silent heavy synchronous fallback that fabricates equivalent progress.

Wall-clock `computeMs` and delivery latency are metrics only and never replay inputs.

## 10. Deterministic trace/replay

A deterministic replay segment is defined by:

- canonical document and schema identity;
- engine/model/runtime/clock-contract version identities;
- reset/initial canonical state;
- ordered canonical input-event trace;
- final requested logical horizon.

Intermediate UI refresh horizons are not required replay inputs. Pause duration in real time is not a replay input. Transport request IDs and Worker latency are not replay inputs.

Reset begins a new replay segment. Replaying the same segment must produce byte-equivalent normalized committed results under different UI cadence, render stalls, Worker batching and bounded-yield partitions.

## 11. Implementation bridge tracking

This semantic contract does not store live implementation debt or current migration status.
Provisional adapters, legacy timing paths and their retirement conditions are tracked only in
`../evidence/hygiene-baseline.yaml`, while the selected implementation slice and candidate
revision live only in `docs/execution/current.yaml`.

Any bridge that still exists must preserve this contract: canonical time remains integer
microseconds, requested and committed horizons remain distinct, UI/wall-clock cadence is
non-authoritative, and Worker execution may not become a second physics implementation.

## 12. Required migration sequence

This contract authorizes no implementation by itself.

- **E-OPT-3B:** define the stable version-1 timed engine facade conforming to this contract.
- **E-OPT-3C:** converge Arduino scheduler/physics barriers on that accepted facade/state contract.
- **E-OPT-3D:** converge Worker evaluator/controller and host requests on canonical horizons rather than presentation-cadence semantics.
- **E-OPT-3E:** prove trace/replay equivalence across different UI cadences and stalls.
- **E-OPT-3F:** prove reset/pause/resume/input-event and stale-horizon conformance.

This sequence defines semantic dependencies only. Acceptance/progress for a concrete slice is read
from `docs/execution/current.yaml` and repository evidence, never inferred from this contract.

No Servo/HC-SR04/interrupt/IR/NeoPixel implementation is authorized by this decision.

## 13. Acceptance invariants

Later E-OPT-3 implementation is conformant only if it proves all of the following:

1. equal canonical input + versions + initial state + event trace + final horizon gives byte-equivalent normalized output;
2. UI/render cadence and wall-clock stalls do not change simulation truth;
3. all same-time participants obey the shared barrier ordering;
4. yielded work cannot masquerade as a completed horizon;
5. faults/cancellation/stale responses cannot partially commit future state;
6. pause/resume adds no wall-clock time to physics;
7. reset creates a clean time-zero generation;
8. direct and Worker execution use the same canonical semantics;
9. the version-1 public timed API introduced by E-OPT-3B remains compatible with this accepted contract; incompatible change requires a versioned contract/API revision.
