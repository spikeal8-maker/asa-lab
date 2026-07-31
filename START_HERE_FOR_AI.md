# START_HERE_FOR_AI — вход coding-агента в ASA Lab

## Текущая команда

```text
TASK:   TASK-CREATOR-PORTAL-001
ISSUE:  #62
BRANCH: agent/r2-creator-portal
STATUS: ready
BASE:   current main
```

## Первые действия

```bash
git remote -v
git status --short --branch
git fetch --all --prune
git switch agent/r2-creator-portal
git pull --ff-only origin agent/r2-creator-portal
git rev-parse HEAD
```

Не удалять untracked backups, credentials и owner screenshots. Не использовать force-push, reset-hard, rebase опубликованной истории, merge или tag.

## Обязательное чтение

```text
AGENTS.md
→ docs/project-map/infrastructure-focus.yaml
→ docs/project-map/project-map.yaml
→ docs/delivery/EXECUTION_MANIFEST.yaml
→ GitHub Issue #62
→ docs/testing/test-catalog.yaml
→ docs/testing/active-task-tests.yaml
```

## Что строится

```text
Account login
→ Creator Home
→ recent projects
→ Projects / Learning / Collections / Challenges
→ capability-aware Classes
→ Help
→ Account and workspace switcher
```

Главная задача — заменить разреженную техническую Account-панель цельным пользовательским кабинетом.

## Что сохраняется

Account C1, текущие Accounts, classes, projects, Electronics, Chess, Chess Online, sessions, PostgreSQL/RLS и Docker не создаются повторно и не сбрасываются.

## Что запрещено

- R3/R4;
- StudentSeat;
- publication/assignments/admin;
- Electronics parity;
- аудит и закрытие старых PR;
- другая product branch.

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

Реализовать package commands `test:creator-portal` и `e2e:creator-portal`, затем получить реальные PASS.

## Stop

Открыть Draft PR в `main`, приложить desktop/tablet/mobile evidence, точные test results и итоговый SHA. R3 не начинать.

Machine contract: [`docs/delivery/EXECUTION_MANIFEST.yaml`](docs/delivery/EXECUTION_MANIFEST.yaml).