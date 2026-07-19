# Карта проекта ASA Lab

Эта страница — человекочитаемое представление [`project-map.yaml`](project-map.yaml). Она отвечает на вопросы:

1. какую конечную образовательную систему мы строим;
2. из каких контуров она состоит;
3. какие задачи и capabilities зависят друг от друга;
4. какая задача активна;
5. что coding-агент должен делать следующим.

Продуктовая карта возможностей находится в [`../product/CAPABILITY_MAP.md`](../product/CAPABILITY_MAP.md), а её машиночитаемый источник — [`../product/CAPABILITY_MAP.yaml`](../product/CAPABILITY_MAP.yaml). Для Obsidian-подобного режима архитектуры и задач откройте [`viewer.html`](viewer.html). Карта проверок находится в [`QUALITY_MAP.md`](QUALITY_MAP.md).

## Текущий фокус

```text
TASK-CI-001            done
TASK-GOV-001           done
TASK-ARCH-001          done
TASK-BOOT-001          done
TASK-ENV-001           deprecated
TASK-TEN-001           deprecated
TASK-CLS-001           deprecated
        ↓
TASK-PRODUCT-DOC-001   ← текущий фокус: Product Blueprint и Capability Map
        ↓
TASK-MVP-001           Teacher Portal v0.1
        ↓
TASK-SEAT-001          StudentSeat и кабинет ребёнка
        ↓
TASK-MOD-001           Module Registry и универсальные проекты
        ↓
TASK-ACT-001           Задания и immutable submissions
        ↓
TASK-REVIEW-001        Комментарии, review, оценки и badges
        ↓
TASK-ELEC-001          Первый полный electronics learning cycle
```

Текущая задача: [Issue №19 — Product Blueprint and Capability Map](https://github.com/spikeal8-maker/asa-lab/issues/19). Следующая продуктовая задача после принятия документации: [Issue №18 — Teacher Portal v0.1](https://github.com/spikeal8-maker/asa-lab/issues/18).

## 1. Определение платформы

```mermaid
flowchart TB
    ASA["ASA Lab"]

    subgraph EXPERIENCE["Experience Plane"]
        WEB["Teacher and Student Web/PWA"]
        ADMIN["School and Platform Admin"]
        SITE["Public Site"]
    end

    subgraph CORE["Modular Monolith Control Plane"]
        ORG["Organization"]
        ID["Identity and StudentSeat"]
        CLASS["Classroom"]
        CONTENT["Learning Content"]
        PROJECTS["Projects and Versions"]
        ASSIGN["Assignments"]
        ASSESS["Review Assessment Rewards"]
        REG["Module Registry"]
        NOTIFY["Notifications"]
        SAFE["Safety and Audit"]
        BILL["Entitlements and Billing"]
    end

    subgraph COMPUTE["Isolated Compute Plane"]
        COMPILE["Compiler Workers"]
        SIM["Simulation Workers"]
        GRADE["Autograder Workers"]
        RENDER["Render Workers"]
        PHYSICS["Robotics Physics Workers"]
    end

    subgraph DATA["Data and Integration"]
        PG[(PostgreSQL)]
        REDIS[(Redis)]
        S3[(S3-compatible Storage)]
        OUTBOX["Transactional Outbox"]
        QUEUE["Job Queue"]
        OTEL["OpenTelemetry"]
    end

    subgraph MODULES["Subject Modules through Module SDK"]
        ELEC["Electronics"]
        BLOCKS["Block Coding"]
        THREE["3D"]
        ROBOT["Robotics"]
        CHESS["Chess and Checkers"]
        DRAW["Drawing and Drafting"]
    end

    ASA --> EXPERIENCE
    ASA --> CORE
    ASA --> COMPUTE
    ASA --> MODULES
    EXPERIENCE --> CORE
    CORE --> PG
    CORE --> REDIS
    CORE --> S3
    CORE --> OUTBOX
    OUTBOX --> QUEUE
    QUEUE --> COMPUTE
    MODULES --> REG
    ELEC --> COMPILE
    ELEC --> SIM
    ELEC --> GRADE
    BLOCKS --> GRADE
    THREE --> RENDER
    ROBOT --> PHYSICS
    CHESS --> GRADE
    DRAW --> RENDER
    EXPERIENCE -. telemetry .-> OTEL
    CORE -. telemetry .-> OTEL
    COMPUTE -. telemetry .-> OTEL
```

## 2. Основной образовательный цикл

```mermaid
flowchart LR
    C1[Teacher creates classroom]
    C2[Teacher issues StudentSeats]
    C3[Teacher assigns ActivityVersion]
    C4[Student opens subject module]
    C5[Project autosave and checkpoints]
    C6[Submit immutable ProjectVersion]
    C7[Automatic checks]
    C8[Teacher review and comments]
    C9[Return or accept]
    C10[Rubric grade and badge]
    C11[Progress updated]

    C1 --> C2 --> C3 --> C4 --> C5 --> C6 --> C7 --> C8 --> C9 --> C10 --> C11
    C9 -->|changes requested| C4
```

## 3. Classroom Core

```mermaid
flowchart LR
    ORG["Tenant / School / Period"]
    ID["User / StudentSeat / Session"]
    CLS["Classroom / Membership / Group"]
    ACT["ActivityVersion / Assignment"]
    PRJ["Project / ProjectVersion"]
    SUB["SubmissionAttempt"]
    REV["Review / Comment / Rubric"]
    RESULT["Grade / Badge / Progress"]
    MOD["ModuleManifest"]

    ORG --> CLS
    ID --> CLS
    CLS --> ACT
    ACT --> PRJ
    PRJ --> SUB
    SUB --> REV
    REV --> RESULT
    MOD --> PRJ
```

Classroom Core владеет образовательным процессом, но не предметным payload. Электроника, sprites, шахматные ходы и 3D meshes остаются внутри соответствующих модулей.

## 4. Кабинет педагога

```mermaid
flowchart TB
    HOME["Главная"]
    CLASSES["Классы"]
    CLASS["Страница класса"]
    ROSTER["Ученики и группы"]
    ASSIGNMENTS["Задания"]
    REVIEW["Очередь проверки"]
    GRADEBOOK["Оценки"]
    REWARDS["Достижения"]
    ANALYTICS["Аналитика"]
    SETTINGS["Настройки и соучителя"]

    HOME --> CLASSES
    CLASSES --> CLASS
    CLASS --> ROSTER
    CLASS --> ASSIGNMENTS
    CLASS --> REVIEW
    CLASS --> GRADEBOOK
    CLASS --> REWARDS
    CLASS --> ANALYTICS
    CLASS --> SETTINGS
```

## 5. Кабинет ученика

```mermaid
flowchart TB
    SHOME["Главная"]
    SCLASS["Мои классы"]
    STASK["Мои задания"]
    SPROJECT["Мои проекты"]
    SFEEDBACK["Комментарии и результаты"]
    SREWARD["Достижения"]
    SPORTFOLIO["Портфолио"]

    SHOME --> SCLASS
    SHOME --> STASK
    SHOME --> SPROJECT
    SHOME --> SFEEDBACK
    SHOME --> SREWARD
    SHOME --> SPORTFOLIO
```

## 6. Предметные среды

```mermaid
flowchart TB
    SDK["Versioned Module SDK"]
    SDK --> E["Electronics"]
    SDK --> B["Block Coding"]
    SDK --> D3["3D Modelling"]
    SDK --> R["Virtual Robotics"]
    SDK --> C["Chess and Checkers"]
    SDK --> G["Drawing and Drafting"]

    E --> EW["Simulation Compile Autograding"]
    B --> BW["Runtime and Project Checks"]
    D3 --> DW["Preview Export Slicing"]
    R --> RW["Physics Replay Goal Checks"]
    C --> CW["Move Validation and Analysis"]
    G --> GW["Preview Export Rubric Evidence"]
```

## 7. Проверка работы

```mermaid
flowchart LR
    QUEUE["Review Queue"]
    VIEWER["Module Viewer"]
    AUTO["Automatic Results"]
    DIFF["Attempt Diff"]
    COMMENT["Anchored Comments"]
    RUBRIC["Rubric"]
    DECISION["Accept or Changes Requested"]
    GRADE["Grade"]
    BADGE["Badge"]
    PROGRESS["Progress"]

    QUEUE --> VIEWER
    VIEWER --> AUTO
    VIEWER --> DIFF
    VIEWER --> COMMENT
    AUTO --> RUBRIC
    COMMENT --> RUBRIC
    RUBRIC --> DECISION
    DECISION --> GRADE
    DECISION --> BADGE
    GRADE --> PROGRESS
    BADGE --> PROGRESS
```

## 8. Продуктовая релизная карта

```mermaid
flowchart LR
    P0["Foundation"]
    P1["Teacher Portal"]
    P2["Child Access"]
    P3["Modules Projects Assignments"]
    P4["Review Assessment Rewards"]
    P5["Electronics"]
    P6["Simulation and Arduino"]
    P7["Additional Modules"]
    P8["Pilot Hardening"]
    P9["Commercial and Multi-school"]

    P0 --> P1 --> P2 --> P3 --> P4 --> P5 --> P6 --> P7 --> P8 --> P9
```

### Foundation

Репозиторий, architecture rules, migrations, contracts, identity/tenant foundation.

### Teacher Portal

Вход педагога, React-кабинет, classroom lifecycle, owner membership, RLS и audit.

### Child Access

StudentSeat, карточки/QR, вход без email, Student Dashboard.

### Modules, Projects and Assignments

Module Registry, Project envelope, immutable versions, ActivityVersion, Assignment и SubmissionAttempt.

### Review, Assessment and Rewards

Комментарии, module anchors, changes requested, rubric, grade, badge и progress.

### Electronics

Редактор схем, save/reload, assignment submission, teacher viewer и basic autograding.

### Simulation and Arduino

Rust/WASM simulation, instruments, compiler workers и Arduino runtime.

### Additional Modules

Scratch-подобное блочное программирование, 3D, робототехника, шахматы, шашки, рисование и черчение.

## 9. Управление coding-агентами

```mermaid
flowchart LR
    PRODUCT["Product Blueprint"]
    CAP["Capability Map"]
    PROJECT["Project Map"]
    ISSUE["GitHub Issue"]
    RUNBOOK["BOT_RUNBOOK"]
    TESTS["Test Catalog"]
    AGENT["Coding Agent"]
    PR["Draft PR"]
    REPORT["Test Report"]

    PRODUCT --> AGENT
    CAP --> AGENT
    PROJECT --> AGENT
    ISSUE --> AGENT
    RUNBOOK --> AGENT
    TESTS --> AGENT
    AGENT --> PR
    PR --> REPORT
```

Рабочий цикл:

```text
ORIENT
→ verify capability IDs and dependencies
→ PLAN user flow and non-goals
→ IMPLEMENT one vertical slice
→ VERIFY
→ UPDATE capability/project/quality maps
→ DRAFT PR
→ REVIEW
→ MERGE
→ NEXT TASK
```

## 10. Карты, работающие вместе

| Карта | Отвечает на вопрос | Источник истины |
|---|---|---|
| Product Capability Map | Что должна уметь конечная платформа | `docs/product/CAPABILITY_MAP.yaml` |
| Project Knowledge Graph | Что реализуем сейчас и какие задачи зависят друг от друга | `project-map.yaml` |
| Quality Map | Чем доказывается готовность | `QUALITY_MAP.md` + `test-catalog.yaml` |
| C4 Architecture Model | Как устроены системы и deployment | `docs/architecture/structurizr/workspace.dsl` |
| Nx Project Graph | Как фактически зависит код | `nx-project-graph.json` |

## 11. Обязательное правило актуальности

Карта меняется в том же Pull Request, если PR:

- добавляет или меняет capability;
- меняет пользовательский flow;
- добавляет приложение, bounded context, worker, data store или предметный модуль;
- меняет архитектурную зависимость;
- добавляет ADR, фазу, task, test registry или exit gate;
- начинает, блокирует, завершает или заменяет задачу;
- переносит ответственность между модулями;
- меняет путь нормативного документа.

Задача не получает статус `done`, пока её user flow, capability boundary, exit gate и test IDs не подтверждены фактическими командами.
