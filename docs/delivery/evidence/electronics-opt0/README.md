# ASA Lab Electronics E-OPT-0 evidence

This directory records the reproducible before-state for Electronics optimization.
It contains measurement evidence only; it does not change solver equations, Arduino semantics, production data, Docker, or deployment.

## Measured revision

- revision: `fcb1a73859383a5be8405b52358e5246971665a1`
- working tree before each canonical benchmark: clean
- machine: Windows 11, Intel Core i5-13400, 64 GiB RAM
- browser: headless Chromium

## Coverage

- 37 domain benchmark cases covering DC, nonlinear devices, sensors, transient models, motors, instruments, unsupported topology, Arduino analysis, and shared Arduino circuit clock.
- 5 Chromium main-thread stress cases selected from the same corpus.
- deterministic fingerprint and expected status are checked for every case.
- production Electronics payload sizes are recorded by the browser receipt.

## Main finding

The current basic DC path is inexpensive on this machine, while the shared Arduino circuit clock and long motor transients are the primary compute hotspots. The heaviest Chromium case reaches about 48 ms p95 on the main thread, close to the 50 ms Long Task threshold, although no >50 ms Long Task was observed in this receipt.

## Interpretation boundary

These numbers are a baseline for this exact machine and SHA, not a universal hardware guarantee. A future optimization is accepted only if it preserves the same deterministic results/statuses while improving the relevant performance metrics.

The first optimization target is therefore execution isolation and scheduling, not a rewrite of the electrical equations. Worker transfer cost and canonical-clock behavior must be measured against this receipt before any old synchronous path is removed.

## Files

- `domain-baseline.json` — machine-readable 37-case domain receipt.
- `DOMAIN_BASELINE.md` — readable domain summary.
- `browser-baseline.json` — machine-readable Chromium/main-thread and bundle receipt.
- `BROWSER_BASELINE.md` — readable browser summary.
