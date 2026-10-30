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
