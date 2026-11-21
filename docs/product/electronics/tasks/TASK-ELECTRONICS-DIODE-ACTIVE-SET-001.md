---
task_id: TASK-ELECTRONICS-DIODE-ACTIVE-SET-001
kind: repair
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Correct negative diode companion currents in the Arduino display driver

Bounded repair required by the owner's one-to-four Arduino display programme.
Qualification 817 found a real canonical NPN/display circuit failing KCL around
3.060306 mA during configuration. Independent source diagnosis: diode active-set
uses `drop >= kneeVoltage - 0.02`, so below-knee branches remain stamped with
negative forward companion current while reported current is clamped to zero.
The NPN saturation companion can then carry negative collector current, also
clamped at observation. Do not repair this by hiding the KCL residual or changing
the NPN report alone. Verify the exact preserved circuit/state first.

Primary `electronics.engine.solver`, dependency `electronics.engine.device-model`.
Read their engine-worker-clock component entries, README sections 10/12,
AGENT_GUIDE sections 2/5/6–13 and the applicable numerical quality contracts.
Follow only the diode active-set/stamp/report path and its coupled NPN case.

## Bounded write scope

- `contexts/electronics/domain/solver.ts`: smallest mathematically correct
  active-set consistency repair, no refactor or old-function moves.
- One focused regression file under `contexts/electronics/testing/` covering the
  preserved driver setup state, ordinary diode/LED cutoff and knee cases.
- Reuse the 817 shared physical fixture for actual one/two/three/four driver
  clock qualification. Add only necessary assertions to its focused test.
- Exact component test routing and compact before/after evidence.

No optical accumulation, user functions, capability help, scheduler cadence,
thermal model, dependencies, timeout/iteration changes or unrelated cleanup.
If the minimal correction exposes a separate convergence issue, preserve the
causal result and STOP rather than widening solver architecture.

## Selected second bounded cycle: coupled NPN base admission

The first executor stopped as required after the diode correction: the held
failure is fixed and 18 immutable raw/golden tests pass, but clock shutdown at
2.022ms exposes a second independently confirmed companion mismatch. NPN VBE
0.693137254895V is below its 0.7V knee; both region classification and the
saturation latch admit it through a 20mV margin. The base stamp then carries
negative 686.27451 microamps while observation reports zero. This is not a
convergence issue and not a reason to weaken quality.

Controller selects a NEW executor for this necessary coupled correction under
the same repair. In addition to the diode change, allow the smallest base-admission
consistency change in `contexts/electronics/domain/models/npn-dc-model.ts`.
Cover both region classification and the base eligibility of the saturation
latch. Preserve the VCE saturation latch and region mechanism, device model
version, source limits, collector/base observations and all numerical thresholds.
Do not replace the fault with another current clamp or alter PNP/FET models.

Add tests for below/exact/above base knee, saturated falling edge, configured
base-voltage profiles, back-to-back scans and 1/2/3/4 real NPN display clocks.
The partial first-cycle branch is NOT READY and must not be merged alone.
Retain its exact before/after receipts. If this two-source correction encounters
another independent failure, STOP with the new cause; do not expand architecture.

## Acceptance and validation

1. Preserve exact BEFORE source/circuit/state and raw residual. Show the selected
   branch region, stamped current and reported current agree after repair;
   forward diode current cannot be negative. Retain genuine reverse leakage and
   profile constraints rather than clamping the entire circuit.
2. NPN/display physical setup and multiplex run reach a valid finite result with
   unchanged KCL/source thresholds and actual safe segment/base/collector currents.
   No false claim that this fixes optical multiplex rendering or user functions.
3. Existing solver, diode/LED/RGB/BJT, raw-display golden byte-equivalence and
   physical temporal tests pass. Never regenerate goldens to cover the defect.
   Check boundary voltages, initially floating branches, device ordering and
   saved-state continuation deterministically.
4. Focused new tests first, then one canonical `NX_SKIP_NX_CACHE=true pnpm
   gate:electronics-m1`, bundle check, bounded self-review and new independent
   review on the final SHA. Classify any general CI failure before repairs;
   unrelated modules remain untouched. No repeated micro-build loops.

No cap increase, protected owner art, foreign edits, server, Docker or live data.
Executor returns one verified candidate or one causal failure and STOP.
