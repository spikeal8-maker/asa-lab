# Publication likes fixture isolation

This is a test-runner correction, not a registration-capacity change or browser PASS.

## Observed failure

Publications run `41364498156`, source `6bae06e9c5dcdf271e516fea58126d02e597a68b`,
failed the Seat390 likes case during its real Account registration setup.
Artifact `13107565300` was downloaded once; ZIP SHA256:
`544a4a366b94a518d1df1036c3f219eaf23c751512b8943ca15ef1469653cb5d`.
The retained Seat trace records POST `/api/auth/register` at
`2026-11-02T00:06:46.042Z`: HTTP429, JSON code `too_many_requests`, Retry-After88,
request ID `a1d7188b-8770-4611-b4f3-bf6c3073afe5`.
No request bodies, cookies or response credentials are copied into this document.

This code identifies the generic mutation guard in `app.factory.ts`:
the registration-specific controller instead emits `too_many_attempts`.
The generic guard counts all mutations for the source address, including the
earlier scenarios' requests. Its anonymous budget is900/5min; verified sessions
also have600/session and the independent9000 shared-address ceiling. The original
ten browser suites shared one API process/IP. A new anonymous registration cannot
use an earlier user's verified session when the shared anonymous budget is spent.
The artifact contains no isolated API log, and the cached job log has no matching
request ID: the exact internal counter/blocked-budget value was not observed.
The trace and source establish generic admission failure, not signup-controller
failure or a defect in100 simultaneous legitimate classroom admissions.

## Bounded correction

The first two-partition candidate was insufficient. In the controller's composed
`a69` run `41368028089`, job `125032280772`,24 core cases passed but all four
Electronics-player cases failed at the real `authorStorageState` login
(`organization-login.ts:40`, expected200, received429). The shared core lifecycle
still consumed the generic budget; fail-closed execution never reached likes.
That failure is retained, not called successful qualification.

The runner now executes each of the same ten unchanged spec files in its own
sequential Playwright invocation. Each uses the existing owned
`e2e/server.mjs`, `reuseExistingServer:false`, isolated `_test` PostgreSQL and the
same immutable built application. External-server mode is refused. The first
child must exit successfully before the next starts; failure is not retried.
Ten distinct spec-named output directories retain every invocation's evidence.
No process reset occurs within a spec file or an individual scenario.

All browser test files are unchanged, including Account signup201, real Seat
join200, ownership, reactions, moderation and privacy assertions. Production
limits, proof policy, origins, clocks, database state and timeout budgets are
unchanged. This does not establish anonymous signup capacity; dedicated auth
qualification remains separate. The100-pupil acceptance fixture uses its own
bounded QA-account provisioning and protected Seat sessions, not100 registrations.

Local checks exercise suite completeness, synchronous child completion, failure
propagation, no retries, separate evidence paths and owned-server prerequisites.
Actual PostgreSQL and all browser scenarios remain pending exact-SHA CI.
No local Docker, live database, server or production call was used.
