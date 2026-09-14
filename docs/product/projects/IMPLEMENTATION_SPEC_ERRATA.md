# Public Projects — Implementation Spec Errata / Convergence Notes

**Статус:** normative correction layer until the large Implementation Spec is physically reconverged.  
**Applies to:** `docs/product/ASA_PROJECTS_IMPLEMENTATION_SPEC.md`  
**Evidence:** `docs/product/ASA_PROJECTS_CURRENT_ARCHITECTURE_AUDIT.md` + `PROJ-A0-DELTA-2026-09-14.md`.

---

# 1. Почему этот файл существует

`ASA_PROJECTS_IMPLEMENTATION_SPEC.md` создавался до последней фактической проверки current `main`. В его AS-IS описании есть утверждение, смысл которого: current Gallery не отдаёт raw project JSON и уже является безопасной sanitized public boundary.

Это **не соответствует проверенному current main**.

Пока большая спецификация не переписана целиком, этот errata-файл имеет нормативный приоритет для AS-IS фактов.

---

# 2. ERR-PROJ-001 — current Gallery detail читает mutable Working Draft

Фактическая проверенная цепочка:

```text
project_publications
→ gallery_work()
→ LEFT JOIN project_drafts
→ project_drafts.document_json
→ GalleryController returns work.document
→ GalleryWorkPage interprets document in browser
```

Следствия:

- current public detail зависит от mutable Working Draft;
- изменение Working Draft после publish способно изменить данные, читаемые current detail flow;
- raw module document сейчас входит в legacy Gallery detail payload;
- этот endpoint нельзя просто сделать anonymous и объявить целевым Public Projects API.

**Normative target remains:**

```text
exact immutable ProjectVersion
→ PublicationRevision
→ server-side safe Public Artifact / sanitized projection
→ public viewer
```

---

# 3. ERR-PROJ-002 — current copy/remix source также mutable

Current `gallery_copy_to_projects()` использует `project_drafts.document_json` как source.

Target R7-01 обязан сохранить существующую useful copy/provenance semantics, но изменить source:

```text
live PublicationRevision
→ exact project_version_id
→ immutable ProjectVersion.document_json
→ new independent private Project
```

Нельзя строить второй copy stack.

---

# 4. ERR-PROJ-003 — snapshot_revision не равен ProjectVersion

Current `project_publications.snapshot_revision` связан с static snapshot/source revision и не доказывает exact immutable `project_versions.id`.

Target publication must bind exact immutable ProjectVersion.

Legacy convergence не должна ложно утверждать, что исторический snapshot_revision уже является ProjectVersion.

---

# 5. ERR-PROJ-004 — current anonymous access отсутствует

Legacy Gallery current contract требует Account/StudentSeat viewer session.

Target anonymous access applies only to eligible sanitized public projection introduced by R7. Не снимать legacy guard с endpoint, который отдаёт mutable document.

---

# 6. ERR-PROJ-005 — unpublish currently destructive to publication/reaction state

Current legacy `gallery_unpublish()` deletes publication row; reaction storage can cascade with it.

Target revoke/unpublish is non-destructive for:

- Working Project;
- ProjectVersion;
- immutable PublicationRevision history;
- migration-preserved social state according to accepted R7-01 decision.

---

# 7. Приоритет документов

Для **AS-IS factual claims** использовать:

1. current repository code/schema/tests;
2. `ASA_PROJECTS_CURRENT_ARCHITECTURE_AUDIT.md`;
3. latest `PROJ-A0-DELTA-*.md`;
4. этот `IMPLEMENTATION_SPEC_ERRATA.md`;
5. старые AS-IS paragraphs `ASA_PROJECTS_IMPLEMENTATION_SPEC.md`.

Для **TARGET / acceptance** использовать:

1. `ASA_PROJECTS_IMPLEMENTATION_TZ.md`;
2. active task card in `docs/product/projects/tasks/`;
3. `DECISION_LEDGER.md`;
4. relevant UI/UX sections;
5. Implementation Spec deep reference where it does not conflict with current audit/errata.

---

# 8. Coding rule

Если агент видит в Implementation Spec фразу, противоречащую audit/errata по current implementation, он не выбирает удобную версию сам. Он следует фактическому current code + audit/errata и фиксирует divergence в evidence.

Этот документ не разрешает product coding и не заменяет `docs/execution/current.yaml`.