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


## Electrothermal event execution profile v2

`electrothermal-events-v2` applies only to one installed Arduino Uno R3, axial
resistors and ordinary red LEDs with supported model/profile version 1. The
existing instruction-us-v1 evaluator still executes every instruction and return
at its exact microsecond. Pure instructions and unchanged output writes do not
advance unrelated electrical physics. Actual GPIO/mode transitions, electrical
reads, external inputs, waveform boundaries, integer 1000-us physical barriers
and the first failed integer microsecond remain causal electrical barriers.
Unproved component models and multiple boards retain the original profiles.

Within v2, each thermal component carries a constant-load epoch (integer origin,
initial temperature/damage and load). The existing exponential temperature and
linear damage equations are evaluated from this origin, so UI partitions cannot
accumulate floating recurrence drift. The old load reaches an event first; the
new load starts at that exact event from the committed physical state. Failure
search verifies integer neighbours using the same equations. A UI observation
tail never changes epochs or the physical checkpoint. Old-profile continuations
are rejected and require Reset; saved schematic and source formats are unchanged.

`createElectronicsAdvanceSession` owns cloned request/document inputs for one
request. Each `step()` executes at most the unchanged canonical event budget
(default 256, counting every executed MCU instruction). `null` is private pending
work, never an electrical observation. Completion returns the original timed
result shape; a fault restores the original external request state. Inputs are
appended once. The Worker yields its event loop after a bounded 8-ms CPU slice
between engine batches and discards stale/cancelled sessions. Only complete
ready C=H frames are published. CPU yield duration never advances canonical time.

## Ordinary LED temporal observation v1

`ordinary-led-held-v1` is optional, presentation-only metadata for the supported
ordinary LEDs of `electrothermal-events-v2`. It does not change the canonical
clock, continuation, electrical result, quality checks, damage equations or
failure boundary. The public synchronous timed API retains its existing output;
the Worker requests observation through the optional
`createElectronicsAdvanceSession` capture setting.

For one request from committed `C` to complete ready `H`, the scheduler observes
only electrical frames it already calculated and quality checked. The existing
checkpoint seed is clipped to `C`; in this eligible DC profile LED current and
brightness are held between electrical or failure events. An event observer
does not solve the circuit, add a physics barrier or skip a runtime instruction.
Repeated settles at the same microsecond have zero duration and coalesce to the
last accepted state. The request-private collector survives bounded `null`
steps; a fault, cancellation or stale generation discards it. Metadata is
published only with its matching complete ready result.

Each component carries its own real electrical samples `(t, brightness, current)`
and exact summaries over `[C,H)`: the integral of solved `brightness(I_LED(t))`
in percent-microseconds, positive-light duration and brightness-transition count.
This is neither GPIO duty nor brightness calculated from an average current.
The trace retains at most 512 change samples plus the final `H` state. Overflow
marks the trace as truncated; it does not truncate the summaries or physical
work. Same-time reversion does not create an optical transition. All timestamps
remain integer canonical microseconds.

The UI keeps a bounded, per-component history only from contiguous accepted
observations whose final brightness/current match the actual ready result.
Missing, malformed or incompatible metadata clears history and uses the actual
instantaneous electrical result. Reset, Stop, generation replacement and failure
also clear presentation history. Optical history is not saved in the schematic
or canonical continuation. Disconnected, reverse-blocked and actually failed
LEDs cannot acquire invented emission; a failed neighbour cannot extinguish a
healthy channel's observation. A destructive operating-point stress preview may
still conduct before thermal failure: actual `presentationState=failed`,
`deviceHealth=failed_open` or `damageState=failed`, rather than `stressState` alone,
identify failure. The ordinary LED visual uses its existing overcurrent state
before failure and burned state at actual failure, with zero physical light.

The existing complete-ready cap is 25,000 microseconds. Visible 2,000/100/50-ms
phases retain their instantaneous state. For faster observed signals, the UI
requires five actual alternating light edges delimiting two complete cycles,
with all four phases strictly shorter than that cap. Their time-weighted mean
solved brightness is presented as steady light, independently for each LED;
using complete cycles avoids a false beat from the phase of a ready window.
The last edge must also be less than 25,000 microseconds old. A sustained HIGH
or LOW therefore resumes instantaneous presentation at that boundary. A maximum
125,000-microsecond history plus its predecessor, capped at 513 samples, retains
two qualifying cycles and the current partial phase. This policy expresses the
available observation cadence; it does not claim to paint every physical pulse
on a finite-refresh display or alter any electrical frequency.

Presentation summaries may differ with request partition and are excluded only
as allowed by section 6. Equal horizons, input traces and initial states still
require identical physical results and continuation with capture enabled or
disabled, across budgets, JSON resumes and irregular UI partitions.
