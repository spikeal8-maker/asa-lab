---
task_id: TASK-ELECTRONICS-SCREENSHOT-INVENTORY-001
kind: analysis/inventory
risk: low
semantic_change: no
roadmap_slice: null
prerequisites:
  - docs/product/electronics/ASA_ELECTRONICS_MAINTENANCE_EXECUTION_SPEC.md#wp-art-01--inventory-tracked-electronics-screenshots
acceptance_boundary: slice
review: independent
---

# Inventory tracked Electronics screenshots

## Goal

Classify tracked Electronics screenshot and raster evidence files without changing
their bytes or paths. This is WP-ART-01 only; it prepares a later owner decision
about evidence retention.

## Component and ownership

The primary route is `electronics.ui.workbench` in
`docs/product/electronics/components/ui-assets-persistence.yaml`. The inventory
also reads Electronics test artifacts, documentation screenshots and protected
owner-audit reference PNGs so that cross-surface dependencies are visible.
Those other areas are read-only in this slice. Area risk is medium; the bounded
inventory risk is low because it changes documentation only.

## Minimal read set

- `docs/product/electronics/START_HERE.md` and `COMPONENT_MAP.yaml`;
- `docs/product/electronics/components/ui-assets-persistence.yaml`;
- the WP-ART-01 section of the canonical maintenance execution specification;
- tracked screenshot path lists, their manifests/references, and the tests that
  write or consume them.

## Expected write paths

- `docs/product/electronics/evidence/WP-ART-01-TRACKED-SCREENSHOT-INVENTORY.md`;
- this task card and the Electronics task record in `docs/execution/current.yaml`
  for formal activation and closeout only.

## Inventory fields

For each exact tracked screenshot/evidence path, record owner or provenance,
document references, test writer/consumer dependencies, proposed lifecycle class
(`accepted historical evidence`, `golden/reference input`,
`generated/reproducible output`, `obsolete/unreferenced deletion candidate`, or
`unknown`), and unresolved dependency. Mark protected owner-audit files clearly.
Use reproducible Git enumeration and avoid interpreting a missing text reference
as proof that a file is disposable.

## Acceptance

1. The inventory accounts for every tracked Electronics screenshot/evidence path
   found by reproducible path and reference searches; unresolved scope cases are
   listed explicitly.
2. Each row has the required fields and a defensible proposed class. Unknown
   provenance remains `unknown` rather than being guessed.
3. A fresh independent reviewer checks completeness, provenance/classification
   evidence, and that no tracked image or protected asset changed.
4. Focused Electronics agent-document validation, governance/control-plane checks
   and required exact-head GitHub CI are recorded; the working tree is clean.

## Forbidden

No screenshot/evidence deletion, movement, byte change, regeneration, promotion,
or runtime packaging change. Do not change tests, source, owner assets, generated
coverage, hygiene baseline, ignore rules, CSS, Arduino, solver or Docker/DB state.
Do not implement WP-ART-02 or another work package here.

## Stop

Report the inventory and unresolved retention questions, then STOP this bounded
task for the owner's separate evidence-retention decision. No deletion follows
from this inventory automatically.
