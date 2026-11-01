---
task_id: TASK-ELECTRONICS-SELECTION-HALO-902
kind: repair
risk: medium
semantic_change: 'no'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Constant native selection halo in screen space

Issue902 is a separate UI dependency of the owner-requested full836 browser
qualification. It follows the525 writer and consumes independently reviewed901
test compatibility without changing its geometry or pixel expectations.

Actual stopped/zoom E11 failures remain after the oracle mismatch is removed.
The resistor/button/switch selected body/pin widths ignore selectionOffset:
hardcoded model strokes grow with zoom, and blue pin widths equal ordinary pin
widths, adding zero outward radius. An archived zoom CTM gives9.3704px body
radius against1.408px expected. This is a product defect, not a test waiver.

## Bounded source and behavior

Change only ProductionComponentVisual.tsx selection overlays and meaningful
presentation tests/native SVG proof. Consume canonical selectionOffset through
the existing model-to-world scale. Use selected body stroke twice the model
radius; draw wider blue pin underlays below unchanged ordinary grey pins.
Support actual resistor, pushbutton and switch families measured by E11.

Preserve normal rendering, positions, silhouettes, transforms, mirror/rotation,
wire/terminal/hit geometry, owner material, all electrical behavior and525 text
styles. Do not recolor or replace the original grey pin as a halo substitute.
Preserve all901 native/Save/CAS/reopen checks and original geometry thresholds.

The525 author must stop and deliver a source SHA before902 edits the shared
Visual file. Use a separate clean writer based on that candidate and current
canonical state. No concurrent shared-file authors or whole-file rollback.

## Evidence

Actual production SVG at1440/1024/390/320, zoom and rotation/mirror cases:
constant screen-space radius, unchanged ordinary pins/bounds and correct
underlay order. Negative checks reject zoom-dependent or missing pin halos.
Focused tests, fixed caps/hygiene, fresh independent final source/native review
and full combined strict qualification are required. No core/clock/dependency,
workflow/cap/timeout changes, server, database or foreign WIP operations.
Executor reports exact evidence and STOP; this closes no other836 failure.
