# Tinkercad reference video analysis for ASA Lab

**Source:** owner-provided screen recording `2026-07-27 17-39-35.mp4`.  
**Recording:** 300.516667 s, 1920×1080, 60 fps, H.264/AAC, 18,031 video frames.  
**Data classification:** every account, class and learner identifier shown in the recording is synthetic test data supplied by the owner. The source may be stored in the private ASA Lab project evidence area. Public redistribution still requires owner approval because the recording captures a third-party product interface.

## Analysis method

- All 18,031 frames were decoded by FFmpeg's scene-change analyser.
- 278 transition frames were indexed.
- 150 periodic samples at 2-second intervals were reviewed.
- 43 full-resolution keyframes were extracted for controls, labels and layout.
- The source was divided into four functional clips: authentication, account/dashboard, circuits editor, classroom/student work.
- This report records visible behaviour. Anything not shown is marked as unverified rather than inferred as fact.

## Executive conclusion

Tinkercad is not organised around a single teacher dashboard or a single editor. It has four interlocking product layers:

1. **Contextual entry and identity** — educator, class-code learner, registered learner and personal account entry are separate paths into one platform.
2. **Creator dashboard** — personal projects, classes, collections, tutorials and challenges share a common account shell.
3. **Subject editors** — Circuits is a full-screen module editor with its own workbench chrome while retaining common project identity, save/version/share actions.
4. **Classroom and supervised learner work** — teachers manage class codes, Safe Mode, students, activities, projects, co-teachers and exact learner project views.

ASA Lab must therefore implement account/capability/context foundations before treating the current Electronics workbench as the platform shell.

---

## Time-coded reference inventory

| Time | Surface | Visible behaviour and controls | ASA Lab contract |
|---|---|---|---|
| 00:00–00:09 | Public landing | Public marketing page, persistent top navigation, login and registration entry. | Add a public unauthenticated shell; do not route every visitor directly to teacher login. |
| 00:09–00:17 | Contextual sign-in chooser | Full-screen `С возвращением`; asks how Tinkercad is used. School: `Преподаватели`, `Учащиеся с кодом класса`, `Учетные записи учащихся`; independent: `Личные учетные записи`; registration link below. | Implement separate educator, class-code, student-account and personal-account entry paths. Do not use a trusted client-side role switch. |
| 00:17–00:45 | Personal account authentication | Redirect to Autodesk account sign-in, email/username identity, then return to Tinkercad. | ASA Lab owns its account system but preserves this separation between entry context and server-authorised capabilities. |
| 00:45–01:08 | Session return and dashboard loading | Redirect, loading states, browser prompt overlay, then creator dashboard. | Implement deterministic post-login route and robust loading/error state. |
| 01:08–01:17 | Home dashboard | Top global nav; left account sidebar; announcement card; horizontal sections by module (`3D-проекты`, `Цепи`); project cards with preview, title, relative time, visibility, copy/remix and like counters. | Dashboard must present creative work across modules, not classes only. Cards need stable preview/metadata/action geometry. |
| 01:17–01:20 | Classes list | `Ваши уроки`; tabs `Преподавание`, `В архиве`, `Совместное преподавание`, `Зарегистрированные`; create class; bulk actions; sort; row list with learner count, creation date, overflow menu. | Class list should be dense, operational and role-aware. Archive/co-teacher states are first-class. |
| 01:20–01:22 | Projects hub | `Ваши проекты`; filters `Все`, `3D`, `Цепи`, `Блоки кода`; search, trash, sort; dense project-card grid. | My Projects is module-aware and supports search/filter/sort/trash. |
| 01:22–01:24 | Collections | Empty collection state; top and central create actions. | Collections/bookmarks are a platform capability, not editor-specific. |
| 01:24–01:27 | Tutorials/learning content | `Ваши учебные пособия`; own learning projects; progress pills `В процессе выполнения`, `Завершено`; resume/view actions; recommended content carousels. | Learning content is separate from Projects and Assignments; progress state is visible. |
| 01:27–01:39 | Challenges and account menu | Empty challenges state. Avatar menu exposes account name, new project, my projects, notifications, settings, my classes and logout. | Account menu replaces permanently exposed logout; global actions are available from any dashboard surface. |
| 01:39–01:50 | Profile/account settings | Dedicated settings shell: edit profile, account settings, child accounts, child activity. Account security links and sign-out-all-devices. | Implement account settings as a first-class product area before full admin console. |
| 01:50–02:02 | Managed child accounts | Child-account table: status, Safe Mode toggle, last active, per-row menu. | Model parent/guardian/managed-child relationships separately from classroom StudentSeat. Safe Mode is server policy. |
| 02:02–02:12 | Child activity | Filtered activity feed showing which managed child created which project; block and edit actions. | Add auditable supervised-account activity; do not mix it with public social feed. |
| 02:12–02:18 | Educator information surface | Authenticated user can open educator-oriented landing/help content and return. | Global Learn/Educator resources remain accessible outside classes. |
| 02:18–02:28 | Return to dashboard and open circuit project | User returns to creator dashboard and opens an existing circuit project. | Personal project opening is independent of class context. |
| 02:28–02:38 | Circuits editor shell | Full-screen editor; project name; module/mode controls; edit toolbar; Code, simulation and send actions; right component library with category, search, grid/list and collapse; left stage controls. | Editor must be a dedicated full-screen module surface under a shared Project header. |
| 02:38–02:50 | Component placement | Drag battery, resistor and LED from catalogue; components retain distinct visual scale and terminals; selected catalogue tile is highlighted. | Genuine vector assets, drag/drop and terminal metadata are mandatory. |
| 02:50–03:18 | Wiring | Click/drag terminals to create wires; free bends/vertices are created; colour and route controls are in toolbar; wire endpoints stay attached to components. | Wires are editable geometric objects with colour, vertices and attached terminal references. |
| 03:18–03:50 | Simulation and properties | Start simulation; green running state; LED visual changes; selected component shows properties and live measurements; error/diagnostic indicators appear for invalid polarity/conditions. | Separate edit and simulation state; module provider supplies diagnostics, state assets and measurements. |
| 03:50–04:24 | Alternate views and component browsing | Catalogue category changes; schematic/BOM-like alternate views are opened; selection/property controls continue to work. | Module may expose multiple editor/viewer modes under common project chrome. |
| 04:24–04:32 | Save/return | Project remains associated with account and returns to dashboard. | Autosave plus explicit project/version actions; navigation back to Project Hub. |
| 04:32–04:38 | Class selection | Teacher opens a class from the dense class list. | Class opens a class workspace, not just a project list. |
| 04:38–04:42 | Class workspace | Tabs: `Учащиеся`, `Действия`, `Проекты`, `Модерация`, `Коллеги-преподаватели`; class code; share-class-link; Safe Mode for all; add learner; class roster; search/sort; student rows with type, username, last active, badges, Safe Mode and overflow actions. | This is the required P4 class shell and roster contract. |
| 04:42–04:44 | Open learner | Teacher opens a learner from roster. | Teacher access is class-authorised and auditable. |
| 04:44–04:52 | Learner project gallery | Student selector with previous/next; privacy pill; edit profile; module tabs `Все`, `3D-проекты`, `Цепи`, `Блоки кода`, `Учебные пособия`; sort and grid/list; project gallery mirrors creator project cards. | Teacher sees learner portfolio by module without silently editing drafts. |
| 04:52–04:58 | Learner project detail | Large project modal with exact preview; simulate; owner/class context; edit action; copy class link; privacy/visibility; created/edited dates; report action; project overflow menu. | Universal Project Viewer is reused for teacher review, sharing and exact-version views. |
| 04:58–05:00 | Return to learner gallery | Detail closes without losing gallery/filter context. | Preserve navigation state and selected learner. |

---

## Verified product architecture

### A. Identity and context entry

The video proves that the entry decision is not a persistent role toggle. It is an authentication/onboarding router:

```text
Return / Sign in
├── In school
│   ├── Educators
│   ├── Students with class code
│   └── Student accounts
└── On your own
    └── Personal accounts
```

One authenticated adult account can expose personal creator tools, classes, settings and managed child accounts. ASA Lab should model capabilities and memberships on the server:

```text
Account
├── personal creator profile
├── capabilities: creator, educator, guardian, school_admin, platform_admin
├── organization memberships
├── classroom memberships
├── managed child links
└── entitlements
```

The UI may choose a context, but cannot grant a capability.

### B. Global application shell

The authenticated portal has two navigation levels:

- top global discovery/navigation: product areas, gallery, learning, educator resources, global search/create, avatar;
- left account workspace: Home, Classes, Projects, Collections, Tutorials, Challenges, Help.

The subject editor removes the dashboard sidebar and uses a dense full-screen workbench.

### C. Personal creator workspace

`Home` is not an empty dashboard. It combines:

- announcement/editorial hero;
- recent/selected work grouped by module;
- module-specific project cards;
- visibility and social/remix counters.

`Projects` is the durable project library. `Collections`, `Tutorials` and `Challenges` are separate concepts.

### D. Classroom workspace

A class has an explicit code, share link, Safe Mode policy, roster and distinct tabs. It is a supervised educational workspace, not the container for every teacher project.

### E. Learner supervision

The teacher can:

- browse learners;
- inspect last activity, badges and Safe Mode;
- open a learner's module-filtered project gallery;
- open a project viewer with exact privacy, dates and class-sharing controls.

The teacher view is structurally close to the creator/public project viewer. ASA Lab should reuse one viewer shell with grants instead of building unrelated review screens.

### F. Circuits module

The Circuits module is defined by:

- full-screen stage;
- dense common project header;
- component library and search;
- drag/drop components;
- visible physical terminals;
- editable wires with bends and colours;
- component properties;
- simulation state and diagnostics;
- alternate schematic/list modes.

The current ASA Lab Electronics foundation covers only a subset of this contract.

---

## What the video does not verify

The following were not shown and must not be invented from this recording:

- new-user registration form details and age/consent flow;
- educator verification and organization creation;
- platform/school admin console;
- billing/checkout;
- exact assignment authoring flow beyond the Activities announcement;
- submission/revision/grade workflow;
- public publication dialog, Explore, public comments, likes and remix flow;
- collaboration permissions;
- exact learner sign-in after class-code entry.

Separate evidence is still required.

---

## Gap assessment against current ASA Lab

| Area | Current ASA Lab | Reference requirement | Priority |
|---|---|---|---|
| Public entry | Teacher-oriented login only | Public landing plus contextual educator/student/personal entry | Blocker P0.5 |
| Registration | Not implemented | Personal registration, student account, class-code join, educator onboarding | Blocker P0.5 |
| Account settings | Minimal logout only | Profile, security, sessions, notifications, organizations, managed children | Blocker P0.5 |
| Capability context | Hard-coded teacher presentation | Server capabilities and workspace/context switcher | Blocker P0.5 |
| Global shell | Projects/classes only | Home, Classes, Projects, Collections, Learning, Challenges, Help, global create/search | P0.5/P1 |
| My Projects | Basic cards | Module tabs, search, sort, trash, stable preview/meta/actions | P1 |
| Module registry | In progress | One registry drives chooser/editor/viewer/preview/all platform surfaces | P1 |
| Electronics | Technical alpha | Visual terminals, richer wire editing, alternate views, polished property/simulation UX | P1B |
| Classroom | Create/list classes | Class code, Safe Mode, roster, activities, projects, moderation, co-teachers | P4 |
| Learner work | Missing | Learner gallery and exact project viewer for teacher | P4 |
| Account supervision | Missing | Managed child accounts and activity | P0.5/P4 policy decision |
| Admin | Backlog | Separate school/platform console, not role switch | After P0.5 foundation |
| Billing | Schema only/backlog | Entitlements first; provider checkout later | After product value |

---

## Recommended implementation order after this evidence

### R0 — Evidence and contract freeze

- accept this video report as a private reference source;
- capture missing registration and class-code flows separately;
- update parity matrix and deviations;
- stop ad-hoc visual changes outside approved milestones.

### R1 — Account, onboarding and portal shell

Implement first:

```text
public landing
→ contextual sign-in chooser
→ personal sign-up/sign-in
→ educator entry/onboarding
→ student account sign-in
→ class-code join entry
→ account/profile/settings shell
→ server capabilities and memberships
→ account menu and workspace/context switcher
```

Minimal admin bootstrap is included only to grant/revoke capabilities and create organizations. A full admin dashboard is not first.

### R2 — Project hub and module host

- Home dashboard grouped by module;
- My Projects with module tabs/search/sort/trash;
- collections and tutorial placeholders with correct information architecture;
- registry-driven Create action;
- shared Editor Host.

### R3 — Electronics parity pass

- keep the existing solver and project lifecycle;
- align workbench chrome, library, terminals, wires, properties, simulation and alternate views with this reference;
- use only genuine owner SVG assets.

### R4 — Classroom and learner work

- class code/share link;
- roster and StudentSeat;
- Safe Mode;
- Activities, Projects, Moderation and Co-teacher tabs;
- learner gallery and exact version viewer.

### R5 — Assignment/review/publication/community

Proceed only with separate evidence packages for the missing flows.

---

## Acceptance rule

A test count cannot establish parity. Each release requires:

1. live browser demonstration;
2. reference screenshot/video comparison;
3. negative permission tests;
4. owner review;
5. a recorded deviation when ASA Lab intentionally differs.
