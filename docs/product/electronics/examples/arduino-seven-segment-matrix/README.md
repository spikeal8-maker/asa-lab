# Arduino 1–4 display qualification — blocked before full matrix

This is a causal BEFORE checkpoint for Issue 817, not a functional example or
approval of the requested twelve-case matrix. No production code was changed.
Owner requests one Uno, 1/2/3/4 raw displays, genuine linear Blockly, linear text,
user functions, counting/effects and acceptable visible timing.

## Reproduced failures

1. **User functions are unsupported.** The saved `showDigit(int)` sketch returns
   a compile error and clock execution fault. It is not replaced with a macro.
2. **Actual NPN/LED circuit violates independent KCL quality.** A 2.2k segment
   resistor and 1k NPN base resistor should be safe currents. Both 1- and 4-display
   circuits fault. A held 1ms runtime snapshot solves numerically, but quality
   reports KCL residual **0.00306030601 A**, above the unchanged 1e-6 A tolerance.
   Saturated collector current is observed as zero while segment b/c each carry
   about 1.308mA. Other junction drops are 1.892431V, below the 1.9V red-junction
   knee. Full source, document, runtime, terminal voltages and quality are saved.
   This is not labelled an NPN-only defect; independent diode active-set handling
   must be investigated. No current clamp or tolerance was changed here.
3. **Multiplex optics show only an instantaneous digit.** A direct GPIO common
   alternative uses 2.2k segment resistors and releases inactive commons as INPUT.
   One display works electrically; four displays advance complete scan cycles
   with finite passing electrical quality, but the mounted Stage displays only
   one active digit. There is no raw-display temporal optical projection.

The genuinely generated Blockly pilot uses only connected GPIO/write/wait blocks.
Since there is no pinMode/INPUT block, its inactive common outputs are HIGH;
reverse voltage approaches 5V. Existing reverse-polarity warnings are preserved,
device health remains normal for this short probe, and this is **not recommended
as a fully qualified circuit**. It independently reproduces the same one-visible-
digit problem. It is not presented as exact parity with the INPUT-release sketch.

## Bounded measurements

The domain target is **20000 microseconds (20ms)**, not 20 microseconds/setup only.
The complete 4-display GPIO circuit has twelve GPIO: eight segment buses plus
four digit commons. All four parts share one Uno; no independent-board shortcut.
Recorded domain runs are a few hundred milliseconds wall time per 20ms model
time, not realtime.

Mounted real hook/Worker/production Stage, desktop width 1440:

| Pilot | Confirmed model horizon | Wall to sample | Visible displays |
| --- | ---: | ---: | --- |
| One, text, INPUT-release | 25.6ms | 433ms | display-0 |
| Four, text, INPUT-release | 25.1ms | 513ms | display-0 only |
| Four, genuine Blockly, output commons | 26ms | 471ms | display-0 only |

Snapshots match active project/session/generation, input digest and committed
horizon. All eight DOM opacities match each display's calculated instantaneous
branch brightness; no digit or brightness is injected. Raw temporal projection
is absent. Natural sample horizons/wall timings vary between runs.

The native receipt was collected before console wording was corrected from the
legacy Servo message to BLOCKED, and before formatting/removing an unused
callback parameter. Those edits change no sampled UI/engine behavior; the receipt
itself explicitly says `BLOCKED_NOT_FULL_MATRIX_PASS`.

## Reproduction and evidence

```text
pnpm exec vitest run contexts/electronics/testing/arduino-seven-segment-matrix.spec.ts
node apps/web/src/electronics/testing/servo-runtime.browser.mjs --arduino-seven-segment-pilot-only
```

Six focused cases reproduce functions/physical failures and electrically valid
GPIO alternatives. Their green test result means **diagnostic reproduction**,
not full feature PASS. Failure-characterization expectations must be replaced
with positive regression checks when the corresponding repairs are selected.
Two/three-display qualification, complete digits/counters/effects, sustained run,
mobile, Stop/Reset and user-function parity are **NOT RUN** after these blockers.

`manifest.json` binds raw and deterministic gzip SHA-256 hashes. Compressed JSON
contains the complete scoped receipts; decompress with standard gzip tooling.
Native source fixtures are in the repository, including genuine Blockly creation.
No broad build or prior static 96-case parity was repeated. Fixed product budgets,
runtime, solver, physics, thermal cadence, timeout values, artwork, dependencies,
server and foreign changes remain untouched. Separate HIGH repairs are required.
