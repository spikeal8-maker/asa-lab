# Tinkercad owner-video evidence — 2026-07-27

**Status:** private reference evidence for the ASA Lab parity programme.  
**Source:** owner-provided screen recording, 300.516667 seconds, 1920×1080, 60 fps, 18,031 frames.  
**Privacy:** the source contains account, class and learner identifiers. The raw video and unredacted screenshots must not be committed to the repository.

## Method

- all 18,031 frames were decoded by an FFmpeg scene-change pass;
- 278 transition frames were indexed;
- 150 periodic samples at two-second intervals were reviewed;
- 43 full-resolution keyframes were used to verify labels, controls and layout;
- the recording was divided into authentication, dashboard/account, Circuits editor and Classroom/learner-work segments.

This document records only visible behaviour. Missing flows remain `unverified`.

## Main conclusion

The reference product is not a teacher-only dashboard and not one editor. It combines four layers:

1. contextual account entry;
2. a creator dashboard with projects, classes, collections, learning content and challenges;
3. full-screen subject editors under a common Project identity;
4. classroom supervision with class codes, Safe Mode, learners, activities, projects and co-teachers.

ASA Lab must therefore implement account/capability/context foundations before treating the Electronics workbench as the complete product shell.

## Timeline and verified surfaces

| Time | Surface | Verified visible behaviour | ASA Lab requirement |
|---|---|---|---|
| 00:00–00:09 | Public landing | Public marketing page, product navigation, login and registration entry. | Add an unauthenticated product shell. |
| 00:09–00:17 | Contextual sign-in chooser | `Преподаватели`, `Учащиеся с кодом класса`, `Учетные записи учащихся`, `Личные учетные записи`, registration link. | Separate educator, class-code, student-account and personal-account entry paths. A client choice cannot grant a role. |
| 00:17–00:45 | Personal authentication | External account sign-in, then return to Tinkercad. | Preserve contextual entry while ASA Lab owns its identity implementation. |
| 00:45–01:08 | Session return | Loading/redirect states, then creator dashboard. | Deterministic post-login route and honest loading/error handling. |
| 01:08–01:17 | Home | Global top navigation, persistent left workspace navigation, announcement card, module-grouped recent projects. | Home is a creator dashboard, not a classes-only page. |
| 01:17–01:20 | Classes list | Tabs for teaching, archive, co-teaching and registered classes; create class; bulk actions; sort; dense row list. | Class list is operational and role-aware. |
| 01:20–01:22 | Projects | Module filters (`Все`, `3D`, `Цепи`, `Блоки кода`), search, trash, sort, dense preview cards. | My Projects must be module-aware and searchable. |
| 01:22–01:24 | Collections | Collection empty state and create actions. | Collections/bookmarks are a platform surface. |
| 01:24–01:27 | Learning content | Own learning projects, progress states, resume/view actions and recommendations. | Learning content is distinct from Projects and Assignments. |
| 01:27–01:39 | Challenges/account menu | Challenge empty state; account menu with New project, My projects, Notifications, Settings, My classes and Logout. | Use an account menu instead of a permanently exposed logout action. |
| 01:39–01:50 | Settings | Edit profile, account settings, child accounts and child activity. Account security includes sign out on all devices. | Account settings are a first-class product surface. |
| 01:50–02:02 | Managed child accounts | Status, Safe Mode toggle, last activity and per-row menu. | Model managed-child policy separately from Classroom StudentSeat. |
| 02:02–02:12 | Managed child activity | Filtered activity feed showing created projects plus block/edit actions. | Supervision events must be auditable and separate from a public social feed. |
| 02:18–02:28 | Creator project open | User returns to the dashboard and opens an existing Circuits project without a class. | Personal projects do not require a classroom. |
| 02:28–02:38 | Circuits editor shell | Project name, common project actions, mode controls, edit toolbar, Code, simulation, Send, right component library, search, category and collapse control. | Full-screen subject editor under shared project chrome. |
| 02:38–02:50 | Component placement | Drag battery, resistor and LED; distinct scales; visible terminals. | Genuine vector assets, drag/drop and terminal metadata. |
| 02:50–03:18 | Wiring | Terminal-to-terminal wire creation, bends/vertices, colour/route controls, attached endpoints. | Wires are editable geometric objects, not a text list. |
| 03:18–03:50 | Simulation/properties | Running state, LED state change, component properties, live measurements and invalid-state diagnostics. | Separate editing/simulation state; module provider supplies diagnostics and visual states. |
| 03:50–04:24 | Alternate editor views | Component categories and schematic/BOM-like modes. | A module may expose several views under one Project. |
| 04:32–04:38 | Class selection | Teacher opens a class from the dense class list. | A class opens a class workspace, not a raw project list. |
| 04:38–04:42 | Class workspace | Tabs `Учащиеся`, `Действия`, `Проекты`, `Модерация`, `Коллеги-преподаватели`; class code/share link; global Safe Mode; roster, search/sort, badges and per-learner controls. | This is the P4 class-shell contract. |
| 04:42–04:44 | Open learner | Teacher selects a learner from the roster. | Teacher access must be authorised by class membership and audited. |
| 04:44–04:52 | Learner project gallery | Learner switcher, previous/next, privacy state, module tabs, sort, grid/list and project cards. | Teacher needs a module-aware learner portfolio view. |
| 04:52–04:58 | Learner project detail | Exact preview, simulate, owner/class context, edit action, classroom share link, privacy/visibility, dates and report action. | Reuse a universal Project Viewer for teacher review and exact-version views. |

## Verified information architecture

### Contextual entry

```text
Sign in
├── In school
│   ├── Educators
│   ├── Students with class code
│   └── Student accounts
└── On your own
    └── Personal accounts
```

This is an entry router, not a trusted persistent role switch.

### Authenticated portal shell

Top-level discovery and global actions coexist with a left account workspace:

```text
Home
Classes
Projects
Collections
Tutorials
Challenges
Help
```

The full-screen editor removes the dashboard sidebar.

### Server-side account model implied by the flow

```text
Account
├── personal creator profile
├── capabilities: creator, educator, guardian, school_admin, platform_admin
├── organization memberships
├── classroom memberships
├── managed-child links
└── entitlements
```

The UI chooses a context; the server grants capabilities.

### Class workspace

A class owns a code/share link, Safe Mode policy, roster and separate tabs for learners, activities, projects, moderation and co-teachers. It is not the mandatory container for an adult's personal project.

## Current ASA Lab gaps established by this recording

| Area | Current state | Required next state |
|---|---|---|
| Public entry | teacher-oriented login | public landing and contextual entry chooser |
| Registration | absent | personal registration, educator onboarding, student-account and class-code paths |
| Account settings | minimal | profile, security, sessions, organizations, notifications and managed children |
| Capability context | teacher presentation is effectively hard-coded | server capabilities plus workspace/context switcher |
| Global shell | Projects and Classes only | Home, Classes, Projects, Collections, Learning, Challenges and Help |
| Projects | early cards | module tabs, search, sort, trash, stable preview/metadata/action layout |
| Electronics | technical alpha | richer wire/property/simulation/alternate-view parity |
| Classroom | create/list only | code, Safe Mode, roster, activities, projects, moderation and co-teachers |
| Learner work | absent | learner gallery and exact Project Viewer for teacher |

## Required implementation order from this evidence

1. **Account/onboarding foundation:** public landing, contextual sign-in, personal registration, educator onboarding, student/class-code entry, account settings, capabilities, memberships and context switcher.
2. **Creator portal shell:** Home, module-aware My Projects, Collections/Learning/Challenges placeholders with correct navigation and account menu.
3. **Shared Project/Module host:** registry-driven create chooser and common editor/viewer chrome.
4. **Electronics parity:** keep the solver/lifecycle and align workbench interactions and visual states.
5. **Classroom parity:** class code, Safe Mode, roster, activities, projects, moderation, co-teachers and learner work viewer.
6. **Assignments/publication/community:** only after separate reference evidence is captured.

## Not verified in this recording

- new-user registration fields, age and consent;
- educator verification and organization creation;
- school/platform admin console;
- billing/checkout;
- exact class-code learner sign-in after code entry;
- full assignment/submission/grade flow;
- publication dialog, Explore, public comments, likes and Remix flow.

These must remain open reference tasks rather than being invented.
