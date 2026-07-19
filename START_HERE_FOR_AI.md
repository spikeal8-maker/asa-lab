# START_HERE_FOR_AI — вход coding-агента в ASA Lab

## Миссия

ASA Lab — единая образовательная платформа:

```text
teacher/child identity
→ classroom
→ universal project
→ subject module
→ assignment
→ immutable submission
→ review/comment
→ grade/badge/progress
```

Приоритетный предметный результат — Electronics. Checkers Lite является только маленьким reference module для проверки Module SDK.

## Не выбирай задачу самостоятельно

Текущая задача определяется четырьмя связанными источниками:

```text
docs/project-map/project-map.yaml        current_focus и status
docs/delivery/EXECUTION_MANIFEST.yaml   Issue, branch, stage, dependencies, ports, tests
docs/delivery/DEVELOPMENT_PROGRAM_V1.md человекочитаемый путь
tекущая GitHub Issue                     исполнимый scope одного user flow
```

Чат не меняет task, capability, dependency, branch, scope, port или test gate.

## Первые действия

```bash
git remote -v
git status --short --branch
git fetch --all --prune
git branch --all
```

Затем:

1. прочитай `AGENTS.md`;
2. прочитай `project.current_focus`;
3. найди entry того же task в `EXECUTION_MANIFEST.yaml`;
4. проверь status и все `depends_on`;
5. открой Issue и branch из manifest;
6. прочитай только manifest `read` links и раздел текущего этапа;
7. выведи CAPABILITY CHECK и PLAN максимум на 25 строк;
8. реализуй только текущий user flow.

Если task `blocked`, `planned`, `done` или `deprecated`, код не писать. Если current focus нельзя продолжить, сообщить `BLOCKED`, а не выбирать следующую задачу.

## Каноническая очередь

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

`delivery_stage` задаёт эту очередь. `architecture_horizon` в manifest — информационная группировка, а не порядок исполнения.

## Порты

```text
Web  127.0.0.1:4610
API  127.0.0.1:4611
E2E  127.0.0.1:4612
```

Запрещены `3000`, `3100`, `5173`. Занятый порт даёт `BLOCKED`; чужой процесс не останавливать.

## Обязательный первый отчёт

```text
TASK:
ISSUE:
MILESTONE:
DELIVERY_STAGE:
ARCHITECTURE_HORIZON:
CAPABILITIES:
DEPENDENCIES:
USER_FLOW:
NON_GOALS:
PORTS:
PLAN:
STOP_CRITERION:
```

## Рабочий цикл

```text
ORIENT
→ manifest/Issue check
→ PLAN
→ IMPLEMENT one vertical flow
→ VERIFY manifest test IDs
→ UPDATE project/quality/Nx maps
→ Draft PR
→ evidence/review
→ merge
→ mandatory map-only transition
→ next task ready
→ stop
```

## Проверка

```bash
python tools/run_task_tests.py --task <TASK-ID>
```

`PASS` существует только после фактического exit 0. `BLOCKED` и `NOT_RUN` не разрешают Ready/merge. Manual browser smoke не заменяет automated E2E.

## Map transition

В task PR карта показывает task `in_review`. После merge обязательно:

- task → `done`;
- next task → `ready`;
- `current_focus` → next task;
- `project-map.yaml` и `PROJECT_MAP.md` синхронизированы;
- validators PASS;
- агент останавливается.

## Команда владельца

```text
Работай в spikeal8-maker/asa-lab. Прочитай AGENTS.md, current_focus и соответствующий entry в docs/delivery/EXECUTION_MANIFEST.yaml. Открой указанную GitHub Issue и выполни только её. Следующую задачу не начинай.
```

Этой команды достаточно. Полное ТЗ находится в GitHub.
