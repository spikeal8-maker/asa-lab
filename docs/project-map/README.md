# Project Map

Карта ASA Lab хранится как код и версионируется вместе с системой.

## Файлы

- [`project-map.yaml`](project-map.yaml) — architecture graph, dynamic statuses и текущая executable queue;
- [`../delivery/EXECUTION_MANIFEST.yaml`](../delivery/EXECUTION_MANIFEST.yaml) — точные executable tasks, Issues, branches, tests и artifacts;
- [`../delivery/DEVELOPMENT_PROGRAM_V1.md`](../delivery/DEVELOPMENT_PROGRAM_V1.md) — owner-controlled roadmap;
- [`PROJECT_MAP.md`](PROJECT_MAP.md) — Mermaid-представление для GitHub;
- [`viewer.html`](viewer.html) — интерактивный graph из Project Map и Execution Manifest;
- [`QUALITY_MAP.md`](QUALITY_MAP.md) — test profiles и Account C1 gate;
- [`TASK_SYSTEM.md`](TASK_SYSTEM.md) — правила постановки и перехода задач;
- [`nx-project-graph.json`](nx-project-graph.json) — фактические code dependencies.

## Текущий focus

```text
TASK-ACCOUNT-C1-001
Issue #48
branch assistant/docker-linux-bootstrap
```

Исполняемая очередь заканчивается на Account C1:

```text
TASK-PRODUCT-DOC-001 done
→ TASK-PORTAL-001 done
→ TASK-ACCOUNT-C1-001 in_progress
→ owner review / stop
```

R2 Issue №62, R3 Issue №37 и R4 Issue №63 находятся в roadmap, но отсутствуют в executable queue до отдельного owner transition. Старые Electronics/Checkers task nodes сохранены для traceability и не выбираются агентом.

## Просмотр

Запускать из корня репозитория:

```bash
python -m http.server 8080
```

Открыть:

```text
http://127.0.0.1:8080/docs/project-map/viewer.html
```

Viewer должен показывать порядок из `EXECUTION_MANIFEST.yaml` и `project-map.yaml`. Расхождение является governance FAIL.

## Две оси

- `delivery_stage` — порядок уже активированных задач;
- `architecture_horizon` — техническая область и roadmap grouping.

Architecture horizon не разрешает автоматически начать future release.

## Lifecycle

```text
start        current task in_progress
Draft review focused PASS + owner-visible result
acceptance   owner decides convergence action
transition   future task may be added separately
stop         agent does not implement future work in same session
```

## Проверка

```bash
python tools/validate_project_map.py
python tools/validate_delivery_program.py
```

Проверки контролируют nodes, edges, task cycles, current focus, exact executable queue, manifest dependencies, Issues, test profiles, ports и обязательную синхронизацию map artifacts.
