# Exact-source controller verification

Frozen source: `097f2dba6b376130244c3fbbb3bdc1f65520dc6a`.
No source, test, timeout or concurrency setting changed between the executed
canonical attempts below. The frozen 49-file manifest remains unchanged.

## First executed canonical and bounded timing diagnosis

`NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1` first passed 1,420 Core tests,
then passed 1,144 Web tests and failed one existing asset audit by timeout.
`owner-asset-manifest.spec.ts` checks all 697 imported review images against
archive hashes. The case took 10,262 ms against a 5,000 ms limit. It reported
timeout, not a hash mismatch; later full type/build phases were not reached.

The same exact case passed alone in **139 ms**, with all 697 hashes matching.
The whole Electronics public-asset Git tree and the asset test Git blob are
identical between the baseline and frozen SHA. This supports D timing/resource
variance, not a functional copy regression; the exact host cause is unproven.
The complete first failure, isolated log, tree/blob identities and classification
are retained losslessly under `asset-timeout-097f2dba/`.

## One unchanged retry

The same uncached canonical command completed with exit 0:

- Core: 62 files, **1,420 tests PASS**.
- Web: 67 files, **1,145 tests PASS**; total **2,565 tests PASS**.
- The original asset audit passed in **313 ms**, retaining its 5,000 ms limit.
- All types/builds: **71 fresh Nx tasks** (1 SDK + 43 typecheck/dependencies +
  27 builds), three cache-skipped phases and no cache hits.
- All eight fixed caps PASS: Arduino **1,999,925/2,000,000** bytes,
  editor **187,873/222,000**, initial graph **555,421/600,000**.

The full successful log, raw/compressed hashes, receipt and budgets are stored
beside this file. The initial failure is retained and not relabelled as PASS.

Independent review approved the exact SHA after 108 tests and 16 fresh native
cases; see `INDEPENDENT_REVIEW.md`. General run 41016628210 is a separate pending
condition at this recording. No installed, owner or deployment acceptance is
inferred.

## Final General conclusion

Run **41016628210** completed **SUCCESS** on exact
`097f2dba6b376130244c3fbbb3bdc1f65520dc6a`: Governance, Code,
PostgreSQL/RLS and Access A browser jobs all succeeded. The normalized response
is `general-final-097f2dba.json`. The new independent reviewer approved the
same SHA after 108 tests and 16 fresh native cases. Earlier pending receipt
fields remain historical; the original timeout is preserved rather than hidden.
