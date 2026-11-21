# Bounded retained-history audit — 2026-10-25

TASK: fresh collector publication / OBS-011 contract amendment, one bounded slice.
STATUS: implementation candidate; independent exact-SHA review pending.
BASELINE: ab441289db5e844cb0aa30fd8a00f8566abcb15d.
ISSUE: existing observability repair programme; no new issue or acceptance claim.

## Change and evidence

Repeated publication previously rehashed every retained file and reread every
private sequence/identity mapping. Publication now checks structural ownership,
sequence high-water mark, referenced files, orphan ownership and published-row
coverage continuously, and audits older bytes/mappings incrementally. SQLite
triggers record changed identity/sequence ranges, including inserted and deleted
rows; these ranges bypass the audit budget. New immutable output is reread and
checked against its digest and private mapping before catalog publication.

Startup, external index changes/replacement, legacy upgrade, explicit import and
unfinished compaction recovery retain full verification. Compaction originals,
overlap prefixes, conversion originals, retention/eviction candidates and deletion
bytes receive immediate checks before their mutation. Immutable collision handling
and resource spool ACK ordering after atomic catalog replacement remain intact.
Read workers retain their existing CRC/SHA checks.

Audit generations retain a cursor, boundary, checked/remaining counts, last timely
completion, deadline and breach evidence in existing state/catalog/health. Each
publication selects at most 2048 old segments / 128 MiB / five seconds of work,
stopping between segments; one selected segment can exceed the remaining byte or
time budget. Mandatory new/changed/affected verification bypasses this budget.
For the reported 23686-file / 1.25 GB compressed archive, file/byte limits alone
need about twelve passes, or twelve minutes at one publication per minute. This
is scheduling arithmetic, not a live measurement or a guaranteed deadline on slow
storage. An overdue audit reports integrity coverage incomplete through the
existing error health state and admin status API. Finishing an overdue pass does
not erase its breach: a subsequent timely full pass must restore complete state.

## Focused validation

- `python tools/test_collect_logs.py`: 66 tests, PASS, 2 environment-dependent
  actual-database tests skipped, 26.488 seconds. Includes temporary-history audit
  progress/fresh publication, same-size corruption, terminal audit failure,
  overdue completion, new-output corruption, index rollback, compaction and
  immutable collision regressions.
- Strengthened bounded-open assertion rerun: one focused test PASS; each
  two-segment audit slice opens exactly two old immutable files while adding
  fresh records.
- `corepack pnpm exec vitest run apps/api/src/admin-logs.worker.spec.ts
  apps/api/src/admin-logs.service.spec.ts`: 35 tests PASS, 33.06 seconds. Includes
  read-time corruption rejection and fresh-health/overdue-audit status handling.
- Focused final conversion/compaction plus resource crash-replay, verification
  cache and physical-quota ACK/disposition checks: six tests PASS, 9.560 seconds.
  Final repeated-publication-after-quota-VACUUM regression: one test PASS,
  2.680 seconds; collector-owned VACUUM updates its expected SQLite schema cookie.
- Formatting and `git diff --check`: PASS. All checks executed directly; no Nx
  cache evidence, local production build, live archive benchmark or browser run.

## Remaining limits and scope

This reduces repeated history verification, but does **not** prove a guaranteed
60-second publication bound or a guaranteed 15-minute audit on the real archive.
The hard physical storage cap is preserved: eviction-triggered VACUUM and physical
quota enforcement can still block publication. Only unconditional daily VACUUM
was removed. Full startup/recovery/import checks are intentionally unbounded by
the incremental audit budget. These are explicit residual freshness blockers,
not permission to weaken disk limits or silently discard records.

Review repair: already-retired legacy files without retained checksum metadata
must be resolved before successful publication. The collector may recover a
reference from its already-verified in-memory metadata, or authenticate the saved
HMAC receipt against actual compressed bytes, saved metadata and the original
sequence/identity mapping. The latter can reconstruct only contiguous ranges:
authenticated record count must equal filename range width. Gapped mappings are
never guessed. Missing/forged receipts, corruption or unreconstructible mappings
stop publication with an explicit diagnostic-snapshot recovery error; files and
catalog remain preserved and normal error health applies. Existing bytes alone
never establish a new checksum reference. Successful recovery permits the normal
reader-grace deletion, avoiding permanent hidden retired-file debt. New
retirements continue to persist their checksum metadata.

The bounded review-repair run executed five affected test methods (12.443 seconds,
PASS): authentic contiguous receipt recovery for JSONL and gzip; fail-closed
missing/forged/corrupt/gapped cases; retirement grace; interrupted compaction;
physical quota and its next publication. No live receipt was read or migrated.
Whether the four reported live legacy retirements qualify for receipt recovery
remains unverified; failed authentication requires operator recovery and is a
rollout blocker, rather than permission to publish with hidden storage debt.

DEPLOYMENT: not run. DATABASE_ACTIONS: temporary diagnostic SQLite fixtures only;
no application DB or live installation changed. PORTS/DEMO_URLS/SCREENSHOTS: none.
USER_FLOW: existing admin status reports incomplete audit as an error; no frontend
redesign. MAP_NODES_CHANGED: none. CI: not claimed for this unpushed candidate.
COMMIT_SHA / WORKING_TREE: supplied in the final author handoff.
NEXT_ALLOWED_TASK: independent exact-SHA review by the controller; author STOP.
