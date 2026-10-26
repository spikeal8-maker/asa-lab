---
task_id: TASK-ELECTRONICS-BLOCK-PRESENTATION-001
kind: repair
risk: medium
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# RGB block, readable editor text and native palette scrolling

Owner added these presentation repairs while analog762 is active: RGB block has
grown into separate floors; block/editor text looks cramped; remove the overlay
up/down arrows shown in the supplied screenshot. This card is PLANNED ONLY until
controller selects it on main; do not interrupt or mutate analog762 paths.

Read-only actual native diagnostic found RGB inputsInline=false,231x296 units:
missing args0 bypasses common inline setup, while three pin reporters plus RGB
values form six external rows. Explicit RGB inline configuration is the minimal
cause-based fix. Preserve all six input names, types/connections, generated code,
Undo/Redo and old workspace migration. Do not revert round expression sockets to
plain fields or change other blocks to hide the layout defect.

Actual text uses ArialMT500/16px; measured label width215.21 equals actual canvas
Arial500, not declared theme600(230.96). Theme12 versus rendered16 is NOT evidence
of a size mismatch. Actual CodePanel UI has13px/13px summary; code uses14px/20.3px
Cascadia Mono fallback. Dark SVG label shadow is active. Improve readability
with one coherent supported UI/block font configuration and suitable line spacing,
verify native measurement/rendering match. Remove inappropriate label shadow;
no unproved weight/family replacement, no glyph squeezing/textLength hacks.
Use existing fonts only. Preserve true monospace, selection/caret/highlight/gutter
alignment in C++ mode; no code/data transformations or global app typography.

Remove custom React .arduino-palette-scroll arrows and their dedicated styles,
imports and unused arrow-only helper only when safe. Preserve native wheel/touch/
scrollbar navigation and configureArduinoPaletteScroll category-bottom correction.
No general cleanup or file redistribution. Keep every Output/Input/Control/Math/
Variables category end reachable at100/110/125% and mobile.

Allowed production ONLY ArduinoCodePanel.tsx, arduino-blocks.ts,
arduino-block-ui.ts and workbench.css in web electronics, narrow above concerns.
Supporting focused block/editor tests and ONE real ScratchWorkspace/CodePanel
browser fixture. Confirm cause/proposal before product edits; no analog Monitor/
runtime/controller/source model changes. Actual before/after native RGB and text
desktop1440/mobile390/320 plus FullHD125 effective1536width and DPR/zoom distinctions.
No overlay arrows, native scrolling to last math/variable blocks, RGB nested math/
pin expressions and legacy reopen/IDs/Undo/Redo/code byte equivalence. Include
readable cropped actual PNG comparisons so owner can inspect the visual result.

Fresh focused/native/format/lint/types/build, literalNX_SKIP_NX_CACHE=true required
gateelectronics-m1 and bundlecaps222000/2000000. No arbitrary budget increase or
unrelated cleanup. Independently review exact final SHA and font geometry/original
images; do not claim subjective owner approval from metrics. One bounded candidate
and final convergence then STOP. No dependencies/workflows/assets/server/Docker/
liveDB/deployment/foreign edits; full installed/SaveCAS/owner acceptance separate.
