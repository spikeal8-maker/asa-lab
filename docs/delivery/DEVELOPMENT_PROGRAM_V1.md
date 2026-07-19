# ASA Lab — Development Program v1

**Статус:** каноническая программа реализации Product Alpha и первого школьного пилота.  
**Epic:** [Issue №23 — ASA Lab Product Alpha → School Pilot](https://github.com/spikeal8-maker/asa-lab/issues/23).  
**Портовая политика:** [`LOCAL_PORT_POLICY.md`](LOCAL_PORT_POLICY.md).  
**Продуктовая цель:** [`../product/PRODUCT_BLUEPRINT.md`](../product/PRODUCT_BLUEPRINT.md).

## 1. Назначение документа

Этот документ отвечает не на вопрос «какой когда-нибудь будет ASA Lab», а на вопрос:

> **Как из текущего репозитория последовательно получить работающий сайт, универсальные проекты, простой reference module, электронную лабораторию и затем полный школьный учебный цикл.**

Документ обязателен для coding-агентов. Он устраняет управление через длинную переписку между владельцем, консультантом и ботом.

Владелец выдаёт агенту короткую команду:

```text
Открой current_focus в docs/project-map/project-map.yaml и выполни связанную GitHub Issue строго по DEVELOPMENT_PROGRAM_V1.md.
```

Всё остальное агент берёт из GitHub.

## 2. Конечный результат системы

ASA Lab должна стать единой образовательной платформой:

```text
Organization / School
→ Teacher and Child Identity
→ Classroom
→ Universal Project
→ Subject Module
→ Assignment
→ Immutable Submission
→ Review and Comment
→ Grade and Badge
→ Progress
```

Предметные модули:

```text
Electronics
Block Coding / Scratch-like
3D
Virtual Robotics
Checkers / Chess
Drawing / Drafting
Programming
Future modules
```

Главный инвариант:

> Один Classroom Core, один Project lifecycle, один Submission/Review lifecycle — множество независимых предметных редакторов.

Classroom Core не знает, что такое резистор, шашечная фигура, sprite или 3D mesh.

## 3. Текущее состояние на момент программы

### Сохранённый фундамент

В `main` уже существует:

- pnpm + Nx monorepo;
- TypeScript strict;
- PostgreSQL migration runner;
- OpenAPI/JSON Schema validation;
- Fastify/NestJS-compatible API foundation;
- React/Vite foundation в продуктовой ветке;
- OpenTelemetry foundation;
- architecture boundaries;
- project map и test catalog;
- local-first verification.

### Активные Pull Requests

- PR №21 — Product Blueprint, Capability Map и эта Development Program;
- PR №22 — Teacher Portal v0.1, который должен быть стабилизирован после merge PR №21.

### Что не требуется строить повторно

- ещё один monorepo;
- новую CI-платформу;
- Docker/WSL setup;
- Redis/MinIO до реального использования;
- новый framework ради framework;
- дополнительную архитектурную документацию без связи с этапом.

## 4. Два контура поставки

Разработка разделена на два последовательных контура.

## 4.1. Technical Product Alpha

Цель — быстро получить демонстрируемый продукт и доказать модульную архитектуру.

```text
Product docs
→ Teacher Portal
→ Universal Project Shell
→ Checkers Lite reference module
→ Electronics Alpha
```

После Technical Alpha педагог уже может:

- войти;
- создать класс;
- создать универсальный проект;
- открыть Checkers Lite;
- открыть Electronics Alpha;
- сохранить и повторно открыть работу;
- получить детерминированный результат электронной схемы.

## 4.2. School Pilot

Цель — превратить технический продукт в образовательный процесс.

```text
StudentSeat
→ Assignment and Submission
→ Comments Review Grade Badge
→ Full Electronics Classroom Cycle
```

После School Pilot школа может провести первый полный урок:

```text
teacher creates class
→ issues child access
→ assigns electronics task
→ child logs in
→ builds circuit
→ submits version
→ teacher comments
→ child corrects
→ teacher accepts and grades
→ badge and progress appear
```

## 5. Общие правила выполнения

## 5.1. Одна Issue — один пользовательский flow

Executable Issue должна содержать один наблюдаемый результат.

Запрещено объединять в одной задаче:

- текущий пользовательский flow;
- следующую capability;
- инфраструктурный redesign;
- unrelated refactoring;
- будущие роли/страницы.

## 5.2. Одна задача — одна ветка — один PR

```text
ready Issue
→ task branch
→ in_progress
→ Draft PR
→ tests/review
→ merge
→ done
→ next task ready
```

Следующую задачу нельзя начинать в том же PR или той же рабочей сессии после завершения текущей.

## 5.3. Scope freeze

После перехода task в `in_progress` scope заморожен.

Допустимы только:

- исправление дефекта внутри принятого flow;
- исправление security-проблемы данных, уже обрабатываемых задачей;
- необходимые contract/migration/test изменения;
- review comments по текущему scope.

Новая идея создаёт следующую Issue. Она не добавляется в текущий task через чат.

## 5.4. Пользовательская ценность имеет приоритет

Инфраструктурная работа допустима только если без неё невозможно выполнить обязательный пользовательский flow или test ID.

Запрещено останавливать продукт ради:

- Docker polish;
- CI polish;
- Kubernetes;
- Redis/MinIO, если код их не использует;
- server deployment design;
- federal-scale optimization до измерений;
- дополнительной governance-системы.

## 5.5. Канонические порты

Все этапы соблюдают [`LOCAL_PORT_POLICY.md`](LOCAL_PORT_POLICY.md):

```text
Web  127.0.0.1:4610
API  127.0.0.1:4611
E2E  127.0.0.1:4612
```

Запрещены `3000`, `3100`, `5173`.

## 5.6. Источники истины для агента

Для каждой задачи агент читает:

1. текущую GitHub Issue;
2. этот документ — только раздел текущего этапа и общие правила;
3. перечисленные в Issue capability entries;
4. явно указанные в Issue разделы профильной спецификации;
5. AGENTS.md и BOT_RUNBOOK;
6. test IDs текущей задачи.

Агент не обязан каждый раз перечитывать тысячи строк всей продуктовой документации, если Issue содержит точные ссылки.

## 6. Этап 0 — Product Documentation Acceptance

### Task

`TASK-PRODUCT-DOC-001`, Issue №19, PR №21.

### Результат

В `main` находятся:

- Product Blueprint;
- Capability Map;
- Classroom Core Spec;
- Module Platform Spec;
- Assessment/Rewards Spec;
- Development Program v1;
- Local Port Policy;
- согласованные Issues и Project Map.

### Exit gate

- architecture validator PASS;
- project map validator PASS;
- capability map validator PASS;
- test catalog validator PASS;
- Product Doc task runner PASS;
- PR №21 merged.

### После merge

- `TASK-PRODUCT-DOC-001 → done`;
- `TASK-PORTAL-001 → ready`;
- `current_focus → TASK-PORTAL-001`.

## 7. Этап 1 — Teacher Portal v0.1

### Task

[Issue №18 — TASK-PORTAL-001](https://github.com/spikeal8-maker/asa-lab/issues/18), существующий PR №22.

### Наблюдаемый flow

```text
open site
→ teacher login
→ «Мои классы»
→ create classroom
→ classroom card
→ reload
→ logout
```

### Что сохраняется

- React/Vite frontend;
- NestJS/Fastify API;
- identity/organization/classroom contexts;
- PostgreSQL;
- session cookie;
- classroom + owner membership + AuditEvent;
- RLS defense-in-depth;
- Playwright flow.

### Что обязательно исправляется

Полный список находится в Issue №18. Ключевые блокеры:

- rebase на merged Product Docs;
- dependency security;
- полный test gate;
- separation admin/runtime/test DB URLs;
- reproducible `pnpm dev`;
- canonical ports;
- runtime validation;
- idempotency conflict semantics;
- test database isolation;
- accessibility;
- health/request-id/telemetry regression;
- context boundaries.

### Demo

```text
http://127.0.0.1:4610
```

### Exit

Teacher Portal работает из чистой PowerShell-сессии; PR №22 merged.

## 8. Этап 2 — Universal Project Shell

### Task

[Issue №24 — TASK-PROJECT-SHELL-001](https://github.com/spikeal8-maker/asa-lab/issues/24).

### Наблюдаемый flow

```text
teacher opens Projects
→ creates project
→ chooses module
→ edits minimal payload
→ saves
→ reload restores draft
→ creates immutable checkpoint
```

### Обязательный результат

- Module Registry v0.1;
- Project envelope;
- ProjectDraft in PostgreSQL jsonb;
- optimistic row version;
- immutable ProjectVersion + digest;
- module host;
- project list/cards;
- blank-canvas technical module.

### Не входит

- children;
- assignments;
- checkers/electronics subject logic;
- S3/Redis/MinIO;
- advanced autosave infrastructure.

### Exit

Universal Project lifecycle proven by E2E and checkpoint test.

## 9. Этап 3 — Checkers Lite

### Task

[Issue №25 — TASK-CHECKERS-LITE-001](https://github.com/spikeal8-maker/asa-lab/issues/25).

### Зачем

Маленький reference module проверяет реальную расширяемость Module SDK до начала более сложной электроники.

### Наблюдаемый flow

```text
create Checkers project
→ board opens
→ legal move
→ invalid move diagnostic
→ save/reload
→ preview
```

### Не входит

- AI;
- multiplayer;
- rating;
- tournament;
- full chess engine;
- assignments/grades.

### Exit

Checkers module добавлен без изменений предметной логики в Classroom/Project Core.

## 10. Этап 4 — Electronics Alpha

### Task

[Issue №26 — TASK-ELECTRONICS-ALPHA-001](https://github.com/spikeal8-maker/asa-lab/issues/26).

### Наблюдаемый flow

```text
create Electronics project
→ place source/resistor/LED
→ connect wires
→ set values
→ validate/netlist
→ calculate DC current
→ LED on/off/overcurrent
→ save/reload
```

### Обязательный результат

- CircuitDocument v1 JSON Schema;
- source/resistor/LED/wire manifests;
- React editor;
- connectivity resolver;
- deterministic normalized netlist;
- minimal Rust native + WASM solver;
- structured diagnostics;
- preview;
- project integration.

### Не входит

- breadboard;
- transient;
- Arduino;
- instruments;
- large catalog;
- assignment/review;
- advanced autograding.

### Exit

Работающая схема и native/WASM parity подтверждены E2E/golden artifacts.

## 11. Этап 5 — StudentSeat and Child Dashboard

### Task

[Issue №7 — TASK-SEAT-001](https://github.com/spikeal8-maker/asa-lab/issues/7).

### Наблюдаемый flow

```text
teacher creates seat/card
→ child login without email
→ child dashboard
→ class visible
→ own Alpha project opens
→ credential reset
→ old session denied
```

### Exit

Child access безопасен, printable и не требует email.

## 12. Этап 6 — Assignment and Immutable Submission

### Task

[Issue №8 — TASK-ACT-001](https://github.com/spikeal8-maker/asa-lab/issues/8).

### Наблюдаемый flow

```text
teacher publishes ActivityVersion
→ assigns class
→ child opens starter project
→ works/saves
→ submits immutable ProjectVersion
→ teacher queue shows exact attempt
```

### Exit

Assignment/Submission cycle работает минимум на одном Alpha module.

## 13. Этап 7 — Comments, Review, Grade and Badge

### Task

[Issue №20 — TASK-REVIEW-001](https://github.com/spikeal8-maker/asa-lab/issues/20).

### Наблюдаемый flow

```text
teacher opens attempt
→ anchored comment
→ requests changes
→ child resubmits
→ teacher accepts
→ rubric/grade
→ badge
→ dashboards update
```

### Exit

Полный предметно-независимый assessment flow подтверждён E2E.

## 14. Этап 8 — Full Electronics Classroom Cycle

### Task

[Issue №6 — TASK-ELEC-001](https://github.com/spikeal8-maker/asa-lab/issues/6).

### Наблюдаемый flow

```text
teacher assigns electronics activity
→ child builds circuit
→ public checks
→ immutable submission
→ anchored review
→ revision
→ grade and electronics badge
```

### Exit

Электронная лаборатория проходит весь Classroom lifecycle без circuit-specific logic в Core.

## 15. Что идёт после v1 программы

После Stage 8 владелец создаёт новые отдельные Issues для:

- Electronics Advanced: breadboard, transient, instruments;
- Arduino and code compilation;
- Scratch-like block coding;
- 3D modelling/print export;
- virtual robotics;
- full chess/checkers learning tools;
- drawing/drafting;
- analytics/admin/commercial scale.

Ни один из этих элементов не добавляется в задачи v1 молча.

## 16. Обязательная демонстрационная точка каждого этапа

Перед переводом PR из Draft в Ready агент обязан предоставить:

1. точную локальную команду запуска;
2. URL на каноническом порту;
3. автоматизированный E2E;
4. screenshot основного состояния;
5. screenshot error/diagnostic state, если применимо;
6. test report с commit SHA;
7. clean working tree;
8. отсутствие следующей capability в diff.

## 17. Формат промежуточного отчёта

Агент обновляет пользователя после каждого завершённого внутреннего milestone, а не после каждой команды.

```text
MILESTONE: Technical Alpha 2 / Database and API
STATUS: completed | blocked
VISIBLE_RESULT: что уже можно открыть или проверить
FILES_CHANGED: укрупнённо
TESTS:
  ... PASS|FAIL|BLOCKED
DEMO_URLS:
SCREENSHOTS:
BLOCKERS:
NEXT_INTERNAL_MILESTONE:
```

Промежуточный отчёт не меняет task scope.

## 18. Финальный BOT_RUNBOOK report

```text
MILESTONE:
TASK:
ISSUE:
STATUS:
CAPABILITIES:
USER_FLOW:
  ... PASS|FAIL|BLOCKED
PORTS:
  web: 127.0.0.1:4610
  api: 127.0.0.1:4611
  e2e: 127.0.0.1:4612
BRANCH:
COMMITS:
FILES_CHANGED:
MAP_NODES_CHANGED:
TESTS_RUN:
ARTIFACTS:
BLOCKERS:
RESIDUAL_RISKS:
NEXT_ALLOWED_TASK:
NEXT_COMMAND:
```

## 19. Короткая команда владельца агенту

Для текущей задачи:

```text
Работай в spikeal8-maker/asa-lab. Прочитай AGENTS.md, docs/delivery/DEVELOPMENT_PROGRAM_V1.md и current_focus из docs/project-map/project-map.yaml. Открой связанную GitHub Issue и выполни только её. Следующую задачу не начинай.
```

Эта команда достаточна. Если агент просит переопределить scope через чат, он должен быть возвращён к Issue и карте.

## 20. Критерий успешности программы v1

Программа завершена, когда на одном локальном сайте ASA Lab:

- педагог входит и управляет классом;
- ребёнок входит без email;
- оба используют единый Project Shell;
- Checkers Lite и Electronics подключены как независимые модули;
- педагог назначает Electronics activity;
- ребёнок сохраняет и сдаёт immutable version;
- педагог оставляет anchored comment, возвращает и принимает работу;
- grade и badge отображаются;
- все данные tenant/class/student isolated;
- весь поток подтверждён автоматизированным browser E2E.