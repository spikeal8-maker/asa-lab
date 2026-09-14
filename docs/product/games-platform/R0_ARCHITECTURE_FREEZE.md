# ASA Games Platform — R0 Architecture Freeze

**Status:** proposed R0 contract  
**Baseline evidence:** `R0_CURRENT_STATE_AUDIT.md`  
**Rule:** no shared Games schema/API implementation before all seven items below are accepted.

## GP-R0-001 — Gaming identity — ACCEPTED

Authority: `R0_001_GAMING_IDENTITY.md`.

Games uses platform-owned `game_player_id` resolved from verified ASA identity. Account/StudentSeat remain authentication or scoped-authorization concepts; raw `principals.id` and school-scoped `learner_identity.id` are not global/public gaming keys.

## GP-R0-002 — Games security/storage domain — ACCEPTED

Authority: `R0_002_GAMES_SECURITY_DOMAIN.md`.

Cross-workspace Games data is platform-scoped in the existing PostgreSQL initially, behind a dedicated Games repository/schema boundary and authorization model. A match is not owned by one participant tenant by convenience; runtime roles must not bypass RLS.

## GP-R0-003 — Canonical Match dimensions — ACCEPTED

Authority: `R0_003_CANONICAL_MATCH_MODEL.md`.

Match uses independent dimensions:

- `admission_kind`: direct/invite/matchmaking/tournament/event/bot/local;
- `competition_kind`: casual/rated;
- `scope_kind`: private/classroom/workspace/global/event/tournament;
- `runtime_kind`: command/realtime_room;
- `topology`: duel/free_for_all/teams/coop.

Game-specific state remains game-owned.

## GP-R0-004 — Match state machine — ACCEPTED

Authorities: `R0_004_MATCH_STATE_MACHINE.md`, `R0_004_TERMINATION_FINALIZATION.md`.

Canonical lifecycle is `waiting → ready → active → finishing → finished` with terminal `cancelled` and `aborted` paths. Lifecycle mutation is server-authoritative; disconnect, draw offer, room allocation and presence are not generic match states.

## GP-R0-005 — First-class teams — ACCEPTED

Authority: `R0_005_TEAMS_AND_OUTCOMES.md`.

`teams`/`coop` use first-class match-scoped team rows. Duel/FFA use zero team rows. Participant seat and team membership are separate. Team competitive/objective outcome and participant-specific outcome are separate sources with topology-aware authority; team win/loss is not duplicated as another mutable participant truth.

## GP-R0-006 — Minimum capability vocabulary

Define only capabilities needed through R4. Do not pre-design creator/device/network permission catalogs.

Minimum concepts: private invite, quick matchmaking, rated matchmaking, reconnect/history, public-safe profile/stat projection, game enable/disable admission.

Capabilities are platform policy, not self-granted game declarations.

## GP-R0-007 — Error and idempotency contract

Before R1 define:

- one mutation idempotency convention;
- command `commandId` + fingerprint behavior;
- optimistic `expectedVersion` conflict behavior;
- machine-readable errors at least `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`, `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `MATCH_FINISHED`, `INVITE_EXPIRED`, `RATE_LIMITED`;
- baseline command payload/rate/page-size limits.

Retry after a lost response must never create a second domain effect.

## Cross-stage engineering hygiene guard

`ENGINEERING_HYGIENE.md` is normative for Games implementation from R1 onward and for Games documentation sizing during R0. It is a quality/process contract, not an eighth R0 architecture decision.

R1 online Checkers must not add a new responsibility to hard-threshold legacy files such as `CheckersModuleExperience.tsx` or `checkers.css`; extract only the seam needed for the R1 user journey.

Every later stage follows the audit cadence and garbage policy in that contract. Hygiene findings create bounded optimization work only under explicit cost/risk rules.

## R0 exit gate

R0 closes only when **all seven** IDs have:

1. explicit decision;
2. current-main evidence;
3. positive and negative examples;
4. compatibility consequence for Checkers/Chess;
5. review verdict.

Then, and only then, create the R1 Delivery Brief and implementation lane. R1 target is one completed private online Checkers match between two real accounts/sessions; rating, Quick Match, Chess convergence and realtime remain later stages.
