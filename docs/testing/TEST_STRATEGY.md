# Стратегия тестирования ASA Lab

Тестирование является частью каждой executable task, а не отдельным этапом после разработки.

## 1. Источники истины

```text
docs/delivery/EXECUTION_MANIFEST.yaml  test profiles executable tasks
docs/testing/test-catalog.yaml         stable test IDs and commands
docs/project-map/QUALITY_MAP.md        visual gate representation
GitHub Issue                            acceptance current user flow
```

`tools/validate_delivery_program.py` разворачивает profiles manifest и требует точного совпадения с `required_for` test catalog. После начала task нельзя удалить test ID ради зелёного результата.

## 2. Executable и roadmap tests

Тестовый gate существует только для task, опубликованной в `EXECUTION_MANIFEST.yaml`.

Текущая executable task:

```text
TASK-ACCOUNT-C1-001
```

R2 Issue №62, R3 Issue №37 и R4 Issue №63 остаются blocked roadmap. Их будущие tests не активируются автоматически.

`phase_available` — architecture horizon, а не разрешение выполнить task вне очереди.

## 3. Уровни

| Уровень | Назначение |
|---|---|
| Governance | Product, capability, manifest, project map, catalog |
| Static | format, lint, strict types, build, boundaries |
| Unit | domain rules and deterministic algorithms |
| Contract | OpenAPI, JSON Schema, Module SDK, events/jobs |
| Integration | PostgreSQL, repositories, migrations, application use cases |
| Authorization | account/tenant/workspace/project negative matrix and RLS |
| E2E | critical user flow through browser/API/DB |
| Security | secrets, advisories, credentials and port safety |
| Accessibility | keyboard, semantics, focus, contrast and reduced motion |
| Simulation | deterministic golden and parity tests |
| Load/Recovery | measured scale and restore drills |

## 4. Profiles

Reusable profiles are defined in `EXECUTION_MANIFEST.yaml`:

- `product_docs`;
- `code_common`;
- `tenant_storage`;
- `module_runtime`;
- `assessment_common`;
- `electronics_kernel`.

Only profiles listed by the current task enter its gate.

Account C1 uses:

```text
code_common + tenant_storage
```

plus nine task-specific Account IDs.

## 5. Honest command lifecycle

Каждый test ID имеет исполняемую command.

Если suite зарегистрирован, но ещё не реализован, команда обязана:

```text
print BLOCKED reason
exit 78
```

Запрещены:

- отсутствующая package command;
- пустая команда;
- placeholder с exit 0;
- перенос PASS другого SHA;
- удаление failing security/compatibility test.

Текущие Account placeholders:

```text
pnpm test:account-c1
pnpm test:account-c1:pg
pnpm e2e:account-c1
```

Product implementation заменяет их реальными Vitest/Playwright suites.

## 6. Общий минимум Account C1

1. infrastructure terminal-state validation;
2. project map/capability/delivery/test catalog validation;
3. frozen install;
4. format/lint/typecheck/build/boundaries;
5. contracts;
6. full unit/integration regression;
7. migration empty/existing/repeat;
8. tenant/workspace/account authorization and RLS;
9. secret/dependency checks;
10. canonical ports and startup;
11. accessibility;
12. real Chromium Account C1 E2E;
13. existing Portal/Projects/Electronics/Chess regressions;
14. map/Nx evidence.

Неприменимость выражается manifest/test catalog до начала task, а не устным исключением после падения.

## 7. Test data

- Production data не копируются без обезличивания.
- Integration/E2E используют synthetic accounts, workspaces, teachers and projects.
- `TEST_DATABASE_URL` отделён от development/production и защищён `*_test` guard.
- Минимум два Account/tenant contexts используются для negative tests.
- Credentials, raw tokens, password hashes и user content отсутствуют в artifacts.
- Suite выполняет cleanup или работает в isolated database/schema.
- UUID/time/randomness контролируются для детерминированности.
- Existing teacher/project preservation проверяется отдельно без DB reset.

## 8. Migration gate

- применённая migration `0010` не редактируется;
- новая migration additive-only;
- checksum applied migrations неизменен;
- empty DB apply PASS;
- existing DB apply PASS;
- second apply adds zero migrations;
- failure rolls back transaction;
- backup/restore выполняется на isolated DB.

## 9. Authorization gate

Account C1 обязан доказать:

- client cannot forge capability/role/tenant/workspace;
- under-18 educator self-attestation denied;
- workspace switch limited to current Account memberships;
- suspended/foreign workspace denied;
- personal projects isolated cross-account;
- session list never exposes token hash;
- cross-account session revoke denied;
- revoked session immediately receives 401;
- legacy bridge cannot resolve another tenant/account;
- school_admin does not imply platform_admin.

## 10. Browser evidence

Каждая UI task предоставляет:

- Playwright through live API/PostgreSQL without mocks;
- screenshot основного состояния;
- screenshot error/security state where applicable;
- accessibility assertions;
- canonical demo URL;
- shared browser failure collector.

Expected counters:

```text
console errors = 0
page errors = 0
unexpected requestfailed = 0
unexpected HTTP 5xx = 0
```

Manual smoke и screenshot не заменяют assertions.

## 11. Result states

- `PASS` — команда выполнена, exit `0`;
- `FAIL` — команда выполнена, non-zero defect;
- `BLOCKED` — обязательная среда/runner/suite отсутствует, обычно exit `78`;
- `NOT_RUN` — команда не запускалась.

`BLOCKED` и `NOT_RUN` не закрывают gate.

## 12. Task runner

```bash
python tools/run_task_tests.py --task TASK-ACCOUNT-C1-001
```

Runner:

- выбирает все tests по `required_for`;
- передаёт `ASA_TASK_ID` и `ASA_TEST_ID`;
- фиксирует commit SHA, branch и working-tree state;
- возвращает exit 0 только при полном PASS.

## 13. Map evidence

Product-code PR обновляет или подтверждает:

```text
project-map.yaml
PROJECT_MAP.md
QUALITY_MAP.md
nx-project-graph.json
```

После owner acceptance future task **не** становится ready автоматически. Отдельный governance transition добавляет её в manifest/map/test catalog или оставляет roadmap blocked.

## 14. Local-first и GitHub Actions

GitHub workflow опубликован для `main`, `agent/**`, `assistant/**`, но hosted runner сейчас завершается до первого step без logs. Статус — external `BLOCKED`, не PASS и не code FAIL.

До устранения runner/settings/spending blocker обязательным источником gate остаётся локальный task runner с exact SHA. Это не разрешает ослаблять tests.

## 15. Изменение gate

Добавление/удаление test ID синхронно обновляет:

- `EXECUTION_MANIFEST.yaml`;
- test catalog;
- `QUALITY_MAP.md`;
- current Issue;
- Project Map при изменении task/phase scope.

Security, authz, preservation и compatibility tests нельзя удалить ради зелёного отчёта.
