---
task_id: TASK-ELECTRONICS-CONTROL-001
kind: plan/governance
risk: medium
semantic_change: no
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Reconcile stale Electronics Draft PR

## Goal

Determine whether Draft PR #372 still contains a needed repair on fresh `main`.
If its changes are already present or superseded, record the evidence and close
the PR without merging it. If a live defect remains, stop and register a fresh
bounded repair rather than reviving the stale branch.

## Scope and risk

This is a control-plane reconciliation of an old Electronics candidate, not a
runtime change. Closing a superseded Draft PR is reversible, but accepting its
old golden or hygiene baseline would risk discarding later verified evidence.

## Minimal read set

- `AGENTS.md` §§2, 2.1, 7 and 8;
- `docs/execution/current.yaml`, Electronics lane;
- `docs/product/electronics/START_HERE.md` and `AGENT_GUIDE.md` §§2, 11–13, 15;
- PR #372 metadata, exact patch and current GitHub state;
- the three paths changed by PR #372 and their current contracts/evidence.

## Allowed writes and actions

- This card and the Electronics task record in `docs/execution/current.yaml`;
- an evidence comment on Issue #402 and PR #372;
- close PR #372 without merging only after independent review proves it obsolete;
- close Issue #402 after exact-head verification and control-plane closeout.

No Electronics product source, tests, golden fixtures, hygiene baseline, assets,
or other work package may be changed in this task.

## Acceptance

1. Fresh `main` and PR HEAD are recorded and each of the three PR paths is
   independently classified against current `main`.
2. The relevant benchmark and Electronics agent-document checks pass on the
   candidate; current-main CI is checked on its exact SHA.
3. A new independent reviewer returns `APPROVE` on the classification and
   confirms that no needed change would be lost by closing the PR.
4. PR #372 is either closed as superseded without merge, or left open with a
   concrete blocker and a separate fresh repair proposal.
5. The task, Issue and execution state are reconciled without activating the
   next Electronics work package.

## Stop

Report exact SHAs, review, verification and residual risk, then STOP this task.
