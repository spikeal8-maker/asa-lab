---
task_id: TASK-ELECTRONICS-REPORT-HYGIENE-001
kind: maintenance
risk: low
semantic_change: no
roadmap_slice: null
prerequisites:
  - docs/product/electronics/ASA_ELECTRONICS_MAINTENANCE_EXECUTION_SPEC.md#wp-art-03--ignore-disposable-interaction-reports
acceptance_boundary: slice
review: self
---

# Ignore disposable Electronics interaction reports

## Goal

Normal Electronics interaction test runs must not leave disposable `reports/interactions/**` files as untracked repository dirt. First establish whether those files are disposable test output; preserve accepted evidence.

## Component

`electronics.ui.workbench` in `docs/product/electronics/components/ui-assets-persistence.yaml`. The mapped focused test is `e2e/electronics-interactions.spec.ts`.

## Risk and ownership

The component is ASA-owned and has medium area risk. This task is low risk because its permitted change is limited to a narrow ignore rule for disposable test output, with no runtime or product semantics.

## Minimal read set

- `docs/product/electronics/START_HERE.md`
- `docs/product/electronics/COMPONENT_MAP.yaml`
- `docs/product/electronics/components/ui-assets-persistence.yaml`, entry `electronics.ui.workbench`
- `docs/product/electronics/ASA_ELECTRONICS_MAINTENANCE_EXECUTION_SPEC.md#wp-art-03--ignore-disposable-interaction-reports`
- `.gitignore`
- `e2e/electronics-interactions.spec.ts`

## Expected future write paths

- `.gitignore` only, with a narrow rule for confirmed disposable `reports/interactions/**` output.

If evidence shows that output must instead be redirected, STOP and request a scope change. This card does not pre-authorize test or source edits.

## Acceptance

1. Prove that `reports/interactions/**` is disposable test output.
2. Accepted and tracked Electronics evidence remains visible to Git.
3. A normal interaction test run no longer leaves untracked report files.
4. Product and runtime behaviour does not change.

## Forbidden

- No deletion of evidence or modification of tracked screenshots.
- No WP-ART-01 or WP-ART-02 work.
- No CSS, UI, runtime, solver, Arduino or other product change.
- No broad `reports/**` ignore rule.
- No deployment.

## Stop

Report the bounded evidence and result, then STOP. Do not select the next work package.
