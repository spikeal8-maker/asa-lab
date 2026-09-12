# ASA Lab Electronics E-OPT-0 evidence

This directory records the reproducible before-state for Electronics optimization.
It contains measurement evidence only; it does not change solver equations, Arduino semantics, production data, Docker, database schema, or deployment.

## Measured revision

- revision: `e8e3d45bc286f098d47205d6d7f212a579451bda`
- working tree before every canonical receipt: clean (`dirtyTree=false`)
- machine: Windows 11, Intel Core i5-13400, 64 GiB RAM
- browser: Chromium 140.0.7339.186
- low-end profile: Chromium CPU throttling x4; this is a controlled proxy, not a claim about one specific school PC

## Coverage

- 50 domain cases across linear/nonlinear DC, LED reverse/overcurrent, button/SPDT, NPN, sensors, supplies, RC, motor startup/stall/thermal, instruments, invalid/unsupported/nonconvergent paths, Arduino GPIO/ADC/PWM/tone and multi-board shared clock.
- committed cross-version golden fingerprints for all 50 cases, in addition to same-run determinism checks.
- domain protocol: 30 measured iterations x 3 series per case.
- native and x4-CPU Chromium main-thread measurements, including the production `advanceLiveSimulation` path.
- 20-sample cold production import measurements for SchematicEditor, ArduinoCodePanel and production manifest adapter plus catalog fetch/parse.
- 900-second retained-memory soak of the production live motor path with GC-stabilized checkpoints.
## Main findings

On the native browser profile, `dc-series-50` is about 4.8 ms p95, while Arduino shared-clock cases approach 40-47 ms p95 and remain the dominant interactive compute hotspot. The production live motor tick is about 4.4 ms p95 on this machine.

Under x4 CPU throttling the risk becomes explicit: capacitor/motor/Arduino stress cases create browser Long Tasks, Arduino shared-clock cases reach roughly 413-554 ms p95 event-loop delay, and the production live motor tick reaches about 52.9 ms p95 with Long Tasks observed.

Cold-load evidence also separates payload cost from solver cost. `ArduinoCodePanel` is about 1.98 MiB minified and its cold import is about 67.7 ms p95 native / 187.6 ms p95 under x4 CPU throttling. The component catalog itself is comparatively cheap to parse.

The 15-minute live-physics soak completed 59,716 iterations with retained heap growth of about 1.40% from the post-warm-up baseline, below the provisional 5% target. This scenario therefore does not show a material retained-memory leak.

## Interpretation boundary

These results justify moving simulation work away from the UI main thread before attempting a solver rewrite. They do not establish universal hardware performance or SPICE-equivalent physical accuracy. Any E-OPT-1 change must preserve the committed golden results and fail-closed statuses while reducing main-thread work.

## Files

- `domain-baseline.json` / `DOMAIN_BASELINE.md` — 50-case domain receipt.
- `browser-baseline.json` / `BROWSER_BASELINE.md` — native Chromium main-thread/live-path and bundle receipt.
- `browser-low-end-4x-cpu.json` / `BROWSER_LOW_END_BASELINE.md` — controlled low-end CPU profile.
- `load-baseline.json` / `LOAD_BASELINE.md` — production cold-import and catalog load receipt.
- `memory-baseline.json` / `MEMORY_BASELINE.md` — 900-second retained-heap soak.
