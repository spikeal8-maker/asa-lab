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
