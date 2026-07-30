# Карта качества ASA Lab

Источники:

- [`../delivery/EXECUTION_MANIFEST.yaml`](../delivery/EXECUTION_MANIFEST.yaml);
- [`../testing/test-catalog.yaml`](../testing/test-catalog.yaml);
- [`project-map.yaml`](project-map.yaml);
- [`../delivery/DEVELOPMENT_PROGRAM_V1.md`](../delivery/DEVELOPMENT_PROGRAM_V1.md).

## Исполняемая очередь

```text
TASK-PRODUCT-DOC-001  done
TASK-PORTAL-001       done
TASK-ACCOUNT-C1-001   in_progress
```

Других executable tasks сейчас нет. R2 Issue №62, R3 Issue №37 и R4 Issue №63 остаются blocked roadmap и не получают test gate до отдельной активации.

## Принятый baseline

```text
runtime baseline: 7afebdcf9441b027092ce17a37f1f89950af99c6
full local suite: 286/286
PostgreSQL: PASS
RLS: 15/15
Playwright: 8/8
browser counters: console=0, pageerror=0, requestfailed=0
```

Этот PASS относится только к baseline SHA. Он не переносится на новые Account commits.

## Общие profiles

### product_docs

```text
TST-ARCH-001
TST-MAP-001
TST-CAPABILITY-MAP-001
TST-DEVELOPMENT-PROGRAM-001
TST-CATALOG-001
TST-YAML-001
TST-LINKS-001
```

### code_common

```text
TST-MAP-001
TST-CAPABILITY-MAP-001
TST-DEVELOPMENT-PROGRAM-001
TST-FORMAT-001
TST-LINT-001
TST-TYPE-001
TST-BOUNDARY-001
TST-BUILD-001
TST-CONTRACT-001
TST-UNIT-001
TST-SECRET-001
TST-DEPENDENCY-001
TST-PORTS-001
TST-STARTUP-001
TST-A11Y-001
```

### tenant_storage

```text
TST-MIGRATION-001
TST-TENANT-001
TST-RLS-001
TST-AUTHZ-001
```

## Account C1 gate

Profiles:

```text
code_common + tenant_storage
```

Task-specific IDs:

```text
TST-ACCOUNT-REG-001
TST-ACCOUNT-BACKFILL-001
TST-ACCOUNT-LEGACY-COMPAT-001
TST-PERSONAL-WORKSPACE-001
TST-CAPABILITY-001
TST-WORKSPACE-CONTEXT-001
TST-SESSION-V2-001
TST-IDENTITY-RLS-001
TST-E2E-ACCOUNT-C1-001
```

Обязательный user flow:

```text
existing Account foundation
→ educator self-attestation
→ audited provisional educator grant
→ workspace list
→ safe ActiveContext switch
→ profile
→ active session list
→ revoke one/all other sessions
→ existing teacher/projects preserved
```

Negative matrix:

- under-18 educator grant denied;
- client capability/role forgery denied;
- unknown, foreign and suspended workspace denied;
- client tenant/workspace override denied;
- cross-account personal workspace isolation;
- cross-account session revoke denied;
- token hash never returned;
- revoked session receives 401;
- legacy link cannot cross tenant/account;
- school_admin never implies platform_admin.

## Test command lifecycle

Account test IDs зарегистрированы до завершения реализации. Пока реальные suites отсутствуют, соответствующие package scripts обязаны завершаться:

```text
BLOCKED
exit code 78
```

Это предотвращает как `command not found`, так и ложный PASS. Product implementation заменяет blocker-команды реальными Vitest/Playwright commands в том же PR.

## Проверка migrations и данных

Обязательно:

- новая migration только additive;
- migration `0010` не изменяется;
- apply на пустой test DB;
- apply на копии существующей DB;
- repeat apply = 0 pending;
- checksum applied migrations сохранён;
- существующие teacher/classes/projects/drafts не сброшены;
- backup/restore выполняется только в изолированной DB.

## Browser gate

Account C1 Playwright использует live API/PostgreSQL без mocks и проверяет:

- public registration/login regression;
- account menu and profile;
- educator grant;
- workspace switch;
- two active sessions;
- revoke another session;
- refresh/logout/relogin;
- preservation of projects;
- existing teacher access to Electronics and Chess.

Для каждого browser scenario:

```text
console errors = 0
page errors = 0
unexpected requestfailed = 0
unexpected HTTP 5xx = 0
```

## GitHub Actions

Workflow опубликован для `main`, `agent/**` и `assistant/**` с jobs:

- governance;
- format/lint/typecheck/contracts/build;
- PostgreSQL/RLS.

Текущий hosted-runner status:

```text
BLOCKED before first step
step list empty
logs unavailable
```

Это не считается validator/code FAIL и не считается PASS. До устранения Actions account/runner blocker локальная полная матрица остаётся обязательной.

## Статусы

- `PASS` — реальный exit `0`;
- `FAIL` — выполненная команда вернула non-zero;
- `BLOCKED` — обязательная среда или ещё не реализованный suite отсутствует;
- `NOT_RUN` — команда не запускалась.

`BLOCKED` и `NOT_RUN` не закрывают gate. Screenshot не заменяет assertion, manual smoke не заменяет Playwright.

Единый task runner:

```bash
python tools/run_task_tests.py --task TASK-ACCOUNT-C1-001
```
