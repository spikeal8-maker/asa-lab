# Внесение изменений в ASA Lab

## 1. Обязательное чтение

Перед изменением репозитория прочитайте:

1. [`AGENTS.md`](AGENTS.md);
2. [`docs/architecture/ARCHITECTURE_BASELINE.md`](docs/architecture/ARCHITECTURE_BASELINE.md);
3. [`docs/architecture/DECISIONS.md`](docs/architecture/DECISIONS.md);
4. релевантные продуктовые и контрактные документы.

## 2. Ветка и область изменения

- одна задача — одна ветка;
- рекомендуемый формат: `agent/<описание>` или `feature/<описание>`;
- один Pull Request — один вертикальный use case либо одно явное архитектурное изменение;
- несвязанный рефакторинг не смешивается с feature;
- архитектурная граница меняется только через ADR.

## 3. Contract-first

При внешнем изменении сначала обновляются формальные контракты:

- HTTP API — OpenAPI;
- документы проектов и модулей — JSON Schema;
- события — versioned event schema;
- база данных — migration;
- публичный TypeScript/Rust API — compatibility tests.

Несовместимое изменение имеет новую версию и миграционный путь.

## 4. Обязательный вертикальный срез

Изменение включает, где применимо:

```text
UI
Application use case
Authorization policy
Domain invariant
Repository/migration
Audit event
Telemetry
Contract tests
Integration/E2E tests
Rollout and rollback
```

Backend-only или frontend-only шаг допустим только для foundation, явно ограниченного PR или предварительно принятого контракта.

## 5. Проверки

До открытия Pull Request выполняются доступные команды:

```bash
python -m pip install -r tools/requirements.txt
python tools/validate_architecture.py
```

После Bootstrap также обязательны:

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
```

Для Rust-кода:

```bash
cargo fmt --check
cargo clippy -- -D warnings
cargo test
```

Не указывайте проверку как успешную, если она не запускалась или завершилась ошибкой.

## 6. Commit messages

Используются Conventional Commits:

```text
feat(classroom): create classroom with owner membership
fix(authz): block cross-tenant project access
arch(platform): define tenant placement migration
chore(ci): enforce module boundaries
test(simulation): add deterministic RC circuit
```

Сообщения `update`, `changes`, `try`, `fix`, `wip` без содержательной области не допускаются в основной истории.

## 7. Security и детские данные

- не публикуйте секреты, токены, пароли и StudentSeat codes;
- не добавляйте production data в fixtures;
- не помещайте project payload и детские комментарии в логи;
- каждая tenant-owned операция имеет tenant/authz negative tests;
- недоверенный пользовательский код не запускается в API/realtime;
- уязвимости не обсуждаются в публичной Issue: используйте процесс из [`SECURITY.md`](SECURITY.md).

## 8. Pull Request

Заполните шаблон полностью. Обязательны requirement IDs, affected contexts, применимые ADR, data/API/event impact, tenant/authz/audit impact, фактические проверки, rollout и rollback/forward-fix.

Pull Request остаётся draft, пока не выполнен Definition of Done из `AGENTS.md`.
