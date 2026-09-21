# ASA Lab — архитектурный план учебной работы

**Идентификатор:** LRN-WORK-ARCH-01  
**Статус:** нормативный архитектурный контракт E1  
**Дата:** 21 сентября 2026 года  
**Связанные требования:** E1-FIX-13, E1-FIX-14, Issues #368 / #371

## 1. Главный принцип

Учебная работа пересекает опубликованное задание, Course Activity occurrence, проект, попытку, сдачу, проверку и список проектов. Эти поверхности не должны независимо угадывать связь по projectId.

В E1 вводится одна серверная проекция **Learning Work Context** — источник истины для конкретного открытого проекта и текущего пользователя.

~~~text
Published LearningActivityVersion
          ↓ exact immutable task snapshot
ActivityRun
          ↓
ActivityParticipation
          ↓
Attempt
          ↓
Learning Project Origin ─────→ Project
          ↓                       ↓
Learning Work Context         ProjectVersion
          ↓                       ↓
learner shell              Submission (exact)
          ↓                       ↓
project list               teacher review
~~~

Course Activity occurrence дополнительно сохраняет sourceCourseBlockId; direct assignment использует ту же нижнюю цепочку.

## 2. Один серверный контекст по projectId

Целевой read contract по смыслу:

~~~text
GET /api/learning/projects/:projectId/context
~~~

Конкретный маршрут может отличаться, но canonical read должен быть один, а не клиентский join нескольких списков.

Для учебной работы ответ содержит:

~~~text
projectId
moduleKey

origin:
  participationId
  activityRunId
  learningActivityVersionId
  sourceKind: direct | course
  classroomAssignmentId
  courseRunId?
  courseLessonId?
  courseBlockId?

task:
  exact version identity
  version number / digest
  title
  goal
  ordered content blocks
  due/availability presentation

workflow:
  canonical learner state
  attemptId / attemptNumber
  submissionId?
  submittedProjectVersionId?

allowedActions:
  edit
  submit
  resumeAfterChangesRequested
  moveToLearningArchive
  restoreFromLearningArchive
  createPersonalCopy
  changeGenericProjectStatus
  publishOriginal

presentation:
  learnerCollectionState
  safe classroom/course/lesson labels
~~~

Для личного проекта сервер возвращает явное состояние not_learning. Ошибка доступа или сервера не маскируется под «задания нет».

## 3. Запрещён клиентский поиск происхождения

После появления canonical context запрещается использовать как identity resolver:

~~~text
seatAssignments()
+ seatCourseRuns()
+ поиск item.projectId === projectId
~~~

Списки остаются для экранов списков, но не определяют смысл конкретной открытой работы.

## 4. Полный неизменяемый снимок задания

LearningActivityVersion должен содержать или неизменяемо ссылаться на полный learner-facing snapshot.

Минимум:

~~~text
taskSnapshot:
  title
  goal
  blocks[]
  mediaRefs[]
  starterProjectVersionId?
  contentDigest
~~~

Поддержанные блоки оболочки:

~~~text
heading
paragraph
list
callout
image
video
file
link
~~~

Legacy instructions допускается проецировать в блоки. Нельзя собирать старую опубликованную версию из immutable title/instructions и mutable current image/video/file.

Published media reference должен быть immutable либо ссылаться на immutable asset version/digest. Недоступный asset даёт явную ошибку.

## 5. Возможности предметного модуля

Учебная поддержка определяется capability модуля в общем registry, а не списком electronics/three-d.

Целевая форма по смыслу:

~~~text
learningCapabilities:
  assignable: boolean
  editableEvidence: boolean
  submitProjectVersion: boolean
  preview:
    snapshot | interactive | summary | none
~~~

Модуль может быть active/creatable, но ещё не assignable.

Course Builder предлагает модуль как практику только когда module registry подтверждает учебную возможность. Новая лаборатория не требует нового условия по moduleKey внутри Learning.

## 6. Атомарный Start учебной работы

Текущий двухшаговый клиентский flow:

~~~text
createProject()
→ startSeatAssignment(projectId)
~~~

не является конечным контрактом: сбой второго шага оставляет обычный проект без учебного происхождения.

Целевая команда StartLearningWork атомарно и идемпотентно:

1. проверяет learner/participation;
2. создаёт или повторно использует Project;
3. фиксирует immutable Learning Project Origin;
4. создаёт/возвращает canonical Attempt;
5. возвращает projectId и identity учебной работы.

Один requestId + тот же payload возвращает тот же project/attempt. Иной payload с тем же requestId конфликтует.

## 7. Learning Project Origin

Нужна явная immutable server-side связь:

~~~text
projectId ↔ ActivityParticipation
~~~

Требования:
- tenant/school/learner coherent;
- immutable;
- direct и course occurrence используют один формат;
- Course Activity сохраняет sourceCourseBlockId;
- Seat→Account linking не меняет origin;
- personal copy не наследует origin;
- legacy без доказуемой связи помечается compatibility/unknown, а не выдумывается.

## 8. Единая policy защиты проекта

Все project mutations обращаются к одной server-side learning-work policy.

Минимально policy применяется к:
- generic archive;
- trash;
- duplicate;
- gallery publish;
- personal copy;
- learning archive;
- edit после terminal acceptance.

Нельзя защищать проект разными несогласованными условиями в отдельных контроллерах.

По умолчанию accepted/completed original становится read-only для ученика. Если появляется changes_requested, редактирование и повторная сдача снова разрешаются.

## 9. Платформенные слои над редактором

Общий editor host владеет слоями:

~~~text
subject editor
< learning work overlay
< learning modal / lightbox / pinned reference
< critical platform/system modal
~~~

Предметный модуль не должен перекрывать Learning overlay произвольным fullscreen z-index.

Для iframe/embedded runtime оболочка остаётся в parent document поверх runtime.

Desktop drag/resize использует pointer capture или эквивалент, чтобы движение не терялось при пересечении iframe/canvas.

Геометрия:
- max width не более 70% viewport;
- max height не более 80% usable viewport;
- карточка не выходит за viewport;
- есть reset без drag;
- 320/390 используют отдельную mobile presentation.

## 10. Teacher preview

Основной review не запускает editor.

Уровни preview:

~~~text
snapshot
interactive read-only
summary
~~~

Любой preview читает exact submitted ProjectVersion/evidence. Current/latest draft не подменяет Submission.

Полный editor открывается отдельным действием и возвращает в ту же review queue.

## 11. Очередь проверки

Для выбранного ActivityRun/occurrence порядок по умолчанию:

1. waiting review;
2. submittedAt по возрастанию;
3. стабильный learner key при равном времени.

После Accept/Return открывается следующая работа текущего фильтра. Stale/concurrent review не перезаписывает новое решение.

## 12. Состояния оболочки

Оболочка различает:

~~~text
resolving
not_learning
ready
denied
unavailable
~~~

Для учебного проекта unavailable не превращается в отсутствие карточки. Ученик видит безопасную ошибку и возможность повторить/вернуться.

## 13. Порядок реализации после критического анализа

### A0 — фундамент оболочки
- platform layer contract;
- pointer capture;
- пределы 70%/80%;
- browser acceptance 1440/390/320;
- видимость поверх Electronics, 3D и Blocks/Scratch.

### A1 — Learning Work Context
- один server resolver by projectId;
- direct + legacy lesson + Course Activity occurrence;
- canonical workflow + allowed actions;
- AssignmentBrief перестаёт перебирать списки.

### A2 — immutable full task snapshot
- goal;
- ordered safe blocks;
- immutable media refs;
- digest/version tests;
- новый author draft не меняет существующий run.

### A3 — module learning capabilities
- registry contract;
- убрать hard-coded Electronics/3D;
- текущая capability matrix;
- тест будущего модуля без изменения Learning.

### A4 — atomic StartLearningWork + origin
- idempotent transaction;
- нет orphan personal project;
- immutable project↔Participation;
- direct + Course Activity.

### A5 — protection и список работ
- единая mutation policy;
- badge/filter;
- accepted original read-only;
- learning archive.

### A6 — rich shell
- image zoom/pin;
- video/file/link;
- desktop/mobile refinement.

### A7 — personal copy
- server-derived eligibility;
- новый personal project;
- без Learning linkage/private provenance leakage.

### A8 — teacher review workspace
- occurrence queue;
- exact submission preview;
- filters/previous/next;
- assessment controls;
- optional full editor.

## 14. Зависимость от PR #361

Course Activity occurrence runtime из PR #361 является upstream для A1/A4.

До принятия D5:
- A0 можно завершить независимо;
- архитектуру A1–A8 можно фиксировать;
- новый параллельный occurrence materializer/resolver не создавать;
- A1/A4 реализуются от принятой canonical occurrence модели.

## 15. Запрещённые сокращения

Запрещено:
- считать проект учебным по scope/route;
- искать assignment перебором UI-списков;
- hard-code module keys в Learning;
- создавать новый учебный Project отдельно от origin;
- показывать mutable media как часть старой published version;
- защищать trash только скрытием кнопки;
- разрешать publish original через linked Account;
- teacher preview latest draft вместо submitted version;
- считать overlay готовым, если он виден в Electronics, но скрыт fullscreen Scratch runtime.


## 16. Видимая поставка и границы тестов

Порядок owner-visible checkpoints V1–V7 и обязательный evidence contract определены в ASA_LEARNING_VISIBLE_DELIVERY_PLAN.md.

Инженерный A-срез не считается продуктово принятым только по unit/API evidence. Для UI-changing slice нужны:
- real browser journey;
- exact-HEAD screenshots;
- независимый просмотр screenshots;
- явное READY_TO_MERGE.

Интеграционные тесты общей Learning-оболочки проверяют публичную границу subject module. Нельзя привязывать A0 к случайному внутреннему selector соседнего runtime.

Если ТЗ разрешает восстановление локального UI state, тест не предполагает canonical default без явного reset/clean storage. Default geometry проверяется отдельно от persisted geometry.

На текущем маршруте:
1. V1/A0 / PR #369;
2. D5 / PR #361;
3. V2/A1+A2;
4. остальные checkpoints по ASA_LEARNING_VISIBLE_DELIVERY_PLAN.md.
