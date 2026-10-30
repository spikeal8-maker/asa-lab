# Mixed-circuit Servo observation — baseline and bounded repair

Issue 862. Before production edits, `oracle.mjs.txt` compiles the actual engine,
presenter and **batched** Worker evaluator. It retains all five legacy fixtures
and 25 full advances from 861: 144,673 raw bytes, unchanged SHA256
`b98bfe1f9115686632fb5c4d4cebc6d3528750a67eb4fe4034f745a816b2d36c`.
One legacy fixture contains a Servo sketch on an Uno without a physical Servo;
that case proves runtime compatibility, not physical Servo observation.

The additional direct-DC fixture has an actual Servo, Uno, independent D3 signal,
5V/common ground and a deterministic 45/135-degree program. Removed component
wires are also removed. Its five full advances include real observed 45/135
poses and confirm `dc-inputs-v1`.

The mixed fixture reuses the complete saved failure from 861, including actual
Worker requests and old continuations. Batched evaluation matches every captured
full advance byte for byte. Five full mixed advances cover H0/1000/26000/51000/
100000 microseconds; decoded state is valid but projected angle is absent.
The full data and raw-byte receipt are retained as `before.json.gz` and
`before-receipt.json`. No equations, scheduler, decoder, UI or kernel source was
changed to record this baseline.

## Bounded correction and numerical comparison

The only production change is a local, exact HC-SR04/Ping/Servo runtime-map
literal forwarded at the five existing transient option boundaries. No other
solver options are spread; equations, decoder, scheduler, quality and UI are
unchanged. Capturing the same readonly map references also preserves existing
ultrasonic behavior.

The full AFTER data is 343,853 raw bytes, SHA256
`38445cac0490f13d95a1f2de33e6a9ca17baf06491fe791798a5151d7dbdb076`.
All five legacy cases and the actual direct DC Servo case remain byte identical.
For each of the five mixed full Worker advances, removing only the newly added
`servoAngleDegrees` of the known Servo measurement makes the entire request and
advance byte identical to BEFORE. These exact paths and decoded 90/90/135/45/45
values are recorded in `comparison.json`. All serialized state, electrical
numbers, nodes, actions, Serial and LED/display outputs are unchanged. Maximum
observed KCL residual is 6.4e-11 A. The initial 90 degrees precede a complete
valid pulse; they must not be replaced with the current `Servo.write(45)` target.

## Focused and native proof

Eight focused suites passed **216 tests**, including six new regressions:
actual mixed decoded pose, JSON/yield/horizon repartition and determinism,
zero/normal observations, real RC rejection and adaptive half-steps, actual
thermal failure/resampling, and the real 4096-step unfinished-result limit.
The incomplete-limit case took 1,046 ms in its isolated run; the eight-suite
run completed in 7.17 seconds. Existing Servo, HC-SR04 and Ping tests passed.

The final null-result `?? solveCircuitStep` backstop is not reachable through
normal valid same-time continuation: non-clocked validation rejects equal-time
state, while the clocked zero-duration case has its own earlier return. No
invalid state, validation change or production test hook was introduced to
pretend that backstop executed. All five map-forwarding literals were inspected;
the actual unfinished-result branch remains nonconvergent with pose intact.
An initial raw-solver fallback test had incorrectly expected convergence failure
after a rejected equal-time continuation. It was replaced by the real bounded
work-limit case; its failed test log is preserved without changing production.

The production Chromium editor/Worker/Stage ran **four real mixed-circuit
journeys**: constant 45/135-degree Arduino programs, each at 1440/390. Actual
decoded pulse state, solver measurement and native horn rotation agree; the
ordinary LED is lit, all seven digit segments are lit and the decimal point is
off. The result is solved, finite and within quality limits. The whole Servo is
inside the viewport after actual FitScene interaction; desktop/mobile images
were inspected. Full requests, responses and state are in `native-receipt.json.gz`.
No angle injection or callback result replacement is used. API/assets are fixture
ports; no listening server, installed Save or database was used. An initial
ambiguous body/terminal-overlay locator was narrowed to the exact schematic
component for its viewport assertion; no product change was needed.

Scoped ESLint, formatting, context TypeScript and routing checks passed. The
candidate Web build executed seven fresh Nx tasks with cache skipped. All eight
unchanged caps passed: editor 187,873/222,000; Arduino 1,999,981/2,000,000;
initial graph 555,421/600,000 bytes. Logs and lossless raw/compressed hashes are
retained alongside this report. No cap increase or unrelated cleanup occurred.

Canonical gate and new independent exact-SHA review are separate steps and are
not claimed by this candidate. Execution state remains in `current.yaml`.
No server, Docker, live database, deployment or owner acceptance is claimed.

## Subsequent controller verification

Exact-source canonical completed on one unchanged retry after a documented
timing-only failure: **2,556 tests**, **71 fresh Nx tasks**, all fixed caps PASS.
A new independent reviewer passed 222 tests and four fresh native journeys,
including actual computed horn matrices and independent full-oracle reproduction.
General run 41009745129 succeeded in all four jobs. See [GATES.md](GATES.md) and
[INDEPENDENT_REVIEW.md](INDEPENDENT_REVIEW.md) for full evidence and the preserved
initial timeout. Installed/owner acceptance and deployment remain separate.
