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

`docs/delivery/EXECUTION_MANIFEST.yaml`, Issue #63, приложенные владельцем
reference screenshots и PR #72 comment `5147079314` являются исполняемыми
источниками scope. R3B остаётся blocked/deferred; R4-M2 и R5+ не активированы.

## 2. Источники истины

Читать строго в таком порядке:

1. `AGENTS.md`;
2. `docs/project-map/infrastructure-focus.yaml`;
3. `docs/project-map/project-map.yaml`;
4. `docs/delivery/EXECUTION_MANIFEST.yaml`;
5. PR #72 owner comment `5147079314`;
6. Issue #63;
7. owner screenshots/video/catalog evidence;
8. `docs/testing/test-catalog.yaml`;
9. `docs/testing/active-task-tests.yaml`.

При конфликте остановиться и назвать точные источники. Результат должен работать
в настоящем Electronics route `/projects/:projectId`; standalone review pages не
являются product delivery.

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

Runtime `f78a9ac...` отклонён из-за неверной информационной архитектуры
библиотеки, неправильного порядка, variant duplication и смешения
supported/reference/preview assets.

## 5. TASK-ELECTRONICS-M1-001 — exact owner-reference component shelf

### 5.1. Канонический порядок категории «Основные»

Приложенные владельцем Tinkercad screenshots доказывают следующий порядок
первых видимых позиций. Сортировать строго слева направо и сверху вниз:

```text
01 Резистор
02 Светодиод
03 Кнопка
04 Потенциометр
05 Конденсатор
06 Ползунковый переключатель
07 Батарея 9 В
08 Кнопочная батарея 3 В
09 Батарея 1,5 В
10 Малая макетная плата
11 micro:bit
12 Arduino Uno R3
13 Вибромотор
14 Двигатель постоянного тока
15 Микросерво
```

Нельзя ставить Breadboard 420 или AA holder 2×AA первыми. Продолжение списка
ниже видимой области не придумывать: брать только из owner-video/catalog evidence.

### 5.2. Геометрия и поведение shelf

Обязательный layout:

- library width `320–330 px`;
- **три колонки** в grid view;
- одинаковые компактные карточки и нормализованные thumbnails;
- category selector сверху, grid/list toggle справа;
- отдельная строка поиска;
- heading и search не прокручиваются; прокручивается только catalog body;
- название занимает максимум две строки;
- один search result на family;
- family card вместо variant duplicates;
- variant выбирается в inspector или compact popover, а не постоянным select
  под каждой grid-card;
- stage сохраняет физический масштаб, library preview нормализуется только для
  узнаваемости.

ASA Lab сохраняет собственный бренд и код. Требуется функциональная и
interaction parity согласованного reference scope, а не копирование логотипа.

### 5.3. Family и variants

Production manifest остаётся источником SVG, physical mm, pins и footprint.
Поверх него используется family model:

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

Семейства без дублей:

- `AA battery holder`: `1×AA / 2×AA / 3×AA / 4×AA / 6×AA / 8×AA`, default `2×AA`;
- `Breadboard`: `170 / 420 / 882`;
- `Diode`: `DO-35 / DO-41`;
- `LED 5 mm`: цвет и яркость в inspector;
- `Resistor`: сопротивление и допуск управляют четырьмя полосами;
- `Button 6×6`, `SPDT`, `Potentiometer`, `RGB LED`, `Seven-segment`, `Lamp`.

`5×AA` остаётся missing reference. `variantId` сохраняется после
save/reload/checkpoint.

### 5.4. Exact order и честная готовность

Категория «Основные» обязана показывать позиции 01–15 в reference order.
Наличие позиции в этом порядке не разрешает ложную функциональность:

- production-ready item — clickable/draggable;
- ещё не готовая позиция — `aria-disabled`, не draggable и не создаёт component;
- raw PNG/reference images запрещены в runtime;
- батарея 9 В, coin-cell 3 В и элемент 1,5 В включаются только после прозрачного
  production SVG, physical/pin contract и focused acceptance;
- unsupported item не возвращает fake current/voltage/simulation success.

AA holders остаются одним family в категории `Питание`; они не заменяют три
reference battery cards в «Основных».

### 5.5. Категории

Dropdown по умолчанию открывается в `Основные`.

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

Search работает по family, variant и русским/английским aliases. Порядок
детерминирован и не зависит от порядка файлов manifest.

## 6. Параметрический резистор

Owner-authored correction уже находится в ветке:

```text
apps/web/public/assets/electronics/production/components/resistor-axial-body.svg
apps/web/public/assets/electronics/production/components/resistor-axial-preview.svg
apps/web/src/electronics/ProductionComponentVisual.tsx
apps/web/src/electronics/component-preview.tsx
apps/web/src/electronics/testing/resistor-visual.spec.ts
```

Контракт:

- прозрачный SVG без white canvas, raster, base64 или foreignObject;
- physical size `4.354 × 11.582 mm`;
- реальные верхний и нижний leads;
- четыре стабильные semantic band zones;
- library preview = `300 Ω ±5%`;
- stage bands вычисляются из resistance + tolerance;
- проверить `220 Ω`, `300 Ω`, `330 Ω`, `1 kΩ`, `4.7 kΩ`, `10 kΩ`, `1 MΩ`;
- проверить `±1/2/5/10%`;
- production manifest/adapter привести к единому resistor asset contract без
  возврата к opaque legacy SVG.

## 7. Focused checks

До owner review запускать только:

- `resistor-visual.spec.ts` и resistor-band contract tests;
- exact order tests для позиций 01–15;
- three-column/grid/list checks;
- family/variant and one-card-per-family tests;
- disabled unsupported behavior;
- search order и keyboard navigation;
- variant create/save/reload/checkpoint;
- actual-editor browser smoke;
- console/pageerror/requestfailed/HTTP 5xx = 0.

Full repository matrix запрещена.

## 8. Owner evidence и stop condition

Screenshots только из настоящего editor:

```text
library-basic-exact-order
library-basic-three-columns
library-power-holder-family
library-disabled-future-items
resistor-220ohm
resistor-4k7
resistor-1m
resistor-after-reload
```

Развернуть exact final SHA только в существующем `asa-lab-dev`, оставить
настоящий Electronics project открытым на `localhost:4610` и остановиться.

До owner acceptance запрещены merge, full matrix, R4-M2, новая ветка, новые
solver features и дополнительные permanent Compose projects.
