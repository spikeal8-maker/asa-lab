# ASA Lab Electronics E-OPT-0 memory baseline

- revision: `e8e3d45bc286f098d47205d6d7f212a579451bda`
- dirty tree: `false`
- browser: `Chromium 140.0.7339.186`
- warm-up: 30s before the retained-heap baseline
- soak: 900s, 59716 cumulative live-simulation iterations
- method: production advanceLiveSimulation motor path; persistent 100 ms simulation ticks; warm-up then CDP GC baseline plus GC-stabilized checkpoints
- cold heap before warm-up: 5612394 bytes
- warm GC-stabilized baseline: 6644790 bytes
- retained delta from warm baseline: 92743 bytes
- retained growth from warm baseline: 1.40%
- provisional <=5% target: PASS
- maximum single live-simulation iteration: 10.800 ms

## GC-stabilized checkpoints

| Elapsed soak s | Heap bytes | Delta from warm B | Growth from warm % | Total iterations |
| ---: | ---: | ---: | ---: | ---: |
| 180 | 6682310 | 37520 | 0.56 | 13605 |
| 360 | 6712333 | 67543 | 1.02 | 25133 |
| 540 | 6726597 | 81807 | 1.23 | 36653 |
| 720 | 6732469 | 87679 | 1.32 | 48183 |
| 900 | 6737533 | 92743 | 1.40 | 59716 |
