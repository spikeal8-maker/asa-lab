---
task_id: TASK-ELECTRONICS-GOVERNANCE-003
kind: plan/governance
risk: medium
semantic_change: no
roadmap_slice: null
prerequisites:
  - E-OPT-3F accepted and merged
acceptance_boundary: slice
review: self
---

# Electronics hygiene — mandatory checkpoint after E-OPT-3

## Goal

Run the mandatory engineering hygiene checkpoint after completed E-OPT-3 and before any separately selected E-OPT-4 or E-OPT-5 work.

This task changes planning, governance baseline and evidence only. It does not change Electronics runtime semantics.

## Scope

- synchronize the optimization roadmap through accepted E-OPT-3F;
- review all tracked Electronics production sources above the hygiene large-source threshold;
- refresh reviewed byte baselines where the current checkpoint has re-reviewed the source;
- review active legacy/compatibility bridges against their retirement conditions;
- classify remaining maintenance debt without speculative cleanup;
- preserve generated, historical and protected material;
- audit canonical Electronics routing for orphaned or stale registrations;
- record bounded checkpoint evidence;
- establish whether E-OPT-4 and E-OPT-5 are owner-selectable after this checkpoint.

## Expected write paths

```text
docs/execution/current.yaml
docs/product/electronics/ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md
docs/product/electronics/evidence/hygiene-baseline.yaml
docs/product/electronics/evidence/hygiene-checkpoint-post-eopt3.yaml
docs/product/electronics/tasks/GOVERNANCE-HYGIENE-003.md
```

Additional routing documentation may change only if required by the existing validator contract.

## Acceptance

1. E-OPT-3A..3F are represented as accepted and integrated, and E-OPT-3 is complete.
2. The post-E-OPT-3 dependency shape includes this mandatory hygiene checkpoint before owner selection of E-OPT-4/E-OPT-5.
3. All current production sources above 50,000 bytes are re-reviewed against the baseline; no unreviewed large production source remains.
4. Existing large-source classifications remain evidence-backed and reviewed bytes match the current checkpoint where updated.
5. `advanceLiveSimulation` remains a compatibility shim unless live test/tool dependencies reach zero with full deletion proof.
6. `legacy-ms-v1` / `advanceArduinoRuntime` remain an active legacy bridge while production callers exist; no production migration occurs here.
7. Generated, historical and protected-owner material remains classified and preserved.
8. Open Electronics debt issues are classified but not fixed by this checkpoint.
9. Canonical routing has no unclassified orphan or broken selected-task reference.
10. Checkpoint evidence records actual retained/deferred concerns, follow-ups and transition readiness.
11. `pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-GOVERNANCE-003` passes while the task is selected.
12. `pnpm gate:governance`, `pnpm control-plane:check` and `git diff --check` pass.

## Explicitly not doing

```text
no Electronics production source change
no Electronics test source change
no solver decomposition
no Arduino runtime decomposition
no advanceLiveSimulation migration/deletion
no legacy-ms-v1 migration/deletion
no advanceArduinoRuntime migration/deletion
no benchmark-tool migration
no generated JSON hand-edit
no protected-owner asset mutation
no E-OPT-4 activation
no E-OPT-5 activation
no E-OPT-6/peripheral activation
no deployment
```

## Stop

After documentation, baseline, evidence and validators pass, set the task to `in_review` at `post_eopt3_hygiene_review_ready`, keep `next_task: null`, and STOP for controller review. A clean checkpoint does not authorize E-OPT-4 or E-OPT-5.
