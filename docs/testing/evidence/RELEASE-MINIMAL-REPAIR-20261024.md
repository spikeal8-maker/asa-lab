# Minimal release repair — 24 October 2026

## Confirmed blockers

General CI run `40034879154` failed two real-PostgreSQL Scratch activity tests.
The database recorded SQLSTATE `42501` with `module session identifier collision`
and `module session context denied` at the same times as their HTTP 503 replies.
Those tests intentionally close/replay a session or supply a mismatching module;
the legacy V1 contract expects HTTP 202 with `accepted:false`. Analytics admission
isolation had allowed those expected policy denials to become generic delivery
failures. This was not a missing analytics database connection.

Two activity-participation lock probes separately matched SQL text with the
literal prefix `WITH updated AS (`. The real prepared-save statement now starts
`WITH  updated AS (`. The database still waited for the intended row lock and
rejected the forbidden write, but the observation probe missed the extra space.

## Bounded change

- Only `analytics_start_module_session` maps the three explicit SQLSTATE 42501
  policy messages (actor denied, context denied, identifier collision) to a
  typed context denial. Other permission failures, timeouts and connection
  failures remain unavailable; no general SQLSTATE 42501 catch is introduced.
- The V1 start controller returns its established `accepted:false` result only
  after the bounded analytics queue has rejected that typed operation. It cannot
  increase the durable-write counter. V2 mappings, session checks, SQL access
  rules, analytics pool separation and queue capacity remain unchanged.
- The two lock probes now use an anchored whitespace-tolerant SQL regex. Their
  user/Lock predicates, polling bounds, transaction ordering and rejection/data
  assertions are unchanged. No project-write product code changes.

## Verification

One local focused run passed all **21 tests** in the existing analytics admission
and queue suites. New cases prove expected non-acceptance, zero persisted events,
one queue rejection, unchanged real-failure 503 responses, operation isolation
and V2 context-denial behaviour.

The manual `release-repair` profile in the existing capacity workflow builds the
API and runs those suites, then migrates its own disposable `*_test` PostgreSQL
database and runs exactly `classroom-scratch-time.pg.spec.ts` and
`activity-participations.pg.spec.ts`. Final exact-SHA CI and release evidence are
required before production deployment; this author slice does not update any
running installation.
