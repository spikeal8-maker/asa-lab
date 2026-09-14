# PROJ-R7-03 — Public Artifact Contract

**Статус:** PREPARED / NOT ACTIVATED  
**Depends on:** accepted `PROJ-R7-01`; R7-02 may be accepted or developed independently after foundation if control-plane explicitly allows.  
**TARGET:** `docs/product/ASA_PROJECTS_IMPLEMENTATION_TZ.md`

---

## 0. Activation gate

Coding starts only when this exact slice is selected in `docs/execution/current.yaml`, current main has been delta-checked, and publication foundation is accepted.

---

## 1. Пользовательский результат

Public Projects получает безопасный module-neutral contract для read-only интерактивного просмотра опубликованной immutable версии.

Browser больше не должен получать Working Draft только потому, что конкретному viewer нужен document payload.

Target chain:

```text
exact ProjectVersion
→ module-specific sanitizer / artifact builder
→ versioned Public Artifact
→ read-only viewer
```

---

## 2. Scope

Входит:

- artifact envelope/schema version;
- server-side artifact build/validation;
- module adapter registry/interface;
- capability projection;
- size/depth limits;
- cache/version semantics;
- public access checks;
- fallback when module adapter absent/invalid;
- security/unit/integration tests;
- observability artifact-build failures.

Не входит:

- полноценный 3D/Electronics/Blocks/Game UI viewer;
- editor reuse as public authoring runtime;
- media gallery;
- comments;
- discovery ranking.

---

## 3. Mandatory artifact envelope

Conceptually:

```ts
type PublicProjectArtifact = {
  schemaVersion: string;
  publicationRevisionId: string;
  projectVersionId: string;
  moduleKey: string;
  artifactVersion: string;
  capabilities: {
    canRun?: boolean;
    canRotate?: boolean;
    canZoom?: boolean;
    canFullscreen?: boolean;
    codeVisible?: boolean;
    downloadAvailable?: boolean;
  };
  payload: unknown;
};
```

Exact naming follows repository conventions.

Must not contain private mutable metadata, auth/session information, classroom identifiers or secrets.

---

## 4. Adapter contract

Expected architecture:

```text
PublicProjectArtifactService
  ├─ resolve exact PublicationRevision
  ├─ resolve exact ProjectVersion
  ├─ select module adapter
  ├─ sanitize
  ├─ validate limits/schema
  └─ return immutable/versioned artifact

Adapters:
  ThreeD
  Electronics
  Blocks
  Games
  Graphics/other static
```

No giant `if (module === ...)` controller should own module internals.

---

## 5. Security invariants

- source is exact ProjectVersion, not current draft;
- anonymous only sees eligible publication;
- unlisted authorization follows ShareLink contract;
- payload excludes private notes/class/tenant/auth data;
- artifact is read-only by construction;
- no write capability/token included;
- size/depth/object-count limits are enforced server-side;
- malformed module data fails closed to static preview;
- unsupported module does not expose raw source as fallback.

---

## 6. REUSE / MODIFY / BUILD

### REUSE

- R7-01 PublicationRevision and authz;
- canonical ProjectVersion store;
- module registry metadata where suitable;
- existing static snapshot as fallback.

### MODIFY

- public API surface to expose artifact endpoint/capabilities;
- API client typing.

### BUILD

- artifact service;
- adapter interface/registry;
- versioned artifact schema;
- sanitizer tests/fixtures.

### DO-NOT-TOUCH

- editor autosave;
- Working Draft ownership;
- module authoring UI;
- unrelated module internals.

---

## 7. Required tests

- artifact bound to exact PublicationRevision/ProjectVersion;
- changing Working Draft does not change existing artifact identity;
- private/revoked/unlisted-without-token denied;
- no raw Working Draft fields leak;
- invalid/oversized/deep payload rejected/falls back safely;
- unsupported module returns controlled `static-only` capability;
- adapter registry selects correct module;
- cache invalidates only on publication revision/artifact version change;
- authorization tests are server-side;
- static R7-02 page remains functional when artifact service fails.

---

## 8. Acceptance Criteria

- **R7-03-AC01** artifact source is exact immutable ProjectVersion.
- **R7-03-AC02** schema is explicitly versioned.
- **R7-03-AC03** module sanitization occurs server-side.
- **R7-03-AC04** public payload excludes raw/private mutable state.
- **R7-03-AC05** size/depth limits exist and are tested.
- **R7-03-AC06** unsupported/failed adapter falls back to static preview.
- **R7-03-AC07** no editor write capability exists in artifact contract.
- **R7-03-AC08** adapter architecture avoids duplicated project domain.
- **R7-03-AC09** focused security/integration tests pass on exact final SHA.

---

## 9. Hygiene

This is a high-risk runtime/security slice. Treat L2 threshold as **2 accepted high-risk Public Projects slices** and trigger earlier if artifact service becomes giant, module logic is duplicated, or payload/bundle size grows unexpectedly.

Evidence records source-file sizes, adapter boundaries, new dependencies and hygiene counter.

---

## 10. STOP conditions

STOP if implementation would require exposing current Working Draft, copying module engines into Public Projects, adding write operations to public artifact, or inventing a second ProjectVersion store.