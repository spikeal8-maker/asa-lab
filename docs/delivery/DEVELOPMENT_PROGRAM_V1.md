# ASA Lab — Development Program

Machine contract: [`EXECUTION_MANIFEST.yaml`](EXECUTION_MANIFEST.yaml)  
Current state: [`../project-map/project-map.yaml`](../project-map/project-map.yaml)  
Stable tests: [`../testing/test-catalog.yaml`](../testing/test-catalog.yaml)  
Active tests: [`../testing/active-task-tests.yaml`](../testing/active-task-tests.yaml)

## Current executable queue

```text
TASK-PRODUCT-DOC-001      done
→ TASK-PORTAL-001         done
→ TASK-ACCOUNT-C1-001     done
→ TASK-CREATOR-PORTAL-001 ready
→ owner review / stop
```

Current branch: `agent/r2-creator-portal`. Issue: №62.

## R2 user result

```text
Account login
→ Creator Home
→ recent projects
→ Projects / Learning / Collections / Challenges
→ capability-aware Classes
→ Help
→ Account and workspace switcher
```

R2 turns the current technical Alpha UI into a coherent, useful cabinet. It does not claim final product completeness.

## Required scope

- useful Creator Home as default route;
- recent projects and next actions;
- loading, empty, error and restricted states;
- capability-aware navigation from server state;
- workspace switcher that changes scope only;
- Classes visible only to educator capability;
- honest Learning/Collections/Challenges/Help surfaces;
- integrated Account/Profile/Sessions;
- desktop, tablet and mobile;
- route/context persistence through refresh and history navigation;
- preservation of all existing data and flows.

## Frozen foundation

Do not recreate or replace:

- Account/Profile/Principal/Personal Workspace;
- sessions_v2 and Account C1 APIs;
- Teacher Portal;
- Project Hub;
- Electronics, Chess and Chess Online;
- PostgreSQL/RLS/Docker/recovery.

## Scope freeze

Not part of R2:

- R3 Module Registry or shared Editor Host rewrite;
- R4 Electronics parity;
- StudentSeat provisioning;
- publication/community backend;
- assignments/review/grades;
- administration/billing;
- audit or closure of old PRs.

## Gate

```bash
python tools/validate_infrastructure_focus.py
python tools/validate_project_map.py
python tools/validate_test_catalog.py
python tools/validate_delivery_program.py
python tools/run_task_tests.py --task TASK-CREATOR-PORTAL-001
```

The coding agent implements real `test:creator-portal` and `e2e:creator-portal` commands. PASS requires real exit `0` on one final SHA.

## Browser evidence

Creator and educator, desktop/tablet/mobile, live API/PostgreSQL, existing Electronics/Chess projects, workspace switching and route persistence.

```text
console errors = 0
pageerror = 0
unexpected requestfailed = 0
unexpected HTTP 5xx = 0
```

## Roadmap after R2

```text
R3 Issue №37  blocked
R4 Issue №63  blocked
School Pilot  blocked
```

R3 becomes executable only through a separate owner transition after R2 acceptance.

## Stop

Open a Draft PR from `agent/r2-creator-portal` to `main`, publish the exact SHA, tests and screenshots, then stop. No merge or release tag is included.