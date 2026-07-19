# Стратегия тестирования ASA Lab

Тестирование является частью каждой executable task, а не отдельным этапом после разработки.

## 1. Источники истины

```text
docs/delivery/EXECUTION_MANIFEST.yaml  test profiles каждой canonical task
docs/testing/test-catalog.yaml         стабильные test IDs и команды
docs/project-map/QUALITY_MAP.md        визуальное представление gates
GitHub Issue                            acceptance текущего user flow
```

`tools/validate_delivery_program.py` разворачивает profiles manifest и требует точного совпадения с `required_for` test catalog. После начала task нельзя удалить test ID ради зелёного результата.

## 2. Что означает phase_available

`phase_available` — архитектурный горизонт, в котором тест применим. Это **не execution order**.

Порядок задач задаётся `delivery_stage` в Execution Manifest. Например, Electronics Alpha может использовать Phase 5 tests раньше полного StudentSeat workflow, потому что Technical Alpha является отдельным delivery track.

## 3. Уровни

| Уровень | Назначение |
|---|---|
| Governance | Product, capability, execution manifest, project map, catalog |
| Static | format, lint, strict types, build, boundaries |
| Unit | domain rules and deterministic algorithms |
| Contract | OpenAPI, JSON Schema, Module SDK, events/jobs |
| Integration | PostgreSQL, repositories, migrations, application use cases |
| Authorization | tenant/class/project/student negative matrix and RLS |
| E2E | critical user flow through browser/API/DB |
| Security | secrets, advisories, licenses, credentials, port safety |
| Accessibility | keyboard, semantics, focus, contrast, reduced motion |
| Simulation | native/WASM golden and parity |
| Load/Recovery | measured school scale and restore drills |

## 4. Test profiles

Canonical profiles are machine-readable in `EXECUTION_MANIFEST.yaml`:

- `product_docs`;
- `code_common`;
- `tenant_storage`;
- `module_runtime`;
- `assessment_common`;
- `electronics_kernel`.

Каждая task добавляет к profiles свои task-specific tests. Итоговый набор должен **точно** совпадать с `required_for`.

## 5. Общий минимум product task

По manifest и применимости:

1. map/capability/program validation;
2. format/lint/type/build/boundaries;
3. contracts;
4. unit/integration;
5. migration;
6. tenant/authz/RLS;
7. secret/dependency/license;
8. canonical ports and clean startup;
9. accessibility;
10. automated browser E2E;
11. simulation golden/parity для Electronics;
12. map/Nx evidence.

Неприменимость не определяется устно: она выражается отсутствием test ID в manifest profile/task entry до начала реализации.

## 6. Пирамида

```text
        Load / Recovery / extended Security
               Critical browser E2E
          Integration / Authz / Contract
                    Unit
          Static and governance gates
```

E2E покрывает ключевой пользовательский flow, а не все комбинации полей.

## 7. Test data

- Production data не копируются без обезличивания.
- Integration/E2E используют synthetic tenants, teachers, StudentSeats и projects.
- `TEST_DATABASE_URL` отделён от development/production и имеет test marker/guard.
- Минимум два tenants используются для отрицательных сценариев.
- Credentials, tokens и child content отсутствуют в snapshots/artifacts.
- Suite выполняет cleanup или работает в изолированной test database/schema.
- UUID/time/randomness контролируются там, где нужна детерминированность.

## 8. UI evidence

Каждая UI task предоставляет:

- automated Playwright flow;
- screenshot основного состояния;
- screenshot error/diagnostic state при применимости;
- accessibility report;
- canonical demo URL;
- occupied-port safety report.

Manual browser smoke не заменяет E2E. Screenshot не заменяет assertion.

## 9. Результаты

```text
TST-PORTAL-API-001 PASS duration=4.2s
TST-E2E-PORTAL-001 FAIL assertion="classroom card missing" artifact=...
TST-STARTUP-001 BLOCKED reason="4610 occupied by unknown process"
TST-LOAD-L1-001 NOT_RUN reason="not required by current task"
```

- PASS — команда выполнена, exit 0;
- FAIL — команда выполнена, non-zero;
- BLOCKED — обязательная среда отсутствует;
- NOT_RUN — команда не запускалась.

`BLOCKED` и `NOT_RUN` не закрывают gate.

## 10. Единый запуск

```bash
python tools/run_task_tests.py --task <TASK-ID>
```

Runner:

- поддерживает многочастные IDs вроде `TASK-PROJECT-SHELL-001`;
- выбирает все tests по `required_for`;
- передаёт `ASA_TASK_ID` и `ASA_TEST_ID` дочерним validators;
- фиксирует commit SHA, branch и working-tree state;
- возвращает exit 0 только при полном PASS.

## 11. Map evidence

Product-code PR обязан обновить или подтвердить:

```text
project-map.yaml
PROJECT_MAP.md
QUALITY_MAP.md
nx-project-graph.json
```

В task PR карта показывает `in_review`; после merge выполняется map-only transition `done → next ready → current_focus next`.

## 12. Local-first verification

GitHub-hosted Actions сейчас информационны из-за account billing blocker. Обязательный gate — фактический локальный task runner с commit SHA. Это не разрешает ослаблять tests.

## 13. Добавление или удаление теста

Новый test получает стабильный ID. Изменение exit gate синхронно обновляет:

- Execution Manifest;
- test catalog;
- Quality Map;
- текущую Issue;
- при необходимости Project Map.

Security/authz/compatibility test нельзя удалить только потому, что он падает.
