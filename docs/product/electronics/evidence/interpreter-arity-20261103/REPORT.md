# Built-in arity allocation experiment — no demonstrated improvement

Selected task: TASK-ELECTRONICS-INTERPRETER-HOT-LOOP-001. Base source
3127ff6b3486fe04839e327665934ae69ec545c5. This dated result is evidence, not live
execution state. No product change is proposed for integration.

The experiment moved the exact two readonly arity lookup records out of
`validateCallArguments`. Their entries, inherited-property behaviour, lookup
precedence, errors and all caller shadow checks were unchanged. The private
patch is retained in TEMP and was then removed from the author checkout.

## Actual production build and input identity

Both builds use the actual accepted Vite config with configLoader:runner,
production ES module Worker and default esbuild minification; 54 repository
modules are loaded, with no aliased Electronics/contracts dist modules. No
Worker transform, timer override or instrumentation was installed. TEMP input
only creates the original Worker. Absolute TEMP output, emptyOutDir:false,
copyPublicDir:false and write:false avoid repository/publication writes; the
last skips the private-symbol publication hook, preserving emitted runtime
transformations. Canonical clocks, budgets, physics and quality checks remain.

- before: runtime SHA256 `0048ecfde40be4b00569badae34d3c1e5e0d2287051664ee8f10f193e9bdd8e3`; Worker source SHA256 `725aa159cbce3ece5bc9971396daff20ea1f844943ba1ad79b58a005bc823377`.
- after: runtime SHA256 `87292c0aadb10f332c34ade3f662b88a3260a45d6257cdbe6844cb9f0455b180`; Worker source SHA256 `725aa159cbce3ece5bc9971396daff20ea1f844943ba1ad79b58a005bc823377`.

The emitted baseline Worker is 354015 bytes (SHA256 `689ed0889baf00d464aa5442a07a4896cf877e2fc18e7a9328c95aff2a3a0127`); AFTER Worker is 354025 bytes.
Input JSON SHA256 `9566f01fcae9849a6e3ecddbef850baac80819e8158ffc4402475018265e4476`. The same 8 complete saved no-delay/millis requests retain source, state, horizons 0/1000/26000/51000us, quality and electrical topology. The original projectSessionId was not logged; the existing replay reconstructs it from saved project.id, so original browser-session transport parity is not claimed.

## Parity and bounded timing

Chromium 140.0.7339.186, 20 passes, 8 requests per pass per build: 320 actual full
responses. Build order alternates BEFORE/AFTER and AFTER/BEFORE each pass. Each
worker receives the same protocol preflight once. First pass is cold; all later
passes use the same two workers. No app/listening port, server, Docker or DB.

All 320 complete responses equal the previous saved golden after deleting ONLY
`metrics.computeMs`; all 320 complete state hashes equal the original saved
states. All caller request hashes/serialized objects remain unchanged. This
checks caller immutability; no extra worker-side input instrumentation was used.

Total measurement 7.210s, below 120s bound. Total compute 2145.70ms BEFORE and
2178.20ms AFTER (+1.51%); overall median 11.10ms and11.20ms. There is no consistent
benefit. Warm medians below exclude only the explicitly cold pass 0; all 20 raw
rows per request/build are retained, with no outlier filtering.

| Input | Horizon index | BEFORE warm compute ms | AFTER warm compute ms |
|---|---:|---:|---:|
| no-delay | 0 | 2.50 | 2.60 |
| no-delay | 1 | 5.40 | 5.30 |
| no-delay | 2 | 13.20 | 13.90 |
| no-delay | 3 | 14.10 | 14.30 |
| millis | 0 | 2.40 | 2.90 |
| millis | 1 | 4.80 | 5.70 |
| millis | 2 | 26.50 | 28.10 |
| millis | 3 | 28.20 | 25.60 |

The host, timer precision, JIT and two separate Worker isolates remain confounds.
These mixed distributions do not establish a causal regression either. They
provide no evidence sufficient to activate the speculative optimization. No
repeat measurement, broad test/build gate or native20 rerun was performed.
**Zero of the 20 timing failures is closed by this experiment.**

## Preserved evidence and disposition

Raw builds, 54-module hashes/config/dependency identities, 320 full responses,
request file, raw rows, scripts and exact candidate patch remain under:
`C:/Users/spike/AppData/Local/Temp/asa-arity-20261103/`.

- `build.mjs`: 3811 bytes, SHA256 `04fe23181a5e3f11db865ce2ebfb122bca38ca671ee37eed612b33aff6a568ba`.
- `measure.mjs`: 5018 bytes, SHA256 `34a2a6b3bd39d1a3d274eb68aee89c568d433a7167ba7c079fed27c457b06666`.
- `before.build.json`: 25331 bytes, SHA256 `29703ba6fde52b11b4a1c4a41301b575d9c1a8bbbc3d5457dc02931e0f8e1971`.
- `after.build.json`: 27342 bytes, SHA256 `8a1139761de1d25f2da44d8a30136502b787f35537c0fa096d9de6361facd4b4`.
- `inputs.json`: 72999 bytes, SHA256 `9566f01fcae9849a6e3ecddbef850baac80819e8158ffc4402475018265e4476`.
- `receipt.json`: 144201 bytes, SHA256 `f0bd10aafaaf8f1a6adbdcff9e1887b3c9805738795eeee04bfe31e160fcd8af`.
- `summary.json`: 3785 bytes, SHA256 `8f1f8104bd91021317a2df5668d7c626a1fe77f95974ab71c0f6cebd3201eace`.
- `candidate.patch`: 1952 bytes, SHA256 `2c30810c0c61fa526f51f192da63bd58fdda8d180495eed2c54685b56d45b7d8`.

The runtime file was restored only from this branch's own HEAD after preserving
its exact patch; it now matches the BEFORE runtime hash. No foreign working
copy was modified. Author STOP: evidence-only candidate, no runtime activation,
no timing acceptance, no deployment or owner acceptance.
