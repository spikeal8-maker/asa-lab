---
task_id: TASK-ELECTRONICS-GOVERNANCE-001
kind: plan/governance
risk: medium
semantic_change: no
roadmap_slice: null
prerequisites:
  - E-OPT-3C canonical scheduler and physics barrier convergence integrated in main
acceptance_boundary: slice
review: self
---

# Electronics roadmap and engineering hygiene convergence

## Goal

Reconcile Electronics planning/routing with the implemented architecture after E-OPT-3C and make recurring repository hygiene, legacy retirement and large-file review an enforceable engineering contract.

This task changes documentation, routing and validators only. It does not change Electronics runtime semantics.

## Scope

- actualize the optimization roadmap through accepted E-OPT-3C;
- define recurring hygiene checkpoint triggers;
- define lifecycle classes for active, legacy, generated, historical and protected artifacts;
- define evidence required before deleting or retiring code;
- define large-source review and growth thresholds;
- create the first machine-readable hygiene baseline;
- make stale/new large sources fail closed in Electronics routing validation;
- teach agents how to route cleanup/decomposition work without speculative deletion.

## Expected write paths

```text
docs/product/electronics/ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md
docs/product/electronics/DEVELOPMENT_SPEC.md
docs/product/electronics/AGENT_GUIDE.md
docs/product/electronics/START_HERE.md
docs/product/electronics/contracts/ENGINEERING_HYGIENE_CONTRACT.md
docs/product/electronics/evidence/hygiene-baseline.yaml
docs/product/electronics/tasks/GOVERNANCE-HYGIENE-001.md
docs/product/electronics/tasks/MAINTENANCE_TASK_TEMPLATE.md
tools/validate-electronics-agent-docs.mjs
tools/test_validate_electronics_agent_docs.mjs
```

## Acceptance

1. The roadmap no longer describes E-OPT-1 or E-OPT-3A/B/C as future work.
2. Hygiene is due after every three accepted production-changing slices (`implementation`, `component/peripheral`, plus `maintenance`/`repair` that changed tracked production source) or before a major E-OPT stage transition, whichever happens first.
3. Canonical replacement of a provisional/legacy path can force an earlier hygiene checkpoint.
4. Bots have explicit lifecycle classes and deletion proof.
5. Files above the large-source threshold are listed in a reviewed baseline and growth above the configured threshold fails validation until reviewed.
6. Active legacy bridges name an explicit retirement condition rather than being deleted by appearance.
7. Generated outputs, historical evidence and protected owner assets are distinguished from cleanup candidates.
8. `pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-GOVERNANCE-001` passes.
9. `pnpm gate:governance` passes.

## Explicitly not doing

```text
no E-OPT-3D Worker/controller horizon migration
no UI cadence migration
no solver/DeviceModel semantic change
no Arduino runtime semantic change or decomposition implementation
no new peripheral/component capability
no owner-asset mutation
no deployment or restart
no deletion of active legacy bridges
```

## Stop

After documentation, baseline, validator evidence and bounded self-review pass, STOP. Report E-OPT-3D as owner-selectable; do not start it in this task.
