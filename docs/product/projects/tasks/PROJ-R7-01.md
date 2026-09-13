# PROJ-R7-01 — Publication Foundation

**Статус:** PREPARED / BLOCKED — coding не активирован  
**Релиз:** R7 — Visibility, publication, public page, Remix  
**Parent Issue:** #38  
**Аудит:** `docs/product/ASA_PROJECTS_CURRENT_ARCHITECTURE_AUDIT.md`  
**Audit baseline:** `main@3498dd2c8c2c4ce33b36d3cafa94b85dcd39009e`  
**TARGET:** `docs/product/ASA_PROJECTS_IMPLEMENTATION_TZ.md`

---

# 0. Почему задача пока BLOCKED

Эта card подготовлена для исполнения, но **не разрешает coding сама по себе**.

Перед стартом одновременно должны быть выполнены условия:

1. R3 Project Hub/Editor Host принят владельцем;
2. текущая R3B задача в `docs/execution/current.yaml` завершена/переведена владельцем;
3. `current.yaml` явно выбирает этот R7 slice или его актуальный task id;
4. `pnpm control-plane:check` PASS;
5. релевантные изменения `origin/main` после audit baseline проверены по refresh rule.

На момент подготовки PR #112 остаётся Draft/open и projects lane остаётся `TASK-R3B-PROJECT-LIFECYCLE-001` in progress.

---

# 1. Пользовательский результат этого среза

После PROJ-R7-01 backend и data layer должны иметь честный фундамент публикации:

```text
Working Project
→ exact immutable ProjectVersion
→ publication identity
→ immutable PublicationRevision
→ public OR unlisted access
→ revoke/unpublish без удаления Project/ProjectVersion
```

Пользовательский смысл:

- владелец публикует **конкретную неизменяемую версию** своей работы;
- дальнейшее редактирование Working Project не меняет уже опубликованный результат;
- public publication может быть прочитана anonymous безопасной metadata projection;
- unlisted publication открывается только по revocable/expiring share link;
- снятие публикации/revoke не удаляет Project/ProjectVersion/history;
- существующая «Сделать свою версию»/copy semantics после миграции берёт exact published ProjectVersion, а не текущий mutable draft;
- legacy Gallery остаётся работоспособной до R7-02/R8 migration.

Полный красивый Public Project Page не входит в этот срез — это PROJ-R7-02.

---

# 2. Неподвижные архитектурные инварианты

1. `projects` остаётся canonical Working Project.
2. `project_drafts` остаётся единственным mutable working document.
3. `project_versions` остаётся canonical immutable ProjectVersion store.
4. Public Projects не создаёт второй Working Project model.
5. PublicationRevision всегда ссылается на exact `project_versions.id`.
6. Snapshot — preview, а не замена ProjectVersion.
7. Public read не получает mutable `project_drafts.document_json`.
8. Все publish/revoke/share/copy mutations авторизуются server-side.
9. Collections domain не дублируется.
10. Provenance текущего copy flow сохраняется.
11. Legacy `/gallery` не удаляется этим срезом.
12. Classroom/assignment semantics не переписываются этим срезом.

---

# 3. Подтверждённый AS-IS, который переиспользуется

## REUSE

- `projects.id` — canonical Project identity;
- `project_versions` + immutable trigger;
- `PgProjectRepository.createCheckpoint()`;
- `project_snapshots` как preview/static fallback;
- provenance `projects.copied_from_*` + immutable trigger;
- current principal/account/session infrastructure;
- existing `audit_events` infrastructure;
- `collections` / `collection_items` domain;
- existing Gallery rows/reactions as migration input;
- existing Gallery E2E as regression input.

## MODIFY

- `project_publications`;
- `gallery_publish()`;
- `gallery_unpublish()`;
- `project_visibility_set()`;
- `gallery_work()` public boundary;
- `gallery_copy_to_projects()` source selection;
- `GalleryController` read/auth split.

## BUILD

- immutable PublicationRevision storage;
- revocable/expiring unlisted ShareLink storage/contract;
- safe anonymous publication metadata projection;
- migration/convergence for existing publication rows.

## DO-NOT-TOUCH

- Working Draft semantics;
- editor autosave;
- 3D/Electronics/Blocks editor internals;
- Collections as a separate storage concept;
- classroom grading/review;
- unrelated Learning flows.

---

# 4. Data model target

Exact SQL names can follow current repository naming, but semantics are mandatory.

## 4.1. Publication identity

Existing `project_publications` should be evolved additively or retained as compatibility/current-state projection.

It must identify one publication for one canonical Project without copying Working Project payload.

Required concepts:

- canonical project id;
- owner/publisher principals;
- current live revision reference;
- publication/access state;
- created/published/revoked timestamps as required;
- moderation-compatible state foundation from R7 Issue #38.

## 4.2. PublicationRevision

Add immutable revision storage with at minimum:

- `id`;
- publication identity FK;
- monotonic revision number or equivalent stable ordering;
- **`project_version_id` FK → `project_versions.id`**;
- public title/summary/description projection;
- tags;
- license;
- cover/static preview reference or deterministic reference to the selected snapshot;
- created/published actor principal;
- created/published timestamp;
- schema/version marker if DTO evolution needs it.

PublicationRevision is immutable after publish.

Author draft/editor for publication metadata is a later slice (`PROJ-R7-05`) and must not be silently implemented here unless required to make the minimal publication transaction coherent.

## 4.3. ShareLink

For unlisted access add tokenized link semantics:

- opaque high-entropy token returned once or safe equivalent;
- only hash/digest persisted if repository security conventions support it;
- publication/revision target;
- created_by;
- created_at;
- optional `expires_at`;
- `revoked_at`;
- revocation must immediately deny new reads;
- token must never grant mutation rights;
- unlisted content is absent from public discovery/index.

---

# 5. Legacy publication convergence

Current `project_publications` knows `snapshot_revision`, but **does not know exact historical `ProjectVersion`**.

Therefore exact historical document state of an old publication cannot be reconstructed from current data with certainty.

Forbidden migration behavior:

- pretend `snapshot_revision` is a `ProjectVersion`;
- silently claim current draft was historically the published version;
- delete old publications because they lack version references.

Required convergence strategy:

1. preserve all existing publication identities and user-visible URLs/data;
2. for each legacy publication create/freeze an immutable convergence source from the document that is actually available at migration time, using the canonical ProjectVersion mechanism;
3. mark migration provenance in an internal/audit-safe way such as `legacy_convergence`, not as a historical claim;
4. bind the initial PublicationRevision to that newly frozen ProjectVersion;
5. retain current static snapshot/cover where available;
6. from migration forward all new publish actions use exact ProjectVersion;
7. migration must be idempotent/re-runnable or have a deterministic forward-fix strategy.

If repository migration policy prefers owner-triggered republish rather than automatic convergence, implementation must preserve legacy static public availability and explicitly document that decision; it may not expose mutable current draft as the new target contract.

---

# 6. Publish transaction

Target publish flow:

1. resolve actor from server session;
2. resolve canonical Project and ownership/capability;
3. enforce publication safety guards;
4. select an existing ProjectVersion OR atomically create an immutable checkpoint from current draft;
5. validate module/version compatibility needed for later public artifact;
6. create immutable PublicationRevision referencing exact ProjectVersion;
7. atomically move publication current/live pointer to that revision;
8. update public/unlisted access state;
9. write audit event;
10. return sanitized publication state — never raw Working Draft.

Failure before commit leaves previous live publication unchanged.

No partial state where publication points to a revision that does not exist.

---

# 7. Safety guards

Before publish the server must reject at least:

- unauthenticated actor;
- StudentSeat direct public publish;
- non-owner/non-authorized actor;
- trashed/deleted/ineligible Project;
- assignment work when canonical R7 policy forbids publication;
- account lacking required verification/capability according to current Identity contract;
- invalid visibility/access mode;
- ProjectVersion that does not belong to Project;
- malformed/unsupported version state where publication cannot be represented safely.

Exact current Identity verification signal must be found in latest main at execution time. **Do not introduce a new global `role`, `verified` boolean or account type just for this task.**

Teacher publication of StudentSeat work must be reconciled explicitly with current Gallery behavior and the canonical R7/minor policy before preserving or changing it. Do not silently broaden child publishing rights.

---

# 8. Anonymous read contract

Do **not** make legacy `GET /api/gallery/:projectId/work` anonymous while it still returns `document_json`.

Create/extend a sanitized read contract that returns only safe publication metadata required before PROJ-R7-03 artifact work.

Minimum anonymous public response:

- stable publication/public identity;
- canonical project/public slug identity as adopted by routing;
- title;
- public author projection;
- module key;
- published timestamp;
- revision identity/version metadata safe for client;
- description/summary;
- tags;
- license;
- cover/static preview URL/reference;
- provenance summary safe for public display;
- capabilities booleans that are known without raw document, if needed.

Must NOT include:

- `project_drafts.document_json`;
- tenant/workspace/classroom ids;
- email/login/private profile data;
- raw authz fields;
- school/class membership;
- secrets/share token digest.

Anonymous request for private/revoked/ineligible content returns the canonical hidden/404 behavior.

---

# 9. Unlisted read contract

Unlisted is not merely `visibility='link'` plus a guessable project URL.

Required flow:

```text
owner creates share link
→ receives opaque URL/token
→ unauthenticated viewer opens it
→ server resolves non-revoked/non-expired token
→ sanitized publication projection returned
→ item absent from discovery/search
```

Revocation:

- denies subsequent reads through token;
- does not delete Project;
- does not delete ProjectVersion;
- does not rewrite immutable PublicationRevision.

---

# 10. Copy/remix convergence

Existing `gallery_copy_to_projects()` is reused semantically but modified technically.

Current defect: it selects `project_drafts.document_json`.

Target:

```text
live PublicationRevision
→ exact project_version_id
→ project_versions.document_json
→ new independent personal Project + initial draft
→ immutable copied_from provenance
```

Copy must fail for:

- unpublished/revoked source;
- unlisted source without valid share authorization;
- source where copy policy forbids it when that policy is introduced;
- author copying own source if existing product behavior intentionally keeps that rule.

Original is never mutated.

---

# 11. Unpublish / revoke semantics

Current `gallery_unpublish()` DELETE + reaction cascade must not remain the target lifecycle by accident.

R7-01 must define non-destructive publication state transition:

- public discovery read stops;
- direct public read stops or follows policy;
- share links can be separately revoked;
- Project remains intact;
- ProjectVersion remains intact;
- PublicationRevision history remains intact;
- audit records action/reason/source;
- restoration/republish creates or activates a valid new state without rewriting past revisions.

Reaction retention across unpublish must be an explicit product/data decision. Migration must not lose existing reactions silently.

---

# 12. API principles

Do not invent URL names merely to look clean.

Preferred sequence:

1. preserve existing `/api/gallery` compatibility;
2. introduce publication-specific contract only where semantics genuinely differ;
3. public anonymous reads must be safe-by-construction;
4. authenticated mutations resolve principal server-side;
5. response contracts are additive/versioned as needed;
6. errors follow repository conventions;
7. OpenAPI/contracts updated if these endpoints are covered by repository contract tooling.

The task card does not require a specific `/api/public-projects` namespace. Final URL is chosen from actual controller architecture during implementation.

---

# 13. Likely affected paths

This list is a preparation map, not permission to modify every file.

Expected:

- one new additive migration with current next migration number at execution time;
- `apps/api/src/gallery.controller.ts` or a narrowly scoped publication controller/service;
- `apps/api/src/tokens.ts` only if new injectable service is required;
- `apps/api/src/app.module.ts` only if wiring is required;
- `contexts/projects/**` only for narrow reusable publication/version access if current ports are insufficient;
- project/publication API tests;
- `e2e/gallery.spec.ts` regression adaptation/additions;
- new focused R7 publication tests;
- OpenAPI/contract files if repository currently documents the touched API.

Do not touch frontend catalog layout in this slice except the smallest compatibility change required to keep existing Gallery working.

---

# 14. Tests required

## Unit/domain

- PublicationRevision immutability;
- project-version ownership/project relation;
- publication state transitions;
- share link expiry/revoke validation;
- public DTO sanitization.

## DB/integration

- migration on non-empty database with existing publications/reactions/collections;
- legacy convergence creates valid exact ProjectVersion references;
- new publish binds exact ProjectVersion;
- working draft changes do not change live revision;
- unpublish/revoke preserves Project/ProjectVersion/history;
- copy uses published version, not latest draft;
- invalid cross-project version reference rejected;
- StudentSeat/assignment/unauthorized negatives;
- unlisted token expiry/revocation;
- public list excludes unlisted/revoked.

## API

- anonymous public metadata read succeeds;
- anonymous private/unpublished read denied;
- legacy raw `work.document` is not newly exposed anonymous;
- owner publish/revoke;
- non-owner publish denied;
- sanitized DTO contains no tenant/class/private document;
- share token is not leaked in logs/DTO.

## E2E / regression

At minimum preserve/adapt `e2e/gallery.spec.ts` and add a bounded R7 journey:

```text
Owner creates Project
→ creates/saves content
→ publish exact immutable version
→ mutate working draft afterwards
→ anonymous opens publication and still sees original published revision metadata
→ authenticated B copies publication
→ B's copy comes from exact published version
→ owner revokes/unpublishes
→ anonymous read denied
→ owner Project and versions remain intact
```

Where PROJ-R7-03 public artifact is not yet implemented, exact-document comparison may be asserted at DB/API integration level instead of exposing raw document to browser.

---

# 15. Acceptance Criteria

**R7-01-AC01** Publication points to an existing exact immutable `project_versions.id`.  
**R7-01-AC02** Working draft edits after publish do not mutate live PublicationRevision.  
**R7-01-AC03** Existing legacy publications converge without deleting Project, provenance, Collections or reactions silently.  
**R7-01-AC04** Anonymous can read eligible public sanitized publication metadata.  
**R7-01-AC05** Anonymous cannot read private/revoked/ineligible publication.  
**R7-01-AC06** Unlisted uses a revocable/expiring tokenized ShareLink and is absent from discovery.  
**R7-01-AC07** Publish/revoke authorization is server-side.  
**R7-01-AC08** StudentSeat/assignment/publication-policy negatives are enforced according to canonical current contracts.  
**R7-01-AC09** `gallery_copy_to_projects` or its successor copies exact published ProjectVersion, not current draft.  
**R7-01-AC10** Provenance remains permanent on the copied Project.  
**R7-01-AC11** Unpublish/revoke does not delete Project or ProjectVersion and preserves immutable publication history.  
**R7-01-AC12** Raw mutable `project_drafts.document_json` is not part of the new anonymous public contract.  
**R7-01-AC13** Existing My Projects/editor/autosave/checkpoint flows do not regress.  
**R7-01-AC14** Existing Gallery remains usable through compatibility path during migration.  
**R7-01-AC15** Required focused + repository gates for the activated task pass on the exact final SHA.  
**R7-01-AC16** No next R7/R8 slice starts automatically.

---

# 16. Evidence required

Implementation report/PR/commit evidence must include:

- baseline `origin/main` SHA;
- migration/schema diff;
- legacy publication convergence count/result;
- REUSE/MODIFY/BUILD matrix updated from audit;
- API contract diff;
- permission negative matrix;
- proof that copy source is ProjectVersion;
- proof that anonymous DTO contains no raw document/private identifiers;
- tests actually run;
- cache status where repository gate policy requires it;
- CI result for exact final SHA if pushed;
- deployment = `not requested` unless owner explicitly requests deployment;
- database production action = `not requested` unless explicitly requested;
- next allowed task = STOP / owner decision.

---

# 17. Focused gate preparation

A dedicated focused script should be added when this task is activated, for example repository-convention-equivalent to:

```text
pnpm gate:projects-r7-01
```

It should cover only the publication foundation plus required dependent builds/contracts/tests and must be the same command locally and in focused CI.

Do not hardcode this command into `current.yaml` until its script/workflow exists in the implementation slice.

General repository gate remains whatever `current.yaml` requires at execution time.

---

# 18. STOP conditions

Stop and return to owner if:

- R3 has not been accepted/closed for execution transition;
- current.yaml does not select this slice;
- current main changed the publication/project-version model materially and audit is stale;
- exact account verification policy cannot be resolved from current Identity contract;
- assignment publication eligibility cannot be resolved without changing Learning semantics;
- migration would require destructive rewrite of existing Project/version/user data;
- unrelated CI failure would require touching another module;
- acceptance criteria are met — report and STOP, do not start R7-02.

---

# 19. Activation instruction for owner/control plane

When R3 is accepted and the owner chooses R7-01, the control-plane transition should select a single projects/public-projects slice that references:

```text
docs/product/ASA_PROJECTS_IMPLEMENTATION_TZ.md
docs/product/ASA_PROJECTS_CURRENT_ARCHITECTURE_AUDIT.md
docs/product/projects/tasks/PROJ-R7-01.md
GitHub Issue #38 (parent scope)
```

The activated task must use the **then-current `main` SHA**, not the audit baseline blindly.

This card is intentionally **PREPARED / BLOCKED** until that owner transition occurs.
