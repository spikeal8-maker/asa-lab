# ASA Games Platform

**Status:** R0 ACCEPTED (7/7); R1 DELIVERY BRIEF ACCEPTED  
**Current product target:** private online Checkers  
**R1 authority:** `R1_DELIVERY_BRIEF.md`

This folder is the Games Platform documentation entry point. `docs/execution/current.yaml` is the only live task/lane state.

## Read order

For Games implementation:

1. root `AGENTS.md`;
2. root `START_HERE_FOR_AI.md`;
3. this README;
4. current `R1_DELIVERY_BRIEF.md`;
5. only the accepted R0 decision needed by the task.

Escalate to `ENGINEERING_HYGIENE.md`, Checkers/Chess audits or old research only when the bounded task requires it. Do not preload the whole folder.

For Chess/R4, additionally read `CHESS_HYGIENE_AUDIT.md` and `CHESS_R4_CORRECTNESS_RISKS.md`.

## Accepted foundation

`R0_TRACEABILITY.yaml` records all seven accepted decisions:

- gaming identity;
- Games security/storage domain;
- canonical Match dimensions;
- lifecycle/termination/finalization;
- first-class teams/outcomes;
- R1-R4 capability vocabulary;
- error/idempotency/limits.

Implementation must not silently reinterpret them.

## Delivery sequence

`R1 private online Checkers → R2 Quick Match + XO → R3 rated/stats Checkers → R4 Chess convergence → R5 classroom social → R6 realtime Arena → R7 creator web games`.

R1 user result:

`create invite → accept → play → disconnect/reconnect → finish → history`

R1 excludes Quick, rating, social directory, Chess migration, full realtime gateway, Arena and Creator.

## R1 checkpoints

- `R1A` hygiene tool + minimum platform foundation;
- `R1B` two-user private invite;
- `R1C` authoritative play behind `GameUpdateDeliveryPort`;
- `R1D` reconnect + finish + history + full hygiene audit.

Only R1D acceptance permits R2.

## Engineering hygiene

`ENGINEERING_HYGIENE.md` remains normative:

- changed-file check every bounded implementation slice;
- mini audit after 3 slices or 14 days;
- full audit at stage exit;
- structural audits before R4/R6/R7;
- hard-threshold legacy files may not receive new responsibility.

## Documentation budget

- router: target <=4 KB;
- task/decision/audit: target <=8 KB;
- trace/index: target <=6 KB;
- master/escalation: target <=12 KB.

Split evidence instead of growing routing documents.

## Governance

- GitHub `main` is repository truth.
- One bounded Games task at a time.
- Existing Checkers/Chess rules, bots, saves and mature behavior are protected.
- Merge, migration, feature enablement and deployment are separate actions.
- Never claim PASS unless the exact gate actually ran.
