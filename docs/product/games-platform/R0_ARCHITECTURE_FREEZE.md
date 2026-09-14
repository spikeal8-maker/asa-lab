# ASA Games Platform — R0 Architecture Freeze

**Status:** proposed R0 contract  
**Baseline evidence:** `R0_CURRENT_STATE_AUDIT.md`  
**Rule:** no shared Games schema/API implementation before all seven items below are accepted.

## GP-R0-001 — Gaming identity

Decide the stable **gaming subject** that resolves from existing ASA authentication without adding a second login/session system.

The decision must cover Account principal, StudentSeat principal, Account-owned classroom seat, class/workspace changes, linking/merge, suspend/delete/anonymize and a public-safe player DTO.

Hard constraint: do not equate a human gaming identity with raw `principals.id`; current ASA can represent one human through account and seat principals. Do not use school-scoped `learner_identity.id` as a silent global key.

## GP-R0-002 — Games security/storage domain

Decide where private/global cross-workspace `GamePlayerProfile`, `GameMatch`, matchmaking tickets, ratings and rating events live and how authorization works.

Hard constraint: a cross-workspace match is not assigned to one participant's tenant by convenience. Existing tenant/RLS discipline remains defense-in-depth; any platform-global Games tables require an explicit authorization model and negative tests.

## GP-R0-003 — Canonical Match dimensions

Use independent dimensions, not one overloaded `mode`:

- `admission_kind`: direct/invite/matchmaking/tournament/event/bot/local;
- `competition_kind`: casual/rated;
- `scope_kind`: private/classroom/workspace/global/event/tournament;
- `runtime_kind`: command/realtime_room;
- `topology`: duel/free_for_all/teams/coop.

Game-specific state remains outside generic Match metadata.

## GP-R0-004 — Match state machine

Define allowed transitions and authority for:

`waiting → allocating/ready/active → finishing → finished`, plus `cancelled` and `aborted`.

Define termination reasons separately, including normal/rules outcome/resignation/draw/timeout/forfeit/disconnect/no-show/admin-abort/runtime-lost.

Invalid transitions must be machine-rejectable.

## GP-R0-005 — Teams first-class

Canonical persistence must represent a team independently from participants for team topology. Duel/FFA matches may have zero team rows.

A later Arena 2v2 must not require redesigning Match identity/outcome storage.

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

`ENGINEERING_HYGIENE.md` is normative for Games implementation from R1 onward and for Games documentation sizing during R0. It is a quality/process contract, **not an eighth R0 architecture decision**.

Before the R1 Delivery Brief is accepted, record the initial Games hotspot baseline. R1 online Checkers must not add a new responsibility to hard-threshold legacy files such as `CheckersModuleExperience.tsx` or `checkers.css`; extract only the seam needed for the R1 user journey when those surfaces must change.

Every later stage follows the audit cadence and garbage policy in that contract. Hygiene findings may create bounded optimization work only under its explicit cost/risk rules; they do not authorize unrelated cleanup.

## R0 exit gate

R0 closes only when **all seven** IDs have:

1. explicit decision;
2. current-main evidence;
3. positive and negative examples;
4. compatibility consequence for Checkers/Chess;
5. review verdict.

Then, and only then, create the R1 Delivery Brief and implementation lane. R1 target is one completed private online Checkers match between two real accounts/sessions; rating, Quick Match, Chess convergence and realtime remain later stages.
