# TASK-CHECKERS-M1-001 work status

State source: `docs/execution/current.yaml`

Programme source: `docs/delivery/EXECUTION_MANIFEST.yaml`

Owner scope: Issue #98

Current PR: #99

Rendered from the control plane; `pnpm control-plane:check` fails on drift.

```text
task: TASK-CHECKERS-M1-001
branch: agent/checkers-education-m1
status: in_progress
checkpoint: market_and_product_contract
execution_lease: codex-checkers-m1
convergence baseline: 49e00590d48b7ca1bf7463e7325897d859ff8d96
```

## Owner decision

The owner activated a standalone educational Russian-draughts system and
limited product work to Checkers only. The prior 3D M0 task is paused without a
merge or completion claim. Chess and Electronics are preserved.

## Required result

```text
student enters Checkers
→ sees current learning, assignments, games, bot progress and review queue
→ learns or completes teacher work
→ plays a legal Russian-draughts game against a bot or authorised classmate
→ receives evidence-based review and progress
→ teacher sees activity, mastery and exact move-level evidence
```

Child-to-child free-form chat, direct messages and public matchmaking are not
part of the result. Only predefined, rate-limited and auditable reactions are
allowed.

See `docs/product/CHECKERS_EDUCATION_MARKET_ANALYSIS.md` and Issue #98 for the
complete product and acceptance scope.

