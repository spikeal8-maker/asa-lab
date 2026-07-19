# ASA Lab

**Единая образовательная платформа для классов, проектов, виртуальных лабораторий, заданий и проверки работ.**

ASA Lab создаётся как школьная, а затем многопользовательская платформа. Универсальное ядро управляет организациями, педагогами, детским доступом без обязательного email, классами, проектами, заданиями, submissions, комментариями, оценками, достижениями, безопасностью и аудитом. Предметные среды подключаются как независимые модули.

Первый приоритетный предметный модуль — **виртуальная лаборатория электроники**. Архитектура также поддерживает Scratch-подобное блочное программирование, 3D, виртуальную робототехнику, шашки/шахматы, рисование и черчение.

## Главное определение

> Один безопасный вход, единые классы, проекты, задания, submissions, comments, grades и achievements — множество независимых учебных модулей через Module SDK.

ASA Lab — не один редактор и не набор несвязанных сайтов.

## Каноническая программа разработки

Практический маршрут закреплён в:

- [`docs/delivery/DEVELOPMENT_PROGRAM_V1.md`](docs/delivery/DEVELOPMENT_PROGRAM_V1.md) — Product Alpha → School Pilot;
- [`docs/delivery/LOCAL_PORT_POLICY.md`](docs/delivery/LOCAL_PORT_POLICY.md) — Web `4610`, API `4611`, E2E `4612`;
- [Epic №23](https://github.com/spikeal8-maker/asa-lab/issues/23) — общая программа;
- [`docs/project-map/project-map.yaml`](docs/project-map/project-map.yaml) — current focus и executable queue.

```text
Product Documentation
→ Teacher Portal
→ Universal Project Shell
→ Checkers Lite reference module
→ Electronics Alpha
→ StudentSeat and Child Dashboard
→ Assignment and Immutable Submission
→ Comments Review Grade Badge
→ Full Electronics Classroom Cycle
```

Checkers Lite — маленькое архитектурное доказательство Module SDK. Продуктовый приоритет остаётся у Electronics.

## Что пользователь увидит по этапам

| Этап | Видимый результат |
|---|---|
| Teacher Portal | Педагог входит, создаёт класс, reload сохраняет класс |
| Project Shell | Создание проекта, module selector, draft save/reload и checkpoint |
| Checkers Lite | Доска, legal move, validation, save/reload и preview |
| Electronics Alpha | Source, resistor, LED, wire, netlist, DC calculation и diagnostics |
| StudentSeat | Карточка доступа, вход ребёнка без email, Child Dashboard |
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

Classroom Core не знает, что такое resistor, LED, checker piece, sprite или 3D mesh. Он знает только module/project/submission contracts.

## Продуктовые документы

- [`docs/product/PRODUCT_BLUEPRINT.md`](docs/product/PRODUCT_BLUEPRINT.md) — конечная платформа;
- [`docs/product/CAPABILITY_MAP.yaml`](docs/product/CAPABILITY_MAP.yaml) — capability IDs и dependencies;
- [`docs/product/CAPABILITY_MAP.md`](docs/product/CAPABILITY_MAP.md) — визуальная карта возможностей;
- [`docs/product/CLASSROOM_CORE_SPEC.md`](docs/product/CLASSROOM_CORE_SPEC.md) — классы, StudentSeat, assignments и submissions;
- [`docs/product/MODULE_PLATFORM_SPEC.md`](docs/product/MODULE_PLATFORM_SPEC.md) — Module SDK и предметные редакторы;
- [`docs/product/ASSESSMENT_REWARDS_SPEC.md`](docs/product/ASSESSMENT_REWARDS_SPEC.md) — comments, review, grades, badges и progress.

## Архитектурное решение

```text
Modular Monolith Control Plane
+ Isolated Compute Plane
+ Versioned Module SDK
+ PostgreSQL multi-tenancy
+ Immutable ProjectVersion and SubmissionAttempt
+ Transactional Outbox when asynchronous workflows require it
+ Rust/WASM electronics simulation core
+ Entitlement-based commercial model
+ Product and project knowledge graphs
+ Executable test registry
```

Микросервисы не создаются для каждого CRUD. Отдельно изолируются только тяжёлые или недоверенные вычисления.

## Карты системы

- [`docs/product/CAPABILITY_MAP.md`](docs/product/CAPABILITY_MAP.md) — что должна уметь платформа;
- [`docs/delivery/DEVELOPMENT_PROGRAM_V1.md`](docs/delivery/DEVELOPMENT_PROGRAM_V1.md) — в каком порядке это строится;
- [`docs/project-map/PROJECT_MAP.md`](docs/project-map/PROJECT_MAP.md) — архитектура, текущий focus и задачи;
- [`docs/project-map/viewer.html`](docs/project-map/viewer.html) — интерактивный граф;
- [`docs/project-map/project-map.yaml`](docs/project-map/project-map.yaml) — машиночитаемый source of truth;
- [`docs/project-map/QUALITY_MAP.md`](docs/project-map/QUALITY_MAP.md) — чем подтверждается готовность;
- [`docs/project-map/nx-project-graph.json`](docs/project-map/nx-project-graph.json) — фактические dependencies кода;
- [`docs/architecture/structurizr/workspace.dsl`](docs/architecture/structurizr/workspace.dsl) — C4 model as code.

## Управление coding-агентами

- [`AGENTS.md`](AGENTS.md) — обязательные правила;
- [`docs/delivery/BOT_RUNBOOK.md`](docs/delivery/BOT_RUNBOOK.md) — рабочий цикл;
- [`docs/delivery/LOCAL_PORT_POLICY.md`](docs/delivery/LOCAL_PORT_POLICY.md) — безопасный локальный запуск;
- [`docs/testing/test-catalog.yaml`](docs/testing/test-catalog.yaml) — stable test IDs;
- [`tools/validate_delivery_program.py`](tools/validate_delivery_program.py) — проверка canonical queue.

Короткая команда агенту:

```text
Прочитай AGENTS.md, Development Program и current_focus. Открой связанную Issue и выполни только её. Следующую задачу не начинай.
```

Чат не изменяет молча scope, dependencies, ports или exit gate.

## Локальные порты

```text
Web  http://127.0.0.1:4610
API  http://127.0.0.1:4611
E2E  http://127.0.0.1:4612
```

ASA Lab не использует порты `3000`, `3100`, `5173`. Занятый порт не является разрешением завершить чужой процесс.

## Целевой масштаб

| Уровень | Назначение | Planning CCU |
|---|---|---:|
| L0 | разработка и демонстрация | 50 |
| L1 | одна крупная школа | 500 |
| L2 | сеть школ | 10 000 |
| L3 | регион | 50 000 |
| L4 | федеральный контур | 200 000 |

Это planning targets. Каждый переход подтверждается измерениями, tenant isolation и recovery tests.

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
- Следующая capability не начинается до merge текущей.

## Структура кода

```text
apps/          web, admin, api, realtime, dispatcher, workers
packages/      contracts, domain kernel, authz, database, eventing, Module SDK
contexts/      identity, organization, classroom, projects, content, activities, assessment
modules/       blank-canvas, checkers-lite, electronics, затем block coding, 3D, robotics, drawing
crates/        Rust/WASM simulation kernels
infra/         local, school and cloud deployment profiles when required
schemas/       OpenAPI, JSON Schema, events and module contracts
tests/         unit, integration, authz, E2E, accessibility, security and simulation golden
```

## Правовой статус

Архитектура предусматривает российский primary data plane, минимизацию детских данных и локальную поставку. Документация не заменяет юридическое заключение, локальные акты образовательной организации, модель угроз и регуляторные процедуры.