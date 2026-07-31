# AGENTS.md — обязательный контракт coding-агента ASA Lab

## 1. Каноническое состояние

```text
canonical branch:        main
product merge SHA:       67b4f8eea3804d750684dd1c6dce929f5f1f9bfa
completed task:          TASK-CREATOR-PORTAL-001
completed gateway:       TASK-R3A-ELECTRONICS-GATEWAY-001
active task:             TASK-ELECTRONICS-M1-001
active issue:            #63
active branch:           agent/r4-electronics-m1
status:                  in_progress / component_library_information_architecture_and_family_grouping
rejected runtime SHA:    f78a9ac7578787a3a5aed73f1f2113cd36801825
owner directive:         PR #72 comment 5147079314
owner-confirmed archive: C5BFD26760DB7A92D06E0B51B0BDE3BB45595278A762BAB3AB9198ABB04B4D75
```

`docs/delivery/EXECUTION_MANIFEST.yaml`, Issue #63 and PR #72 comment
`5147079314` are the executable sources of scope. R3B remains blocked/deferred;
R4-M2 and R5+ are not activated.

## 2. Источники истины

Читать строго в таком порядке:

1. `AGENTS.md`;
2. `docs/project-map/infrastructure-focus.yaml`;
3. `docs/project-map/project-map.yaml`;
4. `docs/delivery/EXECUTION_MANIFEST.yaml`;
5. PR #72 owner comment `5147079314`;
6. Issue #63;
7. `docs/testing/test-catalog.yaml`;
8. `docs/testing/active-task-tests.yaml`.

При конфликте остановиться и назвать точные источники. Текущий результат должен
работать в настоящем Electronics route `/projects/:projectId`; standalone review
pages не являются product delivery.

## 3. Ветка и Git

- работать только в `agent/r4-electronics-m1`;
- не создавать дополнительные ветки;
- не менять `main`, не merge, не tag, не force-push и не rebase опубликованной истории;
- не трогать PR #29 и `assistant/map-ux-owner-view`;
- не коммитить backups, dumps, credentials и приватные ZIP;
- все commits push только в PR #72.

## 4. Что уже сохраняется

Не переписывать заново:

- full owner archive inventory;
- reference и production SVG packages;
- один `WORLD_UNITS_PER_MM`;
- physical dimensions и production pin anchors;
- ordinary LED/RGB/seven-segment state contracts;
- breadboard visuals, hole IDs и connectivity metadata;
- additive schema, save/reload/checkpoint;
- текущий solver/editor foundation.

Текущий runtime SHA `f78a9ac...` не принят из-за неправильной информационной
архитектуры библиотеки, variant duplication и смешения supported/preview assets.

## 5. TASK-ELECTRONICS-M1-001 — component library IA and family grouping

### 5.1. Runtime family model

Production manifest остаётся источником asset, physical mm, pins и footprint.
Поверх него требуется family-level catalog model:

```text
familyId
variantId
familyLabel
categoryId
subcategoryId
catalogTier: core | supported | preview
catalogOrder
defaultVariantId
variants[]
searchAliases[]
simulationStatus
assetProvenance
```

Каждая карточка каталога представляет family, а не отдельный manifest asset.

### 5.2. Семейства вместо дублей

В рабочем каталоге должна быть ровно одна карточка:

- `AA battery holder` с variants `1×AA / 2×AA / 3×AA / 4×AA / 6×AA / 8×AA`, default `2×AA`;
- `Breadboard` с variants `170 / 420 / 882`;
- `Diode` с variants `DO-35 / DO-41`;
- `LED 5 mm`, где цвет/яркость выбираются в inspector;
- `Resistor`, где номинал/допуск управляют полосами;
- `Button 6×6`, `SPDT`, `Potentiometer`, `RGB LED`, `Seven-segment`, `Lamp`.

`5×AA` остаётся missing и не показывается как доступный variant.

Variant picker размещается в compact popover до placement либо в inspector.
Смена variant обязана обновлять asset, physical size, pins, defaults и сохраняться
через `variantId` после reload/checkpoint.

### 5.3. Удалить лишние reference/PNG-derived battery entries

Следующие entries не экспортируются в runtime catalog до отдельного owner
acceptance точного production SVG:

```text
battery-1.5v
battery-3v
battery-6v
battery-9v
```

Их evidence можно хранить, но они не показываются и не размещаются в editor.

### 5.4. Категории

Dropdown по умолчанию открывается в `Основные`, не в `Все компоненты`.

Обязательная структура:

1. `Основные`;
2. `Все компоненты` — только supported families;
3. `Питание`;
4. `Макетки и монтаж`;
5. `Пассивные`;
6. `Полупроводники`;
7. `Ввод и управление`;
8. `Вывод и индикация`;
9. `Датчики`;
10. `Двигатели и приводы`;
11. `Контроллеры`;
12. `Измерительные приборы`;
13. `В разработке` — disabled preview only.

Curated order в `Основные`:

```text
Breadboard 420
AA battery holder 2×AA
Resistor
LED 5 mm
Button 6×6
SPDT
Potentiometer
Diode DO-41
RGB LED
Seven-segment
Lamp
```

### 5.5. Supported и preview

- `core`/`supported`: draggable и clickable;
- `preview`: только категория `В разработке`, disabled и не draggable;
- preview item не создаёт document component;
- убрать badge `визуально` из основного каталога;
- unsupported components не возвращают fake simulation result;
- Arduino, motors, sensors, instruments и другие unsupported candidates не
  смешиваются с `Основные` или `Все компоненты`.

### 5.6. Tinkercad-like library UX

Без копирования бренда реализовать тот же рабочий принцип owner reference:

- category dropdown;
- search;
- grid/list toggle;
- default two-column grid с читаемой preview;
- family card вместо variant duplicates;
- compact variant picker;
- deterministic order;
- sticky category/search header;
- search по family/variant/aliases на русском и английском;
- один search result на family;
- library preview может быть нормализован для узнаваемости, stage остаётся в
  едином физическом масштабе.

## 6. Focused checks

До owner review запускать только:

- family/variant adapter tests;
- default category и deterministic ordering;
- one-card-per-family tests;
- hidden PNG-derived battery tests;
- category separation tests;
- supported/preview disabled behavior;
- variant create/save/reload/checkpoint tests;
- search и grid/list keyboard navigation;
- actual-editor browser smoke;
- console/pageerror/requestfailed/HTTP 5xx = 0.

Full repository matrix запрещена.

## 7. Owner-visible evidence

Screenshots только из настоящего editor:

```text
library-basic-default
library-category-power
library-family-battery-variants
library-search-led
library-supported-vs-preview
library-list-view
variant-persisted-after-reload
```

Развернуть exact final SHA только в существующем `asa-lab-dev`, оставить
настоящий Electronics project открытым на `localhost:4610` и остановиться для
owner review.

До принятия запрещены merge, full matrix, R4-M2, новая ветка, новые solver
features и дополнительные permanent Compose projects.
