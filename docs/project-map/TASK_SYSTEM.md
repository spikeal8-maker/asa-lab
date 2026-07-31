# Система задач ASA Lab

Machine contract: [`../delivery/EXECUTION_MANIFEST.yaml`](../delivery/EXECUTION_MANIFEST.yaml)

## Current task

```text
TASK-CREATOR-PORTAL-001
Issue #62
branch agent/r2-creator-portal
status ready
current_focus TASK-CREATOR-PORTAL-001
```

Coding-агент не выбирает другой task и не занимается аудитом старых PR.

## Task selection

Product code разрешён только когда одновременно верно:

```text
task_id = project.current_focus
task is present in EXECUTION_MANIFEST.yaml
status = ready | in_progress | in_review
dependencies = done
Issue is open
branch matches manifest
active test IDs are registered
```

## Queue

```text
TASK-PRODUCT-DOC-001      done
→ TASK-PORTAL-001         done
→ TASK-ACCOUNT-C1-001     done
→ TASK-CREATOR-PORTAL-001 ready
→ owner review / stop
```

R3 and R4 are blocked and absent from the executable queue.

## R2 lifecycle

### Start

```text
branch = agent/r2-creator-portal
current_focus = TASK-CREATOR-PORTAL-001
status = ready -> in_progress
```

### Review

```text
focused gate PASS
full regression PASS
owner screenshots exist
Draft PR to main
status may become in_review
```

### Acceptance

```text
owner decides merge separately
task may become done
R3 remains blocked until separate transition
```

## Evidence

- exact final SHA;
- changed user flow;
- test IDs and exact results;
- desktop/tablet/mobile screenshots;
- browser counters;
- data-preservation evidence;
- clean tracked tree;
- confirmation that R3 was not started.

## Tests

Stable registry: [`../testing/test-catalog.yaml`](../testing/test-catalog.yaml)  
Active registry: [`../testing/active-task-tests.yaml`](../testing/active-task-tests.yaml)

```bash
python tools/run_task_tests.py --task TASK-CREATOR-PORTAL-001
```

## Git rules

- one active product branch;
- no force-push or history rewrite;
- no automatic branch creation;
- no merge/tag without owner decision;
- old PRs and branches are untouched during R2;
- backups and credentials are never committed.