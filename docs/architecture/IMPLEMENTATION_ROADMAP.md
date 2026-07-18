# Дорожная карта реализации ASA Lab

Каждый этап является вертикальным срезом с UI, API, БД, авторизацией, аудитом и тестами. Следующий этап не начинается, пока exit gate предыдущего не подтверждён фактическими командами и тестами.

## Phase 0 — Repository Foundation

Результат:

- `pnpm` + Nx monorepo;
- TypeScript strict;
- apps skeleton;
- context packages;
- dependency boundaries;
- CI gates;
- OpenAPI и JSON Schema validation;
- database migration runner;
- OpenTelemetry baseline;
- Docker Compose;
- AGENTS/ADR process.

Exit gate: пустой skeleton собирается, тестируется, запускается локально, а architecture rules нельзя нарушить без падения CI.

## Phase 1 — Tenancy and Identity

- Tenant, TenantPlacement, School, User;
- local adult login;
- external identity mapping interface;
- session security;
- RBAC/ABAC foundation;
- immutable audit;
- platform/school admin shell;
- time-limited support-access model.

Exit gate: cross-tenant matrix tests, MFA для platform admin, tenant context не берётся из body.

## Phase 2 — Classroom Core

- classroom lifecycle;
- owner/co-teacher grants;
- members and groups;
- academic periods;
- StudentSeat create/import;
- cards and revocable QR;
- reset/suspend/archive;
- teacher dashboard;
- Safe Mode foundation.

Exit gate: профиль массового входа десяти классов и полный отрицательный authz matrix.

## Phase 3 — Module SDK and Projects

- module registry;
- versioned module manifest;
- project envelope;
- immutable versions;
- operation batches;
- IndexedDB autosave;
- conflict protocol;
- preview job contract;
- пример второго простого модуля, доказывающий decoupling.

Exit gate: Classroom работает минимум с двумя dummy modules без предметных imports.

## Phase 4 — Activities and Assessment

- templates;
- immutable activity versions;
- assignments;
- audience and deadline;
- attempts and submissions;
- immutable submission reference;
- review queue;
- rubric and comments;
- notifications.

Exit gate: полный `teacher → student → submit → review → revise` E2E.

## Phase 5 — Electronics Editor

- circuit document JSON Schema;
- scene graph;
- components, pins, wires and nets;
- breadboard connectivity;
- properties and units;
- undo/redo;
- component manifest;
- starter projects;
- project preview;
- structured diagnostics.

Exit gate: схема сохраняется, мигрируется и открывается после reload, offline и reconnect.

## Phase 6 — Simulation Core

- Rust workspace;
- netlist builder;
- DC solver;
- resistor, source, switch and LED;
- diagnostics;
- deterministic golden tests;
- WASM binding;
- browser Web Worker;
- execution manifest.

Exit gate: golden circuits воспроизводятся в native и WASM в пределах заданных допусков.

## Phase 7 — Arduino

- code-project contract;
- text editor;
- compile job;
- OCI sandbox;
- ATmega/Arduino emulation adapter;
- GPIO, PWM, ADC, UART;
- serial monitor;
- blocks и blocks-to-text после устойчивого text flow.

Exit gate: Blink работает в browser simulation и server autograder с одинаковым environment manifest.

## Phase 8 — Autograding and Instruments

- structural and topology tests;
- behavioral tests;
- public and hidden test separation;
- multimeter;
- oscilloscope;
- result report;
- retry/idempotency;
- teacher test-authoring UI.

Exit gate: воспроизводимая оценка immutable submission без передачи hidden tests в browser.

## Phase 9 — Pilot Hardening

- 500 CCU load test;
- backup restore;
- database failover drill;
- security test;
- weak-network test;
- accessibility review;
- operational runbooks;
- support workflow;
- school admin;
- usage analytics с privacy allowlist.

Exit gate: SLO school pilot подтверждён, backup восстановлен, high/critical security findings закрыты.

## Phase 10 — Commercial Foundation

- Plan and immutable PlanVersion;
- entitlement and quota;
- append-only usage ledger;
- billing account;
- provider adapter;
- grace period;
- invoice references;
- admin reports;
- tenant entitlement overrides.

Платёжный провайдер подключается после entitlement-модели, а не наоборот.

Exit gate: изменение тарифа не меняет предметный код и не удаляет учебные данные.

## Phase 11 — Multi-school and Regional Scale

- durable broker;
- autoscaled worker pools;
- read replicas/reporting;
- tenant placement;
- dedicated-database migration tooling;
- regional operations;
- SSO integrations;
- advanced observability;
- partitioning event, audit and usage tables по измеренной необходимости.

Exit gate: L2 load profile с 2x safety factor, проверены failover и восстановление backlog.

## Phase 12 — New Subject Modules

Очередность определяется педагогической ценностью и готовностью Module SDK:

- шахматы и шашки;
- 3D-моделирование и printer export;
- 2D-робототехника;
- рисование и техническое черчение;
- дополнительные электронные контроллеры.

Каждый модуль проходит admission checklist, имеет schema/migrator, worker profile, Safe Mode compatibility и не изменяет Classroom Core.

## Правило планирования

Внутри phase работа разбивается на вертикальные use cases. Нельзя сначала написать «всю базу», потом «весь backend», потом «весь frontend». Каждый срез должен давать проверяемое пользовательское поведение и включать contracts, migration, authorization, audit, telemetry и acceptance tests.
