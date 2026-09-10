# VSCR-D0-002 — Blocks persistence contract

**Status:** accepted design contract for the Visual Programming programme  
**Master:** [`../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`](../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md)

This contract fixes how Blocks durability integrates with the existing subject-neutral
Project Core. It exists specifically to prevent a coding agent from either weakening
Blocks validation or redesigning Project Core while implementing save/load.

---

## 1. Existing Project Core remains canonical

The existing Project Core concepts remain unchanged:

```text
Project
ProjectDraft
ProjectVersion
optimistic revision
mutationId idempotency
checkpoint
restore
snapshot sourceRevision
```

Blocks MUST reuse the existing `SaveDraftUseCase` and repository semantics. It MUST NOT
create `blocks_projects`, `blocks_drafts`, a second version table or an alternate revision
counter.

---

## 2. Problem this contract solves

Current module structural validation is synchronous:

```text
module.validateDocument(document)
```

Blocks durability additionally requires asynchronous server checks:

```text
does every asset alias exist?
does it belong to the same tenant?
does alias digest/size match document?
does every projectJson asset have exactly one canonical ref?
is the project total within limits?
```

Changing the whole Module SDK to async is forbidden. Performing those checks only in a
Blocks-specific controller is also forbidden because the existing generic
`PUT /api/projects/{projectId}/draft` would become a bypass.

---

## 3. Decision: generic async pre-save persistence guard

Project Core receives one additive generic application port. The port contains no Scratch
or Blocks types.

Target logical shape:

```ts
export type ProjectPersistenceGuardFailureCode =
  | 'validation_error'
  | 'dependency_unavailable';

export type ProjectPersistenceGuardResult =
  | { ok: true }
  | {
      ok: false;
      code: ProjectPersistenceGuardFailureCode;
      message: string;
    };

export interface ProjectDraftPersistenceGuardPort {
  validate(input: {
    tenantId: string;
    projectId: string;
    actor: ProjectActor;
    moduleKey: string;
    document: JsonValue;
  }): Promise<ProjectPersistenceGuardResult>;
}
```

Names may differ only if the authorised implementation task keeps the same semantics and
updates this document before coding. The port must remain subject-neutral.

---

## 4. SaveDraftUseCase order is fixed

The canonical save order becomes:

```text
1. validate baseRevision
2. validate mutationId
3. load project with existing actor/tenant access rules
4. resolve module provider
5. synchronous module.validateDocument(input.document)
6. async persistenceGuard.validate(parsed.document)
7. repository.saveDraft(...)
8. on null result, preserve existing project_revision_conflict semantics
```

The persistence guard MUST run **before** `repository.saveDraft()` and after structural
module parsing so it receives the canonical parsed document.

It MUST NOT increment a revision, create a checkpoint, mutate the draft or write asset
bytes.

---

## 5. Composition model

`contexts/projects` defines the generic port only.

Blocks-specific guard implementation belongs outside Project Core, for example:

```text
contexts/blocks/application/
  validate-durable-document.ts

apps/api/src/
  blocks-persistence.guard.ts
```

The API/composition layer supplies one `ProjectDraftPersistenceGuardPort` implementation
to `SaveDraftUseCase`.

The implementation behaves as a registry/delegator:

```text
moduleKey != blocks → allow
moduleKey == blocks → BlocksDurableDocumentValidator
```

Do not make Project Core import `@asa-lab/blocks` just to choose a validator. Composition
knows both sides; the Project context does not.

---

## 6. Non-Blocks behaviour must remain identical

For every module other than `blocks`, the guard is a no-op success. Existing Electronics,
Chess, Checkers and 3D save semantics must not change.

Required regression tests:

```text
existing non-blocks valid draft still saves
existing non-blocks invalid structural document still fails in module validation
existing revision conflict status/message semantics remain unchanged
existing mutationId retry/idempotency semantics remain unchanged
```

No neighbouring subject test is rewritten to accommodate Blocks.

---

## 7. Blocks durable-document validation

After the synchronous Blocks module validator has produced `BlocksProjectDocumentV1`, the
async Blocks guard performs all of the following.

### 7.1 Empty pre-initialisation document

This is allowed:

```json
{
  "schemaVersion": 1,
  "format": "scratch-3",
  "projectJson": null,
  "assets": []
}
```

It is only a pre-VM state. A non-null `assets[]` with `projectJson:null` is rejected.

### 7.2 Project JSON validation

For non-null `projectJson`, first validate:

```text
serialised size <= configured projectJson limit
plain JSON object
Scratch 3 top-level shape
all target costume/sound references are structurally valid
all assetId/dataFormat/md5ext fields satisfy v1 identity rules
```

The M0 synchronous validator is intentionally not a full semantic Scratch parser. The
persistence layer may use an infrastructure compatibility validator that is pinned and
tested against the selected Scratch release, but Scratch parsing code MUST NOT enter the
Project Core context.

If `scratch-parser` is selected for this validation, use the version compatible with the
pinned Scratch VM and keep it in Blocks/API infrastructure; do not add Scratch parser
packages to the ASA Web bundle. The exact dependency version is pinned in the
implementation PR and must pass license/security gates.

A bot MUST NOT replace this with a hand-written “looks roughly like Scratch” semantic
validator without a dedicated design change.

### 7.3 Extract canonical referenced asset set

The server derives the expected set from `projectJson`; it does not trust the submitted
`assets[]` list to tell it what the project references.

For each target:

```text
costumes[] → (assetId, dataFormat, md5ext)
sounds[]   → (assetId, dataFormat, md5ext)
```

The expected set is unique by:

```text
(assetId, dataFormat)
```

For v1:

```text
assetId = lowercase 32-hex
md5ext = assetId + '.' + lower-case dataFormat
```

Duplicate references in the Scratch graph are allowed; duplicate canonical entries in
`assets[]` are not.

### 7.4 Compare expected set to submitted canonical refs

Required equality:

```text
expected projectJson asset key set == document.assets key set
```

Reject:

```text
missing canonical ref
extra unreferenced canonical ref
duplicate canonical ref
wrong dataFormat
invalid sha256
negative/non-integer sizeBytes
same key repeated with different digest/size
```

### 7.5 Verify server metadata

For every canonical ref the guard loads server asset metadata by:

```text
tenantId + assetId + dataFormat
```

It requires:

```text
alias exists
alias belongs to same tenant
alias.sha256 == document.sha256
blob exists in metadata
blob.sizeBytes == document.sizeBytes
blob.dataFormat matches
```

The guard does not accept `objectKey` from the document because v2 removes it from the
persistent contract.

A separate object-store HEAD on every autosave is not required if relational blob
metadata is authoritative and asset PUT only commits metadata after successful object
persistence. Object existence is proven at upload time and by backup/integrity tests.

### 7.6 Project aggregate limit

Sum `sizeBytes` once per unique canonical reference and require:

```text
total <= configured Blocks project asset limit
```

This prevents a forged document from bypassing upload limits by referencing an excessive
number of already-known aliases.

---

## 8. Asset-before-document invariant

The guard never creates missing assets. Missing asset metadata is a validation failure.

The browser/runtime save orchestrator must therefore do:

```text
ensure referenced asset durable
→ receive canonical ref
→ build document
→ save draft
```

The server does not attempt to repair a broken draft by fetching bytes from Scratch or
other external hosts.

---

## 9. Failure mapping

Structural/durability rejection maps to the normal API validation family:

```text
HTTP 400
error.code = validation_error
```

Examples:

```text
blocks_asset_reference_missing
blocks_asset_reference_extra
blocks_asset_reference_mismatch
blocks_asset_identity_invalid
blocks_project_too_large
```

These detailed reason identifiers may appear as safe machine-readable subcodes/details,
but existing top-level Project Core error contracts must not be broken casually.

If the persistence guard cannot query the required Blocks metadata because the dependency
is unavailable, it returns:

```text
dependency_unavailable
```

The transport maps this to a retryable service error, not a fake validation error and not
a saved revision.

The exact HTTP mapping must be added to OpenAPI in the same implementation slice.

---

## 10. Generic project-draft API must not bypass durability

Because the guard is inside `SaveDraftUseCase`, both:

```text
PUT /api/projects/{projectId}/draft
PUT /api/blocks/runtime/projects/{projectId}/draft
```

receive identical Blocks persistence validation when they invoke the use case.

The dedicated runtime route adds capability/origin transport security; it does not own a
second save implementation.

Required negative test:

```text
1. create a test Blocks project
2. submit structurally valid document with forged/missing asset through generic project API
3. assert no new revision is committed
```

This test is mandatory before activation.

---

## 11. Duplicate/restore/checkpoint semantics

### 11.1 Checkpoint

Checkpoint copies an already durable project document into immutable version storage. It
does not re-upload assets and does not mutate alias/blob metadata.

### 11.2 Restore

Restore uses an immutable previously accepted document. It may become the draft again
without rewriting its asset refs. A post-restore load test must prove the referenced blobs
still resolve.

### 11.3 Same-tenant duplicate

Existing `DuplicateProjectUseCase` copies a durable same-tenant document. Since canonical
asset aliases are tenant-scoped and immutable, no new blob copy is required for a normal
same-tenant duplicate.

Cross-tenant remix is not `DuplicateProjectUseCase`; it belongs to the later Gallery/remix
integration and must establish destination-tenant asset ownership first.

---

## 12. Technical test project creation

M1 acceptance needs a Blocks project while `blocks` is still `coming_soon`.

The authorised implementation introduces a **test-only fixture factory**, located under
Blocks/testing or the existing test-kit conventions. It may call repository/test helpers
directly against an isolated test DB.

It MUST NOT:

```text
change module availability
add a production hidden endpoint
require manual SQL INSERT as the normal test journey
ship test creation code into production routing
```

Fixture initial document is exactly:

```json
{
  "schemaVersion": 1,
  "format": "scratch-3",
  "projectJson": null,
  "assets": []
}
```

---

## 13. Autosave transaction identity

For one serialised VM state:

```text
mutationId is UUIDv4
baseRevision is last confirmed server revision
document fingerprint is stable for retry
```

If a network/token failure retries the same exact document, reuse the same mutation ID.

If the VM changes and a new document is serialised, allocate a new mutation ID even when
the previous one has not yet succeeded.

Only one draft PUT is in flight per editor; the client queues the newest generation.

---

## 14. Conflict behaviour

`project_revision_conflict` preserves current Project Core meaning.

On 409 the runtime:

```text
stops remote autosave
keeps local recovery
fetches current server metadata
shows conflict
never retries with a guessed newer baseRevision
never silently overwrites
```

No JSON graph merge exists in the core programme.

---

## 15. Allowed Project Core changed paths for this contract

A persistence implementation may need the minimum additive change in:

```text
contexts/projects/application/ports.ts
contexts/projects/application/project.usecases.ts
contexts/projects/testing/**
apps/api/src/app.module.ts or equivalent composition
```

Any modification beyond the generic port/use-case composition requires a new reason before
editing.

Forbidden examples:

```text
new ProjectDraft schema
new ProjectVersion schema
new revision algorithm
Blocks imports inside contexts/projects
rewriting repository SQL for unrelated modules
```

---

## 16. Acceptance gate for the persistence contract implementation

Must prove:

```text
1. ModuleProvider validation remains synchronous
2. generic async persistence guard runs before repository.saveDraft
3. non-blocks saves behave identically
4. empty Blocks pre-VM document is accepted
5. non-null project derives its expected asset set from projectJson
6. missing/extra/duplicate refs are rejected
7. alias digest/size mismatch is rejected
8. cross-tenant ref is rejected
9. project total-size limit is enforced
10. generic project draft API cannot bypass the guard
11. runtime draft route reuses SaveDraftUseCase
12. conflict/idempotency semantics remain unchanged
13. checkpoint/restore of accepted document keeps asset refs intact
14. dependency failure never commits a revision
15. focused tests plus Project Core regression tests pass
```

The implementation is not allowed to activate `blocks`.