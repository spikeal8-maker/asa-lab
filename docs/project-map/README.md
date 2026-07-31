# Project Map

Карта ASA Lab хранится как код и версионируется вместе с системой.

## Файлы

- [`project-map.yaml`](project-map.yaml) — architecture graph и dynamic state;
- [`../delivery/EXECUTION_MANIFEST.yaml`](../delivery/EXECUTION_MANIFEST.yaml) — completed executable queue и blocked roadmap;
- [`../delivery/DEVELOPMENT_PROGRAM_V1.md`](../delivery/DEVELOPMENT_PROGRAM_V1.md) — человеко-читаемая программа;
- [`PROJECT_MAP.md`](PROJECT_MAP.md) — Mermaid-представление;
- [`viewer.html`](viewer.html) — интерактивный graph;
- [`QUALITY_MAP.md`](QUALITY_MAP.md) — Account C1 evidence;
- [`TASK_SYSTEM.md`](TASK_SYSTEM.md) — правила task activation;
- [`nx-project-graph.json`](nx-project-graph.json) — code dependencies.

## Текущее состояние

```text
product merge SHA:       e01ac85095ddaabef19ed618964deac3aa5b2406
verified implementation: 35c06c42012672b9b4cb2626b85ba1f21b973bc0
current_focus:            null
```

Исполняемая очередь полностью завершена:

```text
TASK-PRODUCT-DOC-001 done
→ TASK-PORTAL-001 done
→ TASK-ACCOUNT-C1-001 done
→ stop
```

R2 Issue №62, R3 Issue №37 и R4 Issue №63 остаются blocked roadmap.

## Просмотр

Из корня репозитория:

```bash
python -m http.server 8080
```

Открыть:

```text
http://127.0.0.1:8080/docs/project-map/viewer.html
```

Viewer сверяет `EXECUTION_MANIFEST.yaml` и `project-map.yaml`. `current_focus: null` валиден, когда все executable tasks имеют status `done`.

## Lifecycle

```text
no task      current_focus null; coding agent stops
activation   owner publishes task/Issue/branch/tests
work         one task in_progress
review       focused PASS and owner-visible result
merge        task done; merge SHA recorded
transition   focus null unless a future task is separately activated
```

## Проверка

```bash
python tools/validate_project_map.py
python tools/validate_delivery_program.py
```
