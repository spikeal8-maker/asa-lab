# Exact-source gate history

## Frozen candidate 3ebf0e16

`NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1` failed on
`3ebf0e16249e9a5c8c17e504e8179bfb6ba7b76d`:

- SDK build: one fresh Nx execution; cache skipped.
- Core: 1,405 tests PASS.
- Web: 1,144 tests PASS, one FAIL (67 files).
- The sole failure is the old exact JSX string in
  `workbench-presentation.spec.ts:176`, which assumed the clock tag had no other
  props. The new rate control adds `controller={c}`; the clock port is unchanged.
- Later full typecheck/build phases were not reached. This is not a canonical
  PASS, nor a claim that all 71 Nx tasks completed.

The full compressed failure log, raw/compressed hashes and receipt are retained
as `canonical-failure-3ebf0e16.log.gz` and its JSON receipt. The original
17-file source manifest remains `source-manifest-3ebf0e16.json`.

## Bounded test-only repair

The repaired assertion still requires a `SimulationClock` element with the exact
`port={c.nativeOpticalPresentation}` prop and its expression boundary. It allows
additional UI props without assuming the closing tag immediately follows port.
The adjacent `useSyncExternalStore` requirement, microsecond formatting and
prohibitions against requested-horizon/host-wall-time clock displays are all
unchanged. Mounted clock rollover and rate-panel behavior tests are retained.

Focused presentation, mounted Header time and rate-control suites:
**22/22 tests PASS**, three files. The repair changes one test file only;
all prior 17 source/contract/map Git blobs remain identical. The expanded final
manifest includes the repaired test. Native and bundle evidence carries across
this test-only delta; neither a product change nor a new native run is claimed.

The repaired frozen SHA requires a new canonical gate and independent review.
General CI, installed acceptance and deployment are separate and are not inferred
from the focused repair.

## Repaired frozen canonical gate

Exact `fad679d57e803a38ac3a57e4abb9a6d0c926e137` completed
`NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1` with exit 0:

- Core: 60 files, **1,405 tests PASS**.
- Web: 67 files, **1,145 tests PASS**; total **2,550 tests PASS**.
- SDK build, all typechecks and all builds: **71 fresh Nx tasks**
  (1 SDK + 43 typecheck/dependency tasks + 27 builds), three cache-skipped
  phases and zero cache hits.
- All eight unchanged bundle caps PASS: editor **187,873/222,000** bytes,
  Arduino **1,999,981/2,000,000**, initial graph **555,421/600,000**.

The complete compressed log, raw/compressed hashes and final budget output are
retained beside this file. The original failure remains intact. Independent
review and General CI run 41003731109 are still pending at this receipt; neither
is inferred from this canonical PASS.

## Exact repaired Data/RLS job

General run 41003731109 on the repaired frozen SHA: Data/RLS **SUCCESS**.
Its main suite reports **8,733 tests PASS**, 11 skipped tests and 675 passing
files; the restricted-role phase reports **16 tests PASS**. The prepared draft
PostgreSQL file also passed its five cases. Selected exact job lines are retained
in `general-data-fad679d5-fragment.txt`. Governance and Code succeeded; the
Access A job is still pending at this recording, so this is not an overall
General PASS.

## Final General conclusion

Run **41003731109** completed **SUCCESS** on exact
`fad679d57e803a38ac3a57e4abb9a6d0c926e137`: Governance, Code,
PostgreSQL/RLS and Access A browser jobs all succeeded. The normalized final
response is retained in `general-final-fad679d5.json`. A new independent reviewer
approved that SHA after 382 tests and four fresh native journeys, including
stronger Reset/Stop and late-response tests; see `INDEPENDENT_REVIEW.md`.
Earlier pending fields in original receipts retain their historical meaning.
No installed or owner acceptance, server update or deployment is claimed.
