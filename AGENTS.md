# AGENTS.md — обязательный контракт coding-агента ASA Lab

Этот файл обязателен для Codex, других coding-агентов и разработчиков. Нарушение правила с severity `error` блокирует merge.

## 0. Target Platform activation gate

В репозитории существует два поколения delivery-документов:

- принятая v1 foundation в `docs/delivery/EXECUTION_MANIFEST.yaml`;
- кандидат целевой программы в `docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml`.

Правило выбора:

1. Пока target plan имеет `status: owner_review_required` и `current_gate: R0`, разрешена только работа R0 по Issue №36 / PR №43: contract, evidence, validators и branch convergence.
2. Старые future tasks v1 (`TASK-PROJECT-SHELL-001` и далее) в этот период **не запускаются**, даже если старый Project Map показывает их следующими.
3. После явного owner approval, merge PR №43 и отдельного map transition target plan становится активной очередью R0–R10.
4. Старый `EXECUTION_MANIFEST.yaml` остаётся traceability foundation, но не может противоречить активному target plan; синхронизация выполняется в обязательном post-merge governance PR.
5. До R0 exit gate запрещено создавать новые long-lived product branches, продолжать одновременно PR №59 и №60 или напрямую merge transfer-only PR №35/№45/№47.

При расхождении target plan, Issue №36 и старой карты агент останавливается. Он не выбирает удобную очередь самостоятельно.

## 1. Источники истины

Порядок приоритета:

1. более поздняя принятая ADR;
2. после merge PR №43 — `docs/product/ASA_TARGET_PLATFORM_BLUEPRINT.md` и `.yaml`;
3. `docs/product/PRODUCT_BLUEPRINT.md` — ранее принятый общий продукт и пользовательские инварианты;
4. `docs/product/CAPABILITY_MAP.yaml` и parity contracts — capability/release dependencies;
5. `docs/architecture/ARCHITECTURE_BASELINE.md` и профильные архитектурные документы;
6. принятые исполняемые contracts: OpenAPI, JSON Schema, migrations и event schemas;
7. активный machine-readable delivery contract:
   - до R0 activation — `docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml` только как owner-gated R0 contract;
   - после activation — тот же target plan как очередь R0–R10;
8. `docs/delivery/EXECUTION_MANIFEST.yaml` — принятая v1 task/test/map foundation и legacy traceability;
9. соответствующая человекочитаемая программа исполнения;
10. `docs/delivery/LOCAL_PORT_POLICY.md` — локальные порты и безопасный запуск;
11. `docs/project-map/project-map.yaml` — динамическое состояние после обязательной синхронизации;
12. GitHub Issue текущего release/task — исполнимый scope одного user flow;
13. `docs/testing/test-catalog.yaml` — команды обязательных test IDs.

Delivery contract не может отменить ADR, target/product contract, architecture baseline или принятый executable contract. Такое изменение сначала оформляется нормативно.

Чат может запустить работу или уточнить формулировку, но не меняет release/task ID, dependency, branch, scope, port, test ID, owner stop или exit gate.

При конфликте агент:

1. прекращает изменения;
2. называет конфликтующие источники;
3. не разрешает конфликт догадкой;
4. ждёт правки нормативного файла, карты, Issue или ADR.

## 2. Как определяется текущая работа

### Во время R0

Агент обязан:

1. выполнить `git fetch --all --prune` и проверить рабочее дерево;
2. прочитать `docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml`;
3. убедиться, что `current_gate = R0`;
4. открыть Issue №36 и PR №43;
5. выполнять только contract/evidence/validator/convergence scope;
6. не изменять product code;
7. не начинать R1 и не выбирать между PR №59/№60 без owner decision.

### После R0 activation

Агент обязан:

1. прочитать `current_gate` и соответствующий release в target execution plan;
2. проверить все `depends_on` и предыдущие owner stops;
3. открыть указанную GitHub Issue;
4. продолжить только указанную canonical branch/PR либо создать её от accepted baseline;
5. прочитать только release entry, ссылки из Issue и профильные contracts;
6. получить test IDs из Issue/test catalog;
7. проверить, что старые v1 tasks не используются как competing implementation.

Работа разрешена, если:

```text
release/task = current gate
status = ready | in_progress | in_review
all depends_on = done/accepted
Issue open
branch соответствует contract
owner stop предыдущего этапа принят
```

Задачи `planned`, `blocked`, `done`, `deprecated` и `superseded` не выполняются. Более поздний release не выбирается при блокировке текущего.

## 3. Первый отчёт до кода

```text
RELEASE:
TASK:
ISSUE:
MILESTONE:
CAPABILITIES:
DEPENDENCIES:
USER_FLOW:
NON_GOALS:
PORTS:
PLAN: максимум 25 строк
OWNER_STOP:
STOP_CRITERION:
```

## 4. Один release slice — один наблюдаемый flow

```text
one release slice
→ one canonical branch
→ one owner-facing Draft PR
→ automated gate
→ live browser evidence
→ owner review/stop
→ merge
→ mandatory map transition
→ next release only ready
→ stop
```

После перехода в `in_progress` scope заморожен.

Разрешены только:

- исправления дефектов текущего flow;
- security fixes данных текущего flow;
- необходимые contracts, additive migrations и tests;
- review feedback текущего PR.

Запрещены:

- следующий release/capability;
- дополнительные роли и страницы вне Issue;
- unrelated refactoring;
- новый framework без ADR;
- Docker/Redis/MinIO/CI polish без прямой необходимости;
- новая конкурирующая продуктовая ветка;
- изменение канонических портов;
- destructive migration до owner-approved gate;
- второй competing PR одной поверхности.

Новая идея оформляется новой Issue после merge текущего release.

## 5. R0 branch convergence

До завершения R0:

```text
PR #34       foundation candidate; owner review only
PR #43       normative candidate; contract/evidence/validators only
PR #35/#45/#47 transfer-only; no direct main merge
PR #59/#60  competing R1 candidates; frozen until owner selects one
```

Обязательный порядок находится в `r0_convergence.ordered_actions` target execution plan.

После доказанного переноса transfer-only PR закрывается. Выбранная R1-линия rebased на accepted baseline ровно один раз; вторая закрывается как superseded.

## 6. Обязательный map protocol

Статический target contract находится в target execution plan. Динамическое состояние находится в `project-map.yaml` после activation transition.

### При начале

- current release/task → `in_progress`;
- `current_focus`/`current_gate` остаётся текущим;
- реально затронутые map nodes → `in_progress`;
- человекочитаемая карта отражает текущий release.

### В Draft PR

- current release/task → `in_review`;
- реальные nodes, paths и edges обновлены;
- Quality Map и test catalog совпадают с active contract;
- Nx graph регенерирован при изменении структуры кода;
- следующая задача остаётся `blocked`.

### После merge

Обязателен map-only transition commit или маленький PR:

- merged release/task → `done`;
- next → `ready`, только если dependencies и owner stop закрыты;
- current focus/gate → next;
- карты, Issues и validators синхронизированы;
- агент останавливается.

Следующий release не реализуется в той же сессии.

## 7. Архитектура

- Control Plane — строгий modular monolith.
- `apps/api` и `apps/web` — composition roots/adapters.
- Business logic находится в bounded contexts.
- Domain не импортирует NestJS/Fastify/HTTP, PostgreSQL client/ORM, React/UI, Redis или object-storage SDK.
- Cross-context interaction идёт через public ports/contracts и package root.
- Прямые cross-context imports внутренних файлов и writes в чужие таблицы запрещены.
- Classroom/Project Core не знает типов электроники, шашек, block coding, 3D или robotics.
- Subject modules подключаются только через Module SDK/Registry.
- Redis, S3/MinIO, queues и новые services не вводятся до измеренной/контрактной необходимости.
- После R0 не создаются новые long-lived stacked product branches.

## 8. Identity, Workspace и мультитенантность

- `Account`, `Principal`, `Workspace`, capability и membership — разные сущности после owner activation target contract.
- Personal Workspace создаётся ровно один раз на Account и в первой версии backed by current tenant boundary.
- `tenant_id` остаётся security/storage boundary.
- Каждая tenant-owned таблица содержит `tenant_id NOT NULL`.
- Tenant/Workspace определяется validated session/ActiveContext.
- `tenantId`, role, capability или workspace из body/query/header не являются доверенными.
- Tenant lineage защищается composite constraints.
- Критические таблицы имеют cross-tenant negative tests; RLS используется как defense-in-depth.
- Runtime DB role не superuser, не owner и без `BYPASSRLS`.
- API использует только `APP_DATABASE_URL`; migrations/admin — `DATABASE_URL`; tests — guarded `TEST_DATABASE_URL`.
- Existing teacher/classes/projects/Electronics сохраняются additive migration/backfill.
- `Account session` и `StudentSeat session` различаются.
- Adult passwords и child credentials хранятся как versioned memory-hard hashes.
- Session token генерируется CSPRNG; в БД хранится только hash.
- Детские credentials, tokens и project content не логируются.
- `school_admin` — scoped role, не global capability; `platform_admin` — global capability.

## 9. Проекты и модули

- Personal Project не требует Classroom.
- `Project` принадлежит `Principal`.
- `Project` — изменяемый контейнер.
- `ProjectDraft` использует optimistic version.
- `ProjectVersion` неизменяема и имеет digest.
- Publication/Submission ссылаются на точную `ProjectVersion`.
- Remix создаёт новый Project с lineage и не меняет оригинал.
- Project envelope содержит `moduleKey`, `moduleVersion`, `schemaVersion`.
- Несовместимое schema change требует version bump, JSON Schema, migrator и fixture.
- Core не содержит subject-specific fields или `if moduleKey === ...`.
- Малые payloads хранятся в PostgreSQL `jsonb`; object storage вводится после измеренной необходимости.

## 10. Child safety и Classroom

- StudentSeat не требует email и имеет отдельный principal/session type.
- Safe Mode по умолчанию блокирует public publication/profile/comments/social actions, но разрешает private creation, editing, classroom participation и educational feedback.
- Teacher visibility не означает teacher ownership.
- Просмотр learner work авторизуется и аудируется.
- Assistance/edit mode является явным, bannered, time-limited и audited.
- Restore создаёт copy; immutable version не перезаписывается.
- PublicComment и educational ReviewComment — разные сущности.
- Assignment work не публикуется автоматически.

## 11. Порты

```text
Web  127.0.0.1:4610
API  127.0.0.1:4611
E2E  127.0.0.1:4612
```

Запрещены `3000`, `3100`, `5173`.

Если порт занят:

- не завершать процесс;
- не использовать `taskkill`/`Stop-Process` для неизвестного PID;
- не выбирать другой порт молча;
- вывести точный `BLOCKED` и остановить запуск.

## 12. API, dependencies и UX

- HTTP API обновляет OpenAPI и contract tests.
- Runtime validation соответствует contracts; malformed body → 400.
- Additional properties отклоняются, если schema их запрещает.
- Idempotency key не обрезается; тот же key с другим payload → conflict.
- Administrative mutation создаёт immutable AuditEvent.
- Dependency добавляется только по текущей Issue и закрепляется в lockfile.
- High/critical advisories и запрещённые licenses блокируют merge либо требуют явного owner exception.
- UI по применимости имеет loading, empty, validation, network/server error, success, conflict, retry, keyboard navigation, focus management, reduced motion и responsive layout.
- Manual browser smoke не заменяет automated E2E.
- Tests доказывают technical state; owner screenshots/live flow подтверждают product/visual acceptance отдельно.

## 13. Тесты

До активации target plan обязательны:

```text
python tools/validate_tinkercad_parity.py
python tools/validate_target_execution.py
python tools/validate_architecture.py
python tools/validate_project_map.py
python tools/validate_test_catalog.py
```

После activation test IDs фиксируются в текущей Issue и test catalog до начала кода.

- PASS — фактический exit 0;
- FAIL — фактический non-zero;
- BLOCKED — обязательная среда отсутствует;
- NOT_RUN — команда не запускалась.

`BLOCKED` и `NOT_RUN` не закрывают exit gate. Удалять test ID ради зелёного отчёта запрещено.

## 14. Definition of Done

Release готов, когда:

1. полный user flow Issue реализован;
2. non-goals отсутствуют в diff;
3. contracts/additive migrations/security согласованы;
4. все обязательные test IDs фактически PASS;
5. automated E2E и screenshots существуют;
6. canonical ports и clean-session startup подтверждены;
7. dependency/security gate PASS;
8. карты и Nx graph обновлены;
9. owner выполнил отдельную визуальную/продуктовую приёмку;
10. PR merged;
11. обязательный post-merge map transition выполнен;
12. next release только разблокирован, но не начат.

## 15. Формат отчёта

```text
MILESTONE:
RELEASE:
TASK:
ISSUE:
STATUS:
VISIBLE_RESULT:
CAPABILITIES:
USER_FLOW:
  ... PASS|FAIL|BLOCKED
PORTS:
BRANCH:
COMMITS:
FILES_CHANGED:
MAP_NODES_CHANGED:
TESTS_RUN:
ARTIFACTS:
DEMO_URLS:
SCREENSHOTS:
BLOCKERS:
RESIDUAL_RISKS:
WORKING_TREE:
OWNER_STOP:
NEXT_ALLOWED_TASK:
NEXT_COMMAND:
```

Отчёт начинается с видимого пользовательского результата, а не с установленных инструментов.
