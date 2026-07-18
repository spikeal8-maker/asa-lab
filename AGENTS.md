# AGENTS.md — обязательные правила ASA Lab

Этот файл обязателен для Codex, других coding-агентов и разработчиков. Нарушение правила с severity `error` блокирует merge.

## 1. Источники истины

1. Более поздняя принятая ADR.
2. `docs/architecture/ARCHITECTURE_BASELINE.md`.
3. Исполняемые контракты: OpenAPI, JSON Schema, event schema и миграции БД.
4. Принятая функциональная спецификация и реестр требований.
5. Критерии приёмки конкретной задачи.

Конфликт не разрешается молча. Создаётся ADR и миграционный план.

## 2. Перед изменением кода

Агент обязан:

1. прочитать архитектурный baseline;
2. определить bounded context;
3. прочитать релевантные ADR;
4. перечислить requirement IDs;
5. определить tenant boundary;
6. определить authorization policies;
7. определить audit events;
8. определить API/schema/migration impact;
9. ограничить список разрешённых файлов;
10. задать команды приёмки.

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

## 13. Definition of Done

Функция готова, когда:

1. реализован полный вертикальный use case;
2. обновлены contracts;
3. миграция безопасна;
4. tenant/authz negative tests проходят;
5. audit и telemetry добавлены;
6. retry/duplicate/timeout обработаны;
7. UI имеет loading/empty/error/success/conflict states;
8. accessibility проверена;
9. unit/integration/E2E проходят;
10. старые данные совместимы;
11. rollout и rollback описаны;
12. placeholders отсутствуют.

## 14. Формат PR

PR обязан указать:

- цель и requirement IDs;
- применимые ADR;
- затронутые bounded contexts;
- изменения данных, API и событий;
- tenant/authz/audit impact;
- тесты и фактические результаты;
- rollout/rollback;
- известные ограничения.
