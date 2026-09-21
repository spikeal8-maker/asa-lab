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

## 6. V1 — «Бирка задания доступна в лаборатории»

Инженерная основа: A0.

V1 проверяет только platform overlay contract. Он не доказывает весь learner hub.

### Пользователь видит

При normal target journey editor открывается с collapsed anchor:

~~~text
[ ▣ Задание · Закон Ома   ˄ ]
~~~

По нажатию открывается compact panel над/рядом с anchor. Anchor остаётся toggle.

Electronics desktop:
- anchor collapsed;
- compact panel open;
- panel после перемещения;
- manual resize;
- expanded preset.

3D desktop:
- anchor/panel поверх editor;
- инструмент editor доступен вне panel.

Blocks/Scratch:
- fullscreen runtime реально открыт;
- anchor/panel находятся поверх subject fullscreen.

Mobile:
- 390×844;
- 320×568;
- anchor;
- bottom sheet по нажатию.

### Визуальные критерии

- лаборатория является основной поверхностью при входе;
- collapsed anchor занимает минимум пространства;
- panel открывается только по явному действию;
- anchor остаётся видимой при открытой panel;
- title читаем;
- Submit не конкурирует с title в header;
- panel не перекрывает критические инструменты по умолчанию;
- mobile controls помещаются без horizontal overflow.

### Обязательные screenshots

~~~text
V1-electronics-anchor-1440.png
V1-electronics-panel-1440.png
V1-electronics-moved-1440.png
V1-three-d-panel-1440.png
V1-blocks-overlay-1440.png
V1-mobile-anchor-390.png
V1-mobile-panel-390.png
V1-mobile-panel-320.png
~~~

### Не доказывает

V1 не означает:
- multi-group learner hub;
- exact Course Activity context;
- immutable full task content;
- штатное authoring Blocks assignment;
- project protection;
- teacher review.

## 7. V2 — «Ученик находит и открывает именно своё назначенное задание»

Инженерная основа: learner hub convergence + A1 + минимальный A2. Course Activity occurrence использует принятую D5 модель.

### Сценарий multi-group Account

Fixture минимум:
- две учебные группы;
- два CourseRun;
- direct assignment;
- состояния scheduled, available, in progress, submitted, changes requested, completed.

Путь:

~~~text
Вход
→ Главная с «Учебными делами»
→ bell показывает unread events
→ «Моё обучение» показывает actionable count
→ Сейчас агрегирует работы двух групп
→ Scheduled task виден locked
→ Available task открывает assignment detail
→ full exact task content
→ Начать/Продолжить
→ editor с collapsed assignment anchor
~~~

### Exact-version доказательство

1. преподаватель публикует activity v1;
2. выдаёт/назначает exact v1;
3. learner detail показывает v1;
4. автор создаёт/изменяет будущий draft/v2;
5. существующий learner delivery продолжает показывать v1.

### Scheduled semantics

Future opensAt:
- title/context/open time visible;
- full task content hidden;
- Start disabled;
- editor не открывается.

После opensAt task становится actionable.

### Owner evidence

~~~text
V2-home-learning-attention.png
V2-learning-now-two-groups.png
V2-scheduled-locked.png
V2-assignment-detail-v1.png
V2-author-future-draft.png
V2-learner-still-v1.png
V2-editor-anchor-after-start.png
V2-completed-history.png
~~~

Bell unread count и Learning actionable count проверяются отдельно.

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

### Профиль ученика и проверка — обязательная связка

V7 принимает не только очередь задания, но и согласованность с профилем ученика.

Synthetic learner имеет:
- самостоятельный StudentSeat project без assignment;
- assignment work in progress;
- submitted work;
- completed work.

Teacher должен:
- открыть learner profile и увидеть все StudentSeat-owned projects;
- из assignment-linked work перейти в exact review;
- увидеть различие current project vs submitted version, если оно есть;
- вернуться из review к learner profile;
- не получить personal Account project из другого scope.

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
