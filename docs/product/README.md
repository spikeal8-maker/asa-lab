# ASA Lab — Product Documentation

Цель продукта описывают [`PRODUCT_BLUEPRINT.md`](PRODUCT_BLUEPRINT.md) и
[`CAPABILITY_MAP.yaml`](CAPABILITY_MAP.yaml). Долговременные контракты модулей
расположены в их поддиректориях.

Эта страница не хранит активную задачу. Получить точное состояние и документы
нужного направления:

```bash
pnpm agent:context --list
pnpm agent:context --scope <lane>
```

Единственный источник выполнения —
[`../execution/current.yaml`](../execution/current.yaml). Каталог программы —
[`../delivery/EXECUTION_MANIFEST.yaml`](../delivery/EXECUTION_MANIFEST.yaml),
архитектурный граф — [`../project-map/project-map.yaml`](../project-map/project-map.yaml),
стабильные проверки — [`../testing/test-catalog.yaml`](../testing/test-catalog.yaml).

## Правило документации

Product docs отвечают на вопросы «что должно уметь изделие» и «как это
проверяется». Task, branch, checkpoint, SHA и текущий результат gate в них не
копируются. Историческое решение помечается датой или релизом и не выдаётся за
текущее состояние.
