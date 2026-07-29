# START_HERE_FOR_AI — вход coding-агента в ASA Lab

## Миссия

ASA Lab — единая Tinkercad-подобная образовательная платформа на собственном коде и ассетах:

```text
Account / Principal / Workspace
→ Creator Home / Projects
→ Module Registry / Editor Host
→ Electronics and future modules
→ Classroom / StudentSeat
→ immutable versions / publication / remix
→ learner portfolio / teacher viewer
→ assignments / submissions / review / grades / badges
```

## Критический текущий статус

Ветка PR №43 содержит кандидат новой целевой программы. Пока она не принята владельцем:

```text
current gate = R0
product coding = forbidden
allowed work = contract / evidence / validators / branch convergence
```

Главные файлы R0:

```text
AGENTS.md
docs/product/ASA_TARGET_PLATFORM_BLUEPRINT.md
docs/product/ASA_TARGET_PLATFORM_BLUEPRINT.yaml
docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.md
docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml
docs/delivery/R0_OWNER_DECISION.md
Issue #36
PR #43
```

Старый `docs/delivery/EXECUTION_MANIFEST.yaml` остаётся принятой v1 foundation/traceability, но его future task `TASK-PROJECT-SHELL-001` superseded и во время R0 не запускается.

## Не выбирай задачу самостоятельно

### Пока target plan ожидает owner approval

1. прочитай `AGENTS.md`;
2. прочитай `current_gate` в `ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml`;
3. если `R0` — работай только с Issue №36 / PR №43;
4. не пиши product code;
5. не продолжай PR №34/№35/№45/№47/№59/№60 без явно разрешённого R0 действия;
6. при конфликте старой карты с R0 остановись и сообщи конфликт.

### После owner approval и merge R0

1. прочитай активный release в target execution plan;
2. проверь `depends_on`, status и предыдущий owner stop;
3. открой указанную Issue;
4. используй только canonical branch;
5. реализуй один наблюдаемый user flow;
6. следующую задачу не начинай.

Чат не меняет release/task, dependency, branch, scope, port, test gate или owner stop.

## Первые команды

```bash
git remote -v
git status --short --branch
git fetch --all --prune
git branch --all
```

После этого выведи:

```text
RELEASE:
TASK:
ISSUE:
STATUS:
DEPENDENCIES:
USER_FLOW:
NON_GOALS:
PORTS:
OWNER_STOP:
PLAN: максимум 25 строк
STOP_CRITERION:
```

## R0 convergence

```text
PR #34          foundation review only
PR #43          target contract candidate
PR #35/#45/#47 transfer-only
PR #59/#60     frozen competing R1 candidates
```

Разрешённый порядок находится в `r0_convergence.ordered_actions` machine-readable plan.

Запрещено:

- merge transfer-only PR напрямую в `main`;
- продолжать PR №59 и №60 одновременно;
- создавать третью identity/portal/editor implementation;
- destructive migration;
- отключать RLS;
- начинать R1 до owner decision и R0 merge.

## Очередь после активации target plan

```text
R0  Contract and one accepted baseline
R1  Account / Personal Workspace / Sessions / Educator Grant
R2  Creator Home and Portal shell
R3  Module Registry / Project Hub / Editor Host
R4  Electronics parity
R5  Classroom / StudentSeat / Safe Mode
R6  Learner portfolio / teacher Project Viewer
R7  Sharing / publication / Remix
R8  Profiles / Explore / moderation
R9  Assignments / submissions / review / grades / badges
R10 Multi-module proof and measured operations scale
```

Каждый release имеет owner stop. Следующий не начинается автоматически.

## Порты

```text
Web  127.0.0.1:4610
API  127.0.0.1:4611
E2E  127.0.0.1:4612
```

Запрещены `3000`, `3100`, `5173`. Занятый порт даёт `BLOCKED`; чужой процесс не останавливать.

## Рабочий цикл

```text
ORIENT
→ active contract / Issue check
→ PLAN
→ IMPLEMENT one vertical flow
→ VERIFY exact tests
→ UPDATE maps / Nx graph
→ Draft PR
→ live evidence
→ owner review / stop
→ merge
→ mandatory map transition
→ next release only ready
→ stop
```

## Проверки R0

```bash
python tools/validate_tinkercad_parity.py
python tools/validate_target_execution.py
python tools/validate_architecture.py
python tools/validate_project_map.py
python tools/validate_test_catalog.py
```

После R0 test IDs берутся только из текущей Issue и `docs/testing/test-catalog.yaml`.

`PASS` существует только после фактического exit 0. `BLOCKED` и `NOT_RUN` не разрешают merge. Test count не заменяет owner visual/product acceptance.

## Map transition

После merge обязательно:

- release/task → `done`;
- next → `ready` только после dependencies и owner stop;
- current gate/focus → next;
- Project Map, Quality Map, Issues и Nx graph синхронизированы;
- validators PASS;
- агент останавливается.

## Команда владельца во время R0

```text
Работай в spikeal8-maker/asa-lab. Прочитай AGENTS.md, docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml, Issue №36 и PR №43. Выполни только текущую R0 работу. Product code и R1 не начинай.
```

## Команда владельца после R0

```text
Работай в spikeal8-maker/asa-lab. Прочитай AGENTS.md и active release в docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml. Открой указанную Issue и выполни только её. Следующий release не начинай.
```
