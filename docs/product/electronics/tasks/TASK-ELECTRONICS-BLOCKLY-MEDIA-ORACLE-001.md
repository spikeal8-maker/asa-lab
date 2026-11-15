---
task_id: TASK-ELECTRONICS-BLOCKLY-MEDIA-ORACLE-001
kind: repair
risk: low
semantic_change: 'no'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Align the Blockly media fixture with generated setup

The media case uses an empty saved Arduino setup from before the current
pin-mode rule. It fails at the generated text assertion before it reaches
the media checks. Seed the exact current Uno source for the unchanged
empty Blockly workspace and keep the preview comparison independent of
the production generator.

Scope covers the two modes in the existing media fixture and the generated
browser evidence digest. Preserve the pinned media bytes, native gestures,
the pre-mount baseline and complete draft and revision checks at zoom and
reopen. Verify both modes in Chromium using the existing test thresholds.
