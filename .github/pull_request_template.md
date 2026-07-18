## Цель

<!-- Какое проверяемое пользовательское или архитектурное изменение вносится? -->

## Task / Requirement IDs

<!-- Укажите GitHub Issue, TASK-ID из project-map.yaml и requirement IDs. -->

## Применимые ADR

<!-- ADR-XXXX либо обоснование, почему ADR не требуется. -->

## Затронутые bounded contexts

<!-- Укажите владельцев доменных данных и публичные границы. -->

## Карта проекта

- [ ] `docs/project-map/project-map.yaml` обновлён или изменение карты обоснованно неприменимо.
- [ ] `docs/project-map/PROJECT_MAP.md` соответствует машиночитаемой карте.
- [ ] Статус TASK изменён корректно.
- [ ] Новые узлы и связи имеют стабильные IDs.
- [ ] Фактический Nx graph проверен, если изменялись зависимости кода.

<!-- Перечислите изменённые узлы, связи и ожидаемый current_focus. -->

## Что изменено

<!-- Кратко перечислите полный вертикальный срез. -->

## Контракты

- [ ] OpenAPI обновлён или неприменим.
- [ ] JSON Schema обновлена или неприменима.
- [ ] Event schema обновлена или неприменима.
- [ ] Compatibility/migration path добавлен или неприменим.

## Данные и миграции

<!-- Таблицы, индексы, tenant lineage, backfill, expand/migrate/contract, rollback/forward-fix. -->

## Tenant, авторизация и аудит

- [ ] Tenant context определяется только сервером.
- [ ] Добавлены положительные и отрицательные authorization tests.
- [ ] Cross-tenant read/write tests проходят.
- [ ] Административные мутации создают AuditEvent.
- [ ] В telemetry не попадают детский контент и секреты.

## Compute и идемпотентность

<!-- Job contract, timeout, resource profile, retries, duplicate delivery, sandbox. Неприменимо для обычного Control Plane use case. -->

## Фактические проверки

```text
Укажите команды и реальные результаты. Не отмечайте проверки, которые не запускались.
```

- [ ] format/lint
- [ ] typecheck
- [ ] architecture boundaries
- [ ] project map validation
- [ ] unit tests
- [ ] contract tests
- [ ] integration/E2E
- [ ] migration tests
- [ ] security checks
- [ ] build

## Rollout

<!-- Feature flag, release ring, canary tenant/classroom, monitoring. -->

## Rollback или forward-fix

<!-- Как безопасно отменяется код и что происходит с уже записанными данными? -->

## Интерфейс

<!-- Скриншоты и состояния loading/empty/error/success/conflict для UI-изменений. -->

## Известные ограничения

<!-- Только реальные ограничения. Critical placeholders и fake success не допускаются. -->

## Финальная проверка

- [ ] Прочитаны `AGENTS.md`, `START_HERE_FOR_AI.md` и `docs/project-map/TASK_SYSTEM.md`.
- [ ] Выполнялась только одна готовая задача из project map.
- [ ] Изменение не нарушает Module SDK и владение контекстами.
- [ ] Старые ProjectVersion/Submission остаются открываемыми.
- [ ] Недоверенный код не выполняется в Core API.
- [ ] Новая зависимость проверена по лицензии и необходимости.
- [ ] В merged-коде нет критических TODO, placeholders или отключённых тестов.
