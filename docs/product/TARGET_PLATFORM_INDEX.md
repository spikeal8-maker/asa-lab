# ASA Lab Target Platform — индекс R0

До merge PR №43 этот пакет является owner-gated нормативным кандидатом. Пока `current_gate: R0`, product code не пишется.

## Целевая модель

- [`ASA_TARGET_PLATFORM_BLUEPRINT.md`](ASA_TARGET_PLATFORM_BLUEPRINT.md)
- [`ASA_TARGET_PLATFORM_BLUEPRINT.yaml`](ASA_TARGET_PLATFORM_BLUEPRINT.yaml)
- [`../architecture/ASA_IDENTITY_WORKSPACE_TRANSITION_PLAN.md`](../architecture/ASA_IDENTITY_WORKSPACE_TRANSITION_PLAN.md)

## Исполнение

- [`../delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.md`](../delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.md)
- [`../delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml`](../delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml)
- [`../delivery/R0_OWNER_DECISION.md`](../delivery/R0_OWNER_DECISION.md)
- [`../../AGENTS.md`](../../AGENTS.md)
- [`../delivery/BOT_RUNBOOK.md`](../delivery/BOT_RUNBOOK.md)

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
python tools/validate_tinkercad_parity.py
python tools/validate_target_execution.py
python tools/validate_architecture.py
python tools/validate_project_map.py
python tools/validate_test_catalog.py
```

## Текущий owner action

Открыть [`R0_OWNER_DECISION.md`](../delivery/R0_OWNER_DECISION.md), принять или отклонить пять решений, затем зафиксировать решение в PR №43. До этого R1 не начинается.
