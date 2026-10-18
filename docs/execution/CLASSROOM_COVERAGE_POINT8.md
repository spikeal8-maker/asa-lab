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
