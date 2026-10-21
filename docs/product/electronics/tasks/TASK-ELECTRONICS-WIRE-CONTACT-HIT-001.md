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

The exact production target is `apps/web/src/electronics/workbench-geometry.ts`. Existing `WorkbenchStage.tsx` already applies separate constants to ordinary terminal/breadboard circles and selected-wire endpoint circles, using coarse-input detection for touch; it remains READ ONLY because other active authors touch this surface. `use-electronics-workbench.ts` uses actual rendered terminal element rectangles for reconnect target detection and remains READ ONLY. The 8-unit square contact and radius-4 wire endpoint have 2-unit painted outlines; a collision radius of 5 matches their painted cardinal edge. Mouse and touch must be equal, not 9/14.

## Write budget

- `apps/web/src/electronics/workbench-geometry.ts`
- `apps/web/src/electronics/testing/workbench-geometry.spec.ts`
- `apps/web/src/electronics/testing/workbench-presentation.spec.ts` (replace the obsolete literal radius assertion only)
- this task card and the selected lane in `docs/execution/current.yaml`

No Stage/CSS/controller/asset, wire route/path, netlist, project persistence, API/DB/CI workflow or deployment changes. Do not change the wider wire-segment selection stroke; it is a separate hit target, not a contact dot.

## Required evidence and acceptance

1. Deterministic focused regression: visible painted marker edge and all four mouse/touch hit radii agree, without 9/14 invisible capture; points just outside the edge do not count.
2. Valid governance, exact head `pnpm gate:electronics-m1`, code/type checks and independent source review.
3. Real native pointer/browser check on a built editor: approach ordinary terminal and selected-wire endpoint from outside to inside at standard desktop and at 390/320 phone viewports. Hover/pointerdown fires only inside painted dot; a touch outside must not connect, select or drag. A touch inside still starts wiring/reconnect. Confirm breadboard holes, zoom/pan/pinch, Undo/Redo, Save/reopen remain usable.
4. Reconfirm exact GitHub main SHA/CI, check no overlap with foreign uncommitted changes, then integrate via regular fast-forward/PR merge only after accepted evidence. If full unrelated browser suite fails, classify failures accurately; do not fake acceptance or repair another module inside this scope.

`main` merge is NOT a running-site update. No school, Docker, data or network action granted.

## Stop

After verified bounded integration, report SHA, tests, independent review, desktop/mobile demonstration and `NEXT_ALLOWED_TASK: STOP`. Other Electronics work continues under its own canonical selection.
