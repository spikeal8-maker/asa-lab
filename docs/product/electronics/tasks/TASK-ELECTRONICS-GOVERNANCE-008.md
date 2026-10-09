---
task_id: TASK-ELECTRONICS-GOVERNANCE-008
kind: plan/governance
risk: medium
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - Owner programme452 explicit parallel repair instruction6084548550
  - Existing generic parallel_lanes and independently selected bounded task cards
acceptance_boundary: slice
review: independent
---

# Validate explicitly selected parallel Electronics repairs

Existing programme [452](https://github.com/spikeal8-maker/asa-lab/issues/452), bounded existing-guard repair [536](https://github.com/spikeal8-maker/asa-lab/issues/536). This is a controller tooling dependency of the owner's explicit parallel product instruction, not a new programme, product audit or agent framework. Selection remains only in current.yaml on main.

## Confirmed boundary

Generic execution lanes and scoped preflight already support separate lane IDs. Electronics card validation currently accepts only `id: electronics`, rejecting a separately selected executable card even when canonical main contains it. Add an explicit `parent_lane: electronics` marker for additional parallel lanes, using the existing current.yaml records and task cards. Keep exactly one root Electronics lane. The marker grants neither ownership nor permission to ignore blockers; the controller checks applicable programme/task/action blockers before each dispatch and preserves actual unfinished work.

## Exact write paths

- `tools/validate-electronics-agent-docs.mjs`: validate root and explicitly parented parallel tasks; exact requested task must resolve uniquely to an executable in_progress selection and valid card.
- `tools/test_validate_electronics_agent_docs.mjs`: meaningful selection regressions, retaining all old tests. Root primary/parallel and multiple selected children pass; inactive/unselected/foreign tasks, malformed records, missing cards, duplicate lane/task/root and invalid parent markers fail closed.
- `docs/product/electronics/START_HERE.md`: concise existing routing explanation for this explicitly selected case. No second state.

Do not edit current.yaml, this card, product files, package/dependencies/workflows, school installation or foreign work. No guard disabling or lease-based permission model. No recursive programme scheduling inside the validator. Child scoped context must include the exact card/router through existing owned_paths hints. No product/runtime/Arduino/physics/auth/save semantics change.

## Required result

One clean controller-provided checkout, fresh preflight, targeted actual validator repro, focused full regression file, full governance/control-plane/diff checks. The pre-change rejection of this task's exact child selection is the diagnosed guard defect, not authorization for product edits; the owner explicitly commissioned its bounded correction. Preserve this failed result and require corrected exact selection to pass after repair. Author performs bounded self-review, returns one unpublished SHA/tree/actual checks/report and STOP. Controller checks the actual diff, publishes normally and assigns a NEW independent reviewer to the exact SHA and factual GitHub state. General exact governance result must be successful; unchanged product/browser suites are not new pupil acceptance evidence.

After acceptance, separate selected product authors implement E13/E07 and other nonoverlapping pupil complaints while the required530→526 acceptance chain continues. No school deployment or owner/class acceptance is claimed by this tooling repair.

## Technical closeout

Exact51361740a708bae5aee13bc9e366d3e35b0cf994/treef8d13a2bdbc1e11d117d756f10ec5c59fd5e628b is integrated after [NEW independent APPROVE](../evidence/parallel-card-guard-536-independent-review-51361740.md),114 regressions plus10 independent counterexamples, full final local governance/control-plane and exact General37960652317 Governancejob113922339704 SUCCESS. Original remote governance log75667bytes SHA256282b16b51d3c662362b592d7ae1beecd7c3284a47857b736551c035805a3d98e remains cached outside the repository. Full General was still running at review and is not claimed PASS. No pupil complaint, release or school installation is accepted by this tooling result.

Separate current.yaml selections authorize only their named bounded product authors; root530/526 priority and all task/action blockers remain effective. No new framework or product source was added.
