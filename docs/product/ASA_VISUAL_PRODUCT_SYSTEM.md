# ASA Lab — Visual Product System

**Status:** normative visual and interaction contract for P1–P6.  
**Owner goal:** reproduce the clarity, density and predictable workflows of Tinkercad while using the ASA Lab brand, original code and owner-provided assets.  
**Priority:** higher than ad-hoc CSS changes and local visual improvisation.

## 1. Product impression

ASA Lab must feel like one coherent creative platform, not a set of administrative pages and not an Electronics-only website.

The first five seconds after sign-in must communicate:

1. I have a personal creative workspace.
2. I can create projects in different learning environments.
3. Classes are a separate teacher workspace.
4. My work is saved and versioned.
5. Sharing, publication and classroom use are platform actions, not editor-specific hacks.

## 2. Brand direction

### 2.1. Name

Primary wordmark: `ASA Lab`.

### 2.2. Symbol

The old four-colour `A / S / A / LAB` tile mark is retired. It visually imitates the reference product, reads poorly at small sizes and does not express ASA Lab.

The replacement symbol is an original **A-flask-circuit mark**:

- a laboratory flask forms an abstract letter `A`;
- three nodes represent modular environments, projects and classrooms;
- the mark works as a 24 px toolbar icon and a 40 px portal mark;
- it does not use Autodesk/Tinkercad geometry, colours or lettering.

### 2.3. Brand palette

```text
Ink 900       #0B3558  primary brand / headings
Ink 700       #185272  active navigation / strong controls
Cyan 600      #087FA4  links / selected states
Cyan 500      #0AA4C8  primary action accent
Cyan 100      #E5F6FA  selected surfaces
Amber 500     #F2A51A  circuit node / attention accent
Slate 900     #172431  body text
Slate 600     #5D6C79  secondary text
Slate 300     #CBD5DE  borders
Slate 100     #F3F6F8  application background
White         #FFFFFF  cards and editor chrome
Success       #188353
Warning       #A76400
Danger        #B23A32
```

No random blue variants may be introduced outside design tokens.

### 2.4. Typography

- UI font: `Segoe UI Variable`, `Segoe UI`, system sans-serif.
- Portal H1: 40–48 px desktop, 30–34 px compact.
- Section heading: 24–30 px.
- Card title: 16–18 px.
- Body: 14–16 px.
- Tool labels and metadata: 11–13 px.
- Minimum text contrast: WCAG AA.

## 3. Global information architecture

Adult/teacher navigation:

```text
ASA Lab
├── Мои проекты
├── Классы
├── Учебные материалы
├── Галерея
├── Уведомления
└── Профиль
```

P1 may expose only the first two as active. Future destinations must be hidden or marked clearly as unavailable; they must not create horizontal overflow or appear as broken controls.

## 4. Portal shell

### 4.1. Header

Desktop:

```text
[ASA Lab mark + wordmark] [Мои проекты] [Классы] [Учебные материалы] [Галерея]    [уведомления] [avatar/menu]
```

Requirements:

- original ASA Lab mark;
- one active navigation underline/indicator, not multiple nested borders;
- header height 60–68 px;
- avatar opens an account menu; `Выйти` is not a permanently exposed primary navigation item in the final version;
- disabled future items are hidden on small screens;
- no Tinkercad tile-logo imitation.

### 4.2. Content frame

- maximum portal width: 1280 px;
- desktop horizontal padding: 32–48 px;
- mobile horizontal padding: 16 px;
- meaningful content begins within 80 px below the header;
- empty screens must still expose filters, create action and product context.

## 5. My Projects parity screen

### 5.1. Page layout

```text
Мои проекты                       [Создать]
[Поиск] [Все модули] [Видимость] [Сортировка] [Grid/List]

[project card] [project card] [project card]
```

### 5.2. Project card

Every card must reserve stable regions for:

- deterministic module preview;
- title;
- module name and icon;
- owner/scope (`Личный`, `Класс`, `Задание`, `Команда`);
- `updatedAt`;
- visibility (`Приватный`, `Класс`, `По ссылке`, `Публичный`);
- publication state;
- overflow menu.

Required actions by P1/P2:

```text
Открыть
Переименовать
Дублировать
Поделиться
Опубликовать / снять с публикации
Создать копию / Remix
Архивировать
Удалить
```

P1 may implement only open/rename, but the card geometry must not need redesign when P2 actions arrive.

### 5.3. Empty state

Must not be a huge blank rectangle. Use:

- compact illustration;
- clear title;
- one sentence;
- primary `Создать проект` button;
- optional module shortcuts.

## 6. Module chooser

The chooser is registry-driven. Cards are not hard-coded in portal UI.

Each module card contains:

- distinct icon/illustration;
- display name;
- one-line purpose;
- availability;
- Safe Mode support;
- optional age/level;
- `Пустой проект` / templates later.

Visual language:

- Electronics: circuit / cyan;
- Blocks: stacked blocks / violet;
- Chess & Checkers: board / warm amber;
- 3D: cube / blue-green;
- Robotics: robot/world / indigo;
- Drawing: pen/ruler / coral.

One generic Electronics icon for every module is prohibited.

## 7. Classes screen

### 7.1. Class cards

Current narrow cards with multi-line `Открыть проекты класса` buttons are rejected.

Target card:

```text
[class icon]  9В Демонстрация                 [•••]
              Активный класс
              0 учеников · 0 активных заданий

[Открыть класс]
```

Requirements:

- card minimum width 300 px;
- no button text wraps vertically;
- class opens a class workspace, not a raw project list;
- future counters have reserved layout;
- responsive grid without clipping.

### 7.2. Class workspace

```text
Обзор | Ученики | Проекты | Задания | Активность | Проверка | Оценки | Достижения | Настройки
```

P1 only prepares the shell. P4/P5 fill the sections.

## 8. Shared Editor Host

Every module editor receives the same platform chrome:

- return to My Projects / class / assignment;
- project title;
- save state;
- versions;
- duplicate;
- share/publish affordance;
- actor/profile;
- assignment context when present.

Module-specific tools live below the shared project header.

## 9. Electronics workbench visual contract

### 9.1. Hierarchy

1. Shared project header.
2. Electronics toolbar grouped by purpose.
3. Stage/workplane.
4. Component library.
5. Context inspector.
6. Simulation result/status.

### 9.2. Toolbar groups

```text
Edit: duplicate, delete, undo, redo
Wire: colour, route
Transform: rotate
View: fit, zoom
Mode: schematic/code when available
Simulation: start/stop
Project: version, save, share later
```

Every icon requires:

- accessible name;
- tooltip;
- disabled explanation;
- visible active state;
- 44×44 px pointer target where practical.

### 9.3. Stage

- stage is the dominant visual surface;
- inspector must not hide critical components or wires;
- grid contrast is subtle but visible;
- components have consistent physical scale;
- terminal hit areas are larger than visible dots;
- wires expose selection and routing handles;
- selection box must not resemble a broken dashed artifact;
- zoom/pan state is visible and recoverable through `Fit`.

### 9.4. Library

- real SVG previews from the owner component archive;
- no raster-in-SVG;
- active components first;
- future components may be visible as `Скоро`, but their previews must be real and not blank grey placeholders;
- search, categories and compact/list toggle;
- disabled cards still meet contrast requirements.

### 9.5. Inspector

- docked or floating without obscuring the right library and central work;
- selected part name, preview, parameters and measured values;
- destructive action visually separated;
- collapse control;
- future property groups reserved without empty noise.

## 10. Screenshot acceptance set

Every visual milestone must attach deterministic screenshots at:

```text
portal-projects-desktop   1440×900
portal-projects-mobile     390×844
portal-classes-desktop    1440×900
module-chooser-desktop    1280×800
workbench-empty           1600×900
workbench-circuit         1600×900
workbench-inspector       1600×900
```

Screenshots containing credentials or real student data are prohibited.

## 11. Execution plan for the coding agent

### V0 — freeze and inventory

- finish the current PR #34 gate;
- do not add new features to PR #34;
- capture current screenshots and list visual defects;
- preserve all working SVG/editor behaviour.

### V1 — brand and design tokens

- replace the four-tile mark everywhere with the ASA A-flask-circuit mark;
- introduce shared brand tokens and remove random colours;
- update portal and workbench headers;
- prove favicon/24 px/40 px readability.

### V2 — portal shell

- fix header hierarchy and responsive navigation;
- rebuild My Projects controls and stable project-card geometry;
- rebuild class cards and class workspace entry;
- keep classes separate from personal projects.

### V3 — module chooser and editor host

- render chooser from Module Registry;
- use distinct module glyphs;
- mount Electronics through shared `ModuleEditorHost`;
- keep future modules honest (`Скоро`).

### V4 — workbench polish

- group toolbar actions;
- improve tooltips and states;
- resolve component scale and inspector overlap;
- replace blank future component placeholders with genuine SVG previews;
- visually review wires, selection and diagnostics.

### V5 — accessibility and evidence

- keyboard path through portal, chooser and critical editor actions;
- focus visibility;
- contrast AA;
- 390 px portal layout without horizontal overflow;
- screenshot set and owner review.

## 12. Stop rules

The agent must stop and ask for owner review after each visible milestone. It must keep `pnpm demo` running when possible and report the exact URL and visible result.

The agent must not:

- invent a new logo;
- restore the four-colour tile mark;
- copy Autodesk branding or assets;
- make classes the required parent of personal projects;
- implement publication/community/assignments inside the visual-polish PR;
- replace owner SVG with raster images;
- claim parity from test counts without owner visual review.

## 13. Visual acceptance gate

A milestone passes only when:

1. implementation tests pass;
2. required screenshots exist;
3. owner can open the live demo;
4. the target flow is visually coherent at normal browser zoom;
5. no known clipping, broken wrapping or blank asset tiles remain;
6. visual differences from this contract are recorded and approved.