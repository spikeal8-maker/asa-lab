# Classroom audit point8: coverage and address provenance

Owner selected F06 only: implement, publish main, report and STOP. No deployment,
working database, FRP, backups, layout, engine or point9 load work.

## Acceptance/write budget

- Existing collector: independent bounded60s sampler, immutable topology snapshot,
  bounded sample queue, main-thread-only SQLite/catalog, missed/overflow/late
  quality and bounded shutdown. Windows/Linux and --once preserved. No second
  collector/store/runner. Resource commands retain time/output limits.
- PostgreSQL: aggregate waits/blocking/long transactions/counters only. Lock-wait
  logging defaults without statement/bind/context/duration text. Isolated actual
  configuration/lock/canary tests, no live configuration application.
- API: exactly one safe terminal outcome per observed start, distinguishing
  response from disconnected delivery. No per-request timer, query/body/header
  payload, invented success/crash or product behavior change.
- Shared closed DB projection: actual visit/auth/audit names and finite metadata,
  unknown arbitrary fields remain omitted. Old immutable log IDs/bytes/cursors
  preserved; missing historical fields not retroactively fabricated.
- IP: finite resolved/unresolved source/reason in existing diagnostic logs,
  additive DB trigger corrects future null-IP provenance. Existing trust/abuse
  semantics retained. NAT/proxy-only chain stays unknown, never trusts arbitrary
  forwarded headers. Admin Logs exposes the JSON evidence; no UI markup change.

Scope includes focused tests/CI, package scripts, compose PostgreSQL defaults and
operator docs for these boundaries. Use inexpensive focused checks, uncached API
build and isolated exact-SHA data evidence; no unchanged broad reruns. HIGH
independent final-source review required. Full release/owner acceptance separate.
No5000-user or historical root cause claim. NEXT_ALLOWED_TASK: STOP after point8.

## Author evidence / self-review

L3 privacy/trust/configuration boundary, layout impact none. Public routes, auth,
RLS, session/Seat lifetime, grants, ingest signatures/receipt identities and
proxy trust are unchanged. Aborted delivery never claims rollback, HTTP499,
success or crash; listeners settle once and detach, metrics use aborted bucket.
Sampler captures on one producer with frozen verified container targets and
bounded command output/time; only consumer touches SQLite, segments or cursor.
Queue/missed/late quality explicit, unique stream+sequence survives wall-clock
repeats, shutdown bounded. NoSQL/parameter/PID/visitor content in new metrics.
Metadata includes only current finite event/environment/provenance vocabulary;
no raw IP/UA/name/payload. Null-IP trigger changes future metadata only, not
history or authority. Existing collector privacy, query/export and lifecycle
regressions pass with new packaging dependency. Local focused:160 PASS,4 platform
SKIPPED; API16 tasks uncached PASS. Lint/typecheck/format/control-plane checked.
Isolated real PostgreSQL settings/lock/canary, ingest denial/idempotency and actual
HTTP disconnect evidence remain pending CI. Independent final SHA HIGH review
required; issue610/owner report records actual conclusions. No site update.
