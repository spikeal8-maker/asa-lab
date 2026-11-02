---
task_id: TASK-ELECTRONICS-TOOLBAR-ORACLE-001
kind: repair
risk: low
semantic_change: no
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Desktop toolbar browser oracle matches the accepted interface

Issue [870](https://github.com/spikeal8-maker/asa-lab/issues/870), bounded
test maintenance for remaining-plan18, not reopening the historical product
implementation #532. Execution state lives only in current.yaml.

## Proven discrepancy

Canonical run41026543811 at e1be12d19 contains four compact-controls failures.
The first desktop header checks expect15 breadboard controls instead of the
actual16 including the accepted text tool; the1181 case expects96px/two rows
instead of the actual48px/one row. Current accepted CSS explicitly keeps desktop
actions/clock in one row. The owner's requirement is one toolbar row.

Original full artifact remains preserved under executor reports/
field-boundary-544-proof-41026543811/artifact/reports/playwright. The four
compact-controls directories retain error-context, geometry and original PNGs.
Reuse this BEFORE; do not rerun the entire suite to reproduce stale assertions.

## Scope and proof

Change only the proven desktop-header oracle in the four existing segmented
cases of e2e/electronics-simulation.spec.ts and the canonical generated browser
digest when required. Explicitly retain the added text-tool identity in the
expected contract. Independently verify control identities/counts for the real
production Header at1180/1181/1373/1374 and supported views/states; preserve
schematic/BOM counts unless actual source/native evidence establishes a change.

Retain every existing case, width/state, Code-mode/control/font/resize check,
native action, clock/caption/icon/hit/clipping/geometry and complete-document
Save/reopen assertion. No timeout, retry, scenario, dependency, workflow or
production change. A later actual product failure requires a separate selected
repair, not a weakened assertion here.

Preserve small original BEFORE raw/PNG and immutable provenance, then publish
the minimal candidate. Meaningful validation is exact old/new assertion review,
real Header native evidence, relevant lint/types, four-case Playwright discovery,
the canonical focused gate and a fresh independent final-SHA review. The full
four Code/persistence journeys remain NOT_RUN in this slice unless genuinely
executed; header evidence is not a whole-journey PASS. Do not rerun the unrelated
45-minute suite for these initial assertion corrections. No release claim.

Supporting native evidence may reuse the production-component fixture from868
without editing its historical evidence. Generate required digest fields only
with the repository's canonical generator; preserve every unrelated map field.
Root owns execution metadata. No server, Docker, live DB, ports, deployment,
refactor, protected assets or foreign edits.

## Viewport-fixed menu clipping correction

Scoped41365631046 proves a later false positive at981-native-open after the
reviewed desktop packing. Purple bottom162 is compared to toolbar scroll-group
bottom95, although the actual position:fixed popup is fully visible and all5
native points are owned. Independent PNG/raw and browser probes confirm the
viewport-fixed escape, genuine ordinary clipping, transformed fixed-containing
block clipping, popup-local overflow and viewport clipping. The old c353 CSS
already has both overflow and fixed positioning: this is not a new product bug.

No production correction is permitted. In the existing compact-case measurement
region, use browser-computed actual intersection bounds instead of treating every
overflow ancestor as a clip. Retain ancestor diagnostics. Do not exempt a named
selector, phase or all fixed elements. Preserve all existing ±1px tolerances,
viewport bounds, five native ownership points, caption/icon/text checks, all95
phases and whole project-intent/Save/reopen assertions. Only the causal clipping
measurement and corresponding assertion input change; all unrelated test bytes
remain exact. Batch observation in one observer/frame per capture, with complete
cleanup and fail-closed missing observations, without added sleeps or deadlines.

Test-only budget: existing e2e region plus one native adversarial fixture; a third
small shared test-only helper is allowed only to exercise the same implementation
without duplicating it. No runtime source. Prove normal clipping, viewport-fixed
escape, transformed fixed-containing block, popup-local clipping, viewport clipping
and occlusion (intersection alone does not prove native ownership). Update exact
subsystem test mapping and only canonical generated browserEvidenceSha256 using
the existing generator; every other parsed generated field stays equal.

Carry independently reviewed532 CSS as a dependency for the combined original
four Code journeys plus E01. Do not change that product candidate here. Short
adversarial proof and fresh independent source review precede one changed-cause
combined CI execution. No threshold/deadline/retry/scenario/intent weakening,
force click, fake SDK, production change, server or foreign edit. Root owns state.
