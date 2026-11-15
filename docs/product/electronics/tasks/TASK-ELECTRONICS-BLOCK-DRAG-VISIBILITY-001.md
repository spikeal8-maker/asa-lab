---
task_id: TASK-ELECTRONICS-BLOCK-DRAG-VISIBILITY-001
kind: repair
risk: low
semantic_change: no
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Keep dragged Blockly blocks normally visible

Owner selects item1 of the updated list. Reproduce native drag dimming before
minimal repair in existing ArduinoCodePanel visual activity handling. While
dragging, the dragged tree retains normal brightness even when temporarily
detached or previously inactive. After release, settled inactive chains dim only
under existing setup/loop rules. Reconnecting restores normal appearance.

Preserve generated code, rootless fallback, IDs, saved workspace, Undo/Redo and
block capability colors. No refactoring or new generic framework. Supporting
scope existing inactive-block browser fixture and focused checks. Real native
mouse and touch drag, palette drag, release detached/reconnect, roots absent,
Undo/Redo and reopen at desktop/mobile; verify generated output unchanged.

Fresh focused gate, types/build and fixed bundle caps222000/2000000. New
independent final source/UI review. No physics timing library changes, protected
assets, dependencies, foreign changes, server Docker DB or deployment. One
bounded candidate then STOP; no automatic next task.
