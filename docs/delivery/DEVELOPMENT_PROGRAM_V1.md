# ASA Lab — Development Program

**Машиночитаемый executable contract:** [`EXECUTION_MANIFEST.yaml`](EXECUTION_MANIFEST.yaml)  
**Current state:** [`../project-map/project-map.yaml`](../project-map/project-map.yaml)  
**Quality registry:** [`../testing/test-catalog.yaml`](../testing/test-catalog.yaml)  
**Ports:** [`LOCAL_PORT_POLICY.md`](LOCAL_PORT_POLICY.md)

## 1. Назначение

Этот документ объясняет человеку текущий путь разработки. Исполняемая задача определяется только `EXECUTION_MANIFEST.yaml`, Project Map и связанной GitHub Issue.

Принятый технический Alpha-baseline:

```text
7afebdcf9441b027092ce17a37f1f89950af99c6
```

Baseline доказывает работоспособность runtime, Docker, PostgreSQL, RLS, persistence, backup/restore и существующих пользовательских flows, но **не заявляет функциональную полноту продукта**.

## 2. Delivery stage и architecture horizon

- **delivery stage** — владелец-управляемый порядок пользовательских результатов;
- **architecture horizon** — техническая область результата и не является разрешением перескочить очередь.

Roadmap может содержать dependency-ready работу, но она не становится executable без отдельного owner transition.

## 3. Текущая executable queue

```text
TASK-PRODUCT-DOC-001   done
→ TASK-PORTAL-001      done
→ TASK-ACCOUNT-C1-001  in_progress
→ STOP FOR OWNER REVIEW
```

У `TASK-ACCOUNT-C1-001` поле `next_task` равно `null`. Это намеренная защита от автоматического перехода к Electronics или любой другой capability.

## 4. Technical Product Alpha

Текущая единая линия:

```text
branch: assistant/docker-linux-bootstrap
PR: #70 Draft
```

`main` пока содержит более старый Teacher Portal baseline. Merge, release tag, новая product branch и удаление старых линий выполняются только отдельным решением владельца.

### Уже принято в Alpha-baseline

- public entry;
- adult registration;
- Account / Profile / Principal;
- Personal Workspace;
- sessions_v2;
- login по email или username;
- legacy teacher compatibility;
- Project Hub;
- Electronics, Chess и Chess Online;
- Docker/PostgreSQL/RLS/recovery foundation.

Эти функции сохраняются и не реализуются повторно.

## 5. Текущий этап — Account C1

**Task:** `TASK-ACCOUNT-C1-001`  
**Issue:** [Issue №48](https://github.com/spikeal8-maker/asa-lab/issues/48)  
**Architecture horizon:** `PHASE-1`

### Пользовательский результат

```text
Account
→ account menu
→ profile
→ email verification state
→ educator self-attestation
→ audited provisional educator capability
→ available workspaces
→ safe ActiveContext switch
→ active sessions
→ revoke one/all other sessions
```

### Оставшийся scope

- server-side age policy for educator self-attestation;
- AuditEvent и idempotent provisional capability grant;
- membership-scoped workspace list;
- current-session ActiveContext switching;
- profile update без client-forged capability/tenant/workspace;
- active session list без token hash;
- revoke one and all other sessions;
- real Chromium Account C1 flow;
- preservation of the existing teacher, classes, projects and drafts.

### Non-goals

- Electronics/Chess expansion;
- StudentSeat;
- publication and community;
- assignments, grades and badges;
- destructive legacy cleanup;
- second Account/Principal/Workspace/session model.

## 6. Roadmap после Account C1

Эти releases **blocked** и не входят в текущий executable manifest.

### R2 — Creator Portal

**Issue №62:** Creator Home and capability-aware Portal shell.

```text
Account login
→ Creator Home
→ recent projects
→ capability-aware navigation
→ workspace switcher
→ help and account menu
```

R2 активируется отдельным owner transition только после Account C1 acceptance.

### R3 — полный project lifecycle

**Issue №37:** Module Registry, Project Hub and shared Editor Host.

```text
Creator Home
→ Projects
→ search/filter/sort/trash
→ registry-driven Create
→ shared Editor Host
→ autosave/reload
→ preview
→ immutable version
```

R3 активируется отдельным owner transition только после R2 acceptance.

### R4 — Electronics parity

**Issue №63:** complete Circuits and Electronics functional parity.

R4 не начинается до R3. Работающий Electronics Alpha сохраняется, но не считается полной функциональной parity.

## 7. School Pilot

School Pilot остаётся roadmap после Account, Portal, Project lifecycle и Electronics gates:

```text
Classroom / StudentSeat
→ learner workspace
→ Assignment
→ immutable submission
→ review and resubmission
→ grade and badge
```

Старые v1 task IDs сохраняются в Project Map и test catalog только для traceability. Они не находятся в текущей executable queue.

## 8. Scope freeze

После начала task разрешены только изменения текущего user flow, его migrations, API, UI, security, tests и review feedback.

Запрещено:

- начинать roadmap release;
- добавлять unrelated capability;
- создавать competing product branch;
- ослаблять RLS, tests, contracts или validation;
- менять применённую migration вместо additive migration;
- удалять legacy data до отдельного destructive gate.

## 9. Порты

```text
Web  127.0.0.1:4610
API  127.0.0.1:4611
E2E  127.0.0.1:4612
```

Запрещены `3000`, `3100`, `5173`. Чужие процессы и контейнеры не останавливаются.

## 10. Проверка

Focused task gate:

```bash
python tools/run_task_tests.py --task TASK-ACCOUNT-C1-001
```

Общий gate:

```bash
python tools/validate_infrastructure_focus.py
python tools/validate_project_map.py
python tools/validate_test_catalog.py
python tools/validate_delivery_program.py
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm boundaries:check
pnpm contracts:check
pnpm build
pnpm test
```

Account-specific PostgreSQL/RLS и Chromium tests обязательны после их реализации. Зарегистрированная, но ещё отсутствующая test command должна возвращать `BLOCKED`, а не фиктивный `PASS`.

## 11. Map protocol

### Start

- task status → `in_progress`;
- `current_focus` остаётся текущей task;
- только фактически затронутые map nodes становятся active.

### Draft PR

- task может стать `in_review` только после focused PASS и owner-visible result;
- Project Map, Quality Map, test catalog и Nx graph синхронизированы;
- roadmap остаётся blocked.

### After acceptance

- владелец определяет convergence/merge action;
- task → `done` только после принятого gate;
- отдельный governance transition решает, активировать ли R2;
- coding-агент останавливается и не начинает R2 в той же сессии.

## 12. Evidence

Перед owner acceptance требуются:

1. итоговый SHA;
2. exact commands and PASS/FAIL/BLOCKED/NOT_RUN;
3. migration empty/existing/repeat evidence;
4. PostgreSQL and RLS negative matrix;
5. real browser E2E;
6. browser failure counters;
7. screenshots основных Account surfaces;
8. preservation counts for existing teacher/projects;
9. clean tracked working tree;
10. updated PR report.

## 13. Отчёт

```text
MILESTONE:
TASK:
ISSUE:
STATUS:
VISIBLE_RESULT:
USER_FLOW:
PORTS:
BRANCH:
COMMITS:
TESTS_RUN:
ARTIFACTS:
SCREENSHOTS:
BLOCKERS:
RESIDUAL_RISKS:
WORKING_TREE:
NEXT_ALLOWED_TASK:
NEXT_COMMAND:
```

## 14. Успех текущего этапа

Account C1 завершён, когда:

- существующий identity foundation не продублирован;
- educator self-attestation и audit работают;
- workspace context server-derived;
- profile and sessions UI работают;
- revoked session immediately denied;
- cross-account/workspace forgery denied;
- existing teacher and projects preserved;
- focused and full gates относятся к одному итоговому SHA;
- владелец явно принимает результат.

После этого работа останавливается. Issue №62 не активируется автоматически.
