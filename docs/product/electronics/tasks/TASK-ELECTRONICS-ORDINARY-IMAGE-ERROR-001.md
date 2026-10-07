---
task_id: TASK-ELECTRONICS-ORDINARY-IMAGE-ERROR-001
kind: repair
risk: medium
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Independently classified asset baseline failure of integrated Issue 516 run 37662037546
  - docs/product/electronics/ASA_ELECTRONICS_STABILIZATION_SPEC_V2.md
acceptance_boundary: slice
review: independent
---

# Ordinary image failures reach every mounted consumer

Separate bounded dependency [#517](https://github.com/spikeal8-maker/asa-lab/issues/517) of programme [#452](https://github.com/spikeal8-maker/asa-lab/issues/452). Preserve the implemented observation-cadence candidate #516 and suspended #505 / PR #506. This task does not revise either implementation.

## One user result and evidence boundary

A permanently missing ordinary component image honestly shows its existing accessible failure indication in both the stage and catalog, including early mount delivery. Transient failures retain the accepted quiet recovery behaviour. Student documents and protected image bytes remain intact.

Exact main `4bad8a7f1eb3543097c397f05df7805e9024e342`, full browser run [37662037546](https://github.com/spikeal8-maker/asa-lab/actions/runs/37662037546), passed 114/115 scenarios and the original Arduino Reset. The sole failure is `electronics-interactions.spec.ts:1675`: stage AA-2 failure appears, catalog AA-2 failure is absent within its original 5000 ms assertion. Independent exact-main review classifies it as category C: this scenario has no running simulation and its asset source/test are unchanged from the approved #516 candidate.

The saved trace proves image HTTP 404 responses and divergent mounted states. A lost early `onError` before passive effect setup is a concrete hypothesis, not established causality. The non-image 200 transport response permitted by this fixture is not successful image decoding. Use the saved trace first; establish callback/setup ordering or another concrete cause before changing product code.

## Entry and minimal route

Restore remote Git/main/current.yaml/exact-head CI and other worktrees; run `pnpm agent:preflight --scope electronics --check` and selected-card validation. Primary component: `electronics.ui.workbench`, ordinary-image lifecycle entry in [ui-assets-persistence.yaml](../components/ui-assets-persistence.yaml); catalog is its direct consumer.

Read stabilization specification §4 first milestone, ordinary-image hook and shared recovery source, and the exact failed browser scenario. Expected source is `ProductionComponentVisual.tsx:useOwnerImageHref`; `production-asset-contracts.ts` is a directly necessary dependency only if causal evidence implicates it. This is an existing-gate restoration repair under AGENT_GUIDE §4.1, not cleanup or a hygiene bypass for another capability.

## Bounded investigation and repair

1. Preserve and inspect the saved failed step, original artifact digest, network records and resolved DOM snapshots. Do not rerun the whole suite hoping for success.
2. If saved evidence cannot establish causality, run only the original permanent-image scenario against the built CI editor, with passive per-instance mount/error/setup/recovery/failed-transition diagnostics. A controlled early-event case may isolate ordering, but label induced delivery separately from native trace evidence. Keep original assertions and timeouts.
3. Repair only the proven ordinary-image lifecycle defect and add a meaningful regression that fails before the fix. Preserve mount/unmount cancellation, resource changes and stale responses, shared recovery, bounded retries, permanent-missing termination and later transient recovery.
4. Remove temporary diagnostics/workflow routes from the final candidate. No speculative change to #516 controller, solver, Arduino, physical accuracy, authorization, owner assets, CSS, storage or breadboard behaviour.

Expected final write budget: at most two directly justified production files in the named lifecycle/recovery boundary and two focused test files (`asset-recovery.spec.ts` and/or the failed browser source). A generated coverage source digest may be refreshed only when those actual source inputs change; never weaken its validator. If source ownership changes, update only the implicated component entry. No broad decomposition of the large visual source.

## Acceptance and STOP

- Establish the exact cause with saved evidence plus the smallest directed scenario needed.
- The repaired built product passes the original permanent-image assertion; repeated/late consumers and resource switching retain the existing failure/recovery contract.
- Exact final SHA: focused Electronics gate, full Electronics browser gate and repository gate; report fresh Nx execution with literal `NX_SKIP_NX_CACHE=true`.
- NEW independent reviewer verifies actual exact SHA, diff, GitHub state, causal evidence and required gates. Confirmed findings receive a separate bounded repair/review cycle.
- Integrate the accepted slice and obtain exact-main browser evidence before returning to #516 acceptance. #505 / PR #506 stays unchanged until that dependency is accepted.

No local stack, working installation, live database, network operation or deployment is authorized. The implementer self-reviews, reports exact SHA and STOP. The controller manages integration/dependency closeout; this card grants no owner acceptance or release claim.
