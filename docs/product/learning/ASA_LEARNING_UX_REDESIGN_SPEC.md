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
