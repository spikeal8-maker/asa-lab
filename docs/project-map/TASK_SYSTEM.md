# Система задач ASA Lab

## 1. Где находится полное ТЗ

Coding-агент получает работу из четырёх связанных источников:

1. [`../delivery/DEVELOPMENT_PROGRAM_V1.md`](../delivery/DEVELOPMENT_PROGRAM_V1.md) — каноническая последовательность этапов;
2. [`project-map.yaml`](project-map.yaml) — `current_focus`, dependencies и statuses;
3. GitHub Issue текущей задачи — исполнимое ТЗ одного user flow;
4. [`../testing/test-catalog.yaml`](../testing/test-catalog.yaml) — обязательные test IDs и команды.

Владелец не пересказывает ТЗ вручную. Чат не изменяет task, capability, port или exit gate.

## 2. Как выбирается задача

Агент выполняет только задачу, для которой верно:

```text
kind = task
TASK-ID = project.current_focus
status = ready | in_progress | in_review
все depends_on = done
Issue открыта
Issue содержит user flow, scope, non-goals, ports, acceptance и test IDs
```

Если current task уже имеет Draft PR, агент продолжает только эту ветку.

Задачи `planned`, `blocked`, `done`, `deprecated` не начинаются.

Если current focus невозможно продолжать, агент сообщает `BLOCKED`, а не выбирает следующий task.

## 3. Каноническая очередь v1

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

Очередь соответствует Epic №23 и `DEVELOPMENT_PROGRAM_V1.md`.

## 4. Два delivery tracks

### Technical Product Alpha

```text
Teacher Portal
→ Universal Project Shell
→ Checkers Lite reference module
→ Electronics Alpha
```

### School Pilot

```text
StudentSeat and Child Dashboard
→ Assignment and Immutable Submission
→ Comments Review Grade Badge
→ Full Electronics Classroom Cycle
```

Следующая задача не начинается до merge предыдущей.

## 5. Состояния

| Status | Значение |
|---|---|
| `planned` | Работа определена, но не входит в ближайшую executable queue |
| `blocked` | Обязательная dependency не завершена |
| `ready` | Задачу можно выдать агенту |
| `in_progress` | Агент реализует одну ветку |
| `in_review` | Открыт Draft/Ready PR |
| `done` | PR merged и exit gate подтверждён |
| `deprecated` | Историческая задача, реализацию не начинать |

## 6. Одна задача — один user flow

Одна executable Issue содержит один наблюдаемый результат.

Примеры правильной границы:

```text
Teacher login → create classroom → reload
```

```text
Create project → save draft → reload → checkpoint
```

```text
Place source/resistor/LED → calculate DC → save/reload
```

Неправильно объединять в одной Issue:

```text
Teacher Portal + StudentSeat + Assignments + Electronics + Deployment
```

## 7. Обязательная структура executable Issue

```markdown
# [TASK-ID] Название

## Статус
ready | blocked | in_progress | in_review

## Программа
Epic и этап Development Program.

## CAPABILITIES
- CAP-...

## Пользовательский результат
Один наблюдаемый flow.

## Dependencies
- TASK-...
- CAP-...

## Scope
- bounded contexts;
- API;
- data/migrations;
- UI;
- security/audit.

## Ports
- Web 4610;
- API 4611;
- E2E 4612.

## Non-goals
Что запрещено добавлять.

## Acceptance
Проверяемые критерии.

## Required test IDs
- TST-...

## Branch
agent/task-...

## Report format
MILESTONE / USER_FLOW / DEMO_URLS / SCREENSHOTS / TESTS / NEXT_ALLOWED_TASK.
```

## 8. Scope freeze

После status `in_progress` scope заморожен.

Допустимы:

- defect fixes текущего flow;
- security fixes обрабатываемых данных;
- contracts/migrations/tests текущего task;
- review feedback текущего PR.

Запрещены:

- следующая capability;
- unrelated refactoring;
- новый framework;
- Docker/Redis/MinIO/CI polish без прямой необходимости;
- дополнительные роли/страницы;
- изменение портов;
- новая большая документация.

Новая идея оформляется новой Issue после merge.

## 9. Порты

```text
Web  127.0.0.1:4610
API  127.0.0.1:4611
E2E  127.0.0.1:4612
```

Запрещены `3000`, `3100`, `5173`.

Занятый порт:

- не разрешает завершить чужой процесс;
- не разрешает молча выбрать другой порт;
- даёт `BLOCKED` с точной диагностикой.

## 10. Команда владельца coding-агенту

Передавайте без свободного пересказа:

```text
Работай в spikeal8-maker/asa-lab. Прочитай AGENTS.md, docs/delivery/DEVELOPMENT_PROGRAM_V1.md и current_focus из docs/project-map/project-map.yaml. Открой связанную GitHub Issue и выполни только её. Следующую задачу не начинай.
```

Этой команды достаточно.

## 11. Рабочий цикл

```text
ORIENT
→ current focus and dependency check
→ Issue and capability check
→ PLAN up to 25 lines
→ IMPLEMENT one vertical flow
→ VERIFY required test IDs
→ UPDATE maps and Nx graph
→ DRAFT PR
→ EVIDENCE and review
→ merge
→ task done
→ next task ready
→ stop
```

## 12. Одна ветка и один PR

```text
TASK-PORTAL-001
→ agent/task-portal-001
→ one PR
```

Нельзя:

- открывать competing PR для той же задачи;
- переносить половину flow в незарегистрированную ветку;
- начинать next task в текущем PR.

Если существует PR, агент продолжает его и сохраняет рабочий код, если Issue не требует иного.

## 13. Проверка

Единая команда:

```bash
python tools/run_task_tests.py --task <TASK-ID>
```

Результаты:

- `PASS` — фактический exit 0;
- `FAIL` — фактический non-zero;
- `BLOCKED` — обязательная среда отсутствует;
- `NOT_RUN` — не запускалось.

Ready/merge требуют полного обязательного PASS.

Удалять test ID из `required_for` ради зелёного отчёта запрещено.

## 14. Этапные checkpoints

Для длинной задачи агент сообщает завершённые milestones:

```text
MILESTONE:
STATUS:
VISIBLE_RESULT:
TESTS:
DEMO_URLS:
SCREENSHOTS:
BLOCKERS:
NEXT_INTERNAL_MILESTONE:
```

Checkpoint не разблокирует следующую Issue и не меняет scope.

## 15. Evidence перед Ready for review

Каждый product PR предоставляет:

- commit SHA;
- полный task runner report;
- exact demo URLs;
- canonical port report;
- Playwright report;
- screenshots;
- contract/migration/security artifacts;
- clean working tree;
- подтверждение отсутствия следующей capability в diff.

## 16. После merge

```text
PR merged
→ task = done
→ Issue = completed
→ next dependency check
→ next task = ready
→ current_focus = next task
→ agent stops
```

Следующая задача не реализуется в той же сессии.

## 17. Текущий этап

На момент принятия этой системы:

```text
TASK-PRODUCT-DOC-001 — in_review, PR №21
TASK-PORTAL-001 — blocked, PR №22 frozen
```

Сначала локально проверяется и принимается PR №21. Затем PR №22 rebased и стабилизируется строго по Issue №18.

## 18. Исторические задачи

`TASK-ENV-001`, `TASK-TEN-001`, `TASK-CLS-001`, `TASK-MVP-001`, `TASK-MOD-001` сохранены как `deprecated` и не участвуют в active queue.

Их старые тексты не являются разрешением начать работу.