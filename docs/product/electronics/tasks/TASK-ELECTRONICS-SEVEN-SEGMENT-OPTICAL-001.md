---
task_id: TASK-ELECTRONICS-SEVEN-SEGMENT-OPTICAL-001
kind: repair
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Display actual multiplexed segment emission on one Uno

Prepared dependency of the owner's Arduino 1–4 indicator programme. Execution
requires explicit selection in current.yaml after the coupled 819 electrical
repair is verified and integrated. Diagnostic 817 independently proves a real
four-display scan renders only the instantaneous active digit. Do not disguise
this with static digit assignment, GPIO interpretation or visual timers.

Primary `electronics.clock.canonical`, presentation dependency
`electronics.ui.workbench`. Read their exact component entries, canonical clock
contract, existing LED temporal observation/presentation and native commit barrier.
Preserve real solved segment currents, physical/thermal state and quality.

## Selected implementation boundary

Extend existing canonical optical observation to each of the eight raw-display
branches, and project proven fast-cycle emission at the same acknowledged native
cursor. Reuse the existing temporal pipeline, not a second clock or scheduler.

Legacy `observeLedTemporal:true` raw-display golden results are byte-exact.
Use an explicit new opt-in for raw-display history, enabled by the browser Worker
producer. Absent opt-in, omit all new properties. Do not change continuation
state version, Worker protocol, clock costs, thermal steps or source runtime.

Expected production paths (eight direct dependencies, no old-function moves):

- `contexts/electronics/domain/led-temporal-observation.ts`: separate optional
  branch channels from solved physical results; bounded integrals/held samples.
- `contexts/electronics/domain/arduino-circuit-scheduler.ts`: collect raw display
  IDs only under the new opt-in, with normal cancellation/disposal semantics.
- `contexts/electronics/engine.ts`: thread the explicit option without altering
  old callers' output or saved continuation.
- `apps/web/src/electronics/simulation-worker-evaluator.ts`: opt browser producer in.
- `apps/web/src/electronics/led-temporal-presentation.ts`: validate complete branch
  channels and use retained physical history/fast-cycle projection at shared cursor.
- `apps/web/src/electronics/native-optical-presentation.ts`: joint acknowledgment
  and coverage for displays, cancellation/reset/stale generation handling.
- `apps/web/src/electronics/NativeOpticalComponentVisual.tsx`: pass an explicit
  render-only segment brightness override from the acknowledged optical frame.
- `apps/web/src/electronics/ProductionComponentVisual.tsx`: consume that optional
  override with current electrical fallback; never mutate SolveResult currents.

This explicit visual prop is preferred to overwriting electrical branchBrightness
in resultMap. Do not use the old raw-display committed-only shortcut to acknowledge
an optical frame that was never rendered. Ordinary LED asset barrier, Arduino L,
servo, static raw display 788 and direct button matrix 815 must keep working.

## Proof and limits

First two-scan actual one/four-display NPN pilot after 819. Positive regression:
all expected glyphs visible simultaneously, correct physically integrated duty,
no ghosting of unpowered branches and no invented full-intensity four-digit image.
Then cover 1/2/3/4 displays, real linear text and genuine Blockly, changing digits,
DP, Stop/Reset and generation/source changes, desktop/mobile. Missing, malformed,
incomplete, nonfinite or stale history must not produce an invented averaged glyph.
Failed/damaged branches must not inherit earlier healthy emission.

Unit tests: bounded observation/branch integrals, presentation completeness/reset,
native acknowledgment and immutable old raw-display result bytes. Extend existing
817 native fixture with an isolated positive optical mode; keep original BEFORE
receipts immutable. Record model/wall time and per-frame source/session/generation/
digest/cursor correlation. Optical correctness alone is not realtime acceptance.

Focused tests first, one canonical `NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1`,
all bundle budgets and independent review on final SHA. No cap increase,
quality/timeout/cadence weakening, solver/runtime changes, user-function feature,
dependency installation, artwork replacement, foreign edits, server, Docker or DB.
If a new physical or clock invariant is required, STOP with causal evidence.
