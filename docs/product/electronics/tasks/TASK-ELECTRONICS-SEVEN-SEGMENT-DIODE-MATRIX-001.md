---
task_id: TASK-ELECTRONICS-SEVEN-SEGMENT-DIODE-MATRIX-001
kind: implementation
risk: medium
semantic_change: no
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# New requirement 2: ten-button direct diode matrix

Owner supplied a Tinkercad pupil circuit on 2026-10-28. Deliver a functional
ASA circuit with ten momentary buttons selecting digits 0–9 through a physical
diode matrix, without Arduino. Existing 788 parity remains accepted; Arduino
counter/effects are a later separate slice. No claim that all requirement 2 is
complete from this direct circuit alone.

Primary component `electronics.engine.device-model`; native dependency
`electronics.ui.workbench`. Read their exact entries in
`components/engine-worker-clock.yaml` and `components/ui-assets-persistence.yaml`,
README sections 5/10/12, and AGENT_GUIDE sections 2/5/11–13.

Use existing battery-holder-aa-2 (2×1.5 V, as pictured), tactile buttons, DO35
diodes, axial resistors and canonical ten-pin seven-segment common cathode.
The screenshot does not prove exact resistor values or every wire: document
chosen values and functional equivalence honestly. Do not silently increase
the supply to 4.5 V or fake brightness to make the example pass. Keep current
limitation, real source resistance, diode polarity and forward drops. Preserve
the visible idea of ten separate resistor/diode branches and shared segment
buses. A full decimal matrix contains 49 diode routes; DP is disconnected.

## Bounded writes

- New shared test fixture `contexts/electronics/testing/fixtures/seven-segment-diode-matrix.ts`.
- New focused domain test `contexts/electronics/testing/seven-segment-diode-matrix.spec.ts`.
- Existing `apps/web/src/electronics/testing/servo-runtime.browser.mjs`, isolated
  `--seven-segment-buttons-only` mode; existing modes must remain unchanged.
- Compact evidence and a reusable ASA circuit/project JSON under
  `docs/product/electronics/examples/seven-segment-diode-matrix/`.
- Add the actual fixture/test routing paths to the two component entries.

No production code changes in this qualification slice. If the real circuit
fails, return a minimal causal receipt and STOP for a separately selected repair;
do not alter physics, convergence, tolerances, timeouts, assets or actuation.

## Acceptance

1. Build the entire real circuit first. Domain checks cover all ten single-button
   press/release states, repeated sequence, representative simultaneous electrical
   button pairs, zero inactive-branch current/no backfeed, segment glyphs,
   current limits, brightness and finite/KCL/source-quality constraints.
2. Mounted real hook/Worker/Stage, no result/digit/brightness injection. Actual
   desktop/mobile pointer press/hold/release for all ten buttons produces the
   calculated glyph. Correlate active project/session/generation/input digest
   and committed frame; initial darkness or stale results cannot pass.
3. The saved reusable circuit survives parse/serialize/reopen with identical
   electrical topology and behavior. Use an existing supported export format;
   do not call a domain-only document an importable project without proof.
4. Explain simultaneous electrical button results as circuit behavior; no
   invented priority digit. Existing one-actuator UI may not support multi-touch;
   do not claim UI multi-touch acceptance from domain state tests.

## Validation boundary

First domain circuit feasibility; then one native matrix and bounded independent
review on the final SHA. Format/lint/routing and focused tests only. Since product
code is unchanged, carry prior 751 focused 2345 tests/71 fresh Nx/type/build/caps
evidence; do not repeat full builds or prior 96 Arduino parity cases. A real
product defect requires explicit repair selection before any such edit.

No server, Docker, live DB, listening ports, dependencies, foreign changes,
refactoring, owner-asset replacement or budget increase. Executor returns the
bounded candidate/evidence and STOP; controller owns execution state.
