# Classroom audit point 5 — bounded session recovery

Issue #602. Owner selected only this repair, publication to main and STOP.
Risk HIGH: session invalidation, retry and cross-tab trust. No deployment.

## Problem and result

A resource 401 does not establish global logout. StudentSeat has no Account
refresh credential; failed Account refresh must not clear Seat or newer cookies.
The server retains Account-first resolution, rejects Account rotation for a
currently valid Seat, and records finite recovery outcomes without credentials.
The client confirms absence through both existing identity endpoints before
automatic logout and rechecks automatic cross-tab invalidation. Unknown and
transient responses preserve state. Delayed recovery cannot replay a request or
clear caches after a context change. Explicit logout stays explicit.

## Exact scope

- `apps/api/src/auth.controller.ts`, new `auth.controller.spec.ts`: Seat guard,
  non-destructive failure and bounded structured recovery observations.
- `apps/web/src/session-fetch.ts` and its existing spec: confirmed invalidation,
  context fence, single flight and precise stale retry; existing telemetry binding
  is used only as an asynchronous continuity fence, never authentication proof.
- Existing `apps/web/src/analytics-auth-recovery.spec.ts` and
  `tests/account/access-a.pg.spec.ts` only if direct regressions require them.
- Identity Surface Map routing, this card and selected execution child lane.

## Acceptance and review

Meaningful negative and concurrency tests: active Seat with stale Account refresh,
absent/expired/revoked identity, valid Account after resource denial, stale refresh,
503/network/malformed proof, concurrent failures, changed actor and two tabs.
Existing server endpoints decide authentication. No client claimed grant, cookie
reading, new identity store, migration, TTL/permission/RLS/save/CAS change.
Structured logs include only fixed kind/outcome/reason plus requestId and actual
known actor/session kind. Current store merges invalid/expired/revoked refresh;
report that limit rather than guessing a historical cause.

Run focused session/controller/refresh/analytics tests, changed-source lint,
uncached API/web build and bundle budgets. Full browser/PostgreSQL/load evidence
is separate exact-SHA CI. Required independent read-only final SHA challenge;
author tests are not independent review. No DOM/CSS/text changes: layout none.

NEXT_ALLOWED_TASK: STOP after point 5 and the complete owner report.
