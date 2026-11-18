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
- `apps/web/src/electronics/testing/arduino-code-panel-persistence.spec.ts` (existing unit regression tests only; adapt old settings-menu expectations and retain GPIO, Undo/Redo, source-text, and Save/Reload coverage)

The third path is a bounded necessary test update for the existing UI expectations affected by this slice, not authorization to change the Arduino interpreter, generated code or runtime behavior. The implementation candidate already exists at `1ae0d5682cbae4d594e58c7c60586ffc90b94a7e`; preserve that commit and qualify it after the updated plan is accepted in `main`.

Existing E2E settings helper, native dialog/hit tests, and source-only `text-board` fixture must reflect the new label. Add checks that the text-mode menu has no inert control while stored `arduinoInputPins` and hand-written C++ survive a round trip. Preserve existing strict generated-source, Blockly geometry, keyboard, Save/Reload, Undo/Redo and electrical test assertions.

## Gates and delivery

Fresh `origin/main` and preflight before writing; check shared-file overlaps. One bounded executor and a separate independent final-SHA reviewer. Real Chromium on 1440, 1024, 390, 320 px, relevant targeted tests, exact-size budget and applicable Electronics focused/General required checks. Publish a reviewed branch and use ordinary protected GitHub merge; never bypass `ASA / required`. R4 timing and optical issues remain separate. No Codex, production rollout, live DB or user-data modifications.

## Technical delivery receipt — 2026-11-18

The selected UI slice is technically delivered. Separate **owner acceptance remains pending**; this receipt does not select another implementation task.

- QA [PR #1235](https://github.com/spikeal8-maker/asa-lab/pull/1235) was protected-merged as `e52c6fc8d2dae17f5d3ae8535c3f3feaa38da8c2`. Its exact [post-merge General / ASA required](https://github.com/spikeal8-maker/asa-lab/actions/runs/44294409263/job/134785279030) passed.
- Product [PR #1232](https://github.com/spikeal8-maker/asa-lab/pull/1232), reviewed source `093abc290e39e37cef03ac17a70f6ad23b1f804a`, was protected-merged as `4fc9ca348e0528401602226946d4f095334e61e0`. The merge tree exactly matches reviewed tree `64c36601370e60e570d65801be4b54eb3486035a`; the original implementation and three-file scope remain preserved. Both [source ASA required](https://github.com/spikeal8-maker/asa-lab/actions/runs/44301893765/job/134810695075) and [exact product post-merge ASA required](https://github.com/spikeal8-maker/asa-lab/actions/runs/44307498058/job/134830721173) passed.
- The final [native Chromium run](https://github.com/spikeal8-maker/asa-lab/actions/runs/44301893751/job/134793454511), with real API/Web and isolated PostgreSQL, passed **original 4/4 plus Robotics 4/4** at **1440×900, 1024×768, 390×844 and 320×700**. All original journeys, payloads and assertions were retained; attachments are physical per-test PNG/JSON files.
- The actual downloaded [artifact 14425993464](https://github.com/spikeal8-maker/asa-lab/actions/runs/44301893751/artifacts/14425993464) is **20,819,815 bytes**, SHA-256 `86658ab0e05fd74b71ed111b383a305f001c7bea62a6d0b1ea19a3c21e0a95a9`. Its **120 primary files comprise 52 PNG and 68 JSON**. All 52 primary images were opened independently; content/copy checks and all **320 checkbox/number row geometries** passed. The mobile dialog scrolls internally and inferred GPIO captions remain readable.
- Exact-source [#865 preservation](https://github.com/spikeal8-maker/asa-lab/actions/runs/44301893653/job/134793453233) passed: **16 oracle records, six mounts, genuine edits at 1440/390, zero source and workspace overwrites**. The oracle count is not a count of separate browser tests. Focused persistence passed **15/15** and the specific [M1 job](https://github.com/spikeal8-maker/asa-lab/actions/runs/44301893969/job/134793766227) passed with fresh execution and Nx cache disabled. All **eight build budgets** passed; Arduino was **92,151 / 2,000,000 bytes**, initial JS/CSS graph **597,315 / 600,000 bytes**.
- Independent technical source/content/visual review passed on `093abc29` and retained that scoped verdict after the completed R4 diagnosis. Formal GitHub review is separate: one historical `COMMENTED` review, no current `APPROVED`, the P2 thread resolved and zero unresolved threads. The historical [Chromium 4/4 at `71d8ddec`](https://github.com/spikeal8-maker/asa-lab/actions/runs/44091540418/job/134067631084) remains historical evidence; final qualification uses `093abc29`.

### Remaining acceptance boundaries

The exact-source [broad R4 run 44301893969](https://github.com/spikeal8-maker/asa-lab/actions/runs/44301893969) completed **FAILURE: 256 passed / 14 failed across 270 browser cases**. Six existing fixture failures are recorded under [#1215](https://github.com/spikeal8-maker/asa-lab/issues/1215); eight timing/optical observations are recorded under [#682](https://github.com/spikeal8-maker/asa-lab/issues/682). No direct failure path in the selected settings UI was found, but causes of the timing/optical deviations and absence of indirect performance effects were not established. The successful M1 job does not mean that the full R4 workflow passed.

Whole R4, generator/GPIO [#944](https://github.com/spikeal8-maker/asa-lab/issues/944) and owner acceptance remain separate. No runtime, threshold, deployment or live-database change is included in this technical closeout.
