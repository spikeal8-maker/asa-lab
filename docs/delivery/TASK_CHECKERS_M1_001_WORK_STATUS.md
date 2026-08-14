# TASK-CHECKERS-M1-001 work status

State source: `docs/execution/current.yaml`

Programme source: `docs/delivery/EXECUTION_MANIFEST.yaml`

Owner scope: Issue #98

Current PR: #101

Rendered from the control plane; `pnpm control-plane:check` fails on drift.

```text
task: TASK-CHECKERS-M1-001
branch: agent/checkers-education-m1
status: done
checkpoint: merged_to_main
execution_lease: codex-checkers-m1
convergence baseline: 0a7d11658c3c836818c313c6ff3ff2161f902ac3
```

## Owner decision

The owner activated a standalone educational Russian-draughts system and
limited current product work to Checkers only. 3D M0 is already preserved in
`main` by merged PR #95 and remains outside the Checkers writable scope. Chess
and Electronics are preserved.

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

## Current evidence

The independent `@asa-lab/checkers` package now owns the strict Russian-64
project document, canonical 24-piece starting position, module metadata,
validation, preview and analysis foundation. At baseline `db1038c`, focused
typechecking, linting and all 6 initial unit tests pass locally.

See `docs/product/CHECKERS_EDUCATION_MARKET_ANALYSIS.md` and Issue #98 for the
complete product and acceptance scope.
