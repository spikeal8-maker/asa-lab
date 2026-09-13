# ASA Lab — «Проекты»
# Техническое задание на развитие публичного раздела проектов

**Статус:** ТЗ v1  
**Репозиторий:** `spikeal8-maker/asa-lab`  
**Аудит исходного состояния:** `main` @ `cba12a29a3573991b199f0004ad16e5f27bfddab`  
**Продуктовый источник:** `docs/product/ASA_PROJECTS_UI_UX_SPEC.md`  
**Назначение:** превратить согласованную продуктовую и UI/UX-концепцию «Проектов» в поэтапный план реализации поверх уже существующей архитектуры ASA Lab.

---

# 1. Цель

Развить существующую публичную Галерею ASA Lab в полноценный общественный раздел **«Проекты»**, где пользователь может:

1. найти проект по теме, автору, модулю и другим признакам;
2. быстро понять тип и ценность проекта по карточке;
3. открыть отдельную публичную страницу проекта;
4. интерактивно исследовать опубликованный проект там, где модуль это поддерживает;
5. поставить реакцию;
6. сохранить проект в существующую подборку;
7. поделиться ссылкой;
8. сделать собственную копию/версию с сохранением происхождения;
9. увидеть автора или студию;
10. увидеть дополнительные фото/видео/физический результат;
11. позднее — комментировать после появления полноценного контура модерации;
12. владельцу — редактировать публичное представление проекта, не разрушая рабочую версию;
13. модератору — ограничивать нарушающий правила публичный материал без получения авторских прав на проект.

Ключевая продуктовая формула:

> **Проекты = витрина живых работ + безопасный публичный просмотр + авторство + реакции + сохранение + собственная версия + связь с обучением.**

---

# 2. Что не является целью

В рамках данного ТЗ запрещено:

- создавать второй домен проектов параллельно существующему Project Hub;
- заменять существующие проекты новой универсальной сущностью;
- переносить публичную логику в `ProjectsPage.tsx`, который сейчас является страницей проектов класса;
- создавать новую систему сохранений вместо существующих Collections;
- создавать вторую систему копирования/ремикса вместо существующего gallery copy flow;
- публиковать наружу сырой приватный snapshot проекта;
- запускать WebGL/симуляцию во всех карточках каталога одновременно;
- вводить комментарии до появления жалоб, модерации, rate-limit и журнала действий;
- делать крупный rewrite одним релизом;
- менять существующую семантику `Мои проекты`;
- удалять совместимость `/gallery` до завершения миграции маршрутов;
- смешивать раздел «Проекты» с разделом «Знания».

---

# 3. AS-IS: публичная витрина уже существует

Текущий общественный каталог реализован через:

- `apps/web/src/pages/GalleryPage.tsx`;
- `apps/web/src/pages/GalleryWorkPage.tsx`;
- `apps/api/src/gallery.controller.ts`.

Это правильная база будущего раздела «Проекты».

`GalleryPage` уже умеет:

- получать публичные работы;
- переключать «Новые / Популярные»;
- фильтровать по модулю;
- отображать preview;
- показывать автора;
- показывать дату;
- ставить реакции;
- учителю — ставить `Выбор редакции`;
- владельцу — снимать работу с публикации.

**Вывод:** новую публичную ленту создавать не нужно. Нужно эволюционно переработать существующую Gallery.

---

# 4. Три разные поверхности проектов в текущем UI

## 4.1. `MyProjectsPage.tsx`

Это личный Project Hub пользователя.

Он уже содержит:
- активные проекты;
- архив;
- корзину;
- восстановление;
- дублирование;
- поиск;
- сортировку;
- фильтры;
- открытие редакторов.

Он остаётся личной рабочей областью и не превращается в общественную витрину.

## 4.2. `ProjectsPage.tsx`

Это страница проектов конкретного класса.

У неё есть classroom context, поэтому её нельзя использовать как основу публичного раздела только из-за имени файла.

## 4.3. `GalleryPage.tsx`

Это существующее место просмотра работ других людей.

Именно оно должно эволюционировать в пользовательский раздел **«Проекты»**.

---

# 5. Текущая маршрутизация

Сейчас навигационная модель различает:

- `/projects` → `Мои проекты`;
- `/gallery` → публичная Gallery;
- `/gallery/:projectId` → публичная работа;
- `/knowledge` → знания;
- classroom projects → отдельный route.

Текущая левая навигация подписывает Gallery как «Сообщество».

Целевая модель:

- верхний глобальный пункт **«Проекты»** ведёт на публичную витрину;
- личный пункт **«Мои проекты»** остаётся отдельным;
- «Знания» остаются отдельным общественным разделом.

## 5.1. Миграция маршрутов

Первая реализация может сохранить внутренние `kind: 'gallery'` и API `/api/gallery`.

Пользовательский URL целевого состояния должен быть определён отдельным routing ADR, потому что `/projects` уже занят личными проектами.

До принятия ADR нельзя несовместимо переопределять `/projects`.

Старые ссылки `/gallery/:id` должны продолжать работать либо давать redirect на новый публичный URL.

---

# 6. AS-IS: backend Gallery

`apps/api/src/gallery.controller.ts` уже содержит критически важную гарантию:

> приватный Project остаётся приватным; публичная Gallery не отдаёт raw project JSON; пользователю выдаётся санитизированное публичное представление, а копирование выполняется сервером.

Эту границу необходимо сохранить.

Существующие возможности API:

- список Gallery;
- детальная публичная работа;
- preview PNG;
- реакции;
- `Выбор редакции`;
- снятие с публикации;
- копирование публичного проекта в свои проекты;
- публикация проекта.

Копирование:
- не меняет оригинал;
- создаёт новый собственный проект;
- сохраняет происхождение;
- новый проект принадлежит копирующему пользователю.

**Требование:** `Сделать свою версию` переиспользует существующую серверную copy-механику.

---

# 7. AS-IS: реакции

Сейчас Gallery сознательно не является полной социальной сетью.

Поддерживаются:
- `like`;
- `wow`;
- редакционный выбор.

В текущем frontend отсутствие комментариев связано с отсутствием полноценной модерации. Это правильное ограничение.

## Целевое решение

На первой визуальной итерации:
- сохранить текущие реакции;
- `Нравится` оставить основным сигналом;
- `Ого` сохранить ради обратной совместимости, при необходимости деакцентировать;
- не вводить рейтинг `4.8/5`.

Комментарии появляются отдельным этапом после moderation foundation.

---

# 8. AS-IS: Collections

`apps/api/src/collections.controller.ts` уже предоставляет пользовательские подборки.

Поддерживаются:
- список коллекций;
- создание;
- изменение;
- удаление;
- добавление/удаление проекта;
- определение, в каких коллекциях находится проект.

Frontend уже имеет `CollectPicker` и `CollectionsPage`.

## Требование

Кнопка **«Сохранить»** публичного проекта обязана использовать текущий Collections domain.

Запрещено создавать отдельные bookmarks или второй список избранного.

---

# 9. AS-IS: Project Hub

`projects.controller.ts` уже содержит развитый жизненный цикл проектов.

У проекта уже используются:
- owner;
- classroom;
- visibility;
- published state;
- snapshot revision;
- module version;
- archive;
- trash;
- восстановление;
- draft;
- notes;
- checkpoints / versions;
- properties.

## Требование

Будущее редактирование публичной публикации не должно дублировать рабочие drafts, snapshots и checkpoints.

Нужно различать:

### Рабочий проект
Источник редактируемого контента внутри инструмента.

### Публичная публикация
Публичное представление выбранной версии рабочего проекта.

Они связаны, но не идентичны.

---

# 10. AS-IS: карточка Project Hub

`ProjectCard.tsx` и `project-card.css` уже задают полезные инварианты:

- preview доминирует;
- title clamp до двух строк;
- умеренные border/radius;
- лёгкий hover;
- touch actions;
- responsive сетка.

Но текущий grid использует `auto-fill`, поэтому на широком экране способен дать 5+ карточек.

## Целевое решение для публичной витрины

Public Projects Grid:

- 1 колонка: 320–359 CSS px;
- 2: 360–899;
- 3: 900–1199;
- 4: ≥1200;
- максимум 4 в основном режиме.

---

# 11. GAP-анализ

| Функция | Сейчас | Цель | Решение |
|---|---|---|---|
| Публичный каталог | Gallery | Полноценные «Проекты» | Развить Gallery |
| Детальная страница | Есть | Богатая project page | Расширить GalleryWork |
| 4-колоночная сетка | Нет гарантии | max 4 | Новый public grid |
| Поиск | Ограниченный | Название/автор/теги | Расширить API |
| Категории | Module filter | Тематические категории | Проекция module/tags |
| Featured | editor choice | Редакционный блок | Reuse editor choice |
| Реакции | like/wow | Сохранить | Reuse |
| Комментарии | Нет намеренно | Да | После moderation |
| Сохранение | Collections | Save to collection | Reuse |
| Copy/remix | Есть | «Сделать свою версию» | Reuse backend |
| Provenance | Есть | Обязательно | Сохранить |
| License | Есть | Обязательно | Сохранить |
| Preview | PNG | + interactive viewer | Public artifacts |
| 3D viewer | В редакторе | Public read-only | Adapter |
| Electronics sim | В модуле | Public read-only | Adapter |
| Фото/видео | Недостаточно | Media gallery | Additive subsystem |
| Публичный draft | Нет полноценного | Да | Publication draft/revisions |
| История публикации | Нет | Да | Additive model |
| Модерация UGC | Недостаточно | Reports/cases/actions | Новый foundation |
| Views/launches | Недостаточно | Да | Analytics/projection |
| Студии | Нет полноценного | Позже | Отдельный этап |

---

# 12. Целевая frontend-архитектура

Не создавать один гигантский `GalleryPage`.

Рекомендуемая структура:

```text
apps/web/src/projects-public/
  ProjectsDiscoveryPage.tsx
  PublicProjectPage.tsx
  components/
    ProjectsSearch.tsx
    ProjectCategoryChips.tsx
    ProjectsSort.tsx
    FeaturedProject.tsx
    PublicProjectCard.tsx
    PublicProjectsGrid.tsx
    ProjectAuthorLine.tsx
    ProjectSocialSignals.tsx
    ProjectActions.tsx
    ProjectMediaTabs.tsx
    ProjectDetailsPanel.tsx
    ProjectLicense.tsx
    ProjectProvenance.tsx
    ProjectRelatedContent.tsx
  viewers/
    PublicProjectViewer.tsx
    StaticPreviewViewer.tsx
    ThreeDPublicViewer.tsx
    ElectronicsPublicViewer.tsx
    BlockPublicViewer.tsx
    GamePublicViewer.tsx
    GraphicsPublicViewer.tsx
```

Имена допускается адаптировать к conventions репозитория, но публичный контур должен быть отделён от internal Project Hub.

---

# 13. Рефактор текущих страниц

## `GalleryPage.tsx`

На этапе миграции:
- становится route-wrapper либо постепенно переносит UI в новый public module;
- сохраняет API совместимость;
- не теряет текущие реакции и owner actions.

## `GalleryWorkPage.tsx`

Постепенно становится wrapper для `PublicProjectPage`.

Существующие функции нельзя потерять:
- copy;
- collections;
- reactions;
- license;
- provenance;
- description;
- tags;
- part summary;
- unavailable state.

---

# 14. Data contract карточки

Минимальная модель:

```ts
type PublicProjectCardModel = {
  projectId: string;
  title: string;
  moduleKey: string;
  moduleName: string;
  author: {
    id?: string;
    label: string;
    avatarUrl?: string;
    kind?: 'user' | 'teacher' | 'studio' | 'organization' | 'asa-lab';
  };
  preview: {
    kind: 'image';
    url: string;
    revision: number;
    alt: string;
  };
  publishedAt: string;
  metrics: {
    likeCount: number;
    wowCount?: number;
    copyCount?: number;
    viewCount?: number;
  };
  badges?: readonly PublicProjectBadge[];
  editorsChoice?: boolean;
};
```

Не включать в карточку:
- raw snapshot;
- полное описание;
- код;
- classroom refs;
- private notes.

---

# 15. Контракт визуала карточки

Требования UI/UX spec становятся acceptance criteria:

- visual = 65–72% карточки;
- title ≤ 2 строк;
- description = 0 строк;
- author = 1 строка;
- metrics = 1 строка;
- badges ≤ 2;
- не более одного заметного overlay-action;
- desktop max 4 columns;
- mobile 2 columns от 360 px;
- touch target ≥44×44.

Эти правила должны проверяться visual/E2E тестами.

---

# 16. Featured project

На первом этапе не создавать новый editorial backend.

Переиспользовать существующий `editorsChoice`.

Алгоритм:
1. взять подходящую public работу с `editorsChoice`;
2. выбрать одну по детерминированному правилу;
3. не повторять её среди первых карточек сетки;
4. если editor choice нет — блок не показывать либо использовать документированный fallback.

Высота desktop: 190–240 px.

---

# 17. Поиск

## Этап 1

Server-side search без внешней поисковой инфраструктуры.

Искать по:
- title;
- description;
- tags;
- author label;
- module.

Параметры:
- `q`;
- `module`;
- `sort`;
- `cursor`.

Не вводить в первой версии:
- Elasticsearch;
- OpenSearch;
- vector search;
- ML-персонализацию.

PostgreSQL достаточно до доказанной нагрузки.

---

# 18. Pagination

Не загружать весь каталог.

Предпочтительно:
- cursor pagination;
- 20–24 элемента за batch;
- `Показать ещё` либо controlled infinite scrolling.

API отдаёт:
- `items`;
- `nextCursor`.

---

# 19. Public interactive viewer: главное ограничение безопасности

**Нельзя сделать public viewer, просто отдав browser raw snapshot рабочего проекта.**

Существующая Gallery специально этого не делает.

Вводится понятие:

## Public Viewer Artifact

Санитизированное read-only представление выбранной опубликованной версии проекта.

Требования:
- создаётся/валидируется сервером;
- versioned schema;
- не содержит private metadata;
- не содержит classroom-only данных;
- не содержит секретов/токенов;
- не содержит private notes;
- не даёт write capability;
- имеет лимиты размера;
- проходит module-specific sanitizer.

---

# 20. Viewer adapters

## 20.1. 3D

Public artifact содержит только данные, необходимые для read-only визуализации.

Viewer:
- rotate;
- zoom;
- reset;
- fullscreen;
- optional predefined views;
- optional exploded view.

Не использовать полный editor runtime, если public viewer может быть легче.

## 20.2. Electronics

Artifact содержит безопасное описание публичной схемы и разрешённой симуляции.

Viewer:
- схема read-only;
- run/stop/reset;
- runtime limits;
- code read-only только если автор разрешил публикацию кода;
- sensor/output projection.

## 20.3. Block programming

- read-only blocks;
- run output;
- без write операций в source project.

## 20.4. Games

- runnable packaged/public state;
- fullscreen;
- controls help;
- sandboxed execution.

---

# 21. Public artifact service

Рекомендуемый backend service:

```text
PublicProjectArtifactService
  build(projectId, snapshotRevision)
  validate(...)
  sanitize(...)
  publish(...)
  getPublicArtifact(...)
```

Модульные adapters:

```text
ThreeDPublicArtifactAdapter
ElectronicsPublicArtifactAdapter
BlocksPublicArtifactAdapter
GamePublicArtifactAdapter
GraphicsPublicArtifactAdapter
```

Это предпочтительнее большого `if module === ...` в Gallery controller.

---

# 22. Публикация и immutable snapshot

Существующий publish уже связывает публичную работу с `snapshotRevision`.

Сохранить принцип:

> публичная версия всегда указывает на конкретную проверенную версию рабочего проекта.

Изменение рабочей модели не должно автоматически менять публичную работу.

Если есть более новая версия, владелец видит:

**«Есть более новая рабочая версия»**

и выбирает:
- обновить public snapshot;
- оставить текущий.

---

# 23. Публичный draft и редакции

Текущий working draft Project Hub нельзя использовать как draft публичного текста.

Нужно additive ввести отдельный publication draft.

Концептуальные сущности:

```text
PublicProjectPublication
PublicProjectPublicationDraft
PublicProjectPublicationRevision
```

Точные названия таблиц определяются после M0 schema audit.

Draft хранит:
- title override;
- short description;
- long description;
- category/topic metadata;
- cover media id;
- ordered media;
- comments enabled;
- download policy;
- remix/copy policy;
- selected snapshot revision;
- publish visibility.

После `Опубликовать изменения` создаётся immutable revision.

Restore создаёт новую revision на основе старой и не переписывает историю.

---

# 24. Не дублировать Project properties

Перед созданием новых полей проверить текущий `ProjectProperties`.

Если description, tags, license или visibility уже являются source of truth, первая миграция должна либо переиспользовать их, либо явно определить момент переноса ownership в publication metadata.

Запрещено иметь два равноправных изменяемых `description` без resolver rules.

---

# 25. Медиа проекта

Добавляется публичная media subsystem.

Типы:
- cover;
- image;
- physical-result image;
- video;
- video poster;
- позднее document/file.

Минимальная связь publication-media:

```text
publication_id
media_id
kind
sort_order
caption
alt_text
created_by
created_at
moderation_state
```

Media object хранит:
- storage key;
- MIME;
- size;
- width/height;
- duration для video;
- checksum;
- processing state.

---

# 26. Обработка изображений

При загрузке:

1. проверить MIME;
2. проверить размер;
3. безопасно декодировать;
4. удалить ненужные/опасные metadata;
5. построить responsive variants;
6. thumbnail;
7. AVIF/WebP + fallback;
8. сохранить dimensions;
9. moderation scan при наличии.

Frontend использует `srcset`, `sizes`, lazy loading и фиксированный aspect ratio.

---

# 27. Видео

Видео проекта вводится только при наличии понятного processing/storage pipeline.

Требования:
- лимит размера;
- разрешённые MIME;
- server processing;
- poster;
- ограничение длительности;
- moderation.

Если pipeline не готов, media milestone начинается с изображений, а video feature flag остаётся выключенным.

---

# 28. Скачивание файлов

Download показывается только если:
- файл разрешён к публикации;
- автор разрешил скачивание;
- лицензия допускает действие;
- модуль разрешает export этого формата.

Нельзя автоматически раздавать внутренний raw snapshot.

3D STL/STEP и другие форматы проходят отдельный export flow.

---

# 29. Copy / «Сделать свою версию»

Первая версия обязана переиспользовать существующий Gallery copy endpoint.

UX label: **«Сделать свою версию»**.

После операции:
1. сервер создаёт private copy;
2. provenance сохраняется;
3. пользователь получает подтверждение;
4. предлагается открыть копию в инструменте или перейти в `Мои проекты`.

Это действие не является «Скачать».

---

# 30. Provenance

Происхождение копии — обязательный инвариант.

Публичная страница копии показывает:

> Основано на проекте «…» автора «…»

Если источник скрыт, provenance metadata сохраняется, но UI не раскрывает запрещённые/private детали.

---

# 31. License

Существующие лицензии сохранить:

- Все права защищены;
- Public domain;
- CC BY;
- CC BY-SA;
- CC BY-NC.

Перед download/remix проверять совместимость лицензии с действием.

На карточке лицензию не показывать. На странице проекта — компактная строка + справка.

---

# 32. Views и engagement

Целевые события:

- project_impression;
- project_open;
- viewer_start;
- viewer_interaction;
- viewer_fullscreen;
- project_like;
- project_wow;
- project_save;
- project_copy;
- project_open_editor;
- project_download;
- comment_create;
- share;
- search;
- filter_apply.

View count не увеличивается на каждый rerender. Нужна документированная dedup-policy.

Analytics не блокирует основную функцию.

---

# 33. Комментарии: только после moderation foundation

Перед комментариями реализовать:

1. reports;
2. moderation cases;
3. moderation actions;
4. audit log;
5. rate limiting;
6. permission checks;
7. hide/delete semantics;
8. abuse handling;
9. owner moderation boundaries.

Только после этого включать `projects_comments`.

---

# 34. Comments model

Минимально:

```text
project_publication_id
comment_id
author_id
parent_comment_id nullable
body
status
created_at
updated_at
```

Статусы:
- visible;
- hidden_by_owner;
- hidden_by_moderator;
- deleted_by_author;
- removed.

Нужны:
- thread depth limit;
- body size limit;
- XSS-safe rendering;
- report comment;
- rate limit.

---

# 35. Reports

Пожаловаться можно на:
- проект;
- изображение/видео;
- комментарий.

Причины:
- спам;
- оскорбление;
- опасный контент;
- персональные данные;
- нарушение авторских прав;
- другое.

Одна жалоба не скрывает проект автоматически.

---

# 36. Moderation case

Нужно отделить сигнал от решения.

`Report` — входной сигнал.  
`ModerationCase` — работа модератора.  
`ModerationAction` — конкретное действие.

Действия:
- no_action;
- request_changes;
- hide_media;
- remove_from_discovery;
- hide_publication;
- block_publication;
- restore.

Все platform actions пишутся в audit.

---

# 37. «Требуются изменения»

Автор видит:
- причину;
- какие media/поля затронуты;
- что нужно исправить;
- можно ли редактировать;
- кнопку повторной отправки.

Модератор не переписывает авторский текст сам, кроме технических/экстренных platform operations.

---

# 38. Permissions

Backend — единственный источник авторизации.

Frontend hide/show кнопок — только UX.

Субъекты:
- guest;
- authenticated user;
- owner;
- publication editor;
- studio member;
- moderator;
- platform admin.

Права редактора задаются explicit ACL, а не `isTeacher`.

---

# 39. Studios / coauthors

Полноценные Studios не обязательны в первом этапе, если домена ещё нет.

Но архитектура ownership не должна запрещать будущий вариант:
- user owner;
- organization/studio owner;
- editors ACL.

Первый релиз может оставить owner = user.

---

# 40. Search and topics

В P0 не вводить отдельный глобальный social-topic domain.

Первый этап использует:
- module;
- existing tags;
- normalized category projection.

После появления статей/курсов Topics можно унифицировать между Projects и Knowledge отдельным ADR.

---

# 41. Связь с Knowledge

На странице проекта нужен блок:

**Хотите сделать похожее?**

Источник рекомендаций первого этапа:
- module key;
- tags;
- explicit links.

Можно показывать:
- задание;
- курс;
- статью.

ML recommender не нужен.

---

# 42. Performance budget каталога

- первая выдача 20–24 карточки;
- изображения lazy после первого viewport;
- никакого массового WebGL;
- никакой массовой simulation runtime;
- минимизировать JS карточки;
- skeleton совпадает с final geometry;
- не допускать CLS изображений.

---

# 43. Public viewer performance

Viewer загружается только после открытия проекта.

Module viewer code:
- lazy chunk;
- без editor-only panels;
- без authoring libraries, если не нужны;
- cleanup GPU/runtime после ухода.

Mobile по возможности сначала показывает статический preview до явного запуска.

---

# 44. Responsive contract

Normative — `ASA_PROJECTS_UI_UX_SPEC.md`.

Breakpoints:
- 320–359: 1 card;
- 360–899: 2;
- 900–1199: 3;
- ≥1200: 4.

Большие экраны:
- max content width;
- 4 columns;
- не увеличивать число колонок до 5–8.

Контрольные viewport:
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

---

# 45. Accessibility

Обязательно:
- keyboard;
- logical focus;
- visible focus;
- aria-label для icon buttons;
- alt;
- reduced-motion;
- WCAG AA contrast;
- page zoom 200%;
- viewer operations не только мышью;
- mobile controls ≥44×44.

---

# 46. Existing UI components to reuse

Проверить и по возможности переиспользовать:
- `CollectPicker`;
- `ShareDialog`;
- Portal shell/header;
- module badges;
- avatar patterns;
- existing preview image endpoint;
- Project preview styles, где они соответствуют public UI;
- loading/error components UI kit.

Не копировать компонент только ради другого имени.

---

# 47. API: этап совместимости

Первый rollout сохраняет namespace `/api/gallery`.

Существующие endpoints сохраняются, а list расширяется additive query params:

```text
GET /api/gallery
  q?
  module?
  sort?
  cursor?
  limit?

GET  /api/gallery/:projectId
GET  /api/gallery/:projectId/image
POST /api/gallery/:projectId/reactions/:kind
POST /api/gallery/:projectId/copy
POST /api/gallery/:projectId/unpublish
POST /api/gallery/:projectId/publish
```

Не делать массовое переименование `/api/gallery` → `/api/projects` одновременно с UI rewrite.

---

# 48. Новые API — Public viewer

Пример целевого API:

```text
GET /api/gallery/:projectId/public-artifact
GET /api/gallery/:projectId/media
```

или отдельный public namespace. Окончательное имя фиксируется API ADR.

Artifact response:
- schema version;
- module key;
- artifact version;
- read-only payload;
- capabilities: canRun, canRotate, canFullscreen, codeVisible, downloadAvailable.

---

# 49. Новые API — publication editing

Owner/editor only:

```text
GET  /api/gallery/:projectId/publication-draft
PUT  /api/gallery/:projectId/publication-draft
POST /api/gallery/:projectId/publication-draft/preview
POST /api/gallery/:projectId/publication-draft/publish
GET  /api/gallery/:projectId/publication-revisions
POST /api/gallery/:projectId/publication-revisions/:revisionId/restore
```

Все write endpoints:
- auth;
- ownership/ACL;
- validation;
- audit.

---

# 50. Новые API — media

Пример:

```text
POST   /api/gallery/:projectId/media
PATCH  /api/gallery/:projectId/media/:mediaId
DELETE /api/gallery/:projectId/media/:mediaId
POST   /api/gallery/:projectId/media/reorder
```

Direct upload/presigned flow выбирается после проверки текущей storage architecture.

---

# 51. Новые API — comments/moderation

Только после moderation foundation:

```text
GET  /api/gallery/:projectId/comments
POST /api/gallery/:projectId/comments
POST /api/gallery/comments/:commentId/replies
POST /api/gallery/comments/:commentId/report
POST /api/gallery/:projectId/report
```

Moderator namespace отделяется от author actions.

---

# 52. Миграции БД

Все изменения additive.

Запрещено:
- destructive rename старых Gallery tables/functions в первом релизе;
- удаление current publication/provenance;
- backfill, меняющий semantic ownership существующих проектов.

Каждая migration должна содержать:
- rollback/forward strategy;
- indexes;
- FK policy;
- authorization/RLS contract;
- отдельный план большого backfill, если нужен.

---

# 53. M0 — обязательный schema audit

До первой миграции исполнитель обязан:

1. найти точные таблицы/functions Gallery;
2. зафиксировать текущую схему publication/reaction/copy;
3. найти ProjectProperties source of truth;
4. найти exact storage Collections;
5. проверить visibility `private/link/public`;
6. проверить snapshot revision semantics;
7. проверить provenance storage;
8. проверить indexes;
9. проверить authorization boundary/RLS;
10. составить ERD AS-IS.

Deliverable:
`docs/product/ASA_PROJECTS_CURRENT_ARCHITECTURE_AUDIT.md`

Без M0 запрещено создавать параллельные таблицы `likes`, `bookmarks`, `project_posts`.

---

# 54. Этапы реализации

## M0 — Current Architecture Audit

**Цель:** подтвердить точную схему без изменения production behavior.

Работы:
- DB/schema/functions;
- routes;
- API contracts;
- current E2E;
- permissions;
- project lifecycle;
- gallery/collections.

Acceptance:
- документ аудита;
- список reuse;
- список gaps;
- отсутствие production changes.

## M1 — Public Projects Catalog UI

**Цель:** превратить Gallery discovery в согласованную страницу «Проекты» без фундаментального backend rewrite.

Работы:
- новый визуальный каталог;
- max 4-column grid;
- search UI;
- category chips;
- sort;
- featured editor choice;
- responsive contract;
- real previews;
- mobile;
- loading/error/empty.

Backend:
- additive search/cursor params при необходимости.

Не делать:
- comments;
- media uploads;
- interactive viewer.

Acceptance:
- существующие Gallery items отображаются;
- like/wow работают;
- public/private semantics не меняются;
- 4 columns max;
- mobile QA проходит;
- старые links работают.

## M2 — Public Project Detail

**Цель:** полноценная страница проекта на существующих данных.

Работы:
- новый detail layout;
- current static preview;
- author;
- description;
- tags;
- license;
- provenance;
- part summary;
- collections/save;
- share;
- copy → «Сделать свою версию»;
- unavailable state;
- owner unpublish.

Acceptance:
- ни одна функция GalleryWork не потеряна;
- copy сохраняет provenance;
- collections переиспользованы;
- mobile/desktop соответствуют spec.

## M3 — Safe Interactive Viewer

**Цель:** живой read-only просмотр без раскрытия raw snapshot.

### M3.1 — artifact contract
- schema;
- sanitizer;
- service;
- security tests.

### M3.2 — 3D
- public read-only viewer;
- rotate/zoom/fullscreen.

### M3.3 — Electronics
- read-only schematic;
- safe simulation.

### M3.4 — Blocks/Games
- по мере готовности модулей.

Acceptance:
- public browser не получает raw project document;
- sanitizer tests;
- no write operations;
- runtime limits;
- viewers lazy loaded.

## M4 — Publication Editing, Media and Revisions

**Цель:** владелец улучшает публичную страницу независимо от working project.

Работы:
- publication draft;
- autosave;
- preview;
- publish revision;
- revision history;
- restore;
- cover;
- image gallery;
- physical-result media;
- selected published snapshot;
- media processing.

Acceptance:
- draft не меняет public page;
- publish атомарно создаёт revision;
- restore создаёт новую revision;
- working newer snapshot не публикуется автоматически;
- owner может добавить фото печати с телефона.

## M5 — Moderation Foundation

**Цель:** безопасно открыть социальные функции.

Работы:
- reports;
- moderation cases;
- actions;
- audit;
- request changes;
- media restriction;
- hide from discovery;
- publication block;
- rate limits.

Acceptance:
- moderator cannot silently author-edit;
- every action audited;
- owner sees reason;
- resubmission works;
- one report does not auto-delete.

## M6 — Comments

Зависит от M5.

Работы:
- comments;
- replies;
- owner moderation;
- moderator moderation;
- reporting;
- rate limit;
- mobile UI.

Acceptance:
- comments can be disabled;
- report works;
- owner/moderator hide have distinct states;
- XSS tests;
- permissions tests.

## M7 — Discovery Metrics and Refinement

Работы:
- view/open/run/save/copy metrics;
- additional sort modes;
- related projects;
- links to Knowledge;
- performance tuning;
- featured logic.

ML recommender не включать до накопления реальных данных.

---

# 55. Feature flags

Рекомендуемые flags:

```text
projects_public_v2
projects_public_viewer_3d
projects_public_viewer_electronics
projects_public_media
projects_public_revision_editor
projects_comments
projects_moderation
```

Это позволяет откатывать новый UI/runtime без отката Project Hub.

---

# 56. Rollback

## M1/M2
Flag возвращает старые Gallery pages.

## M3
Viewer fallback → existing PNG preview.

## M4
Public page остаётся на последней опубликованной revision; draft feature может быть выключен.

## M5/M6
Comments могут быть read-disabled; moderation data сохраняется.

Rollback не удаляет пользовательские данные.

---

# 57. Тестирование

## Unit

- search normalization;
- public card mapper;
- sanitizer;
- license mapping;
- permission decisions;
- revision logic;
- moderation transitions.

## API integration

- anonymous public list/detail;
- private unavailable;
- owner publish/unpublish;
- reaction;
- copy;
- collections;
- artifact access;
- media ACL;
- draft ACL;
- moderation ACL.

## E2E

### Catalog
- открыть Projects;
- фильтр;
- поиск;
- sort;
- открыть item.

### Copy
- A публикует;
- B копирует;
- B получает private copy;
- provenance указывает на A.

### Owner edit
- owner меняет draft;
- visitor видит старую revision;
- owner публикует;
- visitor видит новую.

### Moderation
- report;
- request changes;
- owner fixes;
- resubmit;
- restore.

### Responsive
Все ключевые viewports из UI/UX spec.

---

# 58. Security tests

Обязательно:
- нельзя получить raw snapshot anonymous;
- нельзя скопировать unpublished/private work;
- нельзя редактировать чужую публикацию;
- editor не меняет owner;
- moderator не использует owner-edit endpoint;
- media URL не обходит visibility;
- restricted media перестаёт быть public;
- comments XSS safe;
- report rate limited;
- artifact size/depth limits;
- electronics/game runtime constrained.

---

# 59. Performance tests

Проверить:
- 24-card first batch;
- slow network;
- no image CLS;
- memory после viewer open/close;
- GPU cleanup 3D;
- simulation cleanup;
- image variants;
- 4K viewport;
- low-end mobile.

Grid должен оставаться usable без интерактивных preview.

---

# 60. Observability

Новые backend flows:
- structured logs;
- correlation;
- error metrics;
- publish failures;
- artifact build failures;
- media processing failures;
- moderation actions;
- viewer load errors.

Не логировать:
- private raw project document;
- sensitive user data;
- tokens.

---

# 61. Analytics events

Минимум:

```text
projects_discovery_open
projects_search
projects_filter
project_card_impression
project_public_open
project_reaction
project_save
project_copy
project_viewer_start
project_viewer_interact
project_open_in_editor
project_share
project_download
```

Позже — comment/moderation funnel.

Analytics schema versioned.

---

# 62. Definition of Done: каталог

Каталог готов, если:
- соответствует UI/UX spec;
- max 4 columns desktop;
- 2 mobile 360+;
- card visual-dominant;
- search/filter/sort server-backed;
- no raw data;
- existing reactions работают;
- owner actions работают;
- accessibility checks;
- QA viewports;
- performance gate;
- no regression My Projects/Classroom Projects.

---

# 63. Definition of Done: public detail

Готов, если:
- отдельный stable URL;
- direct reload;
- static preview fallback;
- author;
- description;
- tags;
- license;
- provenance;
- collections;
- share;
- copy/remix;
- responsive;
- unavailable state;
- owner controls;
- zero raw snapshot exposure.

---

# 64. Definition of Done: interactive viewer

Готов модульно, если:
- artifact generated server-side;
- sanitizer covered tests;
- viewer cannot mutate source;
- copy uses server flow;
- lazy load;
- cleanup;
- mobile controls;
- fallback preview;
- no security regression.

---

# 65. Definition of Done: publication editor

Готов, если:
- autosaved public draft;
- preview;
- publish;
- revision history;
- restore;
- media order;
- cover;
- selected working snapshot;
- permission model;
- mobile basic edit;
- public state does not change before publish.

---

# 66. Definition of Done: comments

Готовы только если одновременно готовы:
- reports;
- moderator actions;
- audit;
- rate limits;
- owner boundaries;
- XSS/abuse tests;
- mobile UI;
- disable-comments setting.

---

# 67. Вероятно затрагиваемые файлы

## Frontend
- `apps/web/src/pages/GalleryPage.tsx`;
- `apps/web/src/pages/GalleryWorkPage.tsx`;
- `apps/web/src/creator-portal/navigation.ts`;
- `apps/web/src/App.tsx`;
- `apps/web/src/api.ts`;
- Portal header/navigation components;
- `CollectPicker`;
- `ShareDialog`;
- новые `apps/web/src/projects-public/**`.

## Backend
- `apps/api/src/gallery.controller.ts`;
- новый public-project service/artifact service;
- media service/controller;
- moderation service/controller;
- comments service/controller.

## DB
Точные migration paths/entity names определяются после M0 audit.

---

# 68. Что НЕ переписывать ради этой задачи

Без отдельной причины не переписывать:
- `MyProjectsPage.tsx`;
- classroom `ProjectsPage.tsx`;
- core module editors;
- working project draft/version system;
- Collections domain;
- current copy/provenance implementation.

Интеграция через существующие contracts и новые adapters.

---

# 69. Правила экономичной разработки для ботов

Каждый этап обязан:

1. начинаться с чтения этого ТЗ и UI/UX spec;
2. читать только затрагиваемые contracts;
3. переиспользовать существующий код;
4. не делать broad refactor «заодно»;
5. не переименовывать Gallery backend без необходимости;
6. не добавлять dependency без доказанной необходимости;
7. менять один доменный слой за milestone;
8. добавлять тест вместе с поведением;
9. документировать divergence;
10. при конфликте архитектуры останавливать этап и фиксировать проблему, а не создавать вторую систему.

---

# 70. Запрещённые архитектурные решения

Нельзя принимать PR, который:

- создаёт `projects_v2` как параллельный Project domain;
- создаёт bookmarks при существующих Collections;
- создаёт новый copy endpoint без provenance;
- отдаёт raw snapshots публично;
- хранит media binary в JSON;
- делает comments без moderation;
- использует browser role checks вместо backend authorization;
- загружает editor runtime в каждую карточку;
- создаёт 5+ колонок в public catalog;
- смешивает classroom Projects и public Projects;
- автоматически публикует незавершённый working draft;
- удаляет старые Gallery URLs одним релизом.

---

# 71. Приоритеты

## P0 — обязательно
- M0 audit;
- catalog redesign;
- detail redesign;
- route semantics;
- existing reactions;
- Collections;
- copy/provenance;
- responsive;
- accessibility;
- security.

## P1 — высокая ценность
- safe 3D viewer;
- safe electronics viewer;
- media gallery;
- public draft/revisions;
- physical-result photos;
- views/launch analytics.

## P2 — после foundation
- moderation;
- comments;
- richer recommendations;
- author/studio expansion.

## P3 — позже
- full studio collaboration;
- public reputation;
- personalized recommender;
- advanced ranking;
- TV/presentation mode.

---

# 72. Открытые решения

До соответствующих milestones отдельно подтвердить:

1. Какой canonical public URL принять?
2. Оставлять ли `Ого` видимой реакцией?
3. Может ли anonymous видеть Projects без входа?
4. Какие 3D-файлы разрешены к download?
5. Может ли автор полностью запретить copy/remix?
6. Какой default license?
7. Лимиты video?
8. Возрастные/школьные ограничения public publication?
9. Нужна ли school-level premoderation?
10. Когда вводить Studio ownership?
11. Кто может комментировать?
12. Какая публичная проекция допустима для несовершеннолетнего автора?

Эти вопросы не блокируют M1–M2 при сохранении текущего безопасного поведения.

---

# 73. Критический вывод аудита

Текущее состояние AsaLab уже содержит значительную часть технического фундамента.

**Уже есть:**
- Project domain;
- working lifecycle;
- публичная Gallery;
- публикация;
- безопасное статическое preview;
- реакции;
- editor choice;
- copy;
- provenance;
- license;
- Collections;
- visibility;
- versions/drafts рабочего проекта;
- отдельный URL публичной работы.

**Главные недостающие блоки:**
- целевой discovery UI;
- полноценный search;
- гарантированная responsive-grid модель;
- безопасные интерактивные public viewers;
- media gallery;
- отдельный public publication draft/revisions;
- views/engagement;
- moderation foundation;
- comments;
- studio/coauthor model.

Следовательно, задача — **не новый продукт с нуля**, а аккуратная конвергенция существующих механизмов в полноценную публичную поверхность.

---

# 74. Итоговый принцип реализации

Любое новое решение сначала должно отвечать на вопрос:

> **Есть ли уже в AsaLab сущность или механизм, который решает эту часть задачи?**

Если да — он расширяется.

Новая сущность создаётся только там, где действительно появляется новое семантическое состояние:
- public artifact;
- public media;
- public draft/revision;
- report/moderation;
- comments.

Именно такой подход позволяет получить достойный раздел «Проекты» без второй параллельной архитектуры и без разрушения уже работающего Project Hub.
