# TASK-CHECKERS-M1-001 work status

State source: `docs/execution/current.yaml`

Programme source: `docs/delivery/EXECUTION_MANIFEST.yaml`

Owner scope: Issue #98

Current PR: #101

Rendered from the control plane; `pnpm control-plane:check` fails on drift.

```text
task: TASK-CHECKERS-M1-001
branch: agent/checkers-education-m1
status: in_progress
checkpoint: project_document_foundation
execution_lease: codex-checkers-m1
convergence baseline: db1038c66630c80bf121e7c794a44f119a028753
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

## Current evidence

The independent `@asa-lab/checkers` package now owns the strict Russian-64
project document, canonical 24-piece starting position, module metadata,
validation, preview and analysis foundation. At baseline `db1038c`, focused
typechecking, linting and all 6 initial unit tests pass locally.

See `docs/product/CHECKERS_EDUCATION_MARKET_ANALYSIS.md` and Issue #98 for the
complete product and acceptance scope.
