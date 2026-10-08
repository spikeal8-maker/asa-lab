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

## Selected bounded diagnostic fixture correction after precondition failure

The first late-consumer confirmation `e045a0ba17cda5603e482a96b99adf58d7facd51` / run `37717165930` received NEW independent REQUEST_CHANGES for its fixture: `basic` includes `battery-holder-aa` in `TINKERCAD_BASIC_FAMILY_ORDER`, so no removal occurred. The run reached HEAD=0, no new B and no permanent guard; it neither confirms nor disproves the product finding. Its three temporary paths were restored at `c1c845077c1b5b3c5adcd4f4e49733b29db7c546`, whose whole tree equals preserved `dd912`. Do not repeat the unchanged failing scenario.

Select one separate bounded fixture correction: use a real category/filter that demonstrably excludes this actual family, prove B's removal while A remains connected, and restore B through its matching category. First perform a cheap local precondition check with the actual production `familyForVariant` / `familyMatchesCategory` mapping: the chosen hiding category excludes AA-2 and `power` includes it. Preserve all production semantics, temporary passive hook diagnostics, existing scenario bodies, original assertions and protocol budgets. No product repair, timeout increase, timer acceleration or synthetic error is authorized. A new exact source archive and controller acknowledgement precede ONE corrected directed case; no native/full-suite rerun. Independently verify the captured guard path, request cessation and unchanged-document witnesses, explicitly qualifying a saturated buffer or missing full document payloads. Restore all temporary paths byte-exact to `dd912`, report and STOP; a NEW reviewer checks the actual exact source and raw result.

## Selected separate HEAD protocol correction after independent REQUEST_CHANGES

The corrected filter probe `2fb8311220097623bed5ee015e32d4303a33df57` / run `37719347863` received NEW independent REQUEST_CHANGES for diagnostic protocol only. Real category/card0/A-connected assertions passed, and two HEAD404 headers are 32.235 seconds apart. The next `Response.finished()` await stalled until the unchanged 300000ms deadline; HAR records `net::ERR_ABORTED`, without proof of its underlying cause. Finally capture ran only after page closure, so no raw buffer, new B, actual permanent guard, final document comparison or 65000ms cessation evidence exists. See [qualified report](../evidence/ordinary-image-late-fixture-diagnostic-517-20261008.md). Restoration `30443e25629b2c081347d57f53f12db369052200` has a whole tree equal to preserved `dd912`; the product finding and historical native cause remain UNKNOWN.

Select one separate diagnostic protocol correction. Verify received HEAD status/headers and genuine spacing without waiting for a HEAD body-finished signal. Before B mount obtain a positive passive read-only witness of the retained ordinary consumer A's actual `recovery.permanent()` state within an existing bounded assertion; do not set that state or treat an arbitrary pause as proof. Preserve the actual native error path, all recovery delays/confirmation rules and all 300000/210000/5000/65000ms protocol budgets and old scenario bodies. Preserve the already demonstrated category mapping. Save buffered partial observations before a potentially failing wait and ensure any capture failure is explicitly qualified, not replaced by reconstructed events. No production semantics, timeout increase, timer acceleration, synthetic delivery or product repair is authorized.

A NEW executor performs cheap local source/type/lint/list checks, supplies a new exact before-execution archive, and awaits controller acknowledgement before ONE directed case. No native/full-suite rerun. Cache the original artifact once, independently inspect raw guard/B/cessation/document observations including saturation and missing-payload limits, restore all temporary paths byte-exact to `dd912`, report and STOP. A NEW independent reviewer checks the actual final SHA and evidence. Only a proved product path permits a separately selected product repair; preserve #516 and #505/PR506.

## Selected separate product repair of confirmed late/permanent publication

NEW independent evidence-only APPROVE on `bf6ef9e0194c6a76bcec2038c1e39c329455f2e1` / run `37722090739` confirms this bounded product defect: exact retained A5 is active/permanent; genuinely new B38 receives trusted native and React image errors with handlers installed, then the actual permanent guard returns while `failed=false`. Its badge stays absent after the original 5000ms assertion and a completed 65-second observation. All seven full document payloads match, A retains its honest error, and the 57/256 buffer is not saturated. Ordinary tagged retries remain12 and HEAD2; an extra plain GET has unknown attribution, so global zero-network is not claimed. See [independently verified late proof](../evidence/ordinary-image-late-consumer-proof-517-20261008.md). Normal restoration `1b10954b9f6e505733c2cdf53c96f6d6e6b9db26` has the entire `dd912` tree. Historical native causality and school-device prevalence remain unproved.

Select a separate bounded product repair of ordinary `useOwnerImageHref` failure publication. A late mounted consumer receiving an actual image error must publish its existing accessible failure indication even when shared recovery is already permanent; that terminal state must still prevent new recovery attempts. Preserve prior early-event replay, cancellation, resource switching, stale response guards, successful load semantics, shared budgets and retry/HEAD termination. This repair does not authorize changes to the shared recovery algorithm, masks, SVG loading, the unexplained background GET, physics, solver, Arduino, CSS, storage, authorization, protected artwork or the candidates #516/#505.

Expected additional product scope: the single named visual source, meaningful tests in `testing/asset-recovery.spec.ts` and `e2e/electronics-interactions.spec.ts`, and one qualified causal report. An actual-source generated digest may refresh only when its validator requires it; no config, dependency or validator weakening. Keep every old test body/assertion/deadline. A production regression must fail with the preserved unfixed lifecycle and pass after repair; use the already archived genuine late browser failure as before evidence rather than dispatching it again. Local unit harness fake timers may exercise the real lifecycle and real shared recovery deterministically; no production timing or physical accuracy changes. The final built-browser regression uses real confirmation delays and the original 300000/210000/5000/65000ms budgets. Final product source and workflow contain none of the temporary diagnostic registry, recorder or grep-only routing.

The NEW implementer performs one bounded repair and self-review, reports the exact candidate and STOP. Preserve the prior `dd912` early-event repair while converging once with current canonical main without overwriting other work; do not chase unrelated commits. Required exact final SHA evidence is registered focused Electronics, full Electronics browser and general repository gates with literal `NX_SKIP_NX_CACHE=true` and fresh execution counts. Any remaining native browser failure is classified from actual saved evidence, not asserted fixed by this unrelated late path. A NEW independent product reviewer checks actual exact source, raw before/after proof and GitHub gates; diagnostic APPROVE is not product acceptance. Confirmed findings require a separate bounded repair/review cycle before integration and dependency closeout.

## Acceptance and STOP

- Establish the exact cause with saved evidence plus the smallest directed scenario needed.
- The repaired built product passes the original permanent-image assertion; repeated/late consumers and resource switching retain the existing failure/recovery contract.
- Exact final SHA: focused Electronics gate, full Electronics browser gate and repository gate; report fresh Nx execution with literal `NX_SKIP_NX_CACHE=true`.
- NEW independent reviewer verifies actual exact SHA, diff, GitHub state, causal evidence and required gates. Confirmed findings receive a separate bounded repair/review cycle.
- Integrate the accepted slice and obtain exact-main browser evidence before returning to #516 acceptance. #505 / PR #506 stays unchanged until that dependency is accepted.

No local stack, working installation, live database, network operation or deployment is authorized. The implementer self-reviews, reports exact SHA and STOP. The controller manages integration/dependency closeout; this card grants no owner acceptance or release claim.
