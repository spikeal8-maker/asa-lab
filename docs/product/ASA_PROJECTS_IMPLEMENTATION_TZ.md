# ASA Lab — публичный раздел «Проекты»
## Исполняемое ТЗ и контракт для coding-агентов

**Статус:** TARGET + execution contract; сам по себе не разрешает coding  
**Репозиторий:** `spikeal8-maker/asa-lab`  
**Ветка документации:** `docs/projects-ui-ux-spec-v3`  
**Продуктовый источник:** `docs/product/ASA_PROJECTS_UI_UX_SPEC.md`  
**Архитектурный источник:** `docs/product/ASA_PROJECTS_IMPLEMENTATION_SPEC.md`  
**Исполнительная политика:** `AGENTS.md` + `START_HERE_FOR_AI.md` + `docs/execution/current.yaml`  

---

# 0. Назначение этого документа

Этот документ нужен не для повторения 2475 строк UI/UX-спецификации и не для создания второго состояния разработки.

Он определяет:

1. что именно должна получить целевая система «Проекты»;
2. какие существующие механизмы ASA Lab обязательно переиспользуются;
3. какие экраны, кнопки, действия и состояния обязательны;
4. какие визуальные ограничения нельзя нарушать;
5. как раскладывать работу на безопасные ограниченные срезы;
6. какие глобальные R3/R7/R8 зависимости нельзя обходить;
7. что должен прочитать coding-агент перед каждым срезом;
8. какие доказательства нужны для приёмки.

**Этот документ не является execution state.** Конкретная работа начинается только когда соответствующий task/slice выбран владельцем и отражён в `docs/execution/current.yaml` согласно правилам ASA Lab.

---

# 1. Иерархия источников истины

Coding-агент обязан читать источники в следующем порядке:

```text
AGENTS.md
→ START_HERE_FOR_AI.md
→ docs/execution/current.yaml / pnpm agent:context --scope <lane>
→ выбранная GitHub Issue / task card
→ этот ASA_PROJECTS_IMPLEMENTATION_TZ.md
→ ASA_PROJECTS_IMPLEMENTATION_SPEC.md — только нужные разделы
→ ASA_PROJECTS_UI_UX_SPEC.md — только нужные разделы экрана/состояния
→ фактический код и тесты выбранного среза
```

Приоритет смыслов:

- `current.yaml` отвечает **что сейчас разрешено делать**;
- `AGENTS.md` отвечает **как работать и когда остановиться**;
- Issue/task отвечает **какой срез выбран**;
- этот файл отвечает **какой результат обязан получить выбранный срез**;
- Implementation Spec отвечает **как встроить результат в архитектуру**;
- UI/UX Spec отвечает **как результат должен выглядеть и вести себя для пользователя**;
- фактический код отвечает **что уже существует и что можно переиспользовать**.

Нельзя использовать этот файл, roadmap, старый PR или readiness как самостоятельное разрешение начать следующий этап.

---

# 2. Целевой продукт

«Проекты» — общественная витрина **реальных результатов, созданных в ASA Lab**.

Это не блог, не новостная лента и не отдельная социальная сеть.

Пользовательский цикл:

```text
увидел
→ понял что это
→ открыл
→ исследовал / запустил
→ сохранил или сделал свою версию
→ при желании изучил связанный материал
→ создал собственный результат
→ опубликовал его
```

Поддерживаемые типы результатов:

- 3D/CAD;
- электроника и Arduino;
- блочное программирование;
- игры;
- графика;
- ИИ-результаты;
- комбинированные проекты;
- физический результат: 3D-печать, собранная схема, устройство, робот, макет.

Ключевая формула:

> **Проекты = публичная витрина живых работ + безопасный просмотр + авторство + реакции + сохранение + собственная версия + связь с обучением.**

---

# 3. Не создавать второй Project domain

Существующий Project Core остаётся source of truth для рабочего проекта.

Запрещено:

- `projects_v2`;
- копировать рабочий project payload в параллельную public-project таблицу;
- создавать второй draft/version stack рабочего проекта;
- создавать отдельный bookmarks domain при существующих Collections;
- создавать второй copy/remix flow при существующей server copy/provenance логике;
- переносить публичную логику в classroom `ProjectsPage.tsx` только из-за имени файла.

При этом **публичная публикация — отдельное семантическое состояние и отдельная проекция**, а не второй Project.

Целевая R7-модель допускает и требует:

```text
Project
→ immutable ProjectVersion
→ PublishedProject
→ immutable PublicationRevision
```

`PublicationRevision` хранит/ссылается на публичное представление и **ссылается на существующую неизменяемую ProjectVersion**, а не дублирует рабочий проект как второй редакторский документ.

---

# 4. AS-IS, который нельзя игнорировать

У ASA Lab уже есть три разные поверхности проектов.

## 4.1. «Мои проекты»

Личный Project Hub пользователя.

Текущий смысл `/projects` сохраняется: это рабочее пространство владельца, а не публичный discovery-каталог.

## 4.2. Classroom Projects

`ProjectsPage.tsx` относится к конкретному классу и classroom context.

Это не база общественной витрины.

## 4.3. Gallery / «Проекты сообщества»

Текущая публичная/общественная поверхность уже реализована через Gallery.

Она уже умеет:

- список работ;
- «Новые / Популярные»;
- фильтр по модулю;
- preview;
- автора;
- реакции `like` / `wow`;
- `editors_choice`;
- публикацию / снятие публикации;
- детальную страницу;
- описание;
- теги;
- лицензию;
- provenance;
- copy в собственный проект;
- Collections.

**Требование:** целевые «Проекты» эволюционируют из существующей Gallery, а не строятся параллельно.

---

# 5. Маршруты: не занимать личный `/projects`

Нельзя делать публичный каталог каноническим `/projects`, потому что этот маршрут уже имеет продуктовый смысл «Мои проекты».

Целевая модель согласно продуктовым surface-контрактам:

- `/projects` — **Мои проекты**;
- `/projects/:publicSlug` — публичная страница конкретной immutable публикации R7;
- `/explore` — discovery-каталог публичных проектов R8;
- верхняя кнопка в интерфейсе может и должна называться **«Проекты»**, даже если канонический URL discovery — `/explore`;
- `/gallery` и `/gallery/:projectId` остаются legacy-совместимостью до отдельной миграции/redirect.

До активации нового route текущий внутренний `kind: 'gallery'` и `/api/gallery` могут сохраняться.

**Запрещено одним срезом ломать старые ссылки.**

---

# 6. Глобальная навигация

Целевая desktop-шапка ASA Lab:

```text
[ASA Lab]      [Проекты] [Знания]                    [+ Создать] [профиль]
```

Требования:

- «Проекты» — общественный discovery-раздел;
- «Знания» — отдельный общественный образовательный раздел;
- «Создать» использует существующий Quick Create;
- профиль использует текущий account menu;
- не создавать вторую шапку специально для Projects.

Desktop левая панель — личное пространство:

- Главная;
- Классы — если разрешены;
- Мои проекты;
- Игры;
- Сохранённое;
- Моё обучение;
- Курсы и задания — по capability;
- Справка;
- профиль/админ — по текущей модели.

Публичные «Проекты / Знания» **не должны визуально дублироваться как два равнозначных пункта и сверху, и слева на desktop**.

На mobile, если глобальные tabs скрыты из шапки, «Проекты» и «Знания» обязаны оставаться доступны через mobile navigation.

---

# 7. Экран P-01 — каталог «Проекты»

Порядок сверху вниз:

1. H1 **«Проекты»**;
2. короткий подзаголовок;
3. поиск;
4. горизонтальные категории;
5. сортировка / расширенные фильтры;
6. компактный featured-блок — только если есть реальный featured source;
7. сетка проектов;
8. серверная pagination/cursor/infinite continuation;
9. loading/empty/error states.

Подзаголовок:

> Смотрите, что создают пользователи ASA Lab. Открывайте проекты, изучайте их и делайте свои версии.

Не использовать маркетинговые фразы без действия вроде «Откройте удивительный мир возможностей».

---

# 8. Поиск

Поле:

**«Найти проект, автора или тему»**

Целевая семантика поиска:

- title;
- разрешённое public description;
- tags;
- author/profile label;
- module/topic;
- поддерживаемые technology keywords.

Требования:

- debounce;
- search state в URL;
- Back/Forward восстанавливает выдачу;
- серверная фильтрация;
- private/unlisted/ineligible content не попадает в public results;
- никакой имитации поиска только по уже загруженным 24 карточкам, если UI обещает глобальный поиск.

---

# 9. Категории и фильтры

Первичная строка:

**Все · 3D-моделирование · Электроника · Блочное программирование · Графика · Игры · ИИ**

Категория должна опираться на реальные module metadata/tags, а не на хардкод случайных карточек.

Расширенные фильтры доступны отдельной кнопкой **«Фильтры»**.

Возможные фильтры вводятся только при реальном backend-поле:

- можно запустить;
- можно сделать свою версию;
- есть файлы;
- для 3D-печати;
- с инструкцией;
- verified/curated.

На mobile расширенные фильтры открываются bottom-sheet.

Bottom-sheet:

- 80–95% высоты;
- сверху заголовок «Фильтры» и close;
- внизу sticky actions: **«Сбросить»** и **«Показать N проектов»**.

---

# 10. Сортировка

Показывать только режимы, для которых существует настоящая метрика.

Базово:

- Новые;
- Популярные — если реальная формула уже определена.

Позже:

- Часто сохраняют;
- Часто делают свои версии;
- Обсуждаемые.

Запрещены fake popularity, fake views и случайные значения.

---

# 11. Сетка каталога

Responsive определяется по **CSS viewport**, а не по физическому разрешению монитора.

Канонические диапазоны:

- 320–359 px: 1 карточка;
- 360–899 px: 2 карточки;
- 900–1199 px: 3 карточки;
- ≥1200 px: **4 карточки**;
- 1800+ и ultrawide: всё ещё 4, карточки немного крупнее;
- 4K/8K: центрированный max-width, не 8–10 колонок.

На основном desktop 5 карточек в ряд запрещены.

Ориентиры gap:

- mobile: 10–12 px;
- tablet: 16–20 px;
- desktop: 20–24 px.

---

# 12. Карточка проекта — главный визуальный контракт

Карточка должна читаться за 1–2 секунды.

Иерархия всегда:

```text
ПРОЕКТ
→ название
→ автор
→ компактные сигналы
→ служебная информация
```

Визуал проекта занимает **65–72% высоты** карточки.

Text/meta — **28–35%**.

Текстовая часть не может быть выше визуала у обычной grid-card.

## Обязательные элементы

На карточке:

1. real preview проекта;
2. максимум 1–2 полезных badge;
3. название — максимум 2 строки;
4. автор — максимум 1 строка;
5. одна строка метрик;
6. одна overlay-кнопка «Сохранить» допустима.

## Запрещено на обычной карточке

- длинное описание;
- дата отдельной крупной строкой;
- 6–10 тегов;
- 3–4 CTA;
- рейтинг `4.8/5`;
- огромные social counters;
- декоративный AI-art вместо реального проекта.

**Описание обычной карточки = 0 строк.**

---

# 13. Визуал карточки по типу проекта

## 3D

Default — качественный render/thumbnail самой модели.

Desktop hover при достаточной производительности может включить короткое мягкое вращение.

Не запускать WebGL для всех карточек одновременно.

## Электроника

Default — реальная схема/рабочая область/снимок симуляции.

Badge **«Симуляция»** только если её действительно можно запустить.

## Блоки

Preview — реальный результат или рабочая область ASA Lab, не случайная картинка Scratch.

## Игры

Preview — реальный кадр игры.

## Графика

Основной результат; before/after только если полезно.

## ИИ

Показывать результат, а не декоративную надпись «AI».

---

# 14. Метрики карточки

Допустимые реальные сигналы:

- нравится;
- сохранения;
- просмотры;
- комментарии — только после moderation foundation;
- копии/ремиксы;
- запуски — если измеряются корректно.

На desktop — максимум одна компактная строка.

На mobile — 1–2 основных показателя.

Не показывать метрику, если её backend не существует.

---

# 15. Featured / «проект недели»

Featured не обязателен.

Он показывается только при реальном curated source.

Desktop:

- высота ориентировочно 190–240 px;
- не занимает весь первый экран;
- крупный preview;
- title;
- одна строка смысла;
- author;
- 2–3 реальных показателя;
- primary **«Открыть проект»**;
- secondary **«Сделать свою версию»**.

Один и тот же проект не дублируется сразу в первой строке grid.

### Важное различие

Текущий `editors_choice` в Gallery выдаётся educator capability и **не должен автоматически называться «Выбор ASA Lab»**.

До появления platform-curation authority допустимо:

- сохранить техническое поле;
- деакцентировать;
- показывать честную подпись вроде «Рекомендуют преподаватели».

Статус **«Выбор ASA Lab»** требует отдельного подтверждённого platform-level права/процесса.

---

# 16. Нажатие на карточку

Первый click/tap по карточке открывает отдельную страницу публикации.

Не использовать схему:

```text
1 tap → появляются скрытые кнопки
2 tap → открыть
```

На mobile hover не существует.

Кнопка bookmark имеет отдельный touch-target и не должна случайно открывать карточку.

---

# 17. Экран P-04 — публичная страница проекта

Целевой URL: `/projects/:publicSlug`.

Страница показывает **immutable PublicationRevision**, связанный с точной ProjectVersion.

Не читать публичную страницу из mutable working draft.

## Desktop layout

- слева 65–70%: viewer/медиа;
- справа 30–35%: title, author, actions, compact metadata.

## Mobile

- viewer на всю ширину;
- title + author;
- primary/secondary actions;
- social/save/share actions;
- description;
- media;
- related/knowledge;
- comments только после разрешённого milestone.

---

# 18. Кнопки публичного проекта

## Primary CTA

Текст зависит от типа:

- **«Открыть 3D»**;
- **«Запустить симуляцию»**;
- **«Играть»**;
- **«Открыть программу»**;
- если интерактивного public viewer пока нет — **«Посмотреть проект»**.

Primary CTA один.

## Secondary CTA

**«Сделать свою версию»**.

Использует существующий server copy/remix/provenance flow.

## Compact actions

- Нравится;
- Сохранить;
- Поделиться;
- ⋯ Дополнительно.

В меню «⋯»:

- Скачать — только если разрешено;
- Пожаловаться — после moderation foundation;
- служебные owner actions — только владельцу.

Не рисовать 5 одинаково ярких синих кнопок.

---

# 19. Размеры controls

Desktop primary/secondary button:

- высота 42–48 px;
- horizontal padding 16–22 px;
- radius 8–12 px.

Mobile primary/secondary:

- высота 48–52 px;
- touch-target минимум 44×44 px;
- расстояние между соседними touch-target желательно ≥8 px.

Icon-only control:

- видимая иконка 18–22 px;
- кликабельная область минимум 44×44 px.

---

# 20. Public Viewer: общий контракт

Публичный viewer **не должен получать raw mutable project document только ради удобства UI**.

Текущий Gallery `/work` возвращает `document_json`; это AS-IS и **не является целевым anonymous-public контрактом**.

Перед открытием anonymous интерактивного viewer нужен module-specific sanitized public artifact.

Artifact содержит:

- schemaVersion;
- moduleKey;
- artifactVersion;
- read-only payload;
- capability flags;
- ссылку/идентификатор PublicationRevision/ProjectVersion.

Capability flags, например:

```text
canRotate
canZoom
canRun
canFullscreen
codeVisible
filesAvailable
```

Viewer не получает mutating editor actions.

---

# 21. 3D viewer

Целевые действия:

- rotate;
- zoom;
- reset view;
- fullscreen;
- стандартные ракурсы;
- explode — только если поддерживается моделью;
- информация о формате/файле в read-only.

Mobile:

- 1 палец — вращение;
- pinch — zoom;
- крупные touch controls;
- никакой обязательной hover-механики.

Если viewer не может безопасно загрузиться — показывается static preview, а не сломанная белая область.

---

# 22. Electronics viewer

Целевые возможности:

- read-only схема;
- start/stop симуляции;
- reset;
- показ допустимых измерений;
- просмотр кода/логики, если public artifact это разрешает.

Запрещено:

- давать write в оригинал;
- обходить fail-closed simulation contract;
- выдумывать значения unsupported component;
- отправлять private editor payload без sanitizer.

---

# 23. Blocks / Games / Graphics

Blocks:

- read-only блоки;
- запустить результат;
- fullscreen при поддержке.

Games:

- play;
- controls help;
- fullscreen;
- sandbox/runtime limits.

Graphics:

- качественное изображение;
- gallery/before-after при наличии.

Если конкретный модуль ещё не готов — static preview остаётся честным fallback.

---

# 24. Media tabs

Показываются только вкладки, для которых реально есть content:

```text
Проект
3D
Фото
Видео
Схема
Код
Файлы
```

Пример 3D:

```text
3D-модель | Фото печати | Видео | Файлы
```

Пример электроники:

```text
Симуляция | Схема | Код | Фото сборки
```

На mobile tabs горизонтально прокручиваются.

---

# 25. Физический результат

Автор может добавить:

- фото 3D-печати;
- фото собранной схемы;
- фото устройства;
- короткое демонстрационное видео.

Это отдельная ценность ASA Lab: цифровой проект становится реальным объектом.

Mobile editor публикации обязан позволять добавить фотографию прямо с телефона.

---

# 26. «Сохранить» и Collections

Кнопка **«Сохранить»** использует существующий Collections domain.

Desktop — compact dialog/popover.

Mobile — bottom-sheet.

Пользователь может:

- добавить в существующую подборку;
- убрать из подборки;
- создать новую подборку.

Не создавать отдельный bookmarks backend, если Collections уже решает задачу.

---

# 27. «Сделать свою версию»

Кнопка означает:

```text
immutable published source
→ server copy/remix
→ новый независимый private personal project
→ provenance/attribution сохраняется
→ оригинал не меняется
```

После успеха:

> «Копия добавлена в ваши проекты»

Действия:

- **«Открыть копию»**;
- **«Остаться здесь»**.

Не открывать чужой проект сразу в editable режиме без создания собственной версии.

---

# 28. Автор / профиль / студия

На detail page показывается:

- avatar;
- разрешённое public display name;
- тип/статус профиля только если он допустим privacy policy;
- другие опубликованные работы — после R8 profile/portfolio.

Не раскрывать:

- класс;
- школьное членство;
- tenant/workspace identifiers;
- личные данные несовершеннолетних.

Studio ownership и полноценное соавторство — отдельный поздний этап. Нельзя строить их скрытно внутри первого catalog slice.

---

# 29. Описание проекта

На detail page, а не на catalog card.

Структура:

- **О проекте**;
- **Что использовано**;
- **Как сделано** — если автор добавил;
- **Что можно изменить**;
- **Лицензия и использование**.

Длинный текст имеет читаемую ширину ~55–75 символов на строку и не растягивается на весь 4K экран.

---

# 30. Связь с «Знаниями»

На странице проекта можно показать:

**«Хотите сделать похожий проект?»**

И только реальные связанные материалы:

- задание;
- статья;
- курс;
- видео.

Связь двусторонняя:

```text
Знания → создать итоговый проект → опубликовать в Проекты
Проекты → открыть обучение → научиться сделать похожее
```

---

# 31. Владелец проекта: кнопки управления

На своей публичной странице владелец видит:

**«Редактировать публикацию»**

и menu **«⋯»**:

- Предпросмотр;
- История публикации;
- Доступ и публикация;
- Редакторы — только когда coauthor model разрешена;
- Снять с публикации;
- Архивировать рабочий проект — через существующий lifecycle;
- Удалить — только через существующую безопасную модель и не как primary action.

Модератор не получает кнопку обычного авторского редактирования чужого проекта.

---

# 32. Редактор публикации

Публичное представление редактируется отдельно от рабочего project draft.

Разделы:

1. **Основное** — title, summary/description, tags/category;
2. **Обложка**;
3. **Галерея** — фото и порядок;
4. **Видео** — если поддержано;
5. **Опубликованная версия** — какая immutable ProjectVersion сейчас показывается;
6. **Доступ** — public/unlisted и разрешения согласно R7;
7. **Лицензия / copy / download policy**;
8. **Комментарии** — только после R8 moderation/comments.

Основные кнопки:

- **«Предпросмотр»**;
- **«Опубликовать изменения»**.

Secondary/destructive действия не конкурируют визуально с publish.

---

# 33. Autosave и public draft

Во время редактирования:

- изменения автоматически сохраняются в **public publication draft**;
- текущая публичная PublicationRevision не меняется;
- UI показывает состояния:
  - «Сохраняем…»;
  - «Все изменения сохранены»;
  - «Есть неопубликованные изменения»;
  - «Нет соединения — изменения будут отправлены после восстановления», если это реально поддержано.

Только **«Опубликовать изменения»** создаёт новую immutable PublicationRevision.

---

# 34. История публикации

История публикации отличается от истории рабочего ProjectVersion.

Запись PublicationRevision содержит:

- revision id/version;
- время;
- editor principal;
- public metadata/media state;
- ссылку на exact ProjectVersion;
- moderation state, если применимо.

Restore старой публикации **создаёт новую PublicationRevision**, а не переписывает историю задним числом.

---

# 35. Рабочий проект изменился после публикации

Новый working draft/version не становится публичным автоматически.

Владелец видит:

> «У проекта есть более новая рабочая версия.»

Действия:

- **«Обновить опубликованную версию»**;
- **«Оставить текущую»**.

После выбора новой версии владелец всё равно проходит preview/publish flow.

---

# 36. Модерация

Moderation foundation предшествует публичным комментариям.

Модератор может:

- принять report;
- скрыть публикацию из discovery;
- ограничить конкретное media;
- отправить на исправление;
- закрыть comments;
- unpublish/restrict;
- restore;
- escalate.

Модератор **не должен переписывать title/description как автор**.

Каждое действие:

- scoped;
- auditable;
- reversible, где политика позволяет;
- имеет reason.

---

# 37. «Требуются изменения»

Владелец видит спокойное состояние:

**Требуются изменения**

Пример:

> На второй фотографии видны персональные данные. Удалите или замените изображение.

Кнопка:

**«Исправить публикацию»**

После исправления:

**«Отправить повторно»**.

Одна жалоба не удаляет проект автоматически.

---

# 38. Comments

Comments вводятся только после готовности одновременно:

- reports;
- moderation case/actions;
- audit;
- rate limits;
- XSS protection;
- minor/StudentSeat policy;
- disable-comments setting.

На detail page показываются 2–3 комментария и **«Все комментарии»**, если comments разрешены.

Публичный комментарий не заменяет classroom ReviewComment.

Direct child messaging не создаётся.

---

# 39. Права и safety

Названия ролей/permissions берутся из действующей модели ASA Lab, а не придумываются этим экраном.

Ключевые правила целевого R7/R8:

- новый проект private by default;
- StudentSeat не публикует публично;
- assignment work не публикуется публично;
- unverified adult account не получает public publication, если это текущая R7 policy;
- private/unlisted/ineligible content отсутствует в public search;
- public page показывает exact immutable version;
- unlisted не индексируется;
- revocation убирает доступ без удаления Project/Version;
- remix не меняет оригинал;
- school/class membership не раскрывается публично;
- public comments не доступны там, где age/safety policy запрещает.

### Важный AS-IS конфликт

Текущая Gallery позволяет StudentSeat читать Gallery и технически имеет reaction flow.

Глобальный R8 contract запрещает StudentSeat public like/comment/profile.

Поэтому:

- **не расширять seat social actions**;
- не делать текущую реакцию seat канонической target-политикой;
- изменение read-access StudentSeat к discovery требует отдельного product decision, потому что текущий runtime и canonical actor list расходятся;
- до решения не ломать существующий read-flow молча.

---

# 40. Anonymous access

Это больше не «открытый вопрос» для target.

R7 target:

- anonymous viewer открывает eligible public immutable project page.

R8 target:

- anonymous actor может открывать Explore/discovery public catalog.

Social write:

- anonymous не ставит persistent like/save/comment;
- при попытке соответствующее действие предлагает вход, не теряя текущий URL.

---

# 41. Визуальные ограничения: не превращать карточку в таблицу

Обязательные инварианты:

- preview визуально больше text block;
- title ≤ 2 строк;
- description на grid card = 0;
- author ≤ 1 строки;
- metrics ≤ 1 строки;
- badge ≤ 2;
- overlay control ≤ 1 заметного;
- primary visible action на карточке чаще всего сама карточка;
- текст не мельче 12 px даже для вторичной meta;
- hover не меняет layout;
- на mobile всё работает без hover.

---

# 42. Типографика и размеры

Desktop:

- H1: 32–40 px;
- H2: 22–28 px;
- card title: 15–18 px;
- author: 12–14 px;
- meta: 11–13 px;
- normal content: 14–16+ px.

Mobile:

- H1: 26–32 px;
- H2: 20–24 px;
- card title: 13–16 px;
- author: 11–13 px;
- meta: 11–12 px.

Применять существующие ASA Lab tokens и `clamp()` там, где это уже соответствует design system.

---

# 43. Радиусы, тени и цвет

Радиусы:

- small controls: 6–8 px;
- buttons/inputs: 8–12 px;
- cards: 10–16 px;
- featured: 16–20 px.

Не делать каждый элемент pill.

Тени:

- default card почти плоская + border;
- hover — лёгкая глубина;
- тяжёлые постоянные shadows запрещены.

Цвет:

- основной системный — фирменный ASA Lab blue/navy;
- module color — компактный акцент;
- red только для ошибки/destructive;
- badge не должен быть ярче проекта.

---

# 44. Tooltip и «?»

Пользователь не должен угадывать непонятную функцию.

Понятные иконки:

- like;
- comment;
- bookmark;
- share;
- play;
- zoom;
- close.

Для непонятных терминов допустим `ⓘ` / `?`:

- ремикс;
- лицензия;
- версия;
- «проверено печатью».

Но:

> если экран требует десять `?`, интерфейс нужно упростить.

Tooltip — 1–3 короткие строки, а не мини-справочник.

---

# 45. Mobile layout

## 320–359

- 1 card;
- page gutter 12 px;
- no desktop sidebar;
- primary controls почти на всю ширину.

## 360–599

- 2 cards;
- gap 10–12;
- horizontal category strip;
- normal target phone mode.

## 600–899

- 2 cards;
- 20–24 px gutters;
- tablet navigation.

## 900–1199

- 3 cards;
- compact/collapsible sidebar where applicable.

На открытом project mobile:

- viewer width 100%;
- actions сразу после title/author;
- tabs horizontal scroll;
- bottom action bar допустима с 1–2 CTA;
- учитывать safe-area;
- keyboard не перекрывает comment/editor fields.

---

# 46. Desktop / 2K / 4K / 8K

Layout зависит от CSS viewport.

Основной режим ≥1200:

- 4 columns;
- centered content container;
- max-width не даёт растянуть интерфейс на весь экран.

Ориентиры:

- normal desktop max-width: ~1600–1840 px;
- large/ultrawide: ~1840–2000 px;
- very large/4K/8K CSS viewport: ~2000–2200 px без отдельного presentation mode.

Не добавлять 5–10 колонок только потому, что монитор большой.

Для 4K/HiDPI увеличивать качество thumbnail, а не количество текста.

---

# 47. Images / thumbnails

Использовать реальный project result.

Responsive image rules:

- `srcset/sizes`;
- WebP/AVIF где поддержано;
- target raster roughly 1.5–2× фактического CSS-size для HiDPI;
- не отдавать 4K asset карточке шириной 180 px;
- не растягивать маленькую картинку на 4K.

Skeleton повторяет геометрию будущей карточки, чтобы избежать CLS.

---

# 48. Accessibility

Цель — WCAG 2.1 AA для критического пути.

Обязательно:

- keyboard navigation;
- visible focus;
- semantic headings;
- aria-label icon-only buttons;
- focus trap/restore dialogs;
- достаточный contrast;
- смысл не только цветом;
- reduced motion;
- zoom 200% без потери основных действий;
- touch targets;
- alt text для содержательных изображений.

---

# 49. Performance

Каталог:

- pagination/cursor;
- lazy images;
- не загружать heavy project payload в карточки;
- не запускать 3D/симуляцию во всех карточках;
- no N+1;
- query plan для search/filter/sort;
- cleanup viewer GPU/runtime после закрытия;
- slow network state;
- low-end mobile check.

Hover preview активируется максимум у нужной/видимой карточки и может отключаться по performance/reduced-motion/battery policy.

---

# 50. Security

Обязательно проверить:

- IDOR/object ACL;
- public/private cache isolation;
- отсутствие private/unpublished data в search/list/count/preview;
- XSS title/description/tags/comments;
- media MIME/size validation;
- CSRF если требуется текущей auth-моделью;
- rate limit public mutations/search согласно инфраструктуре;
- SSRF для remote media/import, если есть;
- artifact size/depth/runtime limits;
- no secrets/PII in telemetry;
- immutable publication reference;
- unlisted non-indexing.

---

# 51. API: сначала Gallery и существующие contracts

Перед каждым новым endpoint агент обязан проверить:

- `apps/api/src/gallery.controller.ts`;
- project domain/use-cases;
- Collections;
- current copy/provenance;
- publication DB functions;
- existing API types in `apps/web/src/api.ts`;
- OpenAPI/contract validation.

Не создавать `/api/public-projects` только ради красивого имени.

Допустимо эволюционно расширять Gallery/publication API или выделять отдельный publication service **только если это отражает новое семантическое состояние PublishedProject/PublicationRevision**.

---

# 52. Data model: что можно добавлять

Project, working Draft и ProjectVersion не дублируются.

Допустимые новые semantic entities после M0 audit:

- PublishedProject/public slug projection;
- immutable PublicationRevision;
- publication draft metadata;
- public media metadata;
- sanitized module artifact cache/projection;
- report/moderation case/actions;
- public comments — только после moderation foundation.

Каждая новая таблица/поле:

- additive migration;
- tenant/RLS/security contract;
- indexes;
- rollback/forward-fix;
- tests on non-empty DB.

---

# 53. Execution order: глобальные R-релизы выше локальных M-номеров

Старые локальные `M0–M7` в Implementation Spec — техническая декомпозиция, **не разрешение выполнять их в любом порядке**.

Глобальный target order:

```text
R3 Project Hub foundation
→ R7 sharing / publication / public page / remix
→ R8 Explore / profile / collections / interactions / moderation
```

R8 public discovery не должен обходить обязательные R7 publication invariants.

Нельзя начать R8 потому, что catalog UI кажется проще.

---

# 54. Рекомендуемые bounded slices

Каждый slice становится executable только после отдельного выбора в `current.yaml`.

## PROJ-A0 — Current architecture audit

Только анализ, без production behavior.

Deliverable:

`docs/product/ASA_PROJECTS_CURRENT_ARCHITECTURE_AUDIT.md`

Зафиксировать:

- Gallery DB functions/tables;
- Project/Version lifecycle;
- publication state;
- raw document exposure;
- Collections;
- reactions;
- provenance;
- licenses;
- routes;
- permissions/RLS;
- current E2E;
- REUSE / MODIFY / BUILD / DO-NOT-TOUCH.

**STOP после аудита.**

## PROJ-R7-01 — Immutable publication contract

Цель:

- exact ProjectVersion;
- PublishedProject/publicSlug;
- immutable PublicationRevision;
- visibility/revoke;
- no mutable draft in public page;
- authz + audit.

Не делать Explore/comments.

## PROJ-R7-02 — Public detail page

Цель:

- stable public URL;
- static safe preview fallback;
- author;
- description/tags/license/provenance;
- share;
- copy/remix;
- unavailable/revoked state;
- owner controls;
- desktop/mobile.

## PROJ-R7-03 — Safe public artifact contract

Цель:

- sanitizer;
- module artifact schema;
- no raw mutable document anonymous;
- tests;
- static fallback.

## PROJ-R7-04 — Viewer adapters

Отдельными bounded slices:

- 3D;
- Electronics;
- Blocks/Games по готовности.

Не объединять все модули в один гигантский PR/slice.

## PROJ-R7-05 — Publication editor / revisions / media

Цель:

- autosaved publication draft;
- preview;
- publish revision;
- history/restore;
- cover/media;
- physical-result photos;
- mobile basic editing.

## PROJ-R8-01 — Projects discovery catalog

Цель:

- top label «Проекты»;
- discovery route according to canonical routing;
- 4-column max;
- mobile 2-column;
- search/filter/sort;
- real preview;
- featured only with real source;
- loading/error/empty;
- legacy Gallery compatibility.

## PROJ-R8-02 — Collections / interactions / author projection

Цель:

- Collections reuse;
- account likes/bookmarks;
- profile/portfolio boundaries;
- no StudentSeat social leakage;
- real counters only.

## PROJ-R8-03 — Moderation foundation

Цель:

- report;
- moderation case;
- restrict/unpublish/restore;
- owner reason/resubmit;
- append-only audit;
- child-data protection.

## PROJ-R8-04 — Public comments

Только после R8-03.

## PROJ-R8-05 — Discovery refinement

- related projects;
- Knowledge links;
- real engagement metrics;
- ranking improvements;
- performance tuning.

---

# 55. Agent start protocol

Перед coding выбранного slice агент обязан:

1. прочитать `AGENTS.md`;
2. выполнить `pnpm agent:context --scope <lane>`;
3. проверить `current.yaml` — именно этот slice должен быть выбран/разрешён;
4. выполнить `pnpm control-plane:check`;
5. восстановить актуальный `main` baseline и working state согласно `AGENTS.md`;
6. проверить параллельные изменения;
7. прочитать только нужные разделы этого TZ + Implementation Spec + UI/UX Spec;
8. проверить реальный код выбранного модуля;
9. зафиксировать REUSE / MODIFY / BUILD;
10. только после этого писать код.

Feature branch не имеет права самостоятельно менять `current.yaml`, чтобы выбрать себе работу.

---

# 56. Git policy

Этот ТЗ **не запрещает direct main**.

Способ работы всегда берётся из текущего `development_policy` в `current.yaml` и `AGENTS.md`.

Если активен `direct_main`:

- разрешён direct main в рамках owner-selected slice и правил AGENTS;
- PR/feature branch опциональны.

Если используется feature branch:

- выполняется bounded integration cycle из AGENTS;
- branch не создаёт собственное execution state.

Нельзя помещать в product ТЗ постоянное правило «main никогда не менять», если repository policy говорит иначе.

---

# 57. Один запуск = один slice

Агент не имеет права после выполнения выбранного slice автоматически:

- переходить к следующему PROJ-*;
- «заодно» делать comments;
- «заодно» создавать studios;
- «заодно» менять Learning;
- «заодно» рефакторить Project Hub.

После выполнения acceptance выбранного slice:

**REPORT → STOP.**

---

# 58. Focused gates

Focused gate не придумывается этим документом.

Источник — `current.yaml` / task card / package scripts после активации slice.

Пока отдельный Projects R7/R8 gate не введён, нельзя объявлять случайный набор команд эквивалентом repository gate.

Минимальная философия:

```text
focused tests выбранного slice
→ browser journey, если UI/runtime
→ self-review
→ exact-SHA final gate согласно current.yaml
→ repository gate, если он обязателен scope
```

Owner evidence с Nx cache — только по правилам AGENTS.

---

# 59. Тесты каталога

Обязательные проверки:

- 320×568;
- 360×800;
- 390×844;
- 430×932;
- 768×1024;
- 820×1180;
- 1024×768;
- 1280×720;
- 1366×768;
- 1440×900;
- 1536×864;
- 1920×1080;
- 2560×1440;
- 3440×1440;
- 3840×2160;
- очень большой CSS viewport.

Проверить:

- max 4 columns desktop;
- 2 columns mobile 360+;
- no horizontal overflow;
- visual > text block;
- title ≤2;
- no description in normal card;
- ≤2 badges;
- touch target;
- no hover dependency;
- sharp thumbnails;
- search/filter URL state;
- loading/empty/error.

---

# 60. Тесты public detail

Проверить:

- direct URL/reload;
- anonymous eligible public access;
- revoked/unpublished state;
- exact immutable revision;
- no mutable draft leak;
- author/privacy projection;
- share;
- collection after sign-in;
- copy/remix provenance;
- mobile CTA;
- safe-area;
- static fallback;
- keyboard navigation.

---

# 61. Security tests

Минимум:

- anonymous не получает private/unlisted через перебор id/slug;
- anonymous не получает raw mutable document;
- unlisted не индексируется;
- StudentSeat не публикует;
- assignment work не публикуется;
- social action policy выполняется server-side;
- cross-tenant access fail-closed;
- remix creates independent project;
- owner/editor/moderator endpoints разделены;
- media restriction закрывает public bytes;
- XSS/abuse protections;
- cache keys не смешивают public/private.

---

# 62. Acceptance каталога

Catalog slice принимается только если:

- пользователь видит ASA Lab, а не новый generic SaaS;
- верхняя глобальная «Проекты» работает;
- «Мои проекты» не сломаны и не переименованы;
- visual cards соответствуют UI/UX Spec;
- 4 max desktop / 2 normal mobile;
- search/filter/sort реальны;
- current Gallery data отображается без fake content;
- legacy links не потеряны;
- accessibility mobile/desktop pass;
- owner screenshots приложены.

---

# 63. Acceptance public detail

Принимается только если:

- stable public URL;
- immutable revision;
- public page не зависит от mutable draft;
- real preview;
- title/author/description/tags/license/provenance;
- primary + secondary CTA;
- save/share/remix работают согласно permission;
- no raw project exposure;
- unavailable state понятен;
- mobile/desktop соответствуют spec.

---

# 64. Acceptance publication editor

Принимается только если:

- owner может исправить title/description/media;
- autosave сохраняет public draft;
- visitor продолжает видеть старую revision до publish;
- preview показывает будущую публикацию;
- publish создаёт новую immutable revision;
- restore создаёт новую revision;
- новая working version не публикуется сама;
- mobile позволяет базовое редактирование и фото;
- permissions tested.

---

# 65. Acceptance moderation/comments

Moderation:

- every action audited;
- moderator does not author-edit;
- owner sees reason;
- resubmit works;
- restrict/unpublish/restore tested;
- one report does not auto-delete.

Comments:

- только после moderation;
- public/classroom comments разделены;
- disable comments;
- reports;
- rate limit;
- XSS tests;
- minor/StudentSeat policy;
- mobile UI.

---

# 66. Visual QA: что считать дефектом

Дефектом считается:

- 5+ cards на основном desktop;
- text block выше preview;
- card description в 3–5 строк;
- больше 2 badges;
- 4 одинаково ярких CTA;
- карточка не открывается первым tap;
- мелкая кнопка <44 px touch-area;
- fake counters;
- AI placeholder вместо реального project preview;
- огромный marketing hero вместо контента;
- duplicate public nav top + left на desktop;
- 4K layout растянут от края до края;
- hover layout shift;
- destructive action как primary;
- tooltip/`?` около каждого поля;
- public project открыт в маленьком modal вместо отдельной страницы.

---

# 67. Нельзя делать

- второй Project domain;
- второй Collections/bookmarks domain;
- raw public document API ради viewer;
- comments без moderation;
- fake likes/views/ranking;
- public update из mutable working draft;
- client-only ACL;
- broad refactor «заодно»;
- новый dependency без доказанной необходимости;
- 3D/WebGL runtime в каждой catalog card;
- новый role enum только ради этой страницы;
- раскрытие school/class membership;
- direct child messaging;
- удаление legacy Gallery URLs одним релизом;
- самовольный переход агента к следующему slice.

---

# 68. Решённые вопросы

Эти пункты больше не считаются открытыми:

1. **Anonymous public detail нужен** — R7 target.
2. **Anonymous Explore нужен** — R8 target.
3. **`/projects` остаётся My Projects.**
4. **Public detail target — `/projects/:publicSlug`.**
5. **Discovery target — `/explore`, визуальная кнопка называется «Проекты».**
6. **Public page использует immutable publication revision, не mutable draft.**
7. **Copy/remix создаёт независимый private project с provenance.**
8. **Comments идут после moderation foundation.**
9. **Collections переиспользуются.**
10. **Visual grid max = 4 desktop.**

---

# 69. Вопросы, которые действительно остаются product decision

Не блокируют ранние безопасные slices, если не затрагиваются:

- окончательная политика download 3D/files;
- default license;
- video limits/storage;
- school-level premoderation;
- Studio ownership/coauthors;
- target read-access StudentSeat к Explore при расхождении current runtime и canonical actor list;
- официальный platform-curation workflow для статуса «Выбор ASA Lab»;
- конкретная ranking formula после накопления реальных данных.

Если выбранный slice упирается в один из них — STOP и owner decision, а не самовольное решение бота.

---

# 70. Evidence в отчёте coding-агента

Финальный отчёт следует `AGENTS.md` и дополнительно для Projects указывает:

- selected slice;
- exact current.yaml task/checkpoint;
- main baseline SHA;
- final SHA;
- REUSE / MODIFY / BUILD decisions;
- files changed;
- DB/API diff;
- permission matrix tested;
- responsive screenshots;
- user flow;
- tests/gates actually run;
- cache status;
- regression status My Projects / Classroom Projects / editor;
- known gaps;
- next slice **не начат**.

---

# 71. Definition of Done всей целевой системы

Полная система «Проекты» считается достигнутой только когда:

- public immutable publication работает;
- public permalink работает;
- public discovery работает;
- каталог visual-first и responsive;
- My Projects остаётся отдельным личным пространством;
- 3D/Electronics и другие viewers имеют безопасный read-only путь или честный fallback;
- Collections работают;
- copy/remix с provenance работает;
- owner publication editor/revisions работают;
- media/physical result работают;
- moderation foundation работает;
- comments работают только после moderation;
- privacy/minor policies соблюдены;
- analytics/ranking используют реальные данные;
- accessibility и mobile critical flows приняты;
- 4K/ultrawide не ломают иерархию;
- legacy links мигрированы без потери;
- существующие Project Hub/editor/version workflows не регрессировали.

---

# 72. Финальный принцип

Пользователь должен видеть:

> **«Это настоящая работа ASA Lab. Я понимаю, что это. Я могу открыть её, исследовать, сохранить и сделать свою версию.»**

Разработчик/бот должен видеть:

> **«Это не новый Project Hub. Я расширяю существующие Project, Gallery, Collections, publication и module contracts строго одним выбранным срезом.»**

Если визуальный интерфейс становится богаче за счёт лишних слов, fake metrics и десяти кнопок — решение неверное.

Если архитектура становится богаче за счёт второй модели проектов, второго bookmarks, второго renderer или второго execution state — решение неверное.
