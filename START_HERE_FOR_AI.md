# START_HERE_FOR_AI — вход coding-агента в ASA Lab

## 1. Миссия

ASA Lab — единая образовательная платформа:

```text
teacher and child identity
→ classrooms
→ universal projects
→ subject modules
→ assignments
→ immutable submissions
→ comments/review
→ grade/badge/progress
```

Приоритетный предметный модуль — Electronics. Checkers Lite используется только как маленький reference module для проверки Module SDK.

## 2. Не выбирай задачу самостоятельно

Текущая задача определяется только:

```text
docs/project-map/project-map.yaml
project.current_focus
```

Порядок разработки определяется:

```text
docs/delivery/DEVELOPMENT_PROGRAM_V1.md
```

Канонические локальные порты определяются:

```text
docs/delivery/LOCAL_PORT_POLICY.md
```

Чат не меняет current focus, capability, dependency, scope, ports или test gate.

## 3. Первые действия

```bash
git remote -v
git status --short --branch
git fetch --all --prune
git branch --all
```

Затем:

1. прочитай `AGENTS.md`;
2. прочитай `project.current_focus` и task node;
3. открой связанную GitHub Issue;
4. проверь status и все `depends_on`;
5. найди существующую branch/PR задачи;
6. прочитай раздел текущего этапа в `DEVELOPMENT_PROGRAM_V1.md`;
7. прочитай перечисленные Issue capability entries;
8. прочитай только явно указанные Issue разделы профильных specs;
9. прочитай required test IDs;
10. проверь port policy.

Не нужно перечитывать все документы полностью, если Issue указывает точные разделы.

## 4. Разрешённая работа

Работа разрешена только если:

- task совпадает с current focus; или продолжается уже открытый PR этого task;
- task status `ready`, `in_progress` или `in_review`;
- dependencies `done`;
- Issue содержит user flow, scope, non-goals, ports, acceptance и tests.

Если task `blocked`, `planned`, `done` или `deprecated`, код не писать.

## 5. Обязательный первый отчёт

```text
TASK:
ISSUE:
MILESTONE:
CAPABILITIES:
DEPENDENCIES:
USER_FLOW:
NON_GOALS:
PORTS:
  web: 127.0.0.1:4610
  api: 127.0.0.1:4611
  e2e: 127.0.0.1:4612
PLAN: максимум 25 строк
STOP_CRITERION:
```

При конфликте остановись и назови конфликтующие документы. Не разрешай его догадкой.

## 6. Каноническая программа v1

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
→ Project Shell
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

Следующую задачу нельзя начинать до merge текущей.

## 7. Scope freeze

После начала task запрещено добавлять:

- следующую capability;
- дополнительные роли/страницы;
- unrelated refactoring;
- Docker/Redis/MinIO/CI polish без фактической необходимости;
- новый framework;
- большую документационную программу;
- advanced/future module features.

Новая идея оформляется новой Issue после merge текущего PR.

## 8. Порты

```text
Web  127.0.0.1:4610
API  127.0.0.1:4611
E2E  127.0.0.1:4612
```

Запрещены:

```text
3000
3100
5173
```

Если порт занят:

- не kill процесс;
- не менять порт молча;
- вывести BLOCKED;
- остановить запуск.

## 9. Реализация

Один task должен завершиться полным вертикальным flow:

```text
domain/application
→ migration/repository
→ API
→ UI
→ automated E2E
→ artifacts/maps
```

`apps/api` и `apps/web` — adapters. Domain не импортирует framework, PostgreSQL client или React.

Classroom/Project Core не импортируют subject module internals.

## 10. Проверка

Единая команда:

```bash
python tools/run_task_tests.py --task <TASK-ID>
```

Дополнительно выполнить команды Issue.

Статусы:

- PASS — фактически выполнено успешно;
- FAIL — фактически выполнено и упало;
- BLOCKED — обязательная среда отсутствует;
- NOT_RUN — не запускалось.

BLOCKED и NOT_RUN не позволяют Ready/merge.

Manual browser smoke не заменяет automated E2E.

## 11. Этапная отчётность

После завершённого внутреннего milestone:

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

Не сообщай каждую низкоуровневую команду. Показывай проверенный результат.

## 12. Draft PR

Один task — один Draft PR.

PR содержит:

- Issue/TASK/Milestone;
- capabilities;
- user flow;
- non-goals;
- affected contexts;
- API/data/migrations;
- tenant/authz/audit impact;
- ports;
- test results;
- demo URLs;
- screenshots/artifacts;
- map/Nx changes;
- `NEXT_ALLOWED_TASK`.

## 13. После merge

1. task → `done`;
2. Issue → completed;
3. next task → `ready`, если dependencies done;
4. current focus → next task;
5. остановись;
6. next task не реализуй в этой сессии.

## 14. Короткая команда владельца

```text
Работай в spikeal8-maker/asa-lab. Прочитай AGENTS.md, docs/delivery/DEVELOPMENT_PROGRAM_V1.md и current_focus из docs/project-map/project-map.yaml. Открой связанную GitHub Issue и выполни только её. Следующую задачу не начинай.
```

Этой команды достаточно. Всё ТЗ находится в GitHub.