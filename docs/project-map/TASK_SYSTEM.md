# Система задач ASA Lab

Живое выполнение имеет один источник:
[`../execution/current.yaml`](../execution/current.yaml). Для повседневной
работы используется его компактное представление:

```bash
pnpm agent:context --list
pnpm agent:context --scope <lane>
```

## Разделение ответственности

- `current.yaml` хранит task, Issue, status, checkpoint, acceptance, revisions,
  gates и blockers каждого lane;
- [`../delivery/EXECUTION_MANIFEST.yaml`](../delivery/EXECUTION_MANIFEST.yaml)
  хранит каталог программы и ожидаемых результатов;
- [`project-map.yaml`](project-map.yaml) хранит архитектурные и исторические
  связи;
- test catalogs связывают стабильные идентификаторы проверок с командами;
- GitHub Actions и локальный вывод хранят фактический результат gate.

Ни manifest, ни map, ни эта страница не выбирают следующую задачу и не могут
повысить статус. Новое направление появляется только после явного решения
владельца и записи в `current.yaml`.

## Работа агента

1. Прочитать `AGENTS.md`.
2. Получить `agent:context` нужного lane.
3. Проверить незавершённые файлы и `blocking`.
4. Изменить только согласованный результат, сохранив чужую работу.
5. Запустить команды из блока `gates`.
6. Отдельно сообщить local validation, CI, публикацию и owner acceptance.

Дублирование live-state в документации является ошибкой управляющей системы и
проверяется командой `pnpm control-plane:check`.
