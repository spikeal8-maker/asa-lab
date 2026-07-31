# ASA Lab — Tinkercad Parity Specification

**Статус:** нормативная продуктовая спецификация.  
**Приоритет:** выше локальных UI-решений и отдельных вертикальных срезов.  
**Цель:** сначала воспроизвести целостную продуктовую модель Tinkercad для проектов, классов, публикации и учебной работы; улучшения ASA Lab вводятся только после подтверждения соответствующего parity gate.  
**Бренд и материалы:** интерфейс, информационная архитектура и пользовательские сценарии воспроизводятся максимально близко; бренд, логотипы, тексты, закрытый код и чужие графические ассеты не копируются. Используются бренд ASA Lab, собственный код и материалы владельца.

---

## 1. Главная корректировка курса

ASA Lab нельзя строить как цепочку отдельных страниц:

```text
Классы → проекты класса → один редактор
```

Целевая система должна состоять из двух равноправных контуров:

```text
Творческая проектная платформа
├── личные проекты пользователя
├── разные предметные редакторы
├── публикация и ссылки
├── публичные страницы проектов
├── профиль и портфолио
├── поиск, галерея и подборки
├── копирование / remix
└── социальные реакции и комментарии по политике безопасности

Образовательный Classroom-контур
├── классы и соучителя
├── ученические места и коды входа
├── безопасный просмотр работ
├── задания и стартовые проекты
├── отслеживание прогресса
├── сдача неизменяемых версий
├── комментарии и аннотации
├── возврат на доработку
├── оценки и badges
└── Safe Mode и модерация
```

Педагог одновременно является:

1. автором собственных проектов;
2. пользователем всех предметных редакторов;
3. создателем демонстраций и стартовых проектов;
4. владельцем классов;
5. модератором детских мест;
6. автором заданий;
7. проверяющим ученические работы.

Класс не является обязательным контейнером для личного проекта педагога или зарегистрированного пользователя.

---

## 2. Неподвижные parity-принципы

### 2.1. Project-first

После входа основной творческий экран — `Мои проекты`, а не `Мои классы`.

Пользователь может создать личный проект без класса:

```text
Мои проекты → Создать → выбрать модуль → редактор → автосохранение
```

### 2.2. Classroom — отдельный образовательный контекст

Класс отвечает за людей, задания, доступ и проверку. Он не подменяет личное проектное пространство.

### 2.3. Единый проектный lifecycle для всех модулей

Электроника, 3D, блоки, шахматы, шашки, робототехника и будущие редакторы обязаны использовать одну оболочку:

```text
Project
→ ProjectDraft
→ ProjectVersion
→ Preview
→ Visibility / Share / Publish
→ optional AssignmentWork
→ optional Submission
→ Review
```

### 2.4. Private by default

Любой новый проект создаётся приватным. Публичность — отдельное подтверждённое действие.

### 2.5. Публикация не равна сохранению

Рабочий draft не публикуется автоматически. Публикация указывает на конкретную неизменяемую версию.

### 2.6. Домашняя работа не становится публичной

Проект, созданный из задания, имеет `publicationLocked = true` по умолчанию. Ни draft, ни submission не могут попасть в публичную галерею без явной политики учителя/школы и отдельного пользовательского действия после завершения задания.

### 2.7. Safe Mode

Ученические места и детские аккаунты по умолчанию работают в Safe Mode:

- проекты приватны;
- публичная публикация запрещена;
- публичные комментарии и социальные взаимодействия ограничены;
- педагог видит работы своего класса;
- разрешены адресованные образовательные комментарии;
- все изменения политик аудируются.

### 2.8. No direct child messaging

Комментарии существуют только в контексте проекта, версии, задания или проверки. Произвольные личные сообщения детям не создаются.

### 2.9. Remix вместо изменения чужого проекта

Пользователь не редактирует публичный проект автора. Он создаёт собственную копию с сохранённой lineage-связью.

### 2.10. Parity before improvements

Новые улучшения ASA Lab не заменяют базовые сценарии Tinkercad до их завершения. Каждое отклонение фиксируется в `Parity Deviation Register` с причиной и решением владельца.

---

## 3. Информационная архитектура

### 3.1. Глобальная навигация взрослого пользователя

```text
Мои проекты
Классы
Обучение / Учебные материалы
Галерея / Обзор
Профиль
Уведомления
```

### 3.2. Мои проекты

Раздел содержит:

- все личные проекты;
- проекты, созданные в классах;
- совместные проекты;
- черновики;
- опубликованные проекты;
- архив;
- проекты по модулям;
- поиск и фильтры;
- сортировку по изменению, созданию, названию и модулю;
- быстрый переход к последнему открытому проекту.

### 3.3. Создание проекта

```text
Создать
├── Электроника
├── 3D-моделирование
├── Блочное программирование
├── Шахматы / шашки
├── Виртуальная робототехника
├── Рисование / черчение
└── другие включённые модули
```

Карточка модуля показывает:

- название;
- краткое назначение;
- иконку/preview;
- доступность;
- возраст/уровень optional;
- Safe Mode support;
- шаблоны или пустой проект.

Неработающий модуль может отображаться только как `Скоро`, без имитации рабочего редактора.

### 3.4. Карточка проекта

Карточка должна содержать:

- preview/thumbnail;
- название;
- тип модуля;
- владельца;
- дату изменения;
- видимость;
- опубликован ли проект;
- принадлежность классу или заданию;
- быстрые действия.

Действия:

```text
Открыть
Переименовать
Дублировать
Поделиться
Опубликовать / снять с публикации
Создать копию
Переместить в архив
Удалить
```

### 3.5. Классы

```text
Классы
→ класс
   ├── Обзор
   ├── Ученики
   ├── Проекты
   ├── Задания
   ├── Активность
   ├── Проверка
   ├── Оценки
   ├── Достижения
   ├── Соучителя
   └── Настройки
```

---

## 4. Роли

### 4.1. Creator / взрослый пользователь

Может:

- создавать личные проекты;
- работать во всех разрешённых модулях;
- публиковать проекты;
- создавать unlisted links;
- просматривать галерею;
- делать копии/remix;
- ставить likes/bookmarks;
- комментировать согласно политике;
- вести публичный профиль/портфолио.

### 4.2. Педагог

Дополнительно может:

- создавать классы;
- выпускать StudentSeat;
- приглашать соучителей;
- создавать демонстрационные и стартовые проекты;
- назначать активности;
- видеть текущие работы класса;
- открывать точные версии;
- оставлять образовательные комментарии;
- возвращать на доработку;
- оценивать;
- выдавать badges;
- управлять Safe Mode класса.

### 4.3. Зарегистрированный ученик

Имеет личные проекты и портфолио, но публичность зависит от возраста, consent и Safe Mode.

### 4.4. StudentSeat без email

Имеет:

- доступ через class code / nickname / credential;
- только разрешённые классы, задания и проекты;
- приватные проекты;
- отсутствие публичного профиля по умолчанию;
- отсутствие публичной публикации;
- образовательные комментарии только от учителей/разрешённой команды.

### 4.5. Соучитель

Права выдаются грантами:

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

### 4.6. Модератор / school admin

Управляет:

- публикационными политиками;
- Safe Mode;
- жалобами;
- доступностью галереи;
- разрешёнными модулями;
- retention;
- аудитом.

---

## 5. Универсальная модель проекта

### 5.1. Project

```text
id
tenantId
ownerPrincipalId
ownerProfileId
scope: personal | classroom | assignment | team
classroomId optional
assignmentId optional
moduleKey
moduleVersion
projectType
schemaVersion
title
description
status: active | archived | deleted
visibility: private | class | organization | unlisted | public
publicationState: never_published | draft | published | unpublished | moderated
publishedVersionId optional
publicationLocked
remixPolicy
commentPolicy
createdAt
updatedAt
```

### 5.2. ProjectDraft

Изменяемое состояние редактора:

- payload;
- rowVersion;
- autosave cursor;
- updatedBy;
- updatedAt;
- dirty/saving/saved/conflict/error состояния.

### 5.3. ProjectVersion

Неизменяемый снимок:

- payload;
- module/schema version;
- digest;
- author;
- parent version;
- preview;
- createdAt.

Используется для:

- публикации;
- sharing;
- submissions;
- review;
- comparison;
- remix lineage.

### 5.4. ProjectPreview

Детерминированное preview:

- SVG/PNG/board/schematic/video/GIF/summary;
- связано с digest версии;
- безопасно для карточек и публичного viewer;
- не содержит credentials или скрытые тесты.

### 5.5. ProjectFork / Remix

```text
sourceProjectId
sourceVersionId
forkProjectId
forkedBy
forkedAt
attributionMode
```

Remix создаёт независимый личный проект пользователя и сохраняет ссылку на источник.

---

## 6. Видимость, ссылки и публикация

### 6.1. Уровни видимости

#### private

Видит только владелец и явно разрешённые модераторы/учителя.

#### class

Видят участники конкретного класса согласно политике. Другие классы и публичные пользователи доступа не имеют.

#### organization

Видят авторизованные пользователи организации, если school policy разрешает.

#### unlisted

Доступ по случайной ссылке. Проект не индексируется и не появляется в галерее.

#### public

Публичная страница, поиск, галерея и профиль автора — только после проверки правил безопасности.

### 6.2. ShareLink

```text
id
tokenHash
projectId
versionId
permission: view | copy | collaborate
expiresAt optional
maxUses optional
createdBy
revokedAt
```

Открытый token не хранится в базе после выдачи.

### 6.3. Publish flow

```text
ProjectDraft
→ final sync
→ validation
→ immutable ProjectVersion
→ title / description / tags / cover
→ visibility and policies
→ moderation decision if required
→ PublishedProject page
```

### 6.4. Unpublish

Снятие с публикации:

- удаляет проект из галереи и профиля;
- прекращает новые публичные открытия;
- не удаляет проект и версии;
- сохраняет audit;
- действующие assignment/submission references не ломаются.

### 6.5. Assignment publication lock

`scope = assignment` означает:

- `visibility = private` или `class`;
- `publicationLocked = true`;
- teacher feedback не является публичным комментарием;
- submission никогда не появляется в Explore автоматически;
- после завершения учитель может разрешить ученику создать личную копию для публикации.

---

## 7. Публичная страница проекта

Страница опубликованного проекта содержит:

- preview/viewer;
- название;
- модуль;
- автора/псевдоним согласно policy;
- описание;
- теги;
- дату публикации и изменения;
- количество просмотров;
- like;
- bookmark/save to collection;
- share;
- copy/remix;
- comments по policy;
- report;
- attribution/remix lineage;
- related projects.

Viewer открывает опубликованную `ProjectVersion`, а не текущий draft автора.

Для электроники viewer может запускать безопасную симуляцию без права изменить оригинал.

---

## 8. Профиль и портфолио

### 8.1. Взрослый/разрешённый профиль

Показывает:

- avatar;
- display name;
- описание;
- опубликованные проекты;
- подборки;
- likes/bookmarks optional;
- badges;
- вклад по модулям;
- remix lineage.

### 8.2. Детский профиль

По умолчанию:

- не публичный;
- без реального ФИО;
- без поиска;
- без открытого списка классов;
- без географии/школы;
- публичное портфолио возможно только по отдельной подтверждённой политике.

---

## 9. Галерея / Explore

### 9.1. Лента

Фильтры:

- модуль;
- категория;
- теги;
- новое;
- популярное;
- рекомендуемое;
- проекты сообщества;
- школьные подборки optional.

### 9.2. Ranking safety

Рейтинг не должен продвигать небезопасный или непроверенный детский контент.

Сигналы:

- moderation state;
- возраст проекта;
- likes;
- views;
- remixes;
- curator score;
- report rate;
- diversity cap;
- safe mode compatibility.

### 9.3. Search

Индексирует только опубликованные и разрешённые объекты:

- title;
- description;
- tags;
- module;
- author display name;
- curated collections.

---

## 10. Социальные действия

### 10.1. Like

Один пользователь — один like на опубликованный проект. Like можно снять.

### 10.2. Bookmark / Collection

Пользователь сохраняет проект в личную подборку без изменения оригинала.

### 10.3. PublicComment

Отделён от образовательного `ReviewComment`.

Поля:

- publishedProjectId;
- author;
- body;
- status;
- parentCommentId optional;
- createdAt;
- editedAt;
- moderation metadata.

### 10.4. Report

Причины:

- персональные данные;
- травля;
- неприемлемый контент;
- нарушение авторства;
- опасная инструкция;
- spam;
- другое.

### 10.5. Ограничения

- StudentSeat не пишет публичные комментарии;
- Safe Mode блокирует публичные social actions;
- rate limit обязателен;
- profanity/personal-data screening обязателен;
- удаление и модерация аудируются.

---

## 11. Classroom parity

### 11.1. Создание и вход

```text
Teacher creates class
→ class code / link
→ teacher adds nicknames or students join
→ Safe Mode enabled by default
→ teacher sees seats and activity
```

Поддерживаются:

- существующая учётная запись;
- StudentSeat без регистрации;
- nickname;
- индивидуальный credential;
- QR/access card;
- co-teacher.

### 11.2. Student work visibility

Педагог класса может:

- видеть список проектов каждого ученика в классе;
- фильтровать по ученику, модулю и активности;
- видеть updatedAt и save status;
- открыть текущий draft read-only;
- открыть точную version;
- увидеть progression/version history;
- создать teacher copy;
- оставить образовательный комментарий;
- перейти к заданию и submission.

Педагог не должен незаметно изменять проект ученика. Режим помощи, если появится, требует явного входа, баннера и AuditEvent.

### 11.3. Activity feed

Лента класса показывает:

- ученик открыл задание;
- создан проект;
- сохранена версия;
- отправлена работа;
- запрошены изменения;
- принята работа;
- выдан badge;
- credential reset;
- moderation event.

Payload проекта в ленту не копируется.

---

## 12. Задания и стартовые проекты

### 12.1. Teacher starter project

Педагог создаёт личный проект, настраивает его и публикует как `ActivityVersion` или starter checkpoint.

Оригинал педагога не становится редактируемым учениками.

### 12.2. Assignment flow

```text
Teacher selects project/activity
→ chooses class/group/students
→ dates and attempt policy
→ publish assignment
→ every student gets AssignmentWork
→ starter is copied to own ProjectDraft
→ teacher monitors progress
→ student submits immutable ProjectVersion
→ teacher reviews
```

### 12.3. Progress states

```text
not_started
opened
in_progress
saved
submitted
changes_requested
resubmitted
accepted
late
excused
```

### 12.4. Teacher monitoring

Dashboard shows:

- opened/not opened;
- last activity;
- draft saved time;
- validation diagnostics summary;
- submitted attempt;
- need help flag;
- review state;
- grade/badge.

---

## 13. Review, comments and assessment

### 13.1. Educational comments

Types:

- general feedback;
- anchored component/object comment;
- internal teacher note;
- class teacher visibility;
- project team visibility;
- system check message.

### 13.2. Anchor envelope

```json
{
  "moduleKey": "electronics",
  "projectVersionId": "...",
  "anchorType": "component",
  "anchorRef": "led-17",
  "property": "anode"
}
```

Для других модулей:

- chess/checkers: piece, square, move;
- blocks: block, sprite, stage;
- 3D: object, face, constraint;
- drawing: object, dimension.

### 13.3. Review decisions

```text
accept
request_changes
mark_incomplete
reject_with_reason
excuse
```

### 13.4. Grades and badges

Результат связан с точной submission version и evidence. Педагог может вручную выдавать skill badges; badge отображается в кабинете ученика.

---

## 14. Module Platform parity

Каждый модуль предоставляет:

```text
manifest
createEmptyProject
editor
viewer
preview
validate
migrate
copy/remix support
export optional
assignment starter support
review anchor validation
safe mode declaration
```

### 14.1. Обязательные общие экраны

Независимо от предмета пользователь получает одинаковые platform actions:

- название проекта;
- save state;
- undo/redo if supported;
- duplicate;
- share;
- publish;
- copy/remix;
- versions;
- return to project hub;
- assignment context if present.

### 14.2. Предметные редакторы

#### Electronics

Полноэкранная схема, компоненты, провода, simulation, code optional.

#### Block coding

Stage, sprites, blocks, variables, assets, run/stop, preview.

#### 3D

Workplane, shapes library, transforms, camera, import/export, preview.

#### Chess/checkers

Board, pieces, positions, move history, tasks, annotations, preview.

#### Robotics

World, robot, sensors, actuators, code, simulation replay.

### 14.3. Core не содержит предметных switch

Запрещено добавлять логику вида:

```ts
if (moduleKey === 'electronics') { ... }
```

в Classroom, Publication, Assignment, Submission, Profile или Explore Core.

---

## 15. Экранная parity-карта

### 15.1. Auth

- Sign in;
- Join class;
- teacher registration;
- student nickname/class code;
- account recovery.

### 15.2. Dashboard

- My Projects;
- Classes;
- Learn;
- Explore;
- profile menu;
- create action.

### 15.3. Project Hub

- module tabs/filters;
- grid/list;
- cards with previews;
- create chooser;
- context menu;
- archive/trash.

### 15.4. Editor Host

- top toolbar;
- project name;
- save state;
- module modes;
- run/simulate;
- share/send;
- full work area;
- module library/inspector.

### 15.5. Public Project Page

- viewer;
- author;
- metadata;
- like;
- comment;
- remix/copy;
- share;
- report;
- related projects.

### 15.6. Explore

- module categories;
- featured/recent/popular;
- search;
- project cards;
- curated collections.

### 15.7. Classroom

- students;
- projects/activity;
- assignments;
- review;
- badges;
- settings;
- co-teachers.

### 15.8. Student Dashboard

- classes;
- assignments;
- own projects;
- feedback;
- badges;
- safe mode indicator.

---

## 16. Permission matrix

| Действие | Взрослый creator | Teacher | Registered student | StudentSeat Safe Mode | Co-teacher |
|---|---:|---:|---:|---:|---:|
| Создать личный проект | да | да | policy | нет/ policy | да |
| Создать class project | нет | да | через assignment/team | через assignment | grant |
| Видеть свой draft | да | да | да | да | да |
| Видеть draft ученика | нет | свой класс | нет | нет | grant |
| Публично опубликовать | да | да | consent/policy | нет | да |
| Создать unlisted link | да | да | policy | нет | да |
| Remix public project | да | да | policy | нет/teacher copy | да |
| Public comment | да | да | policy | нет | да |
| Educational comment | нет | да | reply policy | reply policy | grant |
| Назначить задание | нет | да | нет | нет | grant |
| Проверить submission | нет | да | нет | нет | grant |
| Выдать badge | нет | да | нет | нет | grant |

---

## 17. Минимальная модель данных parity-уровня

```text
User
Profile
StudentSeat
Classroom
ClassroomMembership
Project
ProjectDraft
ProjectVersion
ProjectPreview
ProjectFork
ShareLink
PublishedProject
PublicationRevision
ProjectLike
ProjectBookmark
Collection
PublicComment
ContentReport
ModerationCase
ActivityTemplate
ActivityVersion
Assignment
AssignmentWork
SubmissionAttempt
Review
ReviewComment
AssessmentResult
BadgeDefinition
BadgeAward
Notification
AuditEvent
```

Сущности публикации, публичных комментариев и образовательных комментариев не объединяются в одну таблицу/модель.

---

## 18. API / use-case surface

### Projects

```text
create personal project
create classroom project
list my projects
list class projects
open draft
save draft
checkpoint
rename
archive
restore
delete
copy
remix
```

### Sharing and publication

```text
create/revoke share link
publish version
update publication metadata
unpublish
get public page
report content
```

### Community

```text
explore feed
search
like/unlike
bookmark
collections
public comment
moderate
```

### Classroom

```text
create class
join by code
manage seats
list student projects
view student draft/version
class activity feed
co-teacher grants
```

### Assignment

```text
create activity from project
publish assignment
create student work copy
monitor progress
submit version
comment/review
request changes
accept
grade
award badge
```

---

## 19. Safety and moderation

### 19.1. Safe defaults

- project private;
- profile private for children;
- assignment publication locked;
- public comments disabled for StudentSeat;
- public search excludes unmoderated child content;
- real name not required for public display;
- school/class membership never exposed publicly.

### 19.2. Moderation pipeline

```text
publish request
→ automated checks
→ policy decision
→ optional human moderation
→ public
→ report handling
→ restrict/unpublish/restore
```

### 19.3. Audit

Обязательные AuditEvent:

- visibility changed;
- share link created/revoked;
- published/unpublished;
- remix created;
- Safe Mode changed;
- teacher opened student work;
- educational comment created/edited/deleted;
- submission reviewed;
- grade/badge changed;
- moderation decision.

---

## 20. Parity release order

### Release P0 — Contract freeze

- эта спецификация;
- parity matrix;
- deviations register;
- current code gap report.

### Release P1 — Project Hub and module chooser

- My Projects as primary screen;
- personal projects without class;
- module chooser;
- universal project cards;
- module registry;
- editor host;
- previews;
- versions.

### Release P2 — Sharing and publication

- private/class/organization/unlisted/public;
- share links;
- publish/unpublish;
- published version;
- public project page;
- copy/remix;
- attribution.

### Release P3 — Profiles and Explore

- public profile;
- gallery/search/filters;
- likes/bookmarks/collections;
- public comments;
- reports and moderation.

### Release P4 — Classroom parity

- StudentSeat/class code;
- co-teachers;
- student project list;
- current draft/version viewer;
- activity feed;
- Safe Mode controls.

### Release P5 — Assignments and feedback

- teacher project → ActivityVersion;
- starter copy per student;
- progress monitor;
- immutable submission;
- comments/anchors;
- request changes/accept;
- grades and badges.

### Release P6 — Multi-module proof

- Electronics;
- Block coding;
- Chess/checkers;
- 3D;
- same hub/share/publish/classroom lifecycle without Core branches.

---

## 21. Acceptance gates

### Gate G1 — Personal creation

Педагог создаёт личный проект любого активного модуля без класса, видит card/preview, открывает, сохраняет и создаёт version.

### Gate G2 — Public sharing

Пользователь публикует конкретную version, получает публичную страницу и ссылку; другой пользователь открывает viewer и создаёт remix, не изменяя оригинал.

### Gate G3 — Safe classroom

StudentSeat входит по коду, видит только свой класс/работы, не может публиковать, а педагог видит текущую работу и историю.

### Gate G4 — Assignment cycle

Педагог назначает starter project; ученик получает копию, работает, сдаёт version; педагог комментирует, возвращает, принимает и выдаёт badge.

### Gate G5 — Community

Публичные проекты появляются в Explore/profile; like, bookmark, comment, report и moderation работают по policy.

### Gate G6 — Module neutrality

Не менее трёх существенно разных модулей проходят один project/publication/classroom lifecycle без предметной логики в Core.

---

## 22. Parity Deviation Register

Любое отличие от референсного поведения фиксируется:

```yaml
id: DEV-...
surface: project-hub | editor | sharing | explore | classroom | assignment | safety
reference_behavior: ...
asa_behavior: ...
reason: legal | child-safety | technical-blocker | owner-improvement
owner_decision: pending | accepted | rejected
target_release: ...
```

Без записи в register агент не имеет права самовольно заменять parity-поток «улучшенной» схемой.

---

## 23. Текущий gap report

На момент создания спецификации в ASA Lab уже есть:

- teacher login;
- базовый список классов;
- Project/Draft/Version foundation;
- Electronics editor foundation;
- PostgreSQL/RLS;
- базовый save/reload/checkpoint.

Отсутствует или не завершено:

- универсальный Module Registry;
- единый My Projects hub в main;
- нормальный module chooser;
- previews для project cards;
- visibility model;
- unlisted/public links;
- published project page;
- copy/remix lineage;
- profiles/portfolio;
- Explore/gallery/search;
- likes/bookmarks/public comments;
- moderation/reporting;
- StudentSeat parity;
- class activity and student work visibility;
- assignment starter copy;
- submission/review/comments/grades/badges;
- multi-module proof.

Электронный редактор является одним предметным модулем, а не заменой всей платформе.

---

## 24. Правило для coding-агентов

Перед началом продуктовой задачи агент обязан ответить:

1. Какой parity capability реализуется?
2. Какой пользовательский экран станет видимым?
3. Какой референсный flow воспроизводится?
4. Какие роли участвуют?
5. Какова privacy/publication policy?
6. Работает ли решение для других модулей через контракт?
7. Какой parity gate закрывается?

Задача, не отвечающая этим вопросам, не должна начинаться.
