# ASA Lab Learning — техническое задание на реализацию учебной системы

**Документ:** Master Technical Specification / общее техническое задание  
**Версия:** 2.0  
**Дата:** 23 августа 2026  
**Целевой продукт:** ASA Lab  
**Целевая область:** курсы, задания, тесты, STEM-проекты, попытки, сдача, оценивание, журнал, multi-school  
**Рекомендуемое место в репозитории:** `docs/product/ASA_LEARNING_TECHNICAL_SPEC.md`

---

## 0. Статус ТЗ

Настоящий документ является **Master Technical Specification / архитектурно-техническим контрактом** на целевую реализацию учебного контура ASA Lab.

Документ определяет:

- конечную архитектуру;
- обязательные доменные сущности;
- жизненные циклы;
- правила версионирования;
- выдачу материалов аудитории;
- попытки и неизменяемые сдачи;
- Quiz Engine;
- ручную и автоматическую проверку;
- журнал;
- course completion/result;
- multi-school;
- каталог и копирование;
- media immutability;
- UI-контракты;
- API;
- логическую модель БД;
- RLS/authorization;
- миграцию legacy;
- non-functional requirements;
- обязательные тесты;
- порядок внедрения;
- Definition of Done.

Документ описывает **TARGET**. Наличие требования в ТЗ не означает, что функция уже существует.

Быстро меняющийся CURRENT-статус должен храниться отдельно и не изменять смысл настоящего ТЗ.

### 0.0.1. Граница точности этого документа

Это ТЗ определяет **семантику, инварианты, доменную модель, UX-контракты и обязательные acceptance criteria**.

Оно НЕ заменяет milestone-specific implementation package.

Перед реализацией каждого milestone `M0…M7` MUST быть создан отдельный execution spec, который фиксирует:

```text
точные изменяемые файлы
точные migration SQL / DDL
точные OpenAPI schemas
transaction boundaries
indexes / constraints / RLS policies
feature flags / cutover
rollback
test IDs
owner-visible acceptance evidence
```

Если master ТЗ и milestone execution spec расходятся по продуктовой семантике, побеждает master ТЗ.
Если execution spec уточняет физическую реализацию без изменения семантики, используется execution spec.

---

## 0.1. Нормативные слова

- **MUST / ОБЯЗАН** — обязательное требование.
- **MUST NOT / ЗАПРЕЩЕНО** — недопустимое поведение.
- **SHOULD / СЛЕДУЕТ** — рекомендуемое поведение; отклонение требует документированной причины.
- **MAY / МОЖЕТ** — допустимая опция.
- **MVP** — минимальный объём для реального учебного цикла.
- **FUTURE** — функция, не блокирующая School Learning MVP.

---

## 0.2. Иерархия истины

| Вопрос | Источник истины |
|---|---|
| Что необходимо построить | это ТЗ |
| Что выполняется сейчас | `docs/execution/current.yaml` |
| Что реально существует | код + миграции |
| Что реально работает | CI + integration + browser evidence |
| Что принято владельцем | owner acceptance |
| Что было раньше | старые docs/issues/screenshots только как история |

---

# 1. Цель проекта

## 1.1. Бизнес-цель

ASA Lab должна предоставлять преподавателю единый учебный цикл:

```text
создать материал
→ опубликовать неизменяемую версию
→ назначить аудитории
→ ученик выполняет
→ создаёт попытку
→ сдаёт неизменяемый результат
→ система/учитель проверяет
→ при необходимости пересдача
→ выбранный итог попадает в журнал
→ ученик видит тот же опубликованный результат
```

## 1.2. Обязательные сценарии

Система MUST полноценно поддерживать:

1. отдельное задание классу;
2. отдельный тест классу;
3. STEM-проект классу;
4. курс с теорией + тестами + практиками;
5. один материал нескольким классам;
6. материал группе;
7. материал отдельным ученикам;
8. поздно присоединившегося ученика;
9. вышедшего из класса ученика без потери истории;
10. пересдачу;
11. возврат на доработку;
12. автоматическую проверку;
13. ручную rubric-проверку;
14. смешанную проверку;
15. исправление выставленной оценки;
16. исправление ошибочного answer key через regrade;
17. работу teacher в нескольких школах;
18. копирование учебных материалов без копирования learner data.

## 1.3. Главная архитектурная формула

Любая оцениваемая activity MUST проходить через:

```text
LearningActivityVersion
→ ActivityRun
→ ActivityParticipation
→ Attempt
→ Submission
→ AssessmentResultRevision
→ ResultSelection
→ GradebookProjection / LearnerResultProjection
```

Если activity находится внутри курса:

```text
CourseVersion
→ CourseRun
→ CourseEnrollment
→ ActivityRun
→ ActivityParticipation
→ Attempt
→ Submission
→ AssessmentResultRevision
```

После `ActivityRun` direct assignment и course activity MUST использовать один runtime.

---

# 2. Область реализации

## 2.1. Целевой School Learning MVP

В целевой School Learning MVP входят:

- Course authoring;
- CourseVersion;
- sections/lessons/blocks;
- LearningActivity;
- LearningActivityVersion;
- QuizVersion/QuestionVersion;
- direct assignment;
- CourseRun;
- CourseEnrollment;
- ActivityRun;
- ActivityParticipation;
- ClassroomGroup;
- named learners;
- bulk assignment;
- Attempt;
- Submission;
- persisted quiz answers;
- server-authoritative quiz timer;
- auto grading;
- RubricVersion;
- manual grading;
- mixed grading;
- GradingSchemeVersion;
- AssessmentResultRevision;
- ResultSelectionPolicy;
- learner results;
- Gradebook matrix;
- Works;
- Review Queue;
- course completion;
- course result;
- StudentSeat/account continuity;
- tenant isolation;
- legacy reconciliation.

## 2.2. Не блокирует School Learning MVP

- AcademicYear;
- AcademicPeriod;
- PeriodGrade;
- LessonSession;
- attendance;
- timetable;
- certificates;
- advanced analytics;
- hotspot/formula question types;
- advanced object-storage media pipeline.

## 2.3. Вертикальные пользовательские доказательства

Хотя архитектурные milestones имеют зависимости, разработка MUST регулярно выдавать законченные пользовательские vertical slices.

### VS-1 — «Тест классу → результат в журнале»

Минимально доказать:

```text
teacher assigns quiz to one classroom
→ learner completes persisted timed Attempt
→ auto grade
→ selected result
→ Gradebook Matrix
→ learner sees same result
```

### VS-2 — «STEM-проект → проверка → оценка»

```text
teacher assigns 3D/electronics project
→ learner submits exact ProjectVersion
→ teacher reviews evidence/rubric
→ result revision
→ same Gradebook Matrix
```

### VS-3 — «Курс использует то же ядро»

```text
CourseVersion
├── theory
├── same quiz activity
└── same project activity
→ CourseRun
→ materialized ActivityRuns
→ same Attempt/Submission/Assessment core
```

До доказательства VS-1/VS-2/VS-3 архитектура не считается подтверждённой реальным classroom flow.

---

# 3. Канонические термины

| Product term | Domain term | Назначение |
|---|---|---|
| Курс | `Course` | стабильная авторская сущность |
| Черновик курса | `CourseDraft` | изменяемая редакция |
| Опубликованный курс | `CourseVersion` | immutable snapshot |
| Учебная активность | `LearningActivity` | стабильная authoring identity |
| Версия активности | `LearningActivityVersion` | immutable тест/проект/эссе/файл/manual |
| Назначенный курс | `CourseRun` | runtime CourseVersion в classroom |
| Участник курса | `CourseEnrollment` | learner в CourseRun |
| Назначенная активность | `ActivityRun` | runtime activity |
| Участие в активности | `ActivityParticipation` | learner в ActivityRun |
| Попытка | `Attempt` | один цикл выполнения |
| Сдача | `Submission` | immutable evidence |
| Результат | `AssessmentResultRevision` | опубликованная immutable revision |
| Журнал | `GradebookProjection` | read model |
| Ученик | `LearnerIdentity` | стабильная learner identity |

---

# 4. Requirement namespaces

| Prefix | Область |
|---|---|
| `ARCH-*` | архитектура |
| `IDN-*` | learner identity |
| `VER-*` | версионирование |
| `CRS-*` | курс |
| `RUN-*` | runtime |
| `AUD-*` | audience |
| `ATT-*` | Attempt/Submission |
| `QUIZ-*` | Quiz Engine |
| `ASM-*` | assessment |
| `GRD-*` | журнал |
| `CAT-*` | каталог/копирование |
| `MED-*` | media |
| `MLT-*` | multi-school |
| `UX-*` | интерфейс |
| `API-*` | API |
| `DB-*` | БД |
| `SEC-*` | безопасность |
| `MIG-*` | миграция |
| `NFR-*` | non-functional |
| `TST-*` | тесты/приёмка |

---

# 5. Архитектурные инварианты

## ARCH-001 — единый runtime

Direct quiz, direct project, course quiz и course project MUST использовать один `ActivityRun → Attempt → Submission → Result` runtime.

## ARCH-002 — persistent ActivityRun

Каждая executable activity MUST иметь persistent `ActivityRun`.

## ARCH-003 — Gradebook projection

`GradebookProjection` MUST NOT быть независимым хранилищем оценки.

## ARCH-004 — result относится к Attempt

Каждая `AssessmentResultRevision` MUST ссылаться на одну Attempt.

## ARCH-005 — subject modules generic core

3D/Electronics/Chess/Checkers MAY отдавать evidence, но MUST NOT создавать отдельные Attempt/Gradebook системы.

## ARCH-006 — immutable publication

Опубликованный content MUST быть immutable.

## ARCH-007 — append-only results

Исправление результата MUST создавать новую revision.

## ARCH-008 — no fake analytics

Completion/average/grade MUST иметь серверный источник и формулу.

## ARCH-009 — no hidden max=100

Numeric max MUST приходить из LearningActivityVersion.

## ARCH-010 — server authority

Client MUST NOT назначать себе tenant, learner identity, grade authority, answer key, completion или result.

---

# 6. Learner identity

## IDN-001 — stable logical LearnerIdentity

Учебный runtime MUST иметь **стабильную логическую learner identity**, не зависящую от текущего способа входа.

Логический контракт:

```text
LearnerIdentity
├── stable id
├── schoolTenantId
├── display identity
├── active/inactive state
└── auth/access links
```

## IDN-002 — существующую Identity/Classroom модель сначала переиспользовать

ТЗ **не требует автоматически создавать вторую identity-систему**.

До новой таблицы `learner_identities` milestone M0 MUST выполнить аудит существующих:

```text
Identity Principal
StudentSeat
Classroom member/seat
linked account
organization/workspace memberships
```

и выпустить `ADR-LEARNER-IDENTITY-001`.

ADR MUST выбрать ровно один вариант:

```text
A. существующая стабильная сущность уже удовлетворяет LearnerIdentity contract;
B. требуется новый learning-owned mapping/identity table.
```

Создавать новую параллельную identity core без этого ADR запрещено.

## IDN-003 — runtime uses stable learner key

`CourseEnrollment`, `ActivityParticipation`, Attempt lineage и Result MUST ссылаться на стабильный learner key, выбранный `ADR-LEARNER-IDENTITY-001`, а не напрямую на временный login/session principal.

## IDN-004 — StudentSeat → Account linking

При linking:

- НЕ создаётся новая учебная история;
- существующая logical LearnerIdentity получает/разрешает новый auth link;
- прежние Attempts/grades/results остаются на той же logical learner identity.

## IDN-005 — duplicate prevention

В одном school/classroom MUST NOT существовать две активные logical LearnerIdentity для одного и того же подтверждённого linked account без explicit merge/reconciliation workflow.

## IDN-006 — merge

Administrative merge FUTURE MUST:

- иметь preview;
- быть audited;
- сохранять provenance;
- запрещать silent loss Attempts/Submissions/Results.

---

# 7. Версионирование

## VER-001 — reusable versioned entities

```text
CourseVersion
LearningActivityVersion
QuizVersion
QuestionVersion
RubricVersion
GradingSchemeVersion
ProjectVersion
AssetVersion
```

## VER-002 — policy snapshots

Следующие policy MUST быть immutable snapshot внутри parent version/run:

```text
attemptPolicy
resultSelectionPolicy
completionPolicy
latePolicy
unlockRules
assessmentPolicy
feedbackReleasePolicy
```

Отдельные `XPolicyVersion` таблицы для каждой мелкой policy запрещены без отдельного архитектурного решения.

## VER-003 — run pins version

CourseRun pins CourseVersion. ActivityRun pins LearningActivityVersion.

## VER-004 — draft isolation

Edit draft MUST NOT менять существующие Runs.

---

# 8. LearningActivityVersion

## 8.1. Kinds

```text
quiz
project
essay
file
manual
```

## 8.2. Result mode

Каждая activity MUST иметь:

```text
resultMode:
- ungraded
- completion
- graded
```

### ungraded

- не создаёт grade;
- MAY иметь completion;
- не входит в graded columns.

### completion

- создаёт completion state;
- MAY отображаться отдельной completion колонкой;
- numeric max не обязателен.

### graded

- `maxPoints > 0`;
- результат может преобразовываться в school grade.

## 8.3. Root and version responsibilities

`LearningActivity` owns live authoring identity and lifecycle:

```text
id
ownerScope
visibility/sharing/grants
archive state
current draft relationship
current published version relationship
```

`LearningActivityVersion` owns only the immutable reproducibility snapshot:

```text
published content
pedagogical/runtime defaults
exact QuizVersion/ProjectVersion/RubricVersion references
provenance
publishedAt
```

Changing visibility, sharing, grants or archive state MUST NOT create a new
content version. Those live responsibilities belong to the root entity. M1-001
implements only the minimal physical root/version boundary; the complete M5
capability, grants and catalog model remains M5 scope.

## 8.3.1. Canonical LearningActivityVersion fields

```text
id
activityId
versionNumber
kind
title
instructions
resultMode
maxPoints?
attemptPolicy
resultSelectionPolicy?
completionPolicy
latePolicy
assessmentPolicy?
rubricVersionId?
moduleKey?
quizVersionId?
starterProjectVersionId?
provenance
publishedAt
```

## 8.4. Quiz policy ownership

`QuizVersion` отвечает ТОЛЬКО за content/questions.

`LearningActivityVersion(kind=quiz)` отвечает за:

```text
attempt limit
time limit
pass threshold
feedback release
result selection
completion
late policy
```

Duplicate `attemptLimit/passThreshold/timeLimit` внутри QuizVersion запрещены.

---

# 9. ResultSelectionPolicy

## ASM-SEL-001 — allowed values

Для `resultMode=graded`:

```text
first
latest
best
latest_accepted
teacher_selected
```

## ASM-SEL-002 — defaults

```text
quiz    → best
project → latest_accepted
essay   → latest_accepted
file    → latest_accepted
manual  → latest_accepted
```

## ASM-SEL-003 — deterministic `best`

`best` MUST выбирать:

1. highest `percentageBasisPoints`;
2. при равенстве — latest terminal Attempt by `closedAt`;
3. при равенстве timestamp — highest `attemptNumber`.

## ASM-SEL-004 — deterministic `latest`

`latest` определяется terminal Attempt с максимальным `(closedAt, attemptNumber)`.

## ASM-SEL-005 — teacher_selected

Teacher selection MUST быть:

- explicit;
- audited;
- scoped to one `ActivityParticipation`;
- ссылаться на terminal Attempt, принадлежащую той же participation.

## ASM-SEL-006 — storage of explicit selection

Для `teacher_selected` MUST существовать canonical selection record:

```text
ActivityResultSelection
├── activityParticipationId
├── selectedAttemptId
├── selectedBy
├── selectedAt
└── reason?
```

Это НЕ grade и НЕ копия AssessmentResult. Это только audited pointer на выбранную Attempt.

## ASM-SEL-007 — selected result resolver

Gradebook/Learner Results/CourseResult MUST использовать один server-side resolver:

```text
resolveSelectedAttempt(participation, policy)
→ selected Attempt
→ latest non-superseded AssessmentResultRevision of that Attempt
```

---

# 10. Course authoring

## CRS-001 — persistence strategy

Mutable authoring SHOULD оставаться normalized:

```text
Course
CourseDraft
CourseSectionDraft
LessonDraft
BlockDraft
```

Published CourseVersion MUST хранить immutable snapshot, достаточный для полного воспроизведения версии.

## CRS-002 — CourseVersion snapshot

Обязательно:

```text
metadata
sections
lessons
blocks
exact LearningActivityVersion refs
exact embedded AssetVersion refs
completionPolicy
courseAssessmentPolicy
unlockRules
publishedAt
```

## CRS-003 — blocks

MVP:

```text
heading
paragraph
callout
image
video
audio
file
table
formula
code
activity
divider
```

## CRS-004 — activity block config

```text
activityVersionId
required
category?
scheduleTemplate?
unlockRule?
completionRequirement?
```

## CRS-005 — scheduleTemplate

```text
inherit_course
relative_to_course_start
teacher_sets_on_assign
```

Relative:

```text
opensOffsetMinutes?
dueOffsetMinutes?
closesOffsetMinutes?
```

## CRS-006 — prepublish validation

Publish MUST блокироваться при:

- empty required lesson;
- broken activity ref;
- unpublished activity ref;
- broken AssetVersion ref;
- inaccessible owner scope;
- quiz without questions;
- rubric/points mismatch;
- unsupported module;
- invalid dates/offsets;
- invalid completion rule;
- cyclic unlock dependency;
- missing required metadata.

## CRS-007 — unlock cycle

Dependency graph MUST быть acyclic.

## CRS-008 — course product states

```text
draft_only
published_clean
published_with_changes
archived
```

## CRS-009 — delete/archive

Published/used Course MUST NOT hard-delete через обычный UI. Используется archive.

---

# 11. CourseRun

## RUN-001 — stored lifecycle status

CourseRun хранит только бизнес-lifecycle:

```text
active
closed
cancelled
archived
```

`scheduled` НЕ является обязательным stored status.

Будущая дата старта отображается как derived availability state.

## RUN-002 — lifecycle transitions

```text
active → closed
closed → archived
active → cancelled
```

Reopen closed run не входит в MVP.

Повторное прохождение SHOULD создавать новый CourseRun.

## RUN-003 — derived availability

Для CourseRun UI/API MAY вычислять:

```text
scheduled       // now < startsAt
open            // active and startsAt reached
closed_by_time  // now > closesAt, even before explicit lifecycle close
closed
cancelled
archived
```

Derived availability MUST NOT требовать фонового scheduler для корректности authorization.

## RUN-004 — cancellation

Cancel MUST:

- сохранить CourseEnrollment;
- сохранить ActivityRun;
- сохранить Attempts/Submissions/Results;
- запретить новые learner starts;
- показывать learner понятное cancelled state.

## RUN-005 — materialization

При create CourseRun:

1. pin exact CourseVersion;
2. resolve audience;
3. create CourseEnrollment;
4. create persistent ActivityRun для каждого executable block;
5. create ActivityParticipation;
6. inherit course enrollment audience;
7. materialize schedule template в UTC timestamps;
8. pin effective grading/runtime settings required by run.

## RUN-006 — никакой скрытой активации

Authorization MUST вычислять доступ по:

```text
lifecycle status
+ effective dates
+ participation status
+ learner overrides
```

а не полагаться на то, успел ли cron/job изменить поле status.

---

# 12. ActivityRun

## RUN-101 — fields

```text
id
schoolTenantId
classroomId
learningActivityVersionId
sourceKind: direct | course
sourceCourseRunId?
sourceCourseBlockId?
lifecycleStatus
opensAt?
dueAt?
closesAt?
gradingSchemeVersionId?
runtimePolicySnapshot
createdBy
createdAt
cancelledAt?
closedAt?
```

## RUN-102 — stored lifecycle status

```text
active
closed
cancelled
archived
```

## RUN-103 — derived availability

Effective dates define derived state:

```text
now < effectiveOpensAt
→ scheduled / cannot start

effectiveOpensAt <= now <= effectiveDueAt
→ open / normal

effectiveDueAt < now <= effectiveClosesAt
→ open / late

now > effectiveClosesAt
→ closed_by_time / new submit prohibited unless override
```

If due/close is null, the corresponding interval is omitted.

Explicit `closed/cancelled/archived` lifecycle always overrides date-derived availability.

## RUN-104 — latePolicy

MVP:

```text
allow_mark_late
block_at_due
allow_until_close
```

Default:

```text
allow_until_close
```

`late` is a flag/derived property, not an exclusive workflow status.

## RUN-105 — runtime neutrality

Attempt APIs MUST NOT иметь отдельные implementation branches для direct/course, кроме provenance/display.

## RUN-106 — precedence of effective settings

Для learner-specific runtime значения вычисляются детерминированно.

### Dates / time limit / attempt allowance

```text
ActivityParticipation override
    >
ActivityRun explicit/pinned setting
    >
Course activity block template (для sourceKind=course)
    >
LearningActivityVersion default policy
```

### Grading scheme

```text
ActivityRun.gradingSchemeVersionId
    >
school default resolved and PINNED at ActivityRun creation
    >
no display-grade conversion
```

После создания ActivityRun изменение school default MUST NOT задним числом менять run.

## RUN-107 — effective-settings evidence

Attempt inspector/review SHOULD уметь показать teacher, какие effective settings применены:

```text
attemptLimit
timeLimit
opensAt
dueAt
closesAt
latePolicy
gradingSchemeVersion
```

Это нужно для диагностики спорных случаев.

---

# 13. CourseEnrollment

## AUD-001 — lifecycle

Только:

```text
assigned
active
withdrawn
```

Completion НЕ хранится как independent mutable enrollment status.

## AUD-002 — activation

Первое meaningful learner interaction MAY переводить `assigned → active`.

## AUD-003 — withdrawal

При уходе learner enrollment становится `withdrawn`. История сохраняется.

---

# 14. ActivityParticipation

## AUD-101 — lifecycle

```text
assigned
active
withdrawn
```

`completed` и `excused` НЕ являются lifecycle status.

## AUD-102 — completion projection

Completion вычисляется из completionPolicy + attempt/result history.

## AUD-103 — excused override

```text
excused
excusedReason?
excusedBy
excusedAt
```

## AUD-104 — fields

```text
id
activityRunId
learnerIdentityId
sourceCourseEnrollmentId?
status
assignedAt
activatedAt?
withdrawnAt?
extraAttempts
timeLimitOverrideSeconds?
opensAtOverride?
dueAtOverride?
closesAtOverride?
teacherUnlocked?
excused?
```

## AUD-105 — timer override after start

Teacher MAY увеличить expiry уже активной Attempt; изменение MUST быть audited. Уменьшать expiry ниже current time запрещено.

---

# 15. Audience

## AUD-201 — types

```text
whole_class
classroom_group
named_learners
```

## AUD-202 — default modes

```text
whole_class     → dynamic
classroom_group → dynamic
named_learners  → snapshot
```

## AUD-203 — new class member

Active dynamic run MUST создать participation/enrollment для нового learner.

## AUD-204 — learner leaves

Новые Attempts запрещаются; started Attempt MAY завершиться; evidence сохраняется.

## AUD-205 — group removal during attempt

Current Attempt MAY завершиться; новая Attempt запрещена; teacher MAY invalidate current Attempt.

## AUD-206 — named audience mutation

Изменение snapshot audience = explicit audited operation.

---

# 16. ClassroomGroup

## AUD-301 — entity

```text
id
schoolTenantId
classroomId
title
status
createdBy
createdAt
```

Membership:

```text
groupId
learnerIdentityId
joinedAt
endedAt?
```

## AUD-302 — history

Membership deletion = end-date, not hard-delete.

---

# 17. Multi-class assignment

## RUN-201 — separate runs

Один target classroom = один CourseRun/ActivityRun.

## RUN-202 — partial result

Bulk API MUST возвращать per-class status.

## RUN-203 — idempotency

Retry same idempotency key MUST NOT create duplicates.

---

# 18. Attempt

## ATT-001 — fields

```text
id
activityParticipationId
attemptNumber
revisionOfAttemptId?
status
startedAt
expiresAt?
submittedAt?
closedAt?
clientRequestId
```

## ATT-002 — states

```text
in_progress
submitted
evaluating
closed
invalidated
expired
```

## ATT-003 — transitions

```text
create → in_progress
in_progress → submitted
in_progress → expired
submitted → evaluating
submitted → closed
evaluating → closed
in_progress/submitted/evaluating → invalidated
```

Pedagogical decision НЕ кодируется Attempt.status.

## ATT-004 — one active Attempt

At most one non-terminal Attempt per ActivityParticipation.

## ATT-005 — slot consumption

Slot consumes on successful server creation.

## ATT-006 — resubmission

New Attempt links `revisionOfAttemptId`.

## ATT-007 — effective attempt limit

```text
versionAttemptLimit + participation.extraAttempts
```

---

# 19. Submission

## ATT-101 — immutable

Submission MUST быть immutable.

## ATT-102 — project evidence

```text
ProjectVersionId
moduleEvidenceSnapshot
digest
```

## ATT-103 — quiz evidence

```text
questionVersionIds
questionOrder
optionOrder
answers
startedAt
submittedAt
expiresAt?
```

## ATT-104 — manual activity

Manual activity MUST support teacher observation:

```text
evidenceType = teacher_observation
createdByTeacher
observationText?
attachmentAssetVersionIds?
```

## ATT-105 — file/essay

File uses AssetVersion. Essay stores immutable text snapshot/hash.

---

# 20. Quiz content model

## QUIZ-001 — question types MVP

```text
single_choice
multiple_choice
boolean
numeric
short_text
matching
ordering
long_text_manual
```

## QUIZ-002 — QuizVersion responsibility

QuizVersion contains:

```text
question refs / pools
shuffleQuestions
shuffleOptions
question-level grading definitions
```

No attempt/time/pass settings in QuizVersion.

## QUIZ-003 — activity-level quiz policy

LearningActivityVersion contains:

```text
attemptPolicy
timeLimitSeconds?
passThresholdBasisPoints?
feedbackReleasePolicy
resultSelectionPolicy
```

## QUIZ-004 — answer key security

Learner API MUST NOT return answer key before policy release.

## QUIZ-005 — frozen selection

Attempt creation freezes selected questions and order.

---

# 21. Quiz runtime

## QUIZ-101 — persisted answers

До final submit ответы MUST храниться server-side.

Logical state:

```text
attemptId
answers
version
lastSavedAt
```

## QUIZ-102 — autosave

Client SHOULD сохранять:

- debounced after answer change;
- при переходе к другому вопросу;
- перед explicit submit.

Reload MUST восстановить последние подтверждённые сервером ответы.

## QUIZ-103 — optimistic concurrency

Save request MUST передавать expected answer-state version.

При конфликте:

```text
409 quiz_attempt_conflict
```

Silent overwrite запрещён.

## QUIZ-104 — server-authoritative timer

При start:

```text
startedAt = serverNow
expiresAt = startedAt + effectiveTimeLimit
```

Client countdown не является authority.

## QUIZ-105 — expiry

После `expiresAt` server MUST отвергать answer mutations.

## QUIZ-106 — expiration policy

MVP:

```text
auto_submit
expire_without_submission
```

Default = `auto_submit`.

Auto-submit MUST использовать только последние сохранённые server answers.

## QUIZ-107 — feedback release

```text
immediate
score_only
after_close
```

Server MUST enforce policy.

## QUIZ-108 — mixed manual question

Если Quiz содержит `long_text_manual`:

1. auto questions оцениваются сразу;
2. система MAY показать learner только provisional information согласно policy;
3. final AssessmentResultRevision MUST NOT публиковаться как окончательный graded result до manual review;
4. Attempt переводится `submitted → evaluating`;
5. teacher review завершает Attempt и публикует final result.

## QUIZ-109 — provisional score

Provisional auto score MUST маркироваться как:

```text
Предварительный результат
```

и MUST NOT попадать в Gradebook как final selected grade.

## QUIZ-110 — regrade scope

Regrade MUST выполняться по runtime scope:

```text
ActivityRun
```

а не глобально по authoring Quiz без явного выбора runs.

## QUIZ-111 — RegradeOperation

```text
id
activityRunId
reason
createdBy
createdAt
affectedAttemptIds
correctionDefinition
status
```

Flow:

```text
preview affected attempts
→ confirm
→ recalculate
→ append new AssessmentResultRevision
```

Old QuestionVersion/QuizVersion остаются immutable.

---

# 22. Assessment

## ASM-001 — components

Для `resultMode=graded` assessmentPolicy MAY включать:

```text
auto_quiz
auto_evidence
rubric
manual
```

## ASM-002 — points integrity

Если используется component points:

```text
sum(component.maxPoints) == LearningActivityVersion.maxPoints
```

иначе publish запрещён.

## ASM-003 — decisions

Manual pedagogical decision:

```text
accepted
changes_requested
incomplete
excused
```

Для quiz outcome:

```text
passed
failed
```

Attempt lifecycle и pedagogical decision MUST быть раздельными.

## ASM-004 — changes requested

`changes_requested` закрывает текущую Attempt.

Если effective attempt limit исчерпан, review MUST предоставить дополнительный revision attempt согласно policy.

Default project/manual behavior:

```text
changes_requested → +1 extra attempt
```

## ASM-005 — AssessmentResultRevision

Canonical fields:

```text
id
attemptId
revisionNumber
decision?
outcome?
rawPoints?
maxPoints?
percentageBasisPoints?
displayGrade?
gradingSchemeVersionId?
feedback?
rubricEvaluation?
autoGradeEvidence?
publishedBy
publishedAt
supersedesRevisionId?
changeReason?
```

## ASM-006 — append-only correction

Published revision MUST NOT update in-place.

Correction requires:

```text
supersedesRevisionId
changeReason
```

## ASM-007 — concurrent review

Review mutation MUST принимать:

```text
expectedLatestRevisionId?
```

Если latest revision изменилась:

```text
409 assessment_conflict
```

UI MUST reload before retry.

## ASM-008 — selected result

Selected result = result revision выбранной Attempt согласно ResultSelectionPolicy.

Если выбранная Attempt имеет несколько result revisions, используется latest non-superseded revision.

## ASM-009 — incomplete

`incomplete` MUST NOT автоматически превращаться в 0, если policy явно этого не требует.

## ASM-010 — excused

Excused participation MUST быть исключена из mandatory denominator согласно course/period policy.

---

# 23. Rubric

## ASM-RUB-001 — RubricVersion

Reusable immutable entity:

```text
RubricVersion
├── id
├── rubricId
├── versionNumber
├── title
└── criteria[]
```

## ASM-RUB-002 — criterion

```text
id
title
description
maxPoints
required
levels[]
```

## ASM-RUB-003 — level

```text
label
points
description
```

## ASM-RUB-004 — evaluation

Teacher stores per criterion:

```text
criterionId
selectedLevel?
points
comment?
notApplicable?
```

## ASM-RUB-005 — points

Rubric score MUST NOT exceed RubricVersion total max.

## ASM-RUB-006 — immutable rubric use

LearningActivityVersion pins RubricVersion.

Changing author rubric creates new RubricVersion and MUST NOT alter active runs.

---

# 24. Grading scheme

## ASM-GRD-001 — GradingSchemeVersion

Example:

```text
0–49.99%  → 2
50–69.99% → 3
70–84.99% → 4
85–100%   → 5
```

Alternative:

```text
Не зачтено / Зачёт
```

## ASM-GRD-002 — run pin

ActivityRun MUST pin `gradingSchemeVersionId` where display grade is required.

## ASM-GRD-003 — historical stability

Publication of new school grading scheme MUST NOT rewrite historical results.

## ASM-GRD-004 — basis points

Percent SHOULD храниться как integer basis points:

```text
10000 = 100.00%
```

## ASM-GRD-005 — rounding

Intermediate calculations MUST NOT round to display precision.

Display rounding happens only at final presentation.

---

# 25. Subject-module evidence

## ASM-EVD-001 — common contract

Module evidence MUST быть JSON-compatible immutable snapshot with schema version:

```text
moduleKey
moduleVersion
schemaVersion
evidence
```

## ASM-EVD-002 — ASA 3D example

```json
{
  "objectCount": 8,
  "solidCount": 7,
  "holeCount": 1,
  "boundingBoxMm": [64, 40, 35],
  "requiredFeatures": {
    "door": true,
    "windows": 4,
    "chimney": true
  }
}
```

## ASM-EVD-003 — Electronics example

```json
{
  "circuitClosed": true,
  "polarityCorrect": true,
  "currentMilliAmp": 17.8,
  "shortCircuit": false
}
```

## ASM-EVD-004 — evidence is not grade

Evidence MAY feed auto assessment, but module MUST NOT directly write Gradebook.

---

# 26. Course completion

## CRS-CMP-001 — completion policy

CourseVersion MUST contain immutable completion policy.

Allowed requirements:

```text
content_lesson_completed
activity_submitted
activity_passed
activity_accepted
all_required_blocks_completed
```

## CRS-CMP-002 — content completion

MVP pure content lesson completion:

1. learner reaches end of required content;
2. explicit server action `complete lesson` occurs;
3. server records completion.

Time-on-page MUST NOT by itself prove completion.

## CRS-CMP-003 — CourseCompletionProjection

Course completion MUST be server-derived from CourseEnrollment + policy + lesson/activity completion.

## CRS-CMP-004 — client authority prohibited

Client MUST NOT set arbitrary `completed=true`.

---

# 27. Course result

## CRS-RES-001 — course result modes

Course assessment policy:

```text
no_course_grade
points_sum
weighted_categories
```

Default = `no_course_grade`.

## CRS-RES-002 — points sum

For `points_sum`:

```text
sum selected earned points / sum selected available points
```

Required missing result → `incomplete`, not silent zero.

## CRS-RES-003 — weighted categories

Category config:

```text
categoryId
weightBasisPoints
```

Total category weight MUST equal 10000.

## CRS-RES-004 — weighted formula MVP

For each category:

```text
categoryPercent = earned points / available points of included activities
```

Then:

```text
coursePercent = Σ(categoryPercent × categoryWeight)
```

Calculate with integer/rational precision; round only for display.

## CRS-RES-005 — optional/missing

- missing required activity → course result incomplete;
- missing optional activity → excluded;
- excused activity → excluded from denominator;
- cancelled activity → excluded;
- ungraded activity → excluded from grade calculation.

## CRS-RES-006 — unsupported MVP aggregation

Not supported in MVP unless separately specified:

```text
drop lowest
extra credit
category caps
curves
negative penalties
```

## CRS-RES-007 — CourseResultProjection

Must expose:

```text
courseEnrollmentId
state: incomplete | complete
percentageBasisPoints?
displayGrade?
basisSummary
```

---

# 28. Unlock/prerequisites

## CRS-UNL-001 — rules

Allowed:

```text
previous_completed
lesson_completed
activity_submitted
activity_passed
activity_accepted
date_reached
teacher_unlocked
```

## CRS-UNL-002 — snapshot

Rules stored in CourseVersion snapshot.

## CRS-UNL-003 — cycle detection

Publish MUST reject cycles.

## CRS-UNL-004 — learner override

Teacher unlock MUST be learner-specific and audited.

---

# 29. Gradebook

## GRD-001 — views

Classroom journal MUST provide:

```text
Матрица
Работы
На проверке
Итоги периода
```

## GRD-002 — matrix source

Matrix MUST be built from canonical server projection using:

```text
ActivityRun
ActivityParticipation
selected AssessmentResultRevision
ActivityCompletionProjection
latest Attempt workflow
effective timing
learner overrides
```

## GRD-003 — column inclusion

Within selected filter/period, matrix includes:

- `resultMode=graded` ActivityRun;
- `resultMode=completion` ActivityRun only when completion columns enabled;
- non-cancelled runs.

`resultMode=ungraded` MUST NOT occupy grade columns by default.

## GRD-004 — partial audience

If activity was never assigned to learner:

```text
workflowState = not_applicable
```

This MUST differ from `not_started`.

## GRD-005 — canonical cell model

Gradebook cell MUST NOT encode all semantics into one enum.

Canonical response has three orthogonal parts:

```text
workflowState
selectedResult
flags[]
```

### workflowState

```text
not_applicable
not_started
in_progress
submitted
waiting_review
changes_requested
completed
invalidated
```

### selectedResult

Nullable object:

```text
attemptId
resultRevisionId
rawPoints?
maxPoints?
percentageBasisPoints?
displayGrade?
completionValue?
```

### flags

Zero or more:

```text
late
excused
revision_in_progress
withdrawn
after_due
```

`late` and `excused` MUST NOT replace workflowState.

## GRD-006 — result + workflow overlay

Example:

```text
workflowState = in_progress
selectedResult.displayGrade = 4
flags = [revision_in_progress, late]
```

UI MAY render:

```text
4 ↻
просрочено
```

но MUST сохранить machine semantics отдельно.

## GRD-007 — no generic average

Generic `Среднее` MUST NOT appear without explicit aggregation policy.

Use CourseResult/PeriodGrade or clearly named metric.

## GRD-008 — scalability

Target minimum:

```text
30 learners × 100 activity columns
```

Required:

- sticky learner column;
- sticky headers;
- horizontal virtualization;
- vertical virtualization where needed;
- grouped course/section headers;
- keyboard navigation;
- learner search;
- filters.

## GRD-009 — Works

Columns:

```text
learner
activity
selected attempt
workflowState
flags
selected result
submittedAt
```

## GRD-010 — Review Queue

Only attempts requiring manual review.

Default sort = oldest submitted first.

## GRD-011 — mobile

Mobile MUST use modes:

```text
По ученикам
По работам
```

not only desktop horizontal grid.

## GRD-012 — export

CSV/XLSX export SHOULD be supported, role-scoped and audited.

---

# 30. Academic year / period

## GRD-PER-001 — AcademicYear

```text
id
schoolTenantId
title
startsAt
endsAt
```

## GRD-PER-002 — AcademicPeriod

```text
id
academicYearId
title
startsAt
endsAt
lockedAt?
aggregationPolicy?
```

## GRD-PER-003 — PeriodGrade

Official result is append-only revision set, independent of Gradebook projection.

```text
learnerIdentityId
classroomId
academicPeriodId
scope
publishedValue
basisSummary
publishedBy
publishedAt
supersedesId?
```

## GRD-PER-004 — MVP policy

Default official period result = teacher decision.

System recommendation MAY be shown only with explicit aggregation policy.

---

# 31. Catalog, ownership and visibility

## CAT-001 — ownerScope

```text
personal
school
platform
```

`platform` используется для official ASA Lab materials.

## CAT-002 — ownership and visibility separate

Ownership MUST NOT be inferred from visibility.

Visibility policy:

```text
private
named_educators
school
public_to_educators
```

## CAT-003 — learner access separate

Educator catalog visibility MUST NOT grant learner access.

Learner access exists only through CourseRun/ActivityRun/Participation.

## CAT-004 — copy, not live link

Cross-owner/library reuse SHOULD create independent copy of published immutable graph unless explicit shared-school ownership applies.

## CAT-005 — graph copy

Course copy MUST include/relink:

```text
CourseVersion content
referenced LearningActivityVersions
referenced QuizVersions
referenced QuestionVersions
referenced RubricVersions
embedded AssetVersions or permitted immutable refs
```

## CAT-006 — learner data excluded

Copy MUST NOT include:

```text
CourseRuns
Enrollments
Participations
Attempts
Submissions
Results
Grades
```

## CAT-007 — provenance

Copied content SHOULD store:

```text
copiedFromVersionId
copiedFromOwnerScope
copiedAt
```

## CAT-008 — official catalog

Official ASA Lab material MUST use ownerScope=`platform`.

---

# 32. Media immutability

## MED-001 — AssetVersion contract

Любой media asset, который ASA Lab обещает воспроизводить как часть immutable published content, MUST ссылаться на immutable `AssetVersion`.

Logical fields:

```text
assetId
assetVersionId
contentHash
contentType
size
storageRef
ownerScope
createdAt
```

## MED-002 — MVP boundary

### Входит в base School Learning MVP

- text/heading/callout/table/formula/code;
- embedded image, если image существует как immutable AssetVersion;
- external HTTPS video/audio/file link как **external resource block**.

### Не входит в base MVP без object-storage gate

- teacher-uploaded large video;
- teacher-uploaded large audio;
- large PDF/file upload;
- transcoding/streaming pipeline.

Если M4 требует такие uploads, object storage автоматически становится dependency M4.

## MED-003 — external resources

External HTTPS URL:

- MAY использоваться в MVP;
- MUST быть помечен как `external_resource`;
- MUST NOT считаться frozen/immutable;
- publish validation SHOULD предупреждать, что внешний ресурс может измениться/исчезнуть.

## MED-004 — CourseVersion freeze

Embedded ASA-owned media MUST pin exact AssetVersion.

Замена текущего asset автора MUST NOT менять старую CourseVersion.

## MED-005 — deletion

AssetVersion referenced by published CourseVersion/Submission MUST NOT быть ordinary hard-deleted.

## MED-006 — object storage gate

Перед включением uploaded large media требуется отдельный execution spec с:

```text
upload
content-type/size validation
malware/security scanning as applicable
immutable version
access control
delivery
retention
deletion
backup/recovery
```

---

# 33. Multi-school

## MLT-001 — school workspace

```text
schoolTenantId
title
timeZone
academicSettings
```

## MLT-002 — timezone

`timeZone` MUST be IANA, e.g. `Europe/Moscow`.

Store instants UTC. Display/input dates in school timezone.

## MLT-003 — account in multiple schools

One Account MAY have memberships in multiple schools.

UI MUST expose active school context.

## MLT-004 — school content grants

For school-owned content:

```text
owner
editor
publisher
viewer
```

## MLT-005 — classroom role separate

Classroom role MUST NOT automatically grant course authoring rights and vice versa.

## MLT-006 — leaving school

- school content remains school;
- personal content remains personal;
- runtime history remains tenant;
- ended staff loses future access.

## MLT-007 — cross-school runtime

Runtime learner data MUST belong to target school tenant.

## MLT-008 — cross-school content use

If source material belongs to another school, target school MUST receive permitted independent immutable materialization/copy before target Run.

## MLT-009 — personal content into school

Personal content assigned in a school MUST create/pin target-tenant runtime-safe snapshot/materialization so tenant lineage remains coherent.

## MLT-010 — cross-school bulk

Bulk selection across schools MUST validate content rights and membership separately per target.

---

# 34. Permission model

## SEC-CAP-001 — authorization uses capabilities

Server authorization MUST проверять concrete capabilities/grants, а не UI-role string.

Минимальный capability namespace:

```text
learning.course.create
learning.course.edit
learning.course.publish
learning.content.school.create
learning.content.school.edit
learning.content.school.publish
learning.run.assign
learning.group.manage
learning.gradebook.view
learning.attempt.review
learning.result.correct
learning.grading_scheme.publish
learning.period.manage
learning.period_grade.publish
learning.catalog.copy
learning.gradebook.export
```

## SEC-CAP-002 — roles are default grant bundles

`educator`, `co_teacher`, `grader`, `methodist`, `school_admin` MAY задавать default bundle, но access decision MUST опираться на resolved capability + resource scope.

## SEC-CAP-003 — recommended default mapping

| Action | Required capability | Typical grants |
|---|---|---|
| Create personal course/activity | `learning.course.create` | educator/methodist |
| Edit course | `learning.course.edit` + content scope | owner/editor |
| Publish course | `learning.course.publish` + content scope | owner/publisher |
| Create/edit school content | `learning.content.school.*` | methodist / explicit educator grant |
| Assign run | `learning.run.assign` + classroom scope | educator/co-teacher |
| Manage groups | `learning.group.manage` + classroom scope | educator/co-teacher |
| View gradebook | `learning.gradebook.view` + classroom scope | educator/co-teacher/grader |
| Review attempt | `learning.attempt.review` + classroom scope | educator/co-teacher/grader |
| Correct published result | `learning.result.correct` + reason | explicit grant |
| Publish grading scheme | `learning.grading_scheme.publish` | methodist/school admin |
| Export gradebook | `learning.gradebook.export` | explicit school policy/grant |

## SEC-CAP-004 — school admin

`school_admin` MUST NOT автоматически получать unrestricted grade mutation.

Для исправления learner result требуется `learning.result.correct`.

## SEC-CAP-005 — content and classroom scopes separate

Право редактировать school course MUST NOT автоматически давать право проверять learner Attempt.

Право преподавать класс MUST NOT автоматически давать право изменять school-owned canonical course.

---

# 35. UI/UX технические требования

## UX-001 — общие правила

Teacher workspace MUST:

- использовать рабочую плотность, а не marketing hero layout;
- иметь один primary CTA на экран;
- использовать доступную ширину для editor/gradebook;
- не скрывать обязательные действия только в icon-only control;
- не полагаться только на hover;
- различать loading/empty/error;
- сохранять терминологию между teacher/student surfaces.

Recommended desktop complex workspace width:

```text
1180–1280 px minimum useful content area
```

Gradebook MAY использовать почти всю доступную viewport width.

## UX-002 — верхняя/левая навигация

Рекомендуемая модель:

```text
Left sidebar = рабочая product navigation
Top bar = brand / global search / + Create / account / active school
```

Дублирующие равноправные navigation trees запрещены.

---

# 36. Экран UI-01 — «Мои курсы»

## UX-COURSE-001 — entry

Раздел:

```text
Курсы и задания
```

Tabs:

```text
Мои курсы
Банк заданий
Банк вопросов
Тесты
Каталог
```

`Мои курсы` MUST быть первой/default вкладкой educator.

## UX-COURSE-002 — toolbar

```text
[Поиск] [Все состояния ▾] [Owner ▾ optional]          [+ Создать курс]
```

## UX-COURSE-003 — course row/card

MUST показывать:

- title;
- compact cover;
- product state;
- latest published version;
- section count;
- lesson count;
- activity count;
- quiz count;
- updatedAt;
- usage count only from real source;
- primary action.

Example:

```text
Основы 3D-моделирования                     Опубликован · v3
4 раздела · 12 уроков · 10 практик · 2 теста
Используется в 2 классах                     [Открыть] [Назначить] ⋯
```

## UX-COURSE-004 — prohibited

MUST NOT:

- show `Добавить демо-курс` production CTA;
- show fake version/count/progress;
- show class learner progress in generic authoring list;
- truncate title to one line on phone.

---

# 37. Экран UI-02 — Course Overview

Tabs:

```text
Обзор
Содержание
Использование
Версии
Настройки
```

Overview MUST show:

```text
title
description
subject/module
age band
estimated duration
authors/owner
current published version
draft state
sections
lessons
activities
quizzes
usage in classes
```

Primary actions:

```text
Редактировать
Предпросмотр ученика
Опубликовать / Опубликовать новую версию
Назначить классу
```

Usage MUST link to Class → Learning, not duplicate full gradebook.

---

# 38. Экран UI-03 — Course Builder

## UX-BLD-001 — desktop layout

Default >= 1200px:

```text
[Structure 280–320px] [Flexible lesson canvas] [Properties drawer on demand]
```

Persistent right properties panel MAY be used on very wide desktop.

## UX-BLD-002 — structure tree

Must support:

- sections;
- lessons;
- drag-and-drop;
- keyboard reorder;
- duplicate;
- hide/archive;
- delete safe draft node;
- clear selected state.

## UX-BLD-003 — blocks

Must support all MVP block types from CRS-003.

Each block controls:

```text
move
duplicate
settings
hide/show
delete
insert above/below
```

## UX-BLD-004 — autosave

States:

```text
Сохраняем…
Сохранено
Ошибка сохранения
Конфликт версии
```

`Сохранено` only after server acknowledgment.

## UX-BLD-005 — activity insertion

`+ Добавить блок → Практика/Тест` MUST allow:

```text
выбрать существующую LearningActivityVersion
создать новое задание
создать новый тест
```

New content is saved to library, then referenced by draft.

## UX-BLD-006 — publish

Publish opens validation result.

Errors MUST identify exact section/lesson/block and provide navigation to fix.

---

# 39. Экран UI-04 — Банк вопросов

Filters:

```text
Поиск
Тип
Предмет
Возраст
Теги
Owner: Мои / Школа / Доступные
Archive
```

Question row MUST show:

```text
type
short prompt
max points
subject/age/tags
usage count
latest version
```

Actions:

```text
Открыть
Создать новую версию
Создать копию
Добавить в тест
Архивировать
```

Answer key MUST be teacher-only.

---

# 40. Экран UI-05 — Quiz Builder

Layout:

```text
Тест: Электрическая цепь

Вопросы                                 Содержимое теста
1. Один ответ        1 б.
2. Несколько         2 б.              Shuffle questions: on/off
3. Numeric           2 б.              Shuffle options: on/off
4. Matching          4 б.

[+ Из банка] [+ Новый вопрос]
```

Important: attempt/time/pass settings MUST NOT live here as QuizVersion content settings.

Those settings belong to LearningActivityVersion wrapper / assignment settings.

Quiz Builder MUST allow reorder and version preview.

---

# 41. Экран UI-06 — Activity settings

When QuizVersion/Project is used as LearningActivityVersion, teacher configures:

```text
resultMode
maxPoints if graded
attemptLimit
timeLimit for quiz
passThreshold
feedbackReleasePolicy
resultSelectionPolicy
completionPolicy
latePolicy
rubric
```

Validation MUST prevent contradictory policy.

---

# 42. Экран UI-07 — Class → Learning

Primary CTA:

```text
+ Добавить материал
```

Menu:

```text
Назначить курс
Назначить задание/проект
Назначить тест
Создать новое задание
Создать новый тест
```

CourseRun card MUST show:

```text
title + version
audience
starts/due/close summary
completion count
in progress
not started
waiting review
```

Counts only from canonical projections.

---

# 43. Экран UI-08 — Assign dialog

## UX-ASG-001 — target selection

Allow:

```text
one classroom
multiple classrooms
group
named learners
```

## UX-ASG-002 — fields

For direct ActivityRun:

```text
audience
opensAt
dueAt
closesAt
attempt limit override optional
grading scheme
```

For CourseRun:

```text
target classroom(s)
audience
course start
course close optional
activity schedule preview
```

## UX-ASG-003 — timezone

All dates display in active school timezone with explicit timezone label in ambiguous contexts.

## UX-ASG-004 — bulk result

After bulk assign show per-class result, not generic success.

---

# 44. Экран UI-09 — Gradebook Matrix

Header:

```text
8Ж · Журнал
[Период ▾] [Все курсы ▾] [Все работы ▾] [Задолженности] [На проверке]
```

Tabs:

```text
Матрица | Работы | На проверке | Итоги периода
```

Matrix:

```text
                 Основы 3D                     Электроника
        Домик Замок Робот Тест 1       LED Кнопка Тест 2
Ала       5     4     —    82%           4    5     90%
Иван      4↻    N/A   5    70%           ○    …     80%
```

Semantic tooltips MUST distinguish:

```text
N/A = не назначено
○ = не начато
… = ждёт проверки
↻ = доработка/current new attempt
```

Click cell opens inspector.

---

# 45. Экран UI-10 — Works

Table:

```text
Ученик
Работа
Источник: курс/direct
Попытка
Состояние
Выбранный результат
Последняя активность
```

This view replaces old meaning of `Журнал работ`.

---

# 46. Экран UI-11 — Review Queue

Rows/cards:

```text
learner
activity
attempt number
submittedAt
age waiting
course/direct provenance
```

Default oldest first.

One-click open review.

---

# 47. Экран UI-12 — Review Attempt

Desktop:

```text
┌────────────────────────────────────────────────────────────────────────┐
│ Learner · Activity · Attempt #2                    Submitted 15:42     │
├────────────────────┬──────────────────────┬────────────────────────────┤
│ Evidence / Viewer  │ Assignment / Policy  │ Assessment                 │
│ exact ProjectVer   │ instructions         │ decision                   │
│ module evidence    │ rubric               │ rubric scores              │
│                    │ max 20               │ points 17/20               │
│                    │                      │ grade 5                    │
│                    │                      │ feedback                   │
└────────────────────┴──────────────────────┴────────────────────────────┘
```

Actions:

```text
Принять
Вернуть на доработку
Неполная
Освободить
```

Quick feedback MAY fill feedback field, MUST NOT be called grade.

Conflict from concurrent review MUST be visible and block overwrite.

---

# 48. Экран UI-13 — Learner «Моё обучение»

Must answer:

1. Что продолжить?
2. Что сделать дальше?
3. Что требует исправления?
4. Какие результаты опубликованы?

Example:

```text
Продолжить: Основы 3D · Урок 2.1

Что дальше
Тест №2                   до 27 авг
Робот                     до 30 авг
Замок                     доработка

Мои результаты
Домик                     17/20 · 5
Тест №1                   82% · 4
```

Learner MUST NOT see other learners.

---

# 49. Экран UI-14 — Lesson Player

Desktop:

```text
[Course structure] [Lesson content]

Theory blocks
Activity block → Open / Start / Continue / Result

[Назад] [Завершить урок / Далее]
```

Must show:

- current progress;
- locked reason;
- completion status;
- result of embedded activity if released;
- resume position.

---

# 50. Mobile UI

## UX-MOB-001

390px viewport MUST have no global horizontal overflow.

## UX-MOB-002

Course structure = drawer/sheet.

## UX-MOB-003

Gradebook uses two modes:

```text
По ученикам
По работам
```

## UX-MOB-004

Review stacks:

```text
Evidence
→ Assignment
→ Assessment form
```

## UX-MOB-005

Primary CTA MUST retain text label.

## UX-MOB-006

No hover-only controls.

---

# 51. API general contract

## API-001 — semantic base

Target logical prefix:

```text
/api/learning
```

Existing route layout MAY быть migrated incrementally, если semantics этого ТЗ соблюдены.

## API-002 — OpenAPI является exact wire contract

Markdown ТЗ определяет semantics.

Для любого endpoint, реализуемого milestone, `schemas/openapi.yaml` MUST одновременно определить:

```text
method/path
request body
response body
enums
required/null fields
validation bounds
HTTP status codes
pagination
optimistic-version field
idempotency requirements
authorization notes
```

Endpoint не считается готовым, если implementation существует, а OpenAPI не обновлён.

## API-003 — response errors

Canonical shape:

```json
{
  "error": {
    "code": "validation_error",
    "message": "...",
    "details": {}
  }
}
```

## API-004 — canonical error codes

At minimum:

```text
unauthorized
forbidden
tenant_forbidden
validation_error
not_found
conflict
version_conflict
run_closed
run_cancelled
not_open_yet
submission_closed
attempt_limit_reached
attempt_conflict
quiz_attempt_conflict
quiz_expired
assessment_conflict
answer_key_forbidden
idempotency_conflict
legacy_unresolved
```

OpenAPI MUST enumerate endpoint-specific codes.

## API-005 — idempotency

Create/submit/publish commands MUST accept idempotency key, e.g.:

```text
Idempotency-Key: <uuid>
```

Server stores command result for safe retry within configured retention window.

Same key + different semantic payload MUST return `idempotency_conflict`.

## API-006 — pagination

List endpoints MUST define:

```text
cursor?
limit
nextCursor?
```

Default/max `limit` MUST быть exact in OpenAPI per endpoint.

## API-007 — UTC timestamps

Wire timestamps MUST use offset-aware ISO-8601 instants. Server stores UTC.

School timezone formatting/input conversion is UI/domain boundary responsibility.

---

# 52. Course authoring API

## API-CRS-001

```text
GET /api/learning/courses
```

Filters:

```text
q
state
ownerScope
cursor
limit
```

## API-CRS-002

```text
POST /api/learning/courses
```

Request:

```json
{
  "title": "Основы 3D",
  "description": "...",
  "ownerScope": "personal"
}
```

## API-CRS-003

```text
GET /api/learning/courses/:courseId
```

Returns overview + draft/published state, not learner runtime.

## API-CRS-004

```text
PUT /api/learning/courses/:courseId/draft
```

Uses optimistic draft version.

## API-CRS-005

```text
POST /api/learning/courses/:courseId/validate
```

Returns structured issues:

```json
{
  "ok": false,
  "issues": [
    {
      "code": "cyclic_unlock_rule",
      "sectionId": "...",
      "lessonId": "...",
      "blockId": "...",
      "message": "..."
    }
  ]
}
```

## API-CRS-006

```text
POST /api/learning/courses/:courseId/publish
```

Requires successful validation.

Returns:

```json
{
  "courseVersionId": "...",
  "versionNumber": 3
}
```

## API-CRS-007

```text
GET /api/learning/courses/:courseId/versions
GET /api/learning/course-versions/:versionId
```

---

# 53. LearningActivity API

## API-ACT-001

```text
GET /api/learning/activities
POST /api/learning/activities
GET /api/learning/activities/:activityId
PUT /api/learning/activities/:activityId/draft
POST /api/learning/activities/:activityId/publish
GET /api/learning/activities/:activityId/versions
```

Publish MUST validate resultMode/policies/maxPoints.

---

# 54. Question/Quiz API

```text
GET  /api/learning/questions
POST /api/learning/questions
POST /api/learning/questions/:questionId/versions

GET  /api/learning/quizzes
POST /api/learning/quizzes
POST /api/learning/quizzes/:quizId/versions
GET  /api/learning/quiz-versions/:versionId
```

Question answer keys teacher-authorized only.

---

# 55. ClassroomGroup API

```text
GET  /api/learning/classrooms/:classroomId/groups
POST /api/learning/classrooms/:classroomId/groups
PATCH /api/learning/classrooms/:classroomId/groups/:groupId
POST /api/learning/classrooms/:classroomId/groups/:groupId/members
DELETE /api/learning/classrooms/:classroomId/groups/:groupId/members/:learnerIdentityId
```

DELETE membership MUST end-date membership, not erase history.

---

# 56. Run API

## API-RUN-001 — CourseRun

```text
POST /api/learning/classrooms/:classroomId/course-runs
```

Request:

```json
{
  "courseVersionId": "...",
  "audience": {
    "type": "whole_class",
    "mode": "dynamic"
  },
  "startsAt": "2026-09-01T06:00:00Z",
  "closesAt": null
}
```

## API-RUN-002 — direct ActivityRun

```text
POST /api/learning/classrooms/:classroomId/activity-runs
```

Request:

```json
{
  "learningActivityVersionId": "...",
  "audience": {
    "type": "named_learners",
    "mode": "snapshot",
    "learnerIdentityIds": ["..."]
  },
  "opensAt": "...",
  "dueAt": "...",
  "closesAt": "...",
  "gradingSchemeVersionId": "..."
}
```

## API-RUN-003 — bulk

```text
POST /api/learning/bulk-assign
```

Request:

```json
{
  "source": {
    "kind": "course",
    "versionId": "..."
  },
  "targets": [
    {"classroomId": "..."},
    {"classroomId": "..."}
  ],
  "settings": {}
}
```

Response per target.

## API-RUN-004 — close/cancel

```text
POST /api/learning/course-runs/:runId/close
POST /api/learning/course-runs/:runId/cancel
POST /api/learning/activity-runs/:runId/close
POST /api/learning/activity-runs/:runId/cancel
```

---

# 57. Learner/Attempt API

## API-ATT-001 — learner home

```text
GET /api/learning/me
```

Returns assignments/course runs/results scoped to resolved LearnerIdentity.

## API-ATT-002 — start attempt

```text
POST /api/learning/activity-participations/:participationId/attempts
```

Response includes current active Attempt if retry/idempotent.

## API-ATT-003 — read attempt

```text
GET /api/learning/attempts/:attemptId
```

Learner-safe shape; no forbidden answer key.

## API-ATT-004 — save quiz answer state

```text
PATCH /api/learning/attempts/:attemptId/quiz-answers
```

Request:

```json
{
  "expectedVersion": 7,
  "answers": {
    "question-version-id": {"value": "option-a"}
  }
}
```

Response:

```json
{
  "version": 8,
  "savedAt": "...",
  "expiresAt": "..."
}
```

## API-ATT-005 — submit

```text
POST /api/learning/attempts/:attemptId/submit
```

Server freezes Submission.

## API-ATT-006 — learner result

```text
GET /api/learning/activity-participations/:participationId/result
```

Returns selected result + latest workflow allowed for learner.

---

# 58. Review API

## API-REV-001 — queue

```text
GET /api/learning/classrooms/:classroomId/review-queue
```

## API-REV-002 — attempt inspector

```text
GET /api/learning/attempts/:attemptId/review
```

Teacher-authorized response includes exact evidence, rubric and latest revision.

## API-REV-003 — publish review

```text
POST /api/learning/attempts/:attemptId/review
```

Request:

```json
{
  "expectedLatestRevisionId": "...",
  "decision": "accepted",
  "points": 17,
  "rubric": [],
  "feedback": "...",
  "grantExtraAttempts": 0
}
```

## API-REV-004 — result correction

No stable mutable `assessment_results` resource is required.

Correction endpoint:

```text
POST /api/learning/attempts/:attemptId/result-revisions
```

Request MUST include:

```text
expectedLatestRevisionId
changeReason
new result fields
```

## API-REV-005 — regrade

```text
POST /api/learning/activity-runs/:runId/regrade/preview
POST /api/learning/activity-runs/:runId/regrade
```

---

# 59. Gradebook API

```text
GET /api/learning/classrooms/:classroomId/gradebook
GET /api/learning/classrooms/:classroomId/works
GET /api/learning/classrooms/:classroomId/review-queue
```

Gradebook query:

```text
periodId?
courseRunId?
q?
onlyOverdue?
onlyUngraded?
cursor?
```

Response MUST include semantic cell state, selected result and workflow overlay separately.

---

# 60. Logical database model

This section defines **target logical storage responsibilities**.

Physical migration names/DDL MUST be fixed in each milestone execution spec.

## DB-000 — physical schema decision rule

Before adding a new table, milestone implementation MUST prove that existing table/contracts cannot satisfy the required semantics safely.

Reuse is preferred when semantics match.

Exact SQL, indexes, CHECK constraints, FK actions, partial indexes and RLS are NOT left to ad-hoc coding: they MUST be written in milestone execution spec before implementation.

## DB-001 — stable learner mapping

`LearnerIdentity` is a mandatory logical contract.

M0 MUST produce `ADR-LEARNER-IDENTITY-001` mapping it to existing Identity/Classroom entities.

Only if ADR concludes existing entities are insufficient, create learning mapping tables similar to:

```text
learner_identities
learner_identity_links
```

After ADR, all downstream learning tables use the selected stable learner key consistently.

## DB-002 — course authoring

Mutable authoring MAY reuse normalized existing:

```text
courses
course_sections
course_lessons
course blocks/payload
```

Published:

```text
course_versions
- id PK
- course_id FK
- version_number
- snapshot_jsonb
- content_hash
- published_by
- published_at
UNIQUE(course_id, version_number)
```

## DB-003 — activity authoring

```text
learning_activities
learning_activity_versions
```

LearningActivityVersion logical fields include:

```text
kind
result_mode
title
instructions
max_points
policies snapshot
rubric_version_id
quiz_version_id
module_key
starter_project_version_id
published_at
```

## DB-004 — questions/quizzes

```text
questions
question_versions
quizzes
quiz_versions
quiz_version_questions
```

QuizVersion MUST NOT duplicate runtime attempt/time/pass policies.

## DB-005 — rubric/grading

```text
rubrics
rubric_versions
rubric_version_criteria
grading_schemes
grading_scheme_versions
```

## DB-006 — assets

When ASA-owned immutable assets are enabled:

```text
assets
asset_versions
```

## DB-007 — course runtime

```text
course_runs
course_enrollments
```

CourseRun stores lifecycle status + pinned CourseVersion + audience snapshot/spec + dates.

## DB-008 — activity runtime

```text
activity_runs
activity_participations
```

ActivityRun stores:

```text
pinned learning_activity_version
source provenance
lifecycle status
opens/due/closes
pinned runtime policy snapshot
grading scheme
```

Participation stores:

```text
stable learner key
lifecycle status
extra attempts
time limit override
date overrides
teacher unlock
excused override
```

## DB-009 — explicit result selection

For `teacher_selected`:

```text
activity_result_selections
- activity_participation_id PK/FK
- selected_attempt_id FK
- selected_by
- selected_at
- reason NULL
```

FK/transaction MUST ensure selected Attempt belongs to same participation.

## DB-010 — groups

```text
classroom_groups
classroom_group_memberships
```

Membership uses `joined_at/ended_at`.

## DB-011 — attempts

```text
attempts
- id
- activity_participation_id
- attempt_number
- revision_of_attempt_id NULL
- status
- started_at
- expires_at NULL
- submitted_at NULL
- closed_at NULL
- client_request_id
UNIQUE(activity_participation_id, attempt_number)
```

Partial unique index MUST enforce at most one non-terminal Attempt per participation.

Exact predicate MUST be specified in M2 execution spec.

## DB-012 — quiz answer state

```text
quiz_attempt_states
- attempt_id PK
- version
- answers_jsonb
- selected_questions_jsonb
- question_order_jsonb
- option_order_jsonb
- last_saved_at
```

## DB-013 — submissions

```text
submissions
- id
- attempt_id UNIQUE
- evidence_type
- evidence_ref_jsonb
- evidence_digest
- submitted_at
```

## DB-014 — result revisions

```text
assessment_result_revisions
- id
- attempt_id
- revision_number
- decision NULL
- outcome NULL
- raw_points NULL
- max_points NULL
- percentage_basis_points NULL
- display_grade NULL
- grading_scheme_version_id NULL
- feedback NULL
- rubric_evaluation_jsonb NULL
- auto_grade_evidence_jsonb NULL
- published_by
- published_at
- supersedes_revision_id NULL
- change_reason NULL
UNIQUE(attempt_id, revision_number)
```

There is no second mutable grade source table.

## DB-015 — regrade

```text
regrade_operations
```

Scoped to ActivityRun and affected Attempts.

## DB-016 — lesson progress

```text
lesson_progress
- course_enrollment_id
- lesson version-local key
- completed_at
- last_block_key
- updated_at
```

## DB-017 — academic periods FUTURE/M6

```text
academic_years
academic_periods
period_grade_revisions
```

---

# 61. Database constraints

## DB-CON-001

Published version rows MUST be append-only by application permissions; update/delete restricted.

## DB-CON-002

Attempt number unique per participation.

## DB-CON-003

Submission max one per Attempt.

## DB-CON-004

Result revision number unique per Attempt.

## DB-CON-005

CourseEnrollment unique per run+learner.

## DB-CON-006

ActivityParticipation unique per run+learner.

## DB-CON-007

All tenant-scoped runtime rows MUST have derivable school tenant lineage.

## DB-CON-008

Foreign keys MUST prevent dangling version refs.

## DB-CON-009

Hard deletion of evidence referenced by published content/result MUST be prevented by policy/constraints.

---

# 62. Security / authorization

## SEC-001 — server-derived authority

Request body MUST NOT be trusted for:

```text
schoolTenantId
teacherId
learnerIdentityId when derived from session
role
answer key authorization
grade authority
```

## SEC-002 — learner isolation

Learner MUST NOT read another learner's:

```text
participation
attempt
submission
result
```

## SEC-003 — cross-class

Teacher access MUST be verified against class grants, not only educator capability.

## SEC-004 — cross-school

Direct UUID from another school MUST return forbidden/not-found according to security policy without leaking existence.

## SEC-005 — answer keys

Answer key endpoints/fields teacher-authorized only.

## SEC-006 — grade mutation

Requires explicit assessment grant.

## SEC-007 — audit events

MUST record:

```text
course_publish
activity_publish
course_run_create
activity_run_create
audience_change
attempt_start
attempt_submit
auto_submit
review_publish
result_correct
regrade
grade_scheme_publish
content_grant_change
cross_school_copy
gradebook_export
```

## SEC-008 — correction reason

Published result correction MUST require reason.

---

# 63. RLS requirements

## SEC-RLS-001

For Attempt access server/DB MUST prove lineage:

```text
actor
→ authorized school
→ classroom
→ ActivityRun
→ ActivityParticipation
→ Attempt
```

## SEC-RLS-002

For Result:

```text
ResultRevision
→ Attempt
→ Participation
→ ActivityRun
→ Classroom
→ SchoolTenant
```

## SEC-RLS-003

Catalog queries MUST never join/expose learner runtime data.

## SEC-RLS-004

Cross-school copy MUST copy content graph only, never runtime rows.

---

# 64. Audit and observability

## NFR-OBS-001 — structured logs

Learning mutations SHOULD log:

```text
requestId
actorPrincipalId
schoolTenantId
classroomId?
entityId
action
resultCode
durationMs
```

No answer keys or sensitive learner content in generic logs.

## NFR-OBS-002 — metrics

At minimum:

```text
learning_attempt_start_total
learning_attempt_submit_total
learning_review_queue_size
learning_review_age_seconds
quiz_autosave_error_total
quiz_auto_submit_total
assessment_conflict_total
learning_cross_tenant_denied_total
legacy_unresolved_total
```

## NFR-OBS-003 — audit vs logs

Audit events are durable business history; application logs are operational diagnostics. Do not substitute one for the other.

---

# 65. Legacy reconciliation

## MIG-001 — purpose

Resolve observed contradictions between legacy classroom assignment status and new Attempt/Gradebook model before Gradebook 2.0 becomes authoritative.

## MIG-002 — dry-run first

Migration MUST first generate non-mutating report.

## MIG-003 — exact evidence only

If historical exact ProjectVersion exists:

```text
backfill Attempt
→ Submission references exact ProjectVersion
```

If exact version unavailable:

```text
legacy_unresolved
```

Do NOT fabricate historical evidence from current mutable project.

## MIG-004 — legacy feedback

```text
excellent
good
progress
redo
```

MUST NOT map automatically to `5/4/3/2`.

Preserve as legacy feedback metadata.

## MIG-005 — canonical status after migration

After accepted migration, runtime status derives from Participation/Attempt/Result, not parallel legacy flags.

## MIG-006 — report fields

```text
total legacy assignments
mapped activities
mapped runs
exact submissions recovered
unresolved submissions
legacy feedback preserved
status conflicts
auto-resolved conflicts
manual-review conflicts
```

## MIG-007 — rollback

Migration SHOULD be additive and reversible until cutover:

- legacy rows retained;
- new backfilled rows tagged migration batch;
- batch can be disabled/rolled back before final cutover;
- no destructive legacy delete in first migration.

## MIG-008 — cutover gate

No UI becomes authoritative on new Gradebook unless consistency test passes for sampled/full dataset according to environment.

---

# 66. Non-functional requirements

## NFR-001 — supported viewport

MUST support:

```text
390px mobile
768px tablet
1366px desktop
1920px desktop
```

## NFR-002 — accessibility

Target WCAG 2.1 AA for learning flows.

MUST include:

- keyboard navigation;
- visible focus;
- status not color-only;
- semantic form errors;
- screen-reader labels;
- reduced motion;
- accessible gradebook cell name.

## NFR-003 — gradebook performance

Target dataset:

```text
30 learners × 100 activities
```

Initial gradebook useful render SHOULD be <= 2s on production-like environment under normal load.

Scrolling MUST remain interactive; virtualization required where necessary.

## NFR-004 — API latency

Typical non-report read/write learning endpoints SHOULD target p95 <= 500ms excluding large asset transfer and heavy regrade jobs.

## NFR-005 — large course

Editor SHOULD handle:

```text
20 sections
200 lessons
1000 blocks
```

without full-tree expensive rerender on each keystroke.

## NFR-006 — reliability

Create/submit/publish commands MUST be idempotent.

## NFR-007 — data integrity

No silent loss of:

- submitted evidence;
- grade revision;
- quiz saved answers;
- historical learner result.

## NFR-008 — browser recovery

Quiz MUST recover saved answers after reload.

Course player SHOULD recover last position.

## NFR-009 — error distinction

UI MUST distinguish network/server/authorization/empty state.

## NFR-010 — localization/time

All timestamps stored UTC; displayed according to school IANA timezone.

---

# 67. Error-state requirements

Every key UI MUST have:

```text
loading
empty
ready
network_error
server_error
authorization_denied
not_found
conflict
```

Special flows:

```text
quiz_expired
attempt_limit_reached
run_closed
changes_requested
legacy_unresolved teacher-only diagnostic
```

---

# 67A. Milestone execution package contract

Master ТЗ intentionally does not hard-code every physical SQL/OpenAPI detail for future milestones.

Before coding each milestone, create one executable package containing:

```text
scope
non-goals
accepted ADRs
exact changed files
exact endpoint schemas in schemas/openapi.yaml
exact migrations
indexes/CHECK/FK/RLS
transaction boundaries
idempotency behavior
feature flag/cutover
rollback
unit/integration/E2E test IDs
performance/security gates
owner acceptance script
```

## EXEC-001 — no architecture invention during coding

Coding agent MUST NOT invent a new domain entity or alternate lifecycle that changes this master ТЗ without owner-approved spec/ADR update.

## EXEC-002 — OpenAPI and migration first-class

Any milestone touching API/storage MUST update contract/schema in the same change set.

## EXEC-003 — small executable tasks

Execution spec SHOULD divide implementation into reviewable slices that each preserve repository gates.

## EXEC-004 — evidence

A milestone is complete only when its requirements ledger entries include:

```text
implementation refs
test refs
accepted SHA
evidence
```

---

# 68. Implementation roadmap

Это единственный normative dependency order, пока owner не изменил execution state.

Каждый milestone MUST сначала получить собственный:

```text
docs/product/learning/Mx_EXECUTION_SPEC.md
```

с exact files/OpenAPI/SQL/tests/cutover.

## M0 — State convergence

Implement:

- audit существующей learner identity model;
- `ADR-LEARNER-IDENTITY-001`;
- canonical status/result resolver;
- legacy dry-run;
- migration/backfill;
- consistency tests;
- observed `submitted vs not_started` investigation.

Exit:

```text
same logical learner + same activity
→ same canonical state/result on all surfaces
```

### User-visible checkpoint

Существующий teacher/student UI перестаёт противоречить сам себе.

## M1 — Universal delivery

Implement:

- LearningActivityVersion convergence;
- CourseEnrollment;
- persistent ActivityRun;
- ActivityParticipation;
- effective-setting precedence;
- audience modes;
- groups;
- dynamic join/leave;
- bulk assignment;
- lifecycle/availability model;
- course materialization;
- schedule templates;
- idempotency.

Exit:

Any published course/activity can be assigned safely to allowed audience.

## M2 — Reliable attempts and Quiz Engine

Implement:

- Attempt state machine;
- one active Attempt constraint;
- quiz persisted state;
- server timer;
- auto-submit;
- feedback release;
- long_text_manual pending flow;
- ResultSelectionPolicy;
- ActivityResultSelection storage;
- regrade;
- time-limit learner overrides.

Exit:

Quiz survives reload, timer cannot be client-forged, selected result deterministic.

## M3 — Assessment and Gradebook

Implement:

- dynamic maxPoints;
- RubricVersion;
- mixed assessment;
- AssessmentResultRevision;
- concurrent review protection;
- GradingSchemeVersion pin;
- Gradebook canonical cell `{workflowState, selectedResult, flags}`;
- Matrix;
- Works;
- Review Queue;
- mobile journal.

Exit:

Teacher, learner and Gradebook show the same canonical published result.

## M4 — Course completeness

Implement:

- Course Overview;
- production Course Builder;
- prepublish validation;
- MVP media boundary / immutable images;
- completion policies;
- CourseCompletionProjection;
- CourseResultProjection;
- unlock rules;
- course state/archive;
- version-safe runtime.

Exit:

Course is a complete learning program, not a folder of assignments.

## M5 — Catalog and Multi-school maturity

Implement:

- personal/school/platform ownership;
- visibility/grants;
- graph copy;
- provenance;
- capability-based access;
- active school context;
- cross-school materialization;
- methodist/content grants;
- school timezone;
- negative tenant tests.

## M6 — Academic periods

Implement AcademicYear/AcademicPeriod/PeriodGrade.

## M7 — FUTURE school operations

LessonSession, attendance, timetable, operational analytics.

---

## 68.1. Vertical release checkpoints

Dependency milestones MUST NOT prevent early end-to-end proof.

### Release A — Class Quiz

As soon as minimal M0+M1+M2+M3 subset is available:

```text
assign quiz
→ learner attempt
→ auto result
→ matrix gradebook
```

### Release B — STEM Project

Next:

```text
assign 3D/electronics project
→ exact submission
→ teacher review
→ same matrix
```

### Release C — Course

Next:

```text
theory + existing quiz + existing project
→ CourseRun
→ same runtime
```

Owner acceptance SHOULD happen on each vertical release, not only after all horizontal architecture work.

---

# 69. Release strategy

## REL-001 — additive first

Schema changes SHOULD be additive until cutover.

## REL-002 — feature flags

High-risk migrations/UI cutovers MAY use feature flags:

```text
learning_runtime_v2
gradebook_matrix_v2
quiz_attempt_persistence_v2
```

## REL-003 — no mixed truth

A screen MUST NOT partially read legacy grade and partially new result without documented reconciliation logic.

## REL-004 — cutover

After new source becomes authoritative:

- legacy writes disabled;
- legacy reads removed incrementally;
- compatibility views MAY remain temporarily.

---

# 70. Unit test requirements

At minimum:

## TST-UNIT-001

ResultSelection `best` deterministic tie-break.

## TST-UNIT-002

LatePolicy time boundary exactness.

## TST-UNIT-003

Course weighted categories calculation.

## TST-UNIT-004

Excused denominator handling.

## TST-UNIT-005

Unlock dependency cycle detection.

## TST-UNIT-006

Quiz numeric tolerance.

## TST-UNIT-007

Multiple-choice partial/all-or-nothing policy.

## TST-UNIT-008

GradingScheme boundary values 49.99/50/69.99/70/84.99/85.

## TST-UNIT-009

ActivityCompletionProjection for all resultModes.

## TST-UNIT-010

School timezone date conversion around daylight/offset boundaries where applicable.

---

# 71. Integration test requirements

## TST-INT-001

Course publish produces immutable snapshot and exact refs.

## TST-INT-002

CourseRun materializes ActivityRuns exactly once.

## TST-INT-003

New learner dynamic membership creates participation exactly once.

## TST-INT-004

Leaving learner preserves attempt/result.

## TST-INT-005

Attempt idempotent creation.

## TST-INT-006

Quiz autosave optimistic conflict.

## TST-INT-007

Post-expiry answer save denied.

## TST-INT-008

Auto-submit freezes last saved answers.

## TST-INT-009

changes_requested creates no mutation to old Attempt.

## TST-INT-010

Result correction appends revision.

## TST-INT-011

Concurrent grading expected revision conflict.

## TST-INT-012

Cross-school UUID denied.

## TST-INT-013

Course graph copy contains no learner data.

## TST-INT-014

AssetVersion referenced by CourseVersion cannot be ordinary deleted.

## TST-INT-015

Legacy unresolved submission not fabricated.

---

# 72. Browser E2E acceptance scenarios

## E2E-001 — direct quiz

```text
Teacher creates questions
→ QuizVersion
→ LearningActivityVersion(kind=quiz)
→ assign 8Ж
→ learner starts
→ answers autosave
→ reload
→ continue
→ submit
→ auto grade
→ gradebook result
→ learner same result
```

Pass if all values coincide.

## E2E-002 — project

```text
Teacher project max=20 + rubric
→ assign
→ learner ASA 3D
→ submit exact ProjectVersion
→ teacher 17/20
→ scheme → 5
→ journal 5
→ learner 17/20, 85%, 5
```

## E2E-003 — course

```text
Course: theory + quiz + project
→ publish v1
→ assign 8Ж
→ ActivityRuns materialized
→ learner completes all
→ CourseCompletion true
→ CourseResult if configured
```

## E2E-004 — resubmission

```text
Attempt #1 submitted
→ changes_requested
→ Attempt #2
→ accepted
```

Old Attempt immutable.

## E2E-005 — selected result + active revision

```text
Attempt #1 accepted grade 4
Attempt #2 in progress after changes
```

Gradebook shows `4` + revision workflow overlay.

## E2E-006 — new learner

New learner joins active whole-class CourseRun and sees active work.

## E2E-007 — learner leaves

Historical grade remains; no new attempts.

## E2E-008 — group assignment

Only active group members receive participation.

## E2E-009 — multi-class bulk

3 targets, one forbidden → two success + one explicit error, retry no duplicates.

## E2E-010 — timed quiz

Server expiry, auto-submit, no post-expiry mutation.

## E2E-011 — manual quiz question

Auto score provisional, final pending teacher, gradebook empty/pending until final.

## E2E-012 — regrade

Historical selected results replaced by new revisions with history retained.

## E2E-013 — concurrent review

Second stale teacher write receives conflict.

## E2E-014 — course version safety

Class on v1 remains v1 after author publishes v2.

## E2E-015 — cross-school

Teacher account in A/B; content copied/materialized; B runtime tenant B; A cannot read B results.

## E2E-016 — StudentSeat link

Student works via Seat, then links account; same LearnerIdentity and same grade history.

## E2E-017 — mobile gradebook

390px teacher can inspect learner/work without global horizontal page overflow.

## E2E-018 — course media immutability

Replace author's current image; old CourseVersion still renders old AssetVersion.

---

# 73. Negative authorization tests

MUST prove:

```text
learner cannot read other learner result
learner cannot read answer key early
learner cannot grade
teacher outside class cannot review
teacher other school cannot read attempt
grader cannot publish grading scheme
school admin without assessment grant cannot mutate grade
expired staff membership loses access
direct UUID enumeration denied
catalog endpoint never exposes learner data
```

---

# 74. Performance tests

## TST-PERF-001 — Gradebook

30×100 matrix production-like dataset.

Measure:

```text
API response size/time
initial useful render
scroll interaction
memory
```

## TST-PERF-002 — Course Builder

20 sections / 200 lessons / 1000 blocks.

## TST-PERF-003 — bulk assignment

At least 20 classrooms in test fixture; per-target semantics preserved.

## TST-PERF-004 — Quiz autosave

Simulate concurrent class quiz traffic; autosave does not serialize all class requests through a global bottleneck.

---

# 75. Traceability matrix — core requirements

The machine-readable companion ledger is:

```text
docs/product/ASA_LEARNING_REQUIREMENTS_LEDGER.yaml
```

Markdown table below is only human summary.

| Requirement | Milestone | UI | API / contract | Data | Test |
|---|---|---|---|---|---|
| ARCH-002 persistent ActivityRun | M1 | Class Learning | API-RUN | activity_runs | TST-INT-002 |
| IDN-001 stable logical learner | M0 | all learner UI | identity resolver | ADR-selected mapping | E2E-016 |
| RUN-106 precedence | M1 | Assign/Inspector | run resolver | policy snapshots/overrides | new INT test |
| CRS-002 immutable course snapshot | M4 | Course Versions | API-CRS-006 | course_versions | TST-INT-001 |
| RUN-005 materialization | M1 | Class Learning | API-RUN-001 | course_runs/activity_runs | E2E-003 |
| ATT-004 one active Attempt | M2 | Learner activity | API-ATT-002 | attempts | TST-INT-005 |
| QUIZ-102 autosave | M2 | Quiz player | API-ATT-004 | quiz_attempt_states | E2E-001 |
| QUIZ-104 server timer | M2 | Quiz player | API-ATT | attempts.expires_at | E2E-010 |
| ASM-SEL-006 explicit selection | M2 | Result history | result-selection command | activity_result_selections | new INT test |
| ASM-006 append-only correction | M3 | Result history | API-REV-004 | assessment_result_revisions | TST-INT-010 |
| ASM-007 concurrency | M3 | Review | API-REV | result revisions | E2E-013 |
| GRD-005 orthogonal cell | M3 | Gradebook | Gradebook API | projection/read model | E2E-005 |
| CAT-005 graph copy | M5 | Catalog | copy command | content graph | TST-INT-013 |
| MED-002 MVP boundary | M4 | Course/Lesson | asset/version reads | asset_versions if embedded | E2E-018 |
| MLT-007 target tenant runtime | M5 | school switch | run APIs | tenant lineage | E2E-015 |
| MIG-003 no fake evidence | M0 | diagnostic | migration tooling | migration batch | TST-INT-015 |

Every MUST requirement implemented in a milestone execution spec MUST have at least one test/evidence reference before that milestone can be accepted.

---

# 76. Definition of Done — M0

- [ ] observed inconsistent legacy state reproduced or disproved with evidence;
- [ ] canonical learner/activity mapping exists;
- [ ] dry-run report produced;
- [ ] exact submissions backfilled only where evidence exists;
- [ ] legacy feedback preserved without grade conversion;
- [ ] all relevant teacher/student surfaces agree on selected status/result;
- [ ] migration tests green.

---

# 77. Definition of Done — M1

- [ ] persistent ActivityRun;
- [ ] CourseEnrollment;
- [ ] ActivityParticipation;
- [ ] run states;
- [ ] opens/due/closes semantics;
- [ ] whole class dynamic;
- [ ] group dynamic;
- [ ] named snapshot;
- [ ] new learner behavior;
- [ ] leaving learner behavior;
- [ ] multi-class separate runs;
- [ ] partial bulk result;
- [ ] idempotent retry;
- [ ] course activity materialization exactly once.

---

# 78. Definition of Done — M2

- [ ] one active Attempt constraint;
- [ ] attempt limit;
- [ ] revision attempt;
- [ ] persisted quiz answers;
- [ ] reload recovery;
- [ ] multi-device conflict;
- [ ] server timer;
- [ ] post-expiry mutation denied;
- [ ] auto-submit;
- [ ] feedback release;
- [ ] manual quiz pending path;
- [ ] deterministic result selection;
- [ ] regrade preview/execute/history.

---

# 79. Definition of Done — M3

- [ ] RubricVersion;
- [ ] mixed assessment;
- [ ] no max=100 hardcode;
- [ ] append-only result revisions;
- [ ] grading scheme pin;
- [ ] concurrent reviewer protection;
- [ ] Gradebook matrix;
- [ ] not_applicable vs not_started distinct;
- [ ] selected result + workflow overlay;
- [ ] Works;
- [ ] Review Queue;
- [ ] mobile modes;
- [ ] teacher result == learner result.

---

# 80. Definition of Done — M4

- [ ] Course Overview;
- [ ] production Course Builder;
- [ ] all block types;
- [ ] autosave/conflict states;
- [ ] prepublish validation;
- [ ] cycle detection;
- [ ] CourseVersion exact activity refs;
- [ ] AssetVersion refs;
- [ ] CourseRun version safety;
- [ ] content completion;
- [ ] CourseCompletionProjection;
- [ ] explicit course result policy;
- [ ] CourseResultProjection;
- [ ] archive lifecycle.

---

# 81. Definition of Done — M5

- [ ] ownerScope personal/school/platform;
- [ ] visibility separate from ownership;
- [ ] official ASA Lab catalog;
- [ ] graph copy with provenance;
- [ ] no learner data copied;
- [ ] active school switch;
- [ ] school timezone;
- [ ] content grants;
- [ ] teacher leaving school tested;
- [ ] cross-school target tenant runtime;
- [ ] cross-school negative auth tests.

---

# 82. Final School Learning MVP acceptance

System MAY be called production-ready for the defined School Learning MVP only when:

1. M0–M4 DoD all PASS on same accepted SHA or compatible release set;
2. CI green;
3. migration evidence accepted;
4. security negative tests pass;
5. desktop/mobile browser journeys pass;
6. no unresolved P0 data divergence;
7. owner acceptance confirms end-to-end classroom use.

---

# 83. Forbidden implementation shortcuts

MUST NOT:

1. create separate attempt system for quiz and project;
2. use mutable draft in runtime;
3. update published CourseVersion/ActivityVersion;
4. update Submission after submit;
5. overwrite ResultRevision;
6. store independent grade in gradebook as second truth;
7. convert legacy feedback tags into school grades automatically;
8. hardcode score out of 100;
9. use client timer as authority;
10. keep quiz answers only in browser state;
11. overwrite concurrent review silently;
12. treat `—` as both not-assigned and not-started;
13. calculate generic average without policy;
14. auto-complete content from elapsed time;
15. expose answer keys early;
16. copy learner data with course/catalog copy;
17. put multiple classrooms into one runtime Run;
18. cascade-delete evidence when learner leaves class;
19. use external mutable URL as immutable media;
20. claim feature ready from mock/UI alone.

---

# 84. Acceptance examples

## 84.1. «Дать классу тест»

Teacher:

```text
QuizVersion
→ LearningActivityVersion(kind=quiz)
→ 8Ж
→ opens/due/closes
→ attempts=2
→ time=20m
→ best attempt
→ five-point scheme
```

Learner:

```text
start
→ saved answers
→ reload survives
→ server timer
→ submit/auto-submit
```

System:

```text
auto grade
→ selected result
→ journal
→ same learner result
```

## 84.2. «Дать классу проект»

```text
project activity
module=three-d
max=20
rubric
latest_accepted
→ assign 8Ж
→ ProjectVersion submit
→ module evidence
→ rubric 17/20
→ 85%
→ grade 5
→ journal
```

## 84.3. «Дать классу курс»

```text
CourseVersion v1
├── theory
├── quiz activity
└── project activity

→ CourseRun
→ CourseEnrollments
→ persistent ActivityRuns
→ ActivityParticipations
→ same Attempt core
→ CourseCompletion
→ CourseResult if configured
```

---

# 85. Финальная техническая формула

```text
AUTHORING
Course / LearningActivity / Quiz / Question / Rubric / Assets
        ↓
IMMUTABLE VERSIONS
        ↓
DELIVERY
CourseRun or direct ActivityRun
        ↓
STABLE LEARNER
LearnerIdentity
        ↓
PARTICIPATION
CourseEnrollment + ActivityParticipation
        ↓
ATTEMPT
        ↓
IMMUTABLE SUBMISSION
        ↓
ASSESSMENT
Auto Quiz + Module Evidence + Rubric + Manual
        ↓
APPEND-ONLY RESULT REVISION
        ↓
DETERMINISTIC RESULT SELECTION
        ↓
PROJECTIONS
Gradebook / Learner Result / Course Result
        ↓
OPTIONAL OFFICIAL PERIOD GRADE
```

После выполнения настоящего ТЗ ASA Learning должна обеспечивать единый, воспроизводимый и безопасный учебный цикл для курса и любой отдельной учебной активности, без параллельных систем сдачи/оценивания и без расхождения результатов между преподавателем, учеником и журналом.

