# Стратегия тестирования ASA Lab

Execution source: [`../delivery/EXECUTION_MANIFEST.yaml`](../delivery/EXECUTION_MANIFEST.yaml)  
Stable registry: [`test-catalog.yaml`](test-catalog.yaml)  
Active registry: [`active-task-tests.yaml`](active-task-tests.yaml)  
Quality view: [`../project-map/QUALITY_MAP.md`](../project-map/QUALITY_MAP.md)

## Current task

```text
TASK-CREATOR-PORTAL-001
Issue #62
branch agent/r2-creator-portal
```

## Mandatory R2 tests

```text
TST-R2-STATIC-001
TST-R2-CREATOR-HOME-001
TST-R2-CAPABILITY-NAV-001
TST-R2-ROUTING-001
TST-R2-E2E-001
```

The active registry is temporary for the current task. After accepted merge, stable reusable tests may be moved into `test-catalog.yaml`; they are never deleted merely to make a gate green.

## Levels

- governance: manifests, maps and registries;
- static: format, lint, types, boundaries, contracts and build;
- unit/integration: Creator Home, routing and capability navigation;
- authorization: server-derived capability and workspace scope;
- regression: existing Account, Portal, Projects, Electronics and Chess;
- E2E: live API/PostgreSQL desktop/tablet/mobile flow;
- accessibility: keyboard, focus, semantics and responsive navigation.

## Command lifecycle

The coding agent must implement:

```text
test:creator-portal
e2e:creator-portal
```

Before implementation these commands are `BLOCKED`; they must never return a placeholder PASS.

Task runner:

```bash
python tools/run_task_tests.py --task TASK-CREATOR-PORTAL-001
```

## R2 security matrix

- capability and workspace scope come from the server;
- creator cannot forge educator navigation;
- workspace switching does not grant capability;
- foreign/suspended workspace is denied;
- Account/Profile/Sessions remain isolated;
- existing project ownership remains intact;
- no second identity/workspace/session model.

## R2 browser matrix

- Creator Home default route;
- recent project open/continue;
- creator navigation;
- educator navigation with Classes;
- workspace switch and refresh;
- Learning/Collections/Challenges/Help states;
- Account menu and profile/session access;
- desktop 1440×900, tablet and mobile 390×844;
- loading, empty, error and restricted states.

```text
console errors = 0
pageerror = 0
unexpected requestfailed = 0
unexpected HTTP 5xx = 0
```

## Result states

- `PASS`: executed exit `0`;
- `FAIL`: executed non-zero defect;
- `BLOCKED`: required command or environment unavailable;
- `NOT_RUN`: not executed.

## Preservation

Tests must prove that the current Accounts, teacher, classes, projects, drafts, sessions, Electronics, Chess and Chess Online survive unchanged.

R3 and R4 tests are not activated by R2.