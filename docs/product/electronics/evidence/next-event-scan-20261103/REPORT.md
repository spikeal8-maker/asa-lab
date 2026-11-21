# Next-event scan experiment — 3 November 2026

Selected card: `TASK-ELECTRONICS-NEXT-EVENT-SCAN-001`, canonical baseline
`418ae8d5db5c30949f0476da22ea40feb98506bf`. **Negative evidence: product patch
withdrawn; zero timing failures closed.**

## Bounded hypothesis and source review

The main scheduler loop calls `nextTime()` in its condition and immediately again
for its body timestamp. For supported plain runtime state, the selectors only
read board/input/sensor/tone/servo/physics state; no mutation intervenes between
those two calls. Reviewed sensor due selectors return phase timestamps; waveform
selectors validate/read and calculate edges; servo selection sorts a new array.
The experiment removed only this duplicate call:

```diff
-  while (nextTime() <= targetMicroseconds && clockEvents < budget) {
-    const time = nextTime();
+  for (let time = nextTime(); time <= targetMicroseconds && clockEvents < budget; time = nextTime()) {
```

Both outer `continue` paths run the update expression after their mutations.
Nested-loop continues remain nested; fault returns still exit immediately.
The final readiness scan remains fresh. `let` has per-iteration bindings, so
closures such as `observe` and ADC callbacks retain that iteration's timestamp.
No inner tone/physics scan, guard, public step boundary, clock/instruction cost,
budget, horizon, cap, quality check or fault path changed. No batching experiment
or earlier arity/copy patch was included. This source argument does not establish
a performance improvement.

## One production measurement

Built BEFORE and AFTER independently from this checkout through the actual Vite
production config, `configLoader:runner`, ES Worker and default esbuild minify.
All54 repository module identities/hashes were compared: only the scheduler
source differs. Config, lockfile and Worker entry source hashes match. TEMP
transport replaces the app entry; `write:false` skips publication graph
encryption/write only. No server/listening port, Docker, live DB, CPU profile,
synthetic loop, instrumentation, fake clock or observer transformation.

Worker BEFORE:354015 bytes, SHA256
`689ed0889baf00d464aa5442a07a4896cf877e2fc18e7a9328c95aff2a3a0127`.
AFTER:354021 bytes, SHA256
`20be751b7b2e105be058b9bdbec8fa5145661f3273627b01b7ee132e095d5f3f`.

Chromium140.0.7339.186 ran20 counterbalanced passes ×8 original frozen complete
no-delay/millis requests ×2 Workers: **320 responses in7.483 seconds**, within
the120-second cap. All320 complete responses equal original goldens after
deleting only top-level `metrics.computeMs`; this includes saved states, quality
and optical output. All saved-state hashes and caller input immutability checks
pass. Original projectSessionId is reconstructed from saved project id, as in
the preceding replay. This TEMP transport does not qualify native application
startup, visible frame timing or any original timing assertion.

## Result

| Metric | BEFORE | AFTER |
|---|---:|---:|
| Total compute, ms | 2199.90 | 2294.60 |
| Median compute/request, ms | 12.10 | 11.60 |
| Total request wall time, ms | 2279.00 | 2375.90 |
| Median request wall time, ms | 12.50 | 11.80 |
| Warm compute median, passes1–19, ms | 10.15 | 10.85 |
| Warm wall median, passes1–19, ms | 10.50 | 11.50 |

Total compute is4.30% higher; warm median is6.90% higher, despite a4.13% lower
all-pass median. Warm per-cell compute medians are mixed: no-delay indices0–3
are2.50→2.40,4.70→5.00,14.50→15.80,14.90→13.70ms; millis indices0–3 are
2.50→2.80,5.10→5.10,27.10→28.20,29.00→25.90ms. No credible consistent gain
is demonstrated. Separate Worker isolates, cold first pass, JIT, host load and
timer precision remain confounds; these data do not establish causal regression.
No variant, rerun, full gate, General CI or native timing qualification followed.

## Preservation and disposition

Raw builds, complete54-module graphs,320 response files, inputs, patch and scripts
remain in `C:/Users/spike/AppData/Local/Temp/asa-next-event-scan-20261103/`.
SHA256 and byte sizes:

| File | Bytes | SHA256 |
|---|---:|---|
| build.mjs | 3815 | `7f5449f85c9275b4d0adfa88c67ad532099bf8e14357d361277db294e7929739` |
| measure.mjs | 5050 | `624d802a66b0d92f33ad39fe16ad5da8edb46849414759cb7b2183bdf6f38129` |
| analyze.mjs | 1643 | `ef8169f84e55983034ea94e69d2c4ad7b3b2eb9d001f49a25c0de1f2d78f1119` |
| before.build.json | 25113 | `028a0f2ee0051f2dfab2091b16f1373d20dced958bb3e1a3ad517ddc0802da49` |
| after.build.json | 25966 | `be5e54e9d6b7c806424ca312497614245c87a7b10cc292540b207e1eabfe1e1b` |
| inputs.json | 72999 | `9566f01fcae9849a6e3ecddbef850baac80819e8158ffc4402475018265e4476` |
| receipt.json | 143791 | `c83db156e1accde5e689c1ff42f5a5895d2cde2264ba71cf24fa60b7c5373249` |
| summary.json | 14981 | `03a7cc82b3a5dc89e4cdb6fee3bd5be6930adf4d9c32e09ee573ee672f951de4` |
| withdrawn.patch | 855 | `db6392921970d0635d7b3a0b7b6e339daca2cb7508beaf3a53af38a0e8002293` |

Only this author's scheduler patch was restored from HEAD. Its restored SHA256
equals BEFORE: `475e4f70e2718e7f0c2ab88700379b74321b7b9979d03d4287d1b0ba6e8bf10e`.
Experimental scheduler hash:
`b99e0825edbbfc60eee35b26ab7f6461c430848d72dd1c224dbd9a75dacdb698`.

Correct selected-lane preflight: SAFE_TO_START,0 overlaps/blockers; selected-card
routing validation: PASS. Final candidate contains this report only. Product
focused tests were not run after the no-gain decision: there is no runtime
candidate to accept. Server, Docker, DB, protected assets, foreign test source
and all20 open timing failures remain untouched.

SELF_REVIEW: PASS for bounded negative evidence and withdrawal. Independent
evidence review remains required. NEXT_ALLOWED_TASK: STOP / CONTROLLER REVIEW.
