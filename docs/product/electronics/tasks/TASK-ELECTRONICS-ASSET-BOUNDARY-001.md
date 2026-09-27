---
task_id: TASK-ELECTRONICS-ASSET-BOUNDARY-001
kind: analysis/inventory
risk: low
semantic_change: no
roadmap_slice: null
prerequisites:
  - docs/product/electronics/ASA_ELECTRONICS_MAINTENANCE_EXECUTION_SPEC.md#wp-asset-01--prove-runtime-vs-provenance-asset-boundary
acceptance_boundary: slice
review: independent
---

# Map Electronics runtime and provenance asset boundary

## Goal

Prove which Electronics asset roots are needed by the running Web application,
which are provenance or historical evidence, and which remain unknown. This is
WP-ASSET-01 only; it prepares separate packaging decisions without changing any
asset, URL, build rule, or product behavior.

## Component and ownership

The primary route is `electronics.assets.owner-svg` in
`docs/product/electronics/components/ui-assets-persistence.yaml`. The catalog
and public build are read-only evidence. The owner-asset area is critical; this
bounded analysis is low risk because it writes documentation only.

## Minimal read set

- `docs/product/electronics/START_HERE.md` and `COMPONENT_MAP.yaml`;
- `docs/product/electronics/components/ui-assets-persistence.yaml`;
- WP-ASSET-01 of the canonical maintenance execution specification;
- the exact asset manifests, imports/URL references, packaging rules, and
  documentation/evidence references needed for the five roots.

## Expected write paths

- `docs/product/electronics/evidence/WP-ASSET-01-RUNTIME-PROVENANCE-MAP.md`;
- this task card and the Electronics task record in `docs/execution/current.yaml`
  for formal activation and closeout only.

## Required mapping

For each of `component-database/`, `owner-audit/`, `owner-supplied/`,
`owner-approved/`, and `owner-catalog/`, record exact root/path evidence for
runtime references/imports, build/public exposure, owner protection,
documentation/evidence dependencies, and whether runtime requires the bytes at
their current public URL. Use one of `runtime-required`,
`provenance-required-but-not-runtime`, `historical-evidence`, or `unknown`; split
mixed roots into exact subpaths or classes rather than guessing one label.
Distinguish an exposed `public/` file from an actual runtime request.

## Acceptance

1. The mapping accounts for all five roots with reproducible current Git,
   reference, and build evidence, including counts/sizes where useful.
2. Every runtime or packaging claim is tied to an exact source, manifest,
   build rule, or browser/build observation. Unproved cases remain `unknown`.
3. A fresh independent reviewer checks completeness, classifications, and
   byte-identical protected assets.
4. Focused Electronics document validation, governance/control-plane checks,
   and required exact-head GitHub CI are recorded; the working tree is clean.

## Forbidden

No asset or manifest edit, move, deletion, redraw, recompression, generated
artwork, URL change, packaging/build/test/code change, screenshot inventory
rewrite, Docker/DB action, or WP-ASSET-02/03 work.

## Stop

Report the reviewed mapping and unresolved ownership/packaging questions, then
STOP this bounded task. A later task must separately select any implementation.
