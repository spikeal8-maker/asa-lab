# ASA Lab — Product Documentation

Product goal is defined by `PRODUCT_BLUEPRINT.md` and `CAPABILITY_MAP.yaml`. Execution is controlled by [`../delivery/EXECUTION_MANIFEST.yaml`](../delivery/EXECUTION_MANIFEST.yaml).

## Current product task

```text
TASK-CREATOR-PORTAL-001
Issue #62
branch agent/r2-creator-portal
status ready
```

R2 builds a coherent capability-aware Creator Portal on top of the completed Account C1 and existing project/module foundation.

## User result

```text
Creator Home
→ recent projects
→ Projects / Learning / Collections / Challenges
→ Classes for educator capability
→ Help
→ Account and workspace switcher
```

## Preserved capabilities

- Account/Profile/Principal;
- Personal Workspace, ActiveContext and sessions_v2;
- educator capability;
- Teacher Portal;
- Project Hub;
- Electronics, Chess and Chess Online;
- PostgreSQL/RLS/Docker/recovery.

## R2 boundaries

R2 does not implement full Module Registry lifecycle, Electronics parity, StudentSeat, publication backend, assignments or administration.

## Delivery sources

- [`../delivery/EXECUTION_MANIFEST.yaml`](../delivery/EXECUTION_MANIFEST.yaml)
- [`../project-map/project-map.yaml`](../project-map/project-map.yaml)
- [`../project-map/QUALITY_MAP.md`](../project-map/QUALITY_MAP.md)
- [`../testing/test-catalog.yaml`](../testing/test-catalog.yaml)
- [`../testing/active-task-tests.yaml`](../testing/active-task-tests.yaml)

R3 and R4 remain blocked until separate owner transitions.