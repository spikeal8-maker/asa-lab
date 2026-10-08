---
task_id: TASK-ELECTRONICS-CONFORMANCE-WORKER-ALLOCATION-001
kind: maintenance
risk: medium
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - Independently accepted Issue 522 report d2b2b14271f27ddcaa194141d8aadafa0db12eae
acceptance_boundary: slice
review: independent
---

# Reduce measured inter-test CPU contention without weakening conformance

Separate bounded runner maintenance dependency of unresolved #521 and preserved #517 in programme #452. [Issue #523](https://github.com/spikeal8-maker/asa-lab/issues/523); controller must publish selection on main before executor writes. No product repair is selected.

## Evidence and route

The accepted #522 report records the same complete-state Arduino case and ten public engine calls taking 1383.223 ms alone versus 3210.885 ms in the original contexts suite. Its main thread directly waited 6.457 versus 1215.718 ms runnable in the Linux runqueue, alongside one versus three observed Vitest worker entrypoints. This establishes a current scheduling contributor, not the unique cause of the historical 5234 ms failure. No redundant replay, physical defect or GC cause was proved.

Primary component: `electronics.engine.public-api` in `components/engine-worker-clock.yaml`; only test runner allocation is in scope. Read root policy/router, exact #522 report and original artifacts, AGENT_GUIDE evidence/review sections, canonical clock partition invariance, `package.json` Electronics test/gate commands, `vitest.config.ts` and the existing complete-state conformance source. No full inventory.

## One matched control before any permanent change

On a temporary branch, reuse the actual source-proven #522 passive probe and existing Electronics workflow. Correct its known temporary no-unused-expressions calibration violation before publishing. Archive the actual executed source/patch before dispatch. Preserve software/lock/Ubuntu contract, NX_SKIP_NX_CACHE=true and original testTimeout=5000.

Within ONE isolated CI job, run the original full contexts Electronics suite once with its original default workers, then once with explicit `--maxWorkers=1`. Both use identical source, instrumentation and assertions. This is a specific allocation comparison prompted by measured scheduling contention, not a retry for a fortunate PASS. Save raw exits/outcomes, observed worker processes, exact versions/effective CPU/quota, per-phase/call CPU and wall, main-thread runqueue/running time and full suite totals. Record stage-order/JIT/host/probe limitations; do not infer historical cause or future guaranteed runtime from one pair.

If the single-worker control demonstrates lower runqueue contribution with the same calls, complete-state equality, physical assertions and full 633-case/42-file coverage passing under the existing guard, a permanent bounded change may set `--maxWorkers=1` ONLY in `package.json`'s existing `test:electronics` script. This makes the local, CI and owner gate invoke the same allocation. Keep the shared Vitest config and all other scripts unchanged. If those criteria fail or no relevant contention is observed, restore the probe, report uncertainty and STOP without a permanent configuration change; no second hopeful timing experiment.

## Scope and restoration

Temporary paths: existing conformance test and `.github/workflows/electronics-r4-m1-focused.yml` only. Final expected paths: `package.json` (only that script if justified), one dated evidence report `docs/product/electronics/evidence/conformance-worker-allocation-20261008.md`. Restore both temporary files byte-exact to the accepted baseline before final candidate. Controller alone selects/closes tasks.

Check shared-path unfinished work before editing package.json; preserve other bots. No test source/assertion/fixture/horizon/budget/timeout/permanent instrumentation change, no dependency/lock/config or general workflow edit, no production/Arduino/solver/worker-controller change. Do not relocate calculations outside timeout, skip checks or publish yielded results as ready. No school-device substitution, browser product repair, Docker/working installation/database/network/deployment action.

## Final acceptance and STOP

Record exact comparison SHA/run/job/artifact digests and raw/source relationships, the observed allocation effect and uncertainty. Show all original fixtures, final 1100000 us horizon, full semantic JSON and physics unchanged. One matched diagnostic pair does not constitute focused/general PASS.

For a justified permanent script candidate run the unchanged `pnpm gate:electronics-m1` and exact-head `pnpm gate:repository` in existing isolated CI, with NX_SKIP_NX_CACHE=true and actual fresh Nx execution counts. No standalone browser rerun is required for runner-only maintenance; #517 retains its own complete browser/focused/general gates after this dependency. Classify unrelated baseline failures without repairing other modules.

Validate the selected card, governance/control-plane and formatting/diff; self-review and publish one exact candidate. NEW independent reviewer verifies actual GitHub HEAD/diff, original artifacts, unchanged guards/coverage/physics and required exact-head conclusions, then STOP. This task alone cannot close #517/#516/#505 or claim owner acceptance/release. #521's runtime dependency may be resolved only after accepted maintenance and its required evidence; the historical cause remains qualified. T3 stays pending real school-device evidence. No full hygiene checkpoint is claimed by runner maintenance.
