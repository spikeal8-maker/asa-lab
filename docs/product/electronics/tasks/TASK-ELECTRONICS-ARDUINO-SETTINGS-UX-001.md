---
task_id: TASK-ELECTRONICS-ARDUINO-SETTINGS-UX-001
kind: implementation
risk: medium
semantic_change: 'no'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Arduino programming UX: block-only input-port settings

**Issue:** https://github.com/spikeal8-maker/asa-lab/issues/1220

**Programme:** ASA LAB — ARDUINO-PROGRAMMING-UX-REWORK-001, the second independent UI slice, after the P0 warning correction in PR #1163 (merged into main as `1f94e19be91bbb5ecec78f7ea0e0b11f03a076f7`). Users are people interested in electronics, without age restriction.

## Scope and requirements

The existing **«Настройки Arduino → Входные порты»** modifies only the C++ generated from Blockly blocks. In text C++ mode it does not modify user-written code. Show the menu command only in `blocks` or `blocks-text` modes, rename it **«Настройки блоков»**, and rename the dialog **«Настройки блоков — входные порты»**. Explain that configured pins affect block-generated `pinMode()` only; do not imply that text C++ is edited. Existing values in `arduinoInputPins` must survive mode changes, Save/Reload, Undo/Redo and board switches without migration or hidden source regeneration. Preserve source-only project import protection from #865.

Keep the current inference of literal and provable graph pins. Pins inferred from active blocks remain read-only. Clearly identify graph expressions whose pin value is unresolved; do not silently guess. Preserve all twenty GPIO options (D0–D13 and A0–A5), existing checkbox semantics, focus trap, cancel, Escape, click hit targets and desktop/mobile geometry.

This is a **presentation-only slice**. Do not change `generateArduinoCode`, `arduinoPinSetup`, `arduinoSetupModes`, `INPUT_PULLUP` generation, default unused GPIO `OUTPUT` (owner accepted in #944), solver, Worker, electrical model, runtime or timing. Any potential defect in those components requires a distinct selected repair and an exact compatibility decision.

## Exact planned implementation files

- `apps/web/src/electronics/ArduinoCodePanel.tsx`
- `e2e/electronics-block-pin-setup.spec.ts`

Existing E2E settings helper, native dialog/hit tests, and source-only `text-board` fixture must reflect the new label. Add checks that the text-mode menu has no inert control while stored `arduinoInputPins` and hand-written C++ survive a round trip. Preserve existing strict generated-source, Blockly geometry, keyboard, Save/Reload, Undo/Redo and electrical test assertions.

## Gates and delivery

Fresh `origin/main` and preflight before writing; check shared-file overlaps. One bounded executor and a separate independent final-SHA reviewer. Real Chromium on 1440, 1024, 390, 320 px, relevant targeted tests, exact-size budget and applicable Electronics focused/General required checks. Publish a reviewed branch and use ordinary protected GitHub merge; never bypass `ASA / required`. R4 timing and optical issues remain separate. No Codex, production rollout, live DB or user-data modifications.
