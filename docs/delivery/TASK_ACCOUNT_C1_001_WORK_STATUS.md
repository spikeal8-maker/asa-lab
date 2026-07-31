# TASK-ACCOUNT-C1-001 — Completed

Status: `done / owner accepted / merged`

```text
Issue:                   #48 closed/completed
Verified implementation: 35c06c42012672b9b4cb2626b85ba1f21b973bc0
Merged PR:               #70
Merge commit on main:    e01ac85095ddaabef19ed618964deac3aa5b2406
Active product task:     none
Next executable task:    none
```

Функциональная полнота всей платформы не заявляется. Завершён только R1 Account C1 identity/security slice.

## Реализованный результат

```text
POST   /api/capabilities/educator/self-attest
GET    /api/workspaces
POST   /api/session/context
GET    /api/account/profile
PATCH  /api/account/profile
GET    /api/account/sessions
DELETE /api/account/sessions/:id
POST   /api/account/sessions/revoke-all
```

Web surface:

```text
#/account
PortalHeader account menu
workspace switcher
profile
active session management
```

## Сохранённые инварианты

- adult registration, Account/Profile/Principal и Personal Workspace не дублированы;
- `sessions_v2` и login по email/username сохранены;
- existing teacher, classes, projects and drafts сохранены;
- educator eligibility вычисляется сервером;
- client capability/role/tenant/workspace forgery отклоняется;
- Session API не возвращает cookie token или token hash;
- migrations `0010` и `0011` additive;
- destructive cleanup не выполнялся.

## Проверенная матрица

Все результаты относятся к implementation SHA `35c06c4…`:

```text
Account task gate:       28/28 PASS
Regression:              45 files / 298 tests PASS
Account PostgreSQL:      6/6 PASS
Chess Online PostgreSQL: 6/6 PASS
RLS:                     15/15 PASS
Accessibility/UI states: 11/11 PASS
Playwright release:      9/9 PASS
Browser errors:          0
Docker dev/test/staging: PASS
Persistence:             PASS
Backup/restore:          PASS
```

Owner-preview screenshots находятся локально вне Git:

```text
e2e/artifacts/owner-preview/account-c1/01-public-entry-desktop.png
e2e/artifacts/owner-preview/account-c1/02-project-hub-electronics-chess.png
e2e/artifacts/owner-preview/account-c1/03-account-profile-desktop.png
e2e/artifacts/owner-preview/account-c1/04-workspace-switched-desktop.png
e2e/artifacts/owner-preview/account-c1/05-session-management-desktop.png
e2e/artifacts/owner-preview/account-c1/06-account-profile-mobile.png
```

Hosted GitHub Actions остаётся внешне заблокированным до первого шага и не считается PASS.

## После завершения

R2, R3 и R4 остаются blocked roadmap. Ни один следующий этап не активируется автоматически.
