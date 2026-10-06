# ASA Lab — UX-пересборка Learning после ручного staging-review

**Issue:** #385
**Статус:** нормативный UX-план
**Основание:** ручная проверка test school №374 на Ali_Robs

## 1. Что признано проблемой

Функциональная модель Learning работает, но текущий UI требует понимания внутренних сущностей ASA Lab.

Нужно перестраивать видимые сценарии, а не косметически украшать существующие формы.

Порядок работ:

1. UX0 — ученическая бирка и панель задания;
2. UX1 — неизменяемое rich-content задание с изображениями/схемами;
3. UX2 — новый редактор задания преподавателя;
4. UX3 — новый визуальный Course Builder;
5. UX4 — Teacher Home / Journal / Review.

Каждый этап заканчивается staging screenshots и owner review.

## 2. UX0 — минимальная бирка ученика

Collapsed anchor по умолчанию:

```text
[ Задание  ˄ ]
```

Не показывать в anchor:
- длинный title;
- тип назначения;
- слова «индивидуально»;
- срок;
- save state;
- текст «результат ещё не опубликован».

Если canonicalState.selectedResult уже опубликован и доступен learner projection, допустим короткий результат:

```text
[ Задание · 8/10  ˄ ]
[ Задание · ✓     ˄ ]
```

Не вычислять оценку на клиенте. Использовать только canonical selectedResult.

## 3. UX0 — открытая panel

Header:

```text
Название задания                         [↗] [⋯]
Короткий статус
```

Header не содержит Submit и Reset.

Body:
- instruction/brief;
- компактный deadline, если он есть;
- teacher feedback, если canonical contract его уже предоставляет;
- без технических revision/debug labels.

Footer зависит от workflow.

### in_progress

```text
Сохранено                    [Отправить на проверку]
```

### submitted / waiting_review

```text
На проверке
```

UX0 НЕ добавляет добровольную кнопку «Доработать», если нет безопасного server command для новой canonical submission.

### changes_requested

```text
Нужна доработка                     [Продолжить]
```

После возобновления:

```text
Сохранено                    [Отправить повторно]
```

### completed + published selected result

Graded:

```text
Выполнено                              8/10
```

Completion:

```text
Выполнено                           ✓ Принято
```

Если selectedResult отсутствует, результат не выдумывать.

## 4. Что UX0 не делает

- не подключает Course Activity через A1;
- не меняет Submission/Attempt lifecycle;
- не добавляет voluntary rework до оценки;
- не добавляет изображения;
- не меняет teacher authoring;
- не меняет Course Builder;
- не меняет backend или migrations без отдельного доказанного blocker.

## 5. UX1 — изображения и схема

Изображение/схема — first-class task content.

Текущая authored LearningActivityVersion хранит главным образом title + instructions; author preview сейчас возвращает goal/sampleImage пустыми. Поэтому UX1 требует server-side immutable task snapshot/media refs, а не только CSS.

Целевой published snapshot:

```text
title
goal?
blocks[]
mediaRefs[]
contentDigest
```

Минимальные blocks:
- paragraph;
- list;
- callout;
- image;
- video;
- file;
- link.

Image в лаборатории:
- адаптируется к panel;
- увеличивается;
- может открываться как отдельный reference;
- reference можно расположить рядом с Electronics/3D;
- mobile использует sheet/lightbox.

## 6. UX2 — преподаватель создаёт «Задание», а не внутренний material root

Основная IA преподавателя:

```text
Задания
Курсы
Библиотека
```

### 6.1 UX2A — единый вход учителя в задания

Видимый teacher entry «Курсы и задания» ведёт в `#/challenges`. По умолчанию открывается `Задания` — существующий canonical Learning authoring.

Нормативная граница:
- **новые задания** создаются только через canonical Learning authoring;
- `teacher_assignments` — только legacy/history/compatibility;
- «Ранее созданные задания» не является основной вкладкой и не конкурирует с canonical authoring;
- новые продуктовые функции не добавляются в legacy `AssignmentEditorDialog`;
- новые задания не создаются через legacy `AssignmentEditorDialog`;
- существующие legacy-задания, их выдачи, работы учеников и история остаются доступными для совместимости и не удаляются этим UX-срезом.

Из класса:
- «Назначить задание» сохраняет canonical flow выбора опубликованного Learning Activity, аудитории и срока;
- «Создать задание» переводит в `#/challenges` → `Задания` и не открывает legacy editor.

Новый assignment editor строится вокруг блока «Что увидит ученик».

Основные действия:
- название;
- текст;
- изображение/схема;
- видео;
- файл;
- ссылка;
- среда выполнения;
- способ проверки;
- сроки;
- preview;
- publish;
- assign.

Rare settings скрываются progressive disclosure.

## 7. UX3 — Course Builder

Course Builder должен выглядеть как редактирование готового урока.

Левая колонка — компактное содержание курса.

Центр — page-like lesson canvas.

Одна кнопка:

```text
+ Добавить содержимое
```

открывает menu:
- текст;
- заголовок;
- изображение;
- видео;
- файл;
- формула;
- таблица;
- врезка;
- задание.

Задание выбирается через picker/card, а не через технический select published activity.

Duplicate/hide/move остаются, но уходят в contextual menu конкретного блока.

## 8. UX4 — teacher attention

Teacher Home отвечает на вопрос «что нужно сделать сейчас?».

```text
Ждут проверки      1    [Открыть]
Нужна реакция      1    [Открыть]
Активные группы    2
```

Journal обязан перечислять назначенные курсы в course filter.

Review workspace показывает exact submitted evidence и очередь учеников.

## 9. Видимая приёмка UX0

На test school №374 использовать существующие состояния:
- Борис — in progress;
- Вера — changes requested;
- Глеб — submitted/waiting review;
- Егор — completed;
- мобильный learner 390/320.

Обязательные screenshots:

```text
UX0-boris-anchor.png
UX0-boris-panel-in-progress.png
UX0-vera-changes-requested.png
UX0-gleb-waiting-review.png
UX0-egor-completed.png
UX0-mobile-390.png
UX0-mobile-320.png
```

Owner acceptance:
- anchor содержит минимум слов;
- пользователь понимает текущее состояние;
- результат виден только когда опубликован;
- нет дублирующих/технических подписей;
- лаборатория остаётся основной поверхностью.

## 10. Stop rule

UX0 не расширяется в UX1/UX2/UX3 «заодно».

Если для grade/feedback нужен новый server contract — зафиксировать blocker и остановиться, а не изобретать client-side join.


## 11. Owner UX decision 2026-10-04 — modern editor-first system

После owner review свежего Learning preview зафиксировано:

- функциональная глубина backend не считается видимым product result сама по себе;
- teacher authoring не должен выглядеть как длинная административная форма;
- Google Classroom / legacy LMS-паттерн не является визуальным целевым референсом;
- постоянная трёхколоночная компоновка «список + форма + preview» отклонена;
- крупные hero-блоки, нумерация 01/02/03/04 и карточки внутри карточек отклонены;
- постоянный preview, занимающий треть editor viewport, отклонён;
- новый Learning UX должен быть editor-first, content-first, progressive-disclosure и визуально современным;
- внутренняя сложность Learning (Attempt, Origin, Submission, immutable version, policy resolver) остаётся под капотом и не переносится в основной UI.

### 11.1 Отклонённый эксперимент

Draft PR #495 «Learning UX: visible teacher assignment editor» является **отклонённым визуальным экспериментом** и не является базой для дальнейшего UX.

Причины отклонения:
- слишком много постоянных областей одновременно;
- перегруженная композиция;
- большая декоративная шапка не помогает выполнить задачу;
- постоянные library и preview уменьшают рабочую область;
- настройки и основной контент визуально конкурируют;
- интерфейс требует изучения вместо естественного сценария;
- экран выглядит как dashboard/admin UI, а не как современный content editor.

Новые implementation slices не должны продолжать эту композицию.

## 12. Главный UX-инвариант

Learning разделяет три разные пользовательские задачи:

~~~text
Создать содержание
        ↓
Назначить людям
        ↓
Проверить результат
~~~

Они **не объединяются в один экран**.

Основное правило:

> Один экран = одна основная пользовательская задача.

Следствия:
- список не является частью постоянного editor layout;
- settings не являются постоянной колонкой;
- preview не является постоянной колонкой;
- assignment не смешивается с authoring;
- review не смешивается с authoring;
- список учеников не показывается в editor задания;
- служебные сущности backend не становятся видимыми controls.

## 13. Информационная архитектура преподавателя

Основной раздел:

~~~text
Курсы и задания
├─ Задания
├─ Курсы
└─ Библиотека
~~~

Проверка работ открывается контекстно:
- из Teacher Home;
- из конкретного задания;
- из класса;
- из курса;
- из learner profile.

Не добавлять вкладку «Проверка» только ради дублирования уже существующего контекста.

## 14. Задания — основной список

Экран отвечает только на вопрос:

> Какие задания у меня есть и что требует внимания?

Целевая структура:

~~~text
Задания                                      [+ Новое задание]

[ Поиск ]                    [Статус ▾] [Среда ▾] [Сортировка ▾]

Автоматический ночник
Электроника
Опубликовано · назначено 3 классам
7 ждут проверки
                                               [Открыть] [⋯]

Светофор
Электроника
Черновик · изменено сегодня
                                               [Открыть] [⋯]
~~~

Основная информация строки:
- title;
- subject/module;
- draft/published state;
- audience summary, если назначено;
- attention count;
- last meaningful update.

Не показывать ids, version UUID, Attempt, Origin, policy JSON, technical revision и compatibility labels.

Контекстное меню ⋯:
- Редактировать;
- Создать копию;
- История версий;
- Архивировать.

Danger action отделяется визуально. Назначение не прячется в ⋯, если это основное следующее действие.

## 15. Новый редактор задания

Editor — отдельный экран и выглядит как редактирование самого задания, а не как заполнение карточки базы данных.

~~~text
← Задания

Автоматический ночник                 Сохранено
                         [Предпросмотр] [Назначить →]


Автоматический ночник

Добавьте цель задания…


Соберите схему автоматического ночника.
Светодиод должен включаться при уменьшении освещения.


┌──────────────────────────────────────────────┐
│                изображение                   │
└──────────────────────────────────────────────┘

📄 Справочник по фоторезистору.pdf

＋ Добавить блок


───────────────────────────────────────────────
Электроника · 2 попытки · Выполнение [Настройки]
~~~

Доминирует content canvas. Inline редактируются:
- название;
- goal;
- instruction;
- content blocks.

Не открывать modal для обычного изменения текста.

Header содержит максимум:
- Back;
- saved/unsaved state;
- Preview;
- Assign.

Publish может быть отдельной action либо частью Assign confirmation. Не показывать 4–6 равнозначных CTA.

Внизу допустима компактная meta strip:
- module;
- attempts;
- result mode;
- deadline summary;
- кнопка «Настройки».

## 16. Добавление content block

Одна команда:

~~~text
+ Добавить блок
~~~

открывает небольшой contextual popover рядом с местом вставки:

~~~text
Aa  Текст
H   Заголовок
☷   Список
▣   Примечание

🖼  Изображение
▶   Видео
📄  Файл
🔗  Ссылка

⚡  Проект / лаборатория
~~~

После выбора block вставляется прямо в document flow.

На hover/focus:

~~~text
⠿                                               ⋯
~~~

⠿ — drag/reorder desktop.

Меню ⋯:
- Duplicate;
- Move up;
- Move down;
- Hide, если поддерживается contract;
- Delete.

На mobile drag не обязателен; move up/down обязателен.

## 17. Settings drawer

Rare/secondary settings не занимают постоянное место.

Нажатие «Настройки» открывает right drawer около 360–420 px:

~~~text
Настройки задания                              ×

Среда выполнения
[ Электроника                              ▾ ]

Результат
(•) Выполнение
( ) Баллы
( ) Без оценки

Попытки
[ 2 ]

Срок
[ Не задан ]

После срока
[ Разрешать до закрытия                   ▾ ]

Дополнительные настройки                   ▾
~~~

В «Дополнительные настройки»:
- result selection;
- feedback release;
- uncommon attempt policy;
- advanced restrictions.

Правило:

> Настройка, которую большинство учителей не меняет для большинства заданий, не должна быть постоянно видна на canvas.

## 18. Preview

Preview открывается **по требованию**, а не занимает постоянную колонку.

Desktop:
- right sheet / large drawer;
- editor остаётся позади;
- закрытие возвращает пользователя в то же место.

Mobile:
- full-screen sheet.

Preview показывает тот же content model, который увидит learner.

~~~text
Как увидит ученик                             ×

Автоматический ночник

Соберите схему...

[изображение]

📄 Справочник.pdf

Электроника · 2 попытки

                         [Начать работу]
~~~

Если draft не сохранён:
- local representation может называться «Несохранённый предпросмотр»;
- exact preview явно требует save;
- local preview нельзя выдавать за exact published version.

## 19. Назначение задания

«Назначить» — отдельная операция.

Открывает modal/sheet:

~~~text
Назначить задание                            ×

Кому
✓ 8А
□ 8Б
□ Робототехника — группа 1

[ Выбрать отдельных учеников ]

Когда
○ Сейчас
○ Запланировать

Срок
[ 15 октября, 18:00 ]

                              [Отмена] [Назначить]
~~~

Если draft ещё не опубликован:

~~~text
Для назначения будет создана новая опубликованная версия.
~~~

Не заставлять пользователя:
1. вручную Publish;
2. идти в Class;
3. снова искать Activity;
4. снова выбирать version;
5. затем Assign.

Canonical backend может сохранять границы, но UI должен давать один понятный flow.

## 20. Курсы — список

~~~text
Курсы                                        [+ Новый курс]

Робототехника. 8 класс
8 разделов · 26 материалов
Назначен: 8А, 8Б
                                               [Открыть] [⋯]

Основы 3D
4 раздела · 12 материалов
Черновик
                                               [Открыть] [⋯]
~~~

Не показывать CourseRun ids, Enrollment ids, version ids и raw lifecycle values.

## 21. Visual Course Builder

Course Builder использует две основные области:
1. compact outline слева;
2. lesson/page canvas по центру.

Третьей постоянной панели нет.

~~~text
← Курсы       Робототехника                  [Предпросмотр] [Опубликовать]

┌───────────────┬────────────────────────────────────────────┐
│ СОДЕРЖАНИЕ    │ УРОК 3                                     │
│               │                                             │
│ Введение      │ Фоторезистор                                │
│ > Электрич.   │                                             │
│   Светодиод   │ Что такое фоторезистор...                   │
│               │                                             │
│ Датчики       │ [ изображение ]                             │
│   Фоторезист. │                                             │
│   Кнопка      │ ⚡ Задание «Автоматический ночник»          │
│               │                                             │
│ + Раздел      │ ＋ Добавить содержимое                      │
└───────────────┴────────────────────────────────────────────┘
~~~

Settings выбранного lesson/block открываются drawer.

Команда «+ Добавить содержимое» открывает popover:
- text;
- heading;
- image;
- video;
- file;
- formula;
- table;
- callout;
- assignment.

## 22. Assignment picker внутри курса

«Добавить содержимое → Задание» открывает searchable picker:

~~~text
Добавить задание

[ Поиск ]

Автоматический ночник
Электроника · опубликовано
                                      [Добавить]

Светофор
Электроника · опубликовано
                                      [Добавить]

+ Создать новое задание
~~~

Запрещён raw technical select с version id/UUID.

«Создать новое задание» открывает canonical assignment editor и возвращает обратно в Course Builder после save/publish с сохранением контекста.

## 23. Библиотека

Библиотека отвечает:

> Что уже существует и что можно переиспользовать?

Это не второй authoring editor.

Основные представления:
- Все;
- Мои;
- Школы/организации — только если access policy существует;
- Избранное — только если функция реально существует.

Фильтры:
- search;
- type;
- module.

Карточка:
- title;
- type;
- module;
- owner/source только если relevant;
- Add / Open.

Не дублировать assignment/course settings в Library.

## 24. Teacher Home / attention

Teacher Home отвечает:

> Что мне нужно сделать сейчас?

~~~text
Сегодня

Ждут проверки                  12
[Открыть очередь]

Возвращены на доработку         4

Активные задания                7
~~~

Attention counts приходят из canonical server state и не вычисляются client-side по косвенным спискам.

## 25. Review workspace

Три зоны здесь оправданы, потому что пользователь одновременно:
- перемещается по очереди;
- видит exact submitted evidence;
- принимает решение.

~~~text
Закон Ома                  8А                     7 из 24

┌──────────────┬─────────────────────────────┬────────────────────┐
│ УЧЕНИКИ      │ СДАННАЯ РАБОТА             │ ПРОВЕРКА           │
│              │                             │                    │
│ ✓ Анна       │                             │ Результат          │
│ > Борис      │      project / preview      │ [ Выполнено ]      │
│ • Вера       │                             │                    │
│ • Глеб       │                             │ Комментарий        │
│              │                             │ [              ]   │
│              │                             │                    │
│              │                             │ [Вернуть] [Принять]│
└──────────────┴─────────────────────────────┴────────────────────┘
~~~

Инварианты:
- центр доминирует;
- learner queue узкая;
- справа только review actions;
- exact Submission/ProjectVersion — primary evidence;
- current project не подменяет submitted version;
- next learner доступен без возврата в list.

## 26. Return for changes

«Вернуть на доработку» открывает небольшой modal:

~~~text
Вернуть Борису на доработку

Что нужно исправить?
[                                      ]

□ Разрешить ещё одну попытку
  только если server policy это поддерживает

                              [Отмена] [Вернуть]
~~~

После success:
- canonical state меняется server-side;
- review может перейти к следующему learner;
- student attention обновляется штатным механизмом.

Не добавлять client-side synthetic attempt.

## 27. Learner-visible states

«Моё обучение» отвечает на вопрос:

> Что мне делать дальше?

~~~text
Автоматический ночник
В работе
                                      [Продолжить]
~~~

~~~text
Автоматический ночник
На проверке
~~~

~~~text
Автоматический ночник
Нужна доработка
Комментарий преподавателя…
                                      [Продолжить]
~~~

~~~text
Автоматический ночник
Выполнено · 8/10
                                      [Посмотреть]
~~~

Lab остаётся основной поверхностью.

Collapsed anchor:

~~~text
[ Задание ˄ ]
~~~

Допустимые короткие состояния:

~~~text
[ Задание · нужна доработка ˄ ]
[ Задание · 8/10 ˄ ]
~~~

Не превращать anchor в status dashboard.

## 28. Window / overlay taxonomy

| Действие | UI primitive |
|---|---|
| добавить block | contextual popover |
| block actions | ⋯ contextual menu |
| assignment settings | right drawer |
| exact/live preview | right sheet; mobile full-screen sheet |
| assign audience/date | modal/sheet |
| choose assignment for course | searchable modal |
| choose class/learners | внутри assign flow |
| image zoom | lightbox |
| delete | confirmation modal |
| return for changes | small modal |
| accept submission | inline action |
| version history | drawer |
| advanced settings | accordion inside settings drawer |
| text editing | inline |
| course lesson settings | drawer |
| mobile course outline | sheet |

Запрещено:
- modal поверх modal;
- drawer поверх drawer;
- popup для каждого текстового поля;
- full page для маленькой secondary operation;
- постоянная колонка для редко используемого действия.

## 29. Mobile contract

Mobile — отдельная композиция, а не desktop, сжатый до 320 px.

Assignment editor:

~~~text
←          Задание          ⋯

Автоматический ночник

[content]

[image]

[PDF]

+ Добавить

────────────────────────
[Настройки] [Назначить]
~~~

- assignment list — отдельный экран;
- preview — full-screen sheet;
- settings — sheet;
- no permanent side columns.

Course Builder:
- canvas занимает экран;
- outline открывается sheet;
- block menu — bottom sheet/popover;
- reorder доступен без drag.

Review:

~~~text
Борис           7/24       [Ученики]

[submitted work]

[Комментарий]

[Вернуть] [Принять]
~~~

Learner queue открывается отдельной sheet.

## 30. Anti-absurd UX invariants

Эти правила нормативны для Learning UX:

1. Один экран — одна основная задача.
2. На экране одна primary CTA; вторая допустима только как очевидная парная операция.
3. List, editor, settings и preview не показываются одновременно как равноправные постоянные панели.
4. Rare settings скрыты progressive disclosure.
5. Backend concepts не показываются пользователю без продуктового смысла.
6. Не делать card-inside-card-inside-card.
7. Не использовать modal для обычного редактирования.
8. Не использовать отдельную страницу для маленького contextual action.
9. Не заставлять повторно выбирать один объект в одном flow.
10. Content creation, assignment и review остаются разными задачами.
11. Desktop content canvas получает большую часть useful viewport.
12. Mobile проектируется отдельно.
13. Любой state label отвечает «что делать дальше?».
14. Если control нельзя понять без инструкции, control требует redesign.
15. Empty state объясняет следующий шаг и содержит не более одной primary CTA.
16. Success не закрывается modal, если достаточно inline confirmation.
17. Destructive action никогда не является primary.
18. Hover-only action имеет keyboard/touch alternative.
19. Никаких декоративных hero-блоков, если они отнимают рабочую площадь без выполнения задачи.
20. Visible owner-preview — обязательный gate перед следующим крупным UX-срезом.

## 31. Корректировки и error states

Каждый основной flow обязан иметь:
- loading;
- empty;
- success;
- validation error;
- permission denied;
- stale/revision conflict;
- missing media;
- network retry;
- archived/historical read-only, если применимо.

Ошибки:
- показываются рядом с объектом действия, когда возможно;
- не используют raw backend code как основной текст;
- не уничтожают введённый draft;
- дают понятное действие: исправить, повторить, обновить, вернуться.

Revision conflict:
- не молча перезаписывает изменения;
- предлагает reload/latest или explicit recovery.

## 32. Видимый delivery contract

После owner-review 2026-10-04 новая работа Learning UX считается завершённой только если:

1. product code изменяет user-visible surface;
2. exact build доступен на отдельном owner preview;
3. owner может пройти основной flow без объяснений разработчика;
4. desktop screenshot существует;
5. mobile 390 и 320 существуют для responsive surface;
6. нет technical labels/debug text;
7. следующий UX slice не начинается до owner-visible результата предыдущего.

Backend/CI work может быть необходимым, но не заменяет visible delivery.

## 33. Порядок следующих UX implementation slices

Приоритет меняется на visible-first.

### V-UX2A — Assignment list
- отдельный список;
- search/filter;
- statuses/attention;
- «+ Новое задание»;
- contextual menu;
- owner preview.

### V-UX2B — Assignment document editor
- content-first canvas;
- inline title/goal/instruction;
- block insertion popover;
- reorder/context menu;
- compact meta strip;
- owner preview.

### V-UX2C — Settings / Preview / Assign overlays
- settings drawer;
- preview sheet;
- assign flow;
- no permanent third column;
- owner preview.

### V-UX3A — Course list + outline/canvas builder
- course list;
- 2-pane builder;
- add content popover;
- assignment picker;
- owner preview.

### V-UX4A — Teacher attention + review workspace
- attention counters;
- queue;
- exact submitted evidence;
- return/accept;
- owner preview.

A6/A7/A8 backend work, если оно не является blocker конкретного visible slice, **не имеет приоритета над visible-first порядком**.

## 34. Owner acceptance question

Для каждого visible slice контролёр обязан отвечать только на практический вопрос:

> Может ли преподаватель/ученик выполнить эту задачу на свежем preview без знания внутренней архитектуры ASA Lab?

## 35. Owner correction 2026-10-06 — цельный видимый маршрут

Порядок §§33–34 применяется к цельному сценарию заданий, затем курсов и библиотеки, без остановки программы после одного списка. Для авторского задания: один вход «+ Добавить содержимое» показывает лишь реально работающие типы; файл сейчас означает PDF до 400 КБ, видео допускается как внешняя ссылка, загрузка видео не обещается. Обычный материал сохраняется без среды; среда выбирается для конкретной проектной практики, а не глобально для курса. Параметры открываются в компактном отдельном окне вместо обязательного right drawer из §17/§28. Срок и получатели остаются в назначении, публикация и история версий — вне параметров. Статус «Сохранено» допустим только после ответа сервера; автосохранение не обещается. Прямое назначение использует опубликованную project-версию и существующий exact-version контракт. Назначение обычного manual-материала требует отдельного подтверждённого серверного пути и не маскируется рабочей кнопкой.

Если ответ «нет» или для понимания результата нужен длинный технический отчёт — visible slice не принят.
