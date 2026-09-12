# ASA Lab Electronics E-OPT-0 cold-load baseline

- revision: `e8e3d45bc286f098d47205d6d7f212a579451bda`
- dirty tree: `false`
- browser: `Chromium 140.0.7339.186`
- iterations per cold measurement: 20
- boundary: production-built route modules are imported in fresh browser contexts; this is module cold-load evidence, not authenticated editor TTI.

## Production module cold import

| Profile | Module | p50 ms | p95 ms | max ms |
| --- | --- | ---: | ---: | ---: |
| native | schematicEditor | 25.70 | 42.20 | 114.90 |
| native | arduinoCodePanel | 64.50 | 67.70 | 76.30 |
| native | productionManifestAdapter | 16.90 | 17.50 | 17.60 |
| low-end-4x-cpu | schematicEditor | 69.60 | 76.60 | 83.50 |
| low-end-4x-cpu | arduinoCodePanel | 153.40 | 187.60 | 191.60 |
| low-end-4x-cpu | productionManifestAdapter | 41.60 | 49.50 | 68.70 |

## Component catalog fetch + parse

| Profile | fetch p50 ms | fetch p95 ms | parse p50 ms | parse p95 ms |
| --- | ---: | ---: | ---: | ---: |
| native | 7.40 | 8.50 | 1.70 | 1.80 |
| low-end-4x-cpu | 19.10 | 26.50 | 7.60 | 9.60 |
