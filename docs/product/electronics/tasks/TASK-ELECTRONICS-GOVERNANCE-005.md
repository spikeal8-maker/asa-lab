---
task_id: TASK-ELECTRONICS-GOVERNANCE-005
kind: plan/governance
risk: medium
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - Technical acceptance of production-changing slices #462, #463 and the first bounded slice of #464
acceptance_boundary: slice
review: independent
---

# Electronics stabilization hygiene checkpoint after #464

Program: [#452](https://github.com/spikeal8-maker/asa-lab/issues/452). Bounded task: [#490](https://github.com/spikeal8-maker/asa-lab/issues/490). Previous accepted checkpoint: [#480](https://github.com/spikeal8-maker/asa-lab/issues/480).

## One result

Complete the mandatory checkpoint due under `../contracts/ENGINEERING_HYGIENE_CONTRACT.md` §2 after the three accepted production-changing slices #462, #463 and the existing-controls slice of #464. Produce evidence for all seven §9 categories without changing product behavior. This checkpoint precedes another production-changing Electronics slice; it does not authorize the next feature.

## Read first

- `docs/execution/current.yaml` and `docs/product/electronics/START_HERE.md`;
- `docs/product/electronics/contracts/ENGINEERING_HYGIENE_CONTRACT.md`;
- `docs/product/electronics/evidence/hygiene-baseline.yaml`;
- `docs/product/electronics/evidence/hygiene-checkpoint-stabilization-001.yaml`;
- `docs/product/electronics/ASA_ELECTRONICS_STABILIZATION_SPEC_V2.md`.

## Bounded scope

1. Compare tracked Electronics production source sizes against the reviewed baseline. Classify new files above 50,000 bytes and growth above 20%; update reviewed bytes only after evidence-backed review.
2. Recheck active legacy and compatibility bridges against concrete retirement conditions. Preserve any artifact without the full §4 deletion proof.
3. Validate canonical routes and committed generated artifacts, including their generators; record new, deleted, stale or orphaned entries.
4. Confirm protected owner assets and historical evidence are intact. Record any actual removal with full proof.
5. Record residual debt as separately selectable follow-up work. New resistor and battery live controls in #464 remain outside this checkpoint and await the owner's product decision.

## Expected write paths

- `docs/product/electronics/evidence/hygiene-checkpoint-stabilization-002.yaml`;
- `docs/product/electronics/evidence/hygiene-baseline.yaml` only if reviewed facts change;
- `docs/execution/current.yaml` for the selected task checkpoint and status.

Additional routing documentation is allowed only if the existing validator proves a stale route. Do not edit production source, product tests, generated output or protected assets.

## Acceptance

- Evidence names the exact reviewed main SHA and reports all seven categories in the hygiene contract.
- Baseline classifications and byte counts match tracked sources; active bridges have evidence-backed retirement conditions and no speculative deletion occurs.
- `pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-GOVERNANCE-005`, `pnpm gate:governance`, `pnpm control-plane:check` and `git diff --check` pass.
- Controller verifies actual diff/scope. A separate reviewer independently checks exact candidate HEAD and GitHub state. Required exact-head CI passes before technical acceptance.

## Stop

The implementer reports the single checkpoint result and stops. The reviewer reports APPROVE or REQUEST_CHANGES and stops. The controller handles integration and closeout, then rechecks remote state, blockers and product decisions before selecting another bounded slice. No deployment or owner acceptance claim.
