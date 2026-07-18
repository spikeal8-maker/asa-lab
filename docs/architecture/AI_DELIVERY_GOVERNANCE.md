# Управление разработкой ASA Lab через AI-агентов

## 1. Цель

Coding-агент является быстрым исполнителем внутри принятой архитектуры, а не автономным архитектором, меняющим правила по ходу работы.

## 2. Нормативный контекст каждой задачи

Задача агенту обязана содержать:

```text
Goal
Requirement IDs
Bounded context
Allowed paths
Forbidden paths
Relevant ADRs
API/schema changes
Authorization matrix
Audit events
Acceptance tests
Commands to run
Definition of Done
```

Без этих полей агент сначала формализует задачу и не начинает массовое изменение кода.

## 3. Максимальный размер задачи

Один Pull Request — один вертикальный use case либо один архитектурный foundation change.

Недопустимая задача:

```text
Реализуй всю платформу, все классы и электронную лабораторию.
```

Допустимая задача:

```text
Учитель создаёт classroom, получает его в списке, действие проверяется policy,
пишется AuditEvent, OpenAPI обновлён, migration и E2E добавлены.
```

## 4. Обязательный цикл агента

1. Прочитать `AGENTS.md`.
2. Прочитать релевантные ADR и архитектурный раздел.
3. Проверить текущий dependency graph.
4. Назвать affected bounded contexts.
5. Обновить contracts сначала, если меняется внешний интерфейс.
6. Написать или обновить тесты.
7. Реализовать минимальный вертикальный срез.
8. Выполнить все проверки.
9. Провести self-review по tenant, security, audit, retry и migration.
10. Сформировать PR с requirement traceability.

## 5. Запреты

Агент не может:

- создавать новый framework без ADR;
- менять stack по личному предпочтению;
- импортировать internal другого context;
- записывать в таблицы другого context;
- отключать или skip-ать тесты;
- снижать TypeScript strictness;
- использовать `any` для обхода контракта;
- оставлять placeholder/TODO в критическом пути;
- создавать fake success response;
- хранить секреты в репозитории;
- менять immutable data;
- выполнять недоверенный код в API;
- добавлять глобальный paid boolean;
- менять API без OpenAPI;
- менять payload без schema и migrator;
- смешивать несвязанный рефакторинг и feature;
- форматировать нерелевантные файлы;
- вносить архитектурное решение скрыто внутри обычного feature PR.

## 6. CI pipeline после bootstrap

```text
format-check
lint
typecheck
nx-boundaries
unit
contract
integration
database-migration-test
authorization-matrix
e2e-critical
security-scan
secret-scan
license-scan
sbom
build
```

Для Rust:

```text
cargo fmt --check
cargo clippy -- -D warnings
cargo test
wasm tests
golden simulation tests
```

## 7. Architecture drift detector

CI обязан проверять:

- import boundaries по Nx tags;
- отсутствие запрещённых dependencies;
- наличие owner/tag для context packages;
- `tenant_id` в tenant-owned tables;
- migration naming и migration tests;
- OpenAPI diff;
- event-schema diff;
- Module Manifest и project JSON Schema;
- ADR при изменении architecture paths;
- requirement IDs в PR body;
- отсутствие незафиксированных generated artifacts.

## 8. Review checklist

Каждый review отвечает:

1. Не нарушена ли доменная граница?
2. Где tenant boundary?
3. Кто может вызвать use case?
4. Что пишется в AuditEvent?
5. Что произойдёт при retry?
6. Что произойдёт при duplicate event?
7. Что произойдёт при worker timeout?
8. Как открывается старая версия проекта?
9. Есть ли migration rollback или forward-fix?
10. Не попали ли детские данные в telemetry?
11. Как функция деградирует при отказе необязательной зависимости?
12. Соответствует ли изменение entitlement и quota модели?

## 9. Commit policy

Используются Conventional Commits с областью:

```text
feat(classroom): create classroom with owner membership
feat(projects): persist immutable project checkpoint
feat(electronics): add resistor component model
fix(authz): block cross-class project access
arch(platform): define tenant placement interface
test(simulation): add RC transient golden circuit
docs(adr): accept browser-first simulation core
chore(ci): enforce module boundaries
```

Коммит логически целостен и проходит проверки. Сообщения `fix`, `update`, `changes`, `try again`, `wip` запрещены в основной истории.

## 10. PR policy

PR body содержит:

- цель и requirement IDs;
- ADR;
- affected contexts;
- data migration;
- API/event changes;
- tenant/authz/audit impact;
- тесты и фактический результат;
- rollout/rollback;
- screenshots для UI;
- known limitations.

## 11. Нормативный промпт агенту

```text
Ты работаешь в репозитории ASA Lab.
Сначала прочитай AGENTS.md, архитектурный baseline и указанные ADR.
Реализуй только перечисленный вертикальный use case.
Не изменяй архитектуру, зависимости и контракты вне указанного scope.
Не используй placeholders, mock success или TODO вместо реализации.
Все tenant-owned операции проверяют tenant и полномочия на сервере.
Все административные мутации создают AuditEvent.
Изменение API требует OpenAPI и contract tests.
Изменение данных требует migration и rollback/forward-fix procedure.
В конце выполни все команды и перечисли фактические результаты без выдуманных успехов.
```

## 12. Merge gate

AI-PR не сливается только потому, что код компилируется. Обязательны:

- выполненные acceptance criteria;
- negative authorization tests;
- tenant isolation tests;
- retry и idempotency tests;
- observability;
- migration safety;
- отсутствие placeholders;
- human approval для identity, security, billing, support access и destructive migrations.

## 13. Политика параллельной работы агентов

- Один агент владеет одним bounded task и отдельной веткой.
- Allowed paths не пересекаются без координации.
- Контракт меняется отдельным первым коммитом.
- Агент не переписывает чужую незавершённую работу.
- Конфликт архитектуры решается до merge, а не после автоматического разрешения git conflict.
- Массовая генерация файлов проходит детерминированный validator и review выборочных результатов.
