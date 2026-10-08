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

## Selected bounded repair after independent REQUEST_CHANGES

The controller selects a separate repair cycle for the independent findings on exact candidate `d6a78196c6c2423ebad59de4e682141d3d9d837d`. Preserve its product change and the published test-only successor `21f2da7075f3ffaa663e9fec3600c4bd20ae0e53`; neither is accepted. The source has no independent product finding, but the type-invalid React fixture and self-blocking browser navigation prevent acceptance.

This cycle permits correcting only those two test fixtures after the separately selected maintenance responsibility re-review [#518](TASK-ELECTRONICS-VISUAL-SOURCE-REVIEW-001.md). Engineering Hygiene Contract §§6/8 requires that separate selection before a baseline update. The candidate source measures 72,432 bytes against the reviewed 60,089-byte baseline, exceeding the 20% growth boundary. This repair card does not authorize writing the baseline.

Do not shorten or split product code to evade the threshold. Product bytes from the reviewed candidate remain unchanged unless a new defect is established and the controller explicitly selects its repair.

The corrected built-browser regression must demonstrate actual React error delivery before ordinary-image callback setup, reach the original failure assertion with the unfixed production lifecycle, and pass with the repaired lifecycle. A synthetic dispatch during React's event-disabled commit or a navigation timeout is not causal evidence. Native and induced delivery remain separately labelled; the historical failure's native ordering and classroom frequency are unproved. Keep existing timeouts and original permanent-image assertions unchanged.

Expected additional write paths are the two already named test files and one dated causal evidence report. Temporary CI probes and diagnostics remain outside the final diff. Run local type and selected-card checks before expensive browser evidence, then final exact-SHA gates and a NEW independent review. The implementer reports and STOP; no automatic follow-up slice.

## Selected separate late-consumer confirmation after qualified native diagnosis

The controller keeps this task `in_progress` and selects one new bounded diagnostic of the NEW independent review finding on preserved `dd912b2f69b055cffd661721fa5656a5951684b4`. The original native failure remains unproved: one passive diagnostic `f6588bc08b545fc993edad1b56119acbb0afc7f7` / run `37713526540` received independent evidence-only APPROVE, not product acceptance. See [qualified native report](../evidence/ordinary-image-native-diagnostic-517-20261008.md). Do not repeat that scenario or the full suite without a new hypothesis.

Confirm only this separate path in the built editor: consumer A remains mounted while the ordinary image reaches two genuinely spaced missing-HEAD confirmations; mount consumer B for the same asset through a catalog interaction, observe its actual native image error, and require its existing accessible failure badge. A must retain its honest error; the permanent missing asset must not resume recovery requests. Preserve the student document. Use ordinary-image recovery, not the interactive SVG hook, and distinguish normal B image loading from prohibited recovery retries.

The executor first reads existing permanent-404 coverage and source, then chooses one directed scenario. Use real browser events and unchanged production delays, retry budgets and HEAD confirmation rules. Existing timeouts and assertions may not increase or weaken; a new directed scenario may use the existing permanent-confirmation scenario's 300000 ms overall budget because the same real confirmation and 65000 ms cessation observation are required. This is a scenario budget for that protocol, not a relaxation of the failing native 5000 ms assertion. No timer acceleration or synthetic error delivery. Temporary passive diagnostics and the existing isolated workflow's one-scenario selection require a before-execution source archive and controller acknowledgement before ONE dispatch.

No product repair is authorized in this diagnostic cycle. Preserve the candidate source, original branch, #516 and #505/PR #506. Local type/lint/list checks precede the browser dispatch. Cache original evidence once, qualify instrumentation and baseline differences, restore temporary files byte-exact, report and STOP. A NEW independent reviewer checks exact source and raw observations. Only a confirmed path permits the controller to select a separate bounded product repair; native historical causality and classroom frequency remain separate limits.

## Acceptance and STOP

- Establish the exact cause with saved evidence plus the smallest directed scenario needed.
- The repaired built product passes the original permanent-image assertion; repeated/late consumers and resource switching retain the existing failure/recovery contract.
- Exact final SHA: focused Electronics gate, full Electronics browser gate and repository gate; report fresh Nx execution with literal `NX_SKIP_NX_CACHE=true`.
- NEW independent reviewer verifies actual exact SHA, diff, GitHub state, causal evidence and required gates. Confirmed findings receive a separate bounded repair/review cycle.
- Integrate the accepted slice and obtain exact-main browser evidence before returning to #516 acceptance. #505 / PR #506 stays unchanged until that dependency is accepted.

No local stack, working installation, live database, network operation or deployment is authorized. The implementer self-reviews, reports exact SHA and STOP. The controller manages integration/dependency closeout; this card grants no owner acceptance or release claim.
