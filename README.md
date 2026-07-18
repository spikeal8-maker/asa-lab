# ASA Lab

**Модульная образовательная платформа для классов, виртуальных лабораторий и проектной работы.**

ASA Lab создаётся как единая школьная и в дальнейшем федеральная платформа. Универсальное ядро `Classroom Core` управляет организациями, школами, педагогами, ученическими местами без электронной почты, классами, заданиями, проектами, сдачами, проверкой, безопасностью, подписками и аудитом. Предметные среды подключаются как независимые модули.

Первый производственный модуль — **виртуальная лаборатория электроники**. В архитектуру заранее заложены будущие модули 3D-моделирования, подготовки файлов для 3D-печати, 2D-робототехники, шахмат, шашек, рисования, черчения и других дисциплин.

## Архитектурное решение

```text
Modular Monolith Control Plane
+ Isolated Compute Plane
+ Versioned Module SDK
+ PostgreSQL multi-tenancy
+ Immutable project versions
+ Transactional outbox
+ Browser-first Rust/WASM simulation core
+ Entitlement-based commercial model
+ Strict rules for AI coding agents
+ Versioned project knowledge graph
```

Микросервисы не создаются для каждого CRUD-модуля. С первого дня отдельно изолируются только опасные или тяжёлые вычисления: компиляция, автопроверка, серверная симуляция, preview/render/export и будущие 3D- и robotics-задачи.

## Почему именно так

Такой фундамент даёт школе быстрый и управляемый старт, но не блокирует рост до сети школ, региона и федеральной платформы. Классы, права, проекты и сдачи остаются транзакционно целостными; вычислительные worker-пулы масштабируются независимо; предметные модули подключаются через стабильный контракт, а не встраиваются в Classroom Core условными операторами.

## Карта проекта

Карта является обязательной частью репозитория, а не отдельной презентацией:

- [`docs/project-map/PROJECT_MAP.md`](docs/project-map/PROJECT_MAP.md) — обзорные Mermaid-графы в GitHub;
- [`docs/project-map/viewer.html`](docs/project-map/viewer.html) — интерактивный Obsidian-подобный граф;
- [`docs/project-map/project-map.yaml`](docs/project-map/project-map.yaml) — машиночитаемый источник истины;
- [`docs/project-map/TASK_SYSTEM.md`](docs/project-map/TASK_SYSTEM.md) — откуда coding-агент берёт задачи;
- [`docs/architecture/structurizr/workspace.dsl`](docs/architecture/structurizr/workspace.dsl) — C4 architecture model as code.

Каждый архитектурный PR обязан обновлять карту. После Bootstrap к ней добавляется автоматически генерируемый Nx project graph фактических зависимостей кода.

## Текущая очередь

1. Получить зелёный Architecture CI.
2. Проверить и объединить [Architecture Foundation PR №1](https://github.com/spikeal8-maker/asa-lab/pull/1).
3. Передать coding-агенту только [Issue №2 — TASK-BOOT-001](https://github.com/spikeal8-maker/asa-lab/issues/2).
4. Последующие задачи берутся строго из `execution_queue` в `project-map.yaml`.

## Целевой масштаб

| Уровень | Назначение | Целевой CCU |
|---|---|---:|
| L0 | разработка и демонстрация | 50 |
| L1 | одна крупная школа | 500 |
| L2 | сеть школ | 10 000 |
| L3 | регион | 50 000 |
| L4 | федеральный контур | 200 000 |

Это planning targets, а не обещание производительности одного сервера. Каждый переход подтверждается нагрузочными тестами, проверкой изоляции данных и восстановлением резервной копии.

## Основные документы

1. [`START_HERE_FOR_AI.md`](START_HERE_FOR_AI.md) — первая задача coding-агенту.
2. [`AGENTS.md`](AGENTS.md) — обязательные архитектурные правила.
3. [`docs/project-map/PROJECT_MAP.md`](docs/project-map/PROJECT_MAP.md) — карта системы и текущий фокус.
4. [`docs/project-map/TASK_SYSTEM.md`](docs/project-map/TASK_SYSTEM.md) — правила очереди задач.
5. [`docs/architecture/ARCHITECTURE_BASELINE.md`](docs/architecture/ARCHITECTURE_BASELINE.md) — целевая архитектура платформы.
6. [`docs/architecture/CAPACITY_AND_SLO.md`](docs/architecture/CAPACITY_AND_SLO.md) — нагрузочная модель и SLO.
7. [`docs/architecture/DATA_SECURITY_AND_TENANCY.md`](docs/architecture/DATA_SECURITY_AND_TENANCY.md) — мультитенантность, хранение и защита детских данных.
8. [`docs/architecture/ADMIN_AND_COMMERCIAL.md`](docs/architecture/ADMIN_AND_COMMERCIAL.md) — административная и коммерческая модель.
9. [`docs/architecture/AI_DELIVERY_GOVERNANCE.md`](docs/architecture/AI_DELIVERY_GOVERNANCE.md) — процесс разработки ботами.
10. [`docs/architecture/DECISIONS.md`](docs/architecture/DECISIONS.md) — принятые ADR и условия пересмотра.
11. [`docs/architecture/IMPLEMENTATION_ROADMAP.md`](docs/architecture/IMPLEMENTATION_ROADMAP.md) — последовательность реализации.
12. [`CONTRIBUTING.md`](CONTRIBUTING.md) — правила изменения системы и оформления Pull Request.

## Главные инварианты

- `Classroom Core` не импортирует предметную логику.
- Ученик может входить через `StudentSeat` без email.
- Детский контент закрыт по умолчанию.
- Каждая tenant-owned сущность имеет `tenant_id`.
- Авторизация выполняется сервером.
- Сохранённые `ProjectVersion` и отправленные `Submission` неизменяемы.
- Недоверенный пользовательский код не выполняется в Core API.
- Критические события публикуются через transactional outbox.
- Платные функции определяются entitlement и quota, а не boolean-флагами.
- Форматы проектов версионируются и мигрируются.
- Изменение архитектурной границы требует ADR.
- Изменение структуры, зависимости или статуса задачи требует обновления project map.

## Планируемая структура кода

```text
apps/          web, admin, api, realtime, dispatcher, workers
packages/      contracts, domain kernel, authz, database, eventing, Module SDK
contexts/      bounded contexts Classroom Core
modules/       electronics, затем 3D, robotics, chess и другие предметы
crates/        Rust/WASM simulation kernels
infra/         локальная, школьная и облачная поставка
schemas/       OpenAPI, JSON Schema и event contracts
tests/         unit, integration, contract, security, load, simulation golden tests
```

## Статус

Репозиторий находится на стадии утверждения архитектурного фундамента. Реализация бизнес-функций не должна начинаться до принятия архитектурного Pull Request и прохождения Bootstrap quality gates.

## Правовой статус

Архитектура предусматривает российский primary data plane, минимизацию детских данных и локальную поставку. Документация задаёт инженерные меры, но не заменяет юридическое заключение, локальные акты образовательной организации, модель угроз и регуляторные процедуры.
