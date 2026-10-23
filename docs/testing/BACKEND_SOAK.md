# Isolated gradual backend soak

Manual GitHub Actions profile `backend-soak` in Classroom Capacity Baseline runs
only against that job's loopback PostgreSQL database `asa_capacity_test`, MinIO,
and API on 127.0.0.1:4612. It does not use the working installation, production
credentials, public site, local Docker, or a persistent Compose project.

The fixed profile is 30, 60, then 100 independent synthetic identities, each stage
lasting ten minutes. Half are Accounts, half StudentSeats; approximately half use
Scratch storage, half electronics. All 100 identities and projects are prepared
before measurement; this is not a login burst capacity test. Inactive identities
do not send requests. Account sessions last 12 hours; active StudentSeats are
checked at least every minute. Scratch capabilities are renewed every minute.

Every identity has one fixed scheduled save/read chain every ten seconds, with
staggered arrivals: 3, 6, then 10 offered save chains/second. This is diagnostic
stress, not the product's 60-second autosave cadence. There is no simultaneous
mutation of one project. Every successful save must return the next revision,
and its document and revision are immediately read back and verified. An identity
probe and, for Scratch, capability renewal occur every six chains.

The offered schedule does not wait for previous responses. Busy identities and
arrivals delayed by more than one second are recorded as missed work, never
silently retried. The report includes planned/offered/launched/completed/failed
chains, busy/late drops, scheduler lag, all response statuses and durations,
per-identity completion bounds, save ACK/readback counts, and resource samples.

Fixture-only instrumentation wraps the actual main and analytics pools. It
measures checkout latency (including new-connection establishment), successful
client hold time, failed borrows, and unreleased clients separately. It covers
promise/callback `connect` and `pool.query`'s internal callback borrowing; a short
real-PostgreSQL check verifies these before the soak. It is not deployed to API.
One separate read-only observer samples pool queues, PostgreSQL blocked/lock
waiters and connections each second, process RSS and host free memory. API and
scheduler share a Node process; event-loop delay and offered-load completeness
are reported so generator overload cannot masquerade as full delivery.

Promotion requires the complete offered load, every identity completing chains,
all ACKs verified, no unexpected errors, no failed observations/borrows, save
p95 <=700 ms and read p95 <=400 ms. Checkout p95 <=100 ms is an **additional
diagnostic guard**, not an established product SLO. More than 1% arrivals delayed
over100 ms also prevents promotion. A stage with a latency/diagnostic gate failure
finishes its ten minutes and then stops; HTTP/auth/timeout/correctness failure,
observer failure, or resource pressure (host free <5% or process RSS >60% host
RAM) stops offering work immediately. No automatic rerun or pool tuning occurs.

`reports/capacity/backend-soak.json` is atomically checkpointed every30 seconds,
at stage boundaries and in `finally`, and uploaded even after failure. It holds
only aggregates and numeric timings, no cookies, identity IDs, passwords, codes,
project content or runtime capabilities. A hard runner termination can preserve
only the last checkpoint. `RUNNING`/incomplete stages are not passing evidence.

This measures backend behavior on one GitHub runner with tiny documents and one
tiny Scratch asset. It excludes browser Scratch VM/rendering, realistic media
sizes, 3D/games, Caddy/FRP, multi-school NAT, restarts and dependency faults. It
does not establish production capacity or readiness for 3000–5000 users.
