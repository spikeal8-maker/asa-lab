---
task_id: TASK-ELECTRONICS-WIRE-MENU-LAYER-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Owner programme452 and required affected-UI acceptance of preserved526
  - Independent exact0dd31 R5 finding from original production browser37872270511
acceptance_boundary: slice
review: independent
---

# Wire colour menu remains usable beside the open Code drawer

Programme [452](https://github.com/spikeal8-maker/asa-lab/issues/452); separate dependency [530](https://github.com/spikeal8-maker/asa-lab/issues/530) of preserved open526. This card defines one UI repair; selection lives only in current.yaml.

## Pupil result / proved boundary

Open Code at1440, narrow the window to1024 and open the native wire-colour menu. The Purple swatch must remain fully visible and selectable with the ordinary pointer; its checked colour updates. The drawer can still resize outside the menu. No physics, sketch or persistence change is needed for that result.

Primary mapped component `electronics.ui.workbench` in `../components/ui-assets-persistence.yaml`; exact dependent consumer `ArduinoCodePanel`. Read only this card, the original linked independent report, UI acceptance contract and selected Header/CSS/drawer/test sources. No full inventory or restyling.

Actual BEFORE is preserved exact `0dd31b4d97cba4cbda935c66968e180fdc630a04`, tree759fc80b7a0e423f67a247d3ba663abe363cc888, ordinary37872270511/browser113633262620. General37872258062 all4SUCCESS; ordinary focused/benchmarkSUCCESS, browser126PASS/1FAIL, review-imagesSKIPPED. The120000ms failure waits on a normal trial click at Purple because the drawer resize handle intercepts pointer events. Only normal-run1440/1024 observations were captured; denial/full56 remain unaccepted.

Original trace SHA2563bc304cffefc50ff72bd9db4ad9339ea7a68fc9475371a20f45351a16ba3d200/10826885bytes/157membersCRC PASS; browser ZIP8c5786856d6fefa963ef2fb1265b7e4619a4a7b3a3b71d3ce9ccaf0af229e4a2/30751450bytes/147membersCRC PASS. Cache outside repository: C:/Users/spike/.codex/temp/electronics-e01/0dd31b4d-ci/run-37872270511. No redownload or BEFORE repetition without a concrete new reason.

Independent [R5 review](../evidence/save-526-r5-independent-review-0dd31b4d.md) is REQUEST_CHANGES. Code drawer left420/width604 and scene/toolbar bottom144 are recorded at1024. The successful1440 trial point is430,y146; the1024 swatch centre is inferred from source/screenshot, not a recorded failed-click dispatch. Actual Purple is visibly obstructed at1024; the action succeeds at1440 because the drawer is farther right. Actual Purple is hidden by Code. Toolbar creates stacking context28, drawer sibling descendant of unstacked main creates45; menu child80 cannot escape28. The handle120 lives inside drawer45. Relevant menu/drawer rules and consumer are unchanged on main. Baseline attribution is provisionalC from source comparison; a main browser was not executed. Do not describe the source counterfactual as a measured baseline, and do not merely escalate the child z-index.

## Implementation / exact budget

After canonical main publishes this selection/card/review, start from that main in a clean owned branch. Preserve every prior ref and foreign work. Do not merge unaccepted526 product into this separate baseline repair.

- Production: only `apps/web/src/electronics/workbench.css`, minimal causal stacking adjustment for the open native wire menu and its Code consumer. Default one production path. No global layer rewrite, general layout cleanup, unrelated menus/controls or Header/drawer JS change. If another production boundary is actually necessary, report evidence to controller before editing it.
- Meaningful regression: one new case in existing `e2e/electronics-simulation.spec.ts`, using the existing real API/login/project and actually built editor. Prove real Code1440→1024/menu/Purple click/checked colour, menu and pane/handle bounds and actual hit target. Capture raw geometry/presentation before assertions. Keep actual pointer checks; no force, synthetic delivery, trial removal or timeout increase. Check mandatory desktop1440/1024 and mobile390/320 for applicable toolbar/Code consumers; native menu may retain its intentional mobile presentation. Verify drawer resizing outside an open menu and after close, with actual control outcome. Do not mutate simulation/Arduino runtime or wait away a failed pointer action. Reuse the existing harness; no parallel fixture or workflow.
- Only the canonical browser source digest in `docs/product/electronics/generated/component-coverage.json` follows this changed source. Every other parsed field must deep-equal main and generated output; no capability claim.

Existing focused tests may run, but implementation-mirroring source-string tests are not a substitute for the real click regression. Preserve every existing browser case, precision, deadlines, protected owner assets and the accepted529 code. The suspended526 and525 documents/results remain intact.

## Preserved first candidate — separate dependencies

Exact87099554c8227f841718fc052cc24f99f2883d41/tree84d1bda673f13d30734748032e0567a2c5239722 remains unchanged. [NEW independent review](../evidence/wire-menu-530-independent-review-87099554.md) REQUEST_CHANGES; native menu6.9s/16phasesPASS, General37876587447SUCCESS/all4, ordinary37876603308browser120PASS1FAIL/review-imagesSKIPPED. Actual981primaryRun caption/font control clipping blocks fullvisualreadiness. Neither the passing action nor303freshNx executions accept the whole slice.

[Separate classifier](../evidence/wire-menu-530-breadboard-startup-classification.md) provesD: pending external deferred SDK blocks unchanged global-load navigation30.371s, while board/editor appears1.568s after navigation; count assertion14.602ms occurs during teardown. No wrong-count/physics defect or provider outage claimed. Controller separately selects [531 application-readiness repair](TASK-ELECTRONICS-BROWSER-READINESS-001.md), then a separate bounded compact-UI dependency. Do not add those repairs to this preserved ref, retry the full suite without a new cause, or pretend530/526 accepted. Original raw receipts/PNGs/trace remain cached; no repeat BEFORE. Fresh final convergence/ordinary gates/NEW review remain required. Original review SHA55d44ea5b856380a9f309cdf05dd4d26343101bb6e73d98021969e4b821d34bf and classifier9328cf15ee2a95957703b6fc838d080ec1e21cc599129d7015c457762f5ae9fe precede ordinary Markdown Git LF normalization.

## Required acceptance / return

Root checks actual diff/source/raw evidence. Require ordinary exact-SHA `gate:electronics-m1`, `gate:electronics-m1:browser`, `gate:repository`, frozen dependencies, literal NX_SKIP_NX_CACHE=true, actual fresh counts and a NEW independent reviewer of one final SHA/GitHub state/original browser evidence. Old green runs and author report do not prove this changed candidate. Any confirmed findings get a separate bounded repair/new reviewer; no blind rerun on unchanged code.

This task does not accept526, solve the separate asset observation, close an unrelated E-ID or assert school/class/release acceptance. After technical530 acceptance, controller freshly selects526 and safely converges its preserved0dd31 candidate with accepted530/canonical state; its final combined version requires original full56/denial evidence, ordinary exact gates and a NEW independent review. No reimplementation of prior E01/529 repairs.

Author returns exact unpublished SHA/tree/clean state/self-review and STOP. Reviewer returns one verdict and STOP. Controller continues452. School K0/version/backups and actual-pupil T3 remain pending; no deployment, restart, local stack, DB/backup/network operation or protected-data mutation.

## Final convergence after accepted531/532

Accepted dependencies531/532 are integrated. Preserve source87099554c8227f841718fc052cc24f99f2883d41; no repeat BEFORE and no new menu implementation. The owner explicitly approved the two forecast conflicts in simulation scenario append and generated browser digest. A NEW author ordinarily merges the selected canonical main, manually retains ALL127 current cases including accepted533 and532, appends the unchanged saved530 native case, and regenerates only the canonical digest. CSS must retain both accepted compact repair and the saved open-menu layer repair. Any additional actual conflict is reported before resolution. No blanket ours/theirs, published-history rewrite, forced clicks, timeouts or weaker assertions.

The final merged SHA needs ordinary exact General and Electronics all8 jobs,128 browser cases, the original16-phase native-menu/resize raw evidence and PNGs, unchanged canonical dependencies/workflows, root actual-diff verification, and a NEW independent reviewer. Previous candidate gates/review are history. After acceptance immediately return to preserved526; no unrelated repair is part of530.

## Bounded native-popup acceptance protocol repair

Final candidate31dfcbbdbb88219f69532cee2abc8479c2236772 is preserved. [NEW independent review](../evidence/wire-menu-530-final-independent-review-31dfcbbd.md) is REQUEST_CHANGES: General37959804343 all4SUCCESS, ordinary37959807372 focused/benchmarkSUCCESS, browser127PASS1FAIL, review-imagesSKIPPED. Native530 all16phases pass; full532 stopped at90/95 observations and4/5 full intent receipts. At981-native-open, the open native Purple menu correctly owns Code mode summary corner433,154; the centre and other three corners remain owned by the summary. No inaccessible product action is proved.

A NEW bounded author changes only the existing simulation test protocol and canonical browser digest. Preserve production CSS byte-for-byte, all128 cases, all95 original phases, geometry/clipping/text/runtime checks, existing deadlines, and strict ownership for closed or unoccluded controls. In the actually open native-popup phase only, permit an occluded point solely when its actual hit ancestry belongs to the specific open native menu and its point lies within the actual menu rectangle. Arbitrary hits remain failures; positively verify popup/Purple ownership. After an ordinary close, add a full strict five-point Code-controls receipt, then execute the existing ordinary font/input/Run/resize actions. Do not blanket skip hit checks, force clicks, increase timeouts or change product code.

The changed final SHA requires a directed browser check of this proven cause, final ordinary exact-head gates/full128 browser cases/native16/full UI intent evidence and a NEW independent reviewer. Old approval or passing partial receipts do not accept this version. After530 technical acceptance immediately resume the preserved526 candidate and full56/denial save acceptance. Parallel537/538 continue only in their separately selected paths.
