# AGENTS.md — обязательный контракт coding-агента ASA Lab

Этот файл имеет обязательную силу для coding-агентов и разработчиков. Нарушение правила уровня error блокирует owner acceptance и merge.

## 1. Источники истины

Порядок приоритета:

1. более поздняя принятая ADR;
2. `docs/product/PRODUCT_BLUEPRINT.md`;
3. `docs/product/CAPABILITY_MAP.yaml`;
4. архитектурные документы;
5. executable contracts: OpenAPI, JSON Schema, migrations, event schemas;
6. `INFRASTRUCTURE_EXECUTION_MANIFEST.yaml` и `infrastructure-focus.yaml`, только когда `active: true`;
7. `docs/delivery/EXECUTION_MANIFEST.yaml`;
8. `docs/project-map/project-map.yaml`;
9. GitHub Issue текущей задачи;
10. `docs/testing/test-catalog.yaml`;
11. человеко-читаемые README, Development Program, Project Map и Quality Map.

Чат может запустить работу или уточнить формулировку, но не меняет task ID, Issue, branch, dependency, port, test ID, executable queue или exit gate. Такое изменение сначала публикуется в нормативных файлах и Issue.

При конфликте агент:

1. прекращает изменения;
2. называет конфликтующие источники;
3. не выбирает один из них догадкой;
4. ждёт или выполняет только явно разрешённый governance transition;
5. не начинает product code до согласованного PASS validators.

## 2. Определение текущей задачи

### Infrastructure focus

Первым читается:

```text
docs/project-map/infrastructure-focus.yaml
```

Если `active: true`:

- выполняется только `current_focus` infrastructure lane;
- task должен совпадать с `INFRASTRUCTURE_EXECUTION_MANIFEST.yaml`;
- Issue, branch, base branch и frozen product focus должны совпадать;
- product work запрещена;
- обязателен `python tools/validate_infrastructure_focus.py`.

Если `active: false`:

- status должен быть `done | cancelled | superseded`;
- `current_focus` должен быть `null`;
- completed task и manifest должны быть согласованы;
- для `done` обязателен `completed_sha`;
- validator обязан вернуть PASS;
- после этого product task берётся из Project Map.

Текущий infrastructure state:

```text
TASK-DOCKER-LINUX-001 done
completed_sha 7afebdcf9441b027092ce17a37f1f89950af99c6
active false
```

### Product focus

Product работа разрешена, если одновременно верно:

```text
TASK-ID = project.current_focus
task присутствует в EXECUTION_MANIFEST.yaml
status = ready | in_progress | in_review
all depends_on = done
Issue открыта и не blocked
branch соответствует manifest
```

Задачи `planned`, `blocked`, `done` и `deprecated` не выполняются. Roadmap release не выбирается автоматически.

## 3. Текущий repository contract

Принятый технический Alpha-baseline:

```text
7afebdcf9441b027092ce17a37f1f89950af99c6
```

Функциональная полнота не заявляется.

Каноническая текущая линия:

```text
branch assistant/docker-linux-bootstrap
PR #70 Draft
```

`main` пока содержит более старый baseline. До отдельного owner decision запрещены:

- переключение product work на `main`;
- создание новой product branch;
- merge;
- release tag;
- закрытие или удаление старых PR/branches;
- force-push;
- destructive cleanup.

## 4. Текущая executable queue

```text
TASK-PRODUCT-DOC-001  done
→ TASK-PORTAL-001     done
→ TASK-ACCOUNT-C1-001 in_progress
→ owner review / stop
```

У `TASK-ACCOUNT-C1-001`:

```text
next_task: null
```

R2 Issue №62, R3 Issue №37 и R4 Issue №63 — blocked roadmap. Они становятся executable только отдельным owner-approved transition.

## 5. Текущий Account C1 scope

**Task:** `TASK-ACCOUNT-C1-001`  
**Issue:** №48  
**Branch:** `assistant/docker-linux-bootstrap`

Уже существует и не реализуется повторно:

- public entry;
- adult registration;
- Account / Profile / Principal;
- ровно один Personal Workspace;
- sessions_v2;
- login по email или username;
- current-session logout;
- legacy teacher compatibility;
- principal-aware project ownership;
- Project Hub, Electronics, Chess и Chess Online.

Оставшийся scope:

- server-side educator self-attestation;
- provisional audited educator capability;
- workspace list;
- membership-scoped ActiveContext switching;
- account menu/profile;
- email verification state display;
- active session list;
- revoke one/all other sessions;
- Account C1 Chromium flow;
- preservation of existing teacher, classes, projects and drafts.

Вне scope:

- Electronics/Chess expansion;
- StudentSeat;
- publication/community;
- assignments/grades/badges;
- destructive legacy cleanup;
- second Account/Principal/Workspace/session model.

## 6. Первый отчёт до кода

Не более 25 строк:

```text
TASK:
ISSUE:
BRANCH:
HEAD:
BASELINE:
STATUS:
DEPENDENCIES:
ALREADY_IMPLEMENTED:
USER_FLOW:
NON_GOALS:
PORTS:
FOCUSED_TESTS:
STOP_CRITERION:
```

Не запрашивать merge target, tag или имя следующей ветки: они не нужны для текущего slice.

## 7. Один task — один вертикальный flow

```text
domain/application
→ additive migration/repository
→ API
→ UI
→ focused tests
→ live browser E2E
→ evidence/maps
→ owner review
→ stop
```

После `in_progress` scope заморожен.

Разрешены только:

- текущий user flow;
- его security/RLS/compatibility fixes;
- необходимые contracts и additive migrations;
- focused tests, E2E и review feedback;
- связанные map/evidence updates.

Запрещены:

- следующая capability;
- unrelated refactoring;
- новый framework/service без текущей Issue;
- ослабление assertions, types, contracts, RLS или validation;
- изменение применённой migration;
- новая competing branch/PR;
- автоматическое продолжение roadmap.

## 8. Git и ветки

- продолжать существующую branch из manifest;
- branch не создаётся автоматически;
- перед изменениями `git fetch --all --prune` и проверка local/remote history;
- push только ordinary fast-forward;
- опубликованная история не переписывается;
- `reset --hard`, force-push и массовое удаление запрещены;
- backups, dumps, credentials, `.env` и owner-preview artifacts не коммитятся;
- untracked backup/screenshot files не удаляются.

## 9. Архитектура

- Control Plane — modular monolith.
- `apps/api` и `apps/web` — composition roots/adapters.
- Business logic находится в bounded contexts.
- Domain не импортирует NestJS/Fastify/HTTP, PostgreSQL client, React, Redis или object storage SDK.
- Cross-context interaction идёт через public ports/contracts.
- Прямые imports внутренних файлов и writes в чужие таблицы запрещены.
- Classroom/Project Core не знает типов конкретного subject module.
- Subject modules подключаются через versioned Module SDK/lifecycle.
- Redis, S3, queues и новые services не вводятся до реальной потребности текущей Issue.

## 10. Identity, tenant и security

- Account, Principal, Workspace, capability и membership — разные сущности.
- Account session и будущая StudentSeat session не объединяются.
- Tenant и ActiveContext определяются validated server session.
- `tenantId`, `tenant_id`, accountId, principalId, role и capability из browser body не доверяются.
- Tenant lineage защищается constraints и negative tests.
- RLS используется как defense-in-depth.
- Runtime DB role не superuser, не owner и без `BYPASSRLS`.
- API использует только runtime database credentials.
- Migrations/admin tools используют privileged URL вне runtime.
- Tests используют isolated `*_test` database.
- Passwords хранятся versioned memory-hard hashes.
- Session token создаётся CSPRNG; в БД хранится только hash.
- Passwords, raw tokens, child credentials и project content не логируются.
- Sensitive mutation создаёт immutable AuditEvent.

## 11. Migrations и данные

- migrations additive-only до отдельного destructive gate;
- уже применённая migration не редактируется;
- migration runner проверяет checksum;
- каждая migration транзакционна;
- обязательны empty/existing/repeat checks;
- repeat apply должен добавить 0 migrations;
- рабочая БД не сбрасывается;
- backup/restore проверяется только в isolated DB;
- существующие teacher/classes/projects/drafts сохраняются.

Для Account C1 migration `0010_account_identity_sessions_v2.sql` неизменна. Новая схема оформляется следующей additive migration.

## 12. Проекты и модули

- `Project` — изменяемый контейнер;
- `ProjectDraft` использует optimistic revision;
- `ProjectVersion` неизменяема;
- project envelope содержит module key/version/schema version;
- personal project не требует Classroom;
- ownership определяется сервером через Principal/Workspace context;
- несовместимое schema change требует version bump, schema, migrator и fixtures;
- предметный payload не добавляется в Core как special-case.

Работающий Electronics/Chess code сохраняется, но не расширяется в Account C1.

## 13. API и UX

- новый API обновляет OpenAPI и contract tests;
- malformed body/path/query → controlled 400, не DB 500;
- additional properties отклоняются по contract;
- idempotency conflict обрабатывается явно;
- UI имеет loading, empty, validation, network error, success, conflict and retry states;
- keyboard, focus, reduced motion and responsive behavior обязательны;
- manual smoke не заменяет automated E2E.

## 14. Порты

```text
Web  127.0.0.1:4610
API  127.0.0.1:4611
E2E  127.0.0.1:4612
```

Запрещены `3000`, `3100`, `5173`.

Если порт занят:

- не завершать чужой процесс;
- не выбирать другой порт молча;
- сообщить точный `BLOCKED`;
- остановить только собственный запуск.

## 15. Тесты

Источник истины — `test-catalog.yaml`; точный набор текущей task вычисляется из profiles и task tests manifest.

```bash
python tools/run_task_tests.py --task TASK-ACCOUNT-C1-001
python tools/validate_infrastructure_focus.py
python tools/validate_project_map.py
python tools/validate_test_catalog.py
python tools/validate_delivery_program.py
```

Result states:

- `PASS` — фактический exit 0;
- `FAIL` — фактический non-zero defect;
- `BLOCKED` — обязательная среда/runner/suite отсутствует, обычно exit 78;
- `NOT_RUN` — команда не запускалась.

Если test ID зарегистрирован до реализации suite, его команда обязана вернуть `BLOCKED`/78, а не отсутствовать и не давать PASS.

Текущие Account placeholders:

```text
pnpm test:account-c1
pnpm test:account-c1:pg
pnpm e2e:account-c1
```

Product implementation заменяет их реальными suites.

`BLOCKED` и `NOT_RUN` не закрывают gate. Удалять test ID или ослаблять assertion ради зелёного отчёта запрещено.

## 16. GitHub Actions

Workflow должен запускаться для `main`, `agent/**` и `assistant/**`.

Если hosted job завершается до первого step, steps пусты и logs отсутствуют:

- status = external `BLOCKED`;
- это не validator/code FAIL;
- это не PASS;
- проверяются Actions settings, hosted runner availability и spending/usage limits;
- локальная полная матрица остаётся обязательной.

## 17. Maps и evidence

Product-code task обновляет или подтверждает:

- `project-map.yaml`;
- `PROJECT_MAP.md`;
- `QUALITY_MAP.md`;
- `nx-project-graph.json` при structural code changes;
- test catalog и current Issue;
- PR report tied to exact SHA.

PASS другого SHA не переносится на текущий head.

## 18. Owner review и transition

После завершения Account C1:

- focused gate PASS;
- owner-visible result exists;
- full matrix на одном final SHA;
- PR остаётся Draft до owner decision;
- owner отдельно определяет convergence/merge action;
- future task не становится ready автоматически;
- отдельный governance transition может добавить R2 или оставить roadmap blocked;
- агент останавливается и не реализует R2 в той же сессии.

## 19. Definition of Done

Task может считаться готовой к owner acceptance, когда:

1. полный user flow Issue реализован;
2. non-goals отсутствуют в diff;
3. contracts, migrations, security и preservation согласованы;
4. все обязательные test IDs фактически PASS;
5. automated E2E и screenshots существуют;
6. browser failure counters равны нулю;
7. canonical ports подтверждены;
8. dependency/security gate PASS;
9. maps/evidence синхронизированы;
10. exact final SHA опубликован;
11. tracked working tree clean;
12. owner явно принимает результат.

Merge, task `done` и активация roadmap — отдельные необратимые решения и не входят автоматически в Definition of Done.
