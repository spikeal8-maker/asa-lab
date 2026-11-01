# Successful publication-copy count — 2026-11-01

Owner asks for the missing download counter. Per prior owner terminology this means
Add to my projects, not physical file export. One successful created destination
counts once; unique users are not claimed. Viewing, failed requests, replay of an
idempotency key and rolled-back transactions do not count. Existing class/author/
platform permissions and immutable source admission remain authoritative.

0287 creates minimal private copy-event receipts (destination id, publication id,
creation time), no actor/profile fields. Insert trigger in the existing Project
transaction records only newly inserted copies; exact lineage is validated against
the immutable publication revision. No second project writer/increment endpoint.
Migration locks projects across validated historical backfill and trigger creation
so concurrent inserts cannot fall into a gap. RLS enabled+forced, no direct runtime
or PUBLIC table/function-write access; aggregate uses same readability guard as
existing likes and returns only count. Index by publication. Events intentionally
have no cascading project FK, preserving totals after trash/permanent deletion.
Only existing provable copies are backfilled; historical already deleted copies
cannot be reconstructed. No fabricated historical totals.

Existing list/detail API adds numeric copyCount; no private event rows exposed.
Catalog shows compact download-arrow/count with «Добавили к себе» tooltip next to
likes. Title stays inside image above statistics. Older API omitting the field
hides this metric instead of fabricating zero. No new downloads capability,
Scratch copying, physical export, profile/avatar access or production update.

Checks: six component tests PASS. API unit suite locally BLOCKED before discovery
by missing generated @asa-lab/module-sdk; no dependency rebuild/relink attempted.
ESLint PASS after removing an unused test binding; existing uncached Nx graph
warning retained. Migration file/metadata check PASS without connecting to a DB.
New real PG/HTTP cases cover actual copy/replay/concurrency, failed fingerprint,
private receipt denial, uncommitted visibility/rollback, trash/delete persistence,
revoked/nonexistent visibility. Populated286→287 isolated forward test checks
backfill, replay and unchanged source/copy rows. Existing browser Account/Seat
copy journeys now verify actual0→1 API and visible catalog count with screenshots.

Independent security/code challenge and exact GitHub PG/browser acceptance pending.
No site/working database change performed. This is not a deployment receipt.
