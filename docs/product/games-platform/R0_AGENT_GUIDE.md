# Games R0 — closed architecture guide

**Status:** R0 accepted and closed  
**Runtime changes authorized by this file:** none

This file remains only as a compact router for the accepted R0 architecture. Live work is declared only by `docs/execution/current.yaml`.

## Rule for agents

Do not create a new `GP-R0-*` requirement.

If implementation discovers that an accepted R0 decision is wrong or incomplete:

1. stop the affected implementation slice;
2. name the conflicting decision id;
3. create a bounded architecture amendment;
4. update the decision, challenge review and `R0_TRACEABILITY.yaml`;
5. resume implementation only after the amendment is accepted.

Never silently change Games identity, tenancy/RLS, Match dimensions, lifecycle, teams, capability semantics or idempotency behavior inside an implementation PR/commit.

## Accepted authority

Read `R0_ARCHITECTURE_FREEZE.md` first, then only the exact decision needed:

- `R0_001_GAMING_IDENTITY.md`;
- `R0_002_GAMES_SECURITY_DOMAIN.md`;
- `R0_003_CANONICAL_MATCH_MODEL.md`;
- `R0_004_MATCH_STATE_MACHINE.md` + `R0_004_TERMINATION_FINALIZATION.md`;
- `R0_005_TEAMS_AND_OUTCOMES.md`;
- `R0_006_MINIMUM_CAPABILITIES.md`;
- `R0_007_ERROR_IDEMPOTENCY.md` + `R0_007_ERROR_CATALOG_LIMITS.md`.

`R0_TRACEABILITY.yaml` is the acceptance ledger.

## Next-stage guard

R0 acceptance does not itself start coding. Before R1 runtime/schema work:

- create and accept `R1_DELIVERY_BRIEF.md`;
- activate an explicit R1 task in `docs/execution/current.yaml`;
- record exact in-scope/out-of-scope surfaces and evidence;
- run the initial Games hygiene baseline.

R1 target is private online Checkers only.

## Hygiene

Follow `ENGINEERING_HYGIENE.md`. Do not expand hard-threshold Checkers files with new responsibilities. Split focused seams only when the R1 user journey actually touches them.
