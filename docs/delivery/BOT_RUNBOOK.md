# BOT_RUNBOOK — coding-агент ASA Lab

## Активная задача

```text
TASK:   TASK-CREATOR-PORTAL-001
ISSUE:  #62
BRANCH: agent/r2-creator-portal
STATUS: ready
```

Coding-агент пишет product code по этой задаче. Аудит старых PR выполняется отдельно и не входит в R2.

## Источники

```text
AGENTS.md
→ docs/project-map/infrastructure-focus.yaml
→ docs/project-map/project-map.yaml
→ docs/delivery/EXECUTION_MANIFEST.yaml
→ GitHub Issue #62
→ docs/testing/test-catalog.yaml
→ docs/testing/active-task-tests.yaml
```

Человеко-читаемые документы:

- [`DEVELOPMENT_PROGRAM_V1.md`](DEVELOPMENT_PROGRAM_V1.md)
- [`LOCAL_PORT_POLICY.md`](LOCAL_PORT_POLICY.md)
- [`../project-map/PROJECT_MAP.md`](../project-map/PROJECT_MAP.md)
- [`../project-map/QUALITY_MAP.md`](../project-map/QUALITY_MAP.md)

## ORIENT

```bash
git remote -v
git status --short --branch
git fetch --all --prune
git switch agent/r2-creator-portal
git pull --ff-only origin agent/r2-creator-portal
git rev-parse HEAD
```

Не удалять backups, credentials и owner screenshots. Не использовать force-push/reset-hard/rebase опубликованной истории.

## Реализация

Один вертикальный flow:

```text
Creator Home data/view model
→ capability-aware navigation
→ workspace/account integration
→ responsive UI states
→ focused tests
→ live browser E2E
→ evidence
```

Не создавать второй Account/Profile/Principal/Workspace/Session model. Сохранять текущие Accounts, classes, projects, Electronics, Chess и Chess Online.

## Scope

- Creator Home как default authenticated route;
- recent projects и continue/create actions;
- explicit loading/empty/error/restricted states;
- server-derived navigation;
- Classes только для educator capability;
- workspace switcher без изменения capability;
- Learning, Collections, Challenges и Help как честные surfaces;
- Account/Profile/Sessions внутри единого Portal shell;
- refresh, deep links, Back/Forward;
- desktop/tablet/mobile.

## Non-goals

R3, R4, StudentSeat, publication backend, assignments, admin, Electronics parity и старые PR.

## Проверки

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

Активный registry: [`../testing/active-task-tests.yaml`](../testing/active-task-tests.yaml).

Нужно добавить реальные package scripts:

```text
test:creator-portal
e2e:creator-portal
```

Browser counters:

```text
console errors = 0
pageerror = 0
unexpected requestfailed = 0
unexpected HTTP 5xx = 0
```

## Git и PR

- обычные логические commits;
- push только в `agent/r2-creator-portal`;
- Draft PR в `main` после первого работающего вертикального результата;
- не merge, не tag, не активировать R3;
- не закрывать старые PR/ветки.

## Stop condition

Остановиться после focused/full PASS, desktop/tablet/mobile screenshots, точного SHA и owner review packet.

Machine contract: [`EXECUTION_MANIFEST.yaml`](EXECUTION_MANIFEST.yaml).