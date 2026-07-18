# BOT_RUNBOOK — управление coding-агентами ASA Lab

Этот документ задаёт обязательный рабочий цикл для Codex и других coding-агентов. Агент не выбирает произвольную работу и не начинает следующую задачу до подтверждения exit gate текущей.

## 1. Источники истины

Порядок приоритета:

1. принятая ADR;
2. `AGENTS.md`;
3. `docs/project-map/project-map.yaml`;
4. GitHub Issue текущей задачи;
5. OpenAPI, JSON Schema, migrations и event contracts;
6. `docs/testing/test-catalog.yaml`;
7. остальные документы.

Конфликт не разрешается догадкой. Агент прекращает изменение, описывает конфликт и предлагает ADR или корректировку Issue.

## 2. Что делать сразу после clone

Агент сначала проводит ориентацию, а не пишет код.

```bash
git remote -v
git status --short --branch
git fetch --all --prune
git branch --all
```

После этого агент обязан определить состояние архитектурного PR №1.

- Пока PR №1 не объединён и Architecture CI не зелёный, Issue №2 остаётся `blocked`.
- В этом состоянии разрешены только проверка локальной копии, чтение документов и исправление архитектурного PR.
- Реализация Bootstrap, Classroom или Electronics запрещена.

## 3. Алгоритм выбора задачи

1. Прочитать `project.current_focus` и `execution_queue` в `project-map.yaml`.
2. Найти узел `kind: task` с минимальной позицией в очереди.
3. Проверить его статус.
4. Проверить все связи `depends_on`.
5. Открыть связанную GitHub Issue.
6. Убедиться, что в Issue есть результат, scope, запреты, критерии и команды проверки.
7. Если хотя бы одна зависимость не `done`, сообщить `BLOCKED` и не писать код.
8. Если задача `ready`, создать указанную task-ветку и перевести задачу в `in_progress` в том же PR.

Агент не может самовольно взять `planned`, `blocked` или более позднюю задачу.

## 4. Рабочий цикл одной задачи

```text
ORIENT
  → PLAN
  → IMPLEMENT
  → VERIFY
  → UPDATE MAP
  → OPEN DRAFT PR
  → REVIEW
  → MERGE
  → CLOSE TASK
  → UNBLOCK NEXT
```

### ORIENT

Прочитать обязательные документы, Issue, связанные ADR и test IDs.

### PLAN

До изменения кода вывести:

- task ID и Issue;
- зависимости и их статус;
- разрешённые файлы;
- запрещённый scope;
- контракты, данные и миграции;
- tenant/authz/audit impact;
- обязательные test IDs;
- план коммитов;
- критерий остановки.

### IMPLEMENT

Реализовать только один вертикальный срез. Нельзя параллельно добавлять последующие функции.

### VERIFY

Выполнить все тесты, обязательные для задачи и её фазы. Нельзя писать `PASS`, если команда не запускалась.

### UPDATE MAP

В том же PR:

- обновить статус task-узла;
- добавить новые реальные узлы и связи;
- обновить paths;
- обновить Mermaid/C4/Nx views при применимости;
- запустить `validate_project_map.py`.

### OPEN DRAFT PR

PR должен ссылаться на Issue, task ID, test IDs и содержать реальные результаты команд.

### CLOSE TASK

Статус `done` устанавливается только после merge и подтверждённого exit gate. После этого следующая задача может стать `ready`.

## 5. Стандартный отчёт агента

В конце каждой рабочей сессии агент обязан вывести:

```text
TASK: TASK-...
ISSUE: #...
STATUS: blocked | in_progress | in_review | done
BRANCH: ...
COMMITS: ...
FILES_CHANGED: ...
MAP_NODES_CHANGED: ...
TESTS_RUN:
  TST-... PASS|FAIL|NOT_RUN
BLOCKERS: ...
RESIDUAL_RISKS: ...
NEXT_ALLOWED_TASK: TASK-... | none
NEXT_COMMAND: точная команда следующему агенту
```

## 6. Команда ориентации для текущей локальной папки

Передайте агенту следующий текст:

```text
Работай только в текущей локальной копии репозитория spikeal8-maker/asa-lab.

Сначала ничего не реализуй. Проведи ORIENT-проход:
1. выполни git status --short --branch, git remote -v, git fetch --all --prune и git branch --all;
2. прочитай AGENTS.md, START_HERE_FOR_AI.md, docs/delivery/BOT_RUNBOOK.md, docs/project-map/TASK_SYSTEM.md, docs/project-map/project-map.yaml и docs/testing/test-catalog.yaml;
3. определи current_focus, первую задачу execution_queue и все её зависимости;
4. проверь, объединён ли PR #1 и зелёный ли Architecture CI;
5. выполни только доступные сейчас валидаторы;
6. не начинай Issue #2, пока PR #1 не merged и его обязательные checks не successful;
7. выведи стандартный отчёт BOT_RUNBOOK с NEXT_ALLOWED_TASK и точной NEXT_COMMAND.

Не изменяй файлы до завершения ориентации.
```

## 7. Команда запуска Bootstrap после разблокировки

Применяется только после merge PR №1 и зелёного Architecture CI:

```text
Работай в текущей локальной копии spikeal8-maker/asa-lab.
Синхронизируй main через git fetch --all --prune, git checkout main и git pull --ff-only.
Выполни только Issue #2 / TASK-BOOT-001 по BOT_RUNBOOK.
Создай ветку agent/task-boot-001-bootstrap.
Не реализуй пользователей, классы, StudentSeat, задания, биллинг или электронику.
Перед кодом выведи PLAN с обязательными test IDs.
После реализации выполни все проверки Issue #2 и test-catalog.yaml, обнови project-map.yaml и Nx graph, затем открой draft PR и выведи стандартный отчёт.
```

## 8. Правила регулирования владельцем проекта

Владелец проекта управляет разработкой через четыре операции:

1. изменить статус task-узла в `project-map.yaml`;
2. уточнить связанную GitHub Issue;
3. принять или отклонить Pull Request;
4. утвердить ADR при изменении архитектуры.

Нельзя регулировать работу только устной командой, не обновив Issue или карту. Иначе следующий агент получит устаревшую модель проекта.

## 9. Local-first verification (текущий режим)

Проект использует **local-first verification** до появления отдельной необходимости в managed CI.

Причина: GitHub-hosted runners недоступны из-за внешнего billing-blocker аккаунта (job не стартует, `steps_count = 0`, аннотация «The job was not started because recent account payments have failed or your spending limit needs to be increased»). Платный биллинг GitHub и self-hosted runner на текущем этапе не подключаются.

Правила текущего режима:

- обязательный quality gate задачи — это её тесты из `docs/testing/test-catalog.yaml`, фактически выполненные локально;
- GitHub Actions не является обязательным exit gate; его результат считается информационным;
- ни один валидатор не отключается и критерии `PASS` не ослабляются;
- `NOT_RUN` и `BLOCKED` не считаются `PASS` и не позволяют закрыть gate;
- фактические результаты (с commit SHA) публикуются в связанном Pull Request и Issue.

### Единая команда запуска тестов задачи

Все обязательные тесты текущей задачи запускаются одной командой через раннер `tools/run_task_tests.py`, который читает `docs/testing/test-catalog.yaml`:

```bash
python tools/run_task_tests.py --task TASK-CI-001
```

Раннер выбирает тесты, у которых `required_for` содержит указанную задачу, реально выполняет их команды и печатает отчёт, привязанный к commit SHA. Код возврата `0` только если все обязательные тесты имеют фактический `PASS`.

### Локальный fallback-процесс

Когда managed CI недоступен, разработчик или агент обязан перед push выполнить локально:

```bash
python -m compileall -q tools
python tools/run_task_tests.py --task <TASK-ID>
```

Push и отчёт в PR допускаются только после фактического `GATE: PASS`. Возврат к managed CI (self-hosted или иному) оформляется отдельным решением владельца и обновлением этого документа.
