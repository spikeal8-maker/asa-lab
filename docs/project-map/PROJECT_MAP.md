# Карта проекта ASA Lab

Source: [`project-map.yaml`](project-map.yaml)  
Execution: [`../delivery/EXECUTION_MANIFEST.yaml`](../delivery/EXECUTION_MANIFEST.yaml)

## Current focus

```text
TASK-ELECTRONICS-M1-001
Issue #63
branch agent/r4-electronics-m1
status in_review
checkpoint m1_release_candidate
sole executor coding_bot
assistant role read_only_reviewer
```

```mermaid
flowchart LR
  ACCOUNT["Account C1 done"] --> PORTAL["Creator Portal done"]
  PORTAL --> GATE["R3A Electronics Gateway done"]
  GATE --> M1["Electronics M1 in progress"]
  M1 -. owner transition .-> M2["R4-M2 blocked"]
  GATE -. deferred .-> R3B["R3B blocked"]
```

R3A verified the existing server-side Module Registry, manifest/provider
registration, shared Editor Host and module-neutral personal Project lifecycle.
It does not declare full R3 completion; R3B remains blocked/deferred.

Electronics M1 is converging without new features: one fail-closed owner
catalog, one exact runtime SHA, one Compose project and one real-editor owner
flow. R4-M2 remains blocked.

## Quality gate

See [`QUALITY_MAP.md`](QUALITY_MAP.md) and
[`../testing/active-task-tests.yaml`](../testing/active-task-tests.yaml).
Only focused tests run before owner visual acceptance; the final full matrix is
intentionally not active.

## Ports

```text
Web  127.0.0.1:4610
API  127.0.0.1:4611
E2E  127.0.0.1:4612
```
