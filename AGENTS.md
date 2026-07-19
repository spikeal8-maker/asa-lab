# AGENTS.md — обязательные правила ASA Lab

Этот файл обязателен для Codex, других coding-агентов и разработчиков. Нарушение правила с severity `error` блокирует merge.

## 1. Источники истины

1. Более поздняя принятая ADR.
2. `docs/product/PRODUCT_BLUEPRINT.md` для определения продукта, пользователей и конечных образовательных сценариев.
3. `docs/product/CAPABILITY_MAP.yaml` для capability IDs, зависимостей и релизных границ.
4. `docs/architecture/ARCHITECTURE_BASELINE.md`.
5. Исполняемые контракты: OpenAPI, JSON Schema, event schema и миграции БД.
6. Принятая функциональная спецификация и реестр требований.
7. `docs/project-map/project-map.yaml` для структуры, зависимостей, фаз и статусов задач.
8. GitHub Issue конкретной задачи, которая обязана ссылаться на capability IDs.
9. `docs/testing/test-catalog.yaml` для test IDs и команд.
10. Критерии приёмки конкретной задачи.

Конфликт не разрешается молча. Агент останавливается и требует обновить нормативный документ, Issue или ADR. Сообщение в чате не может незаметно изменить смысл продукта или capability.

## 2. Перед изменением кода

Агент обязан:

1. прочитать `docs/product/PRODUCT_BLUEPRINT.md`;
2. найти связанные capability IDs в `docs/product/CAPABILITY_MAP.yaml`;
3. прочитать архитектурный baseline;
4. прочитать `docs/delivery/BOT_RUNBOOK.md`;
5. прочитать `docs/project-map/TASK_SYSTEM.md` и project map;
6. прочитать `docs/testing/TEST_STRATEGY.md` и test catalog;
7. определить GitHub Issue и TASK-ID;
8. проверить, что TASK имеет статус `ready`, а зависимости завершены;
9. проверить зависимости выбранных capabilities;
10. определить наблюдаемый пользовательский flow и non-goals;
11. определить bounded context;
12. прочитать релевантные ADR;
13. перечислить requirement IDs и capability IDs;
14. определить tenant boundary;
15. определить authorization policies;
16. определить audit events;
17. определить API/schema/migration impact;
18. ограничить список разрешённых файлов;
19. перечислить обязательные test IDs и команды;
20. указать ожидаемые изменения project map, capability map и Nx graph.

## 3. Архитектура

- Control Plane — строгий модульный монолит.
- Compute Plane — отдельные worker-процессы.
- Classroom Core не знает типов электроники, шахмат, 3D или робототехники.
- Предметные модули работают только через Module SDK.
- Прямые cross-context imports внутренних файлов запрещены.
- Прямые cross-context writes в таблицы запрещены.
- Смена транспорта сообщений или storage не должна менять доменный код.
- Новый микросервис требует ADR и измеримого основания.

## 4. Обязательная структура bounded context

```text
<context>/
  domain/
  application/
  infrastructure/
  presentation/
  testing/
  index.ts
```

`domain` не импортирует NestJS, ORM, HTTP, Redis, UI или object storage SDK.

## 5. Мультитенантность

- Каждая tenant-owned таблица содержит `tenant_id NOT NULL`.
- Tenant определяется validated request/session context.
- Произвольный `tenantId` из body не считается доверенным.
- Все запросы имеют tenant predicate.
- Связи tenant-owned агрегатов используют composite `(tenant_id, parent_id)` FK или эквивалентное database constraint.
- RLS применяется как defense-in-depth на критических таблицах.
- Каждая функция имеет cross-tenant negative test.
- Runtime DB role не имеет `BYPASSRLS`.

## 6. Идентичность и дети

- StudentSeat не требует email.
- Открытые student codes не сохраняются и не логируются.
- Коды хранятся как Argon2id hash.
- Сброс кода отзывает старые сессии.
- Реальное ФИО не показывается другим ученикам.
- Детский проект закрыт по умолчанию.
- Личные сообщения между детьми отсутствуют в P0.

## 7. Проекты и данные

- `ProjectVersion` неизменяема.
- `Submission` ссылается на точную `ProjectVersion`.
- Проект содержит `moduleKey`, `moduleVersion`, `schemaVersion`, digest.
- Несовместимое изменение требует version bump и migrator.
- Старые проекты должны открываться после релиза.
- Object storage key не является правом доступа.
- Полный snapshot не отправляется на каждое действие редактора.
- Автосохранение использует IndexedDB, operation batches, idempotency и checkpoints.

## 8. Недоверенный код и workers

- Пользовательский код не выполняется в API/realtime процессе.
- Job имеет idempotency key, timeout, resource profile и input digest.
- Worker работает без внешней сети по умолчанию.
- Worker не получает общие production credentials.
- Файловая система read-only, workspace временный.
- Ресурсы CPU, RAM, PIDs, wall-clock и output ограничены.
- Duplicate event/job delivery безопасна.

## 9. Billing

- Запрещены поля `isPaid`, `hasPro`, `canUse3d` в user/classroom/school.
- Возможности проверяются через `EntitlementService`.
- Квоты учитываются через `QuotaService` и append-only usage ledger.
- Истечение entitlement не удаляет учебные данные.
- Provider webhook идемпотентен.

## 10. API, БД и события

- Изменение HTTP API требует обновить OpenAPI и contract tests.
- Изменение project/module payload требует JSON Schema и примеров.
- Изменение event требует versioned schema.
- Критическое событие записывается в outbox в той же транзакции.
- Consumer идемпотентен.
- Миграция БД имеет expand/migrate/contract или документированный forward-fix.
- Административная мутация создаёт immutable AuditEvent.
- Status transition проверяется доменным use case, не только UI.

## 11. Технологический baseline

- Monorepo: `pnpm` workspaces + Nx.
- TypeScript strict, `noImplicitAny`, без обхода типизации.
- Web: React + Vite/PWA.
- API: NestJS с Fastify adapter; domain framework-independent.
- Database: PostgreSQL 16+ и явные SQL migrations; typed repositories.
- Cache/ephemeral: Redis.
- Blob: S3-compatible object storage.
- Compute core: Rust stable, WASM browser build, native worker build.
- Contracts: OpenAPI 3.1.x и JSON Schema 2020-12.
- Observability: OpenTelemetry.
- Tests: unit, contract, integration, authz matrix, E2E, load, golden simulation.

Замена требует ADR.

## 12. Запреты

- Нельзя создавать placeholder или fake success вместо готовой реализации.
- Нельзя оставлять критический `TODO` в merged code.
- Нельзя использовать `any` для обхода контракта.
- Нельзя отключать/skip тест ради зелёного CI.
- Нельзя смешивать несвязанный refactoring и feature.
- Нельзя добавлять dependency без проверки лицензии и необходимости.
- Нельзя логировать child content, token, password, student code или signed URL.
- Нельзя копировать production data в lower environment без обезличивания.
- Нельзя менять архитектуру только потому, что агенту так удобнее.
- Нельзя менять продуктовый scope только потому, что так сказано в последнем сообщении чата.
- Нельзя выполнять задачу со статусом `planned` или `blocked`.
- Нельзя держать более одной задачи `in_progress` до завершения Bootstrap.
- Нельзя записывать `PASS`, если соответствующая команда не запускалась.
- Нельзя заменять обязательный test ID общим утверждением «всё проверено».
- Нельзя реализовывать capability, отсутствующую в Issue и `CAPABILITY_MAP.yaml`.

## 13. Definition of Done

Функция готова, когда:

1. реализован полный вертикальный use case;
2. пользовательский flow из Issue подтверждён;
3. связанные capability IDs реализованы в заявленной границе;
4. обновлены contracts;
5. миграция безопасна;
6. tenant/authz negative tests проходят;
7. audit и telemetry добавлены;
8. retry/duplicate/timeout обработаны;
9. UI имеет loading/empty/error/success/conflict states;
10. accessibility проверена;
11. обязательные test IDs из test catalog фактически выполнены;
12. unit/integration/E2E проходят;
13. старые данные совместимы;
14. rollout и rollback описаны;
15. project map, capability map, quality map и фактический Nx graph не противоречат изменению;
16. TASK переведён в `done` только после merge и exit gate;
17. placeholders отсутствуют.

## 14. Формат PR

PR обязан указать:

- GitHub Issue, TASK-ID, requirement IDs и capability IDs;
- пользовательский flow;
- non-goals;
- применимые ADR;
- затронутые bounded contexts;
- изменения данных, API и событий;
- tenant/authz/audit impact;
- изменённые узлы и связи project map/capability map;
- фактический Nx graph impact;
- обязательные test IDs;
- фактические результаты каждого test ID;
- rollout/rollback;
- известные ограничения;
- стандартный отчёт BOT_RUNBOOK и следующую допустимую задачу.

## 15. Карта проекта

- Единственный машиночитаемый источник основной карты: `docs/project-map/project-map.yaml`.
- Интерактивное и Mermaid-представления не должны противоречить источнику.
- Архитектурное изменение и изменение карты выполняются в одном PR.
- У каждого нового приложения, bounded context, worker, data store, предметного модуля, фазы и задачи должен быть стабильный node ID.
- Удалённый узел сначала получает статус `deprecated`; история не переписывается молча.
- Зависимости задач должны образовывать ациклический граф.
- Coding-агент выбирает задачу только из `execution_queue` и только со статусом `ready`.
- Начало работы переводит задачу в `in_progress`; открытие PR — в `in_review`; merge с подтверждённым exit gate — в `done`.
- Если PR меняет `apps/`, `packages/`, `contexts/`, `modules/`, `crates/`, `infra/`, `schemas` или нормативные документы, карта обязана быть проверена и при необходимости обновлена.
- CI должен блокировать неизвестные узлы, битые связи, циклы задач, неверные статусы и архитектурные изменения без пересмотра карты.

## 16. Каталог тестов и управление агентом

- Рабочий алгоритм агента определяется `docs/delivery/BOT_RUNBOOK.md`.
- Стратегия тестирования определяется `docs/testing/TEST_STRATEGY.md`.
- Стабильные test IDs и команды хранятся только в `docs/testing/test-catalog.yaml`.
- Карта качества находится в `docs/project-map/QUALITY_MAP.md`.
- Новая задача должна иметь хотя бы один зарегистрированный обязательный test ID.
- Изменение критерия готовности задачи требует обновить Issue, test catalog и quality map в одном PR.
- Агент обязан заканчивать сессию стандартным отчётом, включая `NEXT_ALLOWED_TASK` и точную `NEXT_COMMAND`.

## 17. Продуктовая карта и capability IDs

- Нормативное определение платформы находится в `docs/product/PRODUCT_BLUEPRINT.md`.
- Машиночитаемая карта возможностей находится в `docs/product/CAPABILITY_MAP.yaml`.
- Человекочитаемое представление находится в `docs/product/CAPABILITY_MAP.md`.
- Детальная спецификация Classroom Core находится в `docs/product/CLASSROOM_CORE_SPEC.md`.
- Контракт предметных модулей находится в `docs/product/MODULE_PLATFORM_SPEC.md`.
- Проверка, комментарии, оценки и награды определяются `docs/product/ASSESSMENT_REWARDS_SPEC.md`.
- Каждая продуктовая Issue обязана перечислять capability IDs.
- Новый capability сначала добавляется в продуктовую карту, затем в Issue и только затем реализуется.
- Если задача затрагивает несколько релизных slices, она должна быть разделена или явно одобрена владельцем в Issue.
- Чат может уточнять выполнение, но не является источником истины для изменения capability, зависимости или релизной границы.
