# AGENTS.md — обязательный контракт coding-агента ASA Lab

Этот файл обязателен для Codex, других coding-агентов и разработчиков. Нарушение правила с severity `error` блокирует merge.

## 1. Источники истины

Порядок приоритета:

1. более поздняя принятая ADR;
2. `docs/product/PRODUCT_BLUEPRINT.md` — конечный продукт и пользовательские инварианты;
3. `docs/product/CAPABILITY_MAP.yaml` — capability IDs и release dependencies;
4. `docs/architecture/ARCHITECTURE_BASELINE.md` и профильные архитектурные документы;
5. принятые исполняемые contracts: OpenAPI, JSON Schema, migrations и event schemas;
6. `docs/delivery/INFRASTRUCTURE_EXECUTION_MANIFEST.yaml` + `docs/project-map/infrastructure-focus.yaml`, только когда infrastructure focus имеет `active: true`;
7. `docs/delivery/EXECUTION_MANIFEST.yaml` — product task order, Issues, branches, delivery stages, architecture horizons, ports, tests и map nodes;
8. `docs/delivery/DEVELOPMENT_PROGRAM_V1.md` — человекочитаемая программа Product Alpha и School Pilot;
9. `docs/delivery/LOCAL_PORT_POLICY.md` — локальные порты и безопасный запуск;
10. `docs/project-map/project-map.yaml` — состояние product queue и frozen product focus;
11. GitHub Issue текущей задачи — исполнимый scope одного user flow;
12. `docs/testing/test-catalog.yaml` — команды обязательных product test IDs.

Infrastructure Execution Manifest — отдельная временная дорожка для owner-authorized environment/deployment work. Она не завершает, не переставляет и не заменяет product delivery queue. Пока `infrastructure-focus.yaml` имеет `active: true`, её `current_focus` является исполнимой задачей, а `project-map.yaml::project.current_focus` считается замороженным product focus.

Execution Manifest управляет доставкой, но не может отменить ADR, Product/Capability contract, architecture baseline или уже принятый executable contract. Такое изменение сначала оформляется нормативно.

Чат может запустить работу или уточнить формулировку, но не меняет task ID, capability, dependency, branch, scope, port, test ID или exit gate.

При конфликте агент:

1. прекращает изменения;
2. называет два конфликтующих источника;
3. не выбирает один из них догадкой;
4. ждёт правки нормативного файла, карты, Issue или ADR.

## 2. Как определяется текущая задача

### 2.1 Infrastructure focus

Перед чтением product current focus агент обязан проверить `docs/project-map/infrastructure-focus.yaml`.

Если файл существует и содержит `active: true`, агент обязан:

1. прочитать `current_focus` из `infrastructure-focus.yaml`;
2. найти тот же task в `docs/delivery/INFRASTRUCTURE_EXECUTION_MANIFEST.yaml`;
3. проверить open Issue, status, base branch, work branch и frozen product focus;
4. выполнить `python tools/validate_infrastructure_focus.py` до product/infrastructure изменений;
5. продолжить указанную infrastructure branch либо создать её от указанной base branch;
6. выполнять только infrastructure/deployment scope Issue;
7. не менять status замороженной product task, кроме отдельной owner-approved governance правки;
8. не начинать product current focus параллельно.

Infrastructure работа разрешена, если:

```text
infrastructure_focus.active = true
TASK-ID = infrastructure_focus.current_focus
manifest task status = ready | in_progress | in_review
Issue open
base branch и work branch соответствуют manifest
product-map current_focus = product_focus_frozen
```

После merge или явной отмены infrastructure task отдельный map-only transition обязан установить `active: false`. Затем исполняемым снова становится product current focus из `project-map.yaml`.

### 2.2 Product focus

Если infrastructure focus отсутствует или `active: false`, агент обязан:

1. выполнить `git fetch --all --prune` и проверить рабочее дерево;
2. прочитать `project.current_focus` в `project-map.yaml`;
3. найти тот же task в `EXECUTION_MANIFEST.yaml`;
4. проверить task status и все `depends_on`;
5. открыть указанную в manifest GitHub Issue;
6. продолжить указанную branch/PR либо создать branch из manifest;
7. прочитать только entry текущей задачи, раздел программы и ссылки `read` из manifest;
8. получить test IDs только из manifest + `test-catalog.yaml`.

Product работа разрешена, если:

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

Для infrastructure focus вместо `DELIVERY_STAGE` допускается `INFRASTRUCTURE_STAGE`, а в `DEPENDENCIES` обязательно указываются base branch и frozen product focus.

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
- review feedback текущего PR;
- для owner-authorized infrastructure task: portability, containerization, deployment, environment, backup/restore и доказанные startup/responsive fixes из связанной Issue.

Запрещены:

- следующая capability;
- дополнительные роли и страницы;
- unrelated refactoring;
- новый framework;
- Docker/Redis/MinIO/CI polish без прямой необходимости или без активной infrastructure Issue;
- новая большая документационная программа;
- изменение канонических портов;
- второй competing PR.

Новая идея оформляется новой Issue после merge текущего task.

## 5. Обязательный map protocol

Статические product task contracts находятся в `EXECUTION_MANIFEST.yaml`. Динамическое product состояние находится в `project-map.yaml`. Временная infrastructure task использует `INFRASTRUCTURE_EXECUTION_MANIFEST.yaml` и `infrastructure-focus.yaml`.

### При начале product task

- current task → `in_progress`;
- `current_focus` остаётся текущим task;
- реально затронутые `map_nodes` → `in_progress`;
- `PROJECT_MAP.md` отражает текущий stage.

### При начале infrastructure task

- `infrastructure-focus.active` → `true`;
- infrastructure task status → `in_progress`;
- `product_focus_frozen` точно совпадает с `project-map.yaml::project.current_focus`;
- product task status не меняется этой задачей;
- work branch создаётся только от manifest base branch.

### В Draft PR

- current task → `in_review`;
- реальные nodes, paths и edges обновлены;
- `QUALITY_MAP.md` и test catalog совпадают с manifest, если задача использует product test IDs;
- `nx-project-graph.json` регенерирован при изменении структуры кода;
- следующая product задача остаётся `blocked`.

### После merge product task

Обязателен map-only transition commit или маленький PR:

- merged task → `done`;
- next task → `ready`, только если dependencies `done`;
- `current_focus` → `next_task`;
- соответствующий delivery stage и implementation nodes обновлены;
- `project-map.yaml` и `PROJECT_MAP.md` синхронизированы;
- validators PASS;
- агент останавливается.

Следующая задача не реализуется в той же сессии.

### После merge/cancel infrastructure task

- infrastructure task → `done` или `cancelled` в её focus-файле;
- `infrastructure-focus.active` → `false`;
- frozen product focus не переводится в `done` автоматически;
- product queue и `project-map.yaml::project.current_focus` возобновляются без перестановки;
- `python tools/validate_infrastructure_focus.py` обновляется или выполняется в inactive-режиме отдельным transition;
- агент останавливается.

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

Источник истины product tasks — `docs/testing/test-catalog.yaml`. Состав тестов каждой canonical product task вычисляется из профилей `EXECUTION_MANIFEST.yaml` и обязан точно совпадать с `required_for`.

Infrastructure task использует полный `required_commands` и `required_artifacts` из `INFRASTRUCTURE_EXECUTION_MANIFEST.yaml` и связанной Issue. В рамках infrastructure PR агент может добавить product test IDs и portable scripts в test catalog, но не удаляет существующие test IDs и не ослабляет assertions.

```bash
python tools/run_task_tests.py --task <TASK-ID>
python tools/validate_infrastructure_focus.py
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
4. все manifest test IDs или infrastructure required commands фактически PASS;
5. automated E2E и screenshots существуют;
6. canonical ports и clean-session startup подтверждены;
7. dependency/security gate PASS;
8. product task обновляет `project-map.yaml`, `PROJECT_MAP.md`, `QUALITY_MAP.md` и Nx graph; infrastructure task обновляет только связанные deployment/evidence files и собственный focus transition;
9. PR merged в указанную manifest base branch;
10. обязательный post-merge focus transition выполнен;
11. task/Issue → done/completed;
12. frozen product focus не потерян и не был завершён инфраструктурной задачей.
