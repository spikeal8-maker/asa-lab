# Event queue copy experiment — 3 November 2026

Selected card: `TASK-ELECTRONICS-EVENT-QUEUE-COPY-001` on canonical main
`94deef205460271393e559962bcd8caf1fcc71be`. This is negative evidence only.
**The product change is withdrawn. Zero timing failures are closed.**

## Isolated hypothesis

`advanceRuntime` first copies `previous.eventQueue` into its invocation-local array.
The owned return path then copies that new array again. The only local mutations
are synchronous `emit` push/truncation and fault clearing; `emit` is passed only to
synchronous `expireTones` / `applyRuntimeAction`, including synchronous recursion.
It is not retained in `OwnedRuntimeMemory`, instruction workspace or the returned
state. The next call still copies its previous state before mutation. Event leaves,
order, sequence, queue limit256 and all other behaviour remain unchanged.

The experimental patch replaced only `eventQueue: owned ? [...eventQueue] :
eventQueue` with `eventQueue` at return. It did not include the withdrawn arity
patch, change public admission, clocks, instruction costs, model horizons,
physics, quality barriers, event history or any timeout/assertion/cap.
This source isolation proof did not establish a material performance benefit.

## Actual production experiment

Before and after were built through the existing actual Vite production config,
`configLoader:runner`, ES Worker and default esbuild minification. Each graph has
54 repository modules and the same config/lock/Worker source hashes. Only the
experimental runtime module changes. TEMP transport replaces the app entry;
`write:false` skips publication graph encryption/write only, not Worker runtime
transforms. No app server, listener, Docker, DB, fake clock, instrumentation or
observer/yielder transform was used.

The first attempt could not load config because this fresh checkout lacked its
`apps/web/node_modules` link. The existing frozen dependency link was attached;
no product/config/dependency file was changed. The successful BEFORE Worker is
354015 bytes, hash `689ed0889baf00d464aa5442a07a4896cf877e2fc18e7a9328c95aff2a3a0127`,
matching the prior canonical probe. AFTER is354006 bytes, hash
`c2e70127931d1bb71f61e479cf1196add715d0e73956bc576e206333c9407055`.

Chromium140.0.7339.186 ran20 counterbalanced passes ×8 original frozen full
no-delay/millis requests ×2 actual Workers: **320 responses in9.820 seconds**.
All complete responses match original goldens after deleting only
`metrics.computeMs`. All320 saved-state hashes and caller input immutability
checks pass. Original projectSessionId remains reconstructed from saved project
id, as in the prior replay; this is not native application20 acceptance.

## Measurement outcome

| Metric | BEFORE | AFTER |
|---|---:|---:|
| Total compute, ms | 3067.90 | 3039.20 |
| Median compute per request, ms | 13.45 | 14.90 |
| Total request wall time, ms | 3171.70 | 3139.30 |
| Median request wall time, ms | 14.05 | 15.30 |

Compute total is0.94% lower, but median is10.78% higher. Per-cell medians are
mixed: no-delay25ms cells21.90→23.80 and23.70→23.50ms; millis25ms cells
42.60→40.95 and40.90→41.65ms. There is no consistent demonstrated improvement.
Separate Worker isolates, cold first pass, JIT, host load and timer precision
remain confounds. No causal regression or material speed gain is established.
No rerun, alternate patch, full gate, General CI or native20 rerun was justified.

## Preservation and disposition

Raw builds,54-module identities,320 complete response files, exact patch and
scripts remain in `C:/Users/spike/AppData/Local/Temp/asa-event-copy-20261103/`.

- `build.mjs`: 3810 bytes, SHA256 `fbcb6da25e193fe042e5e1111b34c8fc48d32012bbac74d70f16365175479940`.
- `measure.mjs`: 5038 bytes, SHA256 `184e73ffe287966ef897c7d6f61632be9424f576c79c8e6f378da7eca288dede`.
- `before.build.json`: 25221 bytes, SHA256 `d67db075f2e103a9c07fe8d1c32676535bc439c0b88f979b9b2d4bf4f12db266`.
- `after.build.json`: 25868 bytes, SHA256 `38ffd2b9521cc9a78f04f189581fbcf0f6f83bd4b91906fc6674d017e82346fa`.
- `inputs.json`: 72999 bytes, SHA256 `9566f01fcae9849a6e3ecddbef850baac80819e8158ffc4402475018265e4476`.
- `receipt.json`: 144144 bytes, SHA256 `f9457a3dbac8e718fa46c841b461f6e2e8ad0efbee424a673e138e59bf3734a5`.
- `summary.json`: 1515 bytes, SHA256 `be54981c4c1363b04f8870c19aed3aafff5ac9279e983fd86d2b6ac088504f1e`.
- `candidate.patch`: 636 bytes, SHA256 `288a38141a34871f5cba8cd3f45669fe7a9a7fdcaefcd9a50f7f103569f1aaa0`.

Only this branch's own runtime patch was preserved and restored from its HEAD.
Its restored SHA256 equals the successful BEFORE runtime hash. The candidate
commit contains this report only; no source activation. Initial exact-path
preflight SAFE_TO_START, selected routing validation, formatter and diff checks
are reported separately from runtime acceptance. Server, live DB, Docker,
protected assets, foreign changes and all20 open timing failures are untouched.
Author STOP; independent evidence review remains required.
