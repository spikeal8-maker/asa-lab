---
task_id: TASK-ELECTRONICS-SEVEN-SEGMENT-ARDUINO-MATRIX-001
kind: implementation
risk: medium
semantic_change: no
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# New requirement 2/3: Arduino one-to-four display qualification

Owner explicitly requests genuine linear Blockly, equivalent linear text and
user-function sketches controlling 1, 2, 3 and 4 raw seven-segment displays on
one Uno, counters/effects and no problematic lag. Existing 788 static glyph
parity and 815 direct diode matrix remain accepted and are not repeated.

Primary `electronics.arduino.runtime`, native dependency `electronics.ui.workbench`.
Read their component entries and exact existing raw display/native test fixtures;
AGENT_GUIDE sections 2/5/6–13 and the canonical clock contract apply. This is a
TEST-ONLY bounded qualification. No solver/runtime/UI semantic repair is authorized
inside this slice; return a causal receipt for separate repair selection.

## First feasibility checkpoint

Before building a broad matrix, probe existing syntax support for idiomatic
functions and construct physically valid one-display and four-display circuits.
Use actual Uno GPIO and current limits. Four displays must use a real multiplexed
circuit or supported real driver; four independent Unos are not equivalent.
Choose documented resistors/common drive, preserve diode reverse constraints,
source/internal resistance and actual per-pin current. Never inject digits or
brightness. A working multiplex circuit may use existing transistor models.

Measure a short bounded actual engine/Worker run before extending it. If syntax,
electrical calculation, first frame or runtime deadlines fail, preserve source,
circuit, model/wall times, quality and minimal causal reproduction, then STOP.
Do not churn on a known failing broad matrix or increase timeouts.

The first checkpoint contains two independent causal probes: user-function
syntax and one/four-display linear-text/genuine-Blockly optical feasibility.
Record a function failure and still complete the small optical probe; it does
not require functions. STOP after these two probes if either is red, without
attempting the broad twelve-case qualification or repairing production.

## Intended complete qualification

- Four display counts × genuine Blockly linear/text linear/text user functions.
- All digits, distinct per-digit patterns, counters with carry and wrap, moving
  segment/DP effects, explicit short scan delays and no explicit user delay.
- Actual Blockly Workspace/connections/generator; no handwritten code called blocks.
- Independently check logical values, selected/unselected digit drive, physical
  segment currents, integrated duty/brightness, finite/KCL/source quality.
- Real mounted hook/Worker/Stage with active project/generation/digest/committed
  frame correlation; observe whole scan cycles, not a favorable instantaneous frame.
- Desktop/mobile, source stability, Stop/Reset/run-again, saved-state continuation.
- Record model horizon, real wall duration, first visible frame, full scan periods,
  queue/catch-up and interaction latency. Do not label a slow finite result realtime.

## Bounded paths and validation

New shared fixture `contexts/electronics/testing/fixtures/arduino-seven-segment-matrix.ts`,
new focused test `contexts/electronics/testing/arduino-seven-segment-matrix.spec.ts`,
isolated mode in existing `apps/web/src/electronics/testing/servo-runtime.browser.mjs`,
compact examples/evidence under `docs/product/electronics/examples/arduino-seven-segment-matrix/`.
Register actual test paths in the runtime/UI component entries if added.

Source capability probes may use the existing runtime test adapter. Keep production
unchanged. Focused tests/native plus format/lint/targeted types/routing; no broad
build repeat because existing product code is unchanged. Independent review on the
final candidate or causal failure receipt is required. Full product repair needs
a separately selected bounded task and its appropriate canonical gates.

No refactoring, cap changes, foreign work, dependency installation, server,
Docker, DB or listening ports. Executor returns one result and STOP.
