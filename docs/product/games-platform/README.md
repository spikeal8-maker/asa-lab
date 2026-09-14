# ASA Games Platform — R0 preflight

**Status:** R0 documentation preflight only  
**Baseline:** `main@c9fbb773bc4b2c4e19c181ef586ee6300a9cfed6`  
**Branch:** `docs/games-r0-preflight`

This package is the entry point for prepared Games Platform R0 architecture work. It replaces stale execution assumptions on `docs/asa-games-platform-architecture`; that older branch is research/history only until deliberately reconciled.

This file is documentation routing, **not live execution state**. Only `docs/execution/current.yaml` may declare an active task/lane.

## Read order

When Games R0 work is explicitly assigned, read only:

1. root `AGENTS.md`;
2. root `START_HERE_FOR_AI.md`;
3. `R0_AGENT_GUIDE.md`;
4. `R0_CURRENT_STATE_AUDIT.md`;
5. the exact R0 decision section in `R0_ARCHITECTURE_FREEZE.md` plus its row in `R0_TRACEABILITY.yaml`.

Escalate to identity, Chess, Checkers, `ENGINEERING_HYGIENE.md` or older Games research only when the assigned requirement/change requires it. Do not preload the entire old Games documentation set.

## Prepared stage

`R0 — Architecture Freeze` is prepared but is not activated as a live implementation lane by this branch.

R0 permits documentation, repository inspection and architecture decisions only. It does **not** authorize shared `games_*` SQL migrations, generic Games API endpoints, production WebSocket work, deployment, or Checkers/Chess cutover.

R0 closes exactly seven requirements:

- `GP-R0-001` gaming identity;
- `GP-R0-002` Games security/storage domain;
- `GP-R0-003` canonical Match dimensions;
- `GP-R0-004` Match state machine/termination;
- `GP-R0-005` first-class teams;
- `GP-R0-006` minimum R1–R4 capability vocabulary;
- `GP-R0-007` error/idempotency contract.

R1 begins only after all seven have accepted evidence and the execution manifest explicitly activates the Games lane.

## Product sequence

The delivery order remains value-driven:

`R0 → R1 private online Checkers → R2 Quick Match + XO proof → R3 rated/stats Checkers → R4 Chess convergence → R5 classroom social → R6 realtime Arena → R7 creator web games`.

Later stages cannot pull infrastructure into an earlier stage without explicit architecture review.

## Engineering hygiene

`ENGINEERING_HYGIENE.md` is the cross-stage file-size/garbage contract. Every bounded implementation slice performs a changed-file delta check; every R-stage exit performs a scoped full audit; structural audits are mandatory before R4, R6 and R7. Hygiene is bounded and may not become unrelated repository-wide refactoring.

## Documentation size rule

Games routing/task documents must stay small enough for targeted agent context:

- agent guide: target ≤ 4,000 UTF-8 bytes;
- one R0 decision/audit file: target ≤ 8,000 bytes;
- trace/index file: target ≤ 6,000 bytes.

If a document grows beyond the target, split evidence/details into a supporting file instead of growing the router. This aligns with the repository targeted-context budget (`MAX_TARGETED_RENDERED_CHARS = 8000`).

## Governance

- GitHub `main` is the source of truth for current repository facts.
- Do not use old branch facts without re-checking `main`.
- One bounded requirement at a time.
- Existing Checkers/Chess rules, bots, saves and mature behavior are protected from speculative rewrite.
- Merge, migration, feature enablement and deployment are separate actions.
- Use `POST_STEP_REVIEW`; L3/Auth/RLS/state-machine work also requires `CHALLENGE_REVIEW`.
- Never report a test as PASS unless it was actually run.
