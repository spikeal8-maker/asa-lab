# Карта качества ASA Lab

Sources:

- [`../delivery/EXECUTION_MANIFEST.yaml`](../delivery/EXECUTION_MANIFEST.yaml)
- [`../testing/test-catalog.yaml`](../testing/test-catalog.yaml)
- [`../testing/active-task-tests.yaml`](../testing/active-task-tests.yaml)
- [`project-map.yaml`](project-map.yaml)

## Current task

```text
TASK-CREATOR-PORTAL-001  ready
current_focus             TASK-CREATOR-PORTAL-001
branch                    agent/r2-creator-portal
Issue                     #62
```

## Governance IDs

```text
TST-ARCH-001
TST-MAP-001
TST-CATALOG-001
TST-DEVELOPMENT-PROGRAM-001
```

## R2 mandatory IDs

```text
TST-R2-STATIC-001
TST-R2-CREATOR-HOME-001
TST-R2-CAPABILITY-NAV-001
TST-R2-ROUTING-001
TST-R2-E2E-001
```

All R2 results are currently `NOT_RUN`. The coding agent must implement real `test:creator-portal` and `e2e:creator-portal` commands before acceptance.

## Gate commands

```bash
python -m compileall -q tools
python tools/validate_architecture.py
python tools/validate_capability_map.py
python tools/validate_infrastructure_focus.py
python tools/validate_project_map.py
python tools/validate_test_catalog.py
python tools/validate_delivery_program.py
python tools/run_task_tests.py --task TASK-CREATOR-PORTAL-001
```

`TST-R2-STATIC-001` runs format, lint, typecheck, boundaries, contracts, build and full regression.

## Functional matrix

- Creator Home is the default authenticated route;
- recent projects load from existing data;
- creator and educator navigation differs by server capability;
- Classes is hidden without educator capability;
- workspace switch changes scope without changing capability;
- Account/Profile/Sessions are integrated into the Portal shell;
- Learning/Collections/Challenges/Help have honest states;
- deep links, refresh, Back and Forward preserve route/context;
- existing Teacher Portal, Electronics, Chess and Chess Online remain reachable;
- current Accounts, classes, projects and sessions are preserved.

## UI matrix

- desktop 1440×900;
- tablet;
- mobile 390×844;
- loading;
- empty;
- error;
- restricted capability;
- keyboard/focus/accessibility;
- no internal `Account C1`/debug language as primary UI copy.

## Browser counters

```text
console errors = 0
pageerror = 0
unexpected requestfailed = 0
unexpected HTTP 5xx = 0
```

## Preserved evidence

Account C1 remains accepted on implementation SHA `35c06c42012672b9b4cb2626b85ba1f21b973bc0`, merged by `e01ac85095ddaabef19ed618964deac3aa5b2406`.

## Result semantics

- `PASS`: real exit `0`;
- `FAIL`: executed non-zero defect;
- `BLOCKED`: required environment or command unavailable;
- `NOT_RUN`: not executed.

R3 and R4 remain blocked and have no active gate.