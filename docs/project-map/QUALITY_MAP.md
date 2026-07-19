# Карта качества ASA Lab

Эта карта связывает Product Blueprint, Development Program, Project Map, executable Issues и стабильные test IDs.

## 1. Источники

```mermaid
flowchart LR
    PRODUCT[Product Blueprint]
    CAP[Capability Map]
    PROGRAM[Development Program v1]
    PORTS[Local Port Policy]
    MAP[project-map.yaml]
    ISSUE[Executable GitHub Issue]
    CATALOG[test-catalog.yaml]
    AGENT[Coding Agent]
    PR[Draft PR]
    REPORT[Evidence and Test Report]
    OWNER[Owner Review]

    PRODUCT --> AGENT
    CAP --> AGENT
    PROGRAM --> AGENT
    PORTS --> AGENT
    MAP --> AGENT
    ISSUE --> AGENT
    CATALOG --> AGENT
    AGENT --> PR
    PR --> REPORT
    REPORT --> OWNER
```

## 2. Каноническая очередь

```mermaid
flowchart LR
    DOC[TASK-PRODUCT-DOC-001]
    PORTAL[TASK-PORTAL-001]
    PROJECT[TASK-PROJECT-SHELL-001]
    CHECKERS[TASK-CHECKERS-LITE-001]
    EALPHA[TASK-ELECTRONICS-ALPHA-001]
    SEAT[TASK-SEAT-001]
    ACT[TASK-ACT-001]
    REVIEW[TASK-REVIEW-001]
    EFULL[TASK-ELEC-001]

    DOC --> PORTAL --> PROJECT --> CHECKERS --> EALPHA --> SEAT --> ACT --> REVIEW --> EFULL
```

## 3. Обязательные governance gates

```mermaid
flowchart LR
    DOC[TASK-PRODUCT-DOC-001]
    ARCH[TST-ARCH-001]
    MAP[TST-MAP-001]
    CAP[TST-CAPABILITY-MAP-001]
    PROGRAM[TST-DEVELOPMENT-PROGRAM-001]
    CATALOG[TST-CATALOG-001]
    YAML[TST-YAML-001]
    LINKS[TST-LINKS-001]

    DOC --> ARCH
    DOC --> MAP
    DOC --> CAP
    DOC --> PROGRAM
    DOC --> CATALOG
    DOC --> YAML
    DOC --> LINKS
```

`TASK-PRODUCT-DOC-001` не закрывается, пока `TST-DEVELOPMENT-PROGRAM-001` не подтверждает:

- два delivery tracks;
- точную очередь из девяти задач;
- ссылки на Issues №19, №18, №24, №25, №26, №7, №8, №20, №6;
- порты `4610/4611/4612`;
- наличие Development Program и Port Policy.

## 4. Общий gate каждой code-задачи

```mermaid
flowchart TB
    TASK[Current product task]
    MAP[TST-MAP-001]
    CAP[TST-CAPABILITY-MAP-001]
    PROGRAM[TST-DEVELOPMENT-PROGRAM-001]
    FORMAT[TST-FORMAT-001]
    LINT[TST-LINT-001]
    TYPE[TST-TYPE-001]
    BOUNDARY[TST-BOUNDARY-001]
    BUILD[TST-BUILD-001]
    CONTRACT[TST-CONTRACT-001]
    UNIT[TST-UNIT-001]
    TENANT[TST-TENANT-001]
    AUTHZ[TST-AUTHZ-001]
    SECRET[TST-SECRET-001]
    DEP[TST-DEPENDENCY-001]
    PORT[TST-PORTS-001]
    START[TST-STARTUP-001]
    A11Y[TST-A11Y-001]

    TASK --> MAP
    TASK --> CAP
    TASK --> PROGRAM
    TASK --> FORMAT
    TASK --> LINT
    TASK --> TYPE
    TASK --> BOUNDARY
    TASK --> BUILD
    TASK --> CONTRACT
    TASK --> UNIT
    TASK --> TENANT
    TASK --> AUTHZ
    TASK --> SECRET
    TASK --> DEP
    TASK --> PORT
    TASK --> START
    TASK --> A11Y
```

Точный набор определяется `required_for` в `test-catalog.yaml`.

## 5. Teacher Portal gate

```mermaid
flowchart LR
    PORTAL[TASK-PORTAL-001]
    MIG[TST-MIGRATION-001]
    RLS[TST-RLS-001]
    API[TST-PORTAL-API-001]
    E2E[TST-E2E-PORTAL-001]

    PORTAL --> MIG
    PORTAL --> RLS
    PORTAL --> API
    PORTAL --> E2E
```

Наблюдаемый flow:

```text
site opens
→ teacher login
→ dashboard
→ empty classes
→ create classroom
→ owner membership + AuditEvent
→ reload persists
→ logout
```

Дополнительно:

- API использует только runtime DB URL;
- idempotency conflict проверяется;
- cross-tenant users/sessions/classrooms/audit matrix PASS;
- clean PowerShell startup PASS;
- ports 4610/4611/4612 PASS.

## 6. Universal Project Shell gate

```mermaid
flowchart LR
    PROJECT[TASK-PROJECT-SHELL-001]
    MODULE[TST-MODULE-CONTRACT-001]
    LIFE[TST-PROJECT-SHELL-001]
    E2E[TST-E2E-PROJECT-SHELL-001]

    PROJECT --> MODULE
    PROJECT --> LIFE
    PROJECT --> E2E
```

Flow:

```text
create project
→ choose module
→ save draft
→ reload restores
→ optimistic conflict protected
→ immutable checkpoint
```

## 7. Checkers Lite gate

```mermaid
flowchart LR
    CHECKERS[TASK-CHECKERS-LITE-001]
    SCHEMA[TST-CHECKERS-SCHEMA-001]
    RULES[TST-CHECKERS-RULES-001]
    E2E[TST-E2E-CHECKERS-LITE-001]

    CHECKERS --> SCHEMA
    CHECKERS --> RULES
    CHECKERS --> E2E
```

Flow:

```text
module selected
→ board rendered
→ legal move
→ invalid move diagnostic
→ save/reload
→ preview
```

Gate доказывает отсутствие предметных imports в Classroom/Project Core.

## 8. Electronics Alpha gate

```mermaid
flowchart LR
    ELEC[TASK-ELECTRONICS-ALPHA-001]
    SCHEMA[TST-ELECTRONICS-SCHEMA-001]
    NET[TST-ELECTRONICS-NETLIST-001]
    GOLD[TST-ELECTRONICS-GOLDEN-001]
    WASM[TST-ELECTRONICS-WASM-PARITY-001]
    E2E[TST-E2E-ELECTRONICS-ALPHA-001]

    ELEC --> SCHEMA
    ELEC --> NET
    ELEC --> GOLD
    ELEC --> WASM
    ELEC --> E2E
```

Flow:

```text
source + resistor + LED + wire
→ validation
→ deterministic netlist
→ native/WASM DC calculation
→ diagnostics
→ save/reload
```

Unsupported topology must fail explicitly; fake numerical success запрещён.

## 9. StudentSeat gate

```mermaid
flowchart LR
    SEAT[TASK-SEAT-001]
    LIFE[TST-STUDENT-SEAT-001]
    CRED[TST-STUDENT-CREDENTIAL-001]
    IMPORT[TST-STUDENT-IMPORT-001]
    E2E[TST-E2E-STUDENT-SEAT-001]

    SEAT --> LIFE
    SEAT --> CRED
    SEAT --> IMPORT
    SEAT --> E2E
```

Flow:

```text
teacher creates/imports seat
→ one-time card
→ child login without email
→ child dashboard/project
→ reset revokes old session
```

## 10. Assignment and Submission gate

```mermaid
flowchart LR
    ACT[TASK-ACT-001]
    VERSION[TST-ACTIVITY-VERSION-001]
    ASSIGN[TST-ASSIGNMENT-001]
    SUB[TST-SUBMISSION-IMMUTABLE-001]
    E2E[TST-E2E-ASSIGNMENT-SUBMISSION-001]

    ACT --> VERSION
    ACT --> ASSIGN
    ACT --> SUB
    ACT --> E2E
```

Flow:

```text
publish ActivityVersion
→ assign class
→ child opens starter project
→ save
→ submit immutable ProjectVersion
→ teacher queue sees exact attempt
```

## 11. Review, Grade and Badge gate

```mermaid
flowchart LR
    REVIEW[TASK-REVIEW-001]
    COMMENTS[TST-COMMENTS-001]
    LIFE[TST-REVIEW-LIFECYCLE-001]
    ASSESS[TST-ASSESSMENT-REVISION-001]
    BADGE[TST-BADGE-EVIDENCE-001]
    E2E[TST-E2E-REVIEW-001]

    REVIEW --> COMMENTS
    REVIEW --> LIFE
    REVIEW --> ASSESS
    REVIEW --> BADGE
    REVIEW --> E2E
```

Flow:

```text
anchored comment
→ request changes
→ resubmit
→ compare attempts
→ accept
→ rubric/grade
→ badge/progress
```

## 12. Full Electronics Classroom gate

```mermaid
flowchart LR
    ELEC[TASK-ELEC-001]
    ACTIVITY[TST-ELECTRONICS-ACTIVITY-001]
    AUTO[TST-ELECTRONICS-AUTOGRADE-001]
    DIFF[TST-ELECTRONICS-DIFF-001]
    SCHEMA[TST-ELECTRONICS-SCHEMA-001]
    NET[TST-ELECTRONICS-NETLIST-001]
    GOLD[TST-ELECTRONICS-GOLDEN-001]
    WASM[TST-ELECTRONICS-WASM-PARITY-001]
    E2E[TST-E2E-ELECTRONICS-CLASSROOM-001]

    ELEC --> ACTIVITY
    ELEC --> AUTO
    ELEC --> DIFF
    ELEC --> SCHEMA
    ELEC --> NET
    ELEC --> GOLD
    ELEC --> WASM
    ELEC --> E2E
```

Flow:

```text
teacher assigns electronics task
→ child builds and validates circuit
→ immutable submission
→ public checks
→ anchored feedback
→ revision
→ accept/grade/badge
```

## 13. Evidence required before Ready for review

Каждый UI/product PR предоставляет:

- commit SHA;
- `python tools/run_task_tests.py --task <TASK-ID>` output;
- exact demo URLs;
- Playwright report;
- screenshot основного состояния;
- screenshot error/diagnostic state, если применимо;
- migrations/contracts reports;
- clean working tree;
- statement that next capability is absent from diff.

## 14. Правила результата

- `PASS` — команда реально запущена и exit code 0.
- `FAIL` — команда реально запущена и завершилась ошибкой.
- `BLOCKED` — отсутствует обязательная среда; не считается успехом.
- `NOT_RUN` — команда не запускалась; не считается успехом.
- Draft PR допустим с честными статусами.
- Ready/merge допустимы только при полном обязательном PASS.
- Manual browser smoke не заменяет automated E2E.
- Изменение user flow, test IDs или exit gate обновляет Issue, Project Map, Quality Map и test catalog до реализации.