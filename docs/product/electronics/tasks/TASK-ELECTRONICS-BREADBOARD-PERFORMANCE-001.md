---
task_id: TASK-ELECTRONICS-BREADBOARD-PERFORMANCE-001
kind: repair
risk: high
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - Technical acceptance of TASK-ELECTRONICS-GOVERNANCE-005
acceptance_boundary: slice
review: independent
---

# Measured breadboard interaction hotspot

Program: [#452](https://github.com/spikeal8-maker/asa-lab/issues/452). Fifth milestone: [#465](https://github.com/spikeal8-maker/asa-lab/issues/465). This is the first bounded slice of #465: one measured interaction hotspot on the existing 882-hole board. Extraction mechanics, flexible leads and multi-board behavior remain separate results.

## One user result

The large breadboard no longer incurs the selected, reproducible interaction stall in the built editor. Hole identity, pointer/keyboard access, existing bindings, electrical topology and saved project data remain intact. The result is a measured improvement on a controlled browser setup, not a claim about the school device or classroom deployment.

## Entry and measurement

Recover fresh `origin/main`, Electronics lane, #465, exact-head CI and other agents' incomplete work. Run `pnpm agent:preflight --scope electronics --check` and `pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-BREADBOARD-PERFORMANCE-001`. Read the Electronics route, full stabilization spec §4 fifth milestone, hygiene contract/baseline and relevant component maps.

In the built browser editor, measure small/medium/large boards with the same browser, viewport and repeat protocol. Separate initial mount, idle hole DOM, drag start, movement, drop and snap search. Include an empty 882-hole board and a board with a rigid 2-pin component. Record before timings, DOM count and the exact code path. The existing `snapComponentToBreadboard` guards origin candidates by 30 world units; do not quote an unmeasured full H² estimate as observed cost. Select **one** dominant reproducible hotspot before changing code. If no material hotspot can be reproduced, report evidence and STOP without speculative optimization.

## Bounded repair

- Change only the selected hot path and its direct dependency. Prefer a source-level reduction in work over a cosmetic loading indicator or loosened correctness check.
- Preserve stable board/hole IDs, `holeBindings`, hit areas, keyboard and touch behavior, wire terminals, rotation/mirroring, Undo/Redo and save/reopen compatibility. The deterministic solver and physical model remain unchanged.
- Do not alter extraction dead-zone/hysteresis, board movement with bound rigid/flexible parts, multiple-board selection, owner artwork, schema, autosave, Scratch, deployment or database state. Those behavior choices need separate bounded work and, where §7 applies, owner approval.

## Acceptance

- Reproducible before/after measurements use the same machine/browser/fixture and show the selected hotspot improved without merely moving cost into another step. Report distribution and long pauses, not an invented universal millisecond threshold.
- Mapped tests and a real built-browser journey cover the optimized path and preserve hole selection/wiring, rigid component binding/topology and save/reopen. No project IDs, terminals or user wires are lost.
- `pnpm gate:electronics-m1`, `pnpm gate:electronics-m1:browser`, `pnpm gate:repository` and `git diff --check` have exact-head evidence. Independent reviewer checks actual diff, measurements, browser behavior and GitHub state. Unrelated CI is classified under `AGENTS.md` §2.1.

## Stop

The implementer makes one measured repair, runs focused gates/self-review, reports exact candidate SHA and STOP. The controller handles independent review, integration and closeout. Remaining #465 mechanics and school-device responsiveness are separate evidence and are not declared accepted by this slice.
