# ASA Lab — полная спецификация интерфейса ученика

**Статус:** нормативный кандидат R0.  
**Машиночитаемые страницы:** `STU-*` и public join surfaces в [`ASA_PRODUCT_SURFACE_CATALOG.yaml`](ASA_PRODUCT_SURFACE_CATALOG.yaml).  
**Classroom contract:** [`TINKERCAD_EDUCATOR_CLASSROOM_PARITY_SPEC.md`](TINKERCAD_EDUCATOR_CLASSROOM_PARITY_SPEC.md).

## 1. Два разных типа ученика

### Registered student

Имеет Account/Principal, может иметь Personal Workspace и долгосрочное портфолио. Публичность зависит от возраста, consent, Workspace policy и Safe Mode.

### StudentSeat

Не является «урезанным Account».

```text
StudentSeatPrincipal
classroom/workspace scoped
email не требуется
отдельный credential/session type
Safe Mode по умолчанию
публичный профиль отсутствует
```

Visual shell может быть похожим, но identity/session/permissions остаются разными.

## 2. Главные цели learner UX

В первые пять секунд после входа ученик должен понимать:

1. в каком классе/контексте он находится;
2. что нужно сделать сейчас;
3. где продолжить работу;
4. сохранилась ли работа;
5. есть ли обратная связь;
6. включён ли Safe Mode;
7. как безопасно выйти.

Интерфейс не должен выглядеть как административная таблица.

## 3. Learner shell

```text
┌──────────────────────────────────────────────────────────────┐
│ ASA Lab | Мой класс | Задания | Проекты | Значки      Выйти │
│ 8К2 · Safe Mode включён                                     │
├──────────────────────────────────────────────────────────────┤
│ Сегодня / Скоро / Требует доработки                         │
│                                                              │
│ [карточка задания] [продолжить проект] [обратная связь]      │
└──────────────────────────────────────────────────────────────┘
```

Rules:

- class/workspace context visible;
- display label, не private username/email;
- no public profile controls for StudentSeat;
- no other roster member list;
- no unrestricted messages;
- no hidden publication controls;
- all teacher feedback tied to project/assignment/review context.

## 4. Вход по коду класса

```text
enter class code/link
→ class identity preview without roster
→ choose StudentSeat or registered Account
→ enter handle/credential or Account login
→ server resolves one Principal
→ create scoped session
→ Learner Home
```

### Code screen

Must show:

- formatted input;
- normalization of spaces/dashes/case;
- generic invalid/expired message;
- rate-limit state;
- privacy/help notice;
- no class roster enumeration.

### StudentSeat login

Inputs:

- handle/display credential;
- secret credential;
- show/hide secret;
- help from teacher.

Never show whether the handle exists before credential validation in a way that enables enumeration.

## 5. Learner Home

Blocks:

```text
Continue work
Due soon
Changes requested
Classes
Recent feedback
Badges
Safe Mode/privacy
```

Card fields:

- title;
- class/activity;
- module icon;
- state;
- due date;
- last saved;
- primary action;
- teacher feedback indicator;
- offline/reconnect state.

Empty state explains what will appear after teacher assignment; it does not show fake sample grades or fake activity.

## 6. Classes

Student sees only authorized class memberships.

Class card:

- class title;
- teacher display name according to policy;
- active assignments count;
- recent feedback;
- Safe Mode;
- open action.

Student does not see:

- complete roster;
- co-teacher grants;
- join code after session unless policy permits;
- moderation/admin controls;
- other students' projects.

## 7. Assignments list

Groups:

```text
not_started
in_progress
submitted
changes_requested
resubmitted
accepted
late
excused
```

Filters:

- class;
- module;
- status;
- due range.

Each card shows exact status and one next action. `submitted` is not displayed as editable draft success.

## 8. Assignment detail

Sections:

```text
Instructions
Starter preview/version
Due date and attempt policy
My work status
Teacher feedback
Submission history
```

Actions:

- start;
- continue;
- open current draft;
- submit exact version;
- open feedback;
- resubmit after changes requested.

The immutable starter ProjectVersion is never edited. AssignmentWork is a separate learner-owned draft.

## 9. Assignment editor context

Shared Editor Host includes an unavoidable banner:

```text
Assignment: Электрическая цепь
Class: 8К2
Due: 15 September 18:00
Publication locked
Status: In progress / Changes requested
```

Actions:

- module tools;
- autosave/manual retry;
- version/checkpoint if policy permits;
- open instructions;
- open feedback;
- submit.

No Share/Public controls while `publicationLocked=true`.

## 10. Submission

Flow:

```text
open submit
→ show exact ProjectVersion preview and saved time
→ optional learner note
→ confirm
→ create immutable SubmissionAttempt
→ show receipt/status
```

Must prevent:

- submission of unsaved invisible draft;
- mutating submitted version;
- replacing old attempt history;
- double submit from repeated request;
- publishing assignment work publicly.

## 11. Feedback and revision

Student sees:

- decision/status;
- general comments;
- component/object/code anchors;
- rubric/grade if released;
- teacher display identity;
- timestamps;
- attempt/version target;
- revision action.

Anchored feedback opens the relevant module viewer/editor location.

No private direct-message thread exists. Reply, if allowed, remains inside the review thread.

## 12. Learner projects

### Registered student

May have:

- Personal projects;
- Classroom projects;
- AssignmentWork;
- team projects later;
- private portfolio;
- public eligibility only by policy/consent.

### StudentSeat

May have:

- class projects;
- assignment work;
- teacher-enabled private personal practice if policy permits;
- no public publishing by default;
- no public profile by default.

Cards use the universal Project Hub model but hide forbidden actions server-side and visually.

## 13. Badges

Badge page shows:

- badge name/icon;
- skill category;
- criteria;
- teacher/class;
- awarded date;
- evidence link to authorized work/result;
- revoked state/reason if applicable.

Badges are not automatically inferred from arbitrary telemetry. Award evidence is explicit and audited.

## 14. Profile, privacy and Safe Mode

Student page explains in plain language:

- current principal type;
- classes;
- Safe Mode;
- what can be shared;
- who can see work;
- whether public profile/publication is allowed;
- how to ask teacher/guardian for help;
- sign-out.

StudentSeat can edit only policy-permitted display fields. It cannot convert itself to Account silently.

## 15. Notifications

Allowed notification types:

- assignment published/updated;
- due reminder;
- teacher feedback;
- changes requested;
- accepted;
- grade released;
- badge awarded/revoked;
- credential reset warning;
- class archived;
- Safe Mode/policy change appropriate for learner.

No promotional or public-social notification is shown to StudentSeat unless explicitly allowed by future policy.

## 16. Error and offline behavior

### Offline/reconnecting

- visible state;
- local unsaved warning;
- no false `saved`;
- retry;
- conflict-safe recovery copy if server version changed.

### Authorization denial

Use safe messages:

```text
Эта работа недоступна в вашем текущем классе или аккаунте.
```

Do not reveal another learner/project existence.

### Credential expiration/reset

- session revoked;
- clear teacher-help instructions;
- no exposure of old credential;
- no data loss.

## 17. Accessibility and age suitability

- plain Russian language;
- no unexplained technical IDs;
- keyboard support;
- screen-reader labels;
- contrast AA;
- minimum practical touch targets;
- reduced motion;
- no dark patterns;
- no deceptive public/share controls;
- primary next action visually clear;
- errors connected to fields;
- dates/times localized.

## 18. Required screenshots

```text
join-class-code
join-class-choice
studentseat-sign-in
student-home-desktop
student-home-mobile
student-classes
student-assignments
student-assignment-detail
assignment-work-editor
submission-confirmation
student-feedback
student-projects
student-badges
student-profile-safe-mode
student-notifications
student-authorization-denied
student-offline-reconnecting
```

Use synthetic learners only. No real names, credentials or work.

## 19. Required end-to-end flows

### StudentSeat first lesson

```text
teacher creates seat
→ learner enters class code
→ chooses assigned handle
→ signs in without email
→ opens assignment
→ edits project
→ reloads and sees saved work
→ submits exact version
→ sees submitted receipt
```

### Revision cycle

```text
teacher requests changes with anchor
→ learner opens feedback
→ anchor focuses exact object/code location
→ learner edits own draft
→ resubmits new version
→ old attempt remains immutable
```

### Safe Mode negative

```text
StudentSeat tries public publish/comment/profile access
→ denied server-side
→ no forbidden control or data leak
→ AuditEvent/policy evidence where required
```

### Registered learner

```text
Account login
→ Personal Workspace
→ private personal project
→ joins class
→ sees both personal and class contexts
→ permissions remain scope-specific
```

## 20. Definition of Done

Learner experience is complete only when:

- StudentSeat and Account sessions remain distinct;
- no-email class-code flow works;
- learner sees only authorized classes/projects/assignments;
- Safe Mode is enforced server-side;
- save/reload/offline states are honest;
- immutable submit/revision cycle works;
- feedback anchors work across modules;
- grades/badges reference exact evidence;
- no unrestricted child messaging exists;
- all screenshots/live flows accepted by owner;
- accessibility/mobile gates pass;
- teacher can reset credential without losing work;
- cross-class/tenant negative tests pass.
