# ASA Games Platform

**Status:** R0 ACCEPTED; R1 not yet activated  
**Architecture gate:** 7/7 accepted  
**Next required artifact:** `R1_DELIVERY_BRIEF.md`

This folder is the current Games Platform documentation entry point. `docs/execution/current.yaml` remains the only live task/lane state.

## Read order

For new Games work:

1. root `AGENTS.md`;
2. root `START_HERE_FOR_AI.md`;
3. this README;
4. `R0_ARCHITECTURE_FREEZE.md`;
5. the exact accepted R0 decision relevant to the task;
6. the current Delivery Brief once R1 is activated.

Do not preload the whole Games folder. Escalate to `ENGINEERING_HYGIENE.md`, Checkers/Chess audits or old research only when the current bounded task requires them.

For Chess/R4 or Chess hygiene, read `CHESS_HYGIENE_AUDIT.md` and `CHESS_R4_CORRECTNESS_RISKS.md`.

## R0 result

R0 is closed. Canonical evidence is `R0_TRACEABILITY.yaml`.

Accepted decisions:

- `GP-R0-001` gaming identity;
- `GP-R0-002` Games security/storage domain;
- `GP-R0-003` canonical Match dimensions;
- `GP-R0-004` Match lifecycle/termination/finalization;
- `GP-R0-005` first-class teams/outcomes;
- `GP-R0-006` minimum R1–R4 capability vocabulary;
- `GP-R0-007` error/idempotency/limits contract.

Changing one requires an explicit architecture amendment; implementation must not silently reinterpret it.

## Delivery sequence

`R1 private online Checkers → R2 Quick Match + XO proof → R3 rated/stats Checkers → R4 Chess convergence → R5 classroom social → R6 realtime Arena → R7 creator web games`.

R1 starts only after a compact `R1_DELIVERY_BRIEF.md` is accepted and the execution manifest activates an R1 implementation task.

## R1 result

The first implementation target is one complete private online Checkers match between two real authenticated ASA users:

`create invite → accept → play → disconnect/reconnect → finish → history`.

R1 must not include Quick Match, rating, Chess migration, Arena, Creator or speculative infrastructure.

## Engineering hygiene

`ENGINEERING_HYGIENE.md` is normative across implementation stages.

- changed-file hygiene on every bounded slice;
- mini-audit after three implementation slices or 14 days;
- full scoped audit at each R-stage exit;
- structural audits before R4/R6/R7;
- existing hard-threshold files are grandfathered debt, but may not receive a new responsibility.

## Documentation budget

- compact agent/router document: target ≤ 4 KB;
- one task/decision/audit: target ≤ 8 KB;
- trace/index: target ≤ 6 KB;
- master/escalation process doc: target ≤ 12 KB.

Split evidence rather than growing routing documents.

## Governance

- GitHub `main` is current repository truth.
- One bounded task at a time.
- Existing Checkers/Chess rules, bots, saves and mature behavior are protected from speculative rewrite.
- Merge, migration, feature enablement and deployment are separate actions.
- Never claim a test/gate PASS unless it actually ran.
