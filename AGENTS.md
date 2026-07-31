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
status:                  in_progress
checkpoint:              owner_visual_review_pending
rejected runtime SHA:    f78a9ac7578787a3a5aed73f1f2113cd36801825
owner directive:         PR #72 comment 5147079314
owner-confirmed archive: C5BFD26760DB7A92D06E0B51B0BDE3BB45595278A762BAB3AB9198ABB04B4D75
```

`docs/delivery/EXECUTION_MANIFEST.yaml`, Issue #63 and the explicit owner
directive for PR #72 define the executable scope. R3B remains blocked/deferred;
R4-M2 and R5+ are not activated.

## 2. Источники истины

Читать строго в таком порядке:

1. `AGENTS.md`;
2. `docs/project-map/infrastructure-focus.yaml`;
3. `docs/project-map/project-map.yaml`;
4. `docs/delivery/EXECUTION_MANIFEST.yaml`;
5. PR #72 owner comment `5147079314`;
6. Issue #63;
7. owner archive evidence;
8. `docs/testing/test-catalog.yaml`;
9. `docs/testing/active-task-tests.yaml`.

При конфликте остановиться и назвать точные источники. Результат должен работать
в настоящем Electronics route `/projects/:projectId`; standalone review pages не
являются product delivery.

## 3. Ветка и Git

- работать только в `agent/r4-electronics-m1`;
- не создавать дополнительные ветки;
- не менять `main`, не merge, не tag, не force-push;
- не переписывать опубликованную историю;
- не трогать PR #29 и `assistant/map-ux-owner-view`;
- не коммитить backups, dumps, credentials и приватные ZIP;
- все commits push только в PR #72.

## 4. Сохранённая основа

Не переписывать заново:

- full owner archive inventory и audit SHA `9654ce3`;
- reference и production SVG packages;
- один `WORLD_UNITS_PER_MM`;
- physical dimensions и production pin anchors;
- ordinary LED/RGB/seven-segment state contracts;
- breadboard visuals, hole IDs и connectivity metadata;
- additive schema, save/reload/checkpoint;
- текущий solver/editor foundation;
- прозрачный parametric resistor body/preview и semantic band zones.

Runtime `f78a9ac...` отклонён из-за плоской библиотеки, variant duplication и
смешения supported/preview assets. Новая solver-функциональность не входит в
текущий corrective scope.

## 5. TASK-ELECTRONICS-M1-001 — family component library

### 5.1. Runtime family model

Production manifest остаётся источником asset, physical mm, pins и footprint.
Поверх него используется family-level model:

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

Каждая карточка runtime-каталога представляет family, а не отдельный файл
manifest.

### 5.2. Семейства и варианты

В рабочем каталоге должна быть ровно одна карточка:

- `AA battery holder` с variants `1×AA / 2×AA / 3×AA / 4×AA / 6×AA / 8×AA`, default `2×AA`;
- `Breadboard` с variants `170 / 420 / 882`, default `420`;
- `Diode` с variants `DO-35 / DO-41`, default `DO-41`;
- `LED 5 mm`, где colour/brightness остаются inspector properties;
- `Resistor`, где value/tolerance остаются inspector properties и управляют
  четырьмя цветовыми полосами;
- `Button 6×6`, `SPDT`, `Potentiometer`, `RGB LED`, `Seven-segment`, `Lamp`.

`5×AA` остаётся missing reference. Compact variant picker доступен до placement
и в inspector. `variantId` обязан сохраняться после save/reload/checkpoint.

### 5.3. Runtime battery exclusions

Следующие PNG-derived/reference entries не экспортируются в runtime library:

```text
battery-1.5v
battery-3v
battery-6v
battery-9v
```

Legacy document fallback сохраняется, но новые проекты не показывают и не
создают эти entries.

### 5.4. Категории и порядок

Dropdown по умолчанию открывается в `Основные`:

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

Порядок детерминирован и не зависит от порядка файлов manifest.

### 5.5. Supported и preview

- `core`/`supported`: draggable и clickable;
- `preview`: только категория `В разработке`, disabled и не draggable;
- preview card не создаёт document component;
- unsupported candidates не смешиваются с `Основные` или `Все компоненты`;
- unsupported components не возвращают fake simulation success.

### 5.6. Library UX

- category dropdown и отдельный search;
- **две колонки по умолчанию**;
- grid/list toggle;
- family card вместо variant duplicates;
- compact variant picker;
- search по family, variants и русским/английским aliases;
- один search result на family;
- heading/search остаются видимыми, прокручивается catalog body;
- library preview нормализуется для узнаваемости, stage остаётся в едином
  физическом масштабе.

## 6. Параметрический резистор

Сохранить уже опубликованные owner-reference assets и focused contract:

```text
apps/web/public/assets/electronics/production/components/resistor-axial-body.svg
apps/web/public/assets/electronics/production/components/resistor-axial-preview.svg
apps/web/src/electronics/testing/resistor-visual.spec.ts
```

Контракт:

- transparent SVG без raster, base64, foreignObject или canvas background;
- physical size и leads определяются production contract;
- четыре стабильные semantic band zones;
- library preview = `300 Ω ±5%`;
- stage bands вычисляются из resistance + tolerance;
- поддерживаются focused values `220 Ω`, `300 Ω`, `330 Ω`, `1 kΩ`, `4.7 kΩ`,
  `10 kΩ`, `1 MΩ` и tolerances `±1/2/5/10%`.

## 7. Focused checks

До owner review запускать только:

- production asset/state/breadboard contracts;
- family/category/order/search tests;
- one-card-per-family и disabled-preview behavior;
- resistor visual/band contract tests;
- variant create/save/reload/checkpoint;
- focused web lint/typecheck/build;
- один actual-editor Playwright journey;
- console/pageerror/requestfailed/HTTP 5xx = 0.

Full repository matrix запрещена.

## 8. Owner evidence и stop condition

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
настоящий Electronics project открытым на `localhost:4610` и остановиться.

До owner acceptance запрещены merge, full matrix, R4-M2, новая ветка, новые
solver features и дополнительные permanent Compose projects.
