---
task_id: TASK-ELECTRONICS-WIRE-CONTACT-HIT-001
kind: repair
risk: medium
semantic_change: 'yes'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Match wire contact hit regions to the visible painted dots (#688)

## Owner-visible outcome

On desktop, a contact dot activates only when the mouse reaches the drawn contact, not while approaching through an invisible radius-9 circle. On mobile, a finger needs to reach the same rendered dot, not an invisible radius-14 circle. The visible wire-end reconnect dot and the ordinary component/breadboard terminals follow the same rule at any canvas zoom.

## Routing and scope

Owner-selected bounded repair in programme #452, Issue #688. Primary component `electronics.ui.workbench` is routed through `../COMPONENT_MAP.yaml` to `../components/ui-assets-persistence.yaml`. Read `../START_HERE.md`, `../AGENT_GUIDE.md` §§2, 5, 11–13, and the wire/terminal sections of `../README.md`.

The production targets are `apps/web/src/electronics/workbench-geometry.ts`, the precise contact-hit markup in `WorkbenchStage.tsx`, and the precise `terminalTargetAt` branch in `use-electronics-workbench.ts`. Initial narrow circle-radius repair left painted square corners unclickable (independent Codex finding P2). Change component and breadboard hit circles to rounded hit rectangles within the actual 8-unit drawn squares; wire-end hit stays a circle. Update the hooked pointer-capture reconnect resolver to inspect the actual rounded rectangle, preserving nearest-terminal deterministic ranking. Only these specific symbols may change; preserve concurrent Stage/controller work verbatim. The 8-unit ordinary terminal square has an effective 1.2-unit CSS outline (painted edge 4.6) in idle/selected states. The higher-specificity wiring-hover CSS switches its outline to 2 units (painted edge 5). The conservative shared 4.6 hit radius remains WITHIN the painted region in either state; this is deliberate, not a claim the outlines are always identical. Breadboard contact squares have a 2-unit outline and also contain this radius. A wire-end circle has radius 4 and 2-unit outline (edge and hit radius 5). Mouse and touch use the same target, not 9/14. Independent PR #689 review found both cascade details; the tests encode the distinction.

## Write budget

- `apps/web/src/electronics/workbench-geometry.ts`
- `apps/web/src/electronics/WorkbenchStage.tsx` (terminal/breadboard hit-shape markup only)
- `apps/web/src/electronics/use-electronics-workbench.ts` (captured-pointer hit geometry only)
- `apps/web/src/electronics/testing/workbench-geometry.spec.ts`
- `apps/web/src/electronics/testing/workbench-presentation.spec.ts` (obsolete literal only)
- `e2e/electronics-interactions.spec.ts` (obsolete F1 hit radius/shape expectations)
- this task card and selected lane in `docs/execution/current.yaml`

No CSS/asset, unrelated Stage/controller, wire route/path, netlist, project persistence, API/DB/CI workflow or deployment changes. Do not change the wider wire-segment selection stroke; it is a separate hit target, not a contact dot.

## Required evidence and acceptance

1. Deterministic focused regression: painted terminal marker and hit rect have matching bounds and corner shape at all zoom levels; all mouse/touch hit radii remain ≤ painted edges, with no 9/14 invisible capture. Inside painted square corners must accept; outside rounded corners must reject.
2. Valid governance, exact head `pnpm gate:electronics-m1`, code/type checks and independent source review.
3. Real native pointer/browser check on a built editor: approach ordinary terminal and selected-wire endpoint from outside to inside at standard desktop and at 390/320 phone viewports. Hover/pointerdown fires only inside painted dot; a touch outside must not connect, select or drag. A touch inside still starts wiring/reconnect. Confirm breadboard holes, zoom/pan/pinch, Undo/Redo, Save/reopen remain usable.
4. Reconfirm exact GitHub main SHA/CI, check no overlap with foreign uncommitted changes, then integrate via regular fast-forward/PR merge only after accepted evidence. If full unrelated browser suite fails, classify failures accurately; do not fake acceptance or repair another module inside this scope.

`main` merge is NOT a running-site update. No school, Docker, data or network action granted.

## Stop

After verified bounded integration, report SHA, tests, independent review, desktop/mobile demonstration and `NEXT_ALLOWED_TASK: STOP`. Other Electronics work continues under its own canonical selection.
