---
task_id: TASK-ELECTRONICS-BREADBOARD-RIGID-MOVE-001
kind: repair
risk: high
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - Technical acceptance of TASK-ELECTRONICS-BREADBOARD-EXTRACTION-001
acceptance_boundary: slice
review: independent
---

# Move one breadboard with mounted rigid parts

Program: [#452](https://github.com/spikeal8-maker/asa-lab/issues/452). Fifth milestone: [#465](https://github.com/spikeal8-maker/asa-lab/issues/465). Bounded task: [#505](https://github.com/spikeal8-maker/asa-lab/issues/505). This card covers the existing single-board rigid mounting behavior after accepted extraction [#500](https://github.com/spikeal8-maker/asa-lab/issues/500).

## One user result

A pupil can move one breadboard with already mounted rigid parts. Each part follows exactly once. After drop, Undo/Redo and save/reopen, its terminal-to-hole bindings, component/terminal/wire IDs, netlist and schematic remain correct. The drag preview agrees with the committed document. Selecting a mounted part along with the board does not double-translate it.

## Entry and diagnosis

Recover fresh `origin/main`, the Electronics lane, Issue #505, exact-head CI and other agents' unfinished edits. Run `pnpm agent:preflight --scope electronics --check` and `pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-BREADBOARD-RIGID-MOVE-001` before product edits. Read the Electronics route and stabilization spec fifth milestone, the existing `holeBindings` contract, board drag/preview and mapped tests.

In the built browser editor, reproduce a single board with a rigid mounted two-pin part and a wire to an external part. Check board-only selection and board-plus-mounted-part selection; pointer preview, drop, bindings, visible terminal/wire positions, netlist, Undo/Redo and save/reopen. Identify the exact production path of any defect. If this bounded behavior already works, report evidence and STOP without speculative code changes.

## Bounded repair

- Correct only a demonstrated fault in this one-board rigid-part movement path and its direct regressions. Preserve stable IDs, bindings, existing student projects and electrical topology. No new persistence schema or solver/physical-model change.
- Keep flexible-lead bodies, multiple boards, shared rotation/reflection, school-device performance, owner artwork, Scratch, deployment, database, network and unrelated cleanup outside this slice. Those new mechanics require the separate owner decision in spec §7.

## Acceptance

- Production-code explanation and built-browser evidence show the board and rigid mounted part move once, with preview/commit parity and correct topology after Undo/Redo and save/reopen.
- Focused mapped tests, `pnpm gate:electronics-m1`, `pnpm gate:electronics-m1:browser`, `pnpm gate:repository` and `git diff --check` have exact-head evidence. A new independent reviewer checks the final SHA, diff, evidence and GitHub state.
- After integration repeat the exact-main Electronics browser gate. Issue #505 closes only after its evidence and control-plane closeout. Issue #465 remains open for remaining mechanics and school-device proof.

## Stop

The implementer handles this one slice, self-reviews, reports an exact candidate SHA and STOP. The controller checks independently, assigns a new reviewer, integrates an accepted result and continues the authorized program under `AGENTS.md` §2.1.

## Selected final convergence of preserved test-only candidate

Dependency #516 is technically accepted on exact-main `dd97aea620e37b270b969213f9d3812e2e029cae` with required General `37732525782`, full Electronics `37732936127` and NEW independent APPROVE. Preserve accepted #500 and PR506 candidate `350d2442d044d8992374ca4deef2758b6c95c61f`. This candidate adds only the existing146-line board-transfer browser scenario; runtime repair is not selected without a proved defect.

A NEW bounded executor restores actual main/PR/current.yaml and selected-card entry, converges once with the current checked main and canonical selection, preserving the entire candidate test body and all main source/dependencies/foreign state. Before pushing the new exact candidate, provide a scoped actual-source archive and controller plus NEW reviewer acknowledgement; PR synchronize may automatically run registered General/full Electronics, so do not dispatch duplicates. Require final exact-SHA gates and a NEW independent review; old review/local tests are history only. Confirmed findings need a separate bounded repair/review. Report and STOP. Controller owns integration and closeout; this selection does not itself remove Draft or merge the PR. The postintegration exact-main browser repeat above remains mandatory. T3 remains pending a real student device; do not repeat old cadence/load probes.


## Technical closeout after required postintegration verification

Accepted candidate `2c76f97b1d54bd9693fb6e1ddc2fd8172a2afd86` received NEW independent APPROVE, General37736754158/full37736754136 SUCCESS and normal integration as `a05e7801d3c300750a0dbc3a792891102868bcc9` (identical candidate tree). The original146-line browser test is preserved; no demonstrated runtime defect or product repair occurred.

The merged-PR association was corrected by controller metadata only. Exact published `74bc9ddfb367f385cd902116ddc7150569a10270` then passed General37740061575 and the mandatory AFTER-integration full37741016763:1007focused/118browser,166+159freshNx/0hits. [NEW candidate review](../evidence/rigid-move-505-candidate-review-20261008.md) and [NEW published-state review](../evidence/rigid-move-505-published-review-20261008.md) APPROVE/STOP; executor STOP. Original logs and browserZIP were captured once and independently checked against actual API.

The source assertions establish one-board rigid movement, preview/commit, IDs/bindings/netlist, Undo/Redo and fixture save/reopen. They do not establish live classroom persistence or school-device performance. No passing rawtrace was persisted; that limit is qualified. Later unrelated Portal movement does not relabel exact74bc evidence as a green latest-main result. Issue465 remains open for T3/remaining mechanics;452 remains open. Technical closeout resolves only505's proven dependency/blocker, with owner/class acceptance and deployment still separate. The controller selects mandatory documentation-only hygiene524 before another unrelated production slice; no next product change follows from this card.
