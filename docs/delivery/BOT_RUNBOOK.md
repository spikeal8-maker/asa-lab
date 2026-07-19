# BOT_RUNBOOK — управление coding-агентами ASA Lab

Этот документ задаёт обязательный рабочий цикл для Codex и других coding-агентов. Агент не выбирает произвольную работу, не переопределяет продукт через чат и не начинает следующую задачу до подтверждения exit gate текущей.

## 1. Источники истины

Порядок приоритета:

1. более поздняя принятая ADR;
2. `AGENTS.md`;
3. `docs/product/PRODUCT_BLUEPRINT.md`;
4. `docs/product/CAPABILITY_MAP.yaml`;
5. детальная продуктовая спецификация затронутого контура;
6. `docs/architecture/ARCHITECTURE_BASELINE.md` и профильные архитектурные документы;
7. OpenAPI, JSON Schema, migrations и event contracts;
8. `docs/project-map/project-map.yaml`;
9. GitHub Issue текущей задачи;
10. `docs/testing/test-catalog.yaml`;
11. остальные документы.

Конфликт не разрешается догадкой. Агент прекращает изменения и описывает точное противоречие. Сообщение в чате может уточнять выполнение, но не меняет молча capability, release boundary, Issue scope, архитектурный baseline или критерий готовности.

## 2. Что делать сразу после clone или новой сессии

```bash
git remote -v
git status --short --branch
git fetch --all --prune
git branch --all
```

Затем агент обязан:

1. определить `project.current_focus`;
2. найти первую активную задачу в `execution_queue`;
3. проверить статус задачи и все `depends_on`;
4. открыть связанную GitHub Issue;
5. прочитать Product Blueprint;
6. найти capability IDs Issue в Capability Map;
7. проверить зависимости capabilities;
8. прочитать профильную продуктовую спецификацию;
9. прочитать связанные ADR, contracts и test IDs;
10. убедиться, что локальная ветка создана от актуального `main`.

## 3. Алгоритм выбора задачи

1. `current_focus` имеет приоритет.
2. Задача должна иметь `kind: task` и статус `ready`, `in_progress` или `in_review` для продолжения уже начатой работы.
3. Задачи `done`, `deprecated`, `planned` и `blocked` не берутся в работу.
4. Все зависимости `depends_on` должны иметь статус `done`.
5. Продуктовая Issue обязана перечислять `CAPABILITIES`.
6. Capability dependencies должны быть покрыты завершёнными задачами или входить в явно утверждённый вертикальный slice.
7. Issue должна содержать наблюдаемый user flow, scope, non-goals, acceptance criteria и test IDs.
8. Если условия не выполнены, агент сообщает `BLOCKED` и не пишет код.

## 4. Статусы и Pull Requests

- `ready` — задача нормативно подготовлена и зависимости завершены.
- `in_progress` — один агент реализует задачу.
- `in_review` — открыт Pull Request.
- `done` — PR merged и exit gate подтверждён.
- `deprecated` — задача сохранена только для истории.

Draft PR разрешён при честно документированных `PASS`, `FAIL`, `BLOCKED` и `NOT_RUN`. Ready for review и merge требуют выполнения exit gate: все обязательные test IDs имеют фактический `PASS`.

`BLOCKED` никогда не считается `PASS`. Нельзя переносить обязательный тест другой задаче только ради зелёного отчёта без изменения Product/Project/Quality maps и Issue.

## 5. Рабочий цикл одной задачи

```text
ORIENT
→ CAPABILITY CHECK
→ PLAN
→ IMPLEMENT
→ VERIFY
→ UPDATE PRODUCT/PROJECT/QUALITY MAPS
→ OPEN DRAFT PR
→ REVIEW
→ MERGE
→ CLOSE TASK
→ UNBLOCK NEXT
```

### ORIENT

Определить repository state, task, Issue, capabilities, зависимости и normative documents.

### CAPABILITY CHECK

До изменения кода агент выводит:

```text
CAPABILITIES:
- CAP-...

DEPENDENCIES:
- CAP-... done|included|blocked

USER_FLOW:
...

NON_GOALS:
...
```

Если Issue и Capability Map противоречат друг другу, работа останавливается.

### PLAN

План до 25 строк для обычного вертикального slice. Он содержит:

- task ID и Issue;
- capability IDs;
- наблюдаемый user flow;
- bounded contexts;
- разрешённые файлы;
- non-goals;
- tenant/authz/audit boundaries;
- API/schema/migration impact;
- UX states;
- обязательные test IDs;
- план коммитов;
- критерий остановки.

План не должен превращаться в отдельный многодневный проект по инфраструктуре, если инфраструктура не является пользовательским блокером текущей Issue.

### IMPLEMENT

Реализуется один вертикальный пользовательский slice. Нельзя:

- параллельно начинать следующую capability;
- добавлять лишние роли и страницы;
- переписывать CI или deployment без связи с user flow;
- делать инфраструктурную полировку вместо продукта;
- размещать предметную логику в Classroom Core;
- обходить принятый technological baseline без ADR.

### VERIFY

Выполняются все test IDs текущей задачи. `PASS` записывается только после фактического запуска команды.

Для продуктового slice обязательны по применимости:

- unit;
- contracts;
- PostgreSQL integration;
- tenant/authz/RLS negative tests;
- automated browser E2E;
- accessibility critical path;
- security and secret checks;
- production build.

Manual browser smoke не заменяет automated E2E, если E2E указан в Issue.

### UPDATE MAPS

В том же PR обновляются при необходимости:

- `docs/product/CAPABILITY_MAP.yaml` — только если меняется capability или release slice;
- `docs/project-map/project-map.yaml` — task/status/dependencies/architecture nodes;
- `docs/project-map/PROJECT_MAP.md`;
- `docs/project-map/QUALITY_MAP.md`;
- `docs/testing/test-catalog.yaml`;
- C4 и Nx graph при архитектурных/кодовых изменениях.

Если scope не менялся, Capability Map не редактируется ради косметики.

### OPEN DRAFT PR

PR обязан ссылаться на:

- GitHub Issue;
- TASK-ID;
- capability IDs;
- user flow;
- non-goals;
- affected contexts;
- data/API/events;
- tenant/authz/audit impact;
- test IDs и фактические результаты;
- screenshots/Playwright report для UI;
- rollout/rollback;
- map changes;
- NEXT_ALLOWED_TASK.

### CLOSE TASK

После merge:

1. TASK → `done`;
2. документируется merge SHA;
3. следующая задача становится `ready`, если все зависимости завершены;
4. `current_focus` переносится на следующую задачу;
5. Issue закрывается как completed.

## 6. Стандартный отчёт агента

```text
TASK: TASK-...
ISSUE: #...
STATUS: blocked | in_progress | in_review | done
CAPABILITIES: CAP-..., CAP-...
USER_FLOW:
  ... PASS|FAIL|BLOCKED
BRANCH: ...
COMMITS: ...
FILES_CHANGED: ...
MAP_NODES_CHANGED: ...
TESTS_RUN:
  TST-... PASS|FAIL|NOT_RUN|BLOCKED
ARTIFACTS: ...
BLOCKERS: ...
RESIDUAL_RISKS: ...
NEXT_ALLOWED_TASK: TASK-... | none
NEXT_COMMAND: точная короткая команда следующему агенту
```

Отчёт начинается с пользовательского результата, а не с перечня установленных инструментов.

## 7. Управление владельцем проекта

Владелец управляет направлением через:

1. Product Blueprint и Capability Map;
2. Project Map и статус задачи;
3. GitHub Issue;
4. принятие/отклонение PR;
5. ADR при изменении архитектуры.

Нельзя регулировать разработку только устным сообщением, если оно меняет scope. Сначала обновляются нормативные документы и Issue, затем агент продолжает работу.

## 8. Local-first verification

Проект использует local-first verification, пока managed CI недоступен.

```bash
python -m compileall -q tools
python tools/run_task_tests.py --task <TASK-ID>
```

Правила:

- test runner читает `docs/testing/test-catalog.yaml`;
- GitHub Actions пока информационен;
- критерии `PASS` не ослабляются;
- `NOT_RUN` и `BLOCKED` не закрывают exit gate;
- отчёт привязан к commit SHA;
- рабочее дерево должно быть чистым на финальном прогоне;
- результаты публикуются в PR и Issue.

## 9. Ограничение токенов и времени

Агент обязан сохранять фокус на пользовательском результате.

Запрещено без отдельной Issue:

- бесконечно совершенствовать локальные установщики;
- добавлять проверки, не связанные с текущим риском;
- переписывать уже зелёную инфраструктуру;
- создавать новые задачи, чтобы избежать реализации user flow;
- повторять полную диагностику после каждого локального сбоя.

При тестовом сбое:

1. остановить параллельные прогоны;
2. назвать одну наблюдаемую причину;
3. исправить её;
4. повторить соответствующий тест;
5. вернуться к основному user flow.

## 10. Текущая каноническая последовательность

Источник истины — `project-map.yaml`, но продуктовая логика следующая:

```text
Product Blueprint and Capability Map
→ Teacher Portal
→ StudentSeat and Child Dashboard
→ Module Registry and Universal Projects
→ Assignment and Immutable Submission
→ Review Comments Assessment Rewards
→ First Electronics Learning Cycle
→ Simulation Arduino Instruments
→ Additional Modules
```

Следующая задача не начинается до merge и exit gate предыдущей.
