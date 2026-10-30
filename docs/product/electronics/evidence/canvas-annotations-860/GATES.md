# Exact-source gate history

## Canonical candidate 71574f66

`71574f66cd705dea0f29ae019ecb0e205fba7f3f` completed
`NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1` with exit 0:

- Core: 60 files, 1,405 tests PASS.
- Web Electronics: 65 files, 1,112 tests PASS.
- Total: 2,517 tests; all typechecks and builds PASS.
- Nx: 71 fresh task executions (1 SDK build, 43 typecheck/dependencies,
  27 builds), cache skipped in all three Nx phases, no cache hits.
- All fixed bundle caps PASS. Electronics editor 182,600/222,000 bytes;
  Arduino 1,999,981/2,000,000; initial JS/CSS graph 555,421/600,000.
- Git-LF source digest:
  `fdbb20acbdcfb7d600465826165fd4f61fe7637035633214102b7b38ff4d8537`.

The complete compressed log, original local receipt and budgets are retained as
`canonical-repair-71574f66.log.gz`, `canonical-71574f66-receipt.json` and
`budgets-71574f66.txt`. `gate-artifact-hashes.json` records raw/compressed sizes
and hashes. This replaces no historical failure: the earlier 85582edb native
wheel pointer-target failure remains in its original fragment.

## General CI 40994231062 on the same 71574f66

The restricted PostgreSQL/Data job 123865772092 failed with exactly one test:
the API exposure policy omitted the new canonical `electronics_annotations`
reason. The job recorded 8,697 passing tests, one failure and 11 skipped tests.
The existing restricted PostgreSQL file
`tests/capacity/prepared-draft-save.pg.spec.ts` passed all five tests, including
both new annotation downgrade/replay/upgrade-race cases:
`prepared=false` (501 ms) and `prepared=true` (341 ms).
The relevant exact job lines are retained in
`general-data-71574f66-fragment.txt`. Governance and Code jobs were successful
at that snapshot; no overall General PASS is claimed here.

## Bounded API exposure repair

The repair adds only the two exact new canonical reasons
`electronics_annotations` and `electronics_annotation_version` to the explicit
API allowlist. It admits no arbitrary module strings or payload content.
Two additional controller cases prove HTTP400/log reason propagation without
writing or changing the old draft. Focused API validation and diagnostics:
**21 tests PASS** (`api-repair-focused.txt`).

The repaired source requires its own frozen-SHA canonical and General CI results;
the 71574f66 receipts above are historical evidence, not a PASS for a later SHA.
No installed Save acceptance, deployment or owner acceptance is claimed.

## Final repaired canonical gate

Frozen `f6b3a0a6eec281d2e972ee4ea929b5722089a4d5` completed the same
`NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1` with exit 0: 1,405 core tests
and 1,112 Web tests, **2,517 PASS**. All typechecks and builds passed with
**71 fresh Nx executions**, three cache-skipped phases and no cache hits.
All eight fixed bundle caps passed: editor 182,600/222,000 bytes, Arduino
1,999,981/2,000,000 and initial graph 555,421/600,000.

The final receipt, budgets, compressed complete log and raw/compressed hashes
are committed beside this file. The 31-source Git-LF digest is
`a07c7a986cceced93ffc5e027e65b177b20f36df47755c94cb6822c7805ffa04`.
See `INDEPENDENT_REVIEW.md` for the new review cycle and its explicit CI boundary.

## Final repaired PostgreSQL evidence

General run 40996527370, exact `f6b3a0a6eec281d2e972ee4ea929b5722089a4d5`,
Data job 123873479853: **SUCCESS**. The restricted PostgreSQL suite includes
`tests/capacity/prepared-draft-save.pg.spec.ts`: **5 tests PASS** (1,454 ms).
The main test phase reports 673 passing files and two skipped files; the
following restricted-role phase reports one passing file. The selected exact
job lines are retained in `general-data-f6b3a0a6-fragment.txt`.

General run 40996527370 subsequently completed **SUCCESS** on the exact repaired
SHA: Governance, Code, PostgreSQL/RLS and Access A browser jobs all succeeded.
This is the final General conclusion, not an inference from partial job results.
The earlier pending fields in original receipts retain their historical meaning.
