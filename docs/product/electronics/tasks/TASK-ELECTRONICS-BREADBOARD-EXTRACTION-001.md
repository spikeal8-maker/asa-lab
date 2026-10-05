---
task_id: TASK-ELECTRONICS-BREADBOARD-EXTRACTION-001
kind: repair
risk: high
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - Technical acceptance of the first bounded breadboard hotspot slice of TASK-ELECTRONICS-BREADBOARD-PERFORMANCE-001
  - Technical acceptance of TASK-ELECTRONICS-WIRE-VERTEX-DRAG-001
acceptance_boundary: slice
review: independent
---

# Extract one rigid component from one breadboard

Program: [#452](https://github.com/spikeal8-maker/asa-lab/issues/452). Fifth milestone: [#465](https://github.com/spikeal8-maker/asa-lab/issues/465). Bounded extraction repair: [#500](https://github.com/spikeal8-maker/asa-lab/issues/500). The first measured overlay slice is technically accepted; this card selects only the existing single-board rigid-part extraction path.

## One user result

A pupil can deliberately remove a rigid mounted component from a single breadboard. After its contacts are dragged beyond the existing placement region and dropped, the component stays detached with no stale `holeBindings` or silent re-snap to the old holes. Deliberate placement still creates the correct bindings. Component, board, terminal and wire IDs, electrical topology and the saved schematic remain intact.

## Entry evidence and bounded investigation

Recover fresh `origin/main`, Electronics lane, Issue #500, exact-head CI and other agents' incomplete work. Run `pnpm agent:preflight --scope electronics --check` and `pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-BREADBOARD-EXTRACTION-001` before edits. Read the Electronics router, stabilization spec fifth milestone, component map, existing `holeBindings` contract and mapped drag/document/browser tests.

Use the built editor to reproduce extraction on one board with one rigid two-pin component at more than one zoom. Observe pointer movement, drag preview, drop, `snapComponentToBreadboard`, binding change, visible terminals and saved document. Identify whether the defect is a snap search/threshold, stale binding, preview/commit mismatch or another demonstrated path. Do not infer a product failure solely from the isolated probes or a formula. If extraction already works in this bounded case, report evidence and STOP without speculative code changes.

## Bounded repair

- Correct only the proven single-board rigid extraction path and its direct regression. Keep deliberate mounting and `holeBindings` normalization compatible with existing student projects. Do not add a persistence schema or change the solver/physical model.
- Cover drop outside the placement region, deliberate remount, gesture cancel, Undo/Redo and save/reopen. Verify binding IDs and topology, not only position on screen. Check both the drag preview and committed document.
- Keep flexible-lead bodies, multiple boards, board movement with bound parts, shared rotation and school-device performance measurements outside this slice; §7 requires a separate owner decision for new mechanics there. No owner artwork, Scratch, deployment, database, network or unrelated cleanup.

## Acceptance

- A production-code explanation and built-browser journey show the rigid part can be removed without immediate unwanted re-snap and intentionally remounted, at tested zoom levels, with unchanged IDs and correct electrical nets after save/reopen.
- Focused mapped tests, `pnpm gate:electronics-m1`, `pnpm gate:electronics-m1:browser`, `pnpm gate:repository` and `git diff --check` have exact-head evidence. A new independent reviewer checks the final SHA, diff, evidence and GitHub state.
- After integration repeat the exact-main Electronics browser gate. Issue #500 closes only after the repair's evidence and control-plane closeout. Issue #465 stays open for remaining mechanics and school-device proof.

## Stop

The implementer handles this one rigid extraction slice, self-reviews, reports an exact candidate SHA and STOP. The controller independently checks it, assigns a new reviewer, integrates an accepted result and continues the program under `AGENTS.md` §2.1.
