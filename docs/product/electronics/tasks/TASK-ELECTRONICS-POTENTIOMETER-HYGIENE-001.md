---
task_id: TASK-ELECTRONICS-POTENTIOMETER-HYGIENE-001
kind: maintenance
risk: medium
semantic_change: no
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Retire hidden legacy potentiometer vectors

Owner explicitly requests separate cleanup before toolbar15, retaining the
222000byte editor budget. This is a bounded prerequisite, not tooltip integration.
Component: electronics.ui.workbench. Follow ENGINEERING_HYGIENE_CONTRACT section4.

Only production write: apps/web/src/electronics/ProductionComponentVisual.tsx.
Remove TINKERCAD_POTENTIOMETER_KNOB and TINKERCAD_POTENTIOMETER_POINTER and their
single hidden potentiometer-legacy-vector-contract group only after complete
runtime/export/persistence/contract/protection/replacement deletion proof.
Classify this concern as dead-orphan-candidate until proof is complete. Preserve
OwnerPotentiometerVisual, ownerSvg, potentiometerRuntimeMarkup, every visible
control, transforms, hit targets, electrical values and all other component code.
No protected assets, dependencies, lazy chunk relocation, budgets, workflows,
server, live DB or foreign source change. Unknown deletion dependency means STOP.

Allowed supporting writes: one dedicated behavioral test/native fixture if needed,
components/ui-assets-persistence.yaml test routing, dated evidence file and the
bounded hygiene-baseline concern/rationale. Do not reset unrelated baseline sizes.
Controller alone updates current.yaml and publishes accepted integration.

Preflight: fresh main/exact CI snapshot and actual path overlap check. Controller
observed63 worktrees with no dirty target on2026-10-25; repeat before edits.
Other visual lanes own different concerns in this file; preserve their exact
source. The751 tooltip prototype remains untouched and unpublished.

Acceptance: source/reference searches establish all deletion conditions; native
real production consumer BEFORE/AFTER proves unchanged visible potentiometer at
positions0/0.5/1, rotations/mirroring, desktop/mobile, pointer/keyboard interaction
and saved-document reopen. Preserve owner asset bytes and complete document.
Existing production-state-contracts and workbench-presentation regressions pass.
Fresh production build and bundle:check measure actual raw savings and all caps;
no proxy-only claim. Run lint/types, routing and gate:electronics-m1 plus applicable
General CI. Classify unrelated/cancelled CI precisely. No installed-save claim
from a fixture. Independently review exact final SHA/diff/proof before integration.

Executor returns one bounded candidate with deletion proof, actual size delta,
self-review and tests then STOP. No next feature or task automatically starts.
