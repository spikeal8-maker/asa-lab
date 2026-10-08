---
task_id: TASK-ELECTRONICS-CONFORMANCE-CI-DIAGNOSIS-001
kind: analysis/inventory
risk: medium
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - Independent evidence-only review of Issue 521 report 38ca0bcb43312c74d9f8a1795abad9190f9eec98
acceptance_boundary: slice
review: independent
---

# Explain complete-state conformance runtime on the matching CI runner

Bounded diagnostic [#522](https://github.com/spikeal8-maker/asa-lab/issues/522) in programme [#452](https://github.com/spikeal8-maker/asa-lab/issues/452), dependency of unresolved #521 and preserved #517 candidate `2d4654f207f41e5d3712b3071af05e6d3830fa31`. #516 and #505/PR #506 remain suspended.

## Evidence first and minimal route

Read the independently reviewed [#521 report](../evidence/conformance-runtime-521-20261007.md), saved original failed-step log for exact focused run `37680023310` / job `112993343304`, and actual named conformance case in `contexts/electronics/testing/engine-trace-replay.spec.ts`. The historical failure was 5234 ms against existing 5000 ms, no numerical mismatch. Local #521 used Vitest 3.2.7 versus locked/CI 4.1.11 and did not archive original executed instrumentation; no harness defect or historical contention was proved.

Primary component: `electronics.engine.public-api` in [engine-worker-clock.yaml](../components/engine-worker-clock.yaml). Read root policy/router, AGENT_GUIDE evidence/review rules, [canonical partition invariance](../contracts/CANONICAL_CLOCK_CONTRACT.md), exact replay helper and directly needed engine symbols. Additional mapped runner files: `vitest.config.ts`, frozen dependency manifest/lock and `.github/workflows/electronics-r4-m1-focused.yml`. No whole Electronics inventory.

## One controlled CI experiment

Use the existing isolated GitHub Electronics workflow on a temporary diagnostic branch, matching Ubuntu 24.04, Node 22, pnpm 9.15.9, frozen lock and actual Vitest 4.1.11. Keep `NX_SKIP_NX_CACHE=true`. Archive the **actual executed** instrumented source/patch and exact GitHub SHA before dispatch; no reconstructed replacement for missing provenance.

Record actual runtime versions, CPU model/effective cores/quota and relevant throttling, configured and observed worker parallelism, memory/GC observations where directly justified. Capture reference/chunked/public-advance wall time and aggregate process CPU with limitations, serialization/equality/assertion overhead, requested/committed horizons, ready/yielded and call counts. Instrument only this existing case/helper, with bounded buffered output; quantify instrumentation limits.

Within one matching job:

1. Run the unchanged named case alone with passive instrumentation.
2. Run **once** the original `pnpm test:electronics` contexts suite with passive instrumentation of that same case. This tests the concrete runner/parallel-work hypothesis; no hopeful full repository or browser rerun.
3. Only if the observations directly support worker contention, one additional controlled comparison of the same suite with a justified lower worker count is allowed. Keep all coverage and record the reason before that run. A pass alone never establishes the historical cause.

All original fixtures, Arduino 1,100,000 us final horizon, partitions/budgets, event traces, full semantic equality and physical assertions stay inside their original default 5000 ms test guard. No beforeAll relocation, timeout extension, smaller fixture/horizon, fewer assertions, physical/event-budget change or yielded-as-ready result. No product implementation or permanent test/runner configuration change is allowed in this diagnostic scope.

Temporary write budget: the existing conformance test and existing Electronics workflow only; restore both before the final report-only candidate. Do not alter the shared general workflow, `vitest.config.ts`, dependencies, other modules or other agents' unfinished work. No live installation, Docker/database/network action, local second stack or school-device benchmark.

## Final report and independent acceptance

Final write path: `docs/product/electronics/evidence/conformance-ci-diagnosis-522-20261008.md`. Report exact executed probe SHA/run/job IDs, original artifact IDs/digests and raw source/log relationships; measured cause or remaining uncertainty; candidate repair scope if justified; versions, CPU/parallelism, phases, horizons/status and limits. Archive failures too. Restore temporary sources and prove final production/test/workflow blobs unchanged from the accepted baseline.

Validate the selected card, report formatting/diff and governance/control-plane. Obtain exact-final-report general CI and a NEW independent reviewer who checks the actual remote SHA, source, artifacts and conclusions. Diagnostic commands are not focused/browser gate PASS; this report does not accept a product repair, close #521 or waive #517's remaining focused/full-browser/general gates.

The executor self-reviews, publishes a coherent report-only candidate and STOP. Confirmed product or shared-runner repair needs a separately selected bounded task and independent review. If no cause is proved, report uncertainty and a precise continuation; do not invent a repair. T3 remains pending real classroom-device evidence per [owner decision #465](https://github.com/spikeal8-maker/asa-lab/issues/465#issuecomment-6046276634), independent of this CI investigation. Owner acceptance, release and deployment remain separate.
