# TASK-ELECTRONICS-M1-001 work status

Execution source: `docs/delivery/EXECUTION_MANIFEST.yaml`  
Owner scope: Issue #63  
Current PR: #72

```text
task: TASK-ELECTRONICS-M1-001
branch: agent/r4-electronics-m1
status: in_progress
checkpoint: component_library_information_architecture_and_family_grouping
rejected runtime SHA: f78a9ac7578787a3a5aed73f1f2113cd36801825
owner directive: PR #72 comment 5147079314
```

Portal shell and R3A gateway remain preserved. R3B, R4-M2 and later stages are
blocked. The production assets, physical scale, pin metadata, state contracts,
breadboard data and editor integration are retained; the current correction does
not rebuild those foundations.

## Why the current checkpoint was rejected

The real editor successfully reads production assets, but the library is not an
acceptable product surface:

- all manifest entries are flattened into one long grid;
- variants of the same physical family are duplicated as separate cards;
- derived/reference battery images appear beside exact AA holder variants;
- unsupported visual-only candidates remain draggable;
- categories collapse unrelated electronics classes;
- default `Все компоненты` and three cramped columns do not follow the owner
  reference/Tinkercad library workflow.

## Active checkpoint

```text
component_library_information_architecture_and_family_grouping
```

Required result:

1. one family card with variant picker;
2. deterministic category tree and ordering;
3. default `Основные` curated supported set;
4. supported and disabled preview components strictly separated;
5. no PNG-derived `battery-1.5v`, `battery-3v`, `battery-6v`, `battery-9v` in
   the runtime library;
6. AA holders grouped as one family with 1/2/3/4/6/8×AA variants;
7. breadboards grouped as one family with 170/420/882 variants;
8. diodes grouped as one family with DO-35/DO-41 variants;
9. LED colour/brightness and resistor value remain inspector properties, not
   duplicate library cards;
10. variant selection survives save/reload/checkpoint.

## Required category structure

```text
Основные
Все компоненты
Питание
Макетки и монтаж
Пассивные
Полупроводники
Ввод и управление
Вывод и индикация
Датчики
Двигатели и приводы
Контроллеры
Измерительные приборы
В разработке
```

`Основные` contains, in order: Breadboard 420, AA holder 2×AA, resistor, LED,
button, SPDT, potentiometer, DO-41 diode, RGB LED, seven-segment and lamp.

Unsupported candidates are visible only in `В разработке`, disabled, not
clickable/draggable and unable to create a project component. They must not be
mixed into `Основные` or `Все компоненты`.

## Required library UX

- category dropdown defaults to `Основные`;
- search across family, variants and aliases;
- grid/list toggle;
- two-column default grid;
- single family search result;
- compact variant picker;
- deterministic sorting;
- sticky search/category controls;
- actual editor only, not standalone review pages.

## Focused evidence

Required tests and screenshots are defined in PR #72 comment `5147079314`.
Only focused family/category/search/variant/browser checks run before owner
review. Full repository matrix remains `NOT_RUN`.

## Prohibited until acceptance

- merge PR #72;
- full repository matrix;
- R4-M2;
- new branch;
- additional permanent Compose projects;
- new solver features;
- flat manifest-entry catalog;
- runtime placement of reference/PNG-derived battery entries.

Deploy the exact corrective SHA only in the existing `asa-lab-dev`, leave the
real Electronics project open and stop for owner review.
