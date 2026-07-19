# Project Map

Карта ASA Lab хранится как код и версионируется вместе с системой.

## Файлы

- [`project-map.yaml`](project-map.yaml) — architecture graph, dynamic statuses и execution queue;
- [`../delivery/EXECUTION_MANIFEST.yaml`](../delivery/EXECUTION_MANIFEST.yaml) — delivery stages, Issues, branches, tests, map nodes и artifacts;
- [`PROJECT_MAP.md`](PROJECT_MAP.md) — Mermaid-карты для GitHub;
- [`viewer.html`](viewer.html) — интерактивный Obsidian-like graph, объединяющий Project Map и Execution Manifest;
- [`QUALITY_MAP.md`](QUALITY_MAP.md) — test profiles и stage gates;
- [`TASK_SYSTEM.md`](TASK_SYSTEM.md) — правила постановки и перехода задач;
- [`nx-project-graph.json`](nx-project-graph.json) — фактические code dependencies;
- [`../architecture/structurizr/workspace.dsl`](../architecture/structurizr/workspace.dsl) — C4 architecture model.

## Просмотр

GitHub отображает Mermaid-диаграммы в `PROJECT_MAP.md`.

Интерактивный viewer нужно запускать **из корня репозитория**, потому что он загружает файлы из `docs/project-map` и `docs/delivery`:

```bash
cd <repository-root>
python -m http.server 8080
```

Открыть:

```text
http://127.0.0.1:8080/docs/project-map/viewer.html
```

Не запускайте server из `docs/project-map`: в этом случае `EXECUTION_MANIFEST.yaml` окажется вне HTTP root.

## Две оси карты

- `delivery_stage` — строгий execution order Product Alpha → School Pilot;
- `architecture_horizon` — архитектурная группировка capability.

Viewer показывает обе оси отдельно и выводит ошибку, если manifest queue и `project-map.yaml` расходятся.

## Map lifecycle

```text
start       task in_progress; actual map nodes in_progress
draft PR    task in_review; Project/Quality/Nx maps reflect diff
after merge task done; next ready; current_focus next; agent stops
```

После merge обязателен map-only transition commit/PR.

## Проверка

```bash
python tools/validate_project_map.py
python tools/validate_delivery_program.py
```

Проверки контролируют узлы, связи, task cycles, current focus, exact queue, manifest dependencies, Issues, test profiles, ports и обязательные map artifacts при product-code changes.
