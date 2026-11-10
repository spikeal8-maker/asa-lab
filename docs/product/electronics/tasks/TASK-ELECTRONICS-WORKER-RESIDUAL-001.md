---
task_id: TASK-ELECTRONICS-WORKER-RESIDUAL-001
kind: repair
risk: high
semantic_change: 'no'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Check each electrical residual without temporary arrays

Use indexed arithmetic on the solver's dense, internal matrix, right-hand
side, and solution. Preserve row and column order, arithmetic operations,
non-finite propagation, tolerances, and every invocation of the check.
Do not cache or reuse a verdict. Preserve every physical and thermal step,
continuation, GPIO event, and presentation assertion.

Only change `contexts/electronics/domain/solver.ts` in this slice. The
baseline dedicated Chromium Worker profile on ce1e798d measured 60.5 ms
inclusive in `electricalNumericalQuality`. The temporary candidate kept
864 complete responses equal apart from measured compute time and matched
3,000 direct arithmetic cases including non-finite values and signed zero.
Its paired warm requests spent less time computing in the Worker.

Before integration review the exact source, verify solver and clock
regressions and compare native Arduino blinking in Chromium at the original
limits. Report independent strict timing failures separately.
