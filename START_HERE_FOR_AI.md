# START_HERE_FOR_AI — первая задача coding-агенту

## 1. Миссия

Создать production-oriented фундамент ASA Lab: универсальный Classroom Core и подключаемые учебные модули. Первый производственный модуль — виртуальная лаборатория электроники.

## 2. Перед созданием кода

Прочитай полностью:

1. `AGENTS.md`;
2. `docs/delivery/BOT_RUNBOOK.md`;
3. `docs/project-map/TASK_SYSTEM.md`;
4. `docs/project-map/PROJECT_MAP.md`;
5. `docs/project-map/QUALITY_MAP.md`;
6. `docs/project-map/project-map.yaml`;
7. `docs/testing/TEST_STRATEGY.md`;
8. `docs/testing/test-catalog.yaml`;
9. `docs/architecture/ARCHITECTURE_BASELINE.md`;
10. `docs/architecture/CAPACITY_AND_SLO.md`;
11. `docs/architecture/AI_DELIVERY_GOVERNANCE.md`;
12. `docs/architecture/DECISIONS.md`;
13. `docs/architecture/IMPLEMENTATION_ROADMAP.md`;
14. `.github/workflows/spec-validation.yml`.

До этого код не создавать. Конфликт требований не разрешать догадкой: остановить изменение, описать конфликт и предложить ADR.

Coding-агент берёт только GitHub Issue, чей `TASK-ID` присутствует в `project-map.yaml`, имеет статус `ready` и не имеет незавершённых зависимостей. Самостоятельно выбирать последующую фазу запрещено.

Перед реализацией агент выполняет ORIENT и PLAN из `BOT_RUNBOOK.md`, перечисляет обязательные test IDs и сообщает критерий остановки.

## 3. Bootstrap-итерация

Выполни только foundation из Issue `TASK-BOOT-001`. Не реализуй пользователей, классы, биллинг или электронику.

### Результат

```text
apps/
  web/
  admin/
  api/
  realtime-gateway/
  job-dispatcher/
  worker-runtime/
packages/
  contracts/
  domain-kernel/
  authz/
  database/
  eventing/
  module-sdk/
  observability/
  ui-kit/
  test-kit/
contexts/
modules/
crates/
infra/
tests/
```

### Точные действия

1. Создай `pnpm` workspace и Nx project graph.
2. Зафиксируй активные LTS/stable версии в lockfile и tool-version files.
3. Включи строгий TypeScript без implicit `any`.
4. Добавь Nx tags и `@nx/enforce-module-boundaries`.
5. Создай пустые приложения и пакеты с health endpoints.
6. Добавь Docker Compose: PostgreSQL, Redis, MinIO.
7. Добавь migration runner и одну служебную migration table.
8. Добавь request context: requestId, trace context и validated tenant placeholder без доверия данным body.
9. Добавь OpenTelemetry bootstrap без персональных attributes.
10. Добавь OpenAPI/JSON Schema validation scripts.
11. Добавь GitHub Actions: format, lint, typecheck, boundaries, unit, contracts, build.
12. Добавь архитектурный тест, запрещающий import `modules/*` из Classroom Core.
13. Добавь secret scan и dependency/license inventory baseline.
14. Добавь `.env.example` только с безопасными локальными значениями.
15. Добавь команду сохранения фактического Nx graph как CI artifact и локальный отчёт.
16. Сопоставь Nx nodes с узлами `project-map.yaml`; расхождение не скрывай.
17. Реализуй команды, зарегистрированные для `TASK-BOOT-001` в `test-catalog.yaml`.
18. Обнови `project-map.yaml`, `PROJECT_MAP.md`, `QUALITY_MAP.md` и README точными командами запуска.

### Запрещено

- реализовывать business entities;
- добавлять GraphQL;
- добавлять Kafka, Kubernetes или service mesh;
- выполнять пользовательский код;
- создавать mock success, изображающий готовую функцию;
- менять архитектурные документы без ADR;
- ослаблять проверки;
- отмечать TASK как `done` до подтверждения exit gate;
- обозначать невыполненный test ID как `PASS`.

## 4. Команды приёмки

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm boundaries:check
pnpm contracts:check
pnpm test
pnpm build
docker compose config
python tools/validate_architecture.py
python tools/validate_project_map.py
python tools/validate_test_catalog.py
```

Полный нормативный список test IDs берётся из `docs/testing/test-catalog.yaml`. Issue может требовать дополнительные тесты, но не может молча исключить обязательные.

## 5. Отчёт агента

В конце агент обязан вывести стандартный отчёт `BOT_RUNBOOK.md`:

```text
TASK:
ISSUE:
STATUS:
BRANCH:
COMMITS:
FILES_CHANGED:
MAP_NODES_CHANGED:
TESTS_RUN:
BLOCKERS:
RESIDUAL_RISKS:
NEXT_ALLOWED_TASK:
NEXT_COMMAND:
```

Дополнительно указать:

- созданные проекты и Nx tags;
- фактический dependency graph;
- расхождения между Nx graph и project map;
- версии инструментов;
- результат каждого обязательного test ID;
- принятые решения;
- подтверждение отсутствия business features и placeholders.

Следующая задача берётся только после успешной Bootstrap-приёмки, merge PR и перевода TASK в `done`.
