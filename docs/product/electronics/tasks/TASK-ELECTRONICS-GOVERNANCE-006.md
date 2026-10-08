---
task_id: TASK-ELECTRONICS-GOVERNANCE-006
kind: plan/governance
risk: medium
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - Technical closeout of #505 and accepted gate-restoration dependencies #516/#517
acceptance_boundary: slice
review: independent
---

# Mandatory Electronics hygiene checkpoint before the next product slice

Program: [#452](https://github.com/spikeal8-maker/asa-lab/issues/452). Bounded checkpoint: [#524](https://github.com/spikeal8-maker/asa-lab/issues/524). The canonical Electronics lane selects this card; previous technical closeout is [#505](https://github.com/spikeal8-maker/asa-lab/issues/505).

## One result

Resolve the due checkpoint under ENGINEERING_HYGIENE_CONTRACT sections2/9 after accepted production slices since #490. The gate-restoration exception permitted #513/#516/#517; #518 reviewed one file and explicitly was not a full checkpoint. Keep the accepted student-facing repairs and observations intact. This checkpoint does not authorize decomposition, asset cleanup or a product change.

## Read first

- docs/execution/current.yaml and ../START_HERE.md;
- ../contracts/ENGINEERING_HYGIENE_CONTRACT.md;
- ../evidence/hygiene-baseline.yaml;
- ../evidence/hygiene-checkpoint-stabilization-002.yaml and ../evidence/visual-source-responsibility-518-20261007.md;
- the selected checkpoint boundary of ../ASA_ELECTRONICS_STABILIZATION_SPEC_V2.md.

## Bounded scope

Use the established baseline and changes since the last full checkpoint; do not repeat a general Electronics capability audit or any accepted browser/load/device measurement. Report all seven mandatory categories on the actual exact reviewed main: tracked large source sizes/growth, active legacy bridges/retirement conditions, routing changes, generated artifacts/generators, historical/protected preservation, actual removals (none unless separately authorized), residual selectable debt. Review the existing eight named sources and detect only actual new threshold crossings. Size does not require splitting. Preserve protected owner artwork, historical evidence, ordinary browser output policy and every foreign lane.

## Expected write paths

- ../evidence/hygiene-checkpoint-stabilization-003.yaml;
- ../evidence/hygiene-baseline.yaml only for facts independently reviewed within this task;
- controller-owned canonical task selection/closeout in docs/execution/current.yaml.

No production code, product tests, generated output, source/dependency/workflow, asset, installation, database or network mutations. Routing documentation only if an actual validator failure proves a stale route. Record semantic questions or a required repair separately; do not implement them here.

## Acceptance

- Actual exact-SHA facts cover every mandatory category, with concrete retention/retirement reasons and preserved previous evidence.
- pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-GOVERNANCE-006, pnpm gate:governance, pnpm control-plane:check and git diff --check pass.
- Root checks actual diff/scope; a NEW independent reviewer checks the final exact SHA/GitHub state and returns APPROVE or REQUEST_CHANGES. Exact-head required registered CI must be classified from actual results; a foreign Portal failure is owner-coordinated, not repaired in this scope and not claimed PASS.
- T3 remains pending evidence from the actual pupil computer. Owner/class acceptance, release and deployment remain separate.

## Stop

Executor reports one checkpoint result and STOP; reviewer reports one verdict and STOP. Controller alone accepts/records it and freshly selects any subsequent canonical product slice. This checkpoint does not activate a next product task.
