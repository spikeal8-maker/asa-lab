# Project Map

- [`project-map.yaml`](project-map.yaml) — current machine state;
- [`../delivery/EXECUTION_MANIFEST.yaml`](../delivery/EXECUTION_MANIFEST.yaml) — executable queue;
- [`PROJECT_MAP.md`](PROJECT_MAP.md) — human-readable map;
- [`QUALITY_MAP.md`](QUALITY_MAP.md) — current gate;
- [`../testing/test-catalog.yaml`](../testing/test-catalog.yaml) — stable tests;
- [`../testing/active-task-tests.yaml`](../testing/active-task-tests.yaml) — active R2 tests;
- [`viewer.html`](viewer.html) — interactive graph.

## Current focus

```text
TASK-CREATOR-PORTAL-001
Issue #62
branch agent/r2-creator-portal
status ready
```

```text
Product Docs done
→ Teacher Portal done
→ Account C1 done
→ Creator Portal ready
→ owner review / stop
```

R3 and R4 remain blocked. Architecture horizon does not allow the coding agent to skip the queue.

## Validation

```bash
python tools/validate_project_map.py
python tools/validate_delivery_program.py
python tools/validate_test_catalog.py
```

The viewer must show the same order as `EXECUTION_MANIFEST.yaml`. A mismatch is governance FAIL.