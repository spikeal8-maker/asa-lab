# AGENTS.md — обязательный контракт coding-агента ASA Lab

Этот файл обязателен для Codex, других coding-агентов и разработчиков. Нарушение правила с severity `error` блокирует merge.

## 1. Источники истины

Порядок приоритета:

1. более поздняя принятая ADR;
2. `docs/product/PRODUCT_BLUEPRINT.md` — конечный продукт и пользовательские инварианты;
3. `docs/product/CAPABILITY_MAP.yaml` — capability IDs и release dependencies;
4. `docs/delivery/EXECUTION_MANIFEST.yaml` — машиночитаемые task order, Issues, branches, stages, ports, tests и map nodes;
5. `docs/delivery/DEVELOPMENT_PROGRAM_V1.md` — человекочитаемая программа Product Alpha и School Pilot;
6. `docs/delivery/LOCAL_PORT_POLICY.md` — локальные порты и безопасный запуск;
7. `docs/architecture/ARCHITECTURE_BASELINE.md` и профильные архитектурные документы;
8. исполняемые contracts: OpenAPI, JSON Schema, migrations и event schemas;
9. `docs/project-map/project-map.yaml` — текущее состояние, current focus и dependency graph;
10. GitHub Issue текущей задачи — исполнимый scope одного user flow;
11. `docs/testing/test-catalog.yaml` — команды обязательных test IDs.

Чат может запустить работу или уточнить формулировку, но не меняет task ID, capability, dependency, branch, scope, port, test ID или exit gate.

При конфликте агент:

1. прекращает изменения;
2. называет два конфликтующих источника;
3. не выбирает один из них догадкой;
4. ждёт правки нормативного файла, карты, Issue или ADR.

## 2. Как определяется текущая задача

Агент обязан:

1. выполнить `git fetch --all --prune` и проверить рабочее дерево;
2. прочитать `project.current_focus` в `project-map.yaml`;
3. найти тот же task в `EXECUTION_MANIFEST.yaml`;
4. проверить task status и все `depends_on`;
5. открыть указанную в manifest GitHub Issue;
6. продолжить указанную branch/PR либо создать branch из manifest;
7. прочитать только entry текущей задачи, раздел программы и ссылки `read` из manifest;
8. получить test IDs только из manifest + `test-catalog.yaml`.

Работа разрешена, если:

```text
TASK-ID = current_focus
status = ready | in_progress | in_review
all depends_on = done
Issue open
branch соответствует manifest
```

Задачи `planned`, `blocked`, `done` и `deprecated` не выполняются. Более поздняя задача не выбирается даже при блокировке current focus.

## 3. Первый отчёт до кода

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

`delivery_stage` задаёт порядок исполнения. `architecture_horizon` — только архитектурная группировка и может идти не по порядку Product Alpha.

## 4. Одна задача — один user flow

```text
one task
→ one branch
→ one Draft PR
→ one exit gate
→ merge
→ mandatory map transition
→ next task ready
→ stop
```

После перехода задачи в `in_progress` scope заморожен.

Разрешены только:

- исправления дефектов текущего flow;
- security fixes данных текущего flow;
- необходимые contracts, migrations и tests;
- review feedback текущего PR.

Запрещены:

- следующая capability;
- дополнительные роли и страницы;
- unrelated refactoring;
- новый framework;
- Docker/Redis/MinIO/CI polish без прямой необходимости;
- новая большая документационная программа;
- изменение канонических портов;
- второй competing PR.

Новая идея оформляется новой Issue после merge текущего task.

## 5. Обязательный map protocol

Статические task contracts находятся в `EXECUTION_MANIFEST.yaml`. Динамическое состояние находится в `project-map.yaml`.

### При начале

- current task → `in_progress`;
- `current_focus` остаётся текущим task;
- реально затронутые `map_nodes` → `in_progress`;
- `PROJECT_MAP.md` отражает текущий stage.

### В Draft PR

- current task → `in_review`;
- реальные nodes, paths и edges обновлены;
- `QUALITY_MAP.md` и test catalog совпадают с manifest;
- `nx-project-graph.json` регенерирован при изменении структуры кода;
- следующая задача остаётся `blocked`.

### После merge

Обязателен map-only transition commit или маленький PR:

- merged task → `done`;
- next task → `ready`, только если dependencies `done`;
- `current_focus` → `next_task`;
- соответствующий delivery stage и implementation nodes обновлены;
- `project-map.yaml` и `PROJECT_MAP.md` синхронизированы;
- validators PASS;
- агент останавливается.

Следующая задача не реализуется в той же сессии.

## 6. Архитектура

- Control Plane — строгий modular monolith.
- `apps/api` и `apps/web` — composition roots/adapters.
- Business logic находится в bounded contexts.
- Domain не импортирует NestJS/Fastify/HTTP, PostgreSQL client/ORM, React/UI, Redis или object-storage SDK.
- Cross-context interaction идёт через public ports/contracts и package root.
- Прямые cross-context imports внутренних файлов и writes в чужие таблицы запрещены.
- Classroom/Project Core не знает типов электроники, шашек, block coding, 3D или robotics.
- Subject modules подключаются только через Module SDK.
- Redis, S3/MinIO, queues и новые services не вводятся до Issue, которая их реально использует.

## 7. Мультитенантность и идентичность

- Каждая tenant-owned таблица содержит `tenant_id NOT NULL`.
- Tenant определяется validated session/request context.
- `tenantId`/`tenant_id` из body/query/header не является доверенным.
- Tenant lineage защищается composite constraints.
- Критические таблицы имеют cross-tenant negative tests; RLS используется как defense-in-depth.
- Runtime DB role не superuser, не owner и без `BYPASSRLS`.
- API использует только `APP_DATABASE_URL`.
- Migrations/seed/admin tools используют `DATABASE_URL`.
- Tests используют отдельный `TEST_DATABASE_URL` с guard от dev/production DB.
- Компрометация runtime DB credentials не объявляется решённой одной GUC-based RLS policy.
- Adult passwords и child credentials хранятся как versioned memory-hard hashes.
- Session token генерируется CSPRNG; в БД хранится только hash.
- Детские credentials, tokens и project content не логируются.

## 8. Проекты и модули

- `Project` — изменяемый контейнер.
- `ProjectDraft` использует optimistic version.
- `ProjectVersion` неизменяема и имеет digest.
- `SubmissionAttempt` ссылается на точную `ProjectVersion`.
- Project envelope содержит `moduleKey`, `moduleVersion`, `schemaVersion`.
- Несовместимое schema change требует version bump, JSON Schema, migrator и fixture.
- Classroom/Project Core не содержит subject-specific fields или `if moduleKey === ...`.
- Ранний Project Shell хранит небольшие payloads в PostgreSQL `jsonb`; object storage вводится после измеренной необходимости.

## 9. Electronics Alpha

Без отдельной Issue разрешены только:

```text
DC source
resistor
LED
wire
CircuitDocument v1
connectivity resolver
normalized netlist
simple series DC solver
structured diagnostics
save/reload
```

Запрещены breadboard realism, transient, Arduino, instruments, large catalog, SPICE и advanced hidden autograding. Unsupported topology возвращает diagnostic, не fake numerical success.

## 10. Порты

```text
Web  127.0.0.1:4610
API  127.0.0.1:4611
E2E  127.0.0.1:4612
```

Запрещены `3000`, `3100`, `5173`.

Если порт занят:

- не завершать процесс;
- не использовать `taskkill`/`Stop-Process` для неизвестного PID;
- не выбирать другой порт молча;
- вывести точный `BLOCKED` и остановить запуск.

## 11. API, dependencies и UX

- HTTP API обновляет OpenAPI и contract tests.
- Runtime validation соответствует contracts; malformed body → 400.
- Additional properties отклоняются, если schema их запрещает.
- Idempotency key не обрезается молча; тот же key с другим payload → conflict.
- Administrative mutation создаёт immutable AuditEvent.
- Dependency добавляется только по текущей Issue и закрепляется в lockfile.
- High/critical advisories и запрещённые licenses блокируют merge либо требуют явного owner exception.
- UI по применимости имеет loading, empty, validation error, network error, success, conflict, retry, keyboard navigation, focus management, reduced motion и responsive layout.
- Manual browser smoke не заменяет automated E2E.

## 12. Тесты

Источник истины — `docs/testing/test-catalog.yaml`. Состав тестов каждой canonical task вычисляется из профилей `EXECUTION_MANIFEST.yaml` и обязан точно совпадать с `required_for`.

```bash
python tools/run_task_tests.py --task <TASK-ID>
```

- PASS — фактический exit 0;
- FAIL — фактический non-zero;
- BLOCKED — обязательная среда отсутствует;
- NOT_RUN — команда не запускалась.

`BLOCKED` и `NOT_RUN` не закрывают exit gate. Удалять test ID из `required_for` после начала задачи запрещено.

## 13. Definition of Done

Task готова, когда:

1. полный user flow Issue реализован;
2. non-goals отсутствуют в diff;
3. contracts/migrations/security согласованы;
4. все manifest test IDs фактически PASS;
5. automated E2E и screenshots существуют;
6. canonical ports и clean-session startup подтверждены;
7. dependency/security gate PASS;
8. `project-map.yaml`, `PROJECT_MAP.md`, `QUALITY_MAP.md` и Nx graph обновлены;
9. PR merged;
10. обязательный post-merge map transition выполнен;
11. task/Issue → done/completed;
12. next task только разблокирована, но не начата.

## 14. Формат отчёта

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

Отчёт начинается с видимого пользовательского результата, а не с установленных инструментов.
