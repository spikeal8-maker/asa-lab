# Карта проекта ASA Lab

Source: [`project-map.yaml`](project-map.yaml)  
Execution: [`../delivery/EXECUTION_MANIFEST.yaml`](../delivery/EXECUTION_MANIFEST.yaml)

## Current focus

```text
TASK-CREATOR-PORTAL-001
Issue #62
branch agent/r2-creator-portal
status in_review
```

```mermaid
flowchart LR
  DOC[Product Docs\ndone]
  PORTAL[Teacher Portal\ndone]
  ACCOUNT[Account C1\ndone]
  R2[Creator Portal\nin review]
  STOP[Owner review]
  R3[R3 Project Lifecycle\nblocked]
  R4[R4 Electronics Parity\nblocked]

  DOC --> PORTAL --> ACCOUNT --> R2 --> STOP
  STOP -. separate owner transition .-> R3
  R3 -. acceptance .-> R4
```

## R2 visible flow

```mermaid
flowchart LR
  LOGIN[Account login]
  HOME[Creator Home]
  RECENT[Recent projects]
  PROJECTS[Projects]
  LEARN[Learning]
  COLLECTIONS[Collections]
  CHALLENGES[Challenges]
  CLASSES[Classes when educator]
  HELP[Help]
  ACCOUNT_UI[Account and workspace]

  LOGIN --> HOME --> RECENT
  HOME --> PROJECTS
  HOME --> LEARN
  HOME --> COLLECTIONS
  HOME --> CHALLENGES
  HOME --> CLASSES
  HOME --> HELP
  HOME --> ACCOUNT_UI
```

## Preserved architecture

```mermaid
flowchart TB
  WEB[Web / PWA]
  API[API]
  ID[Identity]
  ORG[Workspace and ActiveContext]
  PROJECTS[Projects]
  CLASS[Classroom]
  PG[(PostgreSQL / RLS)]
  ELECTRONICS[Electronics]
  CHESS[Chess / Chess Online]

  WEB --> API
  API --> ID
  API --> ORG
  API --> PROJECTS
  API --> CLASS
  ID --> PG
  ORG --> PG
  PROJECTS --> PG
  CLASS --> PG
  PROJECTS --> ELECTRONICS
  PROJECTS --> CHESS
```

R2 changes the Portal experience. It does not create a second identity/workspace/session model and does not start R3 or R4.

## Quality gate

See [`QUALITY_MAP.md`](QUALITY_MAP.md) and [`../testing/active-task-tests.yaml`](../testing/active-task-tests.yaml).

```bash
python tools/run_task_tests.py --task TASK-CREATOR-PORTAL-001
```

## Ports

```text
Web  127.0.0.1:4610
API  127.0.0.1:4611
E2E  127.0.0.1:4612
```
