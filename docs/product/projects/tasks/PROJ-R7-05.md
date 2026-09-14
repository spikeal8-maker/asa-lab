# PROJ-R7-05 — Publication Editor, Media and Revisions

**Статус:** PREPARED / NOT ACTIVATED  
**Depends on:** accepted `PROJ-R7-01` and `PROJ-R7-02`; viewer slices may roll out independently, but their media/artifact contracts must not be broken.  
**TARGET:** `docs/product/ASA_PROJECTS_IMPLEMENTATION_TZ.md`  
**UI contract:** `docs/product/ASA_PROJECTS_UI_UX_SPEC.md`  
**Decisions:** `docs/product/projects/DECISION_LEDGER.md`

---

## 0. Activation gate

Coding starts only when this exact slice is selected in `docs/execution/current.yaml`, current `main` has been delta-checked, and decisions relevant to enabled subfeatures are closed:

- DEC-PROJ-105 remix policy if settings expose it;
- DEC-PROJ-106 default license if publication form needs one;
- DEC-PROJ-108 video pipeline before video is enabled.

Video is allowed to remain feature-flagged OFF while image/physical-result media ships.

---

## 1. Пользовательский результат

Владелец может улучшать публичное представление проекта независимо от Working Project:

- редактировать title/summary/description/tags;
- выбирать обложку;
- добавлять/упорядочивать изображения и фото физического результата;
- видеть autosave public draft;
- делать preview;
- публиковать изменения одной атомарной операцией;
- выбирать, какую exact ProjectVersion публиковать;
- видеть историю публичных редакций;
- восстанавливать старую редакцию как новую revision;
- выполнять основные редакционные действия с телефона.

Working Project может продолжать изменяться, не меняя live publication автоматически.

---

## 2. Scope

Входит:

- publication draft entity/storage;
- autosave;
- preview;
- atomic publish → immutable PublicationRevision;
- revision history;
- restore-as-new-revision;
- selected exact ProjectVersion;
- cover;
- image gallery;
- physical-result image;
- media order/caption/alt;
- media validation/processing/variants;
- owner/editor ACL only if canonical ACL is approved;
- mobile basic publication editing;
- newer-working-version notice;
- feature flags/rollback.

Optional sub-slice only after DEC-PROJ-108:

- video upload/processing/poster/limits.

Не входит:

- comments;
- social DMs;
- moderator author-edit;
- redesign Project editor;
- second Working Draft stack;
- arbitrary raw project downloads.

---

## 3. Data invariants

```text
Working Project / ProjectDraft
        ↓ checkpoint
exact ProjectVersion
        ↓ selected by publication draft
PublicationDraft (mutable)
        ↓ publish transaction
PublicationRevision (immutable)
        ↓
live public page
```

PublicationDraft is not Working Project draft.

Restore never mutates an old revision; it creates a new immutable revision based on selected prior state.

---

## 4. Autosave / conflict behavior

UI states:

- `Сохраняем…`;
- `Все изменения сохранены`;
- `Есть неопубликованные изменения`;
- offline/failed save with retry semantics.

Requirements:

- debounced/bounded autosave;
- server validation;
- no live publication mutation on autosave;
- conflict/version handling if two editor sessions exist;
- no lost updates silently;
- preview reads current draft, public visitor reads current live revision.

---

## 5. Media contract

Image/physical-result media at minimum stores:

- publication association;
- kind;
- sort order;
- caption;
- alt text;
- storage key/id;
- MIME;
- byte size;
- dimensions;
- checksum;
- processing state;
- moderation-ready state field if architecture requires.

Upload pipeline:

1. validate MIME/size;
2. decode safely;
3. strip unnecessary metadata;
4. generate responsive variants/thumbnail;
5. record dimensions/checksum;
6. serve through safe public media path.

Binaries are not stored in JSON columns.

---

## 6. Mobile

On phone owner can at minimum:

- change title/description;
- change cover;
- add image from device/camera flow where browser permits;
- reorder images;
- change allowed publication settings;
- preview;
- publish.

Editing the 3D model/circuit/program itself opens the canonical tool; public publication form does not become a mobile engineering editor.

---

## 7. Permissions

- owner can edit publication draft;
- publication editor/coauthor only if explicit ACL is approved;
- teacher role alone does not grant edit rights;
- moderator restricts/hides through moderation flow, not author-edit endpoint;
- admin exceptional operations remain auditable;
- backend is source of authorization.

---

## 8. Required tests

- draft changes are invisible to visitor until publish;
- autosave survives reload;
- publish creates immutable revision tied to exact ProjectVersion;
- newer Working Project does not auto-update live revision;
- restore creates new revision, does not rewrite history;
- invalid media MIME/size rejected;
- responsive image variants generated/served;
- unauthorized user cannot edit draft/media;
- moderator cannot use author edit path;
- mobile basic edit/publish journey works;
- rollback flag leaves last live revision readable;
- existing Project editor/draft/version flows regressions remain green.

Video-specific tests are required only if video flag is enabled.

---

## 9. Acceptance Criteria

- **R7-05-AC01** public draft is separate from Working Draft.
- **R7-05-AC02** autosave never changes live revision.
- **R7-05-AC03** publish creates exact immutable PublicationRevision atomically.
- **R7-05-AC04** revision history/restore are non-destructive.
- **R7-05-AC05** cover/image/physical-result media use safe processing pipeline.
- **R7-05-AC06** owner can select published ProjectVersion explicitly.
- **R7-05-AC07** mobile basic publication editing works.
- **R7-05-AC08** backend ACL and rollback pass.
- **R7-05-AC09** video remains OFF unless complete approved pipeline exists.

---

## 10. Hygiene

Media/publication editing is high-risk: L2 threshold = 2 accepted high-risk slices.

Evidence includes:

- media sizes/variants;
- storage delta;
- new dependencies;
- largest source files;
- duplicate draft/version logic check;
- bundle/lazy-load impact;
- generated test media cleanup;
- hygiene counter.

`BLOCK` if implementation creates a second Project draft/version system or stores uploaded binary media directly in JSON/Git.

---

## 11. STOP conditions

STOP if publication draft ownership conflicts with existing ProjectProperties without resolver rule, if storage pipeline is unsafe, if video requires unapproved infrastructure, or if implementation would mutate Working Project as a side effect of editing public metadata.