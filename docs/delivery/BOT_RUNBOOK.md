# BOT_RUNBOOK — короткий вход coding-агента

Основной порядок входа находится в [`START_HERE_FOR_AI.md`](../../START_HERE_FOR_AI.md).
Этот файл оставлен как совместимая ссылка для старых инструментов и не хранит
задачу, ветку, Issue, checkpoint или SHA.

После изменения кода обязательный маршрут commit → push → CI → отдельный deploy
находится в [`AGENT_CHANGE_WORKFLOW.md`](AGENT_CHANGE_WORKFLOW.md). Там же
описаны безопасное обновление Docker, backup и проверочное восстановление.

## Начало работы

```bash
pnpm agent:context --list
pnpm agent:context --scope <lane>
pnpm control-plane:check
git status --short --branch
```

Команда контекста читает живое состояние только из
[`../execution/current.yaml`](../execution/current.yaml), показывает gates и
точные документы выбранного направления. Политика находится в
[`../../AGENTS.md`](../../AGENTS.md).

Короткий цикл: один цельный срез → focused gate → один осмысленный коммит →
проверка свежего `origin/main` → обычный push → CI точного SHA. Push не означает
deployment, а product bot не обновляет runtime или рабочую БД без прямого
поручения владельца.

## Справочники

- [`EXECUTION_MANIFEST.yaml`](EXECUTION_MANIFEST.yaml) — каталог программы;
- [`../project-map/project-map.yaml`](../project-map/project-map.yaml) — граф
  архитектуры и истории;
- [`../testing/test-catalog.yaml`](../testing/test-catalog.yaml) — стабильные
  проверки;
- [`../testing/active-task-tests.yaml`](../testing/active-task-tests.yaml) —
  дополнительные исполнимые профили;
- [`DEVELOPMENT_PROGRAM_V1.md`](DEVELOPMENT_PROGRAM_V1.md) — программа;
- [`LOCAL_PORT_POLICY.md`](LOCAL_PORT_POLICY.md) — порты.

Эти файлы не выбирают текущую задачу. Если справочник выглядит актуальнее
`current.yaml`, это ошибка документации, а не новое состояние.
