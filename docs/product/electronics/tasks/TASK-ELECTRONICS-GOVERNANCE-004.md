---
task_id: TASK-ELECTRONICS-GOVERNANCE-004
kind: plan/governance
risk: medium
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - Technical acceptance of Electronics production-changing slices #453, #461 and #459
acceptance_boundary: slice
review: independent
---

# Electronics stabilization hygiene checkpoint

Program: [#452](https://github.com/spikeal8-maker/asa-lab/issues/452). Bounded task: [#480](https://github.com/spikeal8-maker/asa-lab/issues/480).

## One result

Complete the mandatory hygiene checkpoint due under `../contracts/ENGINEERING_HYGIENE_CONTRACT.md` §2 after three accepted production-changing slices. Produce evidence for the current large-source baseline, legacy bridge retirement conditions, routes, generated artifacts, protected and historical material, actual removals and remaining debt. This checkpoint does not change product behavior.

## Read first

- `docs/execution/current.yaml` and `docs/product/electronics/START_HERE.md`;
- `docs/product/electronics/contracts/ENGINEERING_HYGIENE_CONTRACT.md`;
- `docs/product/electronics/evidence/hygiene-baseline.yaml`;
- `docs/product/electronics/evidence/hygiene-checkpoint-post-eopt3.yaml` as prior evidence;
- `docs/product/electronics/ASA_ELECTRONICS_STABILIZATION_SPEC_V2.md` for program boundaries.

## Bounded scope

1. Compare tracked current Electronics production source sizes against the reviewed baseline. Record new >50,000-byte sources and >20% growth with a disposition; update reviewed bytes only after review.
2. Recheck active legacy/compatibility concerns and their concrete retirement conditions. Retain anything without full deletion proof.
3. Check canonical routes and committed generated artifacts for new, deleted, stale or orphaned entries; use existing validators.
4. Record that protected owner assets and historical evidence remain intact. Document any actual removal with the full proof required by the hygiene contract.
5. Classify residual debt as separately selectable follow-up work. This checkpoint may point to #462/#463 but must not implement them.

## Expected write paths

- `docs/product/electronics/evidence/hygiene-baseline.yaml` if review changes its facts;
- `docs/product/electronics/evidence/hygiene-checkpoint-stabilization-001.yaml`;
- `docs/product/electronics/tasks/TASK-ELECTRONICS-GOVERNANCE-004.md` only for a justified card correction;
- `docs/execution/current.yaml` for selected task checkpoint/status.

Additional routing documentation is allowed only if an existing validator proves a stale route within this checkpoint. No production source, product test, generated output or protected asset edits.

## Acceptance

- Evidence states exact reviewed main SHA and all seven checkpoint report categories from the hygiene contract.
- Baseline classifications and byte counts match the reviewed sources; no unreviewed large source remains.
- Active bridges have evidence-backed retirement conditions; no speculative deletion occurs.
- `pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-GOVERNANCE-004`, `pnpm gate:governance`, `pnpm control-plane:check` and `git diff --check` pass.
- Controller verifies actual diff/scope; a separate reviewer independently checks the exact candidate HEAD and remote GitHub state. Exact-head required CI passes before technical acceptance.

## Stop

Implementer stops after this checkpoint's evidence and focused gate. Reviewer stops after verdict. Controller closes out #480 and rechecks GitHub/current.yaml/blockers before selecting another bounded slice. No deployment or owner acceptance claim.
