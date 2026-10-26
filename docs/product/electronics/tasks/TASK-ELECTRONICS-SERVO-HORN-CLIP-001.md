---
task_id: TASK-ELECTRONICS-SERVO-HORN-CLIP-001
kind: repair
risk: low
semantic_change: no
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Keep the rotated Servo horn visible

Consolidated point12. Planning only until canonical selection on main.
Existing native screenshots show135degree horn left tip cut by nested SVG;
owner endpoint114.5,489 rotated45degrees about114.5,314 reaches x=-9.24 outside
viewBox0 0 241 621. Outer wrapper is already overflowvisible.

Prove before/after in actual production Stage at0/45/90/135/180 and1440/390.
Smallest proposed repair: existing workbench.css selector for
svg[data-servo-angle-degrees] overflowvisible. Do not modify owner artwork,
viewBox, transform center, component/hit coordinates, model or committed result
subscription. No generic refactor or new component.

Verify rounded endpoints visible, connector/body coordinates unchanged,
Stop/Run/Reset rotation unaffected. Use existing servo-runtime browser fixture
with actual workbench CSS; transform attribute alone cannot prove clipping.
Existing servo visual and committed-projection tests, fresh relevant checks and
actual build/budget222000/2000000; independent finalSHA source/native review.
No broad unrelated fullgate repeat absent risk/repository requirement. Preserve
all protected assets, foreign changes, deferred candidates, server Docker DB.
One bounded candidate then STOP.
