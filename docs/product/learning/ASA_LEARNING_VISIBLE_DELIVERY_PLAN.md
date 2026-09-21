# ASA Lab — видимая поставка и приёмка учебной работы

**Идентификатор:** LRN-WORK-DELIVERY-01  
**Статус:** обязательный порядок поставки E1  
**Дата:** 21 сентября 2026 года  
**Связанные требования:** E1-FIX-11D, E1-FIX-13, E1-FIX-14

## 1. Зачем нужен этот документ

Инженерная декомпозиция A0–A8 остаётся обязательной, но не является форматом приёмки владельцем.

Нельзя считать продукт продвинувшимся только потому, что:
- добавлена таблица;
- появился новый API;
- зелёный unit test;
- CI прошёл;
- создана абстрактная архитектурная возможность.

Каждая продуктовая контрольная точка должна заканчиваться наблюдаемым пользовательским сценарием, который можно открыть в браузере и оценить глазами.

## 2. Два параллельных уровня плана

### Инженерный уровень

~~~text
A0 shell foundation
A1 Learning Work Context
A2 immutable task snapshot
A3 module learning capabilities
A4 atomic StartLearningWork
A5 learner project protection
A6 rich task shell
A7 personal copy
A8 teacher review workspace
~~~

Он отвечает на вопрос: **как безопасно построить систему**.

### Продуктовый уровень

~~~text
V1 — ученик видит задание поверх лаборатории
V2 — ученик видит именно назначенную неизменяемую версию
V3 — начало задания создаёт одну учебную работу без сирот
V4 — учебная работа защищена и понятно живёт в списке ученика
V5 — новая лаборатория подключается через capabilities
V6 — задание содержит изображения/схему/видео/файлы
V7 — учитель поточно проверяет класс
~~~

Он отвечает на вопрос: **что уже можно увидеть и принять**.

Новый продуктовый checkpoint не начинается, пока предыдущий не имеет технического, браузерного и визуального evidence.

## 3. Четыре обязательных доказательства каждого checkpoint

### 3.1 Contract evidence

Доказать:
- данные;
- права;
- идемпотентность;
- exact-version semantics;
- negative cases;
- retry/concurrency, где применимо.

### 3.2 Real browser journey

Fixture может готовить синтетические данные через DB/API, если это не предмет проверки, но принимаемое действие выполняется через настоящий продуктовый путь.

Тест не имеет права выдавать подготовку fixture за реализованный пользовательский сценарий.

Пример:
- для A0 допустимо подготовить Blocks activity fixture напрямую, потому что проверяется только overlay поверх реального Scratch;
- это **не доказывает**, что преподаватель уже умеет создать Blocks activity через authoring UI.

### 3.3 Owner-visible evidence

Для любого изменения интерфейса обязательны реальные screenshots текущего HEAD.

Минимум:
- исходное состояние;
- ключевое действие/состояние;
- narrow/mobile состояние, если затрагивается responsive UI.

Снимки:
- показывают весь viewport/рабочий контекст, а не только crop карточки, если проверяется взаимное расположение с лабораторией;
- сохраняются в CI artifact;
- имеют стабильные имена;
- относятся к exact HEAD;
- не содержат реальных данных детей/секретов;
- рассматриваются человеком, а не только создаются.

Отсутствие owner-visible screenshots означает:
~~~text
VISUAL_ACCEPTANCE = NOT_RUN
~~~

даже если функциональный браузерный тест зелёный.

### 3.4 Independent review

Перед merge:
- проверить diff;
- проверить причины всех failures;
- прочитать screenshots;
- отделить product failure от stale test/external baseline;
- подтвердить соответствие конкретному checkpoint;
- не начинать следующий checkpoint до решения.

## 4. Правило тестирования границ модулей

Интеграционный тест общей Learning-оболочки проверяет **публичный контракт предметного модуля**, а не его внутреннюю DOM-структуру.

Запрещено делать A0 зависимым от:
- внутренних test-id/селекторов iframe-host, не объявленных публичным контрактом;
- приватной структуры Blockly/Three.js/Electronics implementation;
- временных внутренних стадий загрузчика соседнего модуля.

Допустимо:
- проверить, что предметный editor/runtime реально открыт;
- проверить видимый/стабильный platform-owned container;
- проверить topmost через elementFromPoint;
- проверить, что действие предметной среды вне overlay остаётся интерактивным;
- использовать уже существующий module-specific acceptance отдельно.

Если общей оболочке требуется новый стабильный readiness contract, он добавляется как явная platform/module capability, а не добывается из случайного внутреннего DOM.

## 5. Правило хранения пользовательского состояния

Acceptance не должна предполагать default geometry, если ТЗ разрешает восстановление сохранённой geometry.

Тест обязан разделять:
- restore saved geometry;
- viewport clamp;
- explicit «Сбросить» → canonical default.

Конкретные default coordinates проверяются после явного reset или в чистом storage context.

## 6. V1 — «Задание видно в лаборатории»

Инженерная основа: A0.

### Пользователь видит

Electronics desktop:
- compact карточка по умолчанию;
- expanded preset по явному действию;
- collapsed control;
- карточка после перемещения;
- ручной resize в safety limits.

3D desktop:
- карточка поверх редактора;
- инструмент редактора доступен вне карточки.

Blocks/Scratch desktop:
- fullscreen runtime реально открыт;
- карточка визуально находится поверх него.

Mobile:
- 390×844;
- 320×568;
- collapsed control;
- открытая bottom panel.

### Визуальные критерии

- default card компактна и не доминирует над лабораторией;
- полный смысл названия задания доступен в compact/expanded состоянии; essential title не существует только как обрезанный ellipsis;
- permanent «Сбросить» и primary «Сдать работу» не конкурируют с title в header;
- submit находится в footer/контекстной зоне действия;
- compact → expanded → collapsed являются различимыми состояниями;
- карточка не закрывает критические инструменты лаборатории по умолчанию;
- вне карточки предметная среда остаётся визуально и функционально доступной;
- mobile controls помещаются без горизонтального overflow.

### Обязательные screenshots

~~~text
V1-electronics-compact-1440.png
V1-electronics-expanded-1440.png
V1-electronics-moved-1440.png
V1-three-d-expanded-1440.png
V1-blocks-overlay-1440.png
V1-mobile-390.png
V1-mobile-320.png
~~~

### Owner decision 21.09.2026 — first A0 screenshot

Первый фактический Electronics screenshot текущей реализации функционально подтвердил overlay, но **VISUAL_ACCEPTANCE = FAIL**.

Причины:
- default 460×460 воспринимается слишком крупным для рабочего задания;
- header перегружен title + status + Reset + Submit;
- title визуально обрезан;
- технический revision-text занимает слишком высокий приоритет.

Требуемый V1 visual repair:
- compact default около 360–400 px шириной и content-fit высотой;
- explicit expand control;
- collapse control;
- reset secondary/overflow;
- submit в footer;
- короткий save state вместо protocol/revision wording;
- новый owner-visible screenshot review.

### Не доказывает

V1 не означает:
- полный Course Activity context;
- immutable full task content;
- штатное authoring Blocks assignment;
- project protection;
- teacher review.

## 7. V2 — «В карточке именно то, что назначил учитель»

Инженерная основа: A1 + минимальный A2.

Сценарий:
1. преподаватель создаёт/публикует activity;
2. назначает exact version;
3. ученик открывает работу;
4. карточка показывает title/goal/instructions именно этой версии;
5. преподаватель меняет будущий draft;
6. уже назначенный learner продолжает видеть прежний snapshot.

Owner evidence:
- author published version;
- learner card before author edit;
- author future draft changed;
- learner card still old exact version.

## 8. V3 — «Начать создаёт одну учебную работу»

Инженерная основа: A3 prerequisites + A4.

Сценарий:
- Start;
- reload/retry/double action;
- в итоге один project;
- один canonical origin;
- одна текущая Attempt;
- проект появляется как учебный.

Должен быть видимый screenshot списка работ с badge «Учебная работа».

## 9. V4 — «Учебную работу нельзя случайно уничтожить»

Инженерная основа: A5.

Показать глазами:
- active: нет destructive actions;
- submitted waiting review;
- changes requested → Continue;
- accepted → read-only + «Убрать из активных»;
- learning archive;
- returned work снова в active.

API negative tests отдельно доказывают, что скрытые кнопки нельзя обойти прямым запросом.

## 10. V5 — «Новая лаборатория подключается системно»

Инженерная основа: A3 + A4.

Выбранный module должен пройти **штатный** путь:
~~~text
authoring
→ publish
→ assign
→ learner Start
→ editor
→ save
→ submit
~~~

Если fixture создаёт activity напрямую в DB, это может быть module-overlay test, но не V5.

Acceptance дополнительно проверяет отсутствие нового module-specific branch в Learning.

## 11. V6 — «Полноценное задание с материалами»

Инженерная основа: полный A2 + A6.

Показать:
- изображение;
- zoom;
- pinned reference;
- video;
- file/link;
- mobile presentation;
- broken/unavailable asset state.

Доказать immutable asset/version semantics.

## 12. V7 — «Учитель проверяет класс потоком»

Инженерная основа: A8.

Синтетический класс минимум 5 учеников:
- несколько waiting review;
- in progress;
- returned;
- accepted.

Owner screenshots:
- queue;
- selected learner exact submission;
- assessment panel;
- after Accept → next waiting learner;
- narrow/tablet adaptation.

## 13. Формат отчёта перед merge

Каждый checkpoint возвращает:

~~~text
CHECKPOINT:
EXACT_HEAD:

CONTRACT:
PASS/FAIL

BROWSER:
PASS/FAIL

OWNER_EVIDENCE:
PASS/FAIL
artifact:
screenshots:
- ...

INDEPENDENT_REVIEW:
PASS/FAIL

KNOWN_EXTERNAL_FAILURES:
...

PRODUCT_FAILURES:
...

READY_TO_MERGE:
YES/NO
~~~

Без OWNER_EVIDENCE=PASS интерфейсный checkpoint не получает READY_TO_MERGE=YES.

## 14. Порядок текущей работы

На 21.09.2026:

1. закончить V1/A0 в PR #369;
2. отдельно довести и принять Course Activity D5 в PR #361;
3. только затем начинать V2/A1+A2 от принятой occurrence модели;
4. не добавлять A1–A8 в PR #369.

## 15. Правило STOP

Если текущий checkpoint выявил:
- реальный product bug;
- stale test;
- unsupported neighboring-module assumption;
- visual defect;

исправляется только этот checkpoint.

Следующая продуктовая возможность не начинается «заодно».
