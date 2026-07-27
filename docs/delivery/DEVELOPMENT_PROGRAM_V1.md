# ASA Lab — Development Program v1

**Статус:** каноническая программа Product Alpha и первого School Pilot.  
**Машиночитаемый контракт:** [`EXECUTION_MANIFEST.yaml`](EXECUTION_MANIFEST.yaml).  
**Epic:** [Issue №23](https://github.com/spikeal8-maker/asa-lab/issues/23).  
**Порты:** [`LOCAL_PORT_POLICY.md`](LOCAL_PORT_POLICY.md).  
**Продукт:** [`../product/PRODUCT_BLUEPRINT.md`](../product/PRODUCT_BLUEPRINT.md).

## 1. Назначение

Этот документ отвечает на вопрос:

> Как из текущего репозитория последовательно получить работающий сайт, универсальные проекты, два независимых учебных модуля и полный школьный цикл электроники.

Статические task metadata, точная очередь, branches, dependencies, test profiles и map nodes хранятся в `EXECUTION_MANIFEST.yaml`. Этот Markdown объясняет путь человеку.

Владелец выдаёт одну команду:

```text
Прочитай current_focus и соответствующий entry в EXECUTION_MANIFEST.yaml. Открой указанную Issue и выполни только её.
```

## 2. Delivery stage и architecture horizon

Это разные понятия:

- **delivery stage** — строгий порядок, в котором бот выполняет задачи;
- **architecture horizon** — архитектурный контур, к которому относится результат.

Technical Alpha намеренно доказывает Electronics Project Slice (Project Shell внутри него) раньше полного StudentSeat/Assignment workflow. Поэтому architecture horizon может быть не монотонным. Это не конфликт и не разрешение перескакивать очередь.

Единственный execution order:

```text
TASK-PRODUCT-DOC-001
→ TASK-PORTAL-001
→ TASK-PROJECT-SHELL-001
→ TASK-CHECKERS-LITE-001
→ TASK-ELECTRONICS-ALPHA-001
→ TASK-SEAT-001
→ TASK-ACT-001
→ TASK-REVIEW-001
→ TASK-ELEC-001
```

## 3. Конечный результат v1

```text
teacher login
→ classroom
→ universal project
→ Checkers Lite and Electronics Alpha
→ child login without email
→ assignment
→ immutable submission
→ anchored comment and revision
→ grade and badge
→ complete Electronics classroom cycle
```

Главный инвариант:

> Один Classroom Core, один Project lifecycle, один Submission/Review lifecycle — множество независимых subject modules.

Classroom/Project Core не знает types резисторов, шашечных фигур, Scratch blocks или 3D objects.

## 4. Два delivery tracks

### Technical Product Alpha

```text
Teacher Portal
→ Electronics Project Slice
→ Checkers Lite reference module
→ Electronics Alpha
```

После Alpha педагог может войти, создать класс, создать/сохранить проект и использовать два модуля. Electronics — приоритетный предметный результат; Checkers Lite — маленькое доказательство Module SDK.

### School Pilot

```text
StudentSeat
→ Assignment and Immutable Submission
→ Comments Review Grade Badge
→ Full Electronics Classroom Cycle
```

После Pilot школа проводит полный урок от выдачи детского доступа до оценки электронной работы.

## 5. Общие правила

### Одна Issue — один flow

Нельзя смешивать текущий flow, следующую capability, инфраструктурный redesign, unrelated refactoring и будущие роли/страницы.

### Одна задача — одна branch — один PR

```text
ready
→ in_progress
→ Draft PR / in_review
→ full gate
→ merge
→ map transition
→ done
→ next ready
→ stop
```

### Scope freeze

После `in_progress` разрешены только defects/security/contracts/migrations/tests текущего flow и review feedback. Новая идея создаёт будущую Issue после merge.

### Пользовательская ценность

Нельзя останавливать product flow ради Docker, CI, Kubernetes, Redis/MinIO, deployment или scale design, если текущая Issue это не использует.

### Порты

```text
Web  127.0.0.1:4610
API  127.0.0.1:4611
E2E  127.0.0.1:4612
```

Запрещены `3000`, `3100`, `5173`. Занятый порт даёт `BLOCKED`; чужой процесс не завершается.

### Чтение

Агент читает:

1. `AGENTS.md`;
2. current task entry из `EXECUTION_MANIFEST.yaml`;
3. текущую Issue;
4. только `read` links из manifest;
5. test catalog entries текущей задачи.

Перечитывать всю документацию на каждой задаче не требуется.

## 6. Этап 0 — Product Documentation Acceptance

**Task:** `TASK-PRODUCT-DOC-001`, Issue №19, PR №21.  
**Delivery stage:** `STAGE-0-PRODUCT-DEFINITION`.  
**Architecture horizon:** `PHASE-0`.

Результат:

- Product Blueprint и детальные specs;
- Capability Map;
- Execution Manifest;
- Development Program;
- Port Policy;
- executable Issues;
- Project/Quality maps;
- validators.

Exit: все manifest tests PASS, PR №21 merged, обязательный map transition переводит Portal в `ready`.

## 7. Этап 1 — Teacher Portal v0.1

**Task:** [Issue №18 — TASK-PORTAL-001](https://github.com/spikeal8-maker/asa-lab/issues/18), PR №22.  
**Delivery stage:** `STAGE-1-TEACHER-PORTAL`.  
**Architecture horizon:** `PHASE-1`.

```text
open site
→ login
→ My Classrooms empty state
→ create classroom
→ card visible
→ reload persists
→ logout
```

Сохраняется существующий React/Vite + NestJS/Fastify код. Исправления выполняются только по Issue №18: rebase, canonical ports, dependency security, DB-role separation, request validation, idempotency, clean startup, test isolation, accessibility, regressions и boundaries.

Exit: сайт запускается из чистой PowerShell-сессии, полный manifest gate PASS, PR №22 merged.

## 8. Этап 2 — Electronics Project Slice

**Task:** [Issue №33 — TASK-ELECTRONICS-SLICE-001](https://github.com/spikeal8-maker/asa-lab/issues/33).  
**Delivery stage:** `STAGE-2-PROJECT-SHELL`.  
**Architecture horizon:** `PHASE-3`.

```text
Классы → Проекты → создать проект → «Электроника» → редактор
→ источник, резистор, LED и провод → последовательная цепь
→ ток, состояние LED и понятная диагностика
→ сохранить draft → reload сохраняет схему → immutable checkpoint
```

Результат: Project envelope (Project, ProjectDraft в `jsonb`, immutable ProjectVersion) и предметный ElectronicsDocument в одном вертикальном срезе: canvas-редактор, netlist, простой DC-расчёт и диагностика. Project Shell реализуется внутри этого этапа, отдельной задачей не выделяется.

Не входят children, assignments, subject logic, Redis/MinIO/S3 и advanced autosave.

## 9. Этап 3 — Checkers Lite

**Task:** [Issue №25 — TASK-CHECKERS-LITE-001](https://github.com/spikeal8-maker/asa-lab/issues/25).  
**Delivery stage:** `STAGE-3-CHECKERS-LITE`.  
**Architecture horizon:** `PHASE-3`.

```text
create Checkers project
→ board opens
→ legal move
→ invalid move diagnostic
→ save/reload
→ preview
```

Цель — доказать, что module подключается без правок Classroom/Project Core. Не входят AI, multiplayer, tournament, rating, chat, full engine, assignments и grades.

## 10. Этап 4 — Electronics Alpha

**Task:** [Issue №26 — TASK-ELECTRONICS-ALPHA-001](https://github.com/spikeal8-maker/asa-lab/issues/26).  
**Delivery stage:** `STAGE-4-ELECTRONICS-ALPHA`.  
**Architecture horizon:** `PHASE-5`.

```text
create Electronics project
→ place source/resistor/LED
→ connect wires
→ set values
→ validate/netlist
→ deterministic DC calculation
→ LED on/off/overcurrent
→ save/reload
```

Результат: CircuitDocument v1, React editor, connectivity resolver, normalized netlist, minimal Rust native/WASM series-loop solver, diagnostics и preview.

Не входят breadboard, transient, Arduino, instruments, large catalog, assignments и advanced autograding.

## 11. Этап 5 — StudentSeat and Child Dashboard

**Task:** [Issue №7 — TASK-SEAT-001](https://github.com/spikeal8-maker/asa-lab/issues/7).  
**Delivery stage:** `STAGE-5-STUDENT-SEAT`.  
**Architecture horizon:** `PHASE-2`.

```text
teacher creates/imports seat
→ one-time access card
→ child login without email
→ child dashboard/class/project
→ credential reset
→ old session denied
```

Exit: детский доступ безопасен, printable и не требует email.

## 12. Этап 6 — Assignment and Immutable Submission

**Task:** [Issue №8 — TASK-ACT-001](https://github.com/spikeal8-maker/asa-lab/issues/8).  
**Delivery stage:** `STAGE-6-ASSIGNMENT-SUBMISSION`.  
**Architecture horizon:** `PHASE-3`.

```text
publish ActivityVersion
→ assign classroom
→ child opens starter project
→ work/save
→ submit immutable ProjectVersion
→ teacher queue shows exact attempt
```

Exit: assignment/submission cycle работает минимум на одном Alpha module.

## 13. Этап 7 — Comments, Review, Grade and Badge

**Task:** [Issue №20 — TASK-REVIEW-001](https://github.com/spikeal8-maker/asa-lab/issues/20).  
**Delivery stage:** `STAGE-7-REVIEW-ASSESSMENT`.  
**Architecture horizon:** `PHASE-4`.

```text
open exact attempt
→ anchored comment
→ request changes
→ resubmit
→ compare
→ accept
→ rubric/grade
→ badge/progress
```

Exit: предметно-независимый assessment flow подтверждён E2E.

## 14. Этап 8 — Full Electronics Classroom Cycle

**Task:** [Issue №6 — TASK-ELEC-001](https://github.com/spikeal8-maker/asa-lab/issues/6).  
**Delivery stage:** `STAGE-8-ELECTRONICS-CLASSROOM`.  
**Architecture horizon:** `PHASE-5`.

```text
assign electronics activity
→ child builds circuit
→ public checks
→ immutable submission
→ anchored review
→ revision
→ accept/grade/badge
```

Exit: Electronics проходит полный Classroom lifecycle без circuit-specific logic в Core.

## 15. Обязательный map protocol

`EXECUTION_MANIFEST.yaml` содержит `map_protocol` и `map_nodes` каждого task.

### Start

- task → `in_progress`;
- current focus остаётся task;
- реальные implementation nodes → `in_progress`.

### Draft PR

- task → `in_review`;
- next task остаётся `blocked`;
- Project Map, Quality Map, test catalog и Nx graph отражают diff.

### After merge

- task → `done`;
- next task → `ready` после dependency check;
- current focus → next task;
- map-only transition validators PASS;
- агент останавливается.

## 16. Evidence каждого этапа

Перед Ready:

1. точная команда запуска;
2. canonical demo URL;
3. automated E2E;
4. screenshot основного состояния;
5. screenshot error/diagnostic при применимости;
6. task runner report с commit SHA;
7. clean working tree;
8. map/Nx updates;
9. отсутствие следующей capability в diff.

## 17. Отчёт

```text
MILESTONE:
TASK:
ISSUE:
STATUS:
VISIBLE_RESULT:
CAPABILITIES:
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
NEXT_ALLOWED_TASK:
NEXT_COMMAND:
```

## 18. Успех программы

Программа v1 завершена, когда на одном локальном сайте:

- педагог входит и управляет классом;
- ребёнок входит без email;
- оба используют единый Project envelope из Electronics Project Slice;
- Checkers Lite и Electronics являются независимыми modules;
- педагог назначает Electronics activity;
- ребёнок сохраняет и сдаёт immutable version;
- педагог комментирует, возвращает, принимает и оценивает;
- badge/progress отображаются;
- tenant/class/student isolation подтверждена;
- весь поток проходит automated browser E2E.

После v1 advanced Electronics, Arduino, Scratch-like block coding, 3D, robotics и другие модули получают отдельные Issues.
