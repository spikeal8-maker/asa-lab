# ASA Lab — Visual Product System

**Status:** normative visual and interaction contract for R1–R10.  
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

No random colour variants may be introduced outside design tokens.

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
├── Главная
├── Проекты
├── Классы — only when server capability/grant allows
├── Учебные материалы
├── Задачи / Challenges
├── Галерея / Explore
├── Уведомления
└── Профиль
```

Early releases may expose only implemented destinations. Future destinations must be hidden or marked clearly as unavailable; they must not create horizontal overflow or appear as broken controls.

## 4. Portal shell

### 4.1. Header

Desktop:

```text
[ASA Lab mark + wordmark] [Главная] [Проекты] [Классы*] [Learn] [Explore]   [Создать] [уведомления] [workspace] [avatar]
```

Requirements:

- original ASA Lab mark;
- one active navigation indicator;
- header height 60–68 px;
- avatar opens an account menu;
- disabled future items are hidden on small screens;
- no Tinkercad tile-logo imitation;
- navigation derives from server-issued capabilities and active context.

### 4.2. Content frame

- maximum portal width: 1280 px;
- desktop horizontal padding: 32–48 px;
- mobile horizontal padding: 16 px;
- meaningful content begins within 80 px below the header;
- empty screens still expose relevant create action and product context;
- loading, empty, error, denied, offline and success states use the same design language.

## 5. My Projects parity screen

### 5.1. Page layout

```text
Мои проекты                       [Создать]
[Поиск] [Все модули] [Scope] [Видимость] [Сортировка] [Grid/List]

[project card] [project card] [project card]
```

### 5.2. Project card

Every card reserves stable regions for:

- deterministic module preview;
- title;
- module name and icon;
- owner/scope (`Личный`, `Класс`, `Задание`, `Команда`);
- `updatedAt`;
- visibility (`Приватный`, `Workspace`, `Класс`, `По ссылке`, `Публичный`);
- publication state;
- save/conflict state where needed;
- overflow menu.

Required actions by target releases:

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

Early releases may implement only a subset, but card geometry must not require redesign when later actions arrive.

### 5.3. Empty state

Must not be a huge blank rectangle. Use:

- compact original illustration;
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
- Robotics/Sim Lab: robot/world / indigo;
- Drawing: pen/ruler / coral.

One generic Electronics icon for every module is prohibited.

## 7. Classes screen

### 7.1. Class cards

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
Обзор | Ученики | Активности | Проекты | Модерация | Соучителя | Проверка | Оценки | Достижения | Настройки
```

Sections appear only when implemented and granted; no empty fake counters or fake data.

## 8. Learner shell

```text
[ASA Lab] [Мой класс] [Задания] [Проекты] [Значки]              [Выйти]
Safe Mode / class context
```

Requirements:

- primary next action obvious;
- age-appropriate Russian copy;
- no public/social controls for StudentSeat unless future policy explicitly permits;
- no other roster members exposed;
- feedback remains scoped to project/assignment/review;
- Safe Mode communicated without fear or technical jargon;
- mobile layout prioritized.

## 9. Shared Editor Host

Every module editor receives the same platform chrome:

- return to My Projects / class / assignment;
- project title;
- save state;
- versions;
- duplicate;
- share/publish affordance by grant;
- actor/profile/workspace context;
- assignment or assistance banner when present;
- request/error state.

Module-specific tools live below the shared project header.

## 10. Electronics workbench visual contract

### 10.1. Hierarchy

1. Shared project header.
2. Electronics toolbar grouped by purpose.
3. Stage/workplane.
4. Component library.
5. Context inspector.
6. Code/instruments where active.
7. Simulation result and diagnostics.

### 10.2. Toolbar groups

```text
Edit: select, multi-select, duplicate, delete, undo, redo
Wire: create, reconnect, colour, route, bends
Transform: move, rotate, nudge
View: fit, zoom, pan, grid
Mode: design, code, schematic when confirmed
Instruments: multimeter, oscilloscope and confirmed instruments
Simulation: start, stop, reset
Project: version, save, duplicate, share later
```

Every icon requires:

- accessible name;
- tooltip;
- disabled explanation;
- visible active state;
- practical 44×44 px pointer target;
- keyboard shortcut where supported.

### 10.3. Stage

- stage is the dominant visual surface;
- inspector/library/code panels do not hide critical work without collapse/resize;
- grid contrast is subtle but visible;
- components have consistent physical scale;
- terminal hit areas are larger than visible dots;
- wires expose selection, routing and reconnect handles;
- selection box does not resemble a broken artifact;
- zoom/pan state is recoverable through `Fit`;
- simulation state is not communicated by colour alone.

### 10.4. Library

- real original SVG previews;
- no raster-in-SVG;
- active components first;
- unavailable components are honest `Скоро` cards and not draggable;
- search, categories and compact/list toggle;
- disabled cards meet contrast requirements.

### 10.5. Inspector

- selected part/wire/instrument identity and preview;
- validated parameters;
- terminals and polarity;
- measured values;
- diagnostics;
- destructive action visually separated;
- collapse/resize;
- no ownership/tenant/security fields.

## 11. Administration visual contract

Administration uses a distinct scoped shell and is not a Teacher Portal tab.

```text
[ASA Lab Admin] [Scope switcher] [Alerts] [Account]
[Navigation] [Header/actions/filters] [table/dashboard] [detail/audit drawer]
```

Requirements:

- visible scope and actor;
- dense but readable tables;
- saved filters where useful;
- dry-run/impact preview before bulk actions;
- reason and request ID for sensitive actions;
- immutable audit context;
- no plaintext credentials or tokens;
- school-admin and platform-admin surfaces visually distinct;
- support sessions display persistent banner.

## 12. Public and community surfaces

Public Project Page:

- immutable viewer;
- author/display profile;
- metadata and version;
- share;
- Copy/Remix;
- permitted interactions;
- report;
- related projects.

Explore/Profile/Collections:

- eligibility and Safe Mode enforced server-side;
- child data never exposed through card metadata;
- moderation/report states visible and consistent;
- educational feedback is not styled or stored as public comments.

## 13. Screenshot acceptance set

Core visual milestones attach deterministic screenshots for:

```text
public/sign-in/registration/join
creator-home desktop/mobile
project-hub desktop/mobile
module chooser
classes and class workspace
student home and assignment flow
shared editor host
electronics empty/library/wire/inspector/running/diagnostic/instruments/code
teacher project viewer and assistance banner
school admin and platform admin
public project/explore/profile
```

Exact screenshot IDs are defined in:

```text
docs/product/ASA_PRODUCT_SURFACE_CATALOG.yaml
docs/product/electronics/contracts/capabilities.yaml
```

Screenshots containing real credentials, student data or private work are prohibited.

## 14. Execution milestones

### V0 — freeze and inventory

- preserve working code/assets;
- capture current screenshots;
- record defects and unresolved reference evidence;
- do not claim parity from test counts.

### V1 — brand and tokens

- original A-flask-circuit mark;
- shared tokens;
- portal/editor/admin/student shells;
- favicon and small-size readability.

### V2 — Creator Portal

- Home;
- My Projects controls/cards;
- module chooser;
- Classes cards/workspace entry;
- responsive navigation.

### V3 — Editor Host and Electronics structure

- registry-driven module mounting;
- common project chrome;
- complete Electronics layout regions;
- honest future modules.

### V4 — Classroom and learner interfaces

- class workspace;
- StudentSeat provisioning/join;
- learner home;
- teacher viewer/assistance;
- Safe Mode states.

### V5 — public/community/learning

- sharing/public page/Remix;
- Profiles/Explore/Collections;
- Learn/Challenges;
- moderation.

### V6 — administration

- school admin;
- platform operations;
- support sessions;
- policy/audit/health/storage/incidents.

### V7 — accessibility and complete evidence

- keyboard/focus/contrast/reduced motion;
- mobile/touch;
- required screenshot/live-flow set;
- owner review;
- deviation register.

## 15. Stop rules

The agent must stop and request owner review after each visible milestone.

The agent must not:

- invent a new logo outside the accepted ASA mark;
- restore the reference tile mark;
- copy Autodesk branding/assets/code;
- make Classes the required parent of personal projects;
- show future tools as working;
- hide missing reference evidence;
- claim parity from unit-test counts;
- implement a subject-specific duplicate of Project/Classroom/Publication core;
- silently alter owner-approved layout/flow.

## 16. Visual acceptance gate

A milestone passes only when:

1. implementation tests pass;
2. required screenshots exist;
3. owner can open the live demo;
4. target flow is coherent at normal zoom;
5. no known clipping, broken wrapping, blank assets or inaccessible controls remain;
6. mobile/tablet behavior is accepted where applicable;
7. differences from reference flow are recorded and approved;
8. documentation status is updated from `absent/partial/in_review` only with runtime evidence.
