# AGENTS.md — обязательный контракт coding-агента ASA Lab

## 1. Каноническое состояние

```text
canonical branch:        main
active task:             TASK-CREATOR-PORTAL-001
active issue:            #62
active branch:           agent/r2-creator-portal
status:                  in_review
completed dependency:    TASK-ACCOUNT-C1-001
product merge SHA:       e01ac85095ddaabef19ed618964deac3aa5b2406
verified Account SHA:    35c06c42012672b9b4cb2626b85ba1f21b973bc0
```

R2 Creator Portal — единственная исполняемая product task. R3, R4 и School Pilot остаются blocked.

## 2. Источники истины

Читать в таком порядке:

1. `AGENTS.md`;
2. `docs/project-map/infrastructure-focus.yaml`;
3. `docs/project-map/project-map.yaml`;
4. `docs/delivery/EXECUTION_MANIFEST.yaml`;
5. GitHub Issue #62;
6. `docs/testing/test-catalog.yaml`;
7. `docs/testing/active-task-tests.yaml`.

При конфликте остановиться и назвать точные источники. Не выбирать другой task догадкой.

## 3. Ветка и Git

- выполнить `git fetch --all --prune`;
- перейти на `agent/r2-creator-portal` и fast-forward до `origin/agent/r2-creator-portal`;
- ветка должна происходить от актуального `main`;
- не создавать другую product branch;
- не использовать force-push, rebase опубликованной истории или reset-hard;
- не merge в `main`, не создавать release tag;
- не закрывать и не удалять старые PR/ветки;
- не коммитить backups, dumps, credentials и owner-only screenshots.

## 4. Текущая задача

**Task:** `TASK-CREATOR-PORTAL-001`  
**Issue:** `https://github.com/spikeal8-maker/asa-lab/issues/62`  
**Branch:** `agent/r2-creator-portal`

Пользовательский результат:

```text
Account login
→ Creator Home
→ recent projects
→ Projects / Learning / Collections / Challenges
→ capability-aware Classes
→ Help
→ Account and workspace switcher
```

Интерфейс должен выглядеть как цельный пользовательский кабинет, а не как техническая Account-панель.

## 5. Что уже работает и не реализуется повторно

- public registration и universal login;
- Account / Profile / Principal;
- Personal Workspace и ActiveContext;
- educator capability и AuditEvent;
- sessions_v2 и session revocation;
- Teacher Portal baseline;
- Project Hub;
- Electronics, Chess и Chess Online;
- PostgreSQL, RLS, Docker, persistence и backup/restore.

Запрещено создавать второй Account/Profile/Principal/Workspace/Session model.

## 6. Scope R2

Реализовать только:

- Creator Home как default authenticated route;
- recent projects и понятные continue/create actions;
- loading, empty, error и restricted states;
- server-derived capability-aware navigation;
- workspace switcher без выдачи capability;
- Classes только для educator capability;
- честные Learning, Collections, Challenges и Help surfaces;
- Account/Profile/Sessions внутри единого Portal shell;
- desktop, tablet и mobile layout;
- refresh, deep links, Back и Forward;
- сохранение всех существующих данных и product flows.

Вне scope:

- R3 Module Registry/Editor Host rewrite;
- R4 Electronics parity;
- StudentSeat provisioning;
- publication/community backend;
- assignments/review/grades;
- admin/billing;
- аудит старых PR.

## 7. Обязательные проверки

Реестр активной задачи: `docs/testing/active-task-tests.yaml`.

```bash
python -m compileall -q tools
python tools/validate_architecture.py
python tools/validate_capability_map.py
python tools/validate_infrastructure_focus.py
python tools/validate_project_map.py
python tools/validate_test_catalog.py
python tools/validate_delivery_program.py
python tools/run_task_tests.py --task TASK-CREATOR-PORTAL-001
```

Нужно реализовать реальные команды:

```bash
pnpm test:creator-portal
pnpm e2e:creator-portal
```

`PASS` существует только после реального exit `0`. Отсутствующая среда или ещё не реализованная команда — `BLOCKED`, не фиктивный PASS.

## 8. Browser gate

Live API/PostgreSQL без mocks. Проверить creator и educator, desktop/tablet/mobile, existing projects и workspace switching.

```text
console errors = 0
pageerror = 0
unexpected requestfailed = 0
unexpected HTTP 5xx = 0
```

## 9. Stop condition

Открыть Draft PR из `agent/r2-creator-portal` в `main` и остановиться после:

1. завершённого R2 user flow;
2. focused tests PASS;
3. полного regression/static gate;
4. owner-visible screenshots;
5. точного итогового SHA и чистого tracked tree.

R3 не начинать.
