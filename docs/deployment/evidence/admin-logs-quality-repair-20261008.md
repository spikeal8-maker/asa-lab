# Admin Logs quality repair — 2026-10-08

## Scope and self-review

Owner requested repair of the audited Logs quality and layout defects. This is
one bounded slice; no Portal, Electronics, Scratch product flows or PostgreSQL
schema/data are changed. Change class: L3_CRITICAL (diagnostic format rollout).
The deployment contract and UI layout contract apply.

The repair uses the existing host collector, diagnostic store, permission
`administration.operations.read`, background export jobs and Admin Logs route.
There is no second Compose project, listener, Docker socket mount or public importer.

Changes: stable file identity across rotation; explicit JSON/Pino levels; event
timestamps with a marked file-mtime fallback; native Windows event identifiers;
revision on new HTTP access records; compressed immutable segments; a compact
published-ID index; host telemetry evicted before application diagnostics;
per-source retained ranges; bounded ZIP export with actionable failures; operator
recovery from preserved normalized diagnostic ZIPs. The deployment guide states
the reader capability gate, forward recovery, diagnostic snapshot requirement,
temporary retired-file overlap and disk limits.

Layout changes are confined to `.admin-logs` and its sole consumer,
`AdminLogsPage`: search uses available grid columns, filter actions occupy their
own row, controls are at least 44 px high, archive buttons fit desktop/mobile.
Pending collection is counted separately from inaccessible sources.

## Focused evidence

- Python collector regressions: 18 PASS, including rotation/restart, short-file
  rewrite, failed index verification preserving payloads, atomic import and
  duplicate import, explicit levels/timestamps, actual quota eviction and secrets.
  Challenge review of the initial candidate found an empty-table sequence reset
  and an early retirement clock after crash. Both are repaired with regressions:
  the old high counter is inserted even when the table is empty; grace begins
  only after a cycle observes exclusion from the published catalog.
- Focused Vitest: 29 PASS. Includes negative authorization, job ownership,
  safe failure messages, corrupted/missing compressed files, overlapping ranges,
  and a 19,200-record export exceeding the former 256 MiB raw limit.
- Browser: 10 PASS on 1440/1025/1024/390/320, including long messages,
  153 source states, filter/pagination/export requests, loading, empty, failure
  recovery and unavailable collection. Existing owner screenshots are preserved
  using an explicit external evidence directory.
- Fresh API/Web build and typecheck completed without Nx cache. Formatting
  and focused lint are required again on the committed final candidate.

These commands use fixtures and a diagnostic copy, not authenticated production
administration. Owner production login and archive download are not claimed PASS.

## Real diagnostic copy

A separate snapshot of the live private SQLite index (SQLite backup API), all
catalogued immutable segments, catalog and collector settings was preserved.
The initial slow per-row index rewrite was replaced by a complete compact-table
copy and atomic swap; the failed offline attempt remains separate evidence.

On the protected copy:

- 332,749 current records survived index migration and compression unchanged.
- 140,219 records from the preserved normalized October 7 ZIP were imported;
  repeat import changed neither record count nor IDs.
- Final catalogue/index: 472,968 records; 761 compressed segments.
- Raw JSONL: 447,146,084 bytes; compressed segments: 36,562,112 bytes.
- Active diagnostic storage including private index: 146,181,582 bytes;
  old immutable files retained temporarily: 357,887,952 bytes.
- Real export through a worker limited to 128 MiB completed in 10.37 seconds;
  output: 36,728,383 bytes, 472,968 records for October 1–8 Moscow time.
- Independent Python ZIP validation: all CRCs pass, 472,968 unique IDs,
  manifest count agrees, dates in filter, messages within length bounds.
- Export includes system, Portal, login, Scratch and Electronics records.

Local evidence root:
`E:\Asa-Lab\incoming\admin-logs-repair-20261008T195729Z`.
Original archives and snapshots were not overwritten.

## Release conditions and limits

Required before deployment: independent challenge review of the final SHA,
exact-SHA repository CI and portable release, protected diagnostic snapshot,
ordinary manager backup/update and actual-site readiness verification.
The live diagnostic budget may be raised from 1 GiB to 4 GiB after preserving
its settings; the code default remains 1 GiB. This is not unlimited retention.

Old deleted source files, inaccessible Windows channels and browser failures
that never reached the server cannot be reconstructed. Historical duplicates
are preserved conservatively. The existing Scratch/learning acceptance blockers
are not closed by this Logs repair.
