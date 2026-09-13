# ASA Lab — Public Projects
## Current Architecture Audit / PROJ-A0

**Статус:** PROJ-A0 COMPLETE FOR BASELINE / documentation-only  
**Проверенный baseline:** `main@b31e113a19f6234a0504ff6bade991294b10d38b`  
**Дата:** 2026-09-13  
**Целевое ТЗ:** `docs/product/ASA_PROJECTS_IMPLEMENTATION_TZ.md`  
**Архитектурная спецификация:** `docs/product/ASA_PROJECTS_IMPLEMENTATION_SPEC.md`  
**Product behavior этим аудитом не изменён.**

---

# 0. Результат аудита

Public Projects не нужно строить с нуля. В `main` уже существуют:

- единый module-neutral Project Core;
- один mutable Working Draft;
- immutable ProjectVersion;
- raster snapshots/previews;
- Gallery как текущая общественная поверхность;
- публикация `public/link`;
- реакции `like/wow`;
- editor choice;
- detail page;
- copy с permanent provenance;
- Collections;
- общая ASA Lab shell с верхними «Проекты / Знания»;
- реальный Gallery E2E.

Но текущая Gallery **не является целевым R7 Public Projects contract**. Критические разрывы:

1. publication хранит `snapshot_revision`, а не exact `project_versions.id`;
2. public detail читает `document_json` из текущего mutable `project_drafts`;
3. copy/remix также копирует current mutable draft;
4. Gallery GET требует Account/StudentSeat session — anonymous public read отсутствует;
5. `unpublish` удаляет `project_publications`, reactions удаляются каскадно;
6. immutable PublicationRevision отсутствует;
7. public metadata частично живёт непосредственно на mutable `projects`;
8. project-specific revocable/expiring ShareLink не найден в проверенных Project/Gallery contracts;
9. module-specific safe public artifact contract отсутствует;
10. full Public Projects moderation/comments subsystem отсутствует;
11. discovery search по title/description/tags/author отсутствует.

**Решение:** Project Core, ProjectVersion, snapshots, provenance, Collections и shell — переиспользовать. Existing Gallery/publication слой — эволюционно модифицировать. Новые сущности добавлять только для действительно нового public state: immutable PublicationRevision, ShareLink, safe public artifact, public media, moderation/comments.

---

# 1. Как обновлён baseline

Первый аудит был выполнен на `main@3498dd2c8c2c4ce33b36d3cafa94b85dcd39009e`.

Перед этой редакцией выполнен bounded delta audit до:

`main@b31e113a19f6234a0504ff6bade991294b10d38b`.

Между baseline было 29 commits. Compare показал изменения в:

- `AGENTS.md` / `START_HERE_FOR_AI.md` / delivery workflow;
- Scratch/Visual Programming documentation/runtime preparation;
- Electronics agent documentation/plans;
- governance/agent tools;
- `package.json` gates/tooling.

**Не изменились** релевантные проверенные Public Projects production paths:

- `contexts/projects/**`;
- `apps/api/src/gallery.controller.ts`;
- `apps/api/src/collections.controller.ts`;
- `apps/web/src/pages/GalleryPage.tsx`;
- `apps/web/src/pages/GalleryWorkPage.tsx`;
- project/gallery/collections migrations;
- `e2e/gallery.spec.ts`.

Поэтому архитектурные выводы первоначального PROJ-A0 сохраняются, а baseline обновлён до `b31e113...`.

Важно: governance rules изменялись, поэтому execution всегда читает **актуальные** `AGENTS.md`, `START_HERE_FOR_AI.md` и `docs/execution/current.yaml`; этот аудит не дублирует их состояние.

---

# 2. Проверенные исходники

## Project Core

- `contexts/projects/domain/project.ts`
- `contexts/projects/application/**`
- `contexts/projects/infrastructure/**`
- `apps/api/src/projects.controller.ts`

## Database / persistence

- `migrations/0003_electronics_project_slice.sql`
- `migrations/0013_project_lifecycle.sql`
- `migrations/0025_project_snapshot.sql`
- `migrations/0046_gallery.sql`
- `migrations/0048_gallery_open_and_copy.sql`
- `migrations/0051_collections.sql`
- `migrations/0052_project_properties.sql`
- `migrations/0059_courses_and_sharing.sql` — проверено отдельно, чтобы не принять Learning `content_shares` за Project ShareLink

## Public/community API

- `apps/api/src/gallery.controller.ts`
- `apps/api/src/collections.controller.ts`

## Frontend / routing / shell

- `apps/web/src/pages/GalleryPage.tsx`
- `apps/web/src/pages/GalleryWorkPage.tsx`
- `apps/web/src/creator-portal/navigation.ts`
- `apps/web/src/components/PortalHeader.tsx`
- `apps/web/src/api.ts`

## Tests / execution state

- `e2e/gallery.spec.ts`
- `e2e/project-hub.spec.ts`
- `e2e/home-community.spec.ts`
- `docs/execution/current.yaml`
- R7 Issue `#38`
- current R3B PR `#112`

---

# 3. Project Core — canonical working domain

## 3.1 Project

`contexts/projects/domain/project.ts` определяет единый Project:

- `id`;
- `scope: personal | classroom`;
- `moduleKey`;
- title/status;
- preview/snapshotRevision;
- description/tags/license;
- immutable copy provenance.

**Решение: REUSE / DO-NOT-DUPLICATE.**

Public Projects не создаёт второй Working Project model.

## 3.2 Working Draft

`project_drafts` хранит один mutable `document_json` на Project.

**Решение: DO-NOT-TOUCH как public source.**

Draft принадлежит редактору и Project lifecycle. Он не является live public publication.

## 3.3 ProjectVersion

`project_versions` уже хранит numbered immutable checkpoints с `document_json`. Trigger `project_versions_immutable` запрещает UPDATE/DELETE.

**Решение: REUSE.**

Это canonical exact immutable source для R7 publication.

## 3.4 Snapshot

`project_snapshots` хранит PNG/WebP preview и `source_revision` mutable draft.

**Решение: REUSE как static preview/fallback.**

Snapshot не заменяет ProjectVersion и не должен быть единственным version binding публикации.

---

# 4. Existing Gallery publication model

## 4.1 `project_publications`

Текущая таблица содержит:

- `project_id` PK;
- tenant;
- owner/publisher principal;
- title/module/author label;
- `snapshot_revision`;
- editor choice;
- published timestamp;
- `visibility: link | public` после migration 0052.

**Решение: MODIFY / compatibility projection.**

Её нельзя считать immutable PublicationRevision. Не удалять одним релизом; эволюционно расширить или оставить как current-state/legacy projection поверх нового revision model.

## 4.2 Publish

`gallery_publish()`:

- author/разрешённый teacher context;
- требует snapshot;
- сохраняет current title/module/author;
- связывает publication с `snapshot_revision`;
- делает UPSERT одной строки на Project.

**GAP:** exact `project_versions.id` не выбирается.

**Решение: MODIFY.**

## 4.3 Unpublish

`gallery_unpublish()` удаляет publication row. `project_reactions` имеет `ON DELETE CASCADE`.

**GAP:** это destructive для public history/social state.

**Решение: MODIFY.** Target revoke/unpublish не удаляет Project/ProjectVersion/immutable history.

---

# 5. Public detail boundary — критический GAP

`gallery_work(principal, project)` JOIN-ит `project_drafts` и возвращает `d.document_json`.

`GalleryController` выдаёт его как `work.document`, а `GalleryWorkPage` разбирает document на клиенте.

Это означает:

- public detail зависит от mutable current draft;
- после публикации working document может измениться;
- raw module document становится public DTO;
- module-specific sanitization отсутствует.

**Решение: MODIFY.**

Target public API должен отдавать immutable publication metadata + safe module artifact. Raw mutable draft не является public contract.

---

# 6. Copy/remix — сохранить механику, изменить source

`gallery_copy_to_projects()` уже:

- создаёт independent personal Project;
- не мутирует original;
- сохраняет immutable provenance;
- делает cross-tenant copy server-side.

Но source JSON берётся из текущего `project_drafts`.

**Решение: MODIFY, не BUILD второго copy stack.**

Target:

`live PublicationRevision → exact project_version_id → project_versions.document_json → new private personal Project`.

---

# 7. Metadata / visibility

Migration 0052 уже добавляет:

- description;
- tags;
- license;
- visibility `private | link | public` через `project_visibility_set()`.

Сейчас `private` фактически unpublish, `link/public` повторно вызывает Gallery publish.

**Решение: MODIFY.**

Target разделяет:

- mutable Working Project metadata;
- publication draft;
- immutable live PublicationRevision.

Working metadata не меняет live public revision автоматически.

---

# 8. Reactions

`project_reactions`:

- `like | wow`;
- unique `(project_id, reactor_principal_id, kind)`;
- server mutation;
- Gallery `popular` использует реальные reactions.

**Решение: REUSE / MODIFY.**

Не создавать вторую likes system. При R8 адаптировать actor/minor policy и binding к target publication semantics.

---

# 9. Collections

Проверены:

- `collections`;
- `collection_items`;
- create/rename/delete;
- add/remove;
- holding lookup;
- `/api/collections`;
- Gallery detail UI уже использует Collections.

Migration 0052 позволяет сохранять own Project или опубликованный Project identity.

**Решение: REUSE.**

Кнопка «Сохранить» Public Projects обязана использовать этот domain. `bookmarks`/`favorites` параллельно не создавать.

---

# 10. Routes / shell

Current routing различает:

- `/projects` → My Projects;
- `/gallery` → community Gallery;
- `/gallery/:projectId` → current public/detail work;
- `/knowledge` → Knowledge.

`PortalHeader` уже показывает верхние **Проекты / Знания**.

**Решение:** shell REUSE; routing MODIFY эволюционно.

Target:

- `/projects` остаётся My Projects;
- `/projects/:publicSlug` — canonical public project page R7;
- `/explore` — discovery R8;
- legacy `/gallery`/`/gallery/:id` сохраняются/redirect-ятся без одномоментного break.

---

# 11. Anonymous access

Current `GalleryController.requireViewer()` требует Account или StudentSeat. Anonymous получает 401 даже для list/detail/image.

**Решение: MODIFY.**

Target:

- anonymous eligible public metadata/detail read;
- anonymous Explore in R8;
- mutations только через authenticated principal;
- viewer-specific flags имеют nullable/safe anonymous projection.

Нельзя просто открыть старый `gallery_work` anonymous, пока он возвращает mutable document.

---

# 12. Search / discovery

Current Gallery list поддерживает:

- recent/popular;
- module filter;
- limit/offset.

Target search по title/public description/tags/author/topic сейчас отсутствует в проверенном Gallery query contract.

**Решение: MODIFY/BUILD в R8**, не в R7 foundation.

---

# 13. Share links

В Project/Gallery contracts проверенного baseline **не найден** project-specific revocable/expiring ShareLink.

`migrations/0059_courses_and_sharing.sql` содержит `content_shares`, но это sharing для `assignment | course`; это Learning content sharing и не может быть переименовано/переиспользовано как Project ShareLink без изменения семантики.

**Решение: BUILD в R7.**

Target ShareLink:

- opaque token;
- revocable;
- optional expiry;
- exact publication/revision target;
- не индексируется;
- не выдаёт mutation permissions.

---

# 14. Moderation / comments

В проверенных Public Projects production paths полноценный moderation workflow не найден. Current Gallery намеренно не имеет free-text comments.

Не подтверждены как существующие Public Projects entities:

- report;
- moderation case;
- restrict/hide/restore workflow;
- appeal/review state;
- public comments.

**Решение:** BUILD только в соответствующих R8 slices поверх существующих Identity/Authz механизмов. Comments запрещены до moderation foundation.

Выполнение R7-01 не должно придумывать полноценную R8 moderation UI.

---

# 15. Existing tests — VERIFIED

## `e2e/gallery.spec.ts`

Реально проверяет:

1. Account создаёт Project;
2. сохраняет snapshot;
3. задаёт description/tags/public/license через свойства;
4. публикация появляется в Gallery;
5. второй Account другой школы видит работу;
6. ставит reaction;
7. educator ставит editor choice;
8. detail открывается;
9. copy создаёт independent Project + provenance;
10. Collections сохраняет работу.

**Решение: REUSE/MODIFY как regression contract.**

Не удалять тест ради R7. Адаптировать поэтапно к exact ProjectVersion publication.

## `e2e/project-hub.spec.ts`

Проверяет существующий My Projects lifecycle: duplicate/archive/trash/restore, desktop/mobile. Это regression protection против случайного разрушения личного Project Hub.

## `e2e/home-community.spec.ts`

Подтверждает существующую shell-навигацию «Проекты / Знания» и отдельный Knowledge public flow. Это полезный shell regression, но не заменяет Gallery/R7 E2E.

Критические новые R7 tests:

- anonymous eligible public read;
- private/revoked denial;
- unlisted token read + revoke/expiry;
- working draft changes after publish do not change live publication;
- copy uses exact published ProjectVersion;
- StudentSeat/assignment policy negatives;
- raw mutable draft does not leak through public endpoint.

---

# 16. REUSE / MODIFY / BUILD / DO-NOT-TOUCH matrix

| Область | Реальная реализация | Решение | Причина |
|---|---|---|---|
| Project model | `contexts/projects/domain/project.ts` | REUSE | canonical module-neutral Project уже есть |
| Working draft | `project_drafts` | DO-NOT-TOUCH as public source | mutable editor state |
| ProjectVersion | `project_versions` + immutable trigger | REUSE | exact immutable source существует |
| Project API/editor | `projects.controller.ts`, ModuleEditorHost | DO-NOT-TOUCH for public read | второй editor запрещён |
| Snapshot | `project_snapshots` | REUSE | static preview/fallback |
| Current publication row | `project_publications` | MODIFY | не immutable revision history |
| Publish | `gallery_publish()` | MODIFY | exact ProjectVersion отсутствует |
| Unpublish | `gallery_unpublish()` | MODIFY | delete + reaction cascade |
| Visibility | `project_visibility_set()` | MODIFY | target token/revision lifecycle богаче |
| Public detail | `gallery_work()`, `/api/gallery/:id/work` | MODIFY | отдаёт mutable draft JSON |
| Copy/remix | `gallery_copy_to_projects()` | MODIFY | source должен стать exact published version |
| Provenance | `projects.copied_from_*` + immutable trigger | REUSE | правильная lineage уже есть |
| Reactions | `project_reactions`, `gallery_react()` | REUSE/MODIFY | storage есть, policy/binding адаптировать |
| Collections | `collections*`, `/api/collections` | REUSE | готовый Saved domain |
| Gallery frontend | GalleryPage/GalleryWorkPage | MODIFY | legacy/compatibility public surface |
| Shell | PortalHeader/navigation | REUSE | верхние «Проекты / Знания» уже есть |
| Anonymous read | GalleryController | MODIFY | сейчас session required |
| Search | Gallery list | BUILD/MODIFY R8 | full target search отсутствует |
| ShareLink | project contract отсутствует | BUILD R7 | нужен tokenized revocable/expiring link |
| PublicationRevision | отсутствует | BUILD R7 | новый public semantic state |
| Public artifact | отсутствует | BUILD R7-03 | safe module DTO нужен |
| Public media | отдельный domain отсутствует | BUILD later | фото/видео publication media |
| Moderation | full workflow не подтверждён | BUILD R8 | prerequisite comments |
| Comments | отсутствуют намеренно | BUILD after moderation | не раньше R8-04 |
| Learning `content_shares` | migration 0059 | DO-NOT-REUSE as Project ShareLink | другая семантика assignment/course |
| Classroom/Learning | соответствующие domains | DO-NOT-TOUCH | отдельная предметная область |

---

# 17. AS-IS → TARGET ERD

Current:

```text
Project
 ├─ 1 ProjectDraft (mutable)
 ├─ N ProjectVersion (immutable)
 ├─ 0..1 ProjectSnapshot
 ├─ 0..1 ProjectPublication
 │      └─ N ProjectReaction
 └─ provenance → source Project

Collection
 └─ N CollectionItem → Project/publication identity
```

Current critical boundary:

```text
ProjectPublication
 → snapshot_revision
 → gallery_work() → CURRENT ProjectDraft.document_json
 → gallery_copy_to_projects() → CURRENT ProjectDraft.document_json
```

Target R7:

```text
Project
 → exact immutable ProjectVersion
    → Publication identity
       → immutable PublicationRevision
          → public metadata
          → exact ProjectVersion
          → static preview / later safe public artifact
          → public/unlisted access
       → ShareLink(s) for unlisted access
```

Working Draft может меняться после publish без изменения live PublicationRevision.

---

# 18. Первый executable R7 slice после разблокировки

Первый подготовленный slice: **PROJ-R7-01 — Publication Foundation**.

Он должен реализовать только:

- publication identity/revision foundation;
- exact `project_versions.id` binding;
- non-destructive public/unlisted/revoke semantics;
- safe anonymous metadata projection;
- revocable/expiring ShareLink;
- convergence существующих Gallery publications;
- copy source → exact published ProjectVersion;
- server-side safety/authz;
- focused DB/API/E2E regression.

Не входят:

- `/explore` redesign;
- full discovery search;
- module viewers;
- public media editor;
- comments;
- recommendations;
- profiles/studios.

Task card: `docs/product/projects/tasks/PROJ-R7-01.md`.

Prepared Issue: `#211`.

---

# 19. Execution blocker — VERIFIED CURRENT STATE

На `main@b31e113a19f6234a0504ff6bade991294b10d38b` projects lane всё ещё:

- task `TASK-R3B-PROJECT-LIFECYCLE-001`;
- Issue #37;
- PR #112;
- status `in_progress`;
- owner acceptance `pending`.

R7 Issue #38 требует accepted R3 Project Hub/Editor Host gate.

Поэтому:

> **PROJ-A0 готов, PROJ-R7-01 подготовлен, но R7 product coding НЕ АКТИВИРОВАН.**

Этот аудит не меняет `current.yaml`, не принимает R3 и не даёт агенту право начать R7.

---

# 20. Activation gate для PROJ-R7-01

Coding разрешается только после всех условий:

1. владелец принимает/закрывает нужный R3 gate;
2. canonical `docs/execution/current.yaml` явно выбирает PROJ-R7-01 / актуальный task id;
3. выполняется `pnpm control-plane:check`;
4. `origin/main` сравнивается с этим baseline;
5. если изменились релевантные Project/Gallery/Identity/Learning paths — выполняется bounded delta refresh этой матрицы;
6. coding-агент читает task card и только нужные разделы TЗ/spec;
7. один запуск = один bounded slice; после evidence — STOP.

---

# 21. Refresh rule

Baseline этого аудита: `b31e113a19f6234a0504ff6bade991294b10d38b`.

Перед activation сравнить актуальный `origin/main`.

Delta refresh обязателен, если изменились:

- `contexts/projects/**`;
- `apps/api/src/gallery.controller.ts`;
- `apps/api/src/collections.controller.ts`;
- Gallery/Projects frontend;
- project/publication/collections migrations;
- Identity/Authz publication eligibility;
- Learning/assignment publication constraints;
- relevant Gallery/R7 tests.

Если изменялись только unrelated module/governance paths, broad re-audit не нужен; достаточно зафиксировать compare evidence.

---

# 22. PROJ-A0 Acceptance

- [x] Project Core найден и отделён от Public Projects;
- [x] mutable Working Draft найден;
- [x] immutable ProjectVersion подтверждён;
- [x] snapshot semantics подтверждены;
- [x] Gallery publication schema/functions подтверждены;
- [x] public detail mutable-document leak подтверждён;
- [x] copy/provenance semantics подтверждены;
- [x] Collections storage/API подтверждены;
- [x] reactions/visibility подтверждены;
- [x] shell/routes подтверждены;
- [x] anonymous-access gap подтверждён;
- [x] Project ShareLink gap отделён от Learning `content_shares`;
- [x] existing Gallery E2E подтверждён;
- [x] REUSE/MODIFY/BUILD/DO-NOT-TOUCH matrix заполнена;
- [x] bounded delta audit 3498dd2 → b31e113 выполнен;
- [x] production behavior не изменён.

**PROJ-A0 RESULT: COMPLETE FOR `main@b31e113a19f6234a0504ff6bade991294b10d38b`.**

**NEXT PREPARED SLICE: PROJ-R7-01 — BLOCKED UNTIL OWNER/CONTROL-PLANE TRANSITION.**
