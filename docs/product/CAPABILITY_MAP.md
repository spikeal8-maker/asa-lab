# ASA Lab — Capability Map

Человекочитаемое представление [`CAPABILITY_MAP.yaml`](CAPABILITY_MAP.yaml). Машиночитаемый YAML является источником истины для capability IDs, зависимостей и целевых релизов.

## 1. Определение системы

```mermaid
flowchart TB
    ASA[ASA Lab]
    ORG[Organization and Identity]
    CLASS[Classroom Core]
    LEARN[Learning Content and Assignments]
    PROJ[Projects and Submissions]
    ASSESS[Review Assessment Rewards]
    MOD[Module Platform]
    OPS[Administration Safety Operations]

    ASA --> ORG
    ASA --> CLASS
    ASA --> LEARN
    ASA --> PROJ
    ASA --> ASSESS
    ASA --> MOD
    ASA --> OPS
```

ASA Lab — это образовательная workspace platform. Классы, задания, версии, комментарии, оценки и достижения принадлежат платформе. Электроника, блочное программирование, 3D, робототехника и шахматы являются подключаемыми предметными средами.

## 2. Пользовательский контур

```mermaid
flowchart LR
    T[Педагог]
    S[Ученик]
    A[Администратор школы]

    TD[Teacher Dashboard]
    SD[Student Dashboard]
    AD[Admin Console]

    C[Classroom Core]
    ASS[Assignments]
    P[Projects]
    R[Review and Grades]

    T --> TD
    S --> SD
    A --> AD
    TD --> C
    SD --> C
    C --> ASS
    ASS --> P
    P --> R
    R --> TD
    R --> SD
```

## 3. Жизненный цикл обучения

```mermaid
flowchart LR
    C1[Teacher creates class]
    C2[Teacher issues StudentSeats]
    C3[Teacher assigns activity]
    C4[Student opens module]
    C5[Autosave and versions]
    C6[Submit immutable version]
    C7[Automatic checks]
    C8[Teacher comments]
    C9[Return or accept]
    C10[Grade and badge]
    C11[Progress updated]

    C1 --> C2 --> C3 --> C4 --> C5 --> C6 --> C7 --> C8 --> C9 --> C10 --> C11
    C9 -->|changes requested| C4
```

## 4. Classroom capabilities

```mermaid
flowchart TB
    ORG[CAP-ORG]
    ID[CAP-IDENTITY]
    CLS[CAP-CLASSROOM]
    SEAT[CAP-STUDENT-SEAT]
    TD[CAP-TEACHER-DASHBOARD]
    SD[CAP-STUDENT-DASHBOARD]
    NOTIF[CAP-NOTIFICATIONS]

    ORG --> ID
    ORG --> CLS
    ID --> CLS
    CLS --> SEAT
    CLS --> TD
    SEAT --> SD
    CLS --> NOTIF
```

## 5. Задания, проекты и проверка

```mermaid
flowchart LR
    CONTENT[CAP-CONTENT]
    MODULES[CAP-MODULE-REGISTRY]
    ASSIGN[CAP-ASSIGNMENTS]
    PROJECTS[CAP-PROJECTS]
    SUBMIT[CAP-SUBMISSIONS]
    COMMENTS[CAP-COMMENTS]
    REVIEW[CAP-REVIEW]
    AUTO[CAP-AUTOGRADING]
    ASSESS[CAP-ASSESSMENT]
    REWARD[CAP-REWARDS]
    PROGRESS[CAP-PROGRESS]

    CONTENT --> ASSIGN
    MODULES --> ASSIGN
    MODULES --> PROJECTS
    ASSIGN --> SUBMIT
    PROJECTS --> SUBMIT
    SUBMIT --> COMMENTS
    COMMENTS --> REVIEW
    PROJECTS --> AUTO
    AUTO --> ASSESS
    REVIEW --> ASSESS
    ASSESS --> REWARD
    ASSESS --> PROGRESS
    REWARD --> PROGRESS
```

## 6. Предметные модули

```mermaid
flowchart TB
    SDK[CAP-MODULE-REGISTRY]
    P[CAP-PROJECTS]
    G[CAP-AUTOGRADING]

    E[CAP-ELECTRONICS]
    B[CAP-BLOCK-CODING]
    D[CAP-THREE-D]
    R[CAP-ROBOTICS]
    C[CAP-CHESS]
    DR[CAP-DRAWING]

    SDK --> E
    SDK --> B
    SDK --> D
    SDK --> R
    SDK --> C
    SDK --> DR
    P --> E
    P --> B
    P --> D
    P --> R
    P --> C
    P --> DR
    G --> E
    G --> R
```

## 7. Релизная последовательность

```mermaid
flowchart LR
    R0[RELEASE-0 Foundation]
    R1[RELEASE-1 Teacher Portal]
    R2[RELEASE-2 Child Access]
    R3[RELEASE-3 Project Assignment Cycle]
    R4[RELEASE-4 Review Assessment Rewards]
    R5[RELEASE-5 Electronics]
    R6[RELEASE-6 Additional Modules]

    R0 --> R1 --> R2 --> R3 --> R4 --> R5 --> R6
```

### RELEASE-0 — Foundation

- organization and tenancy;
- adult identity;
- safety baseline;
- operations baseline.

### RELEASE-1 — Teacher Portal

- login;
- teacher dashboard;
- classroom lifecycle;
- basic notifications.

### RELEASE-2 — Child Access

- StudentSeat;
- class code/QR;
- student dashboard;
- child login without email.

### RELEASE-3 — Universal project and assignment cycle

- Module Registry;
- Project envelope;
- autosave and immutable versions;
- activity and assignment;
- submission attempt.

### RELEASE-4 — Review, assessment and rewards

- comments and annotations;
- review queue;
- rubric;
- grade;
- badge;
- progress.

### RELEASE-5 — Electronics

- circuit editor;
- simulation;
- autograding;
- complete classroom workflow.

### RELEASE-6 — Additional modules

- block coding;
- 3D;
- robotics;
- chess/checkers;
- drawing/drafting.

## 8. Карта кабинета педагога

```mermaid
flowchart TB
    HOME[Главная]
    CLASSES[Классы]
    CLASS[Страница класса]
    ROSTER[Ученики и группы]
    ASSIGNMENTS[Задания]
    REVIEW[Очередь проверки]
    GRADEBOOK[Оценки]
    REWARDS[Достижения]
    ANALYTICS[Аналитика]
    SETTINGS[Настройки]

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

## 9. Карта кабинета ученика

```mermaid
flowchart TB
    SHOME[Главная]
    SCLASSES[Мои классы]
    STASKS[Мои задания]
    SPROJECTS[Мои проекты]
    SFEEDBACK[Комментарии и результаты]
    SBADGES[Достижения]
    SPORTFOLIO[Портфолио]

    SHOME --> SCLASSES
    SHOME --> STASKS
    SHOME --> SPROJECTS
    SHOME --> SFEEDBACK
    SHOME --> SBADGES
    SHOME --> SPORTFOLIO
```

## 10. Карта проверки работы

```mermaid
flowchart TB
    QUEUE[Review Queue]
    VIEW[Module Viewer]
    AUTO[Automatic Results]
    DIFF[Attempt Diff]
    COMMENT[Comments and Anchors]
    RUBRIC[Rubric]
    DECISION[Decision]
    GRADE[Grade]
    BADGE[Badge]

    QUEUE --> VIEW
    VIEW --> AUTO
    VIEW --> DIFF
    VIEW --> COMMENT
    VIEW --> RUBRIC
    RUBRIC --> DECISION
    COMMENT --> DECISION
    AUTO --> DECISION
    DECISION --> GRADE
    DECISION --> BADGE
```

## 11. Правило использования capability IDs

Каждая продуктовая Issue должна содержать раздел:

```text
CAPABILITIES:
- CAP-...
- CAP-...
```

Каждый PR должен указать:

- какие capabilities реализует;
- какие не реализует;
- какие зависимости capabilities подтверждены;
- какие пользовательские flows изменены;
- какие карты обновлены.

Новый capability сначала добавляется в `CAPABILITY_MAP.yaml`, затем в Issue. Чат не является источником нового scope.
