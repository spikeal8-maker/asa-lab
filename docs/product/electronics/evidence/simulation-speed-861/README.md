# Simulation speed and state-preserving pause — bounded candidate

Issue [861](https://github.com/spikeal8-maker/asa-lab/issues/861).
The time display opens an accessible rate panel: pause, ×0.1–×0.9, ×1–×10,
resume at the previous positive rate and reset to ×1. Keyboard, touch, Escape
and outside dismissal are covered. Stop still removes the running clock.
The setting is session-only; project documents and schemas are unchanged.

`simulation-pacing.ts` owns the new host adapter. The existing controller gates
all dispatch paths, holds one late response without accepting state or Serial,
and resumes once with input retiming. Nested resume callbacks cannot dispatch
before that retiming. A host callback requesting pause is rechecked before
dispatch. The presenter keeps the exact pending native frame and reanchors its
ACK at the latest rate. Ordinary wall demand is discarded on explicit
transitions; continuation, input and source synchronization remain obligations.
No engine, physics, Arduino instruction timing or Worker protocol changed.

## Before/after default ×1 oracles

Before production changes, artifact commit `87fdbfa7` published five actual
circuits and 25 full timed advances, including serialized continuations,
runtime actions/events, Serial projections, host horizons and native/presenter
frames. The complete before/after raw data is **144,673 bytes**, byte identical:

`b98bfe1f9115686632fb5c4d4cebc6d3528750a67eb4fe4034f745a816b2d36c`.

Coverage clarification: the case named Servo records a Servo sketch's runtime
output on an Arduino board without a physical Servo component. Physical Servo
pose is covered by the separate real native journeys below; the additional full
physical DC Servo baseline is recorded by the follow-up Issue 862. The original
oracle and its case names remain unchanged.

The additional controller oracle was published as `3e40a01b`. It compiles the
actual frozen controller text from baseline `9821f0f8`, without reverting the
working source. Two deterministic scenarios record 115 complete entries:
preflight, H0, dispatch, host reads, yielded continuation, queued physical and
Serial input, retiming, every callback, stream generation and final state.
The final guarded source produces the same **36,314 bytes**:

`a78deca96f4cc89c501245e4e7d3cd9746966957e55a33ff6f03eec647207310`.

Both oracle scripts and full compressed data/receipts are retained here.
Source hashes are SHA256 of actual Git-LF controller text in both modes.

## Focused and native proof

Six focused files passed 361 tests before the final host-callback guard. The
final controller file then passed **100 tests**, including that additional
reentrant-pause case. Other focused source files are unchanged. Mounted tests
cover all three generic clock profiles, paced demand never below accepted C,
paused wall time, and an actual cold native proposal: `pausing` retains its
token, the existing joint ACK settles it, then `paused` blocks further work.
The UI control test covers range mapping, pause/resume and dismissal. Logs are
committed beside this report. Web typecheck and scoped lint passed.

The real Chromium production editor/Worker/Stage ran four journeys:
ordinary LED plus seven-segment display, and a separate Servo circuit, each
at 1440 and 390 pixels. Zero selected before Run completes and ACKs H0 without
positive work. The actual transport holds a response; releasing it while
paused leaves full accepted state, C, P, Serial, request count, generation and
the native servo horn unchanged across 300 ms. Queued button/Serial input is
sent once after resume and after C. Rates ×0.1, ×1, ×2 and ×10 advance valid
results without changing generation or rewinding P. Real native pose and model
angle agree in both Servo journeys. Screenshots were inspected.

The final native receipt precedes only the narrow nested-resume and host-read
reentrancy guards. Their regression tests run on the final source; their
normal native paths are unchanged. The receipt records actual C/P/wall deltas,
not a throughput benchmark: a first interval after a rate transition may finish
an existing in-flight quantum or retained input obligation. It must not be
interpreted as sustained ×10 or real-time acceptance.

Final candidate Web build skipped Nx cache and passed all eight unchanged
bundle caps: editor **187,873/222,000**, Arduino **1,999,981/2,000,000**,
initial graph **555,421/600,000**. The canonical all-module gate and independent
exact-source review are separate steps and are not claimed by this candidate.

The first canonical run and its bounded test-only repair are recorded in
[`GATES.md`](GATES.md), including the preserved FAIL and full log hashes.

## Independent mixed-circuit baseline failure — Issue 862

The first electrically valid combined LED/display/Servo fixture exposed a
pre-existing projection defect, tracked in
[862](https://github.com/spikeal8-maker/asa-lab/issues/862). Its full circuit,
actual requests/responses, continuation and failing native observation are in
`combined-full-diagnostic.json.gz`. Dedicated servo signal is D3; display uses
D4/D6/D7/D8/D9/D10/D11/D12. Supply and common ground are valid.

The frozen `9821f0f8` Worker evaluator with verified unchanged kernel dependencies
reproduces every original full advance byte for byte at H0, 1,000 and 26,000 μs.
An additional baseline advance to 100,000 μs (five 50 Hz servo periods) shows
powered servo state, 45° and a valid 1,008 μs pulse, but its complete result
omits `servoAngleDegrees`. The native horn therefore stays at the default 90°.
The complete old replay is `combined-baseline-replay.json.gz`; hashes cover all
raw and compressed artifacts. No callback shim, guessed pose or kernel repair
hides this FAIL. Separate valid fixtures establish pacing behavior; full mixed
model qualification remains open under 862.

The separate bounded repair is specified in
[its task card](../../tasks/TASK-ELECTRONICS-MIXED-SERVO-OBSERVATION-001.md).

No server, Docker, live database, deployment or installed Save acceptance run.
No foreign changes, old function extraction or limit increases are included.
