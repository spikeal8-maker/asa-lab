# BOT_RUNBOOK — рабочий процесс coding-агента ASA Lab

## 1. Короткая команда владельца

```text
Работай в spikeal8-maker/asa-lab. Прочитай AGENTS.md, current_focus и соответствующий entry в docs/delivery/EXECUTION_MANIFEST.yaml. Открой указанную GitHub Issue и выполни только её. Следующую задачу не начинай.
```

Владелец не пересказывает ТЗ вручную.

## 2. Источники выполнения

```text
Product Blueprint                 что строим
Capability Map                   какие возможности и зависимости
EXECUTION_MANIFEST.yaml          task order, Issue, branch, stage, tests, map nodes
DEVELOPMENT_PROGRAM_V1.md        человекочитаемый путь
LOCAL_PORT_POLICY.md             порты и безопасный запуск
project-map.yaml                 current focus и динамические statuses
GitHub Issue                     scope одного user flow
test-catalog.yaml                команды test IDs
```

Конфликт не разрешается догадкой. Чат не меняет task ID, capability, dependency, branch, scope, port, test ID или exit gate.

## 3. ORIENT

```bash
git remote -v
git status --short --branch
git fetch --all --prune
git branch --all
```

Затем:

1. прочитать `project.current_focus`;
2. найти task entry в `EXECUTION_MANIFEST.yaml`;
3. проверить status и manifest `depends_on` против map edges;
4. открыть manifest Issue;
5. продолжить manifest branch/PR либо создать её от актуального `main`;
6. прочитать manifest `read` links;
7. получить обязательные tests из manifest profiles и test catalog;
8. проверить Port Policy для server/UI задачи.

Разрешена работа только с current focus или существующим PR этого task. `planned`, `blocked`, `done`, `deprecated` не выполняются.

## 4. CAPABILITY CHECK и PLAN

До изменения кода:

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
PLAN: максимум 25 строк
STOP_CRITERION:
```

`delivery_stage` — порядок выполнения. `architecture_horizon` — информационная архитектурная группировка и может идти не по порядку Product Alpha.

## 5. Scope freeze

После начала task разрешены только defect/security/contract/migration/test fixes текущего flow и review feedback текущего PR.

Запрещены следующая capability, дополнительные роли/страницы, unrelated refactoring, новый framework, Docker/Redis/MinIO/CI polish без прямой необходимости, изменение портов и второй competing PR.

## 6. IMPLEMENT

Один task реализует один вертикальный user flow:

```text
domain/application
→ migration/repository
→ API
→ UI
→ automated E2E
→ evidence/maps
```

Если существует PR, сохранять рабочий код и продолжать его. Переписывание с нуля требует доказанного blocker.

Архитектурные правила находятся в `AGENTS.md`; Issue определяет точный scope.

## 7. Порты

```text
Web  127.0.0.1:4610
API  127.0.0.1:4611
E2E  127.0.0.1:4612
```

Запрещены `3000`, `3100`, `5173`. При занятом порте:

- не kill процесс;
- не выбирать другой порт молча;
- вывести точный `BLOCKED`;
- остановить текущий запуск.

## 8. Промежуточные milestones

После завершённого внутреннего результата, а не каждой команды:

```text
MILESTONE:
STATUS: completed | blocked
VISIBLE_RESULT:
TESTS:
DEMO_URLS:
SCREENSHOTS:
BLOCKERS:
NEXT_INTERNAL_MILESTONE:
```

Checkpoint не меняет scope и не разблокирует следующую Issue.

## 9. VERIFY

```bash
python tools/run_task_tests.py --task <TASK-ID>
```

Runner поддерживает многочастные IDs (`TASK-PROJECT-SHELL-001`) и передаёт текущий TASK-ID validators.

- PASS — фактический exit 0;
- FAIL — фактический non-zero;
- BLOCKED — обязательная среда отсутствует;
- NOT_RUN — команда не запускалась.

`BLOCKED`/`NOT_RUN` не закрывают gate. Нельзя удалять test ID, сокращать `required_for` или заменять automated E2E ручным просмотром.

Для UI обязательны keyboard/focus/accessibility, Playwright и screenshots. Для tenant data обязательны отрицательные authz tests, отдельный test DB, runtime-role checks и отсутствие admin credentials в API.

## 10. UPDATE MAPS

Машиночитаемый map protocol находится в `EXECUTION_MANIFEST.yaml`.

### При начале

- task → `in_progress`;
- implementation nodes из `map_nodes` → `in_progress` по факту;
- `current_focus` остаётся task.

### В Draft PR

- task → `in_review`;
- `project-map.yaml` и `PROJECT_MAP.md` отражают реальные nodes/paths/edges;
- `QUALITY_MAP.md` и test catalog отражают точный gate;
- `nx-project-graph.json` регенерирован при изменении структуры кода;
- next task остаётся `blocked`.

Product-code diff без этих map artifacts должен падать на `TST-DEVELOPMENT-PROGRAM-001`.

## 11. DRAFT PR

Один task — один Draft PR. Body содержит:

- TASK/Issue/Milestone/Capabilities;
- visible result и user flow;
- non-goals;
- API/data/security impact;
- ports;
- map/Nx changes;
- test IDs и реальные статусы;
- demo URLs;
- screenshots/artifacts;
- rollout/rollback;
- `NEXT_ALLOWED_TASK`.

Draft разрешён с честными FAIL/BLOCKED/NOT_RUN. Ready/merge требуют полного PASS.

## 12. MERGE и обязательный map transition

После review и полного exit gate:

1. merge task PR;
2. синхронизировать `main`;
3. сделать map-only transition commit/PR:
   - task → `done`;
   - next task → `ready`, если dependencies done;
   - `current_focus` → `next_task`;
   - implementation nodes/stage обновлены;
   - `project-map.yaml` и `PROJECT_MAP.md` синхронизированы;
4. запустить governance validators;
5. Issue → completed;
6. остановиться.

Если repository не разрешает прямой map-only commit в `main`, открыть и объединить маленький transition PR. Product code в нём запрещён.

Следующая задача не реализуется в той же сессии.

## 13. Финальный отчёт

```text
MILESTONE:
TASK:
ISSUE:
STATUS:
VISIBLE_RESULT:
CAPABILITIES:
USER_FLOW:
  ... PASS|FAIL|BLOCKED
PORTS:
BRANCH:
COMMITS:
FILES_CHANGED:
MAP_NODES_CHANGED:
TESTS_RUN:
ARTIFACTS:
DEMO_URLS:
SCREENSHOTS:
BLOCKERS:
RESIDUAL_RISKS:
WORKING_TREE:
NEXT_ALLOWED_TASK:
NEXT_COMMAND:
```

Отчёт начинается с видимого результата, не с установленных инструментов.

## 14. Каноническая очередь

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

Очередь изменяется только синхронной правкой Execution Manifest, Development Program, Project Map, Issues и test catalog в нормативном PR.
