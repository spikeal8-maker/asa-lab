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
