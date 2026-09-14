# PROJ-R7-01 — Publication Foundation

**Статус:** PREPARED / BLOCKED — coding не активирован  
**Релиз:** R7 — Visibility, publication, public page, Remix  
**Parent Issue:** #38  
**Prepared Issue:** #211  
**Аудит:** `docs/product/ASA_PROJECTS_CURRENT_ARCHITECTURE_AUDIT.md`  
**Audit baseline:** `main@b31e113a19f6234a0504ff6bade991294b10d38b`  
**TARGET:** `docs/product/ASA_PROJECTS_IMPLEMENTATION_TZ.md`

---

# 0. Activation gate

Эта task card полностью подготовлена, но **сама по себе не разрешает coding**.

Старт возможен только если одновременно:

1. R3 Project Hub/Editor Host принят владельцем;
2. canonical `docs/execution/current.yaml` больше не держит незавершённую R3B как активный projects slice;
3. владелец явно выбирает PROJ-R7-01 / актуальный task id в `current.yaml`;
4. `pnpm control-plane:check` PASS;
5. актуальный `origin/main` сравнен с audit baseline;
6. при изменении релевантных Project/Gallery/Identity/Learning paths выполнен bounded delta refresh аудита.

На проверенном baseline projects lane всё ещё:

- `TASK-R3B-PROJECT-LIFECYCLE-001`;
- Issue #37;
- PR #112 Draft/open;
- status `in_progress`;
- owner acceptance `pending`.

**Нельзя:** активировать R7 этой card, править `current.yaml` из feature-ветки ради саморазрешения, автоматически переходить к R7-02.

---

# 1. Пользовательский результат

После принятого PROJ-R7-01 backend/data layer должен обеспечивать честную основу публикации:

```text
Working Project
→ exact immutable ProjectVersion
→ Publication identity
→ immutable PublicationRevision
→ public OR unlisted access
→ revoke/unpublish без удаления Project/ProjectVersion/history
```

Пользовательский смысл:

- владелец публикует конкретную неизменяемую версию;
- дальнейшее редактирование Working Project не меняет уже опубликованный результат;
- eligible public publication имеет безопасную anonymous metadata projection;
- unlisted publication открывается только через tokenized revocable/expiring ShareLink;
- revoke/unpublish не уничтожает Project/ProjectVersion/publication history;
- copy/remix берёт exact published ProjectVersion, а не текущий mutable draft;
- legacy Gallery остаётся работоспособной через compatibility path.

**Не входит:** красивый final Public Project Page, discovery redesign, interactive viewer, media editor, comments. Это отдельные slices.

---

# 2. Неподвижные архитектурные инварианты

1. `projects` остаётся canonical Working Project.
2. `project_drafts` остаётся единственным mutable working document.
3. `project_versions` остаётся canonical immutable ProjectVersion store.
4. Public Projects не создаёт второй Working Project model.
5. PublicationRevision всегда ссылается на exact `project_versions.id`.
6. Snapshot используется как preview/fallback, а не как версия проекта.
7. Новый anonymous/public contract не отдаёт `project_drafts.document_json`.
8. Publish/revoke/share/copy mutations авторизуются server-side.
9. Collections не дублируются bookmarks/favorites storage.
10. Existing copy provenance сохраняется permanent/immutable.
11. Legacy `/gallery` не удаляется этим slice.
12. Classroom/Learning semantics не переписываются «заодно».

---

# 3. Подтверждённый AS-IS

## REUSE

- `projects.id` — canonical Project identity;
- `project_versions` + immutability trigger;
- existing checkpoint/version creation path;
- `project_snapshots` как static preview;
- `projects.copied_from_*` + provenance immutability;
- current principal/account/session mechanisms;
- Collections (`collections`, `collection_items`, `/api/collections`);
- Gallery data/reactions as migration input;
- `e2e/gallery.spec.ts` as regression input.

## MODIFY

- `project_publications`;
- `gallery_publish()`;
- `gallery_unpublish()`;
- `project_visibility_set()`;
- `gallery_work()` / public detail boundary;
- `gallery_copy_to_projects()` source selection;
- `GalleryController` authenticated/pubic read split.

## BUILD

- immutable PublicationRevision state;
- project-specific tokenized ShareLink;
- safe anonymous publication metadata projection;
- additive convergence of legacy Gallery publications.

## DO-NOT-TOUCH

- Working Draft semantics;
- editor autosave;
- 3D/Electronics/Blocks editor internals;
- separate Collections storage concept;
- classroom grading/review;
- unrelated Learning flows.

### Important sharing finding

`migrations/0059_courses_and_sharing.sql` has `content_shares`, but its `subject_kind` is `assignment | course`.

It is **Learning content sharing, not Project ShareLink**. Do not extend it into project publication sharing merely because the word `share` exists.

---

# 4. Target data model

Exact names follow repository conventions at implementation time; semantics below are mandatory.

## 4.1 Publication identity

Evolve `project_publications` additively or retain it as compatibility/current-state projection.

Required concepts:

- canonical project id;
- owner/publisher principal;
- current live PublicationRevision reference;
- public/unlisted/revoked state;
- created/published/revoked timestamps as required;
- compatibility with existing Gallery data.

No Working Project payload copy.

## 4.2 PublicationRevision

Immutable storage containing at minimum:

- id;
- publication identity FK;
- stable revision number/order;
- **`project_version_id` FK → `project_versions.id`**;
- public title/summary/description projection;
- public tags/license projection;
- cover/static preview reference;
- actor principal;
- published timestamp;
- schema/version marker if needed.

Revision cannot be mutated after publish.

Publication-draft editor belongs to later `PROJ-R7-05`; do not silently build it here beyond the minimal transaction needed for publication.

## 4.3 Project ShareLink

Unlisted access requires:

- opaque high-entropy token;
- persisted digest/hash when consistent with repository security conventions;
- publication/revision target;
- created_by / created_at;
- optional expires_at;
- revoked_at;
- immediate revoke effect;
- no mutation permissions from the token;
- absence from public discovery/index.

---

# 5. Legacy convergence

Current `project_publications` knows `snapshot_revision`, but not historical exact `ProjectVersion`.

Therefore migration must **not** claim that old `snapshot_revision` is a ProjectVersion or that current draft equals the historical publication.

Required strategy:

1. preserve existing publication identity/data/URLs during compatibility period;
2. freeze a deterministic immutable convergence source for legacy rows using canonical ProjectVersion mechanism, or preserve legacy static read until explicit owner republish if that is the safer accepted strategy;
3. mark internally that initial revision is legacy convergence, not a historical assertion;
4. bind new PublicationRevision to an actual ProjectVersion;
5. preserve available snapshot/preview;
6. all new publish actions after migration use exact ProjectVersion;
7. migration is idempotent or has documented deterministic forward-fix.

Never delete legacy publications merely because historical exact version cannot be reconstructed.

---

# 6. Publish transaction

Target flow:

1. resolve actor from server session;
2. resolve canonical Project and object authorization;
3. enforce publication safety guards;
4. select existing ProjectVersion or atomically create immutable checkpoint from current draft;
5. verify version belongs to Project;
6. create immutable PublicationRevision;
7. atomically move publication live/current pointer;
8. apply public/unlisted access state;
9. emit existing-compatible audit/log evidence if infrastructure supports it; if exact audit mechanism is not found, create only the minimal scoped auditable record required by R7 rather than inventing a second generic audit system;
10. return sanitized publication state, never Working Draft.

Failure before transaction commit leaves previous live publication unchanged.

---

# 7. Safety guards

Publish must reject at least:

- unauthenticated actor;
- StudentSeat direct public publish;
- non-owner/non-authorized actor;
- trashed/deleted/ineligible Project;
- assignment work when canonical policy forbids publication;
- account that does not satisfy current verification/publish eligibility;
- invalid access mode;
- ProjectVersion belonging to another Project;
- malformed/unsupported state.

Exact Identity verification signal is resolved from **then-current main**. Do not add a new global `role`, `verified` boolean or account type for this feature.

Current teacher-sharing of StudentSeat work must be reconciled explicitly with R7/minor policy; do not silently widen child publication rights.

---

# 8. Anonymous public read

Do **not** make legacy `GET /api/gallery/:projectId/work` anonymous while it returns mutable `document_json`.

Create/extend a sanitized public metadata contract containing only what PROJ-R7-01 needs:

- stable public/publication identity;
- title;
- safe author projection;
- module key;
- published timestamp;
- current publication revision identity;
- description/summary;
- tags;
- license;
- static preview/cover reference;
- safe provenance summary;
- known safe capability flags if needed.

Must not contain:

- Working Draft JSON;
- tenant/workspace/classroom IDs;
- private profile/email/login data;
- authz internals;
- school/class membership;
- ShareLink digest/token.

Private/revoked/ineligible returns canonical hidden/404 behavior.

---

# 9. Unlisted read

Unlisted is not `visibility='link'` plus a guessable Project URL.

Required flow:

```text
owner creates ShareLink
→ gets opaque URL/token
→ viewer opens tokenized URL
→ server validates not revoked/not expired
→ sanitized publication projection
→ publication remains absent from discovery/search
```

Revocation does not delete Project, ProjectVersion or immutable PublicationRevision.

---

# 10. Copy/remix convergence

Existing `gallery_copy_to_projects()` semantics are reused:

```text
live PublicationRevision
→ exact project_version_id
→ project_versions.document_json
→ independent private personal Project + draft
→ permanent provenance
```

Copy fails for revoked/unavailable source and for unlisted source without valid share authorization.

Original never mutates.

---

# 11. Revoke / unpublish

Current DELETE + reaction cascade is legacy behavior and not target lifecycle.

R7-01 must provide non-destructive state transition:

- public/discovery access stops;
- direct public access follows canonical policy;
- ShareLinks can be revoked separately;
- Project remains;
- ProjectVersion remains;
- PublicationRevision history remains;
- action is auditable;
- republish does not rewrite past revisions.

Reaction retention across revoke/unpublish must be an explicit migration/product decision; do not silently lose existing reactions.

---

# 12. API rules

- preserve `/api/gallery` compatibility during migration;
- add publication-specific contract only where semantics truly differ;
- anonymous read is safe-by-construction;
- mutations derive actor server-side;
- response changes additive/versioned as needed;
- errors follow repository conventions;
- update OpenAPI/contracts if touched API is under contract tooling;
- no requirement to invent `/api/public-projects` merely for naming aesthetics.

---

# 13. Expected affected paths

Preparation map, not permission to edit everything:

- one additive migration using then-current migration number;
- `apps/api/src/gallery.controller.ts` and/or one narrowly scoped publication controller/service;
- `apps/api/src/tokens.ts` / `app.module.ts` only if service wiring is required;
- `contexts/projects/**` only for narrow version access if existing ports are insufficient;
- publication DB/API tests;
- `e2e/gallery.spec.ts` regression adaptation/addition;
- a focused R7 publication test suite/gate;
- OpenAPI/contract files if currently applicable.

Do not redesign catalog UI in this slice.

---

# 14. Required tests

## DB/integration

- migration on non-empty DB with existing publication/reaction/collection rows;
- legacy convergence preserves data and binds real ProjectVersion;
- new publish binds exact ProjectVersion;
- working draft edits do not affect live revision;
- revoke preserves Project/ProjectVersion/history;
- copy uses exact published version;
- cross-project version reference rejected;
- StudentSeat/assignment/unauthorized negatives;
- ShareLink expiry/revoke;
- unlisted/revoked absent from public discovery.

## API

- anonymous eligible public metadata succeeds;
- anonymous private/revoked denied;
- raw mutable draft not exposed;
- owner publish/revoke succeeds;
- non-owner publish denied;
- public DTO has no tenant/class/private document;
- share token/digest not leaked.

## E2E / regression

Preserve/adapt `e2e/gallery.spec.ts` and add bounded R7 journey:

```text
Owner creates Project
→ freezes/publishes exact ProjectVersion
→ changes Working Draft afterwards
→ anonymous reads same live PublicationRevision
→ B copies publication
→ B receives version that was actually published
→ owner revokes/unpublishes
→ anonymous read denied
→ owner Project + ProjectVersions remain
```

Until PROJ-R7-03 artifact exists, exact document equality may be asserted in DB/API integration tests rather than exposing raw document to browser.

Also keep My Projects regression protection (`e2e/project-hub.spec.ts`).

---

# 15. Acceptance Criteria

**R7-01-AC01** Publication points to exact immutable `project_versions.id`.  
**R7-01-AC02** Working Draft edits cannot mutate live PublicationRevision.  
**R7-01-AC03** Legacy publications converge without silent deletion of Project/provenance/Collections/reactions.  
**R7-01-AC04** Anonymous reads eligible public sanitized metadata.  
**R7-01-AC05** Anonymous cannot read private/revoked/ineligible content.  
**R7-01-AC06** Unlisted uses revocable/expiring tokenized Project ShareLink and is not discoverable.  
**R7-01-AC07** Publish/revoke/copy authz is server-side.  
**R7-01-AC08** StudentSeat/assignment/current verification negatives follow canonical current contracts.  
**R7-01-AC09** Copy uses exact published ProjectVersion, not current draft.  
**R7-01-AC10** Provenance remains permanent.  
**R7-01-AC11** Revoke does not delete Project/ProjectVersion/immutable publication history.  
**R7-01-AC12** Raw mutable draft is absent from new anonymous public contract.  
**R7-01-AC13** My Projects/editor/autosave/checkpoint flows do not regress.  
**R7-01-AC14** Legacy Gallery remains usable through compatibility period.  
**R7-01-AC15** Activated task gates pass on exact final SHA.  
**R7-01-AC16** Agent stops after this slice; R7-02/R8 do not start automatically.

---

# 16. Evidence required

Report/PR/commit evidence:

- actual origin/main baseline SHA;
- migration/schema diff;
- legacy convergence result/count;
- updated REUSE/MODIFY/BUILD matrix;
- API contract diff;
- permission negative matrix;
- proof copy source is ProjectVersion;
- proof anonymous DTO excludes raw/private data;
- exact test commands/results;
- cache status where governance requires;
- CI conclusion for exact pushed SHA when applicable;
- deployment/database production action = `not requested`, unless owner separately authorizes;
- next allowed task = STOP / owner decision.

---

# 17. Focused gate preparation

When activated, implementation should add a repository-convention focused command, e.g. the then-accepted equivalent of:

```text
pnpm gate:projects-r7-01
```

The exact command is not written into `current.yaml` before the script/workflow exists.

General gate remains whatever activated `current.yaml` requires.

---

# 18. STOP conditions

STOP if:

- R3 not accepted;
- `current.yaml` does not select this slice;
- relevant main changes make audit stale;
- Identity publish eligibility cannot be resolved from current contract;
- assignment publication policy would require unapproved Learning redesign;
- migration would require destructive rewrite of Project/version/user data;
- unrelated CI failure would require scope expansion;
- acceptance criteria are complete — report and STOP.

---

# 19. Activation handoff

When owner chooses R7-01, control-plane task must reference:

```text
docs/product/ASA_PROJECTS_IMPLEMENTATION_TZ.md
docs/product/ASA_PROJECTS_CURRENT_ARCHITECTURE_AUDIT.md
docs/product/projects/tasks/PROJ-R7-01.md
GitHub Issue #211
Parent R7 Issue #38
```

Use then-current `main`, not this baseline blindly.

**PREPARATION RESULT:** task card is executable in scope/acceptance terms, but remains intentionally **BLOCKED** until owner/control-plane transition.
