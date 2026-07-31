# START_HERE_FOR_AI — вход coding-агента в ASA Lab

## 1. Сначала установи фактическое состояние

```bash
git remote -v
git status --short --branch
git fetch --all --prune
git rev-parse HEAD
git rev-parse origin/main
```

Не удаляй untracked backups, credentials или owner screenshots. Не выполняй `force-push`, `reset --hard`, удаление volumes, merge или tag без отдельного разрешения.

## 2. Прочитай источники в порядке

```text
AGENTS.md
→ docs/project-map/infrastructure-focus.yaml
→ docs/project-map/project-map.yaml
→ docs/delivery/EXECUTION_MANIFEST.yaml
→ GitHub Issue активной задачи
→ docs/testing/test-catalog.yaml
```

При конфликте остановись и назови источники. Не выбирай удобный вариант самостоятельно.

## 3. Каноническое состояние

```text
main:                    e01ac85095ddaabef19ed618964deac3aa5b2406
verified implementation: 35c06c42012672b9b4cb2626b85ba1f21b973bc0
PR #70:                  merged
Account C1 / Issue #48:  completed
active product task:     none
```

`main` является источником текущей Alpha-сборки. Функциональная полнота конечного продукта не заявляется.

## 4. Что уже реализовано

Не создавать повторно:

- public entry и adult registration;
- Account / Profile / Principal;
- Personal Workspace;
- `sessions_v2` и login по email/username;
- educator self-attestation и audited capability;
- workspace list и ActiveContext switching;
- account menu/profile;
- active sessions и revocation;
- legacy teacher compatibility;
- principal-aware project ownership;
- Project Hub, Electronics, ASA Chess и Chess Online;
- additive migrations `0010` и `0011`;
- Docker runtime, persistence и backup/restore.

## 5. Активной задачи сейчас нет

Ожидаемое состояние:

```text
infrastructure-focus.active = false
product current_focus = null
Account C1 = done
Issue #48 = closed/completed
R2/R3/R4 = blocked roadmap
```

При отсутствии active task выведи:

```text
NO_ACTIVE_TASK
```

После этого не меняй product code и не активируй roadmap самостоятельно.

## 6. Следующие roadmap-этапы

```text
R2 Creator Home / capability-aware Portal shell   blocked
R3 Module Registry / Project Hub lifecycle        blocked
R4 Electronics functional parity                  blocked
```

Roadmap не является executable queue. Новый этап начинается только после отдельного owner-approved governance transition с task ID, Issue, branch, scope и tests.

## 7. Старые PR и ветки

Не merge и не удалять автоматически.

Аудит выполняется отдельно по категориям:

```text
contained
superseded
still valuable
obsolete
```

Coding-агент не тратит product session на этот аудит, если ему уже выдана отдельная активная задача.

## 8. Порты

```text
Web  127.0.0.1:4610
API  127.0.0.1:4611
E2E  127.0.0.1:4612
```

Не использовать `3000`, `3100`, `5173`. Не завершать неизвестные процессы.

## 9. Перед будущей product task

После публикации task transition агент обязан вывести не более 25 строк:

```text
TASK:
ISSUE:
BRANCH:
HEAD:
BASELINE:
STATUS:
DEPENDENCIES:
ALREADY_IMPLEMENTED:
USER_FLOW:
NON_GOALS:
PORTS:
FOCUSED_TESTS:
STOP_CRITERION:
```

Затем сразу реализовывать активный vertical flow. Не запрашивать merge target, release tag или следующую ветку, если они не нужны текущему slice.

## 10. Проверки

`PASS` существует только после реального exit `0`. `BLOCKED` и `NOT_RUN` не закрывают gate.

Hosted GitHub Actions сейчас может завершаться до первого шага. Это внешний blocker и не заменяет exact-SHA local gate.
