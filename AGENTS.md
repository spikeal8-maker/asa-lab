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
checkpoint:              owner_visual_correction_in_progress
rejected implementation: cfce81c163d69310f8091b558968f79145496a3a
owner UI reference:      supplied Tinkercad screenshot at 100 percent
owner-confirmed archive: C5BFD26760DB7A92D06E0B51B0BDE3BB45595278A762BAB3AB9198ABB04B4D75
```

`docs/delivery/EXECUTION_MANIFEST.yaml`, Issue #63 and the latest explicit
owner directive define the executable scope. R3B remains blocked/deferred;
R4-M2 and R5+ are not activated.

## 2. Источники истины

Читать строго в таком порядке:

1. `AGENTS.md`;
2. latest explicit owner directive and supplied 100% screenshot;
3. `docs/project-map/infrastructure-focus.yaml`;
4. `docs/project-map/project-map.yaml`;
5. `docs/delivery/EXECUTION_MANIFEST.yaml`;
6. Issue #63 and PR #72;
7. owner archive evidence;
8. `docs/testing/test-catalog.yaml`;
9. `docs/testing/active-task-tests.yaml`.

Результат должен работать в настоящем Electronics route `/projects/:projectId`;
standalone review pages не являются product delivery.

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

Не добавлять новые компоненты, solver features, API или persistence changes.

## 5. Owner-reference presentation contract

Присланный owner screenshot является единственным UI reference. Сохранить ASA
Lab branding, но воспроизвести его геометрию, плотность, иерархию, shelf
behavior, terminal behavior, selection и wiring presentation.

### 5.1. Idle stage

- viewport для review = `100%`;
- светло-серое поле и спокойная тонкая сетка;
- terminal hit areas невидимы;
- terminal marker радиусом не более 3 world units виден только при hover,
  active wiring или reconnect;
- selection компонента не показывает все terminals;
- pins, уже установленные в breadboard holes, не получают внешние markers;
- pin labels видны только в active wiring state;
- `workbench-snap-link` отсутствует после drop;
- нет постоянного красного glow;
- error presentation на stage допустима только при запущенной simulation,
  severity=error и выбранном компоненте;
- результаты/diagnostics не перекрывают idle project.

### 5.2. Selection и wiring

- selection = тонкая спокойная синяя рамка без массивного dashed outline;
- масштаб компонента при selection не меняется;
- inspector содержит действия и свойства;
- после выбора pin появляется компактный набор доступных terminals;
- после завершения или отмены wire вспомогательные markers исчезают.

### 5.3. Desktop component shelf

```text
width:           330 px
grid:            3 columns
column gap:      8 px
row gap:         10 px
catalog padding: 10 px
card:            approximately 96 x 126 px
image area:      78 x 74 px
name:            maximum 2 lines
```

Grid card содержит только изображение и название. Запрещены постоянные variant
labels/selects, technical IDs и badges поверх изображения. Варианты открываются
compact popover по обычному click; drag использует последний выбранный вариант;
variant также доступен в inspector и `variantId` сохраняется.

`workbench-tinkercad-parity.css` запрещён. Все итоговые правила находятся в
одном `workbench.css`.

### 5.4. Точный порядок `Основные`

Слева направо, сверху вниз:

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

Unsupported position остаётся на каноническом месте с чистым vector preview,
`aria-disabled=true`, `draggable=false` и не создаёт document component. PNG,
raster, base64 и случайные runtime assets запрещены.

## 6. Toolbar и header

- одинаковая высота и вертикальное выравнивание;
- последовательные action groups;
- единый размер icons и hit areas;
- понятные disabled, hover, active и focus-visible states;
- `Начать моделирование` — визуально доминирующий primary action.

## 7. Focused checks

До owner acceptance запускать только:

- production asset/state/breadboard contracts;
- exact basic order, disabled-card и presentation contracts;
- terminal hover/wiring/idle visibility;
- variant persistence;
- focused web lint/typecheck/build;
- один actual-editor Playwright journey;
- console/pageerror/requestfailed/HTTP 5xx = 0.

Full repository matrix запрещена.

## 8. Owner evidence и stop condition

Перед screenshot: simulation off, selection cleared, pending wire cleared,
diagnostics closed, viewport 100%, small breadboard и четыре components.

Screenshots только из настоящего editor:

```text
editor-idle-clean
library-basic-three-columns
library-basic-exact-order
component-hover-terminal
wiring-mode-terminals
component-selected
breadboard-placement-clean
library-disabled-components
owner-reference-vs-current
```

После публикации screenshots остановиться. Не называть результат принятым и не
переводить PR №72 в OWNER REVIEW без отдельного подтверждения владельца. Не
merge, не запускать full matrix, не начинать R4-M2, не создавать новую ветку и
не создавать дополнительные Compose projects.
