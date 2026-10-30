---
task_id: TASK-ELECTRONICS-ARDUINO-RESIZE-DEDUP-001
kind: refactor
risk: high
semantic_change: no
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Deduplicate desktop Arduino resize handles

Issue [876](https://github.com/spikeal8-maker/asa-lab/issues/876).
The owner's new explicit refactoring request supersedes the previous cleanup
deferral only for this selected bounded slice. Server and foreign changes remain
forbidden. The mirror BEFORE run continues independently on its frozen SHA.

DrawerResizeHandle and PaletteResizeHandle in ArduinoCodePanel.tsx repeat the
horizontal pointer lifecycle, separator markup and keyboard handling. Replace
them with one in-file component with two real consumers. Drawer keeps direction
-1 and normal/Shift steps16/48; palette keeps direction+1 and steps12/40.

Preserve primary-button filtering, pointer identity, start-width anchoring,
capture/release, cancellation and lost-capture cleanup, preventDefault, classes,
selectors, separator ARIA, width bounds and persisted widths. Mobile resizing,
Blockly mounting, old-project state, code generation and domain behavior are
outside this slice. No module extraction, import/chunk tricks, dependencies,
workflow/configuration changes or cap increase.

Before edits preserve a narrow actual native baseline for both handles. Prove
mouse/pointer dragging direction and clamping, wrong button/pointer rejection,
normal/Shift arrow steps, cancel/lost-capture cleanup and persistence using
actual handlers. Synthetic negatives must be identified separately. Keep
existing project/persistence regressions unchanged and run applicable ones.

Run one early fresh production build and all eight fixed caps. Reference parent
Arduino1999925/2000000, editor187859/222000: identical product bytes were measured
in accepted873. Record actual savings; no inferred additive budget for prepared
865/789. If no saving or behavioral regression, preserve candidate and stop;
do not expand to adjacent cleanup. Candidate composition is a separate slice.

Freeze/push after focused proof and self-review. A fresh independent source and
native review precedes one unchanged-SHA uncached canonical electronics gate
and final review. Root controller integrates verified source. No Docker, server,
live database, ports, deployment or protected assets.
