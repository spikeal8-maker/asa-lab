# ASA Lab

**Модульная образовательная платформа для классов, виртуальных лабораторий, заданий и проектной работы.**

ASA Lab создаётся как единая школьная и в дальнейшем многопользовательская платформа. Универсальное ядро `Classroom Core` управляет организациями, школами, педагогами, ученическими местами без обязательной электронной почты, классами, заданиями, проектами, сдачами, проверкой, комментариями, оценками, достижениями, безопасностью и аудитом. Предметные среды подключаются как независимые модули.

Первый крупный предметный модуль — **виртуальная лаборатория электроники**. В платформу заранее заложены Scratch-подобное блочное программирование, 3D-моделирование и подготовка к печати, виртуальная робототехника, шахматы и шашки, рисование, черчение и другие дисциплины.

## Главное определение

> Один безопасный вход, единые классы, задания, проекты, submissions, комментарии, оценки и достижения — множество независимых учебных модулей через Module SDK.

ASA Lab — не один редактор и не набор несвязанных сайтов. Это образовательная workspace platform, где ребёнок входит в единый кабинет, получает задания и выполняет их в разных учебных средах, а педагог проверяет работы через единый процесс.

## Продуктовая документация

- [`docs/product/PRODUCT_BLUEPRINT.md`](docs/product/PRODUCT_BLUEPRINT.md) — полное определение конечной платформы;
- [`docs/product/CAPABILITY_MAP.yaml`](docs/product/CAPABILITY_MAP.yaml) — машиночитаемые capability IDs, зависимости и релизные slices;
- [`docs/product/CAPABILITY_MAP.md`](docs/product/CAPABILITY_MAP.md) — визуальная карта возможностей;
- [`docs/product/CLASSROOM_CORE_SPEC.md`](docs/product/CLASSROOM_CORE_SPEC.md) — классы, StudentSeat, задания, submissions и кабинеты;
- [`docs/product/MODULE_PLATFORM_SPEC.md`](docs/product/MODULE_PLATFORM_SPEC.md) — подключение предметных редакторов;
- [`docs/product/ASSESSMENT_REWARDS_SPEC.md`](docs/product/ASSESSMENT_REWARDS_SPEC.md) — комментарии, проверка, оценки, badges и certificates.

## Полный образовательный цикл

```text
Teacher creates classroom
→ issues StudentSeats
→ child logs in without email
→ teacher assigns activity
→ child opens subject module
→ project autosaves
→ child submits immutable version
→ automated checks run
→ teacher comments and reviews
→ work is accepted or returned
→ grade and badge are issued
→ progress updates in both dashboards
```

## Подключаемые модули

```text
Classroom Core
├── Electronics Laboratory
├── Block Coding / Scratch-like Environment
├── 3D Modelling and Printer Export
├── Virtual Robotics
├── Chess and Checkers
├── Drawing and Drafting
├── Programming
└── Future Learning Modules
```

Classroom Core не знает внутренние типы предметов. Электроника, sprites, шахматные ходы и 3D meshes существуют только внутри соответствующих модулей.

## Архитектурное решение

```text
Modular Monolith Control Plane
+ Isolated Compute Plane
+ Versioned Module SDK
+ PostgreSQL multi-tenancy
+ Immutable project versions and submissions
+ Transactional outbox
+ Browser-first Rust/WASM simulation core
+ Entitlement-based commercial model
+ Strict rules for AI coding agents
+ Product capability graph
+ Versioned project knowledge graph
+ Executable test registry
```

Микросервисы не создаются для каждого CRUD-модуля. С первого дня отдельно изолируются только опасные или тяжёлые вычисления: компиляция, автопроверка, серверная симуляция, preview/render/export и будущие 3D- и robotics-задачи.

## Карты системы

- [`docs/product/CAPABILITY_MAP.md`](docs/product/CAPABILITY_MAP.md) — что должна уметь конечная платформа;
- [`docs/product/CAPABILITY_MAP.yaml`](docs/product/CAPABILITY_MAP.yaml) — capability graph для Issues и агентов;
- [`docs/project-map/PROJECT_MAP.md`](docs/project-map/PROJECT_MAP.md) — архитектура, задачи и текущий фокус;
- [`docs/project-map/viewer.html`](docs/project-map/viewer.html) — интерактивный Obsidian-подобный граф;
- [`docs/project-map/project-map.yaml`](docs/project-map/project-map.yaml) — машиночитаемая карта реализации;
- [`docs/project-map/QUALITY_MAP.md`](docs/project-map/QUALITY_MAP.md) — связь задач и проверок;
- [`docs/project-map/nx-project-graph.json`](docs/project-map/nx-project-graph.json) — фактические зависимости кода;
- [`docs/architecture/structurizr/workspace.dsl`](docs/architecture/structurizr/workspace.dsl) — C4 architecture as code.

## Управление coding-агентами

- [`AGENTS.md`](AGENTS.md) — обязательные продуктовые и архитектурные правила;
- [`docs/delivery/BOT_RUNBOOK.md`](docs/delivery/BOT_RUNBOOK.md) — цикл ORIENT → PLAN → IMPLEMENT → VERIFY → UPDATE MAP → PR;
- [`docs/testing/TEST_STRATEGY.md`](docs/testing/TEST_STRATEGY.md) — стратегия тестирования;
- [`docs/testing/test-catalog.yaml`](docs/testing/test-catalog.yaml) — стабильные test IDs и команды.

Каждая продуктовая Issue обязана ссылаться на capability IDs. Чат может уточнять реализацию, но не меняет молча capability, зависимость, релизную границу или смысл Issue.

## Релизная последовательность

1. Platform foundation: organization, identity, safety and operations.
2. Teacher Portal: вход, кабинет и классы.
3. Child Access: StudentSeat и кабинет ребёнка.
4. Universal Projects and Assignments: module registry, проекты, версии и submission.
5. Review and Assessment: комментарии, rubric, оценки, badges и progress.
6. Electronics: редактор, симуляция и полный учебный цикл.
7. Additional Modules: block coding, 3D, robotics, chess, drawing.

## Целевой масштаб

| Уровень | Назначение | Целевой CCU |
|---|---|---:|
| L0 | разработка и демонстрация | 50 |
| L1 | одна крупная школа | 500 |
| L2 | сеть школ | 10 000 |
| L3 | регион | 50 000 |
| L4 | федеральный контур | 200 000 |

Это planning targets, а не обещание производительности одного сервера. Каждый переход подтверждается нагрузочными тестами, tenant isolation и восстановлением резервной копии.

## Главные инварианты

- `Classroom Core` не импортирует предметную логику.
- Ученик может входить через `StudentSeat` без email.
- Детский контент закрыт по умолчанию.
- Каждая tenant-owned сущность имеет `tenant_id`.
- Авторизация выполняется сервером.
- `ProjectVersion` и отправленный `Submission` неизменяемы.
- Недоверенный пользовательский код не выполняется в Core API.
- Hidden tests не передаются в browser.
- Платные функции определяются entitlement и quota, а не boolean-флагами.
- Форматы проектов версионируются и мигрируются.
- Изменение capability сначала фиксируется в Product Blueprint и Capability Map.
- Каждая задача имеет пользовательский flow, capability IDs, non-goals и test IDs.

## Планируемая структура кода

```text
apps/          web, admin, api, realtime, dispatcher, workers
packages/      contracts, domain kernel, authz, database, eventing, Module SDK
contexts/      identity, organization, classroom, projects, activities, assessment
modules/       electronics, block coding, 3D, robotics, chess, drawing
crates/        Rust/WASM simulation kernels
infra/         local, school and cloud deployment
schemas/       OpenAPI, JSON Schema, events and module contracts
tests/         unit, integration, authz, E2E, load and simulation golden
```

## Правовой статус

Архитектура предусматривает российский primary data plane, минимизацию детских данных и локальную поставку. Документация задаёт инженерные меры, но не заменяет юридическое заключение, локальные акты образовательной организации, модель угроз и регуляторные процедуры.
