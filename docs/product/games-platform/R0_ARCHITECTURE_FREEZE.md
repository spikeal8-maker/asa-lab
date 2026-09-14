# ASA Games Platform — R0 Architecture Freeze

**Status:** active R0 contract  
**Rule:** no shared Games schema/API implementation before all seven R0 decisions are accepted.

## GP-R0-001 — Gaming identity — ACCEPTED

Authority: `R0_001_GAMING_IDENTITY.md`.

ASA Games uses a stable platform-owned `game_player_id` resolved from verified ASA Account/StudentSeat identity sources. Raw `principals.id` and school-scoped `learner_identity.id` are not public/global gaming keys. Verified account/seat convergence uses explicit canonical aliasing; same-name users never merge automatically.

## GP-R0-002 — Games security/storage domain — ACCEPTED

Authority: `R0_002_GAMES_SECURITY_DOMAIN.md`.

Global/cross-workspace Games data is platform-scoped rather than owned by one participant tenant. Initial persistence remains in the existing PostgreSQL behind a dedicated Games schema/repository boundary with explicit authorization and FORCE RLS. A supplied player/tenant/match id grants no authority by itself.

## GP-R0-003 — Canonical Match dimensions — ACCEPTED

Authority: `R0_003_CANONICAL_MATCH_MODEL.md`.

Generic Match uses independent:

- `admission_kind`: direct/invite/matchmaking/tournament/event/bot/local;
- `competition_kind`: casual/rated;
- `scope_kind`: private/classroom/workspace/global/event/tournament;
- `runtime_kind`: command/realtime_room;
- `topology`: duel/free_for_all/teams/coop.

Game-specific state remains game-owned. Participant `seatKey` is opaque to Games Core.

## GP-R0-004 — Match state machine — ACCEPTED

Authorities: `R0_004_MATCH_STATE_MACHINE.md` and `R0_004_TERMINATION_FINALIZATION.md`.

Canonical lifecycle is:

`waiting → ready → active → finishing → finished`

with terminal `cancelled` and `aborted`. Lifecycle mutation is server-authoritative. Disconnect, reconnect, draw offer and room-allocation state are not generic Match statuses. `finishing` protects durable finalization/outbox work from result loss.

## GP-R0-005 — First-class teams — ACCEPTED

Authority: `R0_005_TEAMS_AND_OUTCOMES.md`.

`teams` and `coop` use first-class match-scoped team rows. `duel` and `free_for_all` use zero team rows. `seatKey` and team membership are independent. Team competition stores team outcome once; participant outcome must not become a second mutable copy of the same team result. Checkers/Chess remain duel with no synthetic teams.

## GP-R0-006 — Minimum capability vocabulary — ACCEPTED

Authority: `R0_006_MINIMUM_CAPABILITIES.md`.

R1–R4 capability keys are limited to:

- `admission.invite`;
- `admission.matchmaking`;
- `competition.rated`;
- `session.reconnect`;
- `history.read_self`;
- `profile.public_projection`.

Game support, ASA policy grant, server eligibility and game admission state are separate layers. Capabilities are never client-authoritative or self-granted by a game. Creator/device/network/sandbox permissions are deferred to R7+.

## GP-R0-007 — Error and idempotency contract — OPEN

Before R1 define:

- one mutation idempotency convention;
- `commandId` + request fingerprint behavior;
- optimistic `expectedVersion` semantics;
- machine-readable errors at least `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`, `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `MATCH_FINISHED`, `INVITE_EXPIRED`, `RATE_LIMITED`;
- baseline payload/rate/page-size limits.

Retry after a lost response must never create a second domain effect.

## Cross-stage engineering hygiene guard

`ENGINEERING_HYGIENE.md` is normative for Games implementation from R1 onward and for Games documentation sizing during R0. It is a quality/process contract, not an eighth R0 architecture decision.

R1 online Checkers must not add new responsibility to hard-threshold legacy files such as `CheckersModuleExperience.tsx` or `checkers.css`; extract only the seam required by the active value slice.

Hygiene runs:
- changed-file check on each bounded slice;
- mini-audit after three implementation slices or 14 days;
- full scoped audit at every R-stage close;
- structural audits before R4, R6 and R7.

## R0 exit gate

R0 closes only when all seven IDs have:

1. explicit decision;
2. current-main evidence;
3. positive and negative examples;
4. Checkers/Chess compatibility consequence;
5. review verdict.

Only after GP-R0-007 is accepted may the team create the R1 Delivery Brief and shared Games SQL/API implementation.

R1 target remains one completed private online Checkers match between two authenticated users with reconnect and history. Quick Match, rating, Chess convergence and realtime remain later stages.
