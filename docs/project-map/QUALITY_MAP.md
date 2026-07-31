# Карта качества ASA Lab

Источники:

- [`../delivery/EXECUTION_MANIFEST.yaml`](../delivery/EXECUTION_MANIFEST.yaml);
- [`../testing/test-catalog.yaml`](../testing/test-catalog.yaml);
- [`project-map.yaml`](project-map.yaml);
- [`../delivery/DEVELOPMENT_PROGRAM_V1.md`](../delivery/DEVELOPMENT_PROGRAM_V1.md).

## Состояние queue

```text
TASK-PRODUCT-DOC-001  done
TASK-PORTAL-001       done
TASK-ACCOUNT-C1-001   done
current_focus          null
```

R2, R3 и R4 остаются blocked roadmap. Для них нет активного exit gate до отдельного owner transition.

## Проверенный implementation SHA

```text
35c06c42012672b9b4cb2626b85ba1f21b973bc0
```

Merge commit в `main`:

```text
e01ac85095ddaabef19ed618964deac3aa5b2406
```

## Финальная Account C1 матрица

```text
canonical task runner: 28/28 PASS
regression suite:      45 files / 298 tests PASS
Account PostgreSQL:    6/6 PASS
Chess Online PG:       6/6 PASS
RLS:                   15/15 PASS
accessibility/UI:      11/11 PASS
Playwright release:    9/9 PASS
console errors:        0
pageerror:             0
requestfailed:         0 unexpected
Docker dev/test/stage: PASS
persistence:           PASS
backup/restore:        PASS
```

## Account C1 test IDs

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

Все связанные package scripts заменены реальными Vitest/Playwright suites и прошли в exact-SHA task runner.

## Доказанные negative cases

- under-18 educator grant denied;
- capability/role forgery denied;
- unknown, foreign и suspended workspace denied;
- tenant/workspace override denied;
- cross-account workspace and session isolation;
- token hash never returned;
- revoked session receives 401;
- legacy teacher/classes/projects preserved;
- `school_admin` не даёт `platform_admin`.

## Migration и данные

- migrations `0010` и `0011` additive;
- empty database apply PASS;
- repeat apply = 0 pending;
- applied checksums сохранены;
- working data не сбрасывались;
- две существующие учётные записи сохранены;
- backup/restore проверен в изолированной базе;
- backup mode `0600`.

## Browser evidence

Account C1 Chromium flow проверяет:

```text
registration/login
→ educator self-attestation
→ profile
→ workspace switch
→ two sessions
→ revoke another session
→ logout/relogin
→ existing Electronics and Chess projects preserved
```

Owner screenshots находятся локально вне Git.

## Hosted GitHub Actions

```text
status: BLOCKED before first step
steps: []
logs: unavailable
code/postgres jobs: skipped
```

Это внешний runner/settings blocker. Hosted CI не объявляется PASS и не отменяет exact-SHA local gate.

## Результаты

- `PASS` — реальный exit `0`;
- `FAIL` — выполненная команда вернула non-zero;
- `BLOCKED` — обязательная среда отсутствует;
- `NOT_RUN` — команда не запускалась.

`BLOCKED` и `NOT_RUN` не закрывают gate.
