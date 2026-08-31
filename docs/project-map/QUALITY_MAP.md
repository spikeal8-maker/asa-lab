# Карта качества ASA Lab

Живые задачи и команды gates выбираются из
[`../execution/current.yaml`](../execution/current.yaml):

```bash
pnpm agent:context --scope <lane>
```

Результаты запусков находятся в выводе локального gate и GitHub Actions, а не
копируются в этот документ. Поэтому здесь нет `PASS`, `NOT_RUN`, активной задачи,
ветки, checkpoint или SHA.

## Реестры

- [`../testing/test-catalog.yaml`](../testing/test-catalog.yaml) — стабильные
  исполнимые тесты;
- [`../testing/active-task-tests.yaml`](../testing/active-task-tests.yaml) —
  дополнительные профили для задач, объявленных в control plane;
- [`../testing/planned-test-catalog.yaml`](../testing/planned-test-catalog.yaml) —
  будущие проверки, которые не являются gate;
- [`../delivery/EXECUTION_MANIFEST.yaml`](../delivery/EXECUTION_MANIFEST.yaml) —
  каталог программы.

## Governance IDs

```text
TST-ARCH-001
TST-MAP-001
TST-CATALOG-001
TST-DEVELOPMENT-PROGRAM-001
```

`pnpm gate:governance` проверяет сами валидаторы, все lane-контексты, карту,
каталоги, архитектурные контракты и owner assets. Focused и browser gate
выбираются из результата `agent:context`, а не из этой страницы.
