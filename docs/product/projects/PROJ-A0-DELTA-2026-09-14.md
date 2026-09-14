# PROJ-A0 Delta Audit — 2026-09-14

**Статус:** VERIFIED / documentation-only  
**Предыдущий полный audit baseline:** `main@b31e113a19f6234a0504ff6bade991294b10d38b`  
**Проверенный current main:** `main@247e4a96f317dd0693629b0a61f90f1414a524b1`  
**Documentation branch HEAD до этой записи:** `701b719554184563307c5a9e0db64b47a43353c0`  
**Полный аудит:** `../ASA_PROJECTS_CURRENT_ARCHITECTURE_AUDIT.md`  
**TARGET:** `../ASA_PROJECTS_IMPLEMENTATION_TZ.md`

---

# 0. Вывод

Полный `PROJ-A0` остаётся архитектурно действительным.

Между `b31e113...` и `247e4a9...` в `main` прошло **59 commits**, но проверенные production paths, определяющие текущую Public Projects / Gallery семантику, не изменились:

- `apps/api/src/gallery.controller.ts`;
- `apps/api/src/collections.controller.ts`;
- `apps/web/src/pages/GalleryPage.tsx`;
- `apps/web/src/pages/GalleryWorkPage.tsx`;
- `contexts/projects/domain/project.ts`;
- `migrations/0046_gallery.sql`;
- `migrations/0048_gallery_open_and_copy.sql`;
- `migrations/0051_collections.sql`;
- `migrations/0052_project_properties.sql`;
- `e2e/gallery.spec.ts`.

Следовательно, целевая декомпозиция и решения `REUSE / MODIFY / BUILD / DO-NOT-TOUCH` в `ASA_PROJECTS_IMPLEMENTATION_TZ.md` сохраняются.

**R7 coding этим документом не активируется.**

---

# 1. Что изменилось после прошлого audit baseline

Compare `b31e113... → 247e4a9...` показывает изменения главным образом в:

- Learning/Courses/Gradebook;
- Scratch / Visual Programming;
- agent/governance infrastructure;
- документации;
- shared web/API files.

Из путей, пересекающихся с projects lane, менялись:

- `apps/web/src/App.tsx`;
- `apps/web/src/api.ts`;
- `apps/web/src/components/PortalHeader.tsx`;
- `apps/web/src/modules/project-hub.css`.

Они были повторно просмотрены как shared integration surface. Нового Public Projects publication model, нового Gallery persistence, comments/moderation subsystem или нового public artifact contract этими изменениями не введено.

---

# 2. Повторно подтверждённый AS-IS

## 2.1. Project Core уже существует

`contexts/projects/domain/project.ts` по-прежнему определяет module-neutral Project, отдельный mutable `ProjectDraft` и `ProjectVersion`.

Публичная подсистема не должна создавать второй Working Project model, второй draft stack или второй version stack.

**Решение:** `REUSE / DO-NOT-DUPLICATE`.

## 2.2. Gallery всё ещё требует сессию viewer

`GalleryController.requireViewer()` принимает Account либо StudentSeat session и возвращает `401`, если активной сессии нет.

Следовательно, текущий Gallery **не поддерживает anonymous public read**.

**Target:** anonymous eligible public metadata/page read строится отдельным sanitized contract; нельзя просто снять auth guard со старого endpoint.

## 2.3. Gallery detail всё ещё отдаёт mutable Working Draft

`GET /api/gallery/:projectId/work` вызывает `gallery_work()` и возвращает клиенту `document_json` как `work.document`.

`gallery_work()` в migration `0048/0052` берёт этот JSON через:

```sql
LEFT JOIN public.project_drafts d ON d.project_id = pub.project_id
```

`GalleryWorkPage.tsx` затем клиентски обходит `work.document`, чтобы построить блок «Из чего собрано».

Следовательно:

- live public detail зависит от текущего mutable draft;
- после публикации Working Draft может измениться без новой публичной редакции;
- raw module document сейчас является частью Gallery detail payload;
- это нельзя делать anonymous contract простым расширением существующего endpoint.

**Решение:** `MODIFY` в R7; public detail должен читать immutable PublicationRevision + safe module artifact.

## 2.4. Publish всё ещё привязан к snapshot revision, а не ProjectVersion

`project_publications` хранит `snapshot_revision`.

`gallery_publish()`:

- проверяет publisher;
- требует `project_snapshots.source_revision`;
- делает UPSERT одной publication row;
- не выбирает exact `project_versions.id`.

Snapshot остаётся preview/fallback и не является canonical immutable source публикации.

**Решение:** `MODIFY` — PublicationRevision обязан ссылаться на exact `ProjectVersion`.

## 2.5. Unpublish всё ещё destructive для текущего social state

`gallery_unpublish()` удаляет `project_publications` row.

`project_reactions.project_id` ссылается на publication с `ON DELETE CASCADE`.

Следовательно, current unpublish физически удаляет reaction state.

**Target:** revoke/unpublish прекращает доступ, но не уничтожает Project, ProjectVersion и immutable publication history. Retention/migration существующих reactions должен быть явным решением, а не побочным эффектом DELETE.

## 2.6. Copy/remix по-прежнему берёт current draft

`gallery_copy_to_projects()` читает:

```sql
SELECT d.document_json
FROM public.project_drafts d
WHERE d.project_id = p_project_id;
```

и создаёт новый независимый personal Project с permanent provenance.

Сама copy/provenance модель полезна и должна быть сохранена.

**Решение:** `MODIFY`, не rebuild — source меняется на exact `ProjectVersion`, связанный с live PublicationRevision.

## 2.7. Collections существуют и пригодны для переиспользования

`collections` / `collection_items` и `/api/collections` уже поддерживают:

- персональные подборки;
- create/rename/delete;
- add/remove;
- holding lookup;
- сохранение опубликованной чужой работы;
- сохранение собственного Project после migration 0052.

**Решение:** `REUSE`; отдельные bookmarks/favorites не создавать.

## 2.8. Текущий каталог очень уже целевого

`GalleryPage.tsx` сегодня даёт:

- `Новые / Популярные`;
- module `<select>`;
- статический preview;
- title;
- author;
- date/module metadata;
- `like` / `wow`;
- teacher `Выбор редакции`;
- owner remove/unpublish.

Но не даёт target уровня:

- server-backed text search;
- тематических chips/categories;
- max-4 canonical responsive grid contract;
- rich type-specific preview;
- public anonymous discovery;
- moderation/comments;
- rich public author/studio projection.

**Решение:** existing Gallery — база миграции, не финальный Public Projects UI.

## 2.9. Current detail уже содержит полезные механики

`GalleryWorkPage.tsx` уже предоставляет:

- отдельную страницу работы;
- preview;
- автора;
- description/tags/license;
- copy provenance;
- `like` / `wow`;
- «Добавить к себе»;
- Collections picker;
- copy flow;
- «Из чего собрано».

Это функциональная база, но не target viewer: интерактивный 3D/Electronics/Blocks/Game public viewer ещё должен строиться через safe module artifact contract.

## 2.10. Existing E2E — важный regression contract

`e2e/gallery.spec.ts` реально проверяет end-to-end:

1. создание Project;
2. snapshot;
3. описание/тег/license/public visibility;
4. появление в Gallery;
5. просмотр другим Account из другой школы;
6. reaction;
7. editor choice;
8. detail page;
9. copy с provenance;
10. Collections.

Этот тест нельзя выбрасывать при redesign. Его надо эволюционно адаптировать к immutable publication contract.

---

# 3. Важная коррекция документации

В `ASA_PROJECTS_IMPLEMENTATION_SPEC.md` присутствует старое утверждение в AS-IS описании backend, смысл которого сводится к тому, что Gallery «не отдаёт raw project JSON».

**Это утверждение не соответствует текущему `main`.**

Фактический current contract:

- `gallery_work()` читает `project_drafts.document_json`;
- `GalleryController.work()` возвращает его как `work.document`;
- `GalleryWorkPage` клиентски интерпретирует этот document.

При конфликте использовать в таком порядке:

1. фактический current `main`;
2. `ASA_PROJECTS_CURRENT_ARCHITECTURE_AUDIT.md` + этот delta;
3. `ASA_PROJECTS_IMPLEMENTATION_TZ.md`;
4. старые AS-IS формулировки `ASA_PROJECTS_IMPLEMENTATION_SPEC.md`.

Target-часть Implementation Spec о необходимости safe public artifact остаётся правильной.

Эту коррекцию нужно физически внести в Implementation Spec при следующей конвергенции документации; она **не является** причиной начинать product coding.

---

# 4. Shared integration check

## `App.tsx`

Current main по-прежнему различает отдельные пользовательские поверхности и импортирует:

- `MyProjectsPage`;
- classroom `ProjectsPage`;
- `GalleryPage`;
- `GalleryWorkPage`;
- `KnowledgePage`;
- `CollectionsPage`.

Это подтверждает исходный вывод: нельзя переиспользовать classroom `ProjectsPage` как публичный каталог только из-за имени, а `Мои проекты` нельзя превращать в общественную витрину.

## `api.ts`

Shared API file существенно менялся из-за Learning, но canonical Project types по-прежнему различают:

- `Project`;
- `ProjectDraft`;
- `ProjectVersion`;
- module preview metadata.

Нового public immutable PublicationRevision API в current main не появилось.

## `PortalHeader.tsx`

Shared shell двигался, но отдельную автономную шапку Public Projects вводить по-прежнему не нужно. Target использует глобальную ASA Lab shell.

## `project-hub.css`

Project Hub продолжает развиваться независимо. Public Projects должен сохранить личную семантику `Мои проекты` и не переносить discovery concerns в Project Hub.

---

# 5. Current execution blocker повторно подтверждён

По актуальному `docs/execution/current.yaml`:

- development mode = `direct_main`;
- global primary task сейчас относится к Visual Programming/Scratch;
- parallel `projects` lane по-прежнему содержит `TASK-R3B-PROJECT-LIFECYCLE-001`;
- projects checkpoint = `project_lifecycle_foundation`;
- owner acceptance = `pending`;
- PR #112 остаётся Draft/open.

Prepared Issue #211 (`PROJ-R7-01`) остаётся `PREPARED / BLOCKED`.

Следовательно:

> **Документация Public Projects готовится и валидируется, но R7 product coding сейчас не активирован.**

Нельзя менять `current.yaml` из этой documentation branch ради саморазрешения.

---

# 6. Что уже готово в документации

## Product/UI contract

`ASA_PROJECTS_UI_UX_SPEC.md`

Фиксирует:

- каталог;
- карточку;
- public detail;
- editing UX;
- permissions/moderation behavior;
- mobile/tablet/desktop;
- 2K/4K/8K scaling;
- visual density/text limits;
- accessibility/performance rules.

## Architecture / integration spec

`ASA_PROJECTS_IMPLEMENTATION_SPEC.md`

Используется как глубокая integration reference с учётом коррекции §3 этого delta.

## Executable target TZ

`ASA_PROJECTS_IMPLEMENTATION_TZ.md`

Уже декомпозирует систему на bounded slices:

- `PROJ-R7-01` Publication Foundation;
- `PROJ-R7-02` Public Project Page;
- `PROJ-R7-03` Public Artifact Contract;
- `PROJ-R7-04` Module Viewers;
- `PROJ-R7-05` Publication Editor / Media / Revisions;
- `PROJ-R8-01` Discovery Catalog;
- `PROJ-R8-02` Interactions / Profile Projection;
- `PROJ-R8-03` Moderation Foundation;
- `PROJ-R8-04` Comments;
- `PROJ-R8-05` Discovery Refinement.

Это правильная граница: нельзя реализовывать весь продукт одним mega-PR.

---

# 7. GO / NO-GO

## Documentation readiness

**GO.**

Текущего набора документов достаточно, чтобы после owner activation разрабатывать Public Projects небольшими проверяемыми срезами, не изобретая продукт заново.

## Product coding

**NO-GO сейчас.**

Причина не в недостающем ТЗ, а в execution state: R3 Project lifecycle ещё не owner-accepted, projects lane не переведён на R7.

---

# 8. Что делать при активации PROJ-R7-01

Перед первой записью product code:

1. прочитать актуальные `AGENTS.md` и `START_HERE_FOR_AI.md`;
2. восстановить current execution snapshot;
3. подтвердить owner transition в `current.yaml`;
4. сравнить тогдашний `origin/main` с `247e4a96...`;
5. если изменились Project/Gallery/Collections/Identity publication paths — выполнить новый bounded delta audit;
6. заполнить реальную `REUSE / MODIFY / BUILD / DO-NOT-TOUCH` matrix для выбранного slice;
7. реализовать только `PROJ-R7-01`;
8. focused gate + required repository/integration evidence;
9. отчёт;
10. **STOP**.

Следующий slice не стартует автоматически.
