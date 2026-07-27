# ASA Lab

**Единая образовательная платформа для классов, проектов, виртуальных лабораторий, заданий и проверки работ.**

ASA Lab создаётся как школьная, а затем многопользовательская платформа. Универсальное ядро управляет организациями, педагогами, детским доступом без обязательного email, классами, проектами, заданиями, submissions, comments, grades, achievements, safety и audit. Предметные среды подключаются как независимые modules.

Первый приоритетный предметный модуль — **виртуальная лаборатория электроники**. Архитектура также поддерживает Scratch-like block coding, 3D, virtual robotics, checkers/chess, drawing и drafting.

## Главное определение

> Один безопасный вход, единые классы, проекты, задания, submissions, comments, grades и achievements — множество независимых учебных модулей через Module SDK.

ASA Lab — не один редактор и не набор несвязанных сайтов.

## Канонический контракт разработки

- [`docs/delivery/EXECUTION_MANIFEST.yaml`](docs/delivery/EXECUTION_MANIFEST.yaml) — точные task IDs, Issues, branches, delivery stages, architecture horizons, dependencies, test profiles, map nodes и artifacts;
- [`docs/delivery/DEVELOPMENT_PROGRAM_V1.md`](docs/delivery/DEVELOPMENT_PROGRAM_V1.md) — человекочитаемый Product Alpha → School Pilot;
- [`docs/delivery/LOCAL_PORT_POLICY.md`](docs/delivery/LOCAL_PORT_POLICY.md) — Web `4610`, API `4611`, E2E `4612`;
- [Epic №23](https://github.com/spikeal8-maker/asa-lab/issues/23) — общая программа;
- [`docs/project-map/project-map.yaml`](docs/project-map/project-map.yaml) — current focus и dynamic statuses;
- [`docs/testing/test-catalog.yaml`](docs/testing/test-catalog.yaml) — команды обязательных test IDs.

`delivery_stage` задаёт порядок выполнения. `architecture_horizon` показывает архитектурный контур и не используется для выбора следующей задачи.

```text
Product Definition
→ Teacher Portal
→ Universal Project Shell
→ Checkers Lite reference module
→ Electronics Alpha
→ StudentSeat and Child Dashboard
→ Assignment and Immutable Submission
→ Comments Review Grade Badge
→ Full Electronics Classroom Cycle
```

Checkers Lite — маленькое доказательство Module SDK. Продуктовый приоритет остаётся у Electronics.

## Что пользователь увидит

| Этап | Видимый результат |
|---|---|
| Teacher Portal | Педагог входит, создаёт класс, reload сохраняет класс |
| Project Shell | Создание project, module selector, draft save/reload и checkpoint |
| Checkers Lite | Board, legal move, validation, save/reload и preview |
| Electronics Alpha | Source, resistor, LED, wire, netlist, DC calculation и diagnostics |
| StudentSeat | Access card, вход ребёнка без email, Child Dashboard |
| Assignment | Педагог назначает; ребёнок сдаёт immutable ProjectVersion |
| Review | Comment, return, resubmit, rubric, grade и badge |
| Electronics Classroom | Полный электронный учебный цикл внутри класса |

## Полный образовательный цикл

```text
Teacher creates classroom
→ issues StudentSeats
→ child logs in without email
→ teacher assigns ActivityVersion
→ child opens subject module
→ project autosaves
→ child submits immutable ProjectVersion
→ automatic checks run
→ teacher comments and requests changes
→ child resubmits
→ teacher accepts, grades and awards badge
→ progress updates in both dashboards
```

## Подключаемые модули

```text
Classroom Core
├── Electronics Laboratory
├── Block Coding / Scratch-like Environment
├── 3D Modelling and Printer Export
├── Virtual Robotics
├── Checkers / Chess
├── Drawing and Drafting
├── Programming
└── Future Learning Modules
```

Classroom/Project Core не знает, что такое resistor, LED, checker piece, sprite или 3D mesh. Он знает только module/project/submission contracts.

## Продуктовые документы

- [`docs/product/PRODUCT_BLUEPRINT.md`](docs/product/PRODUCT_BLUEPRINT.md) — конечная платформа;
- [`docs/product/CAPABILITY_MAP.yaml`](docs/product/CAPABILITY_MAP.yaml) — capabilities и release dependencies;
- [`docs/product/CAPABILITY_MAP.md`](docs/product/CAPABILITY_MAP.md) — визуальная карта возможностей;
- [`docs/product/CLASSROOM_CORE_SPEC.md`](docs/product/CLASSROOM_CORE_SPEC.md) — classroom, StudentSeat, assignments и submissions;
- [`docs/product/MODULE_PLATFORM_SPEC.md`](docs/product/MODULE_PLATFORM_SPEC.md) — Module SDK и subject editors;
- [`docs/product/ASSESSMENT_REWARDS_SPEC.md`](docs/product/ASSESSMENT_REWARDS_SPEC.md) — comments, review, grades, badges и progress.

## Архитектура

```text
Modular Monolith Control Plane
+ Isolated Compute Plane for heavy/untrusted work
+ Versioned Module SDK
+ PostgreSQL multi-tenancy
+ Immutable ProjectVersion and SubmissionAttempt
+ Transactional Outbox when asynchronous workflows require it
+ Rust/WASM electronics simulation core
+ Entitlement-based commercial model
+ Product/Project/Quality/Nx maps
+ Executable test registry
```

Микросервисы не создаются для каждого CRUD. Redis, S3/MinIO, queues и workers не блокируют раннюю функцию, которая их не использует.

## Карты

- [`docs/project-map/PROJECT_MAP.md`](docs/project-map/PROJECT_MAP.md) — delivery stages, architecture horizons и system graph;
- [`docs/project-map/viewer.html`](docs/project-map/viewer.html) — интерактивная Obsidian-like карта, объединяющая Project Map и Execution Manifest;
- [`docs/project-map/project-map.yaml`](docs/project-map/project-map.yaml) — architecture graph, current focus и statuses;
- [`docs/project-map/QUALITY_MAP.md`](docs/project-map/QUALITY_MAP.md) — test profiles и stage gates;
- [`docs/project-map/nx-project-graph.json`](docs/project-map/nx-project-graph.json) — фактические code dependencies;
- [`docs/architecture/IMPLEMENTATION_ROADMAP.md`](docs/architecture/IMPLEMENTATION_ROADMAP.md) — долгосрочные architecture horizons.

## Управление coding-агентом

- [`AGENTS.md`](AGENTS.md) — обязательный контракт;
- [`START_HERE_FOR_AI.md`](START_HERE_FOR_AI.md) — короткий вход;
- [`docs/delivery/BOT_RUNBOOK.md`](docs/delivery/BOT_RUNBOOK.md) — ORIENT → IMPLEMENT → VERIFY → MAP → PR → MERGE → TRANSITION;
- [`tools/validate_delivery_program.py`](tools/validate_delivery_program.py) — manifest/map/test/port synchronization;
- [`tools/run_task_tests.py`](tools/run_task_tests.py) — фактический task gate.

Короткая команда:

```text
Работай в spikeal8-maker/asa-lab. Прочитай AGENTS.md, current_focus и соответствующий entry в docs/delivery/EXECUTION_MANIFEST.yaml. Открой указанную GitHub Issue и выполни только её. Следующую задачу не начинай.
```

## Локальные порты

```text
Web  http://127.0.0.1:4610
API  http://127.0.0.1:4611
E2E  http://127.0.0.1:4612
```

### Просмотр владельцем

После того как coding-бот один раз подготовил локальную базу и demo-учётную запись, владелец запускает интерфейс одной командой:

```text
pnpm demo
```

`pnpm demo` берёт runtime-credential из `%LOCALAPPDATA%\asa-lab-devenv\app-db.json`, не выводит пароль и запускает обычный Web/API-контур на `4610/4611`. Инженерная команда `pnpm dev` намеренно остаётся fail-closed и требует явный `APP_DATABASE_URL`.

Если локальный runtime-credential ещё не подготовлен, `pnpm demo` завершится с понятным `BLOCKED` и попросит coding-бота подготовить demo; пароль не нужно вставлять в терминал или чат.

Запрещённые легаси-порты перечислены в Port Policy. Занятый порт не разрешает завершать чужой процесс.

## Главные инварианты

- Classroom Core не импортирует subject logic.
- StudentSeat не требует email.
- Детский контент закрыт по умолчанию.
- Tenant context определяется сервером.
- Каждая tenant-owned сущность имеет `tenant_id`.
- ProjectVersion и SubmissionAttempt неизменяемы.
- Hidden tests не передаются в browser.
- Пользовательский код не выполняется в Core API.
- Форматы проектов версионируются и мигрируются.
- Одна Issue реализует один user flow.
- Следующая capability не начинается до merge и map transition текущей.

## Структура кода

```text
apps/          web, admin, api, realtime, dispatcher, workers
packages/      contracts, domain kernel, authz, database, eventing, Module SDK
contexts/      identity, organization, classroom, projects, content, activities, assessment
modules/       blank-canvas, checkers-lite, electronics, затем block coding, 3D, robotics, drawing
crates/        Rust/WASM simulation kernels
infra/         deployment profiles only when required
schemas/       OpenAPI, JSON Schema, events and module contracts
tests/         unit, integration, authz, E2E, accessibility, security and simulation golden
```

## Правовой статус

Архитектура предусматривает российский primary data plane, минимизацию детских данных и локальную поставку. Документация не заменяет юридическое заключение, локальные акты образовательной организации, модель угроз и регуляторные процедуры.
