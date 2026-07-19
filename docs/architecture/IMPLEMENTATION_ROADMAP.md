# Дорожная карта реализации ASA Lab

> **Статус документа:** долгосрочные архитектурные горизонты, а не исполнимая очередь coding-агента.  
> Точный порядок задач, ветки, Issues, test profiles и map protocol находятся в [`../delivery/EXECUTION_MANIFEST.yaml`](../delivery/EXECUTION_MANIFEST.yaml) и [`../delivery/DEVELOPMENT_PROGRAM_V1.md`](../delivery/DEVELOPMENT_PROGRAM_V1.md).  
> Technical Product Alpha может доказать небольшой срез Project Shell или Electronics раньше полного завершения более раннего школьного контура. Это не изменяет архитектурных зависимостей и не разрешает агенту перескакивать `execution_queue`.

Каждый архитектурный горизонт реализуется вертикальными срезами с UI, API, БД, авторизацией, аудитом и тестами. Следующая **исполняемая задача** начинается только после merge, exit gate и map transition предыдущей задачи по Execution Manifest.

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

Exit gate: пустой skeleton собирается, тестируется, запускается локально, а architecture rules нельзя нарушить без падения проверок.

## Phase 1 — Tenancy, Adult Identity and Teacher Portal

- Tenant, TenantPlacement, School, User;
- local adult login;
- external identity mapping interface;
- session security;
- RBAC/ABAC foundation;
- immutable audit;
- runtime DB role и tenant isolation;
- teacher portal basic: login, classroom create/list;
- platform/school admin shell в более позднем срезе;
- time-limited support-access model в более позднем срезе.

Exit gate текущего v1-среза: Teacher Portal flow, cross-tenant matrix, server-derived tenant context и полный `TASK-PORTAL-001` gate PASS.

## Phase 2 — Child Access and Classroom Roster

- classroom memberships and groups;
- StudentSeat create/import;
- cards and revocable QR;
- reset/suspend/archive;
- child login without email;
- Child Dashboard;
- co-teacher grants и расширенный teacher dashboard отдельными срезами;
- Safe Mode foundation.

Exit gate v1: ребёнок входит без email, видит только свой класс/проект, credential reset отзывает старые sessions, authz matrix PASS.

## Phase 3 — Module SDK, Projects and Learning Workflow

- module registry;
- versioned module manifest;
- universal project envelope;
- ProjectDraft и immutable ProjectVersion;
- optimistic conflict protocol;
- preview contract;
- Checkers Lite reference module;
- ActivityTemplate/ActivityVersion;
- Assignment and immutable SubmissionAttempt;
- operation batches/IndexedDB autosave в более позднем расширении.

Exit gates разделены Execution Manifest:

1. Project Shell create/save/reload/checkpoint;
2. Checkers Lite подключён без subject imports в Core;
3. Assignment/Submission pins exact immutable ProjectVersion.

## Phase 4 — Review, Assessment and Rewards

- review queue;
- general and anchored comments;
- request changes/resubmission;
- exact attempt/version viewer;
- rubric and grade;
- badge and progress;
- notifications;
- advanced analytics отдельным срезом.

Exit gate v1: `teacher → comment → return → child revise → accept → grade → badge` automated E2E.

## Phase 5 — Electronics

### Electronics Alpha

- CircuitDocument v1 JSON Schema;
- source, resistor, LED and wire manifests;
- scene/editor basics;
- components, pins, wires and nets;
- connectivity resolver;
- normalized netlist;
- minimal Rust native/WASM DC solver;
- structured diagnostics;
- project preview and save/reload.

Alpha exit gate: supported series circuit produces deterministic native/WASM result; invalid/unsupported topology produces diagnostics; E2E and golden artifacts PASS.

### Full Electronics Classroom Cycle

- Electronics ActivityVersion;
- starter circuit;
- deterministic public checks;
- immutable submission;
- component/wire anchored comments;
- revision, grade and electronics badge.

Classroom exit gate: electronics completes the common Assignment/Submission/Review lifecycle without circuit-specific fields in Core.

## Phase 6 — Extended Simulation Core

- expanded Rust workspace;
- general netlist builder;
- broader DC solver;
- switch and additional linear components;
- extended diagnostics;
- deterministic golden suites;
- browser Web Worker;
- execution manifest for compute jobs.

Exit gate: expanded golden circuits reproduce in native and WASM within declared tolerances.

## Phase 7 — Arduino

- code-project contract;
- text editor;
- compile job;
- OCI sandbox;
- ATmega/Arduino emulation adapter;
- GPIO, PWM, ADC, UART;
- serial monitor;
- blocks-to-text only after stable text flow.

Exit gate: Blink works in browser simulation and server autograder with the same environment manifest.

## Phase 8 — Instruments and Advanced Autograding

- structural and topology tests;
- behavioral tests;
- public and hidden separation;
- multimeter;
- oscilloscope;
- result report;
- retry/idempotency;
- teacher test-authoring UI.

Exit gate: reproducible assessment of immutable submission without exposing hidden tests.

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
- privacy-allowlisted usage analytics.

Exit gate: school-pilot SLO confirmed, backup restored, high/critical findings closed.

## Phase 10 — Commercial Foundation

- Plan and immutable PlanVersion;
- entitlement and quota;
- append-only usage ledger;
- billing account;
- provider adapter;
- grace period;
- invoice references;
- admin reports;
- tenant overrides.

Payment provider follows the entitlement model, not vice versa.

Exit gate: plan changes do not change subject code or delete educational data.

## Phase 11 — Multi-school and Regional Scale

- durable broker;
- autoscaled worker pools;
- read replicas/reporting;
- tenant placement;
- dedicated-database migration tooling;
- regional operations;
- SSO integrations;
- advanced observability;
- measured partitioning.

Exit gate: L2 load profile with safety factor, failover and backlog recovery confirmed.

## Phase 12 — Additional Subject Modules

Order is set by pedagogical value and Module SDK readiness:

- Scratch-like block coding;
- advanced chess/checkers learning tools;
- 3D modelling and print export;
- virtual robotics;
- drawing and drafting;
- additional controllers and laboratories.

Each module has schema/migrator, Safe Mode declaration, accessibility, project lifecycle and no Classroom Core modifications.

## Правило планирования

Architecture phases describe **where a capability belongs**. Execution Manifest describes **when a specific user flow is implemented**. Work is always split into vertical tasks; it is forbidden to write “all database”, then “all backend”, then “all frontend”.
