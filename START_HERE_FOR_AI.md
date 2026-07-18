# START_HERE_FOR_AI — первая задача coding-агенту

## 1. Миссия

Создать production-oriented фундамент ASA Lab: универсальный Classroom Core и подключаемые учебные модули. Первый производственный модуль — виртуальная лаборатория электроники.

## 2. Перед созданием кода

Прочитай полностью:

1. `AGENTS.md`;
2. `docs/architecture/ARCHITECTURE_BASELINE.md`;
3. `docs/architecture/CAPACITY_AND_SLO.md`;
4. `docs/architecture/AI_DELIVERY_GOVERNANCE.md`;
5. `docs/architecture/DECISIONS.md`;
6. `docs/architecture/IMPLEMENTATION_ROADMAP.md`;
7. `.github/workflows/spec-validation.yml`.

До этого код не создавать. Конфликт требований не разрешать догадкой: остановить изменение, описать конфликт и предложить ADR.

## 3. Bootstrap-итерация

Выполни только foundation. Не реализуй пользователей, классы, биллинг или электронику.

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
15. Обнови README точными командами запуска.

### Запрещено

- реализовывать business entities;
- добавлять GraphQL;
- добавлять Kafka, Kubernetes или service mesh;
- выполнять пользовательский код;
- создавать mock success, изображающий готовую функцию;
- менять архитектурные документы без ADR;
- ослаблять проверки.

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
```

## 5. Отчёт агента

В конце агент обязан вывести:

- созданные проекты и Nx tags;
- фактический dependency graph;
- версии инструментов;
- результаты каждой команды;
- принятые решения;
- известные ограничения;
- подтверждение отсутствия business features и placeholders.

Следующая задача берётся только после успешной bootstrap-приёмки и реализуется как один вертикальный use case.
