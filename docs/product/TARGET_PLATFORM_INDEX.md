# ASA Lab Target Platform — индекс R0

До merge PR №43 этот пакет является owner-gated нормативным кандидатом. Пока `current_gate: R0`, product code не пишется.

## Целевая модель

- [`ASA_TARGET_PLATFORM_BLUEPRINT.md`](ASA_TARGET_PLATFORM_BLUEPRINT.md)
- [`ASA_TARGET_PLATFORM_BLUEPRINT.yaml`](ASA_TARGET_PLATFORM_BLUEPRINT.yaml)
- [`ASA_VISUAL_PRODUCT_SYSTEM.md`](ASA_VISUAL_PRODUCT_SYSTEM.md) — единая визуальная система Portal, Learner, Editor и Admin;
- [`ASA_TINKERCAD_100_PERCENT_SCOPE.yaml`](ASA_TINKERCAD_100_PERCENT_SCOPE.yaml) — полный functional-parity scope и честное правило заявления 100%;
- [`ASA_COMPLETE_INTERFACE_BLUEPRINT.md`](ASA_COMPLETE_INTERFACE_BLUEPRINT.md) — human blueprint всех интерфейсных контуров;
- [`ASA_PRODUCT_SURFACE_CATALOG.yaml`](ASA_PRODUCT_SURFACE_CATALOG.yaml) — полный каталог маршрутов, ролей, действий, состояний и screenshots;
- [`interface-catalog.html`](interface-catalog.html) — визуальный owner-каталог страниц, Electronics tools и parity capabilities;
- [`ASA_ELECTRONICS_WORKBENCH_COMPLETE_SPEC.md`](ASA_ELECTRONICS_WORKBENCH_COMPLETE_SPEC.md) — полная human-спецификация электронной лаборатории;
- [`ASA_ELECTRONICS_TOOL_CATALOG.yaml`](ASA_ELECTRONICS_TOOL_CATALOG.yaml) — инструменты, component families, instruments, code, Arduino, micro:bit и evidence gaps;
- [`ASA_STUDENT_EXPERIENCE_SPEC.md`](ASA_STUDENT_EXPERIENCE_SPEC.md) — Registered learner и StudentSeat;
- [`ASA_ADMIN_CONSOLE_SPEC.md`](ASA_ADMIN_CONSOLE_SPEC.md) — School/Organization и Platform Administration;
- [`../architecture/ASA_IDENTITY_WORKSPACE_TRANSITION_PLAN.md`](../architecture/ASA_IDENTITY_WORKSPACE_TRANSITION_PLAN.md)
- [`../architecture/R1_ACCOUNT_WORKSPACE_MIGRATION_CONTRACT.yaml`](../architecture/R1_ACCOUNT_WORKSPACE_MIGRATION_CONTRACT.yaml) — additive R1 contract, неактивный до R0D.

## Исполнение и решения

- [`../delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN_R0.md`](../delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN_R0.md) — актуальный owner-gated human contract;
- [`../delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml`](../delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml) — machine-readable release/branch/Issue contract;
- [`../delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.md`](../delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.md) — подробный design/workstream документ;
- [`../delivery/R0_CONVERGENCE_CURRENT_STATE.md`](../delivery/R0_CONVERGENCE_CURRENT_STATE.md) — текущие роли веток и freeze;
- [`../delivery/R0_OWNER_DECISION.md`](../delivery/R0_OWNER_DECISION.md) — пять решений владельца;
- [`../delivery/R0_OWNER_DECISION.yaml`](../delivery/R0_OWNER_DECISION.yaml) — machine-readable target-contract decision;
- [`../delivery/R0_FOUNDATION_REVIEW_PR34.md`](../delivery/R0_FOUNDATION_REVIEW_PR34.md) — owner checklist Project/Electronics foundation;
- [`../delivery/R0_FOUNDATION_DECISION.yaml`](../delivery/R0_FOUNDATION_DECISION.yaml) — machine-readable PR №34 decision и corrective items;
- [`../delivery/R0_R1_CANDIDATE_SELECTION.md`](../delivery/R0_R1_CANDIDATE_SELECTION.md) — сравнение PR №59/№60;
- [`../delivery/R0_R1_CANDIDATE_DECISION.yaml`](../delivery/R0_R1_CANDIDATE_DECISION.yaml) — deferred/selected R1 candidate state;
- [`../delivery/R0_POST_MERGE_TRANSITION.yaml`](../delivery/R0_POST_MERGE_TRANSITION.yaml) — R0A–R0D после merge, без раннего R1;
- [`../delivery/R0_BASELINE_PRESERVATION_CONTRACT.yaml`](../delivery/R0_BASELINE_PRESERVATION_CONTRACT.yaml) — данные и flows, которые R0B обязан сохранить;
- [`../delivery/R0_BASELINE_MANIFEST.schema.json`](../delivery/R0_BASELINE_MANIFEST.schema.json) — безопасный формат baseline evidence;
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

## Что означает 100%

Цель — не буквальная кража кода/бренда/ассетов и не пиксельная копия. Цель — **100% функциональное соответствие подтверждённому reference scope** с независимым кодом, брендом ASA Lab и owner assets.

Заявление `100% functional parity` разрешено только когда:

- every required capability = `parity_pass` или `approved_deviation`;
- все `evidence_required` разрешены reference capture или owner decision;
- desktop/mobile/live owner flows приняты;
- child-safety, authorization, accessibility и data-preservation gates PASS;
- документация и unit tests не подменяют runtime evidence.

Текущий claim в `ASA_TINKERCAD_100_PERCENT_SCOPE.yaml`:

```text
not_100_percent
```

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
R10 Multi-module lifecycle, 3D, Codeblocks, Sim Lab, mobile/integrations and measured operations proof
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
- `evidence_required` блокирует parity claim.
- Админка не является вкладкой Teacher Portal и появляется только по server grants.

## Проверка R0

```text
python tools/validate_r0.py
```

Wrapper включает 25 gates:

```text
validate_r0_diff.py
validate_r0_contract_refs.py
validate_r0_human_contract.py
validate_r0_owner_decision.py
validate_r0_foundation_decision.py
validate_r0_convergence_actions.py
validate_r0_post_merge.py
validate_r0_baseline_preservation.py
validate_r0_baseline_tool.py
validate_r0_release_map.py
validate_r0_legacy_traceability.py
validate_r0_review_packets.py
validate_r0_r1_candidate_decision.py
validate_target_test_matrix.py
validate_r1_migration_contract.py
validate_tinkercad_parity.py
validate_complete_product_interfaces.py
validate_target_execution.py
validate_architecture.py
validate_project_map.py
validate_test_catalog.py
validate_r0_pr34_remote.py
validate_r0_pr34_api_validation_remote.py
validate_r0_pr34_openapi_remote.py
validate_r0_github_state.py
```

## Как открыть визуальный каталог

Из корня репозитория:

```text
python -m http.server 8080
```

Открыть:

```text
http://127.0.0.1:8080/docs/product/interface-catalog.html
```

Каталог показывает:

- все страницы;
- роли и маршруты;
- implementation status;
- required states/actions/screenshots;
- все Electronics tools;
- полный weighted parity scope;
- текущий честный статус `100% parity: не подтверждена`.

## Текущий owner action

1. Открыть визуальный каталог интерфейсов и проверить полноту экранов/инструментов.
2. Проверить PR №34 по [`R0_FOUNDATION_REVIEW_PR34.md`](../delivery/R0_FOUNDATION_REVIEW_PR34.md); corrective items и решение фиксируются в [`R0_FOUNDATION_DECISION.yaml`](../delivery/R0_FOUNDATION_DECISION.yaml).
3. Открыть [`R0_OWNER_DECISION.md`](../delivery/R0_OWNER_DECISION.md) и принять/отклонить пять решений; состояние фиксируется в [`R0_OWNER_DECISION.yaml`](../delivery/R0_OWNER_DECISION.yaml).
4. После PR №34 `accepted_merged`, технического R0 PASS и target owner approval выполнить один final rebase/merge PR №43.
5. PR №59/№60 выбираются только в R0C по [`R0_R1_CANDIDATE_SELECTION.md`](../delivery/R0_R1_CANDIDATE_SELECTION.md).

До этого R1 не начинается.
