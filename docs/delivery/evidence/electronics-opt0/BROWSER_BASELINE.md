# ASA Lab Electronics E-OPT-0 browser baseline

This receipt measures the current Electronics computation on Chromium's main thread.
The server is ephemeral and isolated: no ASA API, PostgreSQL or live Docker is used.

## Receipt

- revision: `fcb1a73859383a5be8405b52358e5246971665a1`
- dirty tree before run: `false`
- browser: `Chromium 140.0.7339.186`
- runtime: `v24.14.1`
- CPU: `13th Gen Intel(R) Core(TM) i5-13400` (16 logical CPUs)
- protocol: 2 warmups, 5 measured iterations
- isolation: ephemeral 127.0.0.1 HTTP server + Vite middleware; no API or database

## Main-thread cases

| Case | Status | p50 ms | p95 ms | event-loop p95 ms | Long Tasks | max Long Task ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| dc-series-50 | solved | 4.600 | 4.900 | 5.000 | 0 | 0.000 |
| transient-capacitor-5000ms | solved | 13.600 | 16.100 | 16.100 | 0 | 0.000 |
| transient-dc-motor-1000ms | solved | 24.700 | 30.800 | 30.800 | 0 | 0.000 |
| arduino-gpio-clock-2000us | ready | 30.200 | 39.000 | 39.100 | 0 | 0.000 |
| arduino-gpio-small-budget | ready | 44.200 | 48.300 | 48.400 | 0 | 0.000 |

## Production Electronics payload baseline

| Asset | File | KiB | gzip KiB |
| --- | --- | ---: | ---: |
| simulationCore | electronics-simulation-core-dt79V2de.js | 211.1 | 58.6 |
| arduinoCodePanel | ArduinoCodePanel-CUdR0jD4.js | 1932.6 | 468.2 |
| schematicEditor | SchematicEditor-D5paAhe6.js | 154.2 | 49.7 |
| schematicEditorCss | SchematicEditor-0eqg7OIE.css | 95.8 | 18.4 |
| workbenchSidebars | WorkbenchSidebars-DRBLWgwg.js | 68.1 | 15.8 |
| productionManifestAdapter | production-manifest-adapter-OQdm0YsI.js | 49.9 | 16.8 |
| componentCatalog | catalog.json | 987.4 | 78.4 |

## Interpretation

A solve above roughly one animation-frame budget can visibly reduce responsiveness.
A measured Long Task above 50 ms is direct evidence that the current synchronous path
can block browser interaction. This receipt does not change the solver or prescribe a
specific Worker protocol; it establishes the before-state for E-OPT-1.
