# ASA Lab Learning — Agent Work Queue

**Назначение:** единственный рабочий файл-оркестратор для coding-agent по реализации ASA Learning  
**Версия:** 1.0  
**Статус:** execution backlog / НЕ заменяет `docs/execution/current.yaml`  
**Рекомендуемое место:** `docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md`

---

# 0. Как использовать этот файл

Этот файл отвечает на вопрос:

> **«Какую ровно одну задачу агент должен взять сейчас, что именно сделать, чем доказать готовность и когда остановиться?»**

Он НЕ заменяет:

```text
AGENTS.md
START_HERE_FOR_AI.md
docs/execution/current.yaml
docs/product/ASA_LEARNING_TECHNICAL_SPEC.md
docs/product/ASA_LEARNING_REQUIREMENTS_LEDGER.yaml
schemas/openapi.yaml
```

## 0.1. Иерархия источников

При конфликте использовать приоритет:

```text
1. docs/execution/current.yaml
2. AGENTS.md / repository governance
3. ASA_LEARNING_TECHNICAL_SPEC.md
4. текущий milestone execution spec
5. этот Work Queue
6. Requirements Ledger
7. код / миграции / OpenAPI как CURRENT evidence
```

`current.yaml` определяет, что разрешено исполнять прямо сейчас.

Master Technical Spec определяет, какой должна стать система.

Этот Work Queue определяет порядок атомарных задач.

---

# 1. Главный алгоритм работы агента

Агент ОБЯЗАН работать по этому алгоритму.

```text
START
  ↓
прочитать governance
  ↓
прочитать Master Technical Spec
  ↓
прочитать Requirements Ledger
  ↓
прочитать этот Work Queue
  ↓
проверить docs/execution/current.yaml
  ↓
найти текущий разрешённый milestone
  ↓
найти первую READY-задачу этого milestone
  ↓
проверить dependencies
  ↓
создать/обновить TASK EXECUTION SPEC
  ↓
реализовать ТОЛЬКО эту задачу
  ↓
тесты + gates + browser evidence
  ↓
обновить ledger/status/evidence
  ↓
отметить task DONE
  ↓
взять следующую READY-задачу ТОГО ЖЕ milestone
  ↓
остановиться на milestone acceptance gate
```

## 1.1. Запрещено

Агенту запрещено:

- брать две независимые задачи одновременно;
- переходить в следующий milestone без owner acceptance;
- менять архитектуру Master Spec без отдельного ADR/spec update;
- создавать новую таблицу только потому, что так проще;
- переписывать соседние modules «заодно»;
- объявлять DONE по UI/mock;
- пропускать migrations/tests/OpenAPI;
- использовать legacy и new truth одновременно без explicit reconciliation;
- автоматически начинать Learning implementation, если `current.yaml` указывает другую owner-задачу.

---

# 2. Состояния задач

Каждая task имеет один статус:

```text
BLOCKED
READY
IN_PROGRESS
IN_REVIEW
DONE
DEFERRED
```

## 2.1. READY

Task может быть `READY`, только если:

- все `depends_on` = DONE;
- milestone активирован owner;
- нет blocking conflict;
- required ADR уже принят.

## 2.2. DONE

Task считается DONE только если одновременно:

```text
implementation complete
+ migrations complete if required
+ OpenAPI complete if required
+ unit/integration tests PASS
+ browser evidence PASS where applicable
+ security negatives PASS where applicable
+ requirements ledger updated
+ accepted SHA recorded
```

---

# 3. Формат обязательного execution-spec каждой задачи

Перед кодированием каждой task агент создаёт:

```text
docs/product/learning/execution/<TASK_ID>_EXECUTION_SPEC.md
```

Execution Spec MUST содержать:

```text
1. Task ID
2. Goal
3. Requirement IDs
4. CURRENT evidence
5. Existing files/entities to reuse
6. Exact files to change
7. Exact files NOT to change
8. DB changes
9. Exact SQL / indexes / constraints / RLS
10. API/OpenAPI changes
11. Transaction boundaries
12. Idempotency/concurrency behavior
13. Migration/backfill
14. Rollback
15. Feature flags/cutover
16. Unit tests
17. Integration tests
18. Browser E2E
19. Security negative tests
20. Acceptance checklist
21. Evidence to produce
```

Если task не требует пункта — написать:

```text
N/A — reason
```

а не удалить пункт.

---

# 4. Обязательный финальный отчёт каждой задачи

После реализации агент обязан вернуть:

```text
TASK:
STATUS:
BASELINE SHA:
FINAL SHA:

REQUIREMENTS CLOSED:
- ...

FILES CHANGED:
- ...

MIGRATIONS:
- ...

OPENAPI:
- ...

TESTS:
- command → PASS/FAIL

BROWSER EVIDENCE:
- ...

SECURITY EVIDENCE:
- ...

KNOWN GAPS:
- ...

NEXT READY TASK:
- ...
```

Если что-либо не доказано:

```text
STATUS != DONE
```

---

# 5. Milestone gate

Агент МОЖЕТ автоматически брать следующую task внутри уже активированного milestone.

Агент НЕ МОЖЕТ автоматически переходить:

```text
M0 → M1
M1 → M2
M2 → M3
...
```

На границе milestone:

```text
milestone tasks complete
→ run milestone gates
→ produce acceptance report
→ STOP
→ owner accepts
→ current.yaml activates next milestone
```

---

# 6. M0 — State Convergence

**Цель:** устранить существующие параллельные истины и понять реальную learner identity/data lineage до создания нового runtime.

---

## TASK LRN-M0-001 — Current Learning Architecture Audit

**status:** READY после owner activation M0  
**type:** audit / no product mutation  
**depends_on:** none  
**requirements:** MIG-001, DB-000, IDN-002

### Абсолютная задача

Построить доказанную карту CURRENT learning implementation.

Обязательно изучить:

```text
Identity / Principal
StudentSeat
Classroom membership
Courses / CourseVersion
CourseRun
Assignments
ProjectVersion
Attempts / submissions if present
Quiz backend
Assessment
Learner Results
Gradebook
relevant migrations
OpenAPI
tests
E2E
```

### Результат

Создать:

```text
docs/product/learning/current/LRN_M0_CURRENT_ARCHITECTURE.md
```

В нём:

```text
entity
table
API
UI surface
source of truth
legacy/new
known divergence
reuse candidate
migration risk
```

### Запрещено

- создавать migrations;
- создавать LearnerIdentity table;
- исправлять UI;
- начинать M1.

### Acceptance

- все существующие learning data paths перечислены;
- нет утверждений без file/code evidence;
- отдельно перечислены unknowns.

---

## TASK LRN-M0-002 — Learner Identity ADR

**status:** BLOCKED until M0-001 DONE  
**type:** architecture decision  
**depends_on:** LRN-M0-001  
**requirements:** IDN-001, IDN-002, IDN-003, IDN-004

### Абсолютная задача

Определить, какая существующая сущность может быть стабильным learner key для:

```text
StudentSeat
linked account
classroom learner
historical Attempts/Results
```

Создать:

```text
docs/architecture/ADR-LEARNER-IDENTITY-001.md
```

ADR должен выбрать ровно:

```text
A. reuse existing stable entity
или
B. new learning mapping required
```

### Если B

ADR ОБЯЗАН доказать, почему существующие Principal/Seat/Classroom entities недостаточны.

### Запрещено

Создавать новую identity core без доказательства.

### Acceptance

- one stable learner-key strategy;
- StudentSeat → account linking сохраняет history;
- tenant lineage определена.

---

## TASK LRN-M0-003 — Status Divergence Trace

**status:** BLOCKED  
**depends_on:** LRN-M0-001, LRN-M0-002  
**requirements:** MIG-001, MIG-005

### Абсолютная задача

Воспроизвести/доказать или опровергнуть наблюдаемую проблему:

```text
same learner
same classroom activity

surface A → submitted / waiting
surface B → not_started
```

Проследить:

```text
class assignment
→ learner mapping
→ project/version
→ attempt/submission
→ review/result
→ gradebook projection
```

### Результат

```text
docs/product/learning/current/LRN_M0_STATUS_DIVERGENCE_REPORT.md
```

С конкретной причиной:

```text
PROVEN
или
NOT REPRODUCED
```

Нельзя писать `probably`.

### Acceptance

Указаны exact code/data paths, которые дают каждое противоречащее состояние.

---

## TASK LRN-M0-004 — Canonical State/Result Resolver Design

**status:** BLOCKED  
**depends_on:** LRN-M0-003  
**requirements:** ARCH-003, MIG-005, GRD-002

### Абсолютная задача

Спроектировать один resolver:

```text
logical learner
+ activity/run
→ canonical workflow
→ selected result
→ flags
```

Не реализовывать Gradebook 2.0.

### Результат

Execution spec должен определить:

```text
canonical input sources
precedence
legacy compatibility
output DTO
all existing surfaces to converge
```

### Acceptance

Один и тот же resolver/contract может питать:

```text
Class Learning
Works
Review Queue
Learner Results
future Gradebook
```

---

## TASK LRN-M0-005 — Legacy Migration Dry Run

**status:** BLOCKED  
**depends_on:** LRN-M0-004  
**requirements:** MIG-002, MIG-003, MIG-004, MIG-006, MIG-007

### Абсолютная задача

Реализовать non-mutating migration analyzer.

Отчёт MUST показать:

```text
total legacy assignments
mapped activities
mapped runs
exact submissions recoverable
unresolved submissions
legacy feedback preserved
status conflicts
auto-resolvable conflicts
manual-review conflicts
```

### Критическое правило

Если historical exact ProjectVersion не доказан:

```text
legacy_unresolved
```

Никакого fake evidence.

### Acceptance

Dry-run можно безопасно запускать повторно; он не меняет production data.

---

## TASK LRN-M0-006 — Additive Backfill / Canonical Convergence

**status:** BLOCKED  
**depends_on:** LRN-M0-005  
**requirements:** MIG-003, MIG-005, MIG-007

### Абсолютная задача

На основании принятого dry-run выполнить additive migration/backfill.

### MUST

- сохранить legacy rows;
- tag migration batch;
- обеспечить rollback/cutover;
- никакого destructive delete;
- не конвертировать feedback badges в grades.

### Acceptance

Canonical resolver даёт согласованное состояние на test dataset.

---

## TASK LRN-M0-007 — Surface Convergence

**status:** BLOCKED  
**depends_on:** LRN-M0-006

### Абсолютная задача

Перевести существующие релевантные teacher/student surfaces на canonical resolver.

### Scope

Только surfaces, уже существующие в CURRENT и затрагиваемые divergence.

### Не делать

- новый Gradebook Matrix;
- redesign Course Builder;
- новый Quiz Engine.

### Acceptance

Same learner/activity показывает согласованный state/result везде.

---

## TASK LRN-M0-008 — M0 Acceptance Gate

**status:** DONE — `M0 ACCEPTED`; owner accepted
**depends_on:** LRN-M0-001..007

### Gate

Запустить:

```text
focused learning state tests
repository gate
relevant browser E2E
migration repeatability
negative cross-learner/class checks
```

Создать:

```text
docs/review/learning/M0_ACCEPTANCE_REPORT.md
```

### STOP

После этого агент обязан остановиться.

---

# 7. M1 — Universal Delivery

**Цель:** один persistent runtime для direct activity и activity внутри курса.

---

## TASK LRN-M1-001 — LearningActivityVersion Convergence

**status:** DONE — owner accepted
**depends_on:** M0 accepted  
**requirements:** ARCH-001, ARCH-006, VER-001, VER-002

### Абсолютная задача

Свести существующие assignment/test/project definitions к canonical logical:

```text
LearningActivity
LearningActivityVersion
```

Kinds:

```text
quiz
project
essay
file
manual
```

Result modes:

```text
ungraded
completion
graded
```

### Acceptance

Опубликованная activity immutable; старые runtime references не меняются.

**Evidence:** `docs/product/learning/current/LRN_M1_ACTIVITY_VERSION_CONVERGENCE_REPORT.md`

---

## TASK LRN-M1-002 — CourseEnrollment

**status:** DONE — owner accepted
**depends_on:** M1-001  
**requirements:** AUD-001..003

### Абсолютная задача

Реализовать learner membership конкретного CourseRun.

Lifecycle:

```text
assigned
active
withdrawn
```

Completion не хранить как mutable enrollment status.

---

## TASK LRN-M1-003 — Persistent ActivityRun

**status:** DONE — owner accepted
**depends_on:** M1-001  
**requirements:** ARCH-002, RUN-101..107

### Абсолютная задача

Ввести единый persistent ActivityRun для:

```text
direct assignment
course activity
```

### Acceptance

Attempt runtime не различает direct/course, кроме provenance.

---

## TASK LRN-M1-004 — ActivityParticipation

**status:** DONE — owner accepted
**depends_on:** M1-002, M1-003  
**requirements:** AUD-101..105

### Абсолютная задача

Реализовать learner participation конкретного ActivityRun.

Поддержать overrides:

```text
extraAttempts
timeLimit
opens/due/closes
teacherUnlock
excused
```

---

## TASK LRN-M1-005 — Audience: Whole Class + Named Learners

**status:** DONE — owner accepted 2026-08-26; merged in PR #164
**depends_on:** M1-004  
**requirements:** AUD-201..206

### Абсолютная задача

Реализовать:

```text
whole_class dynamic
named_learners snapshot
```

Group пока не включать.

### Acceptance

Новый learner dynamic class получает active run ровно один раз.

---

## PRODUCT SLICE LRN-VS-001 — Teacher Assigns Activity

**status:** DONE — owner accepted 2026-08-26; merged in PR #166
**depends_on:** M1-005
**issue:** #165

### Product outcome

Преподаватель назначает опубликованную canonical LearningActivity всему классу
или выбранным ученикам в существующей вкладке класса. Только адресаты видят её
в существующем learner interface. Реализация переиспользует ActivityRun,
Audience, ActivityParticipation и LearnerIdentity.

### Browser acceptance

1. Whole class: teacher assigns; learner sees; teacher sees assigned.
2. Named learners: two selected learners see; third learner does not.

M1-006, ClassroomGroup, multi-class, Course materialization, новый Gradebook,
Attempt и Submission остаются вне задачи.

---

## PRODUCT SLICE LRN-VS-002 — Learner Starts and Submits Project Assignment

**status:** IN_REVIEW — local acceptance passed; owner acceptance pending
**depends_on:** LRN-VS-001
**issue:** #167

### Product outcome

Ученик открывает назначенную через VS-001 project activity в существующем
SeatAssignments, работает в реальном module editor и сдаёт одну immutable
Submission через Attempt, принадлежащий ровно одной ActivityParticipation.
После refresh ученик видит «Сдано», а преподаватель — assigned/started/submitted
counts. Legacy path сохраняется отдельным compatibility adapter.

### Browser acceptance

1. Canonical assignment: not started → real editor → in progress → submitted →
   refresh remains submitted → teacher sees submitted.
2. Named audience: исключённый learner не может read/start/submit даже через
   прямой UUID/API.

M1-006, ClassroomGroup, multi-class, Course Builder/materialization, quiz,
grading, Gradebook, rubrics и production deployment остаются вне задачи.

---

## TASK LRN-M1-006 — ClassroomGroup

**depends_on:** M1-005  
**requirements:** AUD-301..302

### Абсолютная задача

Реализовать school/class scoped groups с end-dated membership.

---

## TASK LRN-M1-007 — Effective Settings Resolver

**depends_on:** M1-003, M1-004  
**requirements:** RUN-103, RUN-104, RUN-106, RUN-107

### Абсолютная задача

Один resolver:

```text
learner override
>
ActivityRun pinned
>
Course block template
>
ActivityVersion default
```

Выход:

```text
attemptLimit
timeLimit
opensAt
dueAt
closesAt
latePolicy
gradingSchemeVersion
```

### Acceptance

Inspector может объяснить effective settings.

---

## TASK LRN-M1-008 — Multi-Class Bulk Assignment

**depends_on:** M1-005  
**requirements:** RUN-201..203

### Абсолютная задача

Один target classroom = один run.

Response per target.

Retry idempotent.

---

## TASK LRN-M1-009 — Course Activity Materialization

**depends_on:** M1-002, M1-003, M1-004, M1-007  
**requirements:** RUN-005, CRS-004, CRS-005

### Абсолютная задача

При создании CourseRun материализовать executable course blocks в persistent ActivityRuns exactly once.

### Acceptance

Один CourseVersion block → один ActivityRun на CourseRun.

---

## TASK LRN-M1-010 — M1 Acceptance Gate

Проверить:

```text
direct activity assignment
course activity materialization
dynamic learner join
learner leave
named audience
group audience
bulk assignment retry
cross-class authorization
```

STOP for owner acceptance.

---

# 8. M2 — Reliable Attempts + Quiz Engine

---

## TASK LRN-M2-001 — Attempt State Machine

**requirements:** ATT-001..007

Реализовать:

```text
in_progress
submitted
evaluating
closed
invalidated
expired
```

At most one non-terminal Attempt per participation.

Exact partial unique index MUST быть в execution spec.

---

## TASK LRN-M2-002 — Immutable Submission

**depends_on:** M2-001  
**requirements:** ATT-101..105

Реализовать immutable submission contract для:

```text
quiz
project
essay
file
manual teacher observation
```

---

## TASK LRN-M2-003 — Quiz Attempt Persistence

**depends_on:** M2-001  
**requirements:** QUIZ-101..103

Server persisted answers + optimistic version.

Reload restores.

Silent overwrite forbidden.

---

## TASK LRN-M2-004 — Server Timer + Expiry

**depends_on:** M2-003  
**requirements:** QUIZ-104..106

Server owns:

```text
startedAt
expiresAt
```

Support:

```text
auto_submit
expire_without_submission
```

Default auto-submit.

---

## TASK LRN-M2-005 — Answer-Key / Feedback Release

**depends_on:** M2-003  
**requirements:** QUIZ-004, QUIZ-107

Implement server-enforced:

```text
immediate
score_only
after_close
```

---

## TASK LRN-M2-006 — Result Selection Resolver

**depends_on:** M2-001  
**requirements:** ASM-SEL-001..007

Implement:

```text
first
latest
best
latest_accepted
teacher_selected
```

`ActivityResultSelection` for explicit selection.

---

## TASK LRN-M2-007 — Manual Quiz Question Pending Flow

**depends_on:** M2-003, M2-006  
**requirements:** QUIZ-108, QUIZ-109

Mixed test:

```text
auto score provisional
final pending manual review
```

Provisional result MUST NOT enter Gradebook as final.

---

## TASK LRN-M2-008 — Regrade

**depends_on:** M2-006  
**requirements:** QUIZ-110, QUIZ-111

ActivityRun-scoped preview + confirm + append result revisions.

---

## TASK LRN-M2-010 — M2 Acceptance Gate

**depends_on:** M1 accepted + M2-001..008

Accept the Attempt, Submission, quiz, selection and regrade runtime without
claiming the still-unimplemented M3 Gradebook projection or VS-1 browser proof.

STOP for owner acceptance before M3.

---

# 9. M3 — Assessment + Gradebook

---

## TASK LRN-M3-001 — AssessmentResultRevision

**requirements:** ASM-005..010

Append-only result revision.

No second mutable grade source.

---

## TASK LRN-M3-002 — GradingScheme Pinning

**requirements:** ASM-GRD-001..005

Pin exact GradingSchemeVersion at ActivityRun.

Historical result stable.

---

## TASK LRN-M3-003 — RubricVersion

**requirements:** ASM-RUB-001..006

Reusable immutable rubric.

---

## TASK LRN-M3-004 — Mixed Assessment

**depends_on:** M3-001, M3-003

Support:

```text
auto_quiz
auto_evidence
rubric
manual
```

Points integrity mandatory.

---

## TASK LRN-M3-005 — Concurrent Review Protection

**depends_on:** M3-001

`expectedLatestRevisionId`.

Stale write → `409 assessment_conflict`.

---

## TASK LRN-M3-006 — Canonical Gradebook Projection

**depends_on:** M3-001, M2-006  
**requirements:** GRD-002..007

Cell contract:

```text
workflowState
selectedResult
flags[]
```

No single overloaded status enum.

---

## TASK LRN-M2-009 — VS-1 Class Quiz Vertical Proof

**scheduling:** early M3; historical task ID retained for traceability
**depends_on:** M1 accepted + M2 accepted through LRN-M2-010 + M3-001..006

Prove:

```text
teacher assigns quiz
→ learner starts
→ answers persist
→ reload
→ timer
→ submit
→ auto grade
→ selected result
→ canonical Gradebook projection
→ learner same result
```

Browser evidence required. This proof runs before Gradebook UI expansion and
does not permit M3 work before M2 owner acceptance.

---

## TASK LRN-M3-007 — Gradebook Matrix UI

**depends_on:** M3-006  
**requirements:** GRD-001, GRD-008

Target:

```text
30 learners × 100 activities
```

Sticky headers + virtualization + keyboard navigation.

---

## TASK LRN-M3-008 — Works + Review Queue

**depends_on:** M3-006  
**requirements:** GRD-009, GRD-010

Old row-style journal becomes `Работы`.

Review Queue only manual-review required attempts.

---

## TASK LRN-M3-009 — Mobile Gradebook

**depends_on:** M3-006

Modes:

```text
По ученикам
По работам
```

390px, no global horizontal overflow.

---

## TASK LRN-M3-010 — VS-2 STEM Project Vertical Proof

Prove:

```text
teacher assigns 3D/electronics project
→ learner submits exact ProjectVersion
→ immutable module evidence
→ teacher rubric/manual review
→ result
→ same Gradebook
→ learner same result
```

---

## TASK LRN-M3-011 — M3 Acceptance Gate

STOP for owner acceptance.

---

# 10. M4 — Course Completeness

---

## TASK LRN-M4-001 — CourseVersion Snapshot Hardening

Ensure immutable snapshot contains:

```text
sections
lessons
blocks
exact activity versions
completion policy
course assessment policy
unlock rules
immutable asset refs where supported
```

---

## TASK LRN-M4-002 — Course Publish Validation

Implement exact errors for:

```text
empty required lesson
broken activity ref
unpublished activity
broken asset
quiz no questions
rubric mismatch
invalid schedule
invalid completion
cyclic unlock
unsupported module
```

---

## TASK LRN-M4-003 — Course Overview

Production teacher screen:

```text
Обзор
Содержание
Использование
Версии
Настройки
```

No fake counts.

---

## TASK LRN-M4-004 — Course Builder Production UX

Structure + flexible lesson canvas + properties drawer.

Autosave statuses from server acknowledgment.

---

## TASK LRN-M4-005 — Course Completion

Server-derived CourseCompletionProjection.

Time-on-page alone never proves completion.

---

## TASK LRN-M4-006 — Course Result

Support:

```text
no_course_grade
points_sum
weighted_categories
```

Completion and result remain orthogonal.

---

## TASK LRN-M4-007 — Unlock Rules

Rules from Master Spec.

Cycle detection required.

Teacher override learner-specific + audited.

---

## TASK LRN-M4-008 — Media MVP Boundary

Implement only allowed MVP media.

External resource ≠ immutable embedded asset.

If large upload required → object-storage gate first.

---

## TASK LRN-M4-009 — Course Archive / Version Safety

Publishing v2 MUST NOT mutate class still running v1.

Used course cannot ordinary hard-delete.

---

## TASK LRN-M4-010 — VS-3 Course Vertical Proof

Prove:

```text
CourseVersion
├── theory
├── same quiz used in VS-1
└── same project used in VS-2
→ CourseRun
→ same ActivityRun/Attempt/Submission/Assessment core
→ completion
→ optional course result
```

---

## TASK LRN-M4-011 — School Learning MVP Acceptance

Run all M0–M4 gates.

Produce:

```text
docs/review/learning/SCHOOL_LEARNING_MVP_ACCEPTANCE.md
```

STOP for owner acceptance.

---

# 11. M5 — Catalog + Multi-School

---

## TASK LRN-M5-001 — Ownership vs Visibility

Root content entity owns:

```text
owner scope
visibility
grants
archive state
```

Content Version contains reproducibility snapshot, not live sharing policy.

Scopes:

```text
personal
school
platform
```

---

## TASK LRN-M5-002 — Learning Capability Model

Implement capability namespace from Master Spec.

Authorization:

```text
capability
+ resource scope
```

not UI role string.

---

## TASK LRN-M5-003 — Graph Copy + Dedup

Course graph copy:

```text
CourseVersion
Activities
QuizVersions
QuestionVersions
Rubrics
Assets
```

Use one operation map:

```text
sourceVersionId → targetVersionId
```

Same source node copied once per operation.

No learner data.

---

## TASK LRN-M5-004 — Cross-School Materialization

Runtime in target school tenant.

No learner runtime copied from source school.

---

## TASK LRN-M5-005 — Active School Context + Timezone

One account, multiple schools.

IANA timezone.

UTC storage.

---

## TASK LRN-M5-006 — Multi-School Negative Security Matrix

Must prove cross-tenant UUID isolation.

---

## TASK LRN-M5-007 — M5 Acceptance Gate

STOP for owner acceptance.

---

# 12. M6 — Academic Periods

---

## TASK LRN-M6-001 — AcademicYear

Implement school-scoped academic year.

---

## TASK LRN-M6-002 — AcademicPeriod

Quarter/trimester/semester model.

---

## TASK LRN-M6-003 — PeriodGrade

Append-only official period grade.

Default official value = teacher decision.

Recommendation only with explicit aggregation policy.

---

## TASK LRN-M6-004 — Gradebook Period UI

Only after M6:

```text
[Период]
Итоги периода
```

Before M6 these controls MUST NOT pretend the entity exists.

---

# 13. M7 — Future School Operations

Do not implement unless separately activated.

Potential tasks:

```text
LessonSession
Attendance
Timetable
Operational analytics
Certificates
Advanced reporting
```

---

# 14. Cross-cutting tasks required in every milestone

Every implementation task MUST also evaluate:

```text
SECURITY
RLS
IDEMPOTENCY
CONCURRENCY
AUDIT
MOBILE
ACCESSIBILITY
OBSERVABILITY
MIGRATION
ROLLBACK
```

If irrelevant:

```text
N/A — reason
```

---

# 15. Mandatory gates

Before task DONE, use relevant focused commands.

Before milestone acceptance:

```text
focused learning gate
learning browser E2E
repository gate
migration tests where applicable
security negatives
```

If repository does not yet have dedicated learning commands:

first relevant milestone MUST create them, for example:

```text
pnpm gate:learning
pnpm e2e:learning
```

Exact commands must be recorded in the execution spec.

---

# 16. Status editing rules

Agent MAY change only:

```text
status
accepted SHA
evidence links
short completion note
```

for tasks it actually executed.

Agent MUST NOT silently rewrite future task requirements.

Architecture changes require:

```text
Master Spec update
+ ADR where appropriate
+ owner acceptance
```

---

# 17. Task selection rule in one sentence

> **Возьми первую задачу со status=READY внутри milestone, который разрешён `docs/execution/current.yaml`; выполни только её до доказанного DONE; затем возьми следующую READY того же milestone; на milestone gate остановись.**

---

# 18. Bootstrap prompt for the coding-agent

После размещения этого файла в репозитории owner может дать агенту только короткую команду:

```text
Работай по:
docs/product/ASA_LEARNING_TECHNICAL_SPEC.md
docs/product/ASA_LEARNING_REQUIREMENTS_LEDGER.yaml
docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md

Сначала прочитай governance и docs/execution/current.yaml.

Не реализуй весь Learning целиком.
Работай строго по Agent Work Queue:
одна атомарная задача → execution spec → реализация → тесты → evidence → DONE.

Не переходи границу milestone без моего подтверждения.

Если current.yaml ещё не активировал Learning, ничего не меняй в продукте:
подготовь LRN-M0-001 audit/execution material и сообщи, что требуется owner activation.
```

---

# 19. Конечный критерий

Этот Work Queue выполнен правильно только если к концу M4 доказаны три независимых вертикальных сценария на одном runtime:

```text
VS-1
Тест → класс → Attempt → результат → Журнал

VS-2
STEM-проект → Submission → review → результат → тот же Журнал

VS-3
Курс → тот же тест + тот же проект → тот же runtime
```

Если для любого из трёх создана отдельная параллельная система Attempt/Result/Gradebook — реализация считается архитектурно неверной независимо от внешнего вида UI.
