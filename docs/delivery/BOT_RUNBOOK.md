# BOT_RUNBOOK — рабочий процесс coding-агента ASA Lab

## 1. Короткая команда владельца

### Во время R0

```text
Работай в spikeal8-maker/asa-lab. Прочитай AGENTS.md, docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml, Issue №36 и PR №43. Выполни только текущую R0 работу. Product code и R1 не начинай.
```

### После активации R0–R10

```text
Работай в spikeal8-maker/asa-lab. Прочитай AGENTS.md и active release в docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml. Открой указанную Issue и выполни только её. Следующий release не начинай.
```

Владелец не пересказывает ТЗ вручную.

## 2. Источники выполнения

```text
ASA_TARGET_PLATFORM_BLUEPRINT       целевая продуктовая модель
ASA_TARGET_PLATFORM_EXECUTION_PLAN  R0–R10, branches, Issues, owner stops
TINKERCAD parity/evidence contracts reference behavior и deviations
AGENTS.md                            обязательные архитектурные правила
EXECUTION_MANIFEST.yaml             принятая v1 foundation/legacy traceability
project-map.yaml                     динамическая карта после activation
GitHub Issue                         scope одного user flow
TEST catalog                         команды обязательных test IDs
```

Пока target execution plan имеет `status: owner_review_required` и `current_gate: R0`, старые future tasks v1 не запускаются.

Конфликт не разрешается догадкой. Чат не меняет release/task, dependency, branch, scope, port, test ID, owner stop или exit gate.

## 3. ORIENT

```bash
git remote -v
git status --short --branch
git fetch --all --prune
git branch --all
```

### R0 ORIENT

1. прочитать `AGENTS.md`;
2. прочитать `ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml`;
3. подтвердить `current_gate: R0`;
4. открыть Issue №36 и PR №43;
5. проверить R0 candidate roles;
6. выполнять только contract/evidence/validator/convergence work;
7. product code не менять.

### После R0

1. прочитать active release;
2. проверить status, `depends_on`, previous owner stop;
3. открыть release Issue;
4. продолжить canonical branch/PR либо создать её от accepted baseline;
5. прочитать только профильные contracts;
6. получить exact tests из Issue/test catalog;
7. проверить Port Policy.

Работа разрешена только с current release или существующим PR этого release. `planned`, `blocked`, `done`, `deprecated` и `superseded` не выполняются.

## 4. R0 convergence

```text
PR #34          Electronics/Project foundation review
PR #43          normative target contract candidate
PR #35/#45/#47 transfer-only
PR #59/#60     frozen competing R1 candidates
```

Разрешённый порядок:

```text
owner review #34
→ owner decisions #43
→ rebase/validate/merge #43
→ one P1 integration PR
→ close #35/#45/#47 after transfer proof
→ select #59 OR #60
→ rebase selected R1 once
```

Не создавать новую product branch до R0 exit gate.

## 5. CHECK и PLAN

До изменения файлов:

```text
RELEASE:
TASK:
ISSUE:
MILESTONE:
CAPABILITIES:
DEPENDENCIES:
USER_FLOW:
NON_GOALS:
PORTS:
OWNER_STOP:
PLAN: максимум 25 строк
STOP_CRITERION:
```

## 6. Scope freeze

После начала release разрешены только defect/security/contract/additive-migration/test fixes текущего flow и review feedback текущего PR.

Запрещены:

- следующая capability/release;
- дополнительные роли/страницы;
- unrelated refactoring;
- новый framework без ADR;
- premature Docker/Redis/MinIO/workers/object storage;
- destructive migration;
- изменение портов;
- второй competing PR.

## 7. IMPLEMENT

Один release slice реализует один наблюдаемый user flow:

```text
domain/application
→ additive migration/repository
→ API/contracts
→ UI
→ automated E2E
→ evidence/maps
→ owner stop
```

Если существует полезный PR, сохранять и конвергировать его. Переписывание с нуля требует доказанного blocker. Transfer-only PR не сливается в `main` самостоятельно.

## 8. Identity/Workspace rules

После target activation:

- Account, Principal, Workspace, capability и membership различаются;
- Personal Workspace exactly one per Account, backed by tenant boundary в первой версии;
- educator — capability Account, не отдельный Account type;
- `school_admin` scoped, `platform_admin` global;
- Account session и StudentSeat session различаются;
- current teacher/classes/projects/Electronics сохраняются additive migration;
- client role/tenant/workspace не доверяются;
- RLS не отключается.

## 9. Project/Module rules

- Personal Project не требует Classroom.
- Project owner — Principal.
- ProjectDraft mutable/optimistic; ProjectVersion immutable/digested.
- Publication и Submission ссылаются на точную ProjectVersion.
- Module Registry/Provider является единственным подключением subject logic.
- Core не содержит subject switch.
- Remix создаёт новый Project и lineage.

## 10. Порты

```text
Web  127.0.0.1:4610
API  127.0.0.1:4611
E2E  127.0.0.1:4612
```

Запрещены `3000`, `3100`, `5173`. При занятом порте:

- не kill процесс;
- не выбирать другой порт молча;
- вывести точный `BLOCKED`;
- остановить текущий запуск.

## 11. Промежуточные owner milestones

После завершённого внутреннего результата:

```text
MILESTONE:
STATUS: completed | blocked
VISIBLE_RESULT:
TESTS:
DEMO_URLS:
SCREENSHOTS:
BLOCKERS:
OWNER_REVIEW_REQUIRED:
NEXT_INTERNAL_MILESTONE:
```

Checkpoint не меняет scope и не разблокирует следующий release.

## 12. VERIFY

### R0

```bash
python tools/validate_tinkercad_parity.py
python tools/validate_target_execution.py
python tools/validate_architecture.py
python tools/validate_project_map.py
python tools/validate_test_catalog.py
```

### Product release

Использовать exact test IDs текущей Issue/test catalog. Если активный contract ещё сохраняет v1 TASK-ID, разрешён runner:

```bash
python tools/run_task_tests.py --task <TASK-ID>
```

- PASS — фактический exit 0;
- FAIL — фактический non-zero;
- BLOCKED — обязательная среда отсутствует;
- NOT_RUN — команда не запускалась.

`BLOCKED`/`NOT_RUN` не закрывают gate. Нельзя удалять test ID или заменять automated E2E ручным просмотром.

Для UI обязательны keyboard/focus/accessibility, Playwright и screenshots. Tests не заменяют owner visual/product acceptance.

## 13. UPDATE MAPS

### При начале

- current release/task → `in_progress`;
- реальные implementation nodes → `in_progress`;
- current gate/focus остаётся текущим.

### В Draft PR

- current release/task → `in_review`;
- Project/Quality maps и test catalog отражают exact gate;
- Nx graph регенерирован при structural code changes;
- next release остаётся `blocked`.

### После merge

- current release/task → `done`;
- next → `ready` только после dependencies и owner stop;
- current gate/focus → next;
- Issues/maps/validators синхронизированы;
- агент останавливается.

## 14. DRAFT PR

Один release — один owner-facing Draft PR. Body содержит:

- Release/Issue/Milestone;
- visible result и user flow;
- non-goals;
- API/data/security impact;
- additive migrations and rollback;
- ports;
- map/Nx changes;
- exact tests и реальные статусы;
- demo URLs;
- desktop/mobile screenshots;
- residual risks;
- owner stop;
- `NEXT_ALLOWED_TASK`.

Draft разрешён с честными FAIL/BLOCKED/NOT_RUN. Ready/merge требуют полного automated gate и owner acceptance.

## 15. MERGE

После review:

1. merge release PR;
2. синхронизировать `main`;
3. выполнить map-only transition;
4. закрыть Issue completed;
5. закрыть transfer-only/superseded branches после доказанного переноса;
6. разблокировать только следующий release;
7. остановиться.

Следующий release не реализуется в той же сессии.

## 16. Финальный отчёт

```text
MILESTONE:
RELEASE:
TASK:
ISSUE:
STATUS:
VISIBLE_RESULT:
USER_FLOW:
  ... PASS|FAIL|BLOCKED
PORTS:
BRANCH:
COMMITS:
FILES_CHANGED:
MAP_NODES_CHANGED:
TESTS_RUN:
ARTIFACTS:
DEMO_URLS:
SCREENSHOTS:
BLOCKERS:
RESIDUAL_RISKS:
WORKING_TREE:
OWNER_STOP:
NEXT_ALLOWED_TASK:
NEXT_COMMAND:
```

Отчёт начинается с видимого результата, не с установленных инструментов.

## 17. Каноническая target очередь

```text
R0  Contract and one accepted baseline
R1  Account / Personal Workspace / Sessions / Educator Grant
R2  Creator Home / Portal shell
R3  Module Registry / Project Hub / Editor Host
R4  Electronics parity
R5  Classroom / StudentSeat / Safe Mode
R6  Learner portfolio / teacher Project Viewer
R7  Sharing / publication / Remix
R8  Profiles / Explore / moderation
R9  Assignments / submissions / review / grades / badges
R10 Multi-module proof / measured operations scale
```

Очередь изменяется только owner-approved нормативным PR с синхронной правкой machine-readable plan, Issues, maps и validators.
