# BOT_RUNBOOK — управление coding-агентами ASA Lab

Этот документ задаёт обязательный процесс разработки. Агент не выбирает произвольную работу, не переопределяет продукт через чат и не начинает следующую задачу до merge текущей.

## 1. Источники истины

Порядок приоритета:

1. более поздняя принятая ADR;
2. `AGENTS.md`;
3. `docs/product/PRODUCT_BLUEPRINT.md`;
4. `docs/product/CAPABILITY_MAP.yaml`;
5. `docs/delivery/DEVELOPMENT_PROGRAM_V1.md`;
6. `docs/delivery/LOCAL_PORT_POLICY.md`;
7. детальная продуктовая спецификация затронутого контура;
8. `docs/architecture/ARCHITECTURE_BASELINE.md` и профильные документы;
9. исполняемые contracts: OpenAPI, JSON Schema, migrations, event schemas;
10. `docs/project-map/project-map.yaml`;
11. GitHub Issue текущей задачи;
12. `docs/testing/test-catalog.yaml`;
13. остальные документы.

Чат может уточнить выполнение, но не меняет молча task ID, capability, scope, dependency, порт, test ID или exit gate.

При конфликте агент:

1. прекращает изменения;
2. указывает два конфликтующих источника;
3. не выбирает один из них по догадке;
4. не пишет код до исправления Issue/карты/ADR.

## 2. Короткая команда владельца

Владелец не должен пересказывать ТЗ. Достаточно:

```text
Работай в spikeal8-maker/asa-lab. Прочитай AGENTS.md, docs/delivery/DEVELOPMENT_PROGRAM_V1.md и current_focus из docs/project-map/project-map.yaml. Открой связанную GitHub Issue и выполни только её. Следующую задачу не начинай.
```

## 3. ORIENT после новой сессии

```bash
git remote -v
git status --short --branch
git fetch --all --prune
git branch --all
```

Затем:

1. открыть `project.current_focus`;
2. найти task node в `project-map.yaml`;
3. проверить task status;
4. проверить все `depends_on`;
5. открыть связанную GitHub Issue;
6. определить существующую ветку/PR задачи;
7. прочитать только релевантный раздел Development Program;
8. прочитать capability entries и явно указанные Issue разделы;
9. прочитать test IDs задачи;
10. проверить Port Policy для UI/server задачи.

Агент не обязан перечитывать всю продуктовую документацию, если Issue даёт точные ссылки.

## 4. Выбор задачи

Разрешена работа только если task:

- совпадает с `current_focus`; или
- уже имеет status `in_progress`/`in_review` и агент продолжает существующий PR;
- находится в `execution_queue`;
- имеет завершённые dependencies;
- имеет GitHub Issue;
- имеет хотя бы один test ID.

Задачи `planned`, `blocked`, `done`, `deprecated` не начинаются.

Следующая задача не может быть начата в той же сессии после завершения текущей.

## 5. CAPABILITY CHECK

До плана агент выводит:

```text
TASK: TASK-...
ISSUE: #...
MILESTONE: ...
CAPABILITIES:
- CAP-...
DEPENDENCIES:
- TASK-... done
- CAP-... satisfied|included|blocked
USER_FLOW:
...
NON_GOALS:
...
PORTS:
- web 127.0.0.1:4610
- api 127.0.0.1:4611
- e2e 127.0.0.1:4612
```

Если capability dependency не завершена и не включена явно в текущий vertical slice, задача `BLOCKED`.

## 6. PLAN

План обычной задачи — максимум 25 строк.

Он содержит:

- пользовательский flow;
- bounded contexts;
- изменяемые приложения/пакеты;
- API/data/schema impact;
- tenant/authz/audit impact;
- UX states;
- test IDs;
- логические коммиты;
- stop criterion.

План не должен превращаться в отдельный проект по инфраструктуре.

## 7. Scope freeze

После начала реализации scope заморожен.

Допустимы:

- defect fix внутри user flow;
- security fix данных текущей задачи;
- contract/migration/test update, необходимый текущему flow;
- review feedback по текущему PR.

Запрещены:

- следующая capability;
- дополнительные роли и страницы;
- unrelated refactoring;
- новый framework;
- Docker/Redis/MinIO/CI polish без фактической необходимости;
- новая большая документация;
- federal-scale optimization;
- изменение портов.

Новая идея оформляется новой Issue после merge текущей.

## 8. IMPLEMENT

### 8.1. Один vertical slice

Реализуется полный наблюдаемый пользовательский flow текущей Issue, а не набор disconnected layers.

Правильный порядок внутри задачи:

```text
domain/application contract
→ migration/repository
→ API
→ UI
→ automated E2E
→ maps/evidence
```

Допускается другой порядок, если он уменьшает риск, но final result должен быть вертикальным.

### 8.2. Existing PR

Если Issue связана с существующим PR:

- продолжать существующую ветку;
- сохранять рабочий код;
- не переписывать с нуля без доказанной необходимости;
- rebase/merge нормативные изменения до remediation;
- не открывать второй competing PR.

### 8.3. Framework boundaries

- `apps/api` и `apps/web` — composition roots/adapters;
- domain не импортирует NestJS, pg, React, HTTP, Redis или object storage SDK;
- cross-context interaction — через public ports/contracts;
- предметный module не импортирует Core internals;
- Core не содержит subject-specific conditionals.

## 9. Port Policy

Обязательные defaults:

```text
Web  127.0.0.1:4610
API  127.0.0.1:4611
E2E  127.0.0.1:4612
```

Запрещены `3000`, `3100`, `5173`.

Если порт занят:

- не kill процесс;
- не выбирать другой порт молча;
- вывести точный `BLOCKED`;
- назвать порт и тип server;
- остановить текущий запуск.

Подробности: `LOCAL_PORT_POLICY.md`.

## 10. Промежуточные checkpoints

Для длинной задачи агент сообщает только завершённые внутренние milestones, а не каждую команду.

Пример:

```text
MILESTONE: Technical Alpha 2 / Database and API
STATUS: completed
VISIBLE_RESULT: project can be created through API and draft survives reload
TESTS:
  TST-PROJECT-SHELL-001 PASS
DEMO_URLS: not yet — UI milestone next
BLOCKERS: none
NEXT_INTERNAL_MILESTONE: React project list and module host
```

Checkpoint:

- не меняет scope;
- не является `done`;
- не разрешает следующую Issue;
- показывает фактический, уже проверенный результат.

## 11. VERIFY

Агент запускает:

```bash
python tools/run_task_tests.py --task <TASK-ID>
```

Плюс команды, которые Issue требует явно.

Статусы:

- `PASS` — команда выполнена, exit code 0;
- `FAIL` — команда выполнена и упала;
- `BLOCKED` — обязательная среда отсутствует;
- `NOT_RUN` — команда не запускалась.

`BLOCKED` и `NOT_RUN` не закрывают gate.

Нельзя:

- удалять test ID ради зелёного отчёта;
- сокращать `required_for` после начала задачи;
- заменять тест ручным утверждением;
- объявлять manual browser smoke автоматизированным E2E.

## 12. Проверка UI-задачи

Обязательно:

- loading;
- empty;
- error;
- success;
- conflict при применимости;
- keyboard navigation;
- focus management;
- automated accessibility path;
- browser E2E;
- screenshot основного состояния;
- screenshot diagnostic/error state при применимости;
- canonical port report.

## 13. Проверка security/data задачи

По применимости:

- server-derived tenant context;
- cross-tenant negative matrix;
- runtime role and RLS defense-in-depth;
- no admin DB credentials in API;
- session/credential revocation;
- secrets absent from logs/artifacts;
- audit events;
- idempotency/duplicate handling;
- test database isolation;
- dependency advisory/license gate.

## 14. UPDATE MAPS

В том же PR обновляются, если изменились:

- task status;
- task dependency;
- application/context/module node;
- code path;
- capability/release boundary;
- test ID;
- Nx dependency.

Файлы:

- `docs/project-map/project-map.yaml`;
- `docs/project-map/PROJECT_MAP.md`;
- `docs/project-map/QUALITY_MAP.md`;
- `docs/testing/test-catalog.yaml`;
- `docs/project-map/nx-project-graph.json`;
- Capability Map только при реальном изменении capability.

Косметически переписывать карты в каждой задаче не нужно.

## 15. DRAFT PR

Один task — один Draft PR.

PR body содержит:

- TASK/Issue/Milestone;
- capability IDs;
- user flow;
- non-goals;
- affected contexts;
- API/data/events;
- tenant/authz/audit impact;
- ports;
- test IDs and actual statuses;
- demo URLs;
- screenshots/artifacts;
- rollout/rollback;
- known limitations;
- map/Nx impact;
- `NEXT_ALLOWED_TASK`.

Draft можно открыть с честными FAIL/BLOCKED/NOT_RUN. Ready и merge требуют полного PASS.

## 16. MERGE и переход

После подтверждённого exit gate:

1. PR → Ready;
2. review;
3. merge;
4. task → done;
5. Issue → completed;
6. next task → ready, если dependencies done;
7. `current_focus` → next task;
8. агент останавливается.

Агент не реализует next task сразу после merge.

## 17. Стандартный финальный отчёт

```text
MILESTONE:
TASK:
ISSUE:
STATUS: blocked | in_progress | in_review | done
CAPABILITIES:
USER_FLOW:
  ... PASS|FAIL|BLOCKED
PORTS:
  web: 127.0.0.1:4610
  api: 127.0.0.1:4611
  e2e: 127.0.0.1:4612
BRANCH:
COMMITS:
FILES_CHANGED:
MAP_NODES_CHANGED:
TESTS_RUN:
ARTIFACTS:
DEMO_URLS:
BLOCKERS:
RESIDUAL_RISKS:
WORKING_TREE: clean|dirty
NEXT_ALLOWED_TASK:
NEXT_COMMAND:
```

Отчёт начинается с пользовательского результата, не с установленных инструментов.

## 18. Каноническая очередь v1

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

Очередь изменяется только через Development Program, Project Map, Issues и test catalog в одном нормативном PR.

## 19. Local-first verification

GitHub-hosted Actions не является источником обязательного PASS, пока аккаунт блокирует hosted jobs.

Обязательный gate доказывается локальным task runner с commit SHA. Это не разрешает ослаблять тесты.

Возврат managed CI оформляется отдельным решением после появления фактической потребности.

## 20. Запрет на управление через посредника

Владелец не должен быть ручной прокладкой между двумя агентами.

Если консультант или другой агент предлагает изменение:

1. изменение оформляется в GitHub Issue/Program/Map;
2. executable agent читает GitHub;
3. владелец передаёт только короткую команду запуска;
4. итог проверяется по PR, evidence и test IDs.

Устная команда без обновления GitHub не меняет текущую задачу.