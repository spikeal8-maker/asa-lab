# Corrected canonical Vite Worker yield diagnostic

TEMP evidence: C:\Users\spike\AppData\Local\Temp\asa-vite-yield-faed58ec
Canonical 3172d903073c927b6d9c037f4b4be2530fe068ba; source 48c63466e91cb4f85fadd8c72e1f8a727afefaed. Chromium 140.0.7339.186; Vite 6.4.4.

48/48 complete responses match original Node goldens after removing ONLY metrics.computeMs. All 48 saved state hashes match. Caller request and worker-side experimental request immutability pass. This compares complete state/events/quality/optical output, without selecting smaller projected fields.
Measured execution 1933.17ms including short cancellation, below 90s cap.

## Build and provenance

Actual accepted apps/web/vite.config.ts via Vite build configLoader:runner, production mode, default esbuild minify; canonical worker.format:es. Standard new Worker(new URL(actual Worker source, import.meta.url), {type:module}) pipeline. Baseline Worker source untouched; native and MessageChannel variants use TEMP pre-transform only. 54 loaded repository module hashes equal canonical checkout; no loaded electronics/contracts dist or vendor modules. Source graph has 54 modules. Baseline Worker is 354015 bytes. Full alias/config/source/bundle hashes in manifest and build files. Frozen lock/dependency hashes in summary.json.

- TEMP transport input replaces full app input
- absolute TEMP outDir; emptyOutDir:false; copyPublicDir:false
- write:false skips publication privateSymbols writeBundle encryption/removal only; emitted maps retained TEMP
- configLoader:runner avoids generated config files in repository
- worker plugins: TEMP read-only graph capture plus only two experimental transforms
- all canonical resolve aliases, production minification and ES Worker pipeline preserved

write:false skips only writeBundle publication encryption/map removal, which does not change emitted runtime transformations. Hidden sourcemaps retained solely in TEMP. Config environment graph-capture side effect was off. No repository outputs or private-symbols written. Browser routes serve normal emitted module Worker assets under unique https.invalid origins without server/listening port.

## Descriptive per-request timing

All values milliseconds: median [min, max], two observations per request. Variant order production/native/MessageChannel in pass1 and reversed in pass2; same preflight bootstrap on all three workers. No warmup workload beyond actual protocol preflight.

| Variant | Input | Wall | Compute | Wait | Yield count |
|---|---|---:|---:|---:|---|
| production | no-delay 0 | 9.15 [3.40, 14.90] | 8.60 [2.80, 14.40] | unmodified | unmodified |
| production | no-delay 1 | 8.60 [7.10, 10.10] | 8.10 [6.50, 9.70] | unmodified | unmodified |
| production | no-delay 2 | 31.75 [28.50, 35.00] | 31.05 [28.10, 34.00] | unmodified | unmodified |
| production | no-delay 3 | 21.35 [20.50, 22.20] | 20.90 [19.80, 22.00] | unmodified | unmodified |
| production | millis 0 | 6.25 [2.90, 9.60] | 5.95 [2.70, 9.20] | unmodified | unmodified |
| production | millis 1 | 9.70 [6.90, 12.50] | 9.35 [6.60, 12.10] | unmodified | unmodified |
| production | millis 2 | 43.60 [35.20, 52.00] | 43.00 [34.80, 51.20] | unmodified | unmodified |
| production | millis 3 | 46.20 [44.50, 47.90] | 45.55 [43.90, 47.20] | unmodified | unmodified |
| native-timer | no-delay 0 | 12.25 [3.70, 20.80] | 11.55 [3.00, 20.10] | 0.00 [0.00, 0.00] | 0, 0 |
| native-timer | no-delay 1 | 12.50 [9.20, 15.80] | 11.80 [8.80, 14.80] | 0.10 [0.00, 0.20] | 1, 0 |
| native-timer | no-delay 2 | 34.35 [25.40, 43.30] | 32.70 [23.10, 42.30] | 0.55 [0.20, 0.90] | 4, 2 |
| native-timer | no-delay 3 | 27.90 [23.70, 32.10] | 27.05 [23.10, 31.00] | 0.25 [0.00, 0.50] | 3, 2 |
| native-timer | millis 0 | 6.00 [3.90, 8.10] | 5.60 [3.60, 7.60] | 0.00 [0.00, 0.00] | 0, 0 |
| native-timer | millis 1 | 11.40 [7.20, 15.60] | 10.95 [6.60, 15.30] | 0.00 [0.00, 0.00] | 1, 0 |
| native-timer | millis 2 | 41.40 [35.60, 47.20] | 40.15 [34.80, 45.50] | 0.65 [0.20, 1.10] | 5, 4 |
| native-timer | millis 3 | 40.25 [38.80, 41.70] | 39.70 [38.30, 41.10] | 0.15 [0.10, 0.20] | 4, 4 |
| message-channel | no-delay 0 | 9.60 [2.80, 16.40] | 9.05 [2.40, 15.70] | 0.00 [0.00, 0.00] | 0, 0 |
| message-channel | no-delay 1 | 11.65 [7.50, 15.80] | 11.05 [7.10, 15.00] | 0.15 [0.00, 0.30] | 1, 0 |
| message-channel | no-delay 2 | 40.45 [29.30, 51.60] | 34.80 [27.70, 41.90] | 4.75 [0.40, 9.10] | 3, 4 |
| message-channel | no-delay 3 | 32.00 [27.10, 36.90] | 30.55 [25.60, 35.50] | 0.85 [0.60, 1.10] | 4, 2 |
| message-channel | millis 0 | 5.35 [4.10, 6.60] | 4.95 [3.70, 6.20] | 0.00 [0.00, 0.00] | 0, 0 |
| message-channel | millis 1 | 9.50 [9.30, 9.70] | 8.60 [8.30, 8.90] | 0.00 [0.00, 0.00] | 0, 0 |
| message-channel | millis 2 | 40.55 [39.60, 41.50] | 39.00 [38.20, 39.80] | 0.65 [0.60, 0.70] | 4, 4 |
| message-channel | millis 3 | 36.05 [31.80, 40.30] | 35.15 [30.80, 39.50] | 0.50 [0.40, 0.60] | 4, 3 |

Native timer total wait per request was 0–1.10ms, median 0.10ms (no-delay) / 0.05ms (millis). This corrected production workload does **not** show native host-yield waiting as a material bottleneck. MessageChannel has no consistent wall advantage: aggregate no-delay median 21.75ms versus native 22.25ms, millis 20.75ms versus native 25.60ms, while untouched baseline medians are 17.70ms and 23.85ms. Compute changes and cold/JIT/host effects prevent attributing these differences to scheduling. Negative result: do not implement a yielder from this evidence.

## Cancellation

Continued millis index3 request was reused after its measurement. Experimental-only __cancelProbe flag sends a first-yield diagnostic. Actual cancel-generation message retained real protocol/engine/session/generation guards and used diagnostic requestId. First yield 10.20ms, cancellation processed 19.30ms after post, 9.10ms after first-yield notification. No stale response in 300ms observation window. Original physical request unchanged.

## Limits and outcome

No product implementation is justified by this small probe alone. Correct production build is much faster than the incorrect prior IIFE graph; comparisons to that earlier run mix graph, transforms and host conditions. Timing has two samples per cell and cold-JIT/order effects. Root requested a CPU-slot hold after this short execution call had already finished: possible overlapping lint/discovery is retained as an uncontrolled timing factor. There is no rerun. Counterbalancing cannot remove these confounders. Wall includes request transport and structured cloning, compute excludes cooperative waits. Instrumented native control adds wrapper overhead. MessageChannel wait/count/cancellation observations are descriptive and do not establish native application acceptance or repair all20 failures. Reconstructed projectSessionId limitation remains. New transport fields and common preflight are recorded in receipt/bootstrap. No runtime/test edits, CI, server, ports, Docker, DB or owner assets touched. STOP; independent review required.
