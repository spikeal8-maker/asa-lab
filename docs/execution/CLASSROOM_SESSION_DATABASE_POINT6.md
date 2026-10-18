# Classroom audit point 6 — Account context database waits

Issue #604. Owner selected this bounded repair only: main, report, STOP.
Risk HIGH: authentication SQL and request diagnostic isolation. No deployment.

## Result and invariants

Remove the unconditional sessions_v2 heartbeat row-lock dependency from Account
context resolution. Preserve current account/workspace/membership/revocation
checks, columns, SECURITY DEFINER and search_path. No identity cache, expiry
extension, StudentSeat idle TTL change or increased pool size/timeouts.

Migration0216 reads current authority, then updates last_seen_at only when at
least60 seconds old with SKIP LOCKED. Heartbeat is approximate management
information, never authorization evidence. Activity analytics stay unchanged.

Measure exactly identity.session.resolve: pool acquisition (including connection
establishment) versus query round-trip, neither SQL CPU time nor historical lock
proof. An optional fixed context query runner preserves pg callback/client-error/
release-once behavior. Request-scoped counters use existing HTTP/server-error
logs; no SQL, parameters, tokens, cookie values or actor IDs. No new pool,
transport, timer, cache or unbounded per-request history.

## Write set and checks

- New migration0216; PgSessionV2Store optional query runner and export.
- API session-database-diagnostics helper; app.module, app.factory and existing
  server-error logs: request scope/phase counters only.
- Helper/store/request tests; isolated session-context-contention PostgreSQL
  test and scoped CI; package scripts, Identity Surface Map and execution state.

Unit checks: phase failures/durations, overlapping requests and real Fastify
propagation, client-error versus callback, one release, privacy and outcome
preservation. Isolated PostgreSQL compares the actual prior function blocked by
a held heartbeat row against the new function, due/repeated heartbeat and
expired/revoked/disabled authority. No working database operations/local stack.
Short unit/lint/uncached API build, independent read-only HIGH review and exact
PostgreSQL CI. Other historical waits and5000-user capacity remain unproven.
Layout impact none. NEXT_ALLOWED_TASK: STOP after point6 report.

## Self-review and author evidence

L3_CRITICAL / POST_STEP_REVIEW / CHALLENGE_REVIEW: same live authority joins,
expiry, signature, SECURITY DEFINER and fixed search_path; no cached actor or
grant. Heartbeat is separate, due60s and SKIP LOCKED. Only management last-seen
precision changes; no Account expiry/Seat TTL/activity analytics change.
Fixed-query runner retains callback/error-listener settlement and one release.
ALS scope propagates through actual overlapping Fastify requests; request-owned
WeakMap projection is detached, bounded and contains no SQL/values/identities.
Existing HTTP/error logs get acquisition/query totals and finite failure phase;
slow/failed HTTP completions also include existing event-loop histogram explicitly
labelled since process start, not instantaneous CPU/SQL execution evidence.

Focused48 tests PASS; changed-source ESLint PASS; API16-task dependency graph
executed uncached and passed. A deliberately broken error-code getter initially
tripped the assertion library, fixed by comparing error identity without invoking
that getter; production observation failure is caught, original error retained.
Final convergence, required independent review and isolated actual PostgreSQL
evidence remain recorded separately in issue604/owner report. No UI/browser,
production DB, deployment or5000-user capacity claim.

## Bounded independent-review repair R1

Review of c74d5711 returned FAIL: promise-form connect yielded before the query
client error listener was installed, unlike pg-pool's original callback handoff.
Repair only this fixed runner: callback-form pool.connect installs the listener
synchronously inside checkout before returning to pg. A regression queues a
client error at handoff and requires original rejection, no escaped error and
exactly one release. Keep SQL, request projection and all other semantics.
Fresh independent final-SHA review follows the bounded repair.
