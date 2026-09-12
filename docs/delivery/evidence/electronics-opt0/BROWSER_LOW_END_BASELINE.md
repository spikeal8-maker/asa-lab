# ASA Lab Electronics E-OPT-0 browser baseline (low-end-4x-cpu)

This receipt measures the current Electronics computation on Chromium's main thread.
The server is ephemeral and isolated: no ASA API, PostgreSQL or live Docker is used.

## Receipt

- revision: `e8e3d45bc286f098d47205d6d7f212a579451bda`
- dirty tree before run: `false`
- browser: `Chromium 140.0.7339.186`
- runtime: `v24.14.1`
- CPU: `13th Gen Intel(R) Core(TM) i5-13400` (16 logical CPUs)
- profile: low-end-4x-cpu, CPU throttle: 4x
- protocol: 5 warmups, 30 measured iterations
- isolation: ephemeral 127.0.0.1 HTTP server + Vite middleware; no API or database

## Main-thread cases

| Case | Status | p50 ms | p95 ms | event-loop p95 ms | Long Tasks | max Long Task ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| dc-series-50 | solved | 13.400 | 16.600 | 17.000 | 0 | 0.000 |
| transient-capacitor-5000ms | solved | 79.700 | 112.700 | 113.000 | 34 | 129.000 |
| transient-dc-motor-1000ms | solved | 200.000 | 259.500 | 260.200 | 34 | 263.000 |
| arduino-gpio-clock-2000us | ready | 338.500 | 554.000 | 554.700 | 34 | 576.000 |
| arduino-gpio-small-budget | ready | 328.500 | 412.800 | 413.200 | 34 | 442.000 |

## Production live-simulation path

| Case | p50 ms | p95 ms | p99 ms | event-loop p95 ms | Long Tasks | max Long Task ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| production-live-simulation-motor-100ms-ticks | 37.100 | 52.900 | 58.000 | 53.600 | 5 | 73.000 |

## Production Electronics payload baseline

| Asset | File | KiB | gzip KiB |
| --- | --- | ---: | ---: |
| simulationCore | electronics-simulation-core-dt79V2de.js | 211.1 | 58.6 |
| arduinoCodePanel | ArduinoCodePanel-CNRllZEH.js | 1932.6 | 468.2 |
| schematicEditor | SchematicEditor-BRmkbA-r.js | 154.2 | 49.7 |
| schematicEditorCss | SchematicEditor-0eqg7OIE.css | 95.8 | 18.4 |
| workbenchSidebars | WorkbenchSidebars-DiNxLKBx.js | 68.1 | 15.8 |
| productionManifestAdapter | production-manifest-adapter-BBQr840h.js | 49.9 | 16.8 |
| componentCatalog | catalog.json | 987.4 | 78.4 |

## Interpretation

A solve above roughly one animation-frame budget can visibly reduce responsiveness.
A measured Long Task above 50 ms is direct evidence that the current synchronous path
can block browser interaction. This receipt does not change the solver or prescribe a
specific Worker protocol; it establishes the before-state for E-OPT-1.
