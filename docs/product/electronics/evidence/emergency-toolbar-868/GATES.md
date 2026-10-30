# Emergency toolbar: exact-source delivery checks

Reviewed candidate: `a94eba7bf3bf8c4623184996c022f907d0972509`.
Only product changes are responsive toolbar CSS and the concise toolbar-only
pausing label. The full dialog text, pacing, clock computation and persistence
logic are unchanged. The original E01 browser oracle is unchanged.

## Final checks

- `NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1`: PASS, exit0.
- Core1420 tests/62files; Web1145 tests/67files: 2565 passed.
- Nx executed71 tasks afresh: module-sdk1, types/dependencies43, builds27.
  All three invocations report cache skipped; no cached evidence counted.
- `pnpm bundle:check`: all8 caps PASS. Editor187859/222000,
  Arduino1999925/2000000, initial graph555415/600000.
- Fresh independent native replay:432 states/2928 actions PASS; critical
  320/768/981/1536 screenshots reviewed. Full100/1000-hour values, supported
  running/pausing/paused states and accessible actions fit the tested geometry.
- Fresh independent exact-SHA verdict: APPROVE, no actionable findings.
- General exact-SHA run41038088189: SUCCESS, all four required jobs.

Controller verified all169 staged candidate paths byte-for-byte against the
reviewed commit and separately verified265 independent raw/image files while
archiving them. The archive includes the original independent proof manifest;
its earlier pending-canonical wording is historical. Canonical logs and fixed
caps are retained under `controller/`, with archive hashes in its index.

## Rejected candidates retained

Candidate66146712 passed its canonical2565/71fresh checks but independent review
rejected the long pausing label's16.516px tool strip. Candidate485112b5 also
passed canonical2565/71fresh checks but independent review rejected100-hour
width and the nested clock's tablet height. Neither was integrated. Their logs,
receipts and reviewer raw proofs remain preserved; finalR2 corrects both causes.
All original29, R1's35 and R2's99 manifest entries were independently verified.

The fixture imports actual production components and pacing and supplies
controller ports in memory without a listening server. It proves responsive
layout and callback reachability, not installed Save durability. The prior full
Electronics browser run41026543811 remains red with86 independent failures;
no overall Electronics release acceptance or owner acceptance is asserted.
No server, Docker, live database, protected assets or foreign changes were made.
