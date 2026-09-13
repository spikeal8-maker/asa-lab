# ASA Lab — публичный раздел «Проекты»
## Исполняемое ТЗ и контракт самостоятельной подсистемы Public Projects

**Статус:** TARGET + execution contract; сам по себе не разрешает coding  
**Репозиторий:** `spikeal8-maker/asa-lab`  
**Ветка документации:** `docs/projects-ui-ux-spec-v3`  
**Продуктовый источник:** `docs/product/ASA_PROJECTS_UI_UX_SPEC.md`  
**Архитектурный источник:** `docs/product/ASA_PROJECTS_IMPLEMENTATION_SPEC.md`  
**Исполнительная политика:** `AGENTS.md` + `START_HERE_FOR_AI.md` + `docs/execution/current.yaml`

---

# 0. Что именно мы строим

**«Проекты» — самостоятельная единая продуктовая подсистема внутри ASA Lab.**

Это не отдельный сайт, не отдельное приложение и не второй Project Core.

Для пользователя это один законченный общественный раздел ASA Lab, в котором он:

- видит опубликованные работы других людей;
- ищет и фильтрует проекты;
- открывает отдельную страницу проекта;
- исследует 3D, электронику, игру, блоки или другие поддерживаемые результаты;
- ставит реакцию;
- сохраняет проект;
- делится ссылкой;
- делает собственную версию;
- смотрит фото/видео физического результата;
- позднее обсуждает проект;
- может пожаловаться;
- автор управляет своей публикацией;
- модератор управляет только публичным состоянием и безопасностью.

Главное определение:

> **Подсистема Public Projects владеет публичной жизнью проекта, но не владеет самим рабочим проектом и его редактором.**

Её граница начинается в момент, когда существующая неизменяемая версия рабочего проекта выбирается для публикации, и заканчивается discovery, публичным просмотром, взаимодействиями и модерацией этой публикации.

---

# 1. Иерархия источников истины

Coding-агент обязан работать в следующем порядке:

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
- Issue/task card отвечает **какой конкретный срез выбран**;
- этот файл отвечает **какой результат обязан получить выбранный срез**;
- Implementation Spec отвечает **как встроить результат в существующую архитектуру**;
- UI/UX Spec отвечает **как результат должен выглядеть и вести себя**;
- фактический код отвечает **что уже существует и что надо переиспользовать**.

Ни это ТЗ, ни roadmap, ни readiness, ни старый PR не дают права автоматически начать следующий этап.

---

# 2. Граница подсистемы Public Projects

## 2.1. Подсистема владеет

| Принадлежит Public Projects | Смысл |
|---|---|
| Publication / PublishedProject | факт публичной публикации существующего проекта |
| PublicationRevision | неизменяемая публичная редакция |
| Public metadata | title/summary/tags/license/public settings |
| Public cover | выбранная обложка публикации |
| Public media | фото, видео, фото печати/сборки |
| Public artifact | безопасная read-only проекция для viewer |
| Discovery catalog | каталог, поиск, категории, сортировки, featured |
| Public project page | отдельная страница публикации |
| Reactions | разрешённые публичные реакции |
| Public comments | только после moderation foundation |
| Reports | жалобы |
| Moderation state | ограничение/скрытие/возврат публикации |
| Public analytics | просмотры/открытия/запуски — если введены |

## 2.2. Подсистема не владеет

| Не принадлежит Public Projects | Кто владеет |
|---|---|
| Working Project | Project Core |
| Working Draft | Project lifecycle |
| Project autosave | Project lifecycle / editor |
| ProjectVersion creation | Project lifecycle |
| 3D editor | 3D module |
| Electronics editor | Electronics module |
| Scratch/Blocks editor | Blocks module |
| Game editor/runtime source | соответствующий game module |
| Account/session | Identity |
| Classroom/assignment | Learning/Classroom |
| Collections storage | существующий Collections domain |
| User permissions | Identity/Authz |
| Raw project document | Project/module domain |

**Запрещено** копировать эти домены внутрь Public Projects только ради удобства публичного экрана.

---

# 3. Как Public Projects соединяется с остальным ASA Lab

Целевая схема:

```text
Рабочий Project
      │
      ▼
immutable ProjectVersion
      │
      │ publish
      ▼
PublishedProject / Publication
      │
      ▼
immutable PublicationRevision
      │
      ├── Public metadata
      ├── Cover / Media
      ├── Public artifact
      ├── Reactions
      ├── Comments
      └── Moderation state
             │
             ▼
       «Проекты» / Explore
```

Public Projects не редактирует рабочий Project напрямую.

Если пользователь нажимает **«Сделать свою версию»**:

```text
Published immutable source
→ существующий server copy/remix flow
→ новый независимый private Project пользователя
→ provenance/attribution сохраняется
→ оригинал не меняется
```

---

# 4. AS-IS: что уже есть и переиспользуется

У ASA Lab уже существуют три разные поверхности.

## 4.1. «Мои проекты»

Личный Project Hub пользователя.

Его смысл не меняется.

Он остаётся рабочим местом, где пользователь:

- создаёт;
- редактирует;
- переименовывает;
- дублирует;
- архивирует;
- восстанавливает;
- открывает редактор;
- работает с версиями.

## 4.2. Classroom Projects

`ProjectsPage.tsx` относится к конкретному classroom context.

Это не база общественного каталога.

## 4.3. Gallery / «Проекты сообщества»

Это существующая общественная поверхность и правильная база будущих «Проектов».

Уже есть:

- список опубликованных работ;
- «Новые / Популярные»;
- фильтр по модулю;
- preview;
- автор;
- `like` / `wow`;
- `editors_choice`;
- публикация / снятие публикации;
- detail page;
- description;
- tags;
- license;
- provenance;
- server copy в собственный Project;
- Collections integration.

**Требование:** Public Projects эволюционирует из существующей Gallery, а не создаётся рядом вторым общественным продуктом.

---

# 5. AS-IS gaps, которые нельзя замалчивать

1. Текущий Gallery runtime в ряде сценариев требует авторизованного viewer, а target R7/R8 допускает anonymous public viewing eligible публикаций.
2. Текущий Gallery detail может отдавать `document_json`; это не является целевым public viewer contract.
3. Текущий public viewer должен перейти к безопасному module-specific public artifact/read-only projection.
4. Полноценный publication draft/revision lifecycle ещё не считается доказанным как готовый.
5. Media gallery, moderation foundation, comments и расширенный discovery требуют отдельных срезов.
6. Текущие реакции StudentSeat не считаются автоматически target-политикой R8; safety policy имеет приоритет.

Эти gaps фиксируются как AS-IS, а не маскируются новым параллельным backend.

---

# 6. Маршруты и место системы в продукте

Нельзя отдавать публичному каталогу смысл личного `/projects`.

Целевая модель:

- `/projects` — **Мои проекты**;
- `/projects/:publicSlug` — публичная страница конкретной immutable публикации;
- `/explore` — discovery-каталог публичных проектов;
- верхняя пользовательская кнопка называется **«Проекты»**;
- `/gallery` и `/gallery/:projectId` сохраняются как legacy-совместимость до отдельной миграции/redirect.

До активации новых route внутренний `kind: 'gallery'` и `/api/gallery` могут сохраняться.

**Запрещено ломать старые ссылки одним срезом.**

---

# 7. Глобальная оболочка ASA Lab

Public Projects использует существующую оболочку платформы.

Desktop header:

```text
[ASA Lab]      [Проекты] [Знания]                    [+ Создать] [профиль]
```

Требования:

- «Проекты» — активный общественный раздел;
- «Знания» — отдельный общественный образовательный раздел;
- `+ Создать` использует текущий Quick Create;
- профиль использует текущий account menu;
- отдельную шапку специально для Public Projects не создавать.

Левая desktop-навигация остаётся личной:

- Главная;
- Классы — если доступны;
- Мои проекты;
- Игры;
- Сохранённое;
- Моё обучение;
- Курсы и задания — по capability;
- Справка;
- профиль/админ — по текущей модели.

На mobile «Проекты» и «Знания» обязаны оставаться доступны через mobile navigation, если глобальные tabs скрываются из шапки.

---

# 8. Главный экран системы — каталог «Проекты»

Порядок сверху вниз:

1. H1 **«Проекты»**;
2. короткий конкретный подзаголовок;
3. поиск;
4. горизонтальные категории;
5. сортировка + кнопка «Фильтры»;
6. компактный featured-блок, только если есть реальный featured source;
7. сетка опубликованных проектов;
8. серверная pagination/cursor continuation;
9. loading/empty/error states.

Подзаголовок:

> Смотрите, что создают пользователи ASA Lab. Открывайте проекты, изучайте их и делайте свои версии.

Не использовать пустой маркетинговый текст.

---

# 9. Поиск

Поле:

**«Найти проект, автора или тему»**

Target search:

- title;
- разрешённое public description;
- tags;
- author/profile label;
- module/topic;
- поддерживаемые technology keywords.

Требования:

- debounce;
- search state в URL;
- reload/Back/Forward восстанавливают состояние;
- server-backed search;
- private/unlisted/ineligible content не попадает в public search;
- нельзя выдавать локальный фильтр по уже загруженным 24 карточкам за глобальный поиск.

---

# 10. Категории и фильтры

Первичная строка:

**Все · 3D-моделирование · Электроника · Блочное программирование · Графика · Игры · ИИ**

Категория строится на реальных module metadata/tags.

Расширенные фильтры доступны через **«Фильтры»**.

Фильтр появляется только если существует реальное backend-поле/семантика:

- можно запустить;
- можно сделать свою версию;
- есть файлы;
- для 3D-печати;
- с инструкцией;
- curated/verified.

Mobile: bottom-sheet.

Внизу bottom-sheet:

- **«Сбросить»**;
- **«Показать N проектов»**.

---

# 11. Сортировка

Показывать только режимы с реальной метрикой.

Базово:

- **Новые**;
- **Популярные** — только если формула реально определена.

Позже:

- Часто сохраняют;
- Часто делают свои версии;
- Обсуждаемые.

Fake likes/views/popularity запрещены.

---

# 12. Featured / «Проект недели»

Допускается один компактный редакционный блок.

Desktop:

- ориентир высоты 190–240 px;
- не занимает половину первого экрана;
- не повторяется сразу первым элементом grid.

Состав:

- реальный preview;
- название;
- автор;
- одна короткая строка;
- максимум 2–3 реальных показателя;
- **«Открыть проект»**;
- **«Сделать свою версию»**.

На mobile featured вертикальный и компактный; для возвращающегося пользователя может быть свёрнут/скрыт, если мешает каталогу.

---

# 13. Сетка каталога

Responsive определяется по CSS viewport.

- 320–359: 1 карточка;
- 360–899: 2 карточки;
- 900–1199: 3 карточки;
- ≥1200: **4 карточки**;
- ultrawide/2K/4K/8K: всё ещё максимум 4 в основном режиме.

5+ карточек в основной desktop-сетке запрещены.

Контент центрирован и ограничен max-width; 4K/8K не растягивает сайт от края до края.

---

# 14. Карточка проекта

Карточка — главный discovery-объект.

Иерархия:

```text
визуал
→ название
→ автор
→ компактные сигналы
→ служебная информация
```

Обязательные ограничения:

- visual = примерно 65–72% высоты;
- text/meta = 28–35%;
- title максимум 2 строки;
- description в обычной grid-card = 0 строк;
- author = 1 строка;
- metrics = 1 строка;
- badge = максимум 2;
- overlay action = максимум 1 заметная;
- карточка работает без hover;
- hover не меняет layout.

Допустимые элементы:

- реальный preview;
- маленький type/module marker;
- bookmark/save control;
- title;
- author/avatar;
- 1 строка реальных метрик.

Не показывать одновременно десяток тегов, действий и статусов.

---

# 15. Preview карточки по типам

## 3D

- реальный render/model preview;
- desktop может запускать мягкую короткую rotation preview;
- нельзя держать WebGL viewer активным на каждой карточке одновременно.

## Electronics

- реальная схема/preview;
- допустим короткий live-state preview только при разумной нагрузке;
- никаких выдуманных показаний.

## Blocks

- рабочая область или результат программы;
- не декоративный «кодовый» арт.

## Games

- реальный кадр/короткий preview;
- после открытия — явное **«Играть»**.

## Graphics / AI

- реальный результат проекта;
- не generic decorative image.

---

# 16. Нажатие на карточку

Основной click открывает **отдельную страницу проекта с собственным URL**.

Не использовать modal как основной detail UX.

Отдельная страница нужна для:

- прямой ссылки;
- reload/deep link;
- search indexing eligible content;
- share;
- media;
- comments;
- полноценного viewer;
- mobile.

---

# 17. Public Project Page

Desktop:

- слева 65–70% — viewer/media;
- справа 30–35% — title/author/actions/social signals.

Mobile:

- viewer 100% ширины;
- title/author ниже;
- actions сразу после основной информации;
- длинные дополнительные блоки ниже;
- допустим bottom action bar с 1–2 CTA и safe-area.

Первый экран обязан быстро отвечать:

1. что это за проект;
2. кто автор;
3. можно ли его открыть/запустить;
4. можно ли сделать свою версию;
5. можно ли сохранить/поделиться.

---

# 18. Кнопки открытого проекта

## Primary action

Подписывается по типу:

- **«Открыть 3D»**;
- **«Запустить симуляцию»**;
- **«Играть»**;
- **«Открыть программу»**;
- **«Открыть проект»** — только когда специфическое название неприменимо.

## Secondary primary action

**«Сделать свою версию»**.

## Дополнительные действия

- Нравится;
- Сохранить;
- Поделиться;
- Скачать — если разрешено;
- Пожаловаться.

В одном локальном блоке максимум:

- 1 primary;
- 1 secondary;
- остальные — icon/menu.

Не делать четыре одинаково яркие кнопки.

Desktop CTA: 42–48 px.  
Mobile CTA: 48–52 px.  
Touch target: минимум 44×44 px.

---

# 19. Public viewer contract

Публичный viewer никогда не должен получать право редактировать исходный Project.

Целевой поток:

```text
ProjectVersion
→ module-specific sanitizer / public artifact builder
→ versioned read-only public artifact
→ public viewer
```

Public artifact содержит только то, что нужно для безопасного просмотра/запуска.

Raw mutable draft не является public API.

Если viewer не может безопасно загрузиться — static preview остаётся fallback.

---

# 20. 3D viewer

Поддерживает:

- rotate;
- zoom;
- reset view;
- fullscreen;
- ракурсы, если доступны;
- touch gestures.

Mobile:

- 1 палец — rotate;
- pinch — zoom;
- никаких hover-only действий.

Viewer lazy-loaded и корректно освобождает GPU/resources после закрытия.

---

# 21. Electronics viewer

Поддерживает:

- read-only схему;
- start/stop simulation;
- reset;
- разрешённые measured values;
- просмотр кода/логики, если public artifact разрешает.

Запрещено:

- write в оригинал;
- обходить fail-closed simulation contract;
- выдумывать значения unsupported component;
- отправлять raw private editor payload.

---

# 22. Blocks / Games / Graphics

Blocks:

- read-only blocks;
- запуск результата;
- fullscreen, если поддержан.

Games:

- play;
- controls help;
- fullscreen;
- runtime/sandbox limits.

Graphics:

- качественный result preview;
- gallery/before-after при наличии.

Если модуль не готов к interactive public viewer, честный static preview лучше фальшивой интерактивности.

---

# 23. Media tabs

Показываются только вкладки с реальным содержимым:

```text
Проект | 3D | Фото | Видео | Схема | Код | Файлы
```

Пример 3D:

```text
3D-модель | Фото печати | Видео | Файлы
```

Пример Electronics:

```text
Симуляция | Схема | Код | Фото сборки
```

На mobile tabs прокручиваются горизонтально.

---

# 24. Физический результат

Автор может прикрепить:

- фото 3D-печати;
- фото собранной схемы;
- фото устройства/робота;
- короткое демонстрационное видео.

Mobile publication editor должен позволять добавить фото прямо с телефона.

---

# 25. «Сохранить»

Использует существующий Collections domain.

Desktop — compact dialog/popover.  
Mobile — bottom-sheet.

Возможности:

- добавить в существующую подборку;
- убрать из подборки;
- создать новую подборку.

Не создавать второй bookmarks backend.

---

# 26. «Сделать свою версию»

Обязательная семантика:

```text
immutable published source
→ server copy/remix
→ new independent private personal Project
→ provenance/attribution retained
→ original unchanged
```

После успеха:

> Копия добавлена в ваши проекты.

Действия:

- **«Открыть копию»**;
- **«Остаться здесь»**.

Нельзя открывать чужой исходный проект сразу editable.

---

# 27. «Поделиться»

Desktop:

- копировать stable public URL;
- при наличии — системные share targets.

Mobile:

- Web Share API, если доступен;
- fallback — копирование ссылки.

Share никогда не выдаёт private/raw URL.

---

# 28. Автор

Public Project Page показывает только разрешённую публичную проекцию автора:

- avatar;
- public display name;
- допустимый профильный статус;
- позже — другие опубликованные работы.

Не раскрывать:

- класс;
- школьное членство;
- tenant/workspace identifiers;
- персональные данные несовершеннолетних.

Studio/coauthor model — отдельный поздний этап и не внедряется скрытно в первом catalog slice.

---

# 29. Описание проекта

Описание находится на detail page, а не на grid card.

Блоки:

- **О проекте**;
- **Что использовано**;
- **Как сделано** — если заполнено;
- **Что можно изменить**;
- **Лицензия и использование**.

Длинный текст: ориентир 55–75 символов на строку.

---

# 30. Связь с «Знаниями»

На detail page допускается блок:

**«Хотите сделать похожий проект?»**

Только реальные связанные материалы:

- курс;
- статья;
- видео;
- задание.

Цикл:

```text
Проекты → узнать как сделано → Знания
Знания → создать результат → опубликовать → Проекты
```

«Проекты» и «Знания» остаются отдельными подсистемами, связанными ссылками и контекстом.

---

# 31. Публикация как отдельная сущность

Public publication не равна `project.public = true`.

Target model:

```text
Project
→ ProjectVersion
→ PublishedProject / Publication
→ PublicationRevision
```

`PublicationRevision`:

- immutable;
- ссылается на exact ProjectVersion;
- содержит/ссылается на public metadata/media state;
- имеет собственный revision id;
- может иметь moderation state.

Публикация не дублирует рабочий editor document как второй Project.

---

# 32. Владелец публикации

На своей публичной странице владелец видит:

**«Редактировать публикацию»**

и menu **«⋯»**:

- Предпросмотр;
- История публикации;
- Доступ и публикация;
- Редакторы — только после утверждённой coauthor model;
- Снять с публикации;
- связанные безопасные действия рабочего Project через его существующий lifecycle.

Delete никогда не primary action.

---

# 33. Publication Editor

Разделы:

1. **Основное** — title, summary/description, tags/category;
2. **Обложка**;
3. **Галерея**;
4. **Видео**;
5. **Опубликованная версия** — exact ProjectVersion;
6. **Доступ** — public/unlisted и разрешённые policy options;
7. **Лицензия / copy / download policy**;
8. **Комментарии** — только после готовности moderation/comments.

Главные кнопки:

- **«Предпросмотр»**;
- **«Опубликовать изменения»**.

Secondary/destructive actions не конкурируют визуально с publish.

---

# 34. Autosave publication draft

Редактирование публичной страницы сохраняет **publication draft**, а не рабочий project draft.

UI states:

- «Сохраняем…»;
- «Все изменения сохранены»;
- «Есть неопубликованные изменения»;
- offline state — только если реально поддержан.

Пока пользователь не нажал **«Опубликовать изменения»**, посетители видят последнюю PublicationRevision.

---

# 35. История публикации

История публикации и ProjectVersion history — разные вещи.

PublicationRevision хранит:

- revision id/version;
- timestamp;
- editor principal;
- public metadata/media snapshot/reference;
- exact ProjectVersion reference;
- moderation state, если применимо.

Restore старой публикации создаёт новую PublicationRevision.

История не переписывается задним числом.

---

# 36. Рабочий Project стал новее опубликованного

Новая рабочая версия не становится публичной автоматически.

Владелец видит:

> У проекта есть более новая рабочая версия.

Действия:

- **«Обновить опубликованную версию»**;
- **«Оставить текущую»**.

Выбор новой ProjectVersion всё равно проходит preview → publish.

---

# 37. Reactions и social signals

На первом этапе переиспользуются реальные существующие реакции.

Не вводить rating `4.8/5`.

Целевые сигналы могут включать:

- like;
- saves;
- copy/remix count;
- views;
- launches;
- comments.

Каждый signal появляется только после появления real persistent backend.

`wow` может сохраняться ради обратной совместимости, но его визуальный приоритет определяется отдельным UX-решением.

---

# 38. Comments

Comments появляются только после готовности одновременно:

- reports;
- moderation cases/actions;
- audit;
- rate limits;
- XSS protection;
- StudentSeat/minor policy;
- disable-comments setting.

На detail page допустимо показать 2–3 комментария + **«Все комментарии»**.

PublicComment не заменяет classroom ReviewComment.

Direct child messaging не создаётся.

---

# 39. Moderation

Moderation управляет **публичным состоянием**, а не рабочим Project.

Модератор может:

- принять report;
- скрыть публикацию из discovery;
- ограничить конкретное media;
- отправить на исправление;
- закрыть comments;
- restrict/unpublish;
- restore;
- escalate.

Модератор не должен обычным author-edit изменять чужие title/description.

Каждое moderation action:

- scoped;
- auditable;
- имеет reason;
- reversible, где политика допускает.

---

# 40. «Требуются изменения»

Владелец видит спокойное состояние:

**Требуются изменения**

Пример:

> На второй фотографии видны персональные данные. Удалите или замените изображение.

Кнопки:

- **«Исправить публикацию»**;
- после правки — **«Отправить повторно»**.

Одна жалоба не удаляет Project автоматически.

---

# 41. Anonymous access

Target R7/R8:

- anonymous может открыть eligible public immutable project page;
- anonymous может просматривать public discovery catalog;
- anonymous не выполняет persistent social writes.

При попытке like/save/comment:

- предложить вход;
- после входа вернуть пользователя на ту же публикацию.

---

# 42. StudentSeat / minor safety

Ключевые target-инварианты:

- StudentSeat не публикует публично;
- assignment work не становится public;
- private/unlisted/ineligible content отсутствует в public search;
- school/class membership не раскрывается;
- minor profile projection ограничена policy;
- social actions StudentSeat не расширяются без отдельного утверждения.

Текущий read-flow Gallery для StudentSeat не ломается молча: изменение требует отдельного принятого продуктового решения.

---

# 43. Визуальный характер ASA Lab

Public Projects должен выглядеть как часть существующего ASA Lab:

- светлый рабочий фон;
- фирменный blue/navy;
- тонкие borders;
- умеренные radii;
- слабые shadows;
- крупные реальные previews;
- module accent только как вспомогательный цвет;
- минимум декоративных gradients;
- никакого generic SaaS/Dribbble hero.

Главный визуальный принцип:

> **проект > название > автор > social signals > служебная информация.**

---

# 44. Типографика и controls

Desktop:

- H1: 32–40 px;
- H2: 22–28 px;
- card title: 15–18 px;
- author: 12–14 px;
- meta: 11–13 px;
- body: 14–16+ px.

Mobile:

- H1: 26–32 px;
- H2: 20–24 px;
- card title: 13–16 px;
- author: 11–13 px;
- meta: 11–12 px.

Radii:

- small controls: 6–8 px;
- buttons/inputs: 8–12 px;
- cards: 10–16 px;
- featured: 16–20 px.

Не превращать каждый элемент в pill.

---

# 45. Tooltip / help

Понятные icon actions:

- like;
- comment;
- bookmark;
- share;
- play;
- zoom;
- close.

Они требуют `aria-label` и desktop tooltip/focus label.

Для непонятных понятий допустим маленький `ⓘ`/`?`:

- remix;
- license;
- version;
- verified print.

Если экран требует множество `?`, сам UX считается недостаточно понятным.

---

# 46. Mobile contract

## 320–359

- 1 card;
- gutter 12 px;
- no desktop sidebar;
- primary controls почти на всю ширину.

## 360–599

- 2 cards;
- gap 10–12 px;
- horizontal category strip;
- основной телефонный режим.

## 600–899

- 2 cards;
- gutter 20–24 px;
- tablet navigation.

## 900–1199

- 3 cards;
- compact/collapsible sidebar where applicable.

Project detail mobile:

- viewer 100%;
- actions сразу после title/author;
- tabs horizontal scroll;
- bottom CTA допустим с 1–2 actions;
- safe-area учитывается;
- никакая основная функция не зависит от hover.

---

# 47. Large screens / 2K / 4K / 8K

Физическое разрешение не определяет layout.

На больших CSS viewports:

- максимум 4 columns;
- content max-width;
- центрирование;
- текст не растягивается;
- изображения становятся качественнее, а не просто больше;
- не добавлять лишние строки metadata ради свободного места.

Отдельный TV/presentation mode возможен только как будущий самостоятельный режим.

---

# 48. Accessibility

Target: WCAG 2.1 AA для критических пользовательских сценариев.

Обязательно:

- keyboard-only navigation;
- видимый focus;
- логичный focus order;
- semantic headings;
- labels/aria-label;
- alt text для содержательных media;
- focus trap + restore для dialog/bottom-sheet;
- touch target ≥44×44;
- достаточный contrast;
- `prefers-reduced-motion`;
- 200% browser zoom не ломает ключевые actions.

---

# 49. Performance

Каталог:

- server pagination/cursor;
- lazy image loading;
- responsive image variants;
- без N+1;
- без загрузки полного project payload для карточек;
- без одновременного запуска десятков WebGL/simulation runtimes.

Viewer:

- lazy-load;
- cleanup resources;
- static fallback;
- performance проверяется на low-end mobile и large viewport.

---

# 50. Security

Обязательно проверить:

- IDOR/object ACL;
- отсутствие raw private project document в public API;
- XSS title/description/comments;
- upload MIME/type/size;
- safe media serving;
- public/private cache separation;
- query/filter bounds;
- SSRF, если появляются remote imports;
- отсутствие secrets/PII в telemetry;
- immutable publication semantics;
- unlisted не индексируется;
- revocation реально убирает public access.

---

# 51. Что нельзя строить внутри Public Projects

Запрещено:

- `projects_v2` как второй Project domain;
- второй рабочий draft system;
- второй ProjectVersion stack;
- второй 3D/Electronics/Blocks editor;
- отдельный account/role model;
- отдельные bookmarks при существующем Collections;
- browser-only authorization;
- comments без moderation;
- public raw mutable project payload;
- fake counters/popularity;
- 5+ columns desktop;
- giant marketing hero;
- второй header/shell;
- автоматическую публикацию нового working draft;
- destructive migration ради UI;
- широкие unrelated refactors.

---

# 52. Глобальный порядок R3 → R7 → R8

Это принципиально.

## R3

Project Hub / shared Editor Host / working lifecycle.

Public Projects не заменяет и не обходит R3.

## R7

Sharing / publication / immutable public page / remix.

Именно здесь формируется фундамент Public Projects:

- publication entity;
- exact ProjectVersion publication;
- public detail;
- unlisted/public rules;
- remix/copy;
- revoke/unpublish;
- базовый moderation state/audit foundation.

## R8

Explore / public profiles / collections interactions / comments / moderation / discovery.

Полноценный каталог «Проекты» как общественный discovery-layer относится сюда.

**Нельзя начинать R8 только потому, что UI каталога уже нарисован.**

---

# 53. Техническая декомпозиция Public Projects

Эти номера не являются самостоятельным разрешением на выполнение.

## PROJ-A0 — Current Architecture Audit

Без product behavior changes.

Проверить:

- Project domain;
- Gallery backend/frontend;
- publication storage;
- snapshot/version semantics;
- Collections;
- copy/provenance;
- visibility;
- reactions;
- ACL/RLS;
- existing tests;
- route semantics.

Результат:

`docs/product/ASA_PROJECTS_CURRENT_ARCHITECTURE_AUDIT.md`

## PROJ-R7-01 — Publication foundation

- exact immutable ProjectVersion;
- public/unlisted state;
- publish/unpublish/revoke;
- anonymous eligible public read;
- audit.

## PROJ-R7-02 — Public Project Page

- stable URL;
- static preview;
- author;
- metadata;
- license;
- provenance;
- share;
- Collections;
- remix.

## PROJ-R7-03 — Public artifact contract

- schema version;
- sanitizer;
- capability projection;
- no raw private payload;
- tests.

## PROJ-R7-04 — Module viewers

Каждый модуль отдельным bounded slice:

- 3D;
- Electronics;
- Blocks;
- Games.

## PROJ-R7-05 — Publication editor / media / revisions

- publication draft;
- autosave;
- preview;
- revisions;
- media;
- selected published ProjectVersion.

## PROJ-R8-01 — Projects discovery catalog

- визуальный catalog;
- search;
- categories;
- sort;
- featured;
- responsive grid;
- legacy route compatibility.

## PROJ-R8-02 — Interactions / profile projection

- Collections UX;
- eligible reactions;
- copy/remix counters;
- author public projection.

## PROJ-R8-03 — Moderation foundation

- reports;
- cases;
- actions;
- reasons;
- audit;
- restrict/restore.

## PROJ-R8-04 — Comments

Только после R8-03.

## PROJ-R8-05 — Discovery refinement

- related projects;
- real engagement metrics;
- links to Knowledge;
- performance tuning;
- ranking only on real data.

---

# 54. Правило для coding-бота

Один запуск обслуживает только один выбранный bounded slice.

Перед кодом:

1. прочитать `AGENTS.md`;
2. получить `pnpm agent:context --scope <lane>`;
3. убедиться, что task/slice выбран в `current.yaml`;
4. выполнить `pnpm control-plane:check`;
5. прочитать только нужные разделы этого ТЗ, Implementation Spec и UI/UX Spec;
6. найти существующий код;
7. классифицировать каждую часть как `REUSE / MODIFY / BUILD / DO-NOT-TOUCH`.

При `BUILD` агент обязан доказать, что подходящего существующего механизма нет.

После выполнения acceptance выбранного slice:

- выполнить focused gate;
- bounded self-review;
- требуемый repository/integration gate;
- собрать evidence;
- отчёт;
- **STOP**.

Наличие следующего READY slice не разрешает продолжать автоматически.

---

# 55. REUSE / MODIFY / BUILD matrix

Перед каждым срезом обновляется рабочая матрица:

| Область | Реальный path/symbol/API | Решение | Почему |
|---|---|---|---|
| Project Core | | REUSE / MODIFY / BUILD / DO-NOT-TOUCH | |
| Gallery list/detail | | | |
| Publication | | | |
| ProjectVersion | | | |
| Snapshot/preview | | | |
| Copy/remix | | | |
| Provenance | | | |
| Collections | | | |
| Reactions | | | |
| Search/filter | | | |
| Media | | | |
| Public artifact | | | |
| Moderation | | | |
| Comments | | | |
| Analytics | | | |

Пустая матрица не считается аудитом.

---

# 56. Обязательные E2E сценарии

Минимум по мере появления соответствующих slices:

1. Anonymous открывает eligible public project.
2. Anonymous не получает private/unpublished/unlisted-not-authorized project.
3. Owner публикует exact immutable version.
4. Working Project изменяется, public revision не меняется автоматически.
5. Owner снимает publication/revokes access.
6. User B делает свою версию и получает independent private Project с provenance.
7. Save использует Collections.
8. Search/filter/sort восстанавливаются после reload/Back/Forward.
9. 360–430 mobile catalog работает без horizontal overflow.
10. Public viewer не даёт write к source Project.
11. Unsupported viewer даёт controlled fallback.
12. Existing My Projects/editor/version/save flows не регрессируют.
13. Moderation restrict/restore работает, когда соответствующий slice реализован.
14. Comments policy/abuse tests проходят, когда comments активированы.

---

# 57. Visual QA

Проверить минимум:

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
- 3840×2160.

Критерии карточки:

- visual > text;
- title ≤2 lines;
- no description;
- ≤2 badges;
- 1-line author;
- 1-line metrics;
- no layout shift;
- sharp HiDPI thumbnail;
- mobile without hover dependency.

---

# 58. Acceptance Criteria системы

Система соответствует TARGET, когда:

- Public Projects воспринимается пользователем как единый общественный раздел ASA Lab;
- верхняя навигация содержит «Проекты» и «Знания»;
- личные «Мои проекты» остаются отдельным рабочим пространством;
- публичная публикация основана на exact immutable ProjectVersion;
- рабочий Project не дублируется вторым public project domain;
- каталог соответствует UI/UX Spec;
- desktop grid максимум 4 columns;
- mobile 360+ использует 2 columns;
- search/filter/sort server-backed;
- public detail имеет stable URL;
- primary actions понятны и типоспецифичны;
- «Сделать свою версию» создаёт independent Project с provenance;
- «Сохранить» использует Collections;
- public viewer read-only;
- raw private mutable payload не является public contract;
- publication draft не меняет live revision до publish;
- media физического результата поддерживается после соответствующего slice;
- moderation управляет публикацией, а не авторским Project;
- comments не появляются без moderation foundation;
- private/unlisted/ineligible data не утечёт через catalog/search/cache;
- accessibility/mobile/performance/security gates проходят;
- существующие My Projects/Classroom Projects/editors не регрессируют.

---

# 59. Definition of Done каждого среза

Срез считается завершённым только если:

- [ ] выбран в `current.yaml`;
- [ ] scope не расширен самовольно;
- [ ] REUSE/MODIFY/BUILD matrix заполнена;
- [ ] нет второго Project Core;
- [ ] нет второго version stack;
- [ ] server-side authorization сохранена;
- [ ] additive data changes доказаны, если они есть;
- [ ] focused tests проходят;
- [ ] required E2E проходит;
- [ ] lint/typecheck/build/gates выполнены согласно current task;
- [ ] mobile/desktop evidence получено для UI slice;
- [ ] нет fake data/actions;
- [ ] существующие project/editor flows не регрессировали;
- [ ] implementation evidence относится к точному финальному SHA;
- [ ] выполнен отчёт по контракту AGENTS.md;
- [ ] после приёмки агент остановился и не начал следующий slice автоматически.

---

# 60. Финальная формула системы

Для продукта:

> **«Проекты» — самостоятельная единая общественная подсистема ASA Lab.**

Для архитектуры:

> **Она владеет публикациями, discovery, публичным просмотром, взаимодействиями и модерацией, но не владеет рабочими Project, редакторами и модульными ядрами.**

Для пользователя:

```text
нашёл
→ открыл
→ посмотрел / запустил
→ сохранил
→ сделал свою версию
→ при необходимости изучил связанное знание
→ создал своё
→ опубликовал
```

Для разработчика:

> **Сначала переиспользовать существующее. Новое вводить только для нового публичного семантического состояния, а не ради удобства отдельного экрана.**
