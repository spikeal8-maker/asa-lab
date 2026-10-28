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
