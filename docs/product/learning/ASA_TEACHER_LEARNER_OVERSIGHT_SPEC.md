# ASA Lab — педагогический обзор ученика и границы доступа к работам

**Идентификатор:** LRN-TEACHER-LEARNER-OVERSIGHT-01  
**Статус:** нормативная детализация E1  
**Дата:** 21 сентября 2026 года  
**Связанные требования:** PRODUCT-INTEGRATED-V15 §4.5 / §4.10 / §4.14, E1-FIX-13, E1-FIX-15

## 1. Два разных преподавательских режима

### 1.1 Профиль ученика

Путь:

~~~text
Класс / учебная группа
→ Учащиеся
→ конкретный ученик
~~~

Цель: ответить на вопрос «чем этот ученик занимается и что он создавал?»

Это не экран проверки одного задания.

Учитель видит:
- профиль ученика;
- последнее присутствие/активность в пределах класса;
- проекты в разрешённом learner scope;
- учебные работы;
- состояния работ;
- историю действий;
- результаты/отклики в разрешённой области;
- переход в конкретный project;
- preview project;
- при разрешении — открыть editor проекта.

### 1.2 Проверка задания

Путь:

~~~text
Класс / курс
→ конкретное задание / Activity occurrence
→ очередь учеников
→ конкретная сдача
~~~

Цель: ответить на вопрос «что именно этот ученик сдал по этому заданию?»

Здесь основной объект — immutable Submission/exact ProjectVersion. Учитель не оценивает latest draft вместо того, что было сдано.

## 2. Инвариант согласованности

Одна и та же учебная работа достижима двумя путями:

~~~text
Ученик → Работы → project
~~~

и:

~~~text
Задание → Ученик → submission
~~~

Они не являются двумя копиями работы.

Профиль ученика показывает текущий project и его canonical learning state.
Проверка задания показывает exact submitted evidence.

Если после сдачи ученик изменил разрешённый draft:
- в профиле ученика может быть виден более новый текущий project;
- в review всё равно показывается exact submitted version;
- UI явно различает «Текущая работа» и «Сданная версия», если они различаются.

Нельзя получать ситуацию:
- в профиле ученика работа исчезла, хотя Submission существует;
- в задании Submission есть, а профиль ученика утверждает «работ нет»;
- review молча показывает current draft вместо submitted evidence.

## 3. Какие проекты преподаватель видит

### 3.1 StudentSeat

StudentSeat — управляемый учебный профиль конкретного Classroom.

Преподаватель с действующим staff scope exact Classroom видит все проекты, принадлежащие этому StudentSeat, включая:
- project из assignment;
- project из Course Activity occurrence;
- project, который ученик самостоятельно создал в доступной лаборатории под этим StudentSeat;
- завершённую/архивированную учебную работу, если retention/access policy разрешает read;
- preview и activity history.

Это соответствует педагогической модели: StudentSeat существует внутри управляемой учебной группы.

### 3.2 Account learner

Обычный Account остаётся личным аккаунтом.

Преподаватель конкретного Classroom видит:
- learning projects этого Account, происходящие из Participation/Assignment/CourseRun этого Classroom;
- projects, которые пользователь явно передал/связал с этим Classroom, если такая функция поддерживается;
- exact Submissions и Results в этом Classroom.

Преподаватель не получает автоматически:
- все личные проекты Account;
- проекты из другой учебной группы;
- проекты другого преподавателя;
- личные черновики, не переданные в учебный scope;
- глобальный профиль/настройки Account.

Seat→Account linking не превращает class staff в глобального администратора Account.

### 3.3 Будущая managed-school policy

Если организация в будущем вводит полностью управляемые школьные Account, более широкая видимость требует отдельной явной organization/school policy и permission. Она не выводится автоматически из роли «учитель».

## 4. Карточка проекта в профиле ученика

Пример обычного StudentSeat-проекта:

~~~text
┌───────────────────────────────────┐
│ Электроника · Мостовая схема      │
│                                   │
│ Проект ученика                    │
│ Изменён сегодня 14:32             │
│                                   │
│ [Посмотреть] [Открыть проект]     │
└───────────────────────────────────┘
~~~

Для assignment-linked:

~~~text
┌───────────────────────────────────┐
│ Закон Ома                         │
│ 🎓 Учебная работа                 │
│ Основы электроники · Урок 4       │
│ Сдано · ждёт проверки             │
│                                   │
│ [Посмотреть] [Перейти к проверке] │
└───────────────────────────────────┘
~~~

## 5. Действия преподавателя в профиле ученика

По разрешённому project:
- открыть lightweight preview;
- открыть project в editor для просмотра;
- при существующей policy — дать неофициальный feedback/значок;
- увидеть, связан ли project с assignment;
- перейти к exact review, если есть Submission;
- увидеть activity history;
- увидеть, что project был изменён после Submission.

Редактирование ученического project преподавателем не считается обычным правом review.

Если product допускает teacher edit конкретного class-managed project, это отдельное audited действие:
- actor = teacher;
- project отмечает lastEditedByTeacher;
- Submission history не переписывается;
- past submitted evidence immutable;
- ученик видит, что преподаватель изменял project.

## 6. Переход «Профиль ученика → Проверка»

Если project связан с canonical assignment и существует Submission, действие «Перейти к проверке» открывает review workspace:
- того же Classroom;
- того же assignment/activity occurrence;
- того же learner;
- выбранной exact Submission.

Никакого повторного поиска «какое это задание?» на клиенте.

## 7. Переход «Проверка → Профиль ученика»

Из review workspace доступно действие «Открыть профиль ученика». Возврат сохраняет Classroom, assignment queue/filter и selected learner, если пользователь возвращается назад.

## 8. Различие live project и submitted version

Если latest project revision отличается от submitted revision, teacher UI показывает это явно:

~~~text
Сданная версия: 5
Текущая работа: 7

[Смотреть сданную] [Смотреть текущую]
~~~

Основная review surface всегда открывает submitted.
Текущая версия доступна только через профиль/явное вторичное действие.

## 9. Удаление/архив ученика не ломает преподавательскую историю

Если ученик убрал project в learning archive, создал personal copy, завершил курс или вышел из Participation, teacher review/history сохраняют Attempt, Submission, ProjectVersion, Result и audit.

Профиль ученика может показывать original project в historical/learning work section по retention policy.

## 10. Активность ученика

«Что делает» — педагогический activity feed, а не скрытая слежка за экраном.

Допустимые события:
- открыл/создал project;
- сохранил project;
- начал учебную работу;
- сдал;
- получил changes requested;
- продолжил;
- завершил;
- teacher edited/reviewed;
- project archived/restored, если применимо.

Не записывать:
- каждое движение мыши;
- содержимое несохранённого ввода;
- keystroke logging;
- произвольное наблюдение экрана без отдельного support/session consent contract.

## 11. Permissions и scope

Преподавательская видимость выводится из exact Classroom/Run staff scope, а не из строки role name.

Для StudentSeat exact-class staff может иметь broad project read внутри этого managed Seat scope.
Для Account learner class staff видит только learning/shared resources своего Classroom/Run.

Existing project.read остаётся resource-scoped: этот документ определяет, какие projects становятся разрешёнными resources через managed StudentSeat/class learning provenance. Он не превращается в read-all-projects-by-account.

submission.read остаётся отдельным правом exact Submission.

## 12. Текущая реализация, которую нужно переиспользовать

Уже существуют:
- ClassroomStudentPage;
- endpoint GET /api/classrooms/:classroomId/students/:seatId;
- classroom_seat_projects;
- список «Работы»;
- activity feed «Что делает»;
- WorkPreview;
- assignment context на work;
- canonicalState;
- lastEditedByTeacher;
- переход в editor.

Новый product work должен конвергировать эти поверхности с canonical Learning Work Context и teacher review workspace, а не строить второй профиль ученика.

## 13. Визуальная приёмка

Минимальный synthetic scenario:
- один Classroom;
- один learner;
- один personal-in-Seat project;
- один assignment project in progress;
- один submitted project;
- один completed project.

Screenshots:

~~~text
teacher-learner-profile-projects.png
teacher-learner-profile-assignment-work.png
teacher-learner-current-vs-submitted.png
teacher-assignment-review-exact-submission.png
teacher-review-to-learner-profile.png
~~~

## 14. Acceptance

1. Teacher exact-class opens learner profile and sees all StudentSeat-owned projects.
2. Non-assignment StudentSeat project is visible to class staff.
3. Assignment project is visible with canonical state.
4. Submitted work has link to exact review.
5. Review uses submitted version even if current project is newer.
6. Account personal project outside Classroom is not visible.
7. Account project from another Classroom is not visible.
8. Learning archive does not erase teacher submission history.
9. Teacher edit, where allowed, is audited and does not mutate old Submission.
10. No client-side join guesses assignment identity from titles/project names.
