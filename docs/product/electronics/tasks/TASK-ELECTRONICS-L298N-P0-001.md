---
task_id: TASK-ELECTRONICS-L298N-P0-001
kind: implementation
risk: medium
semantic_change: "no"
roadmap_slice: E-OPT-7
prerequisites:
  - "Issue #1199: exact owner ZIP must be byte-verified before asset writes"
  - "Original L298N SVG SHA256: 289c604c4ff4e1e74a733e2d01c18b2beab58721f6b4c5c369de37e34a425498"
acceptance_boundary: slice
review: self
---

# L298N — P0A bounded owner-art and disabled-catalog intake

## Goal

Register the exact owner-provided L298N display artwork and metadata in the existing Electronics catalog **without activating simulation or inventing additional electrical capability**. The parent programme #1199 also requires a separate P0B top-wire/component interaction slice, P1 DOMAIN, P2 state/UI and P3 acceptance; none is automatically selected by this card.

## Component IDs

- electronics.assets.owner-svg
- electronics.ui.catalog

## Minimal read set

- docs/product/electronics/START_HERE.md
- docs/product/electronics/COMPONENT_MAP.yaml
- docs/product/electronics/components/ui-assets-persistence.yaml
- docs/product/electronics/ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md#10-e-opt-7-ui-assets-maintainability
- AGENTS.md#3-неприкосновенные-данные
- apps/web/src/electronics/production-manifest-adapter.ts
- apps/web/public/assets/electronics/component-database/catalog.json
- apps/web/src/electronics/testing/production-assets.spec.ts
- tools/test_validate_electronics_assets.py

## Expected write paths (P0A only)

- apps/web/public/assets/electronics/component-database/components/drivers/l298n/component.svg (new, exact owner display bytes)
- apps/web/public/assets/electronics/component-database/catalog.json (single disabled L298N entry)
- apps/web/src/electronics/testing/l298n-owner-art.spec.ts (new dedicated focused catalog/asset test if needed)
- docs/product/electronics/tasks/TASK-ELECTRONICS-L298N-P0-001.md (this card; factual evidence only)

No new `owner-supplied/**` or `owner-audit/**` files are overwritten. No existing SVG is modified. The owner ZIP resides in the ChatGPT runtime at /mnt/data/ASA_LAB_L298N_INTEGRATION_v1_1_TOP_WIRES.zip, **not** automatically on the D2-R2 host; verify the exact binary is transferred before code work.

## Acceptance

1. Artwork is copied verbatim from owner ZIP, SHA256 `289c604c4ff4e1e74a733e2d01c18b2beab58721f6b4c5c369de37e34a425498`, 42,273 bytes; source/reference and license recorded.
2. Existing schema `asa-lab.electronics-component-database.v1`, worldUnitsPerMm=5, 43x43 mm, 11 electrical terminals and six configuration pads are described accurately; no pretending that jumper pads are six always-connectable power terminals.
3. Catalog entry remains `disabled_missing_model` until P1 DOMAIN and P2 independently accepted. No incorrect `solved: true` or runtime fallback.
4. Unchanged other assets/manifest entries; focused contract and artwork validation, one full asset test, owner-asset provenance checks and self-review.
5. No route, wiring-layer, solver, Arduino, worker, persistence or simulation state changes in P0A.

## Explicitly not doing

No WorkbenchStage top-wire modification yet (selected P0B after P0A), no LED behavior, jumper toggle, simulator equations, motor drive, autosave, C3/SP05, Docker, production, database or deployment actions. No Codex.

## Tests / gates

- Exact SHA256 and file byte-count from acquired ZIP and installed SVG.
- `node tools/validate-electronics-agent-docs.mjs --task TASK-ELECTRONICS-L298N-P0-001` after canonical main selection.
- `pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-L298N-P0-001`.
- Focused production asset/manifest validation, `pnpm gate:governance`, applicable code checks and final exact-SHA CI.

## Bounded self-review and stop

Do not mark P0A accepted with only local ZIP/demo tests; those do not prove GitHub integration. If the owner ZIP cannot be transferred to the selected worktree with exact hash, stop at `BLOCKED_BY_OWNER_ZIP_TRANSPORT`, preserving source files, existing lanes and untracked data.

NEXT_ALLOWED_TASK: STOP; after P0A independent readiness assessment, programme controller may select separate P0B WIRING slice with top wires and contacts, followed by P1 domain, P2 UI/state and P3 acceptance.
