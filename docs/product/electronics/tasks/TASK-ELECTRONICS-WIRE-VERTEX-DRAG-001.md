---
task_id: TASK-ELECTRONICS-WIRE-VERTEX-DRAG-001
kind: repair
risk: high
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - Integrated first bounded breadboard hotspot slice of TASK-ELECTRONICS-BREADBOARD-PERFORMANCE-001
acceptance_boundary: slice
review: independent
---

# Wire vertex drag must not become a double-click deletion

Program: [#452](https://github.com/spikeal8-maker/asa-lab/issues/452). Baseline repair: [#493](https://github.com/spikeal8-maker/asa-lab/issues/493). This is one bounded repair of the existing wire-vertex gesture. It is separate from the breadboard overlay change in [#465](https://github.com/spikeal8-maker/asa-lab/issues/465).

## Entry evidence

On integrated `main=557110e1a36b486a748f87e4efc31b008667539d`, [Electronics browser run 37171786707](https://github.com/spikeal8-maker/asa-lab/actions/runs/37171786707) failed in attempts 1 and 2 at the same F3 wire-bend test: 110 passed, one failed. The trace records two presses on the same vertex 383 ms apart. The second press follows a completed drag and Undo, yet the pre-existing `WorkbenchStage.tsx` vertex handler treats it as a double-click within 420 ms and removes the vertex. The selected wire remains visible without its vertex handle. The #465 diff did not change this handler. Candidate #465 browser evidence passed once; this reproducible main failure is an independent baseline blocker under `AGENTS.md` §2.1 category C.

## One user result

Dragging a wire bend, releasing it, undoing, and promptly dragging it again does not delete the bend. A deliberate stationary double-click still removes the bend. F3 soft-lock, Alt free movement, Shift behavior, Undo/Redo, wire topology and saved vertices remain correct.

## Bounded implementation

- Recover fresh `origin/main`, Electronics lane, #493, exact-head CI and other agents' incomplete changes. Run `pnpm agent:preflight --scope electronics --check` and `pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-WIRE-VERTEX-DRAG-001` before edits.
- Inspect the production vertex pointer handler and drag completion, not only the Playwright test. Prevent a completed drag from arming the next press as a double-click. Preserve intentional double-click deletion and keyboard Delete/Backspace.
- Add a focused regression that uses the real built editor and exercises repeated drag/Undo within the 420 ms window, alongside intentional stationary double-click removal. Keep the test deterministic without arbitrary sleep or a larger timeout.
- Change only the wire-vertex gesture path and direct regression. No breadboard optimization, solver, schema, owner artwork, Scratch, deployment or database changes.

## Acceptance

- Mapped tests and built-browser journey show a completed drag followed by a quick new press retains the vertex; a deliberate double-click deletes it. Verify the document as well as the visual handle after Undo/Redo and save/reopen where applicable.
- `pnpm gate:electronics-m1`, `pnpm gate:electronics-m1:browser`, `pnpm gate:repository` and `git diff --check` have exact-head evidence. The independent reviewer checks actual final SHA, diff, browser behavior and GitHub state.
- After integration, repeat exact-main Electronics browser gate. Only then may the first #465 hotspot slice be marked technically accepted; #465 remains open for separate extraction/mechanics and school-device evidence.

## Stop

The implementer repairs this one gesture, reports the exact candidate SHA and STOP. The controller handles independent review, integration, #465 partial closeout and the next program dependency.
