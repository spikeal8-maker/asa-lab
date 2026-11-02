---
task_id: TASK-ELECTRONICS-MOBILE-PROPERTIES-001
kind: repair
risk: medium
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Compact collapsible component properties on phones

Issue [952](https://github.com/spikeal8-maker/asa-lab/issues/952). New explicit
owner request: phone component properties disappeared; resistance cannot be
changed. State lives only in current.yaml. This independent UI candidate may be
authored while the frozen944/870 source receives CI, but integration follows944.

## Required behavior

On phones a selected component has a small square disclosure control on the
canvas. Default collapsed; expand/collapse without losing selection or edits.
The expanded panel is compact, clearly below half-screen coverage, and scrolls
internally so resistance and other existing properties remain reachable.
Desktop properties open normally immediately on selection. Reuse existing
property editors, controller validation/commits and model behavior; do not create
a second property implementation. Preserve wires' existing compact interface.

Current mobile CSS hides workbench-inspector when the library is open and when
code is open. Correct those conditions for the compact component disclosure;
respect intentionally fullscreen code/canvas availability. Preserve desktop,
portrait/landscape, keyboard/focus, collapse with pending valid edits and invalid
input behavior. Keep source/configuration, Undo/Redo and whole Save/reopen safe.

Hide phone zoom-in/out controls, preserving actual native two-finger zoom/pan.
Inspect circuit and applicable Blockly workspace controls; do not remove an
independent palette scaling function unless equivalent native interaction is
actually supported. Desktop controls stay available. No page-zoom substitute or
synthetic DOM gesture passed off as native pinch evidence.

## Bounded source and proof

Scope WorkbenchSidebars.tsx, WorkbenchStage.tsx, workbench.css, optional small
mobile-inspector disclosure helper/component, and narrowly necessary
ArduinoCodePanel.tsx zoom configuration only. Reuse existing UI icons. No
component artwork, SVG owner assets, solver, interpreter, schema, dependencies,
workflow, server, deployment or unrelated refactor. Source may not modify the
frozen944/870 candidate or another worktree's WIP. Root owns execution metadata.

Use focused rendering/controller tests first. Then actual phone Chromium touch
at390x844 and568x320 plus desktop1536x864: default collapse, native expansion and
collapse, complete captions/control bounds and internal scroll owner, actual
resistor edit and immediate Save/request/server/reopen equality, Undo/Redo,
selection switching, keyboard/viewport behavior, and real pinch zoom/pan without
component movement. Record selected component/model consistency. Update relevant
subsystem mapping/canonical coverage only as required. Independent final-source
and actual browser evidence review precedes integration; source author stops at
one reviewable candidate. No broad app build locally or additional local stack.
