# PSU native switch hit priority — #877

Bounded source candidate based on `0027b5c1e75d151ebde1c2df734d87eb795b25e3`.
Only `WorkbenchStage.tsx` and `ProductionComponentVisual.tsx` change product behavior.

Mounted, validated stationary owner track geometry makes ordinary whole-wire and
segment targets fall through natively. Exact rounded arcs use the existing
component projection, rotation and mirror flags. Per-supply complement clips
intersect; visible wire paint and endpoint/vertex layers retain their original
geometry and handlers. Pending-terminal wiring suppresses exclusions.

The finite domain contains routed points, projected track bounds, the entire
logical viewBox and the existing maximum 15-screen-pixel stroke radius converted
using mounted Stage bounds and current `xMidYMid slice` scale. Including the full
viewBox also covers its visible region after CSS-only resizing without requiring
another subscription. Zero-size/unmounted Stage geometry fails closed.

Conservative overlap boundary: any later painted body's transformed rectangular
bounds intersecting a track's bounds suppresses that entire exclusion. Partly
visible controls in such overlaps keep historical priority. This avoids a new
wire-selection gap over a foreground body; universal switch priority is not claimed.

Availability depends on component ID, source identity, Boolean live markup and a
stable callback. It validates the connected generated rect, dimensions and actual
runtime viewBox, and cleans up on fallback/unmount. It does not depend on measurement
markup or add a controller, editor or runtime-frame subscription. Actual running
NativeOpticalPresentation frame-isolation behavior is not independently claimed here.

## Evidence

`native.mjs` mounts the production Stage and production visual/native handlers with
a controller **test port** recording commands. It uses Chromium mouse input and
real owner SVGs; it does not dispatch pointer events or reroute targets. This is
native Stage composition proof, not a whole-editor/backend save journey.

`native-result.json` contains 91 receipts:

- Six failed archived poses: exact archived Stage bounds and runtime CTMs (tolerance
  0.001), precise intercepted wire attribution and archived raw SHA256. The exact
  frozen f335 `clickOwnedRect` helper is AST-extracted and invoked on the actual
  `.workbench-regulated-supply-power-slider`; each activation produces one trusted
  native pointer-down and exactly one switch command.
- 64 combinations of four rotations, four mirrors and widths1440/1024/390/320:
  track ownership, rounded-corner wire ownership and one command. Four screenshots
  are native Stage fixtures at the representative widths.
- Pending wire, selected vertex/endpoint, foreground body overlap, disjoint nested
  clips, coincident supplies, unmount, hidden/visible two-Stage IDs, body drag/select,
  outside segment/bend, unchanged whole/segment widths and whole-wire annulus,
  finite zoom-domain probes, unchanged knob priority, native terminal routing,
  delayed source, failed source and malformed-source fallback.

Reproduce without a server or listening port:

```powershell
node docs/product/electronics/evidence/psu-switch-native-hit-877/native.mjs C:/Users/spike/.codex/worktrees/electronics-value-inputs/ASA-lab/reports/instrument-525-before-41061516266
```

Final focused verification: four suites /74 tests, direct web tsc, targeted ESLint,
Prettier, and working-tree-only `git diff --check` before staging evidence. The
committed archived raw `focused-tests.log` has a known new blank line at EOF13
reported by commit-range diff-check; its original bytes/hash are preserved. Final web build ran all7 graph tasks fresh with
`NX_SKIP_NX_CACHE=true`,38.4s, cache skipped. All8 fixed bundle caps passed;
logs are included. An earlier37.1s build passed before the finite-domain correction
and is not substituted for the final build.

The frozen f335 observer/spec evidence directory is composed unchanged. Full spec
blob remains `b450bd6d148285008ba226bb688a315f1120eb1a`, SHA256
`d9c0c74dd49997636aca4decd6c61d0381b4aa649a030b8e094305ece7b0f93c`.

Self-review found and corrected the nominal-zoom domain assumption before freezing.
The final native recheck corrected a fixture expectation: a display:none second
Stage has zero mounted bounds and correctly emits no clip; two visible Stages
produce distinct IDs. No source workaround was added for that fixture correction.

The original source/native/composition review preceded strict run41077666273 on
`2f9f3d8b7efea8ae688b1d628ffff95bb9f24250`. That run failed the focused
step6 component-information guard before tests: composition had preserved the
f335 spec but omitted regenerating its dependent coverage metadata. Category B:
`generatedFrom.browserEvidenceSha256` still referenced the old73efacf7 spec hash.
Browser and benchmark jobs were SKIPPED, not failed product journeys.

Bounded877B repair runs the canonical coverage generator with `--write` and
changes exactly that generated JSON field to the frozen d9c0c74d hash. Every
other generated field is identical; generated blob
`48cfb6e64b609b1ab1f5e12f3bc8c0f00e838b91` exactly matches f335's artifact.
`pnpm validate:electronics-component-information` passes (full same-CI guard;
see `composition-guard-877B.log`). Product source, spec, native receipts, screenshots,
prior build/cap/test logs and protected assets are unchanged. Source proofs remain
those of2f9f3d8; no source build or native rerun was performed for metadata-only877B.

Fresh metadata/composition review must precede one newly justified strict run. Canonical focused/benchmark/browser, whole-editor #544 field
boundary/backend persistence and complete16 journey evidence are NOT_RUN here.
#544/#547 remain OPEN. No mirror AFTER, owner acceptance or release claim.

TASK: TASK-ELECTRONICS-PSU-SWITCH-NATIVE-HIT-001; ISSUE:877; STATUS: review candidate.
CI:41077666273 failed composition guard; new run pending review. DEPLOYMENT: not requested; DATABASE_ACTIONS: none; PORTS: none opened.
VISIBLE_RESULT: native switch target over ordinary wire hit strokes within the
bounded live/unoccluded track. MAP_NODES_CHANGED: none. Seven pre-existing untracked
report directories are preserved at877B entry. NEXT_ALLOWED_TASK: independent review of this
frozen candidate; no automatic next product slice.
