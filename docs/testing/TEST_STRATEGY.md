# Стратегия тестирования ASA Lab

Тестирование является частью каждой executable task.

## Источники

```text
docs/delivery/EXECUTION_MANIFEST.yaml
docs/testing/test-catalog.yaml
docs/project-map/QUALITY_MAP.md
GitHub Issue активной задачи
```

## Текущее состояние

```text
TASK-ACCOUNT-C1-001  done
current_focus         null
active test gate      none
```

R2, R3 и R4 остаются blocked roadmap. Их test gate не активирован.

## Completed Account C1 gate

Exact implementation SHA:

```text
35c06c42012672b9b4cb2626b85ba1f21b973bc0
```

Результаты:

```text
Task runner:       28/28 PASS
Regression:        298/298 PASS
Account PG:        6/6 PASS
Chess Online PG:   6/6 PASS
RLS:               15/15 PASS
Accessibility/UI:  11/11 PASS
Playwright:        9/9 PASS
Browser errors:    0
Docker lifecycle:  PASS
Persistence:       PASS
Backup/restore:    PASS
```

Merge SHA:

```text
e01ac85095ddaabef19ed618964deac3aa5b2406
```

## Уровни

| Уровень | Назначение |
|---|---|
| Governance | manifest, project map, catalog, product contracts |
| Static | format, lint, types, build, boundaries |
| Unit | domain rules |
| Contract | OpenAPI, JSON Schema, Module SDK |
| Integration | PostgreSQL, repositories, migrations |
| Authorization | account/tenant/workspace/project denial matrix и RLS |
| E2E | live browser/API/DB user flow |
| Security | secrets, advisories, credentials |
| Accessibility | keyboard, semantics, focus and contrast |
| Recovery | persistence, backup and restore |

## Result states

- `PASS` — команда выполнена с exit `0`;
- `FAIL` — выполненная команда вернула non-zero;
- `BLOCKED` — обязательная среда отсутствует;
- `NOT_RUN` — команда не запускалась.

`BLOCKED` и `NOT_RUN` не закрывают gate.

## Honest command lifecycle

Каждый test ID имеет исполняемую command. Placeholder до реализации обязан вернуть `BLOCKED`/exit `78`, а не ложный PASS.

После реализации Account C1 команды:

```text
pnpm test:account-c1
pnpm test:account-c1:pg
pnpm e2e:account-c1
```

являются реальными suites и прошли в canonical task runner.

## Test data

- production data не копируются без обезличивания;
- tests используют отдельный `TEST_DATABASE_URL` с `*_test` guard;
- credentials, raw tokens и password hashes не попадают в artifacts;
- cross-account и cross-workspace negatives обязательны;
- existing teacher/project preservation проверяется без DB reset.

## Migration gate

- applied migration не переписывается;
- новая migration additive;
- empty/existing/repeat apply проверяются;
- failure rollback обязателен;
- backup/restore выполняется в isolated database.

## Browser evidence

Для UI task обязательны:

```text
live API/PostgreSQL
Playwright assertions
accessibility assertions
browser failure collector
owner screenshots
```

Expected counters:

```text
console errors = 0
page errors = 0
unexpected requestfailed = 0
unexpected HTTP 5xx = 0
```

Manual smoke и screenshot не заменяют assertions.

## Будущая task

После owner activation новая task получает полный test mapping в [`EXECUTION_MANIFEST.yaml`](../delivery/EXECUTION_MANIFEST.yaml) и catalog до начала product code.

Coding-агент не запускает roadmap tests самостоятельно.

## Hosted GitHub Actions

Hosted runner сейчас завершается до первого шага (`steps: []`). Статус — external `BLOCKED`, не PASS и не code FAIL.
