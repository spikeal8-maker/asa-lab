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

## Accepted bounded source evidence

Final candidate03c1d971c3fdf1d6b5e8699a777db0aa3d636231; independent exact
Code/Security challenge PASS. Compared with68cae0de: product, migration, contracts
and gate code byte-for-byte unchanged; only a migration-test expected digest was
corrected to canonical LF SHA256
ed604dbc0034caac069c261457bfb699f5e1c8cd06b1b20d7c7910af4b96718b.
All57 pinned migration inputs independently checked locally with LF normalization.

- Public Projects41328242753 SUCCESS on unchanged product68cae0de: actual restricted
  PostgreSQL/HTTP, populated286→287 upgrade, creator/upgrade gates and complete real
  publication browser suite. Account/Seat3D and Electronics journeys assert0→1 API
  and visible catalog count; idempotent concurrent replay stays1. Raw receipts
  inaccessible; rollback/private visibility and trash/purge retention qualified.
- General41330048265 on exact03c1d971: Governance contracts, Format/lint/types/
  contracts/build, and PostgreSQL tests/RLS jobs SUCCESS. These cover repository
  governance/code/data gates including the corrected four shared-prefix tests.
  Access A main journey steps SUCCESS; additional account-settings synthetic UI
  stage was still running at source integration. It is NOT recorded as PASS and
  the overall workflow is NOT called successful or a release-ready candidate here.
- General's previous Data run8905PASS4FAIL was solely the new test pin using raw
  Windows CRLF digest; final Data SUCCESS supersedes it. Publication's initial
  test-only filename variable and synthetic purge ordering failures likewise have
  exact final successful focused evidence; no assertion/timeout weakened.
- Actual complete-app screenshots inspected: ci-artifact/e2e/artifacts/
  public-projects-copy/390-counted-catalog.png and electronics-counted-catalog.png
  under F:/Asa-Lab/operations/reports/publication-copy-count-20261101/.
  Both display1 after actual successful canonical copy. Explicit synthetic3copy/
  7like isolated card fixture is separately labelled, with four-width geometry
  PASS. It is never claimed to be production usage.
- Remote Main moves during verification affected documentation only. Integration
  preserves those edits and verifies no product/migration delta against the
  accepted focused source. No repeated unaffected browser run for a test digest.

Selected bounded counter implementation accepted as source. Owner visual acceptance
remains pending. No deployment, live migration, live backup/upload or full-system
capacity claim. Additional overall CI completion/release remains separate.
