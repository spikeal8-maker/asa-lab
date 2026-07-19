# AGENTS.md — обязательные правила ASA Lab

Этот файл обязателен для Codex, других coding-агентов и разработчиков. Нарушение правила с severity `error` блокирует merge.

## 1. Источники истины

Порядок приоритета:

1. более поздняя принятая ADR;
2. `docs/product/PRODUCT_BLUEPRINT.md` — конечный продукт и пользовательские инварианты;
3. `docs/product/CAPABILITY_MAP.yaml` — capability IDs и зависимости;
4. `docs/delivery/DEVELOPMENT_PROGRAM_V1.md` — практическая последовательность Product Alpha и School Pilot;
5. `docs/delivery/LOCAL_PORT_POLICY.md` — локальные порты и правила безопасного запуска;
6. `docs/architecture/ARCHITECTURE_BASELINE.md` и профильные архитектурные документы;
7. исполняемые contracts: OpenAPI, JSON Schema, migrations и event schemas;
8. `docs/project-map/project-map.yaml` — current focus, tasks, dependencies и statuses;
9. GitHub Issue текущей задачи;
10. `docs/testing/test-catalog.yaml` — test IDs и команды;
11. критерии приёмки текущей Issue.

Сообщение в чате может уточнить выполнение, но не меняет task ID, capability, dependency, scope, ports, test IDs или exit gate.

Конфликт не разрешается молча. Агент останавливается, указывает два конфликтующих источника и ожидает исправления нормативного документа, Issue или ADR.

## 2. Перед изменением кода

Агент обязан:

1. выполнить git orientation;
2. прочитать `project.current_focus`;
3. найти task node и связанную GitHub Issue;
4. проверить task status и все `depends_on`;
5. определить существующую ветку/PR задачи;
6. прочитать раздел текущего этапа в `DEVELOPMENT_PROGRAM_V1.md`;
7. прочитать перечисленные в Issue capability entries;
8. прочитать только явно указанные Issue разделы профильных спецификаций;
9. определить один наблюдаемый user flow;
10. перечислить non-goals;
11. определить bounded contexts;
12. определить tenant boundary и authorization policies;
13. определить AuditEvents;
14. определить API/schema/migration impact;
15. определить UX states;
16. перечислить обязательные test IDs;
17. указать канонические порты;
18. ограничить список изменяемых файлов;
19. вывести PLAN максимум на 25 строк;
20. назвать stop criterion.

Агент не обязан каждый раз перечитывать всю продуктовую документацию. Issue должна указывать точные разделы и capability IDs.

## 3. Одна задача — один пользовательский flow

Одна executable Issue реализует один наблюдаемый вертикальный сценарий.

```text
one task
→ one branch
→ one Draft PR
→ one exit gate
→ merge
→ next task
```

Запрещено в одном task:

- начинать следующую capability;
- добавлять будущие роли и страницы;
- выполнять unrelated refactoring;
- проектировать deployment, который не нужен текущему flow;
- смешивать product feature и инфраструктурную программу;
- открывать второй competing PR.

Следующая задача не начинается в той же сессии после merge текущей.

## 4. Scope freeze

После перехода задачи в `in_progress` scope заморожен.

Разрешены только:

- исправления дефектов текущего user flow;
- security fixes данных, которые уже обрабатывает задача;
- необходимые contracts/migrations/tests;
- review feedback текущего PR.

Новая идея сначала оформляется новой GitHub Issue и добавляется в карту после merge текущего task.

## 5. Канонические порты

По умолчанию:

```text
Web  127.0.0.1:4610
API  127.0.0.1:4611
E2E  127.0.0.1:4612
```

Запрещены first-party runtime defaults:

```text
3000
3100
5173
```

Если порт занят:

- не завершать процесс по номеру порта;
- не использовать `taskkill`/`Stop-Process` для неизвестного PID;
- не выбирать другой порт молча;
- вывести точный `BLOCKED`;
- остановить текущий запуск.

Все dev/test servers слушают только `127.0.0.1`, пока отдельная deployment Issue не утверждает другое.

## 6. Архитектура

- Control Plane — строгий modular monolith.
- Compute Plane — отдельные worker-процессы только для тяжёлых/недоверенных вычислений.
- `apps/api` и `apps/web` — composition roots/adapters.
- Business logic находится в bounded contexts.
- Classroom Core не знает types электроники, шашек, block coding, 3D или robotics.
- Subject modules подключаются только через Module SDK/public contracts.
- Прямые cross-context imports внутренних файлов запрещены.
- Прямые cross-context writes в чужие таблицы запрещены.
- Новый микросервис требует ADR и измеримого основания.
- Redis, S3/MinIO и queues не вводятся до задачи, которая реально использует их.

## 7. Структура bounded context

```text
<context>/
  domain/
  application/
  infrastructure/
  presentation/
  testing/
  index.ts
```

`domain` не импортирует:

- NestJS/Fastify/HTTP;
- PostgreSQL client/ORM;
- React/UI;
- Redis;
- object storage SDK;
- subject module internals другого context.

Cross-context interaction идёт через public ports/contracts и package root.

## 8. Мультитенантность

- Каждая tenant-owned таблица содержит `tenant_id NOT NULL`.
- Tenant определяется только validated session/request context.
- `tenantId`/`tenant_id` из body/query/header не является доверенным.
- Каждый repository method содержит tenant predicate.
- Tenant lineage защищается composite `(tenant_id, parent_id)` constraints.
- RLS применяется как defense-in-depth на критических таблицах.
- Runtime DB role не superuser, не owner и без `BYPASSRLS`.
- API использует только `APP_DATABASE_URL`.
- `DATABASE_URL` доступен только migrations/seed/admin tools.
- Automated tests используют отдельный `TEST_DATABASE_URL` и guard от dev/production DB.
- Каждая функция с tenant-owned data имеет cross-tenant negative test.

RLS не объявляется защитой от полного компрометирования runtime DB credentials, если роль сама может устанавливать tenant GUC. Threat model должен быть сформулирован честно.

## 9. Идентичность и дети

- StudentSeat не требует email.
- Открытые student credentials показываются только при выпуске/reset.
- Открытые credentials не сохраняются и не логируются.
- Child credentials хранятся как versioned Argon2id hash.
- Adult passwords хранятся как versioned memory-hard hash.
- Session token генерируется CSPRNG; в БД хранится только hash.
- Reset credential отзывает старые sessions.
- Реальное ФИО не показывается другим детям.
- Детские проекты закрыты по умолчанию.
- Прямые личные сообщения между детьми отсутствуют в v1.
- Credential guessing имеет rate limit/backoff/lockout.

## 10. Проекты и Module SDK

- `Project` — изменяемый контейнер.
- `ProjectDraft` сохраняется идемпотентно и защищён optimistic version.
- `ProjectVersion` неизменяема и имеет digest.
- `SubmissionAttempt` ссылается на точную `ProjectVersion`.
- Project envelope содержит `moduleKey`, `moduleVersion`, `schemaVersion`.
- Несовместимое schema change требует version bump, JSON Schema, migrator и fixture.
- Старые проекты должны открываться после релиза.
- Classroom/Project Core не содержит subject-specific fields или `if moduleKey === ...`.
- Первый Project Shell хранит небольшие payloads в PostgreSQL `jsonb`; object storage вводится после измеренной необходимости.
- Полный snapshot не отправляется на каждое действие; дальнейший operation journal вводится отдельной задачей.

## 11. Электроника

Electronics Alpha ограничена Issue №26:

```text
DC source
resistor
LED
wire
CircuitDocument v1
connectivity resolver
normalized netlist
simple series DC solver
structured diagnostics
save/reload
```

Без отдельной Issue запрещены:

- breadboard realism;
- transient simulation;
- Arduino;
- PWM/ADC/UART;
- oscilloscopes/instruments;
- large component catalog;
- SPICE compatibility;
- advanced hidden autograding.

Unsupported topology возвращает явный diagnostic, а не fake numerical success.

## 12. Недоверенный код и workers

- Пользовательский код не выполняется в Core API/realtime процессе.
- Worker job имеет idempotency key, timeout, resource profile и input digest.
- Worker без внешней сети по умолчанию.
- Worker не получает общие production credentials.
- Filesystem read-only, workspace временный.
- CPU/RAM/PIDs/time/output ограничены.
- Duplicate event/job delivery безопасна.

Эти правила не являются основанием преждевременно создавать worker infrastructure до соответствующей Issue.

## 13. API, БД и события

- Изменение HTTP API обновляет OpenAPI и contract tests.
- Изменение module/project payload обновляет JSON Schema и fixtures.
- Runtime request validation должна соответствовать contracts.
- Additional properties отклоняются, если schema запрещает их.
- Malformed body возвращает 400, не 500.
- Критическое событие записывается в outbox в той же транзакции, когда outbox уже входит в текущую задачу.
- Administrative mutation создаёт immutable AuditEvent.
- Status transition проверяется application use case.
- Idempotency key валидируется; silent truncation запрещён.
- Повтор того же key с другим payload возвращает conflict.
- Миграция имеет forward-fix/rollback guidance.

## 14. Технологический baseline

- Monorepo: pnpm workspaces + Nx.
- TypeScript strict, без `any` для обхода contracts.
- Web: React + Vite/PWA.
- API: NestJS с Fastify adapter; domain framework-independent.
- Database: PostgreSQL 16+ и явные SQL migrations.
- Contracts: OpenAPI 3.1.x и JSON Schema 2020-12.
- Observability: OpenTelemetry, disabled network export by default.
- Electronics compute core: Rust stable, native tests и WASM browser build.
- Browser E2E: Playwright.

Замена требует ADR.

## 15. Dependencies и supply chain

- Dependency добавляется только при прямой необходимости текущей Issue.
- Версия закрепляется в project/lockfile.
- Известные high/critical advisories блокируют merge либо требуют документированного исключения владельца.
- License gate обязателен.
- Dependency inventory, который только считает пакеты, не считается security gate.
- Downloaded executable нельзя запускать без закреплённой версии и verification, если такая загрузка входит в отдельную утверждённую задачу.

## 16. Запреты

- Нельзя создавать placeholder или fake success.
- Нельзя оставлять критический TODO в merged code.
- Нельзя disable/skip test ради зелёного результата.
- Нельзя записывать PASS, если команда не запускалась.
- Нельзя удалять `required_for` после начала задачи для сокращения gate.
- Нельзя объявлять manual smoke автоматизированным E2E.
- Нельзя логировать password, session token, child credential, signed URL или детский project content.
- Нельзя менять архитектуру или scope только потому, что агенту так удобнее.
- Нельзя выполнять `planned`, `blocked`, `done` или `deprecated` задачу.
- Нельзя возвращаться к Docker/Redis/MinIO/CI polish без current Issue.
- Нельзя использовать запрещённые порты.
- Нельзя завершать чужие процессы.

## 17. Обязательные UX states

Для UI flow по применимости:

- loading;
- empty;
- validation error;
- server/network error;
- success;
- conflict;
- retry;
- keyboard navigation;
- visible focus;
- modal focus management;
- reduced motion;
- responsive desktop/mobile layout.

Automated accessibility critical path обязателен для UI-задач.

## 18. Тесты

Стабильные test IDs и команды хранятся только в `docs/testing/test-catalog.yaml`.

Единая команда:

```bash
python tools/run_task_tests.py --task <TASK-ID>
```

Статусы:

- PASS — команда выполнена и exit code 0;
- FAIL — команда выполнена и упала;
- BLOCKED — обязательная среда отсутствует;
- NOT_RUN — команда не запускалась.

BLOCKED/NOT_RUN не закрывают exit gate.

Каждый product task по применимости имеет:

- map/capability/program validation;
- format/lint/type/build/boundaries;
- contracts;
- unit/integration;
- migration;
- tenant/authz/RLS;
- secret/dependency/license;
- port/startup safety;
- accessibility;
- automated browser E2E;
- simulation golden/parity для Electronics.

## 19. Definition of Done

Task готова, когда:

1. реализован полный user flow Issue;
2. non-goals отсутствуют в diff;
3. capabilities реализованы только в заявленной границе;
4. contracts и migrations согласованы;
5. tenant/authz/audit requirements выполнены;
6. idempotency/retry/conflict обработаны;
7. UX states и accessibility подтверждены;
8. все required test IDs фактически PASS;
9. automated E2E и screenshots существуют;
10. canonical ports подтверждены;
11. clean-session startup подтверждён;
12. dependency/security gate PASS;
13. старые данные/fixtures совместимы;
14. Project/Quality/Nx maps обновлены;
15. PR merged;
16. task → done и Issue → completed;
17. next task только разблокирована, но не начата.

## 20. Формат PR

PR обязан указать:

- Milestone, TASK-ID, Issue и capability IDs;
- user flow с PASS/FAIL/BLOCKED;
- non-goals;
- affected contexts;
- API/data/events;
- tenant/authz/audit impact;
- ports;
- map/Nx impact;
- test IDs и фактические результаты;
- demo URLs;
- screenshots/artifacts;
- rollout/rollback;
- known limitations;
- `NEXT_ALLOWED_TASK`.

Один task — один PR.

## 21. Карты и программа

- Product definition: `docs/product/PRODUCT_BLUEPRINT.md`.
- Capability graph: `docs/product/CAPABILITY_MAP.yaml`.
- Practical execution: `docs/delivery/DEVELOPMENT_PROGRAM_V1.md`.
- Ports: `docs/delivery/LOCAL_PORT_POLICY.md`.
- Task graph/current focus: `docs/project-map/project-map.yaml`.
- Quality graph: `docs/project-map/QUALITY_MAP.md`.
- Test registry: `docs/testing/test-catalog.yaml`.
- Actual code graph: `docs/project-map/nx-project-graph.json`.

Изменение user flow, task dependency, port, test gate или capability выполняется в нормативном PR до product code.

## 22. Отчёт агента

Промежуточный milestone:

```text
MILESTONE:
STATUS:
VISIBLE_RESULT:
TESTS:
DEMO_URLS:
SCREENSHOTS:
BLOCKERS:
NEXT_INTERNAL_MILESTONE:
```

Финальный отчёт:

```text
MILESTONE:
TASK:
ISSUE:
STATUS:
CAPABILITIES:
USER_FLOW:
PORTS:
BRANCH:
COMMITS:
FILES_CHANGED:
MAP_NODES_CHANGED:
TESTS_RUN:
ARTIFACTS:
DEMO_URLS:
BLOCKERS:
RESIDUAL_RISKS:
WORKING_TREE:
NEXT_ALLOWED_TASK:
NEXT_COMMAND:
```

Отчёт начинается с пользовательского результата, не с перечня установленных инструментов.

## 23. Каноническая очередь v1

```text
TASK-PRODUCT-DOC-001
→ TASK-PORTAL-001
→ TASK-PROJECT-SHELL-001
→ TASK-CHECKERS-LITE-001
→ TASK-ELECTRONICS-ALPHA-001
→ TASK-SEAT-001
→ TASK-ACT-001
→ TASK-REVIEW-001
→ TASK-ELEC-001
```

Очередь не меняется устной командой.