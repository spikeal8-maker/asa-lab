# ASA Lab — целевой системный blueprint

**Статус:** нормативный целевой контракт продукта и платформы.  
**Приоритет:** выше отдельных вертикальных срезов, локальных UI-решений и временных migration shortcuts.  
**Основание:** архитектурный baseline ASA Lab, три owner-video Tinkercad reference-пакета, Tinkercad parity specification, Visual Product System и фактически созданные основы Teacher Portal, Project/Draft/Version, Module Registry и Electronics Workbench.  
**Цель:** воспроизвести целостную продуктовую модель Tinkercad, не уничтожая уже реализованные безопасные основы ASA Lab, а переводя их в более сильную глобальную модель идентичности, рабочих пространств, проектов, классов и модулей.

---

## 0. Нормативная иерархия

При конфликте документов применяется следующий порядок:

1. этот blueprint;
2. датированное owner-video evidence;
3. `TINKERCAD_PARITY_SPEC.md` и parity matrix;
4. `ASA_VISUAL_PRODUCT_SYSTEM.md`;
5. архитектурный baseline;
6. конкретная Issue/PR;
7. локальное решение coding-агента.

Owner-video evidence уточняет ранее сделанные предположения. В частности:

- после входа целевой landing — **Home / Главная творческого пользователя**;
- `Мои проекты` остаётся центральной библиотекой проектов, но не единственным экраном портала;
- Classes, Projects, Collections, Learning content, Challenges и Help — самостоятельные поверхности;
- один Account может быть creator, educator, guardian, co-teacher и administrator в разных scoped contexts;
- StudentSeat без email и зарегистрированный ученик — разные типы principal;
- Safe Mode ограничивает публикацию и социальные действия, но не творчество.

---

## 1. Целевой продукт

ASA Lab — не электронный симулятор и не школьная админка. Это единая модульная творческо-образовательная платформа:

```text
Public Product
├── публичная главная
├── вход
├── регистрация
├── присоединение к классу
├── опубликованные проекты
└── справка

Creator Platform
├── Главная
├── Проекты
├── Коллекции
├── Обучение
├── Задачи / Challenges
├── Галерея / Explore
├── Профиль
└── Уведомления

Module Platform
├── Электроника
├── Блочное программирование
├── Шахматы / шашки
├── 3D
├── Робототехника
├── Рисование / черчение
└── будущие среды

Classroom Platform
├── Классы
├── Учащиеся
├── Действия / Activities
├── Проекты
├── Модерация
├── Соучителя
├── Проверка
├── Оценки
└── Достижения

Operations
├── настройки аккаунта
├── рабочие пространства
├── безопасность и сессии
├── school administration
├── platform administration
├── entitlements / планы
└── audit / support
```

---

## 2. Что уже создано и не должно быть потеряно

Следующие основы сохраняются и усиливаются:

- PostgreSQL как источник истины;
- tenant boundary, composite foreign keys и RLS defense-in-depth;
- runtime DB role без `BYPASSRLS`;
- modular monolith Control Plane;
- append-only `audit_events`;
- Project / mutable ProjectDraft / immutable ProjectVersion;
- idempotency и request fingerprint;
- personal project без обязательного класса;
- Classroom и текущие классы/данные;
- существующий seed-педагог и его проекты;
- Module Registry / Editor Host направление;
- Electronics solver, vector assets, save/reload/checkpoint;
- owner-provided SVG assets и asset safety gate;
- local-first test runner, port policy и governance validators;
- оригинальная визуальная система ASA Lab.

Запрещено ради новой модели:

- удалять текущие классы или проекты;
- переименовывать tenant-scoped `users` в `accounts` одной миграцией;
- снимать RLS ради упрощения;
- заставлять личные проекты принадлежать классу;
- смешивать StudentSeat и Account;
- смешивать global capability и scoped membership role;
- переписывать Electronics solver без предметной причины;
- создавать второй несвязанный audit log;
- доверять роли, tenant или workspace из request body.

---

## 3. Experience Plane: целевые приложения и маршруты

### 3.1. Публичное приложение

```text
/
/sign-in
/sign-up
/join-class
/help
/projects/:publicSlug
```

Главные действия анонимного пользователя:

```text
Создать аккаунт
Войти
Присоединиться к классу
```

После выбора входа показывается контекстный router:

```text
В школе
├── Педагог
├── Ученик с кодом класса
└── Зарегистрированный ученик

Самостоятельно
└── Личный аккаунт
```

Router выбирает flow, но **не выдаёт capability**.

### 3.2. Creator Portal

Целевой default route после обычного account login:

```text
/home
```

Навигация:

```text
Главная
Классы — только при разрешённом classroom context
Проекты
Коллекции
Обучение
Задачи / Challenges
Справка
```

Глобальные действия:

```text
Создать
Поиск
Уведомления
Workspace switcher
Account menu
```

### 3.3. Full-screen Editor Host

```text
/projects/:projectId/editor
/classrooms/:classroomId/projects/:projectId/editor
/assignments/:assignmentId/work/:projectId/editor
```

Editor Host скрывает portal sidebar и предоставляет общую platform chrome:

- возврат в правильный контекст;
- название проекта;
- save state;
- версии;
- duplicate;
- share/publish affordance;
- actor/context;
- assignment banner при необходимости;
- предметный editor ниже общей панели.

### 3.4. Classroom Workspace

```text
/classrooms
/classrooms/:id/overview
/classrooms/:id/students
/classrooms/:id/activities
/classrooms/:id/projects
/classrooms/:id/moderation
/classrooms/:id/coteachers
/classrooms/:id/review
/classrooms/:id/grades
/classrooms/:id/badges
/classrooms/:id/settings
```

### 3.5. Administration

```text
/admin             platform operations
/workspaces/:id/admin   organization/school administration
```

Админка не является вкладкой обычного Teacher Portal. Доступ появляется только из server grants.

---

## 4. Principal model

`Principal` — единственный универсальный субъект владения, сессий и аудита.

```text
Principal
├── AccountPrincipal
├── StudentSeatPrincipal
├── ServicePrincipal
└── SupportSessionPrincipal (reserved)
```

### 4.1. Account

Глобальная идентичность, не принадлежащая одному tenant:

```text
Account
- id
- emailNormalized
- passwordHash
- country
- birthDate
- agePolicyResult
- emailVerificationState
- accountState
- createdAt
```

### 4.2. Profile

Отдельно от credentials:

```text
Profile
- accountId
- username
- displayName
- bio
- avatar
- visibility
- locale
- timeZone
```

### 4.3. StudentSeat

Не является урезанным Account:

```text
StudentSeat
- principalId
- workspaceId
- classroomId
- displayLabel
- loginHandleNormalized
- safeModePolicyId
- status
- lastActiveAt
```

StudentSeat может не иметь email и глобального публичного профиля.

### 4.4. Managed child

`ManagedChildLink` связывает guardian Account с постоянным детским Account. Он не заменяет StudentSeat и не создаётся автоматически из Classroom membership.

---

## 5. Capabilities, memberships и active context

Три разных понятия нельзя объединять в поле `role`.

### 5.1. Global capabilities

```text
creator
educator
registered_student
guardian
platform_admin
```

CapabilityGrant:

```text
state: provisional | verified | suspended | revoked
policyVersion
grantedBy
reason
grantedAt
reviewedAt
revokedAt
```

### 5.2. Workspace roles

```text
owner
member
educator
school_admin
billing_admin
moderator
```

`school_admin` существует только внутри конкретного Organization Workspace.

### 5.3. Classroom grants

```text
classroom.view
classroom.roster.manage
classroom.activity.assign
classroom.student_work.view
classroom.comment.write
classroom.review.write
classroom.grade.write
classroom.badge.award
classroom.settings.manage
```

### 5.4. ActiveContext

```text
principalId
workspaceId
classroomId optional
assignmentId optional
sessionId
```

Workspace switcher меняет `ActiveContext`, но не capabilities и не memberships.

---

## 6. Workspace model и сохранение tenant isolation

### 6.1. Типы workspace

```text
personal
organization
```

При регистрации Account получает ровно один Personal Workspace.

Organization Workspace создаётся позднее или подключается через invitation/membership.

### 6.2. Связь с текущим tenant

Текущий `tenant_id` сохраняется как security/storage boundary.

```text
Workspace
- id
- tenantId UNIQUE
- kind
- name
- status
```

В первой миграционной версии один Workspace соответствует одному Tenant. Это позволяет не переписывать все tenant-owned таблицы и RLS policies.

### 6.3. Personal Workspace

- создаётся idempotently;
- принадлежит Account;
- содержит личные проекты;
- может содержать пилотные классы при educator capability;
- не называется школой в UI;
- не требует school record.

### 6.4. Organization Workspace

- содержит школы, периоды, педагога и администраторов;
- имеет policies, entitlements и module availability;
- может позднее иметь dedicated placement/on-premise.

---

## 7. Account state machines

### 7.1. Взрослый аккаунт

```text
anonymous
→ registration_started
→ active_unverified_email
→ active_verified_email
→ suspended
→ deleted
```

Adult pilot account может до email verification:

- входить;
- создавать личные проекты;
- получать provisional educator grant;
- создавать пилотный класс.

До verification запрещены high-risk operations:

- public publication;
- co-teacher invitation;
- organization administration;
- platform administration;
- sensitive exports.

### 7.2. Детский зарегистрированный аккаунт

```text
registration_started
→ credentials_created
→ pending_approval
   ├── approved_by_guardian
   ├── approved_by_educator_class
   ├── declined
   └── expired
→ active_safe_mode
→ active_standard only by policy
→ suspended/deleted
```

### 7.3. Educator grant

Начальная policy ASA Lab:

```text
minimum self-attestation age = 18
```

```text
none
→ provisional
→ verified
→ suspended
→ revoked
```

Каждый переход серверный и аудируемый.

### 7.4. StudentSeat

```text
issued
→ active
→ suspended
→ archived
→ revoked
```

Архивирование класса отзывает join code и seat sessions, но не удаляет проекты и immutable history.

---

## 8. Authentication and session model

### 8.1. Account login

Основной flow:

```text
email + password
→ account session
→ permitted workspaces
→ default Personal Workspace
```

Workspace slug больше не обязателен до authentication.

Текущий `workspace + email + password` сохраняется временно как compatibility flow.

### 8.2. StudentSeat login

Parity v1:

```text
class code + assigned login handle
```

PIN зарезервирован как optional deployment policy, default `off`.

Обязательны:

- grouped-code normalization;
- hash at rest;
- code rotation/revocation;
- одинаковая ошибка для существующего/несуществующего handle;
- rate limit;
- отдельная seat session;
- Safe Mode по умолчанию.

### 8.3. Sessions

Account и StudentSeat не используют одну неразличимую session-модель.

```text
Session
- principalId
- activeWorkspaceId
- assuranceLevel
- createdAt
- expiresAt
- revokedAt
- lastSeenAt
- client metadata
```

Account settings показывают active sessions и поддерживают `sign out all devices`.

---

## 9. Creator Portal

### 9.1. Home

Default landing после account/seat login:

- announcement/onboarding;
- recent projects grouped by module;
- recent classes/activity;
- learning recommendations;
- continue actions;
- Safe Mode banner for learner principal.

### 9.2. Projects

- module tabs;
- search;
- sort;
- grid/list;
- trash/archive;
- stable project cards;
- personal, classroom, assignment and team scope;
- visibility and publication metadata;
- open/rename/duplicate/share/publish/archive/delete actions according to permission.

### 9.3. Collections, Learning, Challenges

Это отдельные contexts:

- Collection — пользовательская подборка;
- Learning content — tutorials/progress/resume;
- Challenge — добровольный creator challenge;
- Assignment — выданная учебная работа.

Они не объединяются в одну таблицу `tasks`.

---

## 10. Universal Project and Module Platform

### 10.1. Project lifecycle

```text
Project
→ ProjectDraft
→ ProjectVersion
→ ProjectPreview
→ Share / Publish / Assignment / Remix
```

`ProjectVersion` immutable.

### 10.2. Ownership

```text
projects.owner_principal_id
```

Account и StudentSeat владеют проектами через `Principal`. Teacher visibility ученика следует из Classroom grants, а не teacher ownership.

### 10.3. Module contract

Каждый модуль предоставляет:

```text
manifest
createEmptyProject
editor
viewer
preview
validate
migrate
analyse/run optional
copy/remix support
assignment starter support
review anchor validation
safe mode declaration
```

Core не содержит subject switches.

### 10.4. Активные и planned modules

- Electronics — первый active module;
- Blocks, Chess/Checkers, 3D, Robotics, Drawing — registry entries until editors are implemented;
- `coming_soon` не является fake active module.

---

## 11. Classroom target

### 11.1. Class creation

- title;
- GradeBand/age band;
- topic tags;
- Safe Mode default;
- academic period optional;
- workspace context;
- code/share link.

### 11.2. Class workspace

```text
Students
Activities
Projects
Moderation
Co-teachers
Review
Grades
Badges
Settings
```

### 11.3. StudentSeat provisioning

- one seat;
- bulk import;
- display label != login handle;
- preview before commit;
- duplicate detection;
- row-level results;
- idempotency;
- printable/QR credential cards;
- reset/suspend/revoke/archive.

### 11.4. Teacher monitoring

```text
Roster
→ Learner Portfolio
→ Project Viewer
→ exact ProjectVersion
→ Version History
```

Teacher access is read-only by default and audited. Assistance mode requires explicit entry, persistent banner and audit events.

---

## 12. Publication and community

### 12.1. Visibility

```text
private
class
organization
unlisted
public
```

### 12.2. Publication

Draft save and publication are separate operations. Publication points to immutable ProjectVersion.

### 12.3. Assignment lock

Assignment work and submissions never become public automatically.

### 12.4. Community

- published project page;
- copy/remix lineage;
- profile/portfolio;
- Explore;
- likes/bookmarks;
- public comments;
- reports/moderation.

Public social actions are disabled for StudentSeat and restricted by Safe Mode.

---

## 13. Administration, plans and payments

### 13.1. Minimal administration first

Platform bootstrap must support:

- create/suspend workspace;
- invite/revoke educator;
- grant/revoke school admin role;
- inspect audit;
- manage module availability;
- manage entitlement;
- revoke sessions/codes.

### 13.2. Full admin later

- support console;
- moderation queue;
- usage and quotas;
- billing accounts;
- plans/subscriptions;
- organization policies;
- regional/on-premise placement.

### 13.3. Payments

Billing provider is not a prerequisite for registration or pilot use. Domain foundation:

```text
Plan
Entitlement
BillingAccount
Subscription
UsageLedger
Quota
```

Initial entitlement:

```text
Free / School Pilot
```

---

## 14. Control Plane bounded contexts

```text
Identity & Access
Profiles & Preferences
Workspace & Tenancy
Classroom
Projects & Versions
Module Catalog
Publication & Sharing
Community & Collections
Learning & Curriculum
Assignments & Assessment
Safety & Moderation
Notifications
Billing & Entitlements
Support & Admin
Compliance & Audit
```

Контексты взаимодействуют через public ports и events. Прямая запись в чужие таблицы запрещена.

---

## 15. Audit and events

Используется единый append-only `audit_events`.

Обязательные события:

```text
account.registered
account.email_state_changed
session.created
session.revoked
workspace.created
workspace.switched
capability.educator_attested
capability.granted
capability.revoked
classroom.created
classroom.archived
classroom.code_rotated
student_seat.created
student_seat.login
student_seat.suspended
project.created
project.version_created
project.visibility_changed
project.published
student_project.opened_by_teacher
assistance_mode.started
assistance_mode.ended
submission.reviewed
grade.changed
badge.awarded
```

Критические события используют Transactional Outbox; consumers idempotent.

---

## 16. Неразрушающий переход

Новая модель внедряется additively:

1. новые global identity tables;
2. backfill текущего seeded teacher;
3. Personal Workspace поверх существующего tenant boundary;
4. новый principal-aware session path;
5. compatibility adapter для старого login;
6. feature-flagged public registration;
7. постепенный перевод Projects/Classrooms на principal/workspace IDs;
8. удаление legacy columns только после двух подтверждённых release gates и backup/rollback proof.

Детальный порядок находится в `ASA_IDENTITY_WORKSPACE_TRANSITION_PLAN.md`.

---

## 17. Release plan

```text
R0   Product/evidence contract freeze
R1   Account, Profile, Personal Workspace, Sessions, Educator Grant
R2   Creator Home and full Portal shell
R3   Module Registry, Project Hub and Editor Host
R4   Electronics parity
R5   Classroom shell and StudentSeat lifecycle
R6   Learner portfolio and teacher Project Viewer
R7   Sharing, publication and Remix
R8   Profiles, Explore, Collections and moderation
R9   Activities, assignments, submission, review, grades and badges
R10  Multi-module proof and scalable operations
```

Каждый release имеет owner browser review. Количество тестов не заменяет визуальную и продуктовую приёмку.

---

## 18. Anti-regression rules for coding agents

Coding-agent не имеет права:

- начинать с UI без ссылки на target release и evidence;
- доверять client role/workspace/tenant;
- создавать новый auth system в предметном модуле;
- требовать класс для personal project;
- считать StudentSeat обычным Account;
- давать educator/admin capability из dropdown;
- публиковать mutable draft;
- изменять immutable ProjectVersion;
- добавлять subject-specific branches в Core;
- удалять legacy данные до verified cutover;
- называть passing tests визуальным acceptance;
- проходить следующий owner-review milestone без подтверждения владельца.

Перед изменением агент обязан указать:

1. release и capability;
2. actor/principal;
3. workspace/context;
4. permission source;
5. data ownership;
6. migration/compatibility impact;
7. visible browser result;
8. negative security tests;
9. rollback path;
10. owner-review stop point.

---

## 19. Остающиеся reference gaps

Нельзя молча придумывать:

- формальную проверку educator сверх self-attestation;
- точные age thresholds по всем юрисдикциям;
- полную school/platform admin UX;
- полный Activity/Assignment flow;
- public project page details, comments/likes/Remix UX;
- billing/checkout UX;
- optional StudentSeat PIN policy;
- окончательные retention periods.

Они должны быть либо подтверждены evidence, либо оформлены owner-approved parity deviation.
