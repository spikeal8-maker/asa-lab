# Карта проекта ASA Lab

Эта страница — человекочитаемое представление [`project-map.yaml`](project-map.yaml). Она отвечает на вопросы:

1. из каких частей состоит платформа;
2. какие части зависят друг от друга;
3. какая задача активна;
4. чем подтверждается готовность;
5. что coding-агент должен делать следующим.

Для Obsidian-подобного режима откройте [`viewer.html`](viewer.html). Отдельная карта проверок находится в [`QUALITY_MAP.md`](QUALITY_MAP.md).

## Текущий фокус

```text
TASK-CI-001      done — local-first exit gate (GitHub-hosted CI отклонён: billing)
TASK-GOV-001     done — BOT_RUNBOOK, test catalog, quality graph, task test runner
TASK-ARCH-001    done — PR №1 объединён в main (merge d93899b)
TASK-BOOT-001    done — pnpm+Nx foundation (PR №14 merged, 1f8414b)
TASK-ENV-001     deprecated — среда deferred (PR №16 closed); локального
                   PostgreSQL достаточно для продуктовой разработки
        ↓
TASK-TEN-001     ← текущий фокус (in_review): первый пользовательский срез —
                   педагог входит, создаёт класс, класс виден после reload
        ↓
TASK-CLS-001     педагог создаёт класс
        ↓
TASK-SEAT-001    StudentSeat и вход без email
        ↓
TASK-MOD-001     Module SDK и Project envelope
        ↓
TASK-ACT-001     первое задание и immutable submission
        ↓
TASK-ELEC-001    первая рабочая электронная схема
```

Текущая задача: [Issue №3 — TASK-TEN-001 (первый classroom-срез)](https://github.com/spikeal8-maker/asa-lab/issues/3). Проверка задач — local-first через `python tools/run_task_tests.py --task <TASK-ID>` (см. [`QUALITY_MAP.md`](QUALITY_MAP.md)).

## 1. Карта платформы

```mermaid
flowchart TB
    ASA["ASA Lab"]

    subgraph EXP["Experience Plane"]
        WEB["Web / PWA"]
        ADMIN["Admin Console"]
        SITE["Public Site"]
    end

    subgraph CORE["Modular Monolith Control Plane"]
        ID["Identity"]
        ORG["Organizations"]
        CLS["Classroom"]
        PRJ["Projects"]
        ACT["Activities"]
        ASM["Assessment"]
        REG["Module Registry"]
        SAFE["Safety / Audit"]
        BILL["Billing"]
    end

    subgraph COMPUTE["Isolated Compute Plane"]
        COMP["Compiler Workers"]
        SIM["Simulation Workers"]
        GRADER["Autograder Workers"]
        RENDER["Render / Robotics Workers"]
    end

    subgraph DATA["Data and Integration"]
        PG[("PostgreSQL")]
        REDIS[("Redis")]
        S3[("S3-compatible Storage")]
        OUTBOX["Transactional Outbox"]
        QUEUE["Job Queue"]
        OTEL["OpenTelemetry"]
    end

    subgraph MODULES["Subject Modules via Module SDK"]
        ELEC["Electronics"]
        M3D["3D"]
        ROB["Robotics"]
        CHESS["Chess / Checkers"]
        DRAW["Drawing / Drafting"]
    end

    ASA --> EXP
    ASA --> CORE
    ASA --> COMPUTE
    ASA --> MODULES
    WEB --> CORE
    ADMIN --> CORE
    SITE --> CORE
    CORE --> PG
    CORE --> REDIS
    CORE --> S3
    CORE --> OUTBOX
    OUTBOX --> QUEUE
    QUEUE --> COMPUTE
    MODULES --> CORE
    ELEC --> COMP
    ELEC --> SIM
    ELEC --> GRADER
    M3D --> RENDER
    ROB --> RENDER
    EXP -. telemetry .-> OTEL
    CORE -. telemetry .-> OTEL
    COMPUTE -. telemetry .-> OTEL
```

## 2. Classroom Core и проекты

```mermaid
flowchart LR
    ORG["Organization / School"]
    ID["Identity / StudentSeat"]
    CLS["Classroom"]
    ACT["Activity / Assignment"]
    PRJ["Project"]
    VER["Immutable ProjectVersion"]
    SUB["Submission"]
    REV["Review"]
    MOD["Module Manifest"]
    ENT["Entitlement"]

    ORG --> CLS
    ID --> CLS
    CLS --> ACT
    CLS --> PRJ
    ACT --> SUB
    PRJ --> VER
    SUB --> VER
    SUB --> REV
    PRJ --> MOD
    ENT --> MOD
```

## 3. Контур управления ботами и качеством

```mermaid
flowchart LR
    OWNER["Владелец"]
    MAP["project-map.yaml"]
    ISSUE["GitHub Issue"]
    RUNBOOK["BOT_RUNBOOK"]
    CATALOG["test-catalog.yaml"]
    AGENT["Coding-агент"]
    PR["Draft PR"]
    CI["Governance / Product CI"]
    REPORT["Test report"]

    OWNER --> MAP
    MAP --> AGENT
    ISSUE --> AGENT
    RUNBOOK --> AGENT
    CATALOG --> AGENT
    AGENT --> PR
    PR --> CI
    CI --> REPORT
    REPORT --> OWNER
    OWNER -->|merge и смена статуса| MAP
```

Рабочий цикл:

```text
ORIENT → PLAN → IMPLEMENT → VERIFY → UPDATE MAP → DRAFT PR → REVIEW → MERGE → NEXT TASK
```

## 4. Подключаемые учебные среды

```mermaid
flowchart TB
    SDK["Versioned Module SDK"]
    SDK --> E["Electronics"]
    SDK --> D3["3D Modelling"]
    SDK --> R["Virtual Robotics"]
    SDK --> C["Chess / Checkers"]
    SDK --> G["Drawing / Drafting"]
    E --> ES["Circuit schema"]
    E --> EW["Simulation / Compile / Grade workers"]
    D3 --> DS["Scene schema"]
    D3 --> DW["Preview / Export / Slicing workers"]
    R --> RS["Robot + World schema"]
    R --> RW["Physics workers"]
    C --> CS["Position + Move schema"]
    C --> CW["Validation / Engine workers"]
    G --> GS["Vector document schema"]
    G --> GW["Preview / Export workers"]
```

## 5. Дорожная карта

```mermaid
flowchart LR
    P0["0 Foundation"] --> P1["1 Tenancy & Identity"]
    P1 --> P2["2 Classroom Core"]
    P2 --> P3["3 Module SDK & Projects"]
    P3 --> P4["4 Activities & Assessment"]
    P4 --> P5["5 Electronics Editor"]
    P5 --> P6["6 Simulation Core"]
    P6 --> P7["7 Arduino"]
    P7 --> P8["8 Autograding & Instruments"]
    P8 --> P9["9 Pilot Hardening"]
    P9 --> P10["10 Commercial Foundation"]
    P10 --> P11["11 Multi-school Scale"]
    P11 --> P12["12 New Subject Modules"]
```

## 6. Состояния задачи

```mermaid
stateDiagram-v2
    [*] --> Planned
    Planned --> Blocked: есть зависимость
    Planned --> Ready: зависимости done
    Blocked --> Ready: блокировка снята
    Ready --> InProgress: агент начал реализацию
    InProgress --> InReview: открыт PR
    InReview --> InProgress: замечания или красный CI
    InReview --> Done: merge и exit gate
    Done --> [*]
```

## 7. Карты, работающие вместе

| Карта | Для чего | Источник истины |
|---|---|---|
| Project Knowledge Graph | Устройство, задачи, документы, фазы и зависимости | `project-map.yaml` |
| Quality Map | Задачи, test IDs и quality gates | `QUALITY_MAP.md` + `test-catalog.yaml` |
| C4 Architecture Model | Система, контейнеры и deployment | `docs/architecture/structurizr/workspace.dsl` |
| Nx Project Graph | Фактические импорты исходного кода | автоматически из Nx metadata |

Nx-граф появляется после Bootstrap. Актуальный экспорт: [`nx-project-graph.json`](nx-project-graph.json) (регенерируется `pnpm graph:report`). Он показывает, как код зависит от кода. `project-map.yaml` дополнительно показывает назначение узла, фазу, статус и следующую задачу.

## 8. Обязательное правило актуальности

Карта меняется в том же Pull Request, если PR:

- добавляет или удаляет приложение, bounded context, worker, data store или предметный модуль;
- меняет архитектурную зависимость;
- добавляет ADR, фазу, task, test registry или exit gate;
- начинает, блокирует, завершает или заменяет задачу;
- переносит ответственность между модулями;
- меняет путь исходного кода или нормативного документа.

Задача не получает статус `done`, пока её exit gate и обязательные test IDs не подтверждены фактическими командами.
