# Raw seven-segment multiplex optical projection — 821

Baseline `3c48799ab367177423d208105b2020a3c3cad075` includes the verified 819
electrical correction. This slice repairs rendering of real scanned emission;
it does not add Arduino user functions or claim realtime throughput.

## Change

Explicit `observeSevenSegmentTemporal` capture provides all eight solved
brightness/current channels per raw display. Legacy ordinary-only callers retain
their original bytes. Generic raw routes take read-only initial, held-boundary,
settled-output and endpoint observations, without committing physical state or
adding clock events. An initial/resumed observation can interpolate an existing
checkpoint to its committed horizon; it never commits that interpolated state.
Invalid optical-only reads discard metadata rather than changing execution status.

The existing shared optical cursor projects only proven complete fast cycles.
The native barrier waits for each display's actual proposed vector. An explicit
render-only prop leaves electrical currents/results unchanged. Explicit whole-
display thermal failure kills prior mean emission at its captured first failed-
health timestamp, never at an earlier normal dark scan edge;
other displays retain their histories. Normal dark segments do not imply damage.

## Evidence

- New core/presentation tests cover raw-only/both/legacy/neither, no-raw combined
  capture, full physical/result/serialized-state byte equality with capture on/off
  for 1 and 4 NPN displays, non-event-aligned `25001 → 50003` resumes, mixed
  RC/thermal continuation, cancellation, strict complete/finite channels, actual
  duty, native ACK, failure/zero-tail expiry and reset/static fallback.
- Existing observer/presenter/native/raw-golden focused checks passed. Immutable
  raw-display observation and continuation goldens were not regenerated.
- Real Chromium hook/Worker/Stage: **16 cases** = 1/2/3/4 displays × linear text /
  genuine connected Blockly GPIO/write/wait programs × widths 1440/390.
- All expected glyphs are visible simultaneously; all eight DOM opacities match
  the acknowledged physical projection. Four-display intensity is approximately
  one quarter of actual peak solved emission, not four invented full-bright digits.
- Both four-display text cases additionally change source to 0/8+DP/2/5, check
  the actual executed `loadedSource`, Reset/new generation, all-dark Stop and
  fresh Start. Source changes need not change the electrical input digest; the
  executed source and response/result identity are checked separately.
- Worker ready result, source/project/generation/input digest, acknowledged cursor
  and electrical endpoint are correlated. The cursor may precede its ready
  electrical endpoint; the histories supply that legitimate earlier vector.

`native-receipts.json.gz` contains full scoped receipts; `manifest.json` binds raw
and deterministic-gzip hashes/sizes. Two representative actual screenshots are
retained; the mobile fit view proves rendering, not comfortable circuit editing.

Four-display samples reached an acknowledged 25.1 ms cursor with roughly
529–692 ms Worker compute per ready request in the recorded run. This remains
far from realtime. Lifecycle wall values include source/reset/restart checks.
The core capture-on/off tests also log ordered warmup-sensitive local timing;
these are diagnostics, not a throughput acceptance benchmark.

Reproduce:

```text
pnpm exec vitest run contexts/electronics/testing/seven-segment-optical.spec.ts apps/web/src/electronics/testing/seven-segment-optical.spec.ts
node apps/web/src/electronics/testing/servo-runtime.browser.mjs --seven-segment-optical-only
```

Full canonical gate/build/budget and independent exact-SHA review are reported
separately by the controller. User functions, automatic counters/carry/wrap,
sustained throughput and installed Save/reopen remain outside this optical slice.
No solver/runtime/cadence/thermal rules, thresholds, budgets, dependencies,
protected artwork, foreign work, server, Docker or live data were changed.

## Final source and independent acceptance

Reviewed final composition: `652f4f9ba167f2d8b5e2c64f514cd2176b822cf8` on
fixed main baseline `a9bd5af9`. First draft `4fe5b8de` was NOT READY: its gate was
cancelled after the failure-time review finding. Corrected `8c98b124` passed its
old-graph gate; one final convergence preserved the public Scratch changes and
the eight production file blobs identically, followed by the canonical final run.

- Final canonical gate PASS: **2404 tests** (1301 core + 1103 Web), **71 fresh
  Nx tasks** (1 SDK + 43 types + 27 build), cache skipped with
  `NX_SKIP_NX_CACHE=true`; all budgets PASS.
- Independent **234 focused tests**, one complete 16-case native matrix plus
  lifecycle checks, and one complete 815 direct-button regression PASS.
- Independent integration of actual histories covered **320 segment channels**.
  Maximum absolute difference from the acknowledged two-cycle optical mean: **0**.
  Lit duty for 1/2/3/4 indicators: approximately **99.4536 / 49.7144 / 33.1292 /
  24.8356 percent**. This is physical multiplex duty, not full-intensity substitution.
- Independent native source strings matched requested executed sketches. The
  direct ten-button matrix still passes every press/release and project reopen.

`manifest.json.independent` binds the compressed native, integral and direct-button
receipts. Source gate log SHA-256:
`bb51d6a70cbd65993c9009e1c12f19e5682b72e33dc0555995abef47f6560bac`;
source bundle log:
`d6d1a21d7cf52e2664d4f08eb1cecd60d7a65ca7962c602f6b6e6c859f960866`.

Final integration also preserves unrelated AI changes from `c621592f`. Its
contract additions are type-only and package change is an AI test script, with
no dependency/lock or electronics source change. An additional **seven-task fresh
Web build and all-budget check** passed on `9bed3640`, with the same eight reviewed
production blobs and unchanged Editor **169815/222000**, Arduino **1999997/2000000**,
initial graph **554728/600000**. This extra check is not a new full canonical gate.
The controller's stale dependency checkout first failed to resolve the already
declared AI package `unified` (runner class D); it made no product/dependency edits
and used the already healthy private UI checkout for that integration build.
Exact-main CI and installed acceptance remain separate.
