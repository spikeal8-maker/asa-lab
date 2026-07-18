## Цель

<!-- Какое проверяемое пользовательское или архитектурное изменение вносится? -->

## Requirement IDs

<!-- Перечислите идентификаторы требований. -->

## Применимые ADR

<!-- ADR-XXXX либо обоснование, почему ADR не требуется. -->

## Затронутые bounded contexts

<!-- Укажите владельцев доменных данных и публичные границы. -->

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

- [ ] Прочитан `AGENTS.md`.
- [ ] Изменение не нарушает Module SDK и владение контекстами.
- [ ] Старые ProjectVersion/Submission остаются открываемыми.
- [ ] Недоверенный код не выполняется в Core API.
- [ ] Новая зависимость проверена по лицензии и необходимости.
- [ ] В merged-коде нет критических TODO, placeholders или отключённых тестов.
