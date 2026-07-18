# Карта качества и тестов ASA Lab

Эта карта дополняет основную карту проекта. Она показывает, как coding-агент, задачи и Pull Requests связаны с обязательными проверками.

```mermaid
flowchart LR
    OWNER[Владелец проекта]
    AGENT[Coding-агент]
    RUNBOOK[BOT_RUNBOOK]
    MAP[project-map.yaml]
    ISSUE[GitHub Issue]
    CATALOG[test-catalog.yaml]
    PR[Draft Pull Request]
    CI[GitHub Actions]
    REPORT[Фактический test report]

    OWNER -->|определяет ready task| MAP
    MAP -->|current_focus и dependencies| AGENT
    RUNBOOK -->|рабочий алгоритм| AGENT
    ISSUE -->|scope и acceptance| AGENT
    CATALOG -->|test IDs и commands| AGENT
    AGENT -->|код + тесты + карта| PR
    PR --> CI
    CI --> REPORT
    REPORT -->|PASS| OWNER
    OWNER -->|merge| MAP
```

## Тестовые уровни

```mermaid
flowchart TB
    STATIC[Static and architecture]
    UNIT[Unit]
    CONTRACT[Contract]
    INTEGRATION[Integration]
    AUTHZ[Authorization matrix]
    E2E[E2E user flows]
    SECURITY[Security]
    GOLDEN[Simulation golden]
    LOAD[Load]
    RECOVERY[Recovery]
    RELEASE[Release gate]

    STATIC --> UNIT
    STATIC --> CONTRACT
    UNIT --> INTEGRATION
    CONTRACT --> INTEGRATION
    INTEGRATION --> AUTHZ
    AUTHZ --> E2E
    E2E --> SECURITY
    E2E --> GOLDEN
    SECURITY --> LOAD
    GOLDEN --> LOAD
    LOAD --> RECOVERY
    RECOVERY --> RELEASE
```

## Связь ближайших задач и проверок

```mermaid
flowchart LR
    CI[TASK-CI-001]
    ARCH[TASK-ARCH-001]
    GOV[TASK-GOV-001]
    BOOT[TASK-BOOT-001]
    ENV[TASK-ENV-001]
    TEN[TASK-TEN-001]
    CLS[TASK-CLS-001]
    SEAT[TASK-SEAT-001]
    MOD[TASK-MOD-001]
    ACT[TASK-ACT-001]
    ELEC[TASK-ELEC-001]

    A1[TST-ARCH-001]
    M1[TST-MAP-001]
    C1[TST-CATALOG-001]
    F1[TST-FORMAT-001]
    L1[TST-LINT-001]
    TY1[TST-TYPE-001]
    B1[TST-BOUNDARY-001]
    CT1[TST-CONTRACT-001]
    U1[TST-UNIT-001]
    CS1[TST-COMPOSE-STRUCTURE-001]
    ME1[TST-MIGRATION-EMBEDDED-001]
    CO1[TST-COMPOSE-001]
    DB1[TST-MIGRATION-001]
    T1[TST-TENANT-001]
    AZ1[TST-AUTHZ-001]
    EC1[TST-E2E-CLS-001]
    ES1[TST-E2E-SEAT-001]
    MO1[TST-MODULE-001]
    EA1[TST-E2E-ACT-001]
    SG1[TST-SIM-GOLDEN-001]
    EE1[TST-E2E-ELEC-001]

    CI --> A1
    CI --> M1
    CI --> C1
    ARCH --> A1
    ARCH --> M1
    GOV --> A1
    GOV --> M1
    GOV --> C1

    BOOT --> A1
    BOOT --> M1
    BOOT --> C1
    BOOT --> F1
    BOOT --> L1
    BOOT --> TY1
    BOOT --> B1
    BOOT --> CT1
    BOOT --> U1
    BOOT --> CS1
    BOOT --> ME1

    ENV --> CO1
    ENV --> DB1

    TEN --> T1
    TEN --> DB1
    TEN --> AZ1
    CLS --> AZ1
    CLS --> EC1
    SEAT --> AZ1
    SEAT --> ES1
    MOD --> B1
    MOD --> MO1
    ACT --> AZ1
    ACT --> EA1
    ELEC --> B1
    ELEC --> SG1
    ELEC --> EE1
```

## Правила

- Основная карта отвечает на вопрос «что строим и в каком порядке».
- Эта карта отвечает на вопрос «чем доказываем готовность».
- `test-catalog.yaml` является источником истины для test IDs и команд.
- Изменение задачи, которое меняет критерии готовности, должно обновить каталог тестов и эту карту в том же PR.
- `PASS` допускается только при фактически запущенной команде.
- `NOT_RUN` и `BLOCKED` отображаются явно и не позволяют закрыть обязательный exit gate.
- Текущий режим — local-first verification: обязательный gate доказывается локальным запуском `python tools/run_task_tests.py --task <TASK-ID>`; узел `GitHub Actions` информационен, пока действует внешний billing-blocker.
