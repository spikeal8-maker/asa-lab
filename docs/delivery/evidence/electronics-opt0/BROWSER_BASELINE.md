# ASA Lab Electronics E-OPT-0 browser baseline (native)

This receipt measures the current Electronics computation on Chromium's main thread.
The server is ephemeral and isolated: no ASA API, PostgreSQL or live Docker is used.

## Receipt

- revision: `e8e3d45bc286f098d47205d6d7f212a579451bda`
- dirty tree before run: `false`
- browser: `Chromium 140.0.7339.186`
- runtime: `v24.14.1`
- CPU: `13th Gen Intel(R) Core(TM) i5-13400` (16 logical CPUs)
- profile: native, CPU throttle: 1x
- protocol: 5 warmups, 30 measured iterations
- isolation: ephemeral 127.0.0.1 HTTP server + Vite middleware; no API or database

## Main-thread cases

| Case | Status | p50 ms | p95 ms | event-loop p95 ms | Long Tasks | max Long Task ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| dc-series-50 | solved | 3.000 | 4.800 | 6.400 | 0 | 0.000 |
| transient-capacitor-5000ms | solved | 11.500 | 18.700 | 18.700 | 0 | 0.000 |
| transient-dc-motor-1000ms | solved | 20.000 | 23.000 | 23.100 | 0 | 0.000 |
| arduino-gpio-clock-2000us | ready | 24.100 | 39.900 | 39.900 | 0 | 0.000 |
| arduino-gpio-small-budget | ready | 35.400 | 47.000 | 47.000 | 0 | 0.000 |

## Production live-simulation path

| Case | p50 ms | p95 ms | p99 ms | event-loop p95 ms | Long Tasks | max Long Task ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| production-live-simulation-motor-100ms-ticks | 3.100 | 4.400 | 6.400 | 16.000 | 0 | 0.000 |

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
