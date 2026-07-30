# START_HERE_FOR_AI — обязательный вход coding-агента в ASA Lab

## 1. Не выбирай задачу самостоятельно

Текущая работа определяется только согласованными источниками:

```text
AGENTS.md
→ docs/project-map/infrastructure-focus.yaml
→ docs/project-map/project-map.yaml
→ docs/delivery/EXECUTION_MANIFEST.yaml
→ GitHub Issue текущей задачи
→ docs/testing/test-catalog.yaml
```

Сообщение в чате может уточнить работу, но не заменяет task ID, Issue, branch, dependencies, scope и exit gate. При противоречии остановись и назови конкретные конфликтующие источники.

## 2. Первые команды

```bash
git remote -v
git status --short --branch
git fetch --all --prune
git rev-parse HEAD
git branch --all
```

Не удаляй untracked backups, credentials или owner-preview screenshots. Не выполняй `force-push`, `reset --hard`, prune volumes или merge без отдельного owner-разрешения.

## 3. Сначала infrastructure focus

Прочитай:

```text
docs/project-map/infrastructure-focus.yaml
```

### Когда `active: true`

Исполняется только инфраструктурная задача из этого файла и `INFRASTRUCTURE_EXECUTION_MANIFEST.yaml`. Product development запрещена.

### Когда `active: false`

Infrastructure lane обязан находиться в terminal status `done | cancelled | superseded`, `current_focus` обязан быть `null`, а validator должен пройти:

```bash
python tools/validate_infrastructure_focus.py
```

После этого исполняемая product task берётся из `project-map.yaml`.

## 4. Текущий принятый baseline

Технический Alpha-baseline владельца:

```text
7afebdcf9441b027092ce17a37f1f89950af99c6
```

Он технически принят, но функциональная полнота не заявляется.

Каноническая текущая линия:

```text
branch: assistant/docker-linux-bootstrap
PR: #70 Draft
```

`main` пока содержит более старый baseline. Не переключай разработку на `main`, не создавай новую продуктовую ветку и не закрывай старые PR без отдельного owner-решения.

## 5. Текущая product task

```text
TASK: TASK-ACCOUNT-C1-001
ISSUE: https://github.com/spikeal8-maker/asa-lab/issues/48
STATUS: in_progress
```

Перед кодом проверь, что одновременно выполняется:

```text
infrastructure-focus.active = false
project.current_focus = TASK-ACCOUNT-C1-001
EXECUTION_MANIFEST содержит TASK-ACCOUNT-C1-001 со status in_progress
Issue #48 открыт и не помечен blocked
branch = assistant/docker-linux-bootstrap
```

## 6. Что уже существует — не реализовывать повторно

На принятой линии уже есть:

- public entry;
- adult registration;
- `Account`, `Profile`, `Principal`;
- Personal Workspace;
- `sessions_v2`;
- login по email или username;
- logout текущей session;
- legacy teacher compatibility;
- principal-aware project ownership;
- Project Hub, Electronics, Chess и Chess Online;
- additive migration `0010_account_identity_sessions_v2.sql`.

Запрещено создавать вторую модель Account, Profile, Principal, Workspace или Session. Не изменяй уже применённую migration `0010`.

## 7. Оставшийся scope Account C1

Реализуется только:

- educator self-attestation с серверной проверкой возраста;
- provisional audited educator capability;
- список workspaces текущего Account;
- безопасное переключение ActiveContext текущей session;
- account menu;
- profile и отображение email verification state;
- active session list;
- revoke одной и всех других sessions;
- реальный Chromium Account C1 flow;
- сохранение существующего педагога, классов и проектов.

Вне scope:

- расширение Electronics, Chess и Chess Online;
- StudentSeat и class-code provisioning;
- публикация, Explore, assignments, grades и badges;
- destructive legacy cleanup;
- новая product branch.

## 8. Каноническая очередь

```text
TASK-PORTAL-001                  done
→ TASK-ACCOUNT-C1-001            in_progress
→ R2 Creator Portal              blocked
→ R3 Project lifecycle           blocked
→ R4 Electronics parity          blocked
→ Classroom / StudentSeat        blocked
→ Publication / learning cycle   blocked
→ additional modules             blocked
```

Точная следующая задача берётся из manifest. Не начинай её до owner review, полного gate и нормативного перехода текущей задачи.

## 9. Обязательный первый отчёт

До изменений выведи не более 25 строк:

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

После этого сразу выполняй текущую задачу, если нормативные источники согласованы. Не проси параметры merge, release tag или следующей ветки: они не нужны для текущего product slice.

## 10. Порты и runtime

```text
Web  127.0.0.1:4610
API  127.0.0.1:4611
E2E  127.0.0.1:4612
```

Запрещены:

```text
3000, 3100, 5173
```

Занятый порт означает `BLOCKED`. Не останавливай чужие процессы и контейнеры.

## 11. Проверки

Сначала focused tests текущего user flow. Полную матрицу запускай один раз после завершения реализации и UI.

Task gate:

```bash
python tools/run_task_tests.py --task TASK-ACCOUNT-C1-001
```

Общий минимум:

```bash
python tools/validate_infrastructure_focus.py
python tools/validate_project_map.py
python tools/validate_test_catalog.py
python tools/validate_delivery_program.py
pnpm format:check
pnpm lint
pnpm typecheck
pnpm boundaries:check
pnpm contracts:check
pnpm build
pnpm test
```

`PASS` существует только после реального exit `0`. `BLOCKED` и `NOT_RUN` указываются честно и не разрешают завершение задачи.

## 12. Git и публикация

- сохраняй отдельные логические commits;
- не переписывай опубликованную историю;
- не используй force-push;
- публикуй обычным fast-forward в `assistant/docker-linux-bootstrap`;
- PR №70 оставляй Draft/open;
- не merge и не меняй `main`;
- не коммить backups, dumps, credentials и owner-preview artifacts.

## 13. Stop condition

Остановись после:

1. завершённого Account C1 user flow;
2. focused tests PASS;
3. owner preview;
4. полной матрицы на одном итоговом SHA;
5. обновлённого UTF-8 отчёта в PR №70.

Следующую product task не начинай.
