# ASA Lab — execution plan целевой платформы

**Статус:** нормативная программа исполнения.  
**Цель:** реализовать target blueprint без потери текущих работ, без бесконечных stacked-веток и без параллельного изменения одной поверхности несколькими агентами.

---

## 1. Главный принцип исполнения

Каждый релиз закрывает один наблюдаемый пользовательский цикл и имеет:

1. нормативный reference;
2. одну owner-facing ветку/PR;
3. additive migrations;
4. automated gates;
5. live browser demo;
6. owner stop/review;
7. merge только после принятия.

Тесты доказывают техническое состояние. Визуальная и продуктовая приёмка выполняется владельцем отдельно.

---

## 2. Конвергенция текущих веток

На момент создания плана существуют несколько полезных, но расходящихся линий:

```text
main
└── Teacher Portal foundation

PR #34
└── Electronics / Project foundation

PR #43
└── Product/evidence/target contract

PR #45
└── Module Registry / Project Hub / Editor Host candidate

PR #47
└── Visual Product System candidate

agent/parity-p1-visual-integration
└── локально проверенная интеграция #34 + #45 + #47
```

Целевое правило:

> После текущего цикла не создавать новые long-lived stacked product branches. Сначала свести foundations в один accepted baseline, затем каждый следующий релиз строить от него.

### Convergence order

1. принять PR #34 только как Electronics/Project foundation;
2. объединить PR #43 как нормативный контракт;
3. сформировать один P1 integration PR из проверенной `agent/parity-p1-visual-integration`;
4. закрыть/архивировать stacked PR #35/#45/#47 после доказанного переноса;
5. только затем создавать C1/R1 identity branch от актуального `main`;
6. новая продуктовая работа не переносится cherry-pick цепочками из трёх старых PR.

Если C1 уже начат до convergence, он обязан:

- быть основан на фактически проверенной integration branch;
- не изменять Electronics editor;
- после merge foundations быть rebased один раз;
- не открывать второй конкурирующий Portal implementation.

---

## 3. Workstream map

```text
WS-A  Identity, Account, Principal, Workspace, Sessions
WS-B  Creator Portal, Navigation, Account Menu
WS-C  Module Registry, Project Hub, Editor Host
WS-D  Electronics parity
WS-E  Classroom, StudentSeat, Learner Portfolio
WS-F  Publication, Profiles, Explore, Moderation
WS-G  Activities, Assignments, Review, Grades, Badges
WS-H  Admin, Entitlements, Operations
```

Dependencies:

```text
WS-A → WS-B
WS-B + WS-C → WS-D
WS-A + WS-C → WS-E
WS-C → WS-F
WS-E + WS-C → WS-G
WS-A + WS-F → WS-H commercial/admin expansion
```

---

## 4. Release R0 — Contract and baseline convergence

### User-visible result

Нет новой функции. Появляется единая доказанная точка старта.

### Deliverables

- merge product/evidence contract;
- accept Electronics foundation scope;
- integrate Module Registry and Visual System;
- close obsolete stacked branches after transfer;
- record baseline commit;
- refresh project map and test catalog.

### Gate

- one accepted baseline branch;
- no duplicate implementations of Portal/Editor Host;
- current teacher/classes/projects preserved;
- demo starts/stops cleanly;
- all existing gates pass;
- owner confirms screenshots.

---

## 5. Release R1 / C1 — Account and onboarding foundation

### Scope

```text
C1.1 public entry
C1.2 adult registration
C1.3 Personal Workspace and login
C1.4 educator capability
C1.5 account menu, profile, security and sessions
```

### Branch

```text
agent/r1-account-onboarding
```

От accepted baseline, один Draft PR.

### Migrations

Только MIG-ID-01..MIG-ID-05 и backfill bridge. Destructive operations запрещены.

### Mandatory Test IDs

```text
TST-ACCOUNT-REG-001
TST-ACCOUNT-BACKFILL-001
TST-ACCOUNT-LEGACY-COMPAT-001
TST-PERSONAL-WORKSPACE-001
TST-CAPABILITY-001
TST-WORKSPACE-CONTEXT-001
TST-SESSION-V2-001
TST-IDENTITY-RLS-001
TST-E2E-ACCOUNT-C1-001
```

### Owner stops

После C1.1, C1.2, C1.3, C1.4 и C1.5. Следующий этап не начинается автоматически.

---

## 6. Release R2 — Creator Home and portal shell

### User-visible result

```text
login
→ Home
→ recent module projects
→ Projects
→ Collections
→ Learning
→ Challenges
→ Help
→ account menu/workspace switcher
```

### Scope

- default Home route;
- global navigation from video evidence;
- role/capability-aware Classes item;
- account menu instead of permanent Logout;
- workspace switcher;
- Safe Mode banner for learner principal;
- honest placeholders only for evidence-confirmed surfaces.

### Gate

- adult, educator, registered student and StudentSeat see correct navigation;
- hidden items do not overflow mobile;
- no client role switch;
- 1440×900 and 390×844 owner screenshots.

---

## 7. Release R3 — Project Hub and Module Host

### User-visible result

```text
Projects
→ filter by module
→ search/sort/grid-list/trash
→ Create
→ registry-driven chooser
→ shared Editor Host
```

### Scope

- merge accepted P1 implementation;
- stable project cards;
- deterministic preview;
- active vs coming-soon modules;
- generic ModuleEditorHost;
- no subject switches in Core.

### Gate

- Electronics project opens;
- future modules cannot be created;
- project card geometry ready for visibility/publication actions;
- personal/classroom scope correctly displayed.

---

## 8. Release R4 — Electronics parity

### User-visible result

- Tinkercad-like full-screen workbench;
- owner SVG components;
- terminals/wires/vertices/colour/route;
- properties and measurements;
- run/stop simulation;
- diagnostics and LED state;
- alternate views shell;
- autosave/reload/version.

### Constraint

Identity/Portal/Core are not redesigned in this release.

### Gate

Owner approves:

```text
empty workbench
placed components
connected circuit
component inspector
wire editing
simulation running
invalid diagnostic
mobile/compact behavior where applicable
```

---

## 9. Release R5 — Classroom and StudentSeat

### User-visible result

```text
educator
→ create class
→ grade band/topics/Safe Mode
→ class workspace
→ individual/bulk seats
→ print/QR credentials
→ learner login
→ learner private project
```

### Mandatory Test IDs

```text
TST-CLASS-001
TST-CLASS-CODE-001
TST-SEAT-ONE-001
TST-SEAT-BULK-001
TST-SEAT-AUTH-001
TST-SEAT-SAFE-MODE-001
TST-SEAT-PROJECT-001
TST-E2E-CLASSROOM-R5-001
```

### Gate

- code rotation/revocation;
- no roster enumeration;
- StudentSeat cannot publish;
- learner remains creator;
- archive retention policy works.

---

## 10. Release R6 — Teacher monitoring

### User-visible result

```text
Roster
→ learner
→ portfolio
→ module tabs
→ Project Viewer
→ exact immutable version
→ version history
```

### Gate

- teacher only sees authorised class;
- access audited;
- read-only default;
- assistance mode explicit/bannered/audited;
- restore creates copy.

---

## 11. Release R7 — Sharing and publication

### User-visible result

```text
private
→ unlisted link
→ publish immutable version
→ public page
→ copy/remix
→ attribution
```

### Constraint

- unverified adult email cannot publish publicly;
- StudentSeat cannot publish;
- assignment work locked;
- no mutable draft on public page.

---

## 12. Release R8 — Profiles, Explore and moderation

- public/restricted profiles;
- portfolio;
- Collections;
- Explore/search/filters;
- likes/bookmarks;
- public comments;
- reports/moderation;
- managed-child policy.

Child content remains private/restricted by default.

---

## 13. Release R9 — Activities, assignments and assessment

```text
teacher project
→ ActivityVersion
→ assign
→ student copy
→ progress
→ immutable submission
→ feedback/anchors
→ request changes
→ resubmit
→ accept
→ grade
→ badge
```

Challenges, Learning content and Classroom Assignments remain separate contexts.

---

## 14. Release R10 — Multi-module and operations proof

At least three substantially different modules must use the same platform lifecycle:

- Electronics;
- Blocks;
- Chess/Checkers or 3D.

Add operations only from measured need:

- isolated workers;
- object storage;
- realtime;
- quotas/entitlements;
- dedicated placement/on-premise;
- billing provider.

---

## 15. Parallel-work rules

1. Один actor owns one active product task/branch.
2. Не более одного agent изменяет один экран/context одновременно.
3. Documentation/evidence branch может развиваться параллельно, но не менять product code.
4. Subject module branch не меняет Identity/Classroom Core.
5. Identity branch не меняет Electronics solver/workbench.
6. Visual branch не объявляет business capability implemented.
7. Stacked PR должен быть временным и закрывается сразу после verified transfer.
8. Любой rebase/squash сопровождается повторным live demo, а не только typecheck.

---

## 16. Standard task packet for bots

Каждая coding Issue должна содержать:

```text
TARGET RELEASE
REFERENCE EVIDENCE
ACTORS / PRINCIPALS
ACTIVE WORKSPACE / CONTEXT
VISIBLE USER FLOW
DATA OWNERSHIP
PERMISSION SOURCE
MIGRATION IMPACT
COMPATIBILITY REQUIREMENTS
API ROUTES
SCREENS / STATES
TEST IDS
NEGATIVE TESTS
OWNER REVIEW MILESTONES
ROLLBACK
NON-GOALS
NEXT TASK BLOCKED
```

Если хотя бы один раздел отсутствует, кодовая задача не начинается.

---

## 17. Definition of Done

Release не `done`, пока одновременно не выполнены:

- product flow работает в live Chromium без mocks;
- migration проходит на empty и existing DB;
- existing user/classes/projects preserved;
- security negative tests pass;
- automated task gate pass;
- accessibility gate pass;
- screenshots/video captured;
- owner explicitly accepts visible result;
- map, test catalog and evidence synchronized;
- next release remains blocked until transition commit.
