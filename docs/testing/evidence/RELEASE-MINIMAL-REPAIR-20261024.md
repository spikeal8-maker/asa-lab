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

- Only `analytics_start_module_session` maps its three explicit SQLSTATE 42501
  policy messages (actor denied, context denied, identifier collision), and
  `analytics_touch_module_session` maps its two corresponding messages (session
  denied, project denied), to a
  typed context denial. Other permission failures, timeouts and connection
  failures remain unavailable; no general SQLSTATE 42501 catch is introduced.
- The V1 start/touch controller returns its established `accepted:false` result only
  after the bounded analytics queue has rejected that typed operation. It cannot
  increase the durable-write counter. V2 mappings, session checks, SQL access
  rules, analytics pool separation and queue capacity remain unchanged.
- The two lock probes now use an anchored whitespace-tolerant SQL regex. Their
  user/Lock predicates, polling bounds, transaction ordering and rejection/data
  assertions are unchanged. No project-write product code changes.

## Verification

The initial local focused run passed all **21 tests** in the existing analytics admission
and queue suites. New cases prove expected non-acceptance, zero persisted events,
one queue rejection, unchanged real-failure 503 responses, operation isolation
and V2 context-denial behaviour.

Focused CI `40037006976` passed all 45 course tests and the main Scratch-time
scenario, then exposed the next existing refusal assertion: a foreign session
heartbeat also needs its established `accepted:false` response. The same bounded
classification now covers both documented heartbeat policy refusals, including
the later trashed-project assertion. It does not relax those access checks or
change any expected PostgreSQL test responses. Additional unit cases keep real
heartbeat delivery failures at 503 and denied operations out of persistence.
One focused local run of the expanded admission suite passed all **19 tests**;
the unchanged queue suite was not repeated locally during this repair.

The manual `release-repair` profile in the existing capacity workflow builds the
API and runs those suites, then migrates its own disposable `*_test` PostgreSQL
database and runs exactly `classroom-scratch-time.pg.spec.ts` and
`activity-participations.pg.spec.ts`. Final exact-SHA CI and release evidence are
required before production deployment; this author slice does not update any
running installation.

### Final focused acceptance

[Actions run 40037441654](https://github.com/spikeal8-maker/asa-lab/actions/runs/40037441654)
finished **SUCCESS** on exact source
`de919261d75afce9626dc139cf889c7abae6580d`:

- API build passed.
- **28 unit tests** passed: 19 analytics admission/isolation tests and nine queue
  tests, including expected refusals remaining rejected rather than persisted.
- **47 PostgreSQL tests** passed: all 45 activity-participation tests and both
  Scratch classroom-time tests. Existing foreign-session, closed-session replay,
  module-mismatch, trashed-project, mixed-cookie and activity assertions remain.

The first focused attempt had passed 46 of these 47 PostgreSQL tests; the final
repair classified the remaining heartbeat denials without weakening assertions.
Authentication, V2 response mappings and SQL access policies were not changed.

This report update is documentation only. Full general CI, portable-release
verification and the production deployment are still pending; this focused
acceptance does not claim that the installed site has already been updated.
