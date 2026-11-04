# Frozen-source gate history

All results below concern exact `84f65b41bf58bf3506e15e41e3ee4b6459b905b2`.
The production source, tests, timeouts and concurrency configuration were not
changed between these attempts.

## Initial canonical failure and bounded diagnosis

The first `NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1` failed in Core:
1,410 tests passed, one existing ownership test timed out at 5,031 ms against
its 5,000 ms limit. The six new regressions passed. Later Web/type/build phases
were not reached, so no complete gate PASS or 71-task result is claimed for it.

The exact same case in its same serialized project passed alone in 3,281 ms.
A saved older canonical fragment reports 3,423 ms; that is historical context,
not a controlled before/after performance pair. The fixture contains Arduino
and a 330-ohm resistor, no Servo. Runtime probing confirms the changed RC region
is used; this is not misclassified as an entirely untouched path. No functional
A/B defect was observed. Timing/resource variance is supported, while its exact
machine/GC cause remains unproven.

This evidence justified **one unchanged retry**, without another competing local
heavy run. The complete original failure, classification, isolated-case log,
profile probe, historical fragment and all hashes are retained losslessly in
`ownership-timeout-84f65b41/`. The paused generic CI-repair task was not resumed.

## One unchanged canonical retry

The same command completed with exit 0:

- Core: 61 files, **1,411 tests PASS**. The previously timed case passed
  in **3,202 ms**, still using the original 5,000 ms limit.
- Web: 67 files, **1,145 tests PASS**; total **2,556 tests PASS**.
- SDK build, types and all builds: **71 fresh Nx tasks**
  (1 SDK + 43 typecheck/dependencies + 27 builds), three cache-skipped phases,
  no cache hits.
- All eight unchanged bundle caps PASS: editor 187,873/222,000 bytes,
  Arduino 1,999,981/2,000,000 and initial graph 555,421/600,000.

The full compressed successful log, receipt and budgets are retained beside this
file. Independent review and exact-source General run 41009745129 are separate
pending conditions at this recording. No installed, owner or deployment
acceptance is inferred.

## Final independent and General results

A new independent reviewer approved exact `84f65b41` after **222 tests**,
**four fresh native journeys** and independent full-oracle reproduction; see
`INDEPENDENT_REVIEW.md`. General run **41009745129** completed **SUCCESS** on
the same full SHA: Governance, Code, PostgreSQL/RLS and Access A browser jobs all
succeeded. Its normalized response is `general-final-84f65b41.json`. Original
pending receipt fields retain their historical meaning; the initial local
timeout is not hidden by this final PASS.
