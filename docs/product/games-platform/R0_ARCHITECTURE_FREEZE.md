# ASA Games Platform — R0 Architecture Freeze

**Status:** ACCEPTED  
**Accepted requirements:** 7/7  
**Runtime/schema changes authorized by R0 itself:** none

R0 is closed. Its seven decisions are now the architecture contract for the first Games implementation stage. Changing any accepted R0 decision requires an explicit architecture amendment and updated traceability.

## Accepted decisions

### GP-R0-001 — Gaming identity
Authority: `R0_001_GAMING_IDENTITY.md`.

Games uses stable platform-owned `game_player_id` resolved from verified ASA identity sources. Raw principals and school-scoped learner identities are not global gaming ids.

### GP-R0-002 — Security/storage domain
Authority: `R0_002_GAMES_SECURITY_DOMAIN.md`.

Cross-workspace Games data is platform-scoped, initially in the existing PostgreSQL behind a dedicated Games repository/schema boundary and FORCE RLS. A match is never assigned to one participant's tenant for convenience.

### GP-R0-003 — Canonical Match
Authority: `R0_003_CANONICAL_MATCH_MODEL.md`.

Match uses independent `admission_kind`, `competition_kind`, `scope_kind`, `runtime_kind` and `topology`. Game-specific board/world state stays game-owned.

### GP-R0-004 — Lifecycle/finalization
Authorities: `R0_004_MATCH_STATE_MACHINE.md`, `R0_004_TERMINATION_FINALIZATION.md`.

Canonical lifecycle is `waiting -> ready -> active -> finishing -> finished` with terminal `cancelled` and `aborted`. Lifecycle/result authority is server-owned. Terminal result plus required outbox is durable/retryable before `finished` is trusted.

### GP-R0-005 — Teams/outcomes
Authority: `R0_005_TEAMS_AND_OUTCOMES.md`.

`teams`/`coop` use match-scoped first-class teams. `duel`/FFA use no synthetic team rows. Team and participant outcomes have separate sources of truth.

### GP-R0-006 — Capabilities
Authority: `R0_006_MINIMUM_CAPABILITIES.md`.

R1-R4 capability vocabulary is limited to invite, matchmaking, rated competition, reconnect, own history and public-safe profile projection. Support, policy grant, eligibility and admission state remain separate.

### GP-R0-007 — Error/idempotency
Authorities: `R0_007_ERROR_IDEMPOTENCY.md`, `R0_007_ERROR_CATALOG_LIMITS.md`.

Externally initiated mutations use actor-scoped command ids, canonical fingerprints and optimistic `expectedVersion`. Applied state/events/receipt/required outbox share one durable boundary. Games APIs use one typed error envelope and bounded payload/page/rate limits.

## Cross-stage engineering hygiene

`ENGINEERING_HYGIENE.md` remains normative for Games implementation.

R1 must not add new responsibilities to hard-threshold Checkers files. Every bounded implementation slice performs changed-file hygiene; mini-audit cadence and stage-exit audits remain mandatory.

## R0 exit gate — PASSED

Evidence is canonical in `R0_TRACEABILITY.yaml`, which must show:

```text
status: accepted
accepted_count: 7
required_count: 7
```

No shared Games implementation may reinterpret R0 silently.

## Next permitted action

R0 acceptance does **not** directly authorize arbitrary coding.

The next bounded task is:

1. create and accept `R1_DELIVERY_BRIEF.md`;
2. activate an explicit R1 implementation task/lane;
3. implement only the minimum Games Core needed for the R1 user result: private online Checkers between two real authenticated users;
4. obey Engineering Hygiene and R1 acceptance evidence.

R1 is not allowed to pull in Quick Match, rating, Chess convergence, Arena, Creator, Redis/Kafka/Kubernetes or unrelated cleanup.
