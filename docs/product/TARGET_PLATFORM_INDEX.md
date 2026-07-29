# ASA Lab Target Platform — индекс R0

До merge PR №43 этот пакет является owner-gated нормативным кандидатом. Пока `current_gate: R0`, product code не пишется.

## Целевая модель

- [`ASA_TARGET_PLATFORM_BLUEPRINT.md`](ASA_TARGET_PLATFORM_BLUEPRINT.md)
- [`ASA_TARGET_PLATFORM_BLUEPRINT.yaml`](ASA_TARGET_PLATFORM_BLUEPRINT.yaml)
- [`../architecture/ASA_IDENTITY_WORKSPACE_TRANSITION_PLAN.md`](../architecture/ASA_IDENTITY_WORKSPACE_TRANSITION_PLAN.md)
- [`../architecture/R1_ACCOUNT_WORKSPACE_MIGRATION_CONTRACT.yaml`](../architecture/R1_ACCOUNT_WORKSPACE_MIGRATION_CONTRACT.yaml) — additive R1 contract, неактивный до R0D.

## Исполнение и решения

- [`../delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN_R0.md`](../delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN_R0.md) — актуальный owner-gated human contract;
- [`../delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml`](../delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml) — machine-readable release/branch/Issue contract;
- [`../delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.md`](../delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.md) — подробный design/workstream документ;
- [`../delivery/R0_CONVERGENCE_CURRENT_STATE.md`](../delivery/R0_CONVERGENCE_CURRENT_STATE.md) — текущие роли веток и freeze;
- [`../delivery/R0_OWNER_DECISION.md`](../delivery/R0_OWNER_DECISION.md) — пять решений владельца;
- [`../delivery/R0_OWNER_DECISION.yaml`](../delivery/R0_OWNER_DECISION.yaml) — machine-readable target-contract decision;
- [`../delivery/R0_FOUNDATION_REVIEW_PR34.md`](../delivery/R0_FOUNDATION_REVIEW_PR34.md) — owner checklist ограниченного Electronics/Project foundation;
- [`../delivery/R0_FOUNDATION_DECISION.yaml`](../delivery/R0_FOUNDATION_DECISION.yaml) — machine-readable PR №34 decision и corrective items;
- [`../delivery/R0_R1_CANDIDATE_SELECTION.md`](../delivery/R0_R1_CANDIDATE_SELECTION.md) — сравнение PR №59/№60;
- [`../delivery/R0_R1_CANDIDATE_DECISION.yaml`](../delivery/R0_R1_CANDIDATE_DECISION.yaml) — deferred/selected R1 candidate state;
- [`../delivery/R0_POST_MERGE_TRANSITION.yaml`](../delivery/R0_POST_MERGE_TRANSITION.yaml) — R0A–R0D после merge, без раннего R1;
- [`../delivery/R0_BASELINE_PRESERVATION_CONTRACT.yaml`](../delivery/R0_BASELINE_PRESERVATION_CONTRACT.yaml) — данные и flows, которые R0B обязан сохранить;
- [`../delivery/R0_LEGACY_TRACEABILITY.yaml`](../delivery/R0_LEGACY_TRACEABILITY.yaml) — mapping старых v1 tasks/Issues в R0–R10;
- [`../project-map/R0_TARGET_RELEASE_MAP.yaml`](../project-map/R0_TARGET_RELEASE_MAP.yaml) — неактивный шаблон release-карты;
- [`../testing/ASA_TARGET_TEST_MATRIX.yaml`](../testing/ASA_TARGET_TEST_MATRIX.yaml) — неактивные test profiles, release tests, artifacts и owner flows;
- [`../delivery/R0_VALIDATION_MATRIX.md`](../delivery/R0_VALIDATION_MATRIX.md) — что доказывает каждый gate;
- [`../../AGENTS.md`](../../AGENTS.md);
- [`../../START_HERE_FOR_AI.md`](../../START_HERE_FOR_AI.md);
- [`../delivery/BOT_RUNBOOK.md`](../delivery/BOT_RUNBOOK.md).

## Reference parity и evidence

- [`TINKERCAD_PARITY_SPEC.md`](TINKERCAD_PARITY_SPEC.md)
- [`TINKERCAD_PARITY_MATRIX.yaml`](TINKERCAD_PARITY_MATRIX.yaml)
- [`TINKERCAD_PARITY_DEVIATIONS.yaml`](TINKERCAD_PARITY_DEVIATIONS.yaml)
- [`TINKERCAD_EDUCATOR_CLASSROOM_PARITY_SPEC.md`](TINKERCAD_EDUCATOR_CLASSROOM_PARITY_SPEC.md)
- [`reference/`](reference/)

## R0–R10

```text
R0  Contract and one accepted baseline
R1  Account / Personal Workspace / Sessions / Educator Grant
R2  Creator Home and capability-aware Portal shell
R3  Module Registry / Project Hub / shared Editor Host
R4  Electronics parity
R5  Classroom / class code / StudentSeat / Safe Mode
R6  Learner portfolio / audited teacher Project Viewer
R7  Sharing / publication / public page / Remix
R8  Profiles / Explore / Collections / moderation
R9  Activities / assignments / submissions / review / grades / badges
R10 Multi-module lifecycle proof and measured operations scale
```

Строгий delivery order всегда R0 → R1 → … → R10. Архитектурная готовность зависимости не разрешает перескочить через следующий release.

## Инварианты

- Account, Principal, Workspace, capability и membership различаются.
- Personal Workspace создаётся ровно один раз и в первой версии backed by tenant boundary.
- `tenant_id` и RLS сохраняются.
- Personal Project не требует Classroom.
- educator — capability Account.
- Account session и StudentSeat session различаются.
- ProjectDraft mutable; ProjectVersion immutable.
- Publication/Submission ссылаются на точную ProjectVersion.
- Core не содержит subject switches.
- Tests не заменяют owner visual/product acceptance.

## Проверка R0

```text
python tools/validate_r0.py
```

Wrapper включает 19 gates:

```text
validate_r0_diff.py
validate_r0_contract_refs.py
validate_r0_human_contract.py
validate_r0_owner_decision.py
validate_r0_foundation_decision.py
validate_r0_post_merge.py
validate_r0_baseline_preservation.py
validate_r0_release_map.py
validate_r0_legacy_traceability.py
validate_r0_review_packets.py
validate_r0_r1_candidate_decision.py
validate_target_test_matrix.py
validate_r1_migration_contract.py
validate_tinkercad_parity.py
validate_target_execution.py
validate_architecture.py
validate_project_map.py
validate_test_catalog.py
validate_r0_github_state.py
```

## Текущий owner action

1. Проверить PR №34 по [`R0_FOUNDATION_REVIEW_PR34.md`](../delivery/R0_FOUNDATION_REVIEW_PR34.md); corrective items и решение фиксируются в [`R0_FOUNDATION_DECISION.yaml`](../delivery/R0_FOUNDATION_DECISION.yaml).
2. Открыть [`R0_OWNER_DECISION.md`](../delivery/R0_OWNER_DECISION.md) и принять/отклонить пять решений; состояние фиксируется в [`R0_OWNER_DECISION.yaml`](../delivery/R0_OWNER_DECISION.yaml).
3. После технического R0 PASS и двух owner decisions выполнить rebase/merge PR №43.
4. PR №59/№60 выбираются только в R0C по [`R0_R1_CANDIDATE_SELECTION.md`](../delivery/R0_R1_CANDIDATE_SELECTION.md); состояние фиксируется в [`R0_R1_CANDIDATE_DECISION.yaml`](../delivery/R0_R1_CANDIDATE_DECISION.yaml).

До этого R1 не начинается.
