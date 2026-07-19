# ASA Lab — Classroom Core Specification

**Статус:** нормативная функциональная спецификация.  
**Связанный документ:** [`PRODUCT_BLUEPRINT.md`](PRODUCT_BLUEPRINT.md).  
**Основные capability IDs:** `CAP-ORG`, `CAP-IDENTITY`, `CAP-CLASSROOM`, `CAP-ASSIGNMENTS`, `CAP-SUBMISSIONS`, `CAP-REVIEW`, `CAP-ASSESSMENT`, `CAP-REWARDS`.

## 1. Назначение Classroom Core

Classroom Core — универсальное образовательное ядро ASA Lab. Оно организует людей, учебные пространства, задания, проекты и проверку, но не содержит предметной логики конкретного редактора.

Classroom Core не знает:

- что такое резистор, провод или Arduino;
- что такое sprite и block script;
- что такое шахматная фигура;
- что такое mesh или 3D printer;
- как вычисляется результат конкретной предметной задачи.

Classroom Core знает:

- кто является педагогом или учеником;
- к какой организации и классу относится действие;
- какое задание выдано;
- какой module/project type используется;
- какая версия проекта отправлена;
- кто и когда проверил работу;
- какие комментарии, оценки и достижения выданы;
- какие права действуют.

## 2. Основные агрегаты

### 2.1. Tenant

Граница данных и администрирования. Tenant может соответствовать школе, образовательной организации, сети школ, региону или выделенному заказчику.

Поля:

- `id`;
- `workspaceSlug`;
- `displayName`;
- `status`;
- `placement`;
- `defaultLocale`;
- `timeZone`;
- `dataRetentionPolicyId`;
- `createdAt`.

### 2.2. Organization, School, Building

```text
Tenant
└── Organization
    ├── School
    │   └── Building
    └── Department optional
```

School задаёт административный контекст. Building нужен для расписания, кабинетов, локальной инфраструктуры и аналитики, но не является security boundary вместо tenant.

### 2.3. AcademicPeriod

Учебный год, семестр, четверть, смена, интенсив или курс.

Поля:

- `id`;
- `tenantId`;
- `schoolId`;
- `type`;
- `title`;
- `startsAt`;
- `endsAt`;
- `status`;
- `isDefault`.

### 2.4. Classroom

Рабочая область группы учащихся.

Поля:

- `id`;
- `tenantId`;
- `schoolId`;
- `academicPeriodId`;
- `title`;
- `subject` optional;
- `gradeBand` optional;
- `description`;
- `status` `draft/active/archived`;
- `safeModePolicyId`;
- `createdBy`;
- `createdAt`;
- `rowVersion`.

### 2.5. ClassroomMembership

Участие пользователя или StudentSeat в классе.

Роли:

- `owner_teacher`;
- `co_teacher`;
- `assistant`;
- `student`;
- `observer` optional.

Поля:

- `tenantId`;
- `classroomId`;
- `principalType`;
- `principalId`;
- `role`;
- `status`;
- `joinedAt`;
- `leftAt`;
- `grants`.

### 2.6. ClassroomGroup

Подгруппа внутри класса для дифференциации заданий и командных проектов.

Примеры:

- группа по уровню;
- команда проекта;
- группа по варианту;
- временная лабораторная группа.

## 3. Роли и полномочия

### 3.1. Owner teacher

- изменяет настройки класса;
- управляет roster;
- приглашает соучителей;
- назначает задания;
- проверяет и оценивает;
- архивирует класс;
- экспортирует данные.

### 3.2. Co-teacher

Имеет только явно выданные grants. Пример набора:

```text
classroom.view
classroom.roster.manage
classroom.assignment.create
classroom.submission.review
classroom.grade.write
classroom.comment.write
classroom.settings.manage
```

### 3.3. Student

- видит доступные задания;
- создаёт и редактирует свои проекты;
- сдаёт версии;
- читает адресованные ему комментарии;
- видит свои результаты;
- участвует в разрешённых командных проектах.

### 3.4. School admin

Может администрировать классы школы, но просмотр детского содержимого должен быть отдельным разрешением и аудироваться.

## 4. Создание класса

Пользовательский поток:

```text
Teacher dashboard
→ Create classroom
→ title + academic period + optional subject/grade
→ server validates school access
→ Classroom created
→ owner membership created atomically
→ AuditEvent recorded
→ classroom appears in list
```

Требования:

- `tenantId`, owner и school scope определяются сервером;
- повтор с тем же `Idempotency-Key` не создаёт дубль;
- создание класса и owner membership выполняются одной транзакцией;
- педагог не может создать класс в недоступной школе;
- архивированный academic period нельзя использовать без специального разрешения.

## 5. Roster и StudentSeat

### 5.1. Добавление учеников

Способы:

- ручное создание StudentSeat;
- массовый ввод;
- CSV/XLSX import;
- class code;
- invitation link;
- QR;
- связывание существующего ученического аккаунта;
- SSO rostering в будущем.

### 5.2. StudentSeat

StudentSeat — учительски управляемое ученическое место без обязательного email.

Поля:

- `id`;
- `tenantId`;
- `schoolId`;
- `displayAlias`;
- `internalStudentRef` optional;
- `credentialHash`;
- `credentialVersion`;
- `status`;
- `failedAttempts`;
- `lockedUntil`;
- `createdAt`;
- `lastLoginAt`.

Открытый credential показывается только при выпуске или перевыпуске.

### 5.3. Карточка доступа

Содержит:

- название ASA Lab;
- workspace/class code;
- псевдоним;
- индивидуальный код или QR;
- краткую инструкцию;
- срок действия optional.

Не содержит персональные данные сверх необходимого.

### 5.4. Перевыпуск доступа

```text
Teacher requests reset
→ new credential generated
→ old credential invalidated
→ all old sessions revoked
→ AuditEvent
→ new card available once
```

## 6. Кабинет класса

### 6.1. Overview

- число учеников;
- активные задания;
- новые submissions;
- просроченные;
- средний progress;
- последние события;
- используемые модули.

### 6.2. Students

Столбцы:

- alias/name в учительском реестре;
- status;
- login type;
- last activity;
- outstanding assignments;
- returned submissions;
- help indicator;
- achievements.

Массовые операции:

- выпуск карточек;
- перевод в группу;
- suspend;
- archive;
- reset credential;
- экспорт.

### 6.3. Assignments

- draft;
- scheduled;
- active;
- closed;
- archived.

Фильтры по модулю, сроку, группе и статусу.

### 6.4. Review

Очередь submissions с быстрым переходом в module viewer.

### 6.5. Gradebook

Единая таблица результатов, но не источник истины для проекта. Gradebook ссылается на assessment result и submission version.

### 6.6. Achievements

Учитель видит выданные badges и может выдать ручное достижение с evidence.

## 7. Учебные задания

### 7.1. ActivityTemplate

Редактируемый шаблон, принадлежащий педагогу, школе, методисту или платформе.

### 7.2. ActivityVersion

Опубликованная неизменяемая версия. Изменение создаёт новую version, не меняя уже выданные задания.

### 7.3. Assignment

Поля:

- `id`;
- `tenantId`;
- `classroomId`;
- `activityVersionId`;
- `audience`;
- `availableAt`;
- `dueAt`;
- `closesAt`;
- `attemptPolicy`;
- `gradingPolicy`;
- `latePolicy`;
- `status`;
- `createdBy`.

### 7.4. Audience

- весь класс;
- одна или несколько групп;
- отдельные ученики;
- исключения.

### 7.5. AttemptPolicy

- unlimited until close;
- fixed count;
- teacher reopens;
- new attempt after return;
- best score;
- last score;
- teacher-selected final attempt.

## 8. Работа ученика

### 8.1. Запуск

При первом открытии assignment:

```text
resolve module
→ verify entitlement and Safe Mode
→ create project from starter
→ create AssignmentWork link
→ open editor
```

Повторное открытие продолжает существующий draft.

### 8.2. Autosave

- локальный journal;
- operation batches;
- idempotent sync;
- server acknowledgements;
- checkpoints;
- понятный индикатор состояния сохранения.

### 8.3. Сдача

```text
final sync
→ validate project
→ immutable ProjectVersion
→ SubmissionAttempt
→ automated checks queued
→ student sees submitted status
```

## 9. Submission

Поля:

- `id`;
- `tenantId`;
- `assignmentId`;
- `studentPrincipalId`;
- `attemptNumber`;
- `projectVersionId`;
- `submittedAt`;
- `status`;
- `autoCheckStatus`;
- `reviewStatus`;
- `finalizedAt`.

Статусы:

- `submitted`;
- `processing`;
- `ready_for_review`;
- `changes_requested`;
- `accepted`;
- `rejected`;
- `superseded`.

## 10. Review

Review включает:

- reviewer;
- openedAt;
- decision;
- generalFeedback;
- annotations;
- rubricResult;
- score;
- grade;
- rewards;
- completedAt.

Решения:

- accept;
- request changes;
- reject with reason;
- mark incomplete;
- excuse.

## 11. Комментарии

### 11.1. Visibility

- private teacher-to-student;
- visible to all teachers of class;
- visible to project team;
- internal teacher note;
- system-generated check message.

### 11.2. Thread lifecycle

```text
open
→ acknowledged optional
→ resolved
→ reopened
```

### 11.3. Anchors

Anchor является module-defined object, но содержит универсальную оболочку:

```json
{
  "moduleKey": "electronics",
  "projectVersionId": "...",
  "anchorType": "component",
  "anchorRef": "led-17",
  "context": {"property":"anode"}
}
```

## 12. Оценивание

AssessmentResult отделён от Review, чтобы поддерживать автоматические пересчёты и разные шкалы.

Поля:

- `submissionId`;
- `rubricVersionId`;
- `criterionResults`;
- `rawScore`;
- `normalizedScore`;
- `gradeValue`;
- `competencyEvidence`;
- `calculationVersion`;
- `finalizedBy`.

Изменение финального результата создаёт revision/audit, а не скрытое перезаписывание истории.

## 13. Badges и certificates

### 13.1. BadgeDefinition

- tenant/platform scope;
- criteria;
- icon asset;
- category;
- evidence requirements;
- visibility;
- active version.

### 13.2. BadgeAward

- recipient;
- badge version;
- issuer;
- evidence;
- issuedAt;
- revokedAt optional;
- reason.

### 13.3. CertificateAward

- program/course version;
- completion evidence;
- verification code;
- issuedAt;
- PDF/render optional.

## 14. Progress

Progress не хранится одним процентом. Источники:

- assignment states;
- accepted submissions;
- lesson completion;
- rubric evidence;
- competency mastery;
- module events.

Процент является вычисляемым представлением с versioned calculation rule.

## 15. Notifications

События:

- assignment published;
- deadline changed;
- submission received;
- review completed;
- changes requested;
- comment added;
- badge awarded;
- class invitation;
- credential reset.

Каналы раннего этапа:

- in-app;
- teacher dashboard;
- optional email только взрослым в будущем.

## 16. Safe Mode

Политика задаётся на tenant/school/classroom уровне.

Может запрещать:

- публичную публикацию;
- внешние ссылки;
- загрузку произвольных файлов;
- межклассовое взаимодействие;
- копирование чужих проектов;
- использование неподтверждённых модулей;
- свободный текст в некоторых возрастных режимах.

Safe Mode не должен ломать обязательный учебный workflow.

## 17. Audit

Обязательные AuditEvents:

- classroom created/renamed/archived;
- membership added/removed;
- credential issued/reset;
- assignment published/changed/closed;
- submission decision;
- grade changed;
- badge issued/revoked;
- support access;
- policy changed.

AuditEvent неизменяем и содержит только необходимые technical identifiers и безопасный summary.

## 18. Масштаб и производительность

Для школьного пилота:

- 10–15 классов могут начать урок одновременно;
- roster pages поддерживают сотни учеников;
- assignment distribution не создаёт полный project snapshot для всех заранее без необходимости;
- autosave использует batches;
- dashboards используют пагинацию и агрегаты;
- review queue не загружает полный project payload до открытия.

## 19. API boundaries

Classroom Core предоставляет универсальные API:

- identity/session;
- classrooms/memberships/groups;
- activities/assignments;
- projects/versions;
- submissions/reviews;
- comments/annotations;
- assessments/rewards;
- notifications/progress.

Module-specific API находится за Module Platform и не добавляет условные ветки по `moduleKey` в Classroom domain.

## 20. Минимальная последовательность реализации

1. Teacher portal: login, classroom list/create.
2. Classroom lifecycle and owner membership.
3. StudentSeat issuance and child login.
4. Universal project envelope and first dummy module.
5. Assignment and submission lifecycle.
6. Review/comments/rubric/grade.
7. Badge award and progress.
8. Minimal electronics module through the same contracts.

Каждый шаг обязан давать наблюдаемый пользовательский результат и автоматизированный E2E.
