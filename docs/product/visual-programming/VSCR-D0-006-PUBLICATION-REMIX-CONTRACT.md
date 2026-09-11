# VSCR-D0-006 — Publication, player and cross-tenant remix contract

**Status:** accepted design prerequisite for future `VSCR-M2-*`; no M2 coding is authorised by this document  
**Master:** [`../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`](../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md)

This contract exists because the current ASA Gallery semantics are not sufficient for a
Scratch-backed project with external binary assets. It fixes the required target before an
M2 implementation package is written.

---

## 1. Audit finding

Current ASA Gallery publication stores project identity and a snapshot revision, while
`gallery_work()` and `gallery_copy_to_projects()` read the **current project draft**.

That means a project may be published at state A, edited to state B, and later be opened or
copied from the Gallery as B while its publication image still represents A.

For Blocks this is unacceptable because:

```text
player must execute exactly the published programme
publication must remain immutable
assets[] are tenant-scoped private references
cross-tenant copy cannot merely duplicate JSON
```

Therefore future Blocks Gallery integration MUST NOT call the current draft-copy semantics
as if they were immutable publication semantics.

---

## 2. Publication identity

Every new Blocks publication is bound to an immutable `project_versions.id`.

Logical publication identity:

```text
project_id
project_version_id
snapshot_revision / publication thumbnail evidence
published_at
publication metadata
```

`project_version_id` is the executable source of truth for the published work.

A Blocks player never loads `project_drafts.document_json` for Gallery/publication view.

---

## 3. General Gallery convergence direction

The preferred platform fix is additive and subject-neutral:

```sql
ALTER TABLE project_publications
  ADD COLUMN project_version_id uuid NULL;
```

The final migration must use the repository's current tenant/project-version FK pattern and
must not invent a cross-tenant bypass.

New publication flow after convergence:

```text
confirmed current draft
→ create/reuse immutable ProjectVersion through canonical Project Core semantics
→ generate/confirm snapshot for that exact revision/version
→ write publication row with exact project_version_id
```

A new Blocks publication MUST require non-null `project_version_id`.

Legacy publications that predate version pinning may remain nullable for compatibility;
the migration MUST NOT fabricate a historical version and claim it is the originally
published state when that fact cannot be reconstructed.

Legacy fallback behaviour, if retained, must be explicitly labelled legacy and is not
valid evidence for Blocks acceptance.

---

## 4. Gallery work/read semantics

For version-pinned publication:

```text
gallery list metadata
→ publication row

gallery work/player document
→ project_versions.document_json at publication.project_version_id

gallery image
→ snapshot bound to the publication's confirmed revision/version evidence
```

A future `gallery_work()`/application projection MUST prefer the pinned immutable version
when `project_version_id` is present.

The Blocks player receives only:

```text
projectId
projectVersionId
read-only version capability
immutable Blocks document
referenced asset GET authority for that version
```

No draft-write capability is issued from a Gallery route.

---

## 5. Blocks asset read for published versions

The object bucket remains private.

A version-scoped player capability may read an asset only when:

```text
publication authorises exact projectVersionId
AND version document contains (assetId,dataFormat,sha256,sizeBytes)
AND source-tenant alias/blob metadata matches that canonical ref
```

Publication does not make a tenant bucket public and does not expose object keys or
presigned tenant-wide access.

---

## 6. Cross-tenant remix cannot be SQL JSON copy

The current Gallery copy function copies `document_json` into a new project's draft. That
is insufficient for Blocks because the copied document's asset aliases belong to the
source tenant.

For Blocks, a cross-tenant remix is an application-layer orchestration with privileged
server-side storage access, never a browser direct-copy operation.

Required sequence:

```text
1. authenticate destination principal
2. authorise exact immutable published source version
3. resolve destination personal/workspace tenant through existing ASA rules
4. load source Blocks version document
5. validate source document and every canonical asset ref
6. for each referenced asset:
     read exact source-tenant blob internally
     persist/reuse exact bytes in destination tenant object namespace
     create/reuse destination tenant immutable Scratch alias
     verify destination canonical ref preserves assetId/dataFormat/sha256/sizeBytes
7. only after all referenced assets are durable in destination tenant:
     create destination project/draft through canonical Project Core path
     store unchanged compatible Blocks document refs
     store immutable provenance to source project/publication/version
8. return destination project id
```

The browser never receives source object-store credentials or a cross-tenant bucket URL.

---

## 7. Failure ordering for remix

External object persistence cannot be part of one PostgreSQL transaction. Therefore the
same safety principle as asset upload applies:

```text
asset copy fails before destination project commit
→ no destination project/draft is created

all destination blobs durable, DB project transaction fails
→ possible destination orphan blobs/aliases
→ request fails
→ do not delete objects inline
```

Orphan bytes are preferable to a destination project that references missing assets.
Reference-safe GC remains a later design.

---

## 8. Provenance

Blocks remix provenance must identify at least:

```text
source project id
source immutable project version id
source publication identity/version evidence
source author label/identity allowed by existing privacy policy
copy timestamp
```

Existing ASA copy-origin semantics may be extended additively. Existing provenance MUST
NOT be removed or rewritten by later project edits.

A copied Blocks project is an independent destination draft after creation; future source
changes never mutate it.

---

## 9. Same-tenant copy

A same-tenant copy may reuse the same immutable alias/blob metadata because authorisation
and storage ownership remain in one tenant.

Even in same-tenant copy, the source document must come from the exact authorised immutable
publication version rather than the current draft.

---

## 10. Learning is separate from Gallery publication

Learning submission already pins `project_version_id`. Blocks MUST reuse that canonical
submission lineage and MUST NOT route assignment submissions through Gallery publication.

The required distinction is:

```text
Learning submission → immutable evidence for assessment
Gallery publication → immutable evidence for sharing/player/remix
```

Both point at immutable ProjectVersion semantics, but they have different authorisation and
lifecycle rules.

---

## 11. Required M2 implementation package before coding

Before any `VSCR-M2` Gallery/player/remix code is selected, write a bounded package that
names exact current paths after M1 acceptance and includes at least:

```text
additive publication-version migration
publication use case/controller changes
legacy publication compatibility semantics
version-scoped player issuance/read path
Gallery work projection from immutable version
Blocks destination asset materialiser/copy service
cross-tenant negative tests
same-tenant copy tests
failure/orphan tests
OpenAPI changes
browser player/remix journey
```

Do not implement this contract opportunistically inside M1 storage or save tasks.

---

## 12. Acceptance requirements

Future M2 publication/remix work is not accepted until tests prove:

```text
1. publish Blocks revision N and record exact immutable projectVersionId N
2. edit draft to N+1
3. Gallery player still executes N
4. Gallery metadata/image/version are coherent with published N
5. player token cannot write draft/assets/snapshot
6. source-tenant unpublished/current draft is never exposed by published player
7. same-tenant remix reads pinned version, not current draft
8. cross-tenant remix copies every referenced asset into destination tenant ownership
9. destination project opens after source tenant access is revoked from the copier
10. forged/unreferenced/cross-tenant asset refs are rejected
11. mid-copy object failure creates no broken destination project
12. DB failure after object materialisation may orphan bytes but creates no partial project
13. provenance points to exact source publication/version and is immutable
14. existing non-Blocks Gallery behaviour has explicit regression coverage
```

Any proposal to make the Blocks bucket public or to copy current draft JSON as a shortcut
is a STOP condition.