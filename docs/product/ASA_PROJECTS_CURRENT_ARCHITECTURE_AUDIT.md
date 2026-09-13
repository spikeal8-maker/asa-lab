# ASA Lab — Public Projects
## Current Architecture Audit / PROJ-A0

**Статус:** VERIFIED AS-IS audit  
**Базовый код:** `main@3498dd2c8c2c4ce33b36d3cafa94b85dcd39009e`  
**Дата аудита:** 2026-09-13  
**Целевое ТЗ:** `docs/product/ASA_PROJECTS_IMPLEMENTATION_TZ.md`  
**Архитектурная спецификация:** `docs/product/ASA_PROJECTS_IMPLEMENTATION_SPEC.md`

---

# 0. Вывод

Текущий ASA Lab уже содержит значительную часть фундамента будущей подсистемы Public Projects:

- единый module-neutral Project Core;
- один mutable `project_drafts`;
- immutable `project_versions`;
- snapshots/previews;
- существующую Gallery как общественную поверхность;
- публикацию и снятие публикации;
- `public` / `link` visibility;
- реакции `like` / `wow`;
- `editor choice`;
- detail page;
- provenance;
- copy в личный Project;
- Collections;
- общую ASA Lab shell и верхние пункты «Проекты / Знания»;
- E2E-проверку существующего Gallery journey.

Следовательно, Public Projects **не строится с нуля и не получает второй Project Core**.

Но текущая Gallery **не соответствует R7 target** по нескольким критическим причинам:

1. публикация привязана к `snapshot_revision`, а не к exact immutable `ProjectVersion`;
2. detail API читает `document_json` из текущего mutable `project_drafts`;
3. copy/remix копирует текущий mutable draft, а не опубликованную immutable версию;
4. public Gallery API требует Account/StudentSeat session — anonymous read отсутствует;
5. `unpublish` физически удаляет строку `project_publications`, а reactions каскадно удаляются;
6. отдельной immutable `PublicationRevision` нет;
7. metadata публикации частично берётся непосредственно из mutable `projects`;
8. отдельного revocable/expiring ShareLink нет;
9. нет отдельного безопасного module-specific public artifact contract;
10. R7 safety guards необходимо довести до canonical policy: assignment publication lock, account verification policy, unlisted semantics и audit.

**Архитектурное решение аудита:** существующие Project Core, ProjectVersion, snapshots, provenance, Collections, shell и regression tests переиспользуются. Gallery/publication слой эволюционно модифицируется и дополняется immutable publication semantics.

---

# 1. Проверенные исходники

Аудит выполнен по фактическому `main@3498dd2c8c2c4ce33b36d3cafa94b85dcd39009e`.

## Project Core

- `contexts/projects/domain/project.ts`
- `contexts/projects/application/ports.ts`
- `contexts/projects/application/project.usecases.ts`
- `contexts/projects/infrastructure/pg-project.repository.ts`
- `apps/api/src/projects.controller.ts`

## Database / migrations

- `migrations/0003_electronics_project_slice.sql`
- `migrations/0013_project_lifecycle.sql`
- `migrations/0025_project_snapshot.sql`
- `migrations/0046_gallery.sql`
- `migrations/0048_gallery_open_and_copy.sql`
- `migrations/0049_submitted_visible.sql`
- `migrations/0051_collections.sql`
- `migrations/0052_project_properties.sql`

## Public/community API

- `apps/api/src/gallery.controller.ts`
- `apps/api/src/collections.controller.ts`

## Frontend

- `apps/web/src/pages/GalleryPage.tsx`
- `apps/web/src/pages/GalleryWorkPage.tsx`
- `apps/web/src/creator-portal/navigation.ts`
- `apps/web/src/components/PortalHeader.tsx`

## Tests

- `e2e/gallery.spec.ts`
- существующие Project Core / portal tests из `contexts/projects/testing/**` и `tests/portal/**`

---

# 2. AS-IS модель Project Core

## 2.1. Project

`contexts/projects/domain/project.ts` определяет единый module-neutral `Project`.

Ключевые свойства:

- `id`;
- `scope: personal | classroom`;
- `classroomId`;
- `moduleKey`;
- `title`;
- `status: active | archived | trashed`;
- timestamps;
- preview;
- snapshot revision;
- description;
- tags;
- license;
- immutable copy provenance.

**Решение:** `REUSE`.

Public Projects не создаёт `PublicProject` как вторую копию рабочего Project.

## 2.2. Working Draft

`project_drafts` хранит ровно один mutable JSON document на Project.

**Решение:** `DO-NOT-TOUCH` для public read contract.

Mutable draft остаётся рабочим состоянием редактора и не является источником public page/runtime.

## 2.3. ProjectVersion

`project_versions` уже хранит numbered immutable checkpoints:

- `id`;
- `tenant_id`;
- `project_id`;
- `version_no`;
- `document_json`;
- `label`;
- creator;
- timestamp.

БД запрещает `UPDATE OR DELETE` через trigger `project_versions_immutable`.

`PgProjectRepository.createCheckpoint()` копирует текущий draft document в `project_versions`.

**Решение:** `REUSE`.

Это правильный canonical source для R7 immutable publication.

## 2.4. Snapshot

`project_snapshots` хранит raster PNG/WebP и `source_revision` mutable draft.

Snapshot предназначен для карточек/визуального preview и отделён от JSON document.

**Решение:** `REUSE`, но только как preview/media source.

**Запрещено:** считать `snapshot_revision` заменой `ProjectVersion` при публикации.

---

# 3. AS-IS Gallery / publication storage

## 3.1. `project_publications`

Создана в `migrations/0046_gallery.sql`.

Содержит:

- `project_id` — одновременно PK;
- tenant;
- owner principal;
- publisher principal;
- title;
- module key;
- author label;
- `snapshot_revision`;
- editor choice;
- publication timestamp;
- после migration 0052 — `visibility: link | public`.

Это полезная existing publication projection, но она **не является target immutable PublicationRevision**.

**Решение:** `MODIFY` / compatibility projection.

Не удалять таблицу одним релизом. R7 должен либо эволюционно расширить её, либо оставить её как compatibility/current-publication projection поверх нового revision model.

## 3.2. Publish

`gallery_publish(principal, project)`:

- проверяет существование Project;
- разрешает owner или teacher seat-owner context;
- требует snapshot;
- сохраняет current title/module/author label;
- сохраняет `snapshot_revision`;
- upsert-ит одну строку на Project.

Проблема: publish **не выбирает exact `project_versions.id`**.

**Решение:** `MODIFY`.

R7 target: publish должен ссылаться на exact immutable ProjectVersion.

## 3.3. Unpublish

`gallery_unpublish()` делает `DELETE FROM project_publications`.

`project_reactions.project_id` имеет `ON DELETE CASCADE`, поэтому снятие публикации уничтожает reactions.

Это соответствует старой Gallery semantics, но не target lifecycle Public Projects с immutable publication history/revoke/restore.

**Решение:** `MODIFY`.

R7 unpublish/revoke должен отключать public access без удаления Project/ProjectVersion и без переписывания immutable history.

Retention reactions должен быть определён новым publication model; нельзя случайно сохранить старую cascade-семантику как архитектурный инвариант.

---

# 4. AS-IS detail page — критический gap

`gallery_work(principal, project)` из migrations 0048/0052:

- проверяет наличие publication;
- отдаёт title/module/author/metrics;
- description/tags/license/visibility;
- provenance/copy count;
- **JOIN-ит `project_drafts` и возвращает `d.document_json`**.

`apps/api/src/gallery.controller.ts` затем кладёт это в DTO как `work.document`.

`GalleryWorkPage.tsx` разбирает этот document на клиенте для блока «Из чего собрано».

Это несовместимо с целевым public boundary.

Причины:

1. public page читает mutable working state после publication;
2. опубликованная страница может фактически показать структуру, отличную от опубликованного snapshot;
3. raw module document становится public API contract;
4. невозможно гарантировать module-specific sanitization;
5. anonymous viewer R7 нельзя безопасно строить поверх этого контракта.

**Решение:** `MODIFY`.

До R7 public artifact contract raw `document_json` запрещено расширять дополнительными публичными возможностями.

---

# 5. AS-IS copy/remix — критический gap

`gallery_copy_to_projects()`:

- разрешает copy только опубликованной работы;
- запрещает copy собственного Project;
- создаёт independent personal Project;
- сохраняет provenance;
- **копирует JSON из текущего `project_drafts` source Project**.

Плюсы текущего механизма:

- оригинал не мутируется;
- copy становится independent personal Project;
- provenance immutable;
- cross-tenant copy выполняется сервером.

Проблема:

> Копируется текущее рабочее состояние, а не exact version, которую пользователь увидел как опубликованную.

**Решение:** `MODIFY`, не `BUILD` второго copy stack.

R7 copy/remix обязан переиспользовать текущий provenance/create semantics, но source document брать из exact published `ProjectVersion` / safe source revision.

---

# 6. AS-IS metadata / visibility

Migration `0052_project_properties.sql` добавляет author-facing:

- description;
- tags;
- license;
- publication visibility `private | link | public` через `project_visibility_set`.

`private` фактически вызывает `gallery_unpublish()`.

`link/public` вызывает `gallery_publish()` и затем меняет `project_publications.visibility`.

Это рабочий UX старой Gallery, но target R7 требует разделить:

- working Project metadata;
- public publication draft;
- live immutable PublicationRevision.

**Решение:** `MODIFY`.

После появления PublicationRevision изменение working Project title/description/tags не должно автоматически менять live public revision до явного publish flow.

---

# 7. AS-IS reactions

`project_reactions`:

- привязаны к publication `project_id`;
- kinds: `like`, `wow`;
- unique `(project_id, reactor_principal_id, kind)`;
- mutation идемпотентна через `ON CONFLICT DO NOTHING` / delete;
- author не может react на собственную работу;
- Gallery list умеет считать `popular` по reactions.

**Решение:** `REUSE / MODIFY`.

Не создавать вторую таблицу likes без отдельной необходимости.

На R8 необходимо привести actor policy к canonical StudentSeat/minor policy и привязать semantics к новой publication model без потери существующих данных.

---

# 8. AS-IS Collections

Есть отдельный работающий Collections domain:

- `collections`;
- `collection_items`;
- create/rename/delete;
- add/remove item;
- holding lookup;
- frontend flow уже используется на GalleryWorkPage.

Migration 0052 уже разрешает коллекциям хранить ссылки на собственные Projects или опубликованные Projects.

**Решение:** `REUSE`.

Public Projects action **«Сохранить»** обязан использовать этот domain.

Запрещено создавать параллельные `bookmarks`, `favorites` или второй Saved system.

Возможная адаптация при R7 publication revisions: collection продолжает означать сохранение Project/publication identity, а не конкретной временной browser-копии DTO.

---

# 9. AS-IS routes / shell

`apps/web/src/creator-portal/navigation.ts` уже различает:

- `/projects` → `my-projects`;
- `/gallery` → общественная Gallery;
- `/gallery/:projectId` → открытая работа;
- `/knowledge` → Knowledge.

`PortalHeader.tsx` уже показывает в верхней глобальной навигации:

- **Проекты** → текущая Gallery;
- **Знания** → Knowledge.

Это подтверждает продуктовую границу:

- «Мои проекты» — личная рабочая система;
- «Проекты» сверху — общественная подсистема.

**Решение:** shell `REUSE`; routing `MODIFY` эволюционно.

Target:

- `/projects` не отбирать у My Projects;
- public detail — canonical `/projects/:publicSlug` после R7 routing slice;
- discovery — `/explore` после R8;
- legacy `/gallery` сохранять/redirect-ить без одномоментного break.

---

# 10. AS-IS API access

`GalleryController.requireViewer()` принимает:

- Account session;
- StudentSeat session;
- иначе возвращает `401`.

Поэтому даже GET list/detail/image сейчас **не anonymous public**.

Target R7/R8 требует:

- anonymous eligible public project page;
- anonymous public discovery catalog;
- authenticated context только для personalized flags/mutations.

**Решение:** `MODIFY`.

Нельзя просто сделать старый `requireViewer()` nullable и оставить SQL без пересмотра: viewer-specific reaction/permission fields должны иметь безопасную anonymous projection.

---

# 11. AS-IS search / discovery

Current Gallery list поддерживает:

- sort `recent | popular`;
- module filter;
- `limit`;
- offset.

Не поддерживает target search по:

- title;
- public description;
- tags;
- author;
- topic/technology keywords.

Также current list использует offset pagination.

**Решение:** `MODIFY/BUILD` только в R8 discovery slice.

R7 foundation не должен преждевременно строить full search/ranking.

---

# 12. AS-IS moderation

Сейчас присутствуют:

- `editors_choice`;
- server-side capability check для editor choice;
- generic `audit_events` используется Project Core;
- отсутствие public comments сознательно защищает детскую Gallery без moderation subsystem.

Но отсутствует полноценный Public Projects moderation workflow:

- report;
- moderation case;
- claim/review;
- restrict/hide;
- media restriction;
- request changes;
- restore;
- escalation;
- appeal state;
- reason/audit projection владельцу.

**Решение:** `BUILD` в R8 moderation foundation, но поверх существующего Identity/Authz/Audit, не отдельной admin identity.

Comments до этого этапа запрещены.

---

# 13. AS-IS tests

`e2e/gallery.spec.ts` уже проверяет реальный сквозной journey:

1. Account создаёт Project;
2. сохраняет snapshot;
3. через свойства задаёт description/tags/public/license;
4. другой Account из другой школы видит публикацию;
5. ставит reaction;
6. educator выставляет editor choice;
7. detail открывается;
8. copy создаёт independent Project с provenance;
9. Collections сохраняют работу.

Это ценный regression contract.

**Решение:** `REUSE/MODIFY`.

Не удалять тест ради нового R7. Его нужно поэтапно адаптировать к exact ProjectVersion publication и дополнить отдельными R7 негативными тестами.

Критические отсутствующие E2E:

- anonymous eligible public read;
- private/unpublished denial;
- unlisted share/revoke;
- published ProjectVersion остаётся неизменным после изменения working draft;
- copy копирует exact published version;
- assignment/StudentSeat publication negatives;
- raw mutable draft не утечёт через public endpoint.

---

# 14. REUSE / MODIFY / BUILD / DO-NOT-TOUCH matrix

| Область | Реальный path/symbol/API | Решение | Причина |
|---|---|---|---|
| Project model | `contexts/projects/domain/project.ts` | REUSE | единый module-neutral Project уже есть |
| Mutable draft | `project_drafts` | DO-NOT-TOUCH as public source | рабочее состояние редактора |
| ProjectVersion | `project_versions`, `createCheckpoint()` | REUSE | immutable version уже реализована |
| Project repository | `PgProjectRepository` | REUSE / narrow MODIFY only if needed | canonical lifecycle уже существует |
| Project API/editor | `projects.controller.ts`, ModuleEditorHost | DO-NOT-TOUCH for public read | не строить второй editor |
| Snapshot | `project_snapshots` | REUSE | thumbnail/static fallback |
| Publication current row | `project_publications` | MODIFY | legacy/current projection, не revision history |
| Publish | `gallery_publish()` | MODIFY | должен выбрать exact ProjectVersion |
| Unpublish | `gallery_unpublish()` | MODIFY | сейчас destructive для publication/reactions |
| Visibility | `project_visibility_set()` | MODIFY | target unlisted/revoke/revision semantics |
| Public detail | `gallery_work()`, GET `:id/work` | MODIFY | сейчас отдаёт mutable `project_drafts.document_json` |
| Copy/remix | `gallery_copy_to_projects()` | MODIFY | сохранять механизм, source = exact published version |
| Provenance | `projects.copied_from_*` + immutable trigger | REUSE | уже корректная permanent lineage |
| Reactions | `project_reactions`, `gallery_react()` | REUSE/MODIFY | backend существует, actor/publication semantics адаптировать |
| Collections | `collections*`, `/api/collections` | REUSE | готовая система сохранения |
| Gallery list | `gallery_list()`, GalleryPage | MODIFY | станет compatibility/source для R8 discovery |
| Search | Gallery list | BUILD/MODIFY in R8 | target search отсутствует |
| Anonymous read | GalleryController | MODIFY | сейчас session required |
| ShareLink | отсутствует как Project publication contract | BUILD in R7 | нужен revocable/expiring unlisted link |
| PublicationRevision | отсутствует | BUILD in R7 | target immutable public history |
| Public artifact | отсутствует | BUILD after publication foundation | нужен sanitized module-specific DTO |
| Media | отдельного Public Projects media domain нет | BUILD later | фото/видео publication media |
| Moderation | полноценного workflow нет | BUILD R8 | prerequisite comments |
| Comments | отсутствуют намеренно | BUILD after moderation | не раньше R8 moderation foundation |
| Audit | generic `audit_events` | REUSE/MODIFY | publication actions должны логироваться |
| Classroom/assignment review | classroom/learning migrations/controllers | DO-NOT-TOUCH | отдельный образовательный domain |
| Global shell | `PortalHeader`, navigation | REUSE | «Проекты / Знания» уже есть |

---

# 15. AS-IS ERD

Упрощённая фактическая схема до R7:

```text
Project
  │ 1
  ├────────────── 1 ProjectDraft (mutable document)
  │
  ├────────────── N ProjectVersion (immutable document checkpoints)
  │
  ├────────────── 1 ProjectSnapshot (raster preview of draft revision)
  │
  ├────────────── 0..1 ProjectPublication
  │                    │
  │                    └── N ProjectReaction
  │
  └────────────── provenance → source Project

Collection
  └── N CollectionItem → Project/publication identity
```

Проблема current publication boundary:

```text
ProjectPublication
  → snapshot_revision
  → gallery_work() → CURRENT ProjectDraft.document_json
  → gallery_copy_to_projects() → CURRENT ProjectDraft.document_json
```

Target R7 boundary:

```text
Project
  → exact immutable ProjectVersion
      → PublishedProject / Publication
          → immutable PublicationRevision
              → public metadata
              → selected ProjectVersion
              → safe public artifact / static preview
              → public/unlisted access state
```

Working Draft после публикации может меняться без изменения live PublicationRevision.

---

# 16. Главные архитектурные решения после аудита

## A. Project Core не переписывать

Canonical Project, Draft, ProjectVersion и repository остаются источником рабочего состояния.

## B. R7 строить вокруг ProjectVersion, не snapshot revision

Snapshot остаётся preview. Public executable/read-only content привязывается к immutable `project_versions.id`.

## C. Не использовать `gallery_work().document_json` как target public API

Его нужно заменить/сузить до public metadata + безопасного artifact flow.

## D. Copy/remix не создавать заново

Сохранить current independent Project + immutable provenance semantics. Изменить только источник копируемого document: exact published ProjectVersion.

## E. Collections не дублировать

Сохранение остаётся существующим Collections domain.

## F. Gallery мигрировать эволюционно

Текущие `/gallery` и данные нельзя одномоментно удалить. Нужны compatibility path/redirect/projection до принятого перехода.

---

# 17. R7 data direction

Это не разрешение выполнить migration; это результат архитектурного аудита для task design.

Минимальная целевая модель должна поддержать:

## PublishedProject / Publication identity

Одна публичная identity, связанная с canonical `project_id` и owner.

## PublicationRevision

Immutable запись как минимум с:

- revision id;
- publication/project identity;
- exact `project_version_id` FK;
- public title/summary/tags/license projection;
- cover/static preview reference;
- visibility/publication state required by target;
- created/published timestamps;
- actor principal;
- moderation state where applicable.

Новая revision создаётся publish action, а не autosave working Project.

## ShareLink

Для unlisted:

- opaque token / safe digest storage;
- revocable;
- optional expiry;
- exact publication/revision target;
- не индексируется.

Exact names/table layout определяются implementation slice после проверки latest main и migration numbering.

---

# 18. R7-01 обязательные security decisions

Перед первой product migration R7-01 обязан разрешить по фактическим Identity/Learning contracts:

1. точный server signal «account разрешено public publish»;
2. StudentSeat deny;
3. assignment work deny;
4. classroom/school privacy negative paths;
5. anonymous read projection;
6. unlisted token semantics;
7. revocation semantics;
8. audit event fields без PII/raw document.

Если точный Identity signal verification изменился относительно этого baseline, агент должен взять его из актуального кода, а не придумывать новый `role`/boolean.

---

# 19. Что уже можно переиспользовать в первом R7 slice

Без нового анализа можно считать подтверждёнными на данном baseline:

- canonical `projects.id`;
- immutable `project_versions.id` + document JSON;
- `PgProjectRepository.createCheckpoint()`;
- snapshots как preview;
- existing principal/account context machinery;
- provenance columns/immutability;
- Collections;
- audit events infrastructure;
- Gallery legacy surface/data as migration input;
- existing Gallery E2E as regression input.

---

# 20. Что нельзя делать в R7-01

- redesign каталога;
- строить `/explore`;
- comments;
- recommendations;
- public profile/studio;
- второй Project model;
- второй working draft/version stack;
- новый bookmarks domain;
- module viewers сразу для всех модулей;
- broad cleanup Gallery/Knowledge controller «заодно»;
- удалять legacy `/gallery`;
- менять Classroom/assignment semantics без отдельного разрешения.

---

# 21. Execution readiness

PROJ-A0 по этому baseline **выполнен как архитектурный аудит**.

Однако product coding R7 **не активирован этим документом**.

На момент аудита canonical execution state проекта всё ещё содержит:

- lane `projects`;
- task `TASK-R3B-PROJECT-LIFECYCLE-001`;
- status `in_progress`;
- owner acceptance pending;
- PR #112 Draft/open.

Issue #38 R7 прямо зависит от accepted R3 Project Hub/Editor Host gate.

Поэтому следующий R7 slice можно только **подготовить**, но не запускать, пока владелец не завершит/переведёт execution state согласно `AGENTS.md` и `docs/execution/current.yaml`.

---

# 22. Refresh rule

Перед активацией R7-01 этот аудит проверяется против актуального `origin/main`.

Если после `3498dd2c8c2c4ce33b36d3cafa94b85dcd39009e` изменились релевантные пути:

- `contexts/projects/**`;
- `apps/api/src/gallery.controller.ts`;
- `apps/api/src/collections.controller.ts`;
- Gallery/Projects frontend;
- migrations publication/project/identity/learning;
- authz/identity contracts;

то исполнитель обновляет только затронутые строки матрицы/решения перед coding.

Broad re-audit всего репозитория без такого изменения не требуется.

---

# 23. Acceptance PROJ-A0

- [x] Project model/schema найден;
- [x] mutable draft найден;
- [x] immutable ProjectVersion найден и подтверждён;
- [x] snapshot semantics подтверждены;
- [x] Gallery publication schema/functions найдены;
- [x] detail/raw document boundary подтверждён;
- [x] copy/provenance semantics подтверждены;
- [x] Collections storage/API подтверждены;
- [x] visibility semantics подтверждены;
- [x] reactions подтверждены;
- [x] current routes/shell подтверждены;
- [x] existing E2E подтверждён;
- [x] REUSE/MODIFY/BUILD/DO-NOT-TOUCH matrix заполнена;
- [x] critical R7 gaps перечислены;
- [x] target ERD direction зафиксирован;
- [x] production behavior не изменён.

**PROJ-A0 RESULT: ACCEPTABLE AS PREPARED ARCHITECTURE INPUT FOR R7-01.**
