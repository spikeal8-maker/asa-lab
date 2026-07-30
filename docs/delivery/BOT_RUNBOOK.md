# BOT_RUNBOOK — рабочий процесс coding-агента ASA Lab

## 1. Назначение

Coding-агент реализует только одну текущую product task, сохраняет данные и существующий функционал, доказывает результат тестами и останавливается для owner review.

Короткая команда владельца:

```text
Работай в spikeal8-maker/asa-lab. Прочитай AGENTS.md, infrastructure focus, current_focus, соответствующий entry в EXECUTION_MANIFEST.yaml и GitHub Issue. Выполни только текущую задачу в существующей канонической линии. Следующую задачу не начинай.
```

Владелец не обязан пересказывать полный scope вручную.

## 2. Источники выполнения

Порядок чтения:

```text
AGENTS.md
→ docs/project-map/infrastructure-focus.yaml
→ docs/project-map/project-map.yaml
→ docs/delivery/EXECUTION_MANIFEST.yaml
→ GitHub Issue текущей задачи
→ docs/testing/test-catalog.yaml
→ manifest read-links
```

Дополнительные представления:

```text
README.md
START_HERE_FOR_AI.md
docs/delivery/DEVELOPMENT_PROGRAM_V1.md
docs/project-map/PROJECT_MAP.md
docs/project-map/QUALITY_MAP.md
```

Конфликт не разрешается догадкой. Чат не заменяет task ID, Issue, branch, dependencies, scope, ports и exit gate. Нормативный переход должен быть опубликован в репозитории.

## 3. ORIENT

```bash
git remote -v
git status --short --branch
git fetch --all --prune
git rev-parse HEAD
git branch --all
```

После этого:

1. прочитать `AGENTS.md`;
2. проверить `infrastructure-focus.yaml`;
3. если infrastructure focus активен — выполнять только infrastructure manifest;
4. если focus terminal/inactive — проверить `python tools/validate_infrastructure_focus.py`;
5. прочитать `project.current_focus`;
6. найти тот же task в `EXECUTION_MANIFEST.yaml`;
7. проверить status, `depends_on`, Issue и branch;
8. получить test IDs из manifest и `test-catalog.yaml`;
9. проверить Port Policy;
10. продолжить существующую каноническую линию.

Не создавай новую ветку автоматически. Ветка создаётся только когда manifest прямо требует новую линию и владелец не зафиксировал продолжение существующей.

## 4. Текущий repository state

Принятый технический Alpha-baseline:

```text
7afebdcf9441b027092ce17a37f1f89950af99c6
```

Текущая линия:

```text
branch: assistant/docker-linux-bootstrap
PR: #70 Draft
```

`main` пока содержит более старый baseline. До отдельного convergence decision запрещено:

- переключать текущую разработку на `main`;
- создавать ещё одну product branch;
- merge;
- release tag;
- закрытие/удаление старых PR и веток;
- destructive cleanup.

## 5. Текущая задача

```text
TASK-ACCOUNT-C1-001
Issue #48
status: in_progress
```

Уже существует и не реализуется повторно:

- public entry;
- adult registration;
- Account / Profile / Principal;
- Personal Workspace;
- sessions_v2;
- login по email/username;
- current-session logout;
- legacy teacher bridge;
- principal-aware project ownership;
- Electronics, Chess и Chess Online projects.

Оставшийся scope:

- educator self-attestation;
- provisional audited educator grant;
- workspace list и безопасное ActiveContext switching;
- account menu/profile;
- email verification state display;
- active sessions list;
- revoke one/all other sessions;
- Account C1 Chromium E2E;
- regression сохранности существующего педагога и проектов.

## 6. CAPABILITY CHECK и PLAN

До кода вывести максимум 25 строк:

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

Не запрашивать merge target, tag или имя следующей ветки: для текущего slice они не нужны.

## 7. Scope freeze

После начала task разрешены только:

- domain/application изменения текущего user flow;
- additive migration;
- repository/API/UI текущего flow;
- security, RLS и compatibility fixes;
- focused tests, E2E и evidence;
- review feedback текущего PR.

Запрещены:

- следующая capability;
- Electronics/Chess expansion;
- StudentSeat, publication, assignments и admin;
- unrelated refactoring;
- второй Account/Principal/Workspace/Session model;
- изменение применённой migration `0010`;
- ослабление tests, RLS, contracts и validation.

## 8. IMPLEMENT

Один task реализует один вертикальный user flow:

```text
domain/application
→ additive migration/repository
→ API
→ UI
→ focused tests
→ real browser E2E
→ evidence/maps
```

Если реализация уже существует, расширять её. Переписывание с нуля требует доказанного технического blocker.

## 9. Порты

```text
Web  127.0.0.1:4610
API  127.0.0.1:4611
E2E  127.0.0.1:4612
```

Запрещены `3000`, `3100`, `5173`.

При занятом порте:

- не завершать чужой процесс;
- не выбирать другой порт молча;
- сообщить `BLOCKED` с владельцем процесса;
- остановить только текущий запуск.

## 10. VERIFY

Во время реализации запускать focused tests. Полную матрицу запускать один раз после завершения UI и focused PASS.

Task gate:

```bash
python tools/run_task_tests.py --task TASK-ACCOUNT-C1-001
```

Обязательный общий минимум:

```bash
python tools/validate_infrastructure_focus.py
python tools/validate_project_map.py
python tools/validate_test_catalog.py
python tools/validate_delivery_program.py
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm boundaries:check
pnpm contracts:check
pnpm build
pnpm test
```

Для tenant data обязательны:

- isolated `*_test` database;
- migration empty/existing/repeat checks;
- runtime DB role;
- RLS negative matrix;
- cross-account/workspace denial;
- отсутствие admin credentials в Web/API runtime.

Для UI обязательны:

- keyboard/focus/accessibility;
- Playwright без mock API;
- browser failure collector;
- screenshots owner-review surfaces.

Статусы:

- `PASS` — реальный exit `0`;
- `FAIL` — выполненная команда вернула non-zero;
- `BLOCKED` — обязательная среда/runner отсутствует;
- `NOT_RUN` — команда не запускалась.

`BLOCKED` и `NOT_RUN` не закрывают gate.

## 11. GitHub Actions

Workflow должен запускаться для `main`, `agent/**` и `assistant/**`.

Если job завершился до первого шага, список steps пуст и logs отсутствуют:

- не объявлять validator/code FAIL;
- зафиксировать external Actions runner/configuration blocker;
- проверить repository Actions settings, hosted-runner availability и spending/usage limit;
- локальный полный gate остаётся обязательным;
- CI не считается PASS до реального выполнения steps.

## 12. MAPS и документы

При изменении product code:

- task status и current focus остаются фактическими;
- `project-map.yaml` и `PROJECT_MAP.md` синхронизированы;
- `QUALITY_MAP.md` и test catalog содержат реальный gate;
- `nx-project-graph.json` обновляется при изменении code structure;
- README/START_HERE не должны показывать старую очередь.

Test ID нельзя регистрировать как выполненный, если его команда ещё не существует. До реализации команда должна честно давать `BLOCKED`, а не ложный PASS.

## 13. Commits и push

Разделять изменения:

```text
feat(account): ...
feat(session): ...
test(account): ...
docs(account): ...
```

Запрещены:

- force-push;
- rewrite опубликованной истории;
- массовое несвязанное форматирование;
- commit backup/dump/credential;
- merge и изменение main.

Публикация:

```bash
git push origin HEAD:assistant/docker-linux-bootstrap
```

Обычный fast-forward обязателен.

## 14. Draft PR

PR №70 остаётся Draft. Body содержит:

- current head и accepted runtime baseline;
- текущий task/Issue;
- already implemented и remaining scope;
- API/data/security impact;
- migrations;
- test IDs и реальные статусы;
- browser counters и screenshots;
- rollout/rollback;
- residual risks;
- отдельный historical Docker PASS section.

Нельзя переносить PASS старого SHA на новый product head.

## 15. Каноническая очередь

```text
TASK-PRODUCT-DOC-001       done
→ TASK-PORTAL-001          done
→ TASK-ACCOUNT-C1-001      in_progress
→ R2 Creator Portal        blocked
→ R3 Project lifecycle     blocked
→ R4 Electronics parity    blocked
→ Classroom / StudentSeat  blocked
→ Publication / learning   blocked
→ Additional modules       blocked
```

Старые Electronics/Checkers task IDs сохраняются только для traceability и не обходят R1–R4 порядок.

## 16. Stop condition

Остановиться после:

1. завершённого текущего user flow;
2. focused PASS;
3. owner preview;
4. полной матрицы на одном итоговом SHA;
5. обновлённого UTF-8 отчёта;
6. PR остаётся Draft/open.

Следующую task не начинать в той же сессии.
