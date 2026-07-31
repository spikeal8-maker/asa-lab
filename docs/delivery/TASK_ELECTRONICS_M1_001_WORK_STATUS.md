# TASK-ELECTRONICS-M1-001 work status

Execution source: `docs/delivery/EXECUTION_MANIFEST.yaml`  
Owner scope: Issue #63  
Current PR: #72

```text
task: TASK-ELECTRONICS-M1-001
branch: agent/r4-electronics-m1
status: in_progress
checkpoint: owner_reference_component_shelf_and_parametric_resistor
rejected runtime SHA: f78a9ac7578787a3a5aed73f1f2113cd36801825
owner directive: PR #72 comment 5147079314
```

Portal shell, R3A gateway, production assets, physical scale, pin metadata,
state contracts, breadboard data and editor integration remain preserved. R3B,
R4-M2 and later stages remain blocked.

## Why the current runtime was rejected

The editor consumes production assets, but its component shelf does not follow
the supplied owner reference:

- the previous specification incorrectly requested two columns;
- the current reference clearly uses three columns;
- Breadboard 420 and AA holder 2×AA were incorrectly placed before the resistor;
- family grouping and supported/preview separation were incomplete;
- the resistor visual did not have a clean transparent body and precisely aligned
  dynamic colour bands.

## Canonical visible order in «Основные»

The supplied screenshots prove this first visible sequence, read left-to-right
and top-to-bottom:

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

The ordering below the visible screenshot must come only from owner-video/catalog
evidence; it must not be invented.

## Required shelf behavior

- default category `Основные`;
- panel width 320–330 px;
- three compact columns;
- category selector, grid/list toggle and a separate search row;
- one card per family;
- normalized thumbnails in the shelf, physical scale on stage;
- max two text lines per card;
- variant choice in inspector or compact popover;
- one result per family and deterministic search/order;
- category body scrolls while category/search controls remain fixed.

Unsupported positions may occupy their canonical slot, but they are disabled,
not draggable and cannot create a document component. Raw PNG/reference assets
are forbidden in runtime. AA holders remain one family under `Питание`; they do
not replace the reference battery cards in `Основные`.

## Parametric resistor correction

Added to the active branch:

```text
apps/web/public/assets/electronics/production/components/resistor-axial-body.svg
apps/web/public/assets/electronics/production/components/resistor-axial-preview.svg
apps/web/src/electronics/ProductionComponentVisual.tsx
apps/web/src/electronics/component-preview.tsx
apps/web/src/electronics/testing/resistor-visual.spec.ts
apps/web/src/electronics/workbench-tinkercad-parity.css
```

The body is transparent and physically sized at `4.354 × 11.582 mm`. Four
semantic band zones are driven by resistance and tolerance. The shelf preview is
`300 Ω ±5%`; stage visuals must be checked at `220 Ω`, `300 Ω`, `330 Ω`, `1 kΩ`,
`4.7 kΩ`, `10 kΩ` and `1 MΩ`, with tolerances `±1/2/5/10%`.

The production manifest/adapter still must be reconciled to this single resistor
asset contract; return to the old opaque pixel-vector resistor is forbidden.

## Focused evidence required

- resistor visual and band-contract tests;
- exact order tests for positions 01–15;
- three-column/grid/list tests;
- one-card-per-family and search-order tests;
- disabled unsupported behavior;
- variant save/reload/checkpoint;
- actual editor browser smoke;
- console/pageerror/requestfailed/HTTP 5xx = 0.

Screenshots from the actual editor:

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

Full repository matrix remains `NOT_RUN`. Merge, R4-M2, new branches, new solver
features and additional permanent Compose projects are prohibited. Deploy only
the exact corrective SHA to the existing `asa-lab-dev`, leave the real project
open and stop for owner review.
