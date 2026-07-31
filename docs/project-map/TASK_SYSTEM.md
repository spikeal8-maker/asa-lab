# Система задач ASA Lab

## 1. Источники task contract

```text
AGENTS.md
→ docs/project-map/infrastructure-focus.yaml
→ docs/project-map/project-map.yaml
→ docs/delivery/EXECUTION_MANIFEST.yaml
→ GitHub Issue текущей задачи
→ docs/testing/test-catalog.yaml
```

Чат не заменяет task ID, branch, dependencies, ports, test gate или scope. При конфликте агент останавливается до опубликованной нормативной правки.

## 2. Infrastructure и product state

Сначала проверяется `infrastructure-focus.yaml`.

- `active: true` — исполняется только infrastructure manifest;
- `active: false` — state обязан быть terminal и пройти `validate_infrastructure_focus.py`;
- после этого task берётся из `project.current_focus`.

Текущий infrastructure state:

```text
TASK-DOCKER-LINUX-001 done
completed_sha 7afebdcf9441b027092ce17a37f1f89950af99c6
active false
```

## 3. Как выбирается задача

Product code разрешён только когда одновременно верно:

```text
task_id = project.current_focus
task присутствует в EXECUTION_MANIFEST.yaml
status = ready | in_progress | in_review
все depends_on = done
Issue открыта и не помечена blocked
branch соответствует manifest
required test IDs существуют в test catalog
```

Агент не выбирает roadmap task и не создаёт branch самостоятельно.

## 4. Текущая executable queue

```text
TASK-PRODUCT-DOC-001  done
→ TASK-PORTAL-001     done
→ TASK-ACCOUNT-C1-001 in_progress
→ owner review / stop
```

У текущей задачи:

```text
next_task: null
```

Это означает: после Account C1 никакая следующая capability не активируется автоматически.

## 5. Owner-gated roadmap

```text
R2 Issue №62  Creator Portal          blocked
R3 Issue №37  Project lifecycle       blocked
R4 Issue №63  Electronics parity      blocked
```

Roadmap task становится executable только отдельным governance transition, который одновременно обновляет:

- `EXECUTION_MANIFEST.yaml`;
- `project-map.yaml` и `PROJECT_MAP.md`;
- `QUALITY_MAP.md` и test catalog;
- GitHub Issue status/scope;
- canonical branch;
- owner stop condition.

## 6. Текущий Account C1

**Task:** `TASK-ACCOUNT-C1-001`  
**Issue:** №48  
**Branch:** `assistant/docker-linux-bootstrap`

Уже реализовано и не дублируется:

- registration;
- Account / Profile / Principal;
- Personal Workspace;
- sessions_v2;
- login email/username;
- legacy teacher bridge;
- principal-aware project ownership.

Оставшийся flow:

```text
educator self-attestation
→ audited provisional capability
→ workspace list/context switch
→ profile
→ active sessions
→ revoke one/all other sessions
→ Chromium evidence
```

## 7. Status semantics

| Status | Значение |
|---|---|
| `planned` | roadmap capability без разрешения на реализацию |
| `blocked` | dependency или owner activation отсутствует |
| `ready` | задача опубликована и может быть начата |
| `in_progress` | один исполнитель работает в canonical branch |
| `in_review` | user flow завершён и находится на owner review |
| `done` | owner acceptance и утверждённый convergence transition |
| `deprecated` | historical task, не executable |

`done` не означает только наличие кода или локальный test report.

## 8. Scope freeze

После `in_progress` разрешены только:

- domain/application текущего flow;
- additive migration;
- API/UI текущего flow;
- security/RLS/compatibility fixes;
- focused tests, E2E и evidence;
- review feedback.

Запрещены:

- future roadmap capability;
- competing branch;
- unrelated refactoring;
- изменение применённой migration;
- ослабление tests/contracts/RLS;
- destructive cleanup.

## 9. Test lifecycle

Test ID регистрируется в `test-catalog.yaml` с реальной командой.

Если suite ещё не реализован, команда обязана вернуть:

```text
BLOCKED
exit code 78
```

Она не может отсутствовать или возвращать фиктивный PASS.

Текущие Account placeholders:

```text
pnpm test:account-c1
pnpm test:account-c1:pg
pnpm e2e:account-c1
```

Product implementation заменяет их реальными suites.

Task runner:

```bash
python tools/run_task_tests.py --task TASK-ACCOUNT-C1-001
```

## 10. Map lifecycle

### Start

```text
task = in_progress
current_focus = task
roadmap = blocked
```

### Draft review

```text
focused gate PASS
owner-visible result exists
task may become in_review
next_task remains null
maps/tests/Nx synchronized
```

### Acceptance

```text
owner decides merge/convergence separately
current task may become done
future task remains blocked until separate activation
agent stops
```

## 11. Git rules

- одна canonical product line;
- обычный fast-forward push;
- no force-push;
- no automatic branch creation;
- no merge/main/tag without owner instruction;
- backups, dumps and credentials are never committed;
- old transfer-only branches remain historical until convergence decision.

## 12. Evidence

Каждый product review содержит:

- exact final SHA;
- user-visible result;
- migration and preservation report;
- test IDs with PASS/FAIL/BLOCKED/NOT_RUN;
- PostgreSQL/RLS negative evidence;
- Playwright and browser counters;
- screenshots;
- clean tracked working tree;
- residual risks;
- confirmation that future capability is absent.

## 13. Validators

```bash
python tools/validate_infrastructure_focus.py
python tools/validate_project_map.py
python tools/validate_test_catalog.py
python tools/validate_delivery_program.py
```

Validators must agree on current task, exact executable queue and test mapping.
