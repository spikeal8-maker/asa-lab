# ASA Lab — Development Program

**Machine contract:** [`EXECUTION_MANIFEST.yaml`](EXECUTION_MANIFEST.yaml)  
**Current state:** [`../project-map/project-map.yaml`](../project-map/project-map.yaml)  
**Quality:** [`../testing/test-catalog.yaml`](../testing/test-catalog.yaml)

## Назначение

Этот документ объясняет текущий delivery state. Исполняемая задача определяется только `EXECUTION_MANIFEST.yaml`, Project Map и активной GitHub Issue.

## Каноническое состояние

```text
main:                    e01ac85095ddaabef19ed618964deac3aa5b2406
verified implementation: 35c06c42012672b9b4cb2626b85ba1f21b973bc0
PR #70:                  merged
TASK-ACCOUNT-C1-001:     done
Issue #48:               completed
active task:             none
```

Функциональная полнота конечного продукта не заявляется.

## Delivery stage и architecture horizon

- **delivery stage** — owner-controlled порядок пользовательских результатов;
- **architecture horizon** — техническая область, а не разрешение начать следующую работу.

## Завершённая executable queue

```text
TASK-PRODUCT-DOC-001  done
→ TASK-PORTAL-001     done
→ TASK-ACCOUNT-C1-001 done
→ STOP
```

`project.current_focus = null`. Roadmap не активируется автоматически.

## Technical Product Alpha

В `main` находятся:

- public entry и adult registration;
- Account / Profile / Principal;
- Personal Workspace и sessions_v2;
- login по email или username;
- educator self-attestation и AuditEvent;
- workspace list и ActiveContext switching;
- profile и active session management;
- legacy teacher compatibility;
- Project Hub, Electronics, ASA Chess и Chess Online;
- Docker/PostgreSQL/RLS/persistence/backup foundation.

### Milestone: Account C1 completed

**Task:** `TASK-ACCOUNT-C1-001`  
**Issue:** №48  
**Architecture horizon:** `PHASE-1`

Проверенный результат:

```text
Account gate 28/28
Regression 298/298
Playwright 9/9
Browser errors 0
Docker/persistence/backup-restore PASS
```

## Blocked roadmap

### R2 — Creator Portal

**Issue №62** — Creator Home and capability-aware Portal shell.

Status: `blocked`. Требуется отдельный owner transition.

### R3 — Project lifecycle

**Issue №37** — Module Registry, Project Hub and shared Editor Host.

Status: `blocked`. Не начинается до принятого R2.

### R4 — Electronics parity

**Issue №63** — complete Circuits and Electronics functional parity.

Status: `blocked`. Не начинается до принятого R3.

## School Pilot

School Pilot остаётся roadmap:

```text
Classroom / StudentSeat
→ learner workspace
→ Assignment
→ immutable submission
→ review
→ grade and badge
```

Ни одна из этих задач сейчас не executable.

## Scope freeze

После активации будущей task разрешены только её user flow, migrations, API, UI, security, tests и review feedback.

Запрещено:

- начинать следующий release автоматически;
- создавать competing product branch;
- ослаблять RLS, contracts или tests;
- переписывать применённую migration;
- выполнять destructive cleanup без отдельного gate.

## Map protocol

### Start

Owner transition одновременно публикует:

```text
task ID
Issue
branch
scope
status ready/in_progress
current_focus
test IDs
```

### Review

Task становится `in_review` только после focused PASS и owner-visible result.

### After merge

- task → `done`;
- merge SHA и verified SHA фиксируются;
- `current_focus` → `null`, если следующая task отдельно не активирована;
- coding-агент останавливается.

## Порты

```text
Web  127.0.0.1:4610
API  127.0.0.1:4611
E2E  127.0.0.1:4612
```

Запрещены `3000`, `3100`, `5173`.

## Проверка текущего governance state

```bash
python tools/validate_infrastructure_focus.py
python tools/validate_project_map.py
python tools/validate_test_catalog.py
python tools/validate_delivery_program.py
```

Hosted GitHub Actions остаётся BLOCKED до первого шага; это не считается PASS.

## Следующее действие

Активной задачи нет. Coding-агент не пишет product code до отдельного owner-approved transition.
