# Project Map

Карта ASA Lab хранится как код и версионируется вместе с системой.

## Файлы

- [`project-map.yaml`](project-map.yaml) — единый машиночитаемый граф.
- [`PROJECT_MAP.md`](PROJECT_MAP.md) — обзорные Mermaid-карты для GitHub.
- [`viewer.html`](viewer.html) — интерактивный Obsidian-подобный граф.
- [`TASK_SYSTEM.md`](TASK_SYSTEM.md) — правила постановки и выдачи задач.
- [`../architecture/structurizr/workspace.dsl`](../architecture/structurizr/workspace.dsl) — C4-модель архитектуры.

## Просмотр

GitHub автоматически отображает Mermaid-диаграммы в `PROJECT_MAP.md`.

Интерактивный граф запускается локально:

```bash
cd docs/project-map
python -m http.server 8080
```

Затем откройте `http://localhost:8080/viewer.html`.

## Источник истины

Редактируется `project-map.yaml`. Mermaid, C4-модель и будущий Nx graph являются разными представлениями системы и не должны противоречить карте.

## Проверка

```bash
python tools/validate_project_map.py
```

CI проверяет уникальность узлов, целостность связей, статусы задач, циклы зависимостей, очередь исполнения и обязательное обновление карты при архитектурных изменениях.
