# Issue #618 admission foundation — integration boundary

This candidate implements policy storage, a pure evaluator and an **unregistered**
controller. It is not end-to-end admission enforcement, a runnable Seat Games UI,
a deployed migration, or owner acceptance. Existing project and UI authorization
has not been changed. Do not expose this as a completed feature.

## Implemented contract

- Offline `chess` and `checkers` only. SafeMode remains independent; this grants
  no online, multiplayer, public competition or chat permission.
- Missing policy is `allow`, version `0`; missing Seat override is `inherit`.
- Priority: exact active session/credential/tenant/class/principal/learner link;
  then soft-revoked policy; then Seat deny/allow; then inherited class rule.
  Explicit Seat allow bypasses class deny/threshold but never inactivity or revoke.
- Threshold uses the exact Seat item from existing
  `classroom_participant_metrics(classroomId).item.score`, using its current
  factors/period. That canonical function already rounds to two decimals
  internally; admission adds no rounding and does not reconstruct a second score.
  Equality permits; absent/non-finite score denies. No mean or Elo substitution.
- DB teacher authority uses the actual `classroom_journal_teacher` plus
  `classroom_teacher_access` predicates, with explicit tenant and active class.
  There is no `classroom_teacher_can_manage` symbol in the inspected schema.
- All writes, including Seat overrides, serialize on the existing class row,
  advance the same class version, and append before/after audit events. Stale
  versions return `version_conflict`; HTTP maps that to 409. DELETE soft-revokes
  class policy; PUT reactivates. Seat DELETE writes `inherit`. Nothing is erased.
- New tables force RLS and deny runtime direct access. Functions pin search_path,
  qualify relations, revoke PUBLIC execution and expose only read/write/snapshot
  entry points to `asalab_app`. The private authority helper is not granted.

## Unregistered HTTP contract

`GamesAccessController` uses existing DI tokens only. It is intentionally absent
from `app.module.ts`.

| Method | Path under `/api/games` | Input |
| --- | --- | --- |
| GET | `/access?game=chess` or `checkers` | No client actor/class/Seat/project selector |
| GET | `/classrooms/:id/policy` | Teacher session |
| PUT | `/classrooms/:id/policy` | `{mode, threshold, expectedVersion}` |
| DELETE | `/classrooms/:id/policy` | `{expectedVersion}` |
| GET | `/classrooms/:id/seats/:seatId` | Teacher session |
| PUT | `/classrooms/:id/seats/:seatId` | `{override, expectedVersion}` |
| DELETE | `/classrooms/:id/seats/:seatId` | `{expectedVersion}` |

Learner response is exactly `{granted, reason, threshold}` with private/no-store.
No identity IDs, roster, rating or rank escape. Student cookie **presence** selects
Seat even with an Account cookie. Invalid/empty/revoked Seat never falls back to
Account. Teacher routes reject a simultaneous Seat cookie to prevent silently
using personal Account authority in a selected Seat context. An Account-only
session retains its existing offline entitlement and project/module ACL checks.
The learner snapshot function independently rechecks session revocation,
expiry/idle timeout and current credential version after resolution.

## Required shared handoffs — blockers, not work authorized by this candidate

1. **Projects lane:** `apps/api/src/projects.controller.ts` currently resolves
   Account first when both cookies exist. Select a consistent trusted context,
   then re-evaluate the same admission on list, create (including idempotent
   replay), direct open, edit, save, duplicate/restore where applicable. Preserve
   project ownership/history and assigned-work ACL. A stale client allow or
   version cannot authorize a later operation. `currentSeatGamesAccess` is a
   reusable read helper, not a transaction-level project guard by itself: the
   owning lane must review policy-revocation/mutation races as well.
2. **Learning/composition lane:** register the controller in `app.module.ts` only
   after the server guards are accepted. Verify existing global Origin/CSRF and
   session middleware on these routes. Add teacher settings controls through
   the separately owned classroom pages; do not infer teacher rights from UI.
3. **Selected context:** linked Account entry into a selected Seat without a
   Student cookie has no safe explicit selector in this bounded seam. Do not
   guess a Seat from account membership, name or a client ID. Account-only play
   remains Account context. The identity/App owning lane must define and verify
   a trusted selected-Seat contract before claiming that path.
4. **Games/App UI:** `App.tsx` does not pass selected context into GamesPage;
   current `open-game.ts` directly lists/creates personal projects. Those paths
   are not admission-guarded by this foundation. Do not connect the endpoint or
   present Seat Games as runnable until the project/context handoffs above are
   accepted. Then use the existing authenticated `api-call` transport through
   `game-access-api.ts`, fail closed on missing/error policy, render locked,
   loading, retry and learning/class return, and recheck before personal
   list/create. Module availability is not admission. The existing
   `open-game.spec.ts` also needs explicit test-path handoff for new entitlement
   fixtures; it is outside this writer's allowed paths.
5. **Evidence:** actual isolated CI PostgreSQL/runtime-role/concurrent-write test,
   full project bypass/revocation/assignment tests, browser teacher/Seat/Account
   journeys at 1440/1024/390/320, and exact-final-SHA independent L3 review.
   Embedded PostgreSQL and mocked-session HTTP tests do not replace these.

The opt-in PostgreSQL suite runs only with `CI=true` and both matching isolated
`*_test` URLs. It creates its own uniquely named `_test` database, applies the
real migration plan, verifies `current_user=asalab_app`, and removes only that
generated database. Local embedded tests use PGlite entirely in memory, without
sockets, Docker, persistent data or local database URLs. No local school SQL,
Docker, ports, backup, restore, deployment or shared files are part of this slice.

## Focused commands

After building workspace dependencies, run:

```text
pnpm test tests/games-admission apps/api/src/games-access.spec.ts apps/api/src/games-access.controller.spec.ts
pnpm test:games
NX_SKIP_NX_CACHE=true pnpm nx build api --skip-nx-cache
pnpm gate:governance
```

The PostgreSQL suite is explicitly skipped without its isolated CI environment.
`pnpm gate:repository` and `pnpm e2e:games` remain separate evidence; the existing
Games tests alone do not demonstrate admission enforcement.
