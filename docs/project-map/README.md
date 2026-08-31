# Project Map

- [`project-map.yaml`](project-map.yaml) — структурный граф архитектуры и
  истории программы;
- [`../delivery/EXECUTION_MANIFEST.yaml`](../delivery/EXECUTION_MANIFEST.yaml) —
  каталог результатов программы;
- [`PROJECT_MAP.md`](PROJECT_MAP.md) — короткое человекочитаемое объяснение;
- [`QUALITY_MAP.md`](QUALITY_MAP.md) — устройство проверок;
- [`viewer.html`](viewer.html) — интерактивный граф.

Живое состояние не хранится в этой директории. Его короткий срез:

```bash
pnpm agent:context --list
pnpm agent:context --scope <lane>
```

Полный источник — [`../execution/current.yaml`](../execution/current.yaml).

## Validation

```bash
python tools/validate_project_map.py
python tools/validate_delivery_program.py
python tools/validate_test_catalog.py
```

Валидатор запрещает возвращать в map поля текущего focus или checkpoint.
