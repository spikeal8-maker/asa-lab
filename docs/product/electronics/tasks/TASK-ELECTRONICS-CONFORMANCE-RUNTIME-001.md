---
task_id: TASK-ELECTRONICS-CONFORMANCE-RUNTIME-001
kind: maintenance
risk: medium
semantic_change: no
roadmap_slice: null
prerequisites:
  - Issue 517 exact-candidate independent REQUEST_CHANGES on 2d4654f207f41e5d3712b3071af05e6d3830fa31
acceptance_boundary: slice
review: independent
---

# Preserve complete-state conformance within its existing runtime guard

Separate bounded dependency [#521](https://github.com/spikeal8-maker/asa-lab/issues/521) of programme [#452](https://github.com/spikeal8-maker/asa-lab/issues/452). Preserve unaccepted #517 candidate `2d4654f207f41e5d3712b3071af05e6d3830fa31`, #516 and #505/PR #506.

## Confirmed blocker and minimal route

Exact #517 focused run `37680023310`, job `112993343304`, failed the unchanged `observation-arduino-led: preserves full state and result through bounded complete horizons` case in `contexts/electronics/testing/engine-trace-replay.spec.ts:468`: 5,234 ms exceeded the existing 5,000 ms guard; 632/633 cases passed. No numerical or state mismatch was logged. Category C relative to #517: its diff did not change this conformance source. Its exact general run `37680001869` passed. The runtime cause is not established by those facts.

Primary component: `electronics.engine.public-api` in [engine-worker-clock.yaml](../components/engine-worker-clock.yaml); this maintenance changes conformance harness only, not that component's implementation. Read root policy/router, AGENT_GUIDE §§2/5/11–13, [canonical clock partition invariance](../contracts/CANONICAL_CLOCK_CONTRACT.md) and the exact existing conformance test/helpers. Use the saved failed-step log before new measurement; expand only to directly needed replay/engine symbols.

## Bounded investigation and permitted repair

First perform one directed measurement of the failed case, distinguishing the actual reference and chunked replay phases and directly relevant overhead. Establish redundant harness work or execution contention before proposing a repair. Do not repeat the full suite hoping for a pass.

Only a demonstrated test-harness runtime defect may be repaired in this slice. Keep the exact existing fixtures, final horizons (Arduino 1,100,000 us), event traces, partition budgets, full serialized state/observation/diagnostics equality and physical assertions. Preserve all canonical runtime state, physical precision and engine execution semantics.

Expected write paths:

- `contexts/electronics/testing/engine-trace-replay.spec.ts`
- `docs/product/electronics/evidence/conformance-runtime-521-20261007.md`

Controller alone changes selection/closeout. No production source or #517 source/test changes; no cleanup, baseline uplift, fixture reduction or adjacent optimization. If the evidence instead requires shared CI configuration, scheduler/model/Arduino or production repair, report the concrete cause and STOP for a separately selected scope.

## Acceptance and forbidden changes

Keep the existing timeout. Do not move calculations outside timeout guards, reduce horizons/fixtures, skip or weaken assertions, change physical tolerances/event budgets or publish yielded/incomplete results as ready. Temporary profiling must be removed from the final candidate; retain measured evidence and limitations in the report.

The implementer performs a directed regression check, selected-card validation, `pnpm gate:electronics-m1` and exact-head `pnpm gate:repository` with `NX_SKIP_NX_CACHE=true`, records actual fresh Nx executions, self-reviews and STOP. Use existing isolated CI for database-dependent gates; no live installation or local second stack. A full browser rerun is not required for this test-only maintenance; #517 still requires its own focused, full browser and general gates after this dependency.

A NEW independent reviewer checks the final exact SHA, actual diff, unchanged coverage/guards/physics and GitHub evidence before APPROVE. If the cause remains unproved or the required evidence fails, report REQUEST_CHANGES/STOP with a precise continuation point; do not claim acceptance.

After acceptance the controller integrates/closes #521 and formally returns to the preserved #517 candidate. CI timing is not school-device T3: [owner decision on #465](https://github.com/spikeal8-maker/asa-lab/issues/465#issuecomment-6046276634) keeps T3 pending real classroom device evidence and does not block unrelated repairs. No owner acceptance, release, deployment or database operation is authorized.
