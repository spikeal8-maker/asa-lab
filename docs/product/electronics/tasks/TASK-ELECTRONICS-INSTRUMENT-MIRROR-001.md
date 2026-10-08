---
task_id: TASK-ELECTRONICS-INSTRUMENT-MIRROR-001
kind: repair
risk: medium
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - Accepted mandatory hygiene checkpoint TASK-ELECTRONICS-GOVERNANCE-006
acceptance_boundary: slice
review: independent
---

# Existing instrument readouts remain readable under mirror

Program: [#452](https://github.com/spikeal8-maker/asa-lab/issues/452). Bounded repair: [#525](https://github.com/spikeal8-maker/asa-lab/issues/525), one existing requirement of milestone [#466](https://github.com/spikeal8-maker/asa-lab/issues/466). Required hygiene checkpoint [#524](https://github.com/spikeal8-maker/asa-lab/issues/524) is technically accepted on reviewed candidate24ddd, integrated7fea. The canonical Electronics lane selects this concrete card before implementation.

## One user result

A pupil mirrors an existing instrument body; existing runtime digital values retain their sign, value and readable glyph orientation inside the transformed display. Body, terminals, hit areas and actual wire endpoints remain correct. Existing ordinary-rotation behavior remains as currently contracted; horizontalness at ordinary rotation awaits the owner's separate section7 decision.

## Entry and directed diagnosis

Primary mapped component: `electronics.ui.workbench` in `../components/ui-assets-persistence.yaml`. This is a correction to existing presentation, not a new physical or persistence capability. Apply the L1 behavior and affected-surface visual review from `docs/agent/review-protocol.md`; no global UI redesign.

Fresh actual main/current/CI/foreign worktree snapshot, normal preflight and selected-card validation after formal main selection. Read specification sixth milestone/section7, mapped electronics.ui.workbench route and only the existing stage/model/visual runtime reading handlers plus mapped presentation/controls tests.

In one built production-editor scenario, prove the actual affected mirrored runtime readout and its rendering cause before changing product code. Static source hypothesis is not a browser proof. If an instrument already obeys the requirement, retain it and record actual evidence rather than speculative repair. Use existing supported circuits and real committed result values; no generated electrical result or guessed instrument semantics.

## Bounded repair

Expected write budget: `apps/web/src/electronics/ProductionComponentVisual.tsx`; `apps/web/src/electronics/production-asset-contracts.ts` only if the built-browser cause requires adjusting existing runtime readout markup; at most two focused regression files selected from the mapped presentation/geometry tests and the existing Electronics browser journey. Treat stage/model transforms as preserved premises, not speculative edit targets. Add a third test only after naming the separate necessary invariant to the controller.

Correct only proved mirror-related readability of existing runtime values/labels in the instrument rendering path. Preserve existing body rotation/mirror placement, terminal/hit coordinates, display window location, value/sign/mode and interactive controls. Include0/90/180/270 with none/X/Y/XY mirror checks for affected supported instruments without changing ordinary-rotation-horizontalness policy. No all-scene/global transform workaround.

No new or modified protected owner artwork, newly drawn/runtime replacement artwork, solver/Arduino/canonical time/physical accuracy, persistence/schema/IDs, parameters, authorization, dependency/workflow, gesture/selection-rim/wire-layer/decomposition/asset cleanup or deployment/DB/network changes. Flexible/multiple board mechanics and T3 are separate; do not repeat accepted startup/cadence/resource measurements. Baseline changes require a separately selected responsibility review if a real threshold is crossed.

## Acceptance

- Before/after built-browser evidence identifies one actual product defect and its exact rendering path. Readout glyph orientation, signed actual values, mirrored window location and controls are verified independently; body/terminals/hit areas/wire endpoints/IDs/document remain correct.
- Review affected desktop/compact/mobile surfaces at 1440/1024/390/320; retain browser evidence for 1440 and390 and check applicable long-reading, inactive/active/error/disabled states. Existing instrument rotation and scene bounds do not authorize a portal layout change or unrelated CSS cleanup.
- Focused regression checks actual rendering/transform invariants with explicit finite matrix assertions; no undefined equality, altered timeout, weaker assertion or lowered physics precision.
- Final exact SHA has required mapped tests, gate:electronics-m1, gate:electronics-m1:browser, gate:repository, diff--check, frozen dependencies/literal cache bypass and actual fresh counts. Preserve passing raw evidence when the registered recipe captures it; qualify absent payload rather than reconstruct it or rerun merely to obtain it.
- Root checks actual source/diff/evidence. NEW independent reviewer checks actual exact final SHA and GitHub conclusions, returns APPROVE or REQUEST_CHANGES/STOP. Repair confirmed findings only in a separate bounded cycle.
- Only this bounded466 subresult is accepted; full466,465T3, classroom/owner acceptance and programme completion remain separate. No installation or release claim.

## Stop

Executor reports one result andSTOP; reviewer reports oneverdict andSTOP. Controller integrates/closes an accepted slice, restores fresh canonical state and continues only the next permitted dependency. This card grants no permission to start another concern after executor STOP.
