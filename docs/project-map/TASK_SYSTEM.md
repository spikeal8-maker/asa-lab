# Система задач ASA Lab

## 1. Где находится полное ТЗ

```text
docs/delivery/EXECUTION_MANIFEST.yaml   машиночитаемый task contract
docs/delivery/DEVELOPMENT_PROGRAM_V1.md человекочитаемая программа
docs/project-map/project-map.yaml       current focus, statuses, dependencies
GitHub Issue                             подробный scope одного user flow
docs/testing/test-catalog.yaml           команды обязательных tests
```

Владелец не пересказывает ТЗ вручную. Чат не изменяет task, capability, branch, dependency, port или exit gate.

## 2. Что хранит Execution Manifest

Для каждой canonical task:

- position;
- Issue;
- branch;
- milestone и delivery stage;
- architecture horizon;
- dependencies и next task;
- capability IDs;
- видимый результат;
- точные документы для чтения;
- test profiles и task-specific tests;
- map nodes;
- обязательные artifacts.

`delivery_stage` задаёт порядок исполнения. `architecture_horizon` описывает архитектурный контур и не используется как очередь.

## 3. Как выбирается задача

Агент выполняет только task, для которой одновременно верно:

```text
task_id = project.current_focus
task присутствует в EXECUTION_MANIFEST.yaml
status = ready | in_progress | in_review
все manifest/map depends_on = done
Issue открыта
branch соответствует manifest
```

Если current focus заблокирован, агент сообщает `BLOCKED` и не выбирает следующий task.

## 4. Каноническая очередь

```text
TASK-PRODUCT-DOC-001
→ TASK-PORTAL-001
→ TASK-PROJECT-SHELL-001
→ TASK-CHECKERS-LITE-001
→ TASK-ELECTRONICS-ALPHA-001
→ TASK-SEAT-001
→ TASK-ACT-001
→ TASK-REVIEW-001
→ TASK-ELEC-001
```

### Technical Product Alpha

```text
Teacher Portal
→ Universal Project Shell
→ Checkers Lite
→ Electronics Alpha
```

### School Pilot

```text
StudentSeat
→ Assignment/Submission
→ Review/Grade/Badge
→ Full Electronics Classroom Cycle
```

Следующая задача не начинается до merge и map transition предыдущей.

## 5. Статусы

| Status | Значение |
|---|---|
| `planned` | определена, но не входит в текущую executable очередь |
| `blocked` | dependency не завершена |
| `ready` | можно начать |
| `in_progress` | реализуется одна branch |
| `in_review` | открыт PR |
| `done` | PR merged, gate PASS, map transition выполнен |
| `deprecated` | история, реализацию не начинать |

## 6. Одна задача — один flow

Правильные границы:

```text
login → create classroom → reload
create project → save → reload → checkpoint
place source/resistor/LED → DC result → save/reload
```

Неправильно:

```text
Portal + StudentSeat + Assignments + Electronics + Deployment
```

Scope freeze действует после `in_progress`. Новая идея создаёт следующую Issue после merge.

## 7. Map lifecycle

### Start

```text
task = in_progress
current_focus = task
map_nodes = in_progress по факту
```

### Draft PR

```text
task = in_review
next task = blocked
project-map.yaml + PROJECT_MAP.md updated
QUALITY_MAP + test catalog synchronized
Nx graph regenerated for structural code changes
```

### After merge

```text
task = done
next task = ready, если dependencies done
current_focus = next task
map-only transition validated
agent stops
```

Map transition не является новой продуктовой задачей и не содержит product code.

## 8. Обязательная структура executable Issue

```markdown
## Статус
## Программа
## CAPABILITIES
## Пользовательский результат
## Scope
## Ports
## Security / tenant / audit
## Non-goals
## Acceptance
## Required test IDs
## Branch
## Report format
```

Issue дополняет manifest деталями, но не может менять его order/branch/ports/tests без нормативного PR.

## 9. Команда владельца

```text
Работай в spikeal8-maker/asa-lab. Прочитай AGENTS.md, current_focus и соответствующий entry в docs/delivery/EXECUTION_MANIFEST.yaml. Открой указанную GitHub Issue и выполни только её. Следующую задачу не начинай.
```

## 10. Проверка

```bash
python tools/run_task_tests.py --task <TASK-ID>
```

`tools/validate_delivery_program.py` сверяет:

- manifest task order;
- Issues и branches;
- map queue/dependencies/status progression;
- architecture horizon отдельно от delivery stage;
- exact required tests;
- port policy;
- map artifacts при product-code changes.

Ready/merge требуют полного PASS.

## 11. Evidence

Каждый product PR предоставляет:

- visible user result;
- commit SHA;
- полный runner report;
- canonical ports и demo URLs;
- Playwright report;
- screenshots;
- contract/migration/security artifacts;
- map/Nx changes;
- clean working tree;
- подтверждение отсутствия следующей capability;
- `NEXT_ALLOWED_TASK`.

## 12. Текущий переход

```text
TASK-PRODUCT-DOC-001 — in_review, PR 21
TASK-PORTAL-001 — blocked, PR 22 frozen
```

Сначала проверяется и принимается PR 21. Затем PR 22 rebased и выполняется только по Issue 18 / manifest entry.
