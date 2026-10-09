---
task_id: TASK-ELECTRONICS-FIELD-HIT-BOUNDARY-001
kind: repair
risk: medium
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Technical acceptance of526 and mandatory542
  - Owner programme452 original E03 and parallel bounded repairs
acceptance_boundary: slice
review: independent
---

# Native grabbing across the visible field boundary

Bounded [544](https://github.com/spikeal8-maker/asa-lab/issues/544), existing programme452 / E03. Selection only canonical current.yaml on main. Primary electronics.ui.workbench in components/ui-assets-persistence.yaml, exact Stage pointer routing and owner E03/E15/E16 distinctions. No new programme/editor/audit, artwork, world-coordinate migration, solver or deployment.

## Prove the cause before product edits

Retained source shows Stage handleStagePointerDown tests only target.classList.contains(workbench-grid-hit) before componentAtClientPoint; fixed grid x=-4000/y=-3000/w9000/h7000 does not cover every visible panned view. Stage viewBox can update imperatively during pan, so binding a React-only rectangle to an old viewBox is not an established remedy. Source evidence is a hypothesis until one real native-pointer built-editor BEFORE verifies target/root, actual alpha hit, component/viewport positions and event chain. Other clipping/coordinate/terminal causes must not be relabelled this mechanism without proof.

Minimal intended repair only permits the existing alpha-based body fallback on the actual SVG root as well as its existing grid target, if BEFORE proves it. Preserve normal target priority and fail-closed asset/mask behavior. Never use an unconditional bounding rectangle, expand magic coordinates, move old components or bypass terminal/wire controls.

## Exact write budget and parallel work

Only product apps/web/src/electronics/WorkbenchStage.tsx, pointer-routing concern. Supporting e2e/electronics-interactions.spec.ts contains native regression and a real authenticated server save/reopen case; reuse existing real auth/evidence helpers where available. Existing registered test paths need no component-map/package/workflow edit. Existing presentation tests may run read-only; source-string checks alone do not prove the repair. If a meaningful mounted production-stage test is needed, propose its exact file/registration to controller before editing shared routes. No other product path, common simulation spec, hook/controller, clock, shader/CSS, assets, dependencies, workflows, canonical state/card/Issue writes by author.

PSU543 writer owns hook/controller/common simulation spec and may update component map; field author does not write them. Arduino540 owns scheduler; time541 R1 owns dedicated time browser spec. Legacy wire538 author stopped/CLEAN; its interactions delta is preserved separately and must be retained at later convergence, not silently imported as accepted baseline. All actual dirty paths still require fresh checks; advisory metadata alone is not a lock or permission.

## Real pupil scenario and negative proof

Native pointer from an ordinary known opaque body point, not a test search for a fortunate alpha pixel or forced DOM event. Use the same supported complete circuit with meaningful sketch if present, stored positions beyond left/right/top/bottom fixed boundaries and corners including negative/large coordinates. Pan/zoom and open/closed panels at1440/1024/390/320 keep those components visible and reachable. Mouse and applicable native touch use existing gestures; no artificial event target or DOM mutation to fake a pass.

Record actual target/event path, mask readiness, body point, original/final component coordinates and viewport. AFTER drag changes only intended document coordinates with expected motion, not accidental pan. Shift selection, right-button/empty-space pan, transparent margins, wire/terminal/pending-wire priority remain unchanged; do not combine separate E15 terminal-zone redesign. Fit returns all components and preserves positions; pan alone preserves whole document coordinates.

Required real authenticated built editor actions use actual API/server (the older mocked openEditor fixture is insufficient for persistence acceptance): full schema/sketch baseline -> native drag -> actual Save/PUT/revision -> fresh cookies-only browser context without local drafts -> full server document equality -> native grab again. Retain complete raw and running/phase PNG explicitly on disk in uploaded artifacts; attach-body-only successful data is not retained with list reporter/retain-on-failure. Before/after source and unchanged timeout/scenario provenance must be exact. Existing accepted532/530/526/533 assertions and all foreign candidates remain intact.

## Gates, delivery and stop

NEW author fresh electronics-field preflight, exact card validator, root/router/contracts; frozen literal NX_SKIP_NX_CACHE=true focused gate and relevant lint/discovery/self-review. Author may construct an unpublished harness-first SHA and ask controller for the single causal BEFORE in isolated GitHub CI before touching product; do not start a local alternate stack. After proven cause, minimal product change and one unpublished final SHA/tree/report then STOP. Root independently checks actual diff/raw/GitHub, publishes exact source, completes necessary AFTER/ordinary General gates and appoints NEW independent reviewer. Do not repeat old passing measurements without new reason or run a whole suite hopefully. A new required product path or real foreign dirty overlap stops the author before mutation.

School K0 version/full backups NOT_VERIFIED, real deviceT3/class/owner/deployment pending. No school installation, liveDB/network, backup/restore or protected owner artwork action. Individual STOP does not stop owner programme452; controller continues only through canonical selection.
