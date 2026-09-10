# ADR-VSCR-001 — Scratch-backed visual programming

Status: **accepted architecture; implementation is gated by VSCR-D0 contracts**  
Issue: **#176**  
Module key: **`blocks`**

Master implementation contract:  
[`ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`](../product/ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md)

Detailed design contracts:  
[`docs/product/visual-programming/`](../product/visual-programming/)

This ADR owns the stable architecture decisions for Scratch integration. The master
specification owns TARGET, programme order, safety invariants and acceptance. The D0 files
own exact implementation-boundary decisions. None of these documents owns current task,
checkpoint, branch/PR, deployment or owner acceptance; current execution remains governed
by `docs/execution/current.yaml` and `AGENTS.md`.

## Context

ASA Lab already owns authentication, subject-neutral projects, immutable project versions,
classrooms, Learning assignments/submissions, publication and project previews.
Reimplementing these concerns as a copy of `scratch.mit.edu` would create a second
identity/LMS/project system and violate ASA module boundaries.

The Scratch Foundation maintains `scratchfoundation/scratch-editor`. ASA uses its
editor/runtime implementation as a subject engine, not its website/social backend.

The integration also has a non-negotiable product goal: the supported school baseline must
not depend on availability of Scratch Foundation network services.

---

## Decision 1 — keep the existing `blocks` capability

The reserved ASA module key `blocks` is the Scratch-3-compatible Visual Programming
capability. Do not add a competing `scratch` module.

User-facing naming is `Визуальное программирование`; Scratch compatibility is described
factually rather than as official Scratch branding.

The module remains `coming_soon` until the final activation milestone. A real provider may
exist while creation is gated.

---

## Decision 2 — separate runtime boundary, ASA-owned host

Scratch packages do not become dependencies of the main ASA Vite/Web bundle.

The pinned upstream editor is built in its own container. The M0 runtime that serves
Scratch's `packages/scratch-gui/build/index.html` is **only build/health evidence**.

M1+ product runtime uses the upstream shipping standalone distribution wrapped by an
ASA-owned host:

```text
exact scratch-editor pin
→ production scratch-gui standalone dist
→ ASA host/bootstrap/storage/save orchestrator
→ Nginx runtime container
```

The host uses upstream exported extension points (`EditorState`, `createStandaloneRoot`,
`GUIStorage`, `ScratchStorage`, `onVmInit`, player mode) and avoids a fork unless the
adapter surface is proven insufficient.

The M0 upstream lock remains machine-readable in `infra/scratch-editor/upstream.env`.

---

## Decision 3 — ASA Project Core remains the project system of record

Scratch runtime owns:

- block editor and palettes;
- VM/execution;
- stage/rendering;
- sprites, costumes and sounds;
- Scratch 3 project compatibility.

ASA owns:

- accounts/sessions/tenant authority;
- projects/drafts/optimistic revisions;
- immutable versions/checkpoints;
- classroom/Learning/submissions;
- gallery/remix provenance;
- binary asset durability;
- backups/deployment/observability.

There is no Scratch user database, project database, classroom database, LMS or parallel
social backend.

---

## Decision 4 — persistent document contains logical asset identity, not storage topology

The corrected v1 project envelope is:

```text
BlocksProjectDocumentV1
├── schemaVersion = 1
├── format = scratch-3
├── projectJson = Scratch project.json | null
└── assets[]
    ├── assetId
    ├── dataFormat
    ├── sha256
    └── sizeBytes
```

`objectKey` is deliberately **not** part of the project document. Bucket/object/provider
location is server-only infrastructure metadata.

This corrects the initial M0 draft schema before real user Blocks data exists. The code
contract must be changed in an explicit M0.1 task before durable implementation proceeds.

Scratch compatibility identity is preserved separately from ASA integrity:

```text
assetId/md5ext = Scratch compatibility identity
sha256         = ASA byte integrity
objectKey      = server-only physical locator
```

For core v1 supported assets, the server verifies MD5(bytes) equals Scratch `assetId` and
computes SHA-256 itself.

---

## Decision 5 — binary assets use tenant-scoped immutable object storage

Costume/sound/image bytes are not stored in Project Core JSONB.

Server metadata separates:

```text
blocks_blobs
  tenant + sha256 + format + size + objectKey

blocks_asset_aliases
  tenant + Scratch assetId + format → sha256
```

Aliases are immutable. A later upload cannot retarget an existing Scratch alias to
different bytes.

The physical store is private S3-compatible storage. `@aws-sdk/client-s3` is the selected
client boundary; MinIO is the self-hosted/local S3-compatible backend when used.

No GC is implemented on the activation path. Orphans are preferable to broken historical
versions.

---

## Decision 6 — Project Core receives a generic async durability guard

Current module structural validation remains synchronous.

Blocks requires asynchronous proof that every project asset reference is durable and
same-tenant before a draft revision can commit. Performing that only in a Blocks controller
would leave the generic Project API as a bypass; making the whole Module SDK async would
be unnecessary cross-cutting churn.

Therefore Project Core receives one generic additive pre-save persistence guard port:

```text
structural module validation
→ generic async persistence guard
→ repository.saveDraft
```

The Project context knows only the generic port. Blocks-specific implementation lives
outside Project Core and is supplied by composition.

Non-Blocks modules receive an allow/no-op guard and retain existing behaviour.

---

## Decision 7 — ASA owns autosave orchestration

Upstream Scratch server save is disabled in the ASA host.

The pinned Scratch ProjectSaver dirty model is a boolean and can clear dirty state after an
asynchronous save even when another edit happened during that save. ASA requires explicit
generation-aware save correctness.

The ASA host therefore obtains VM through `onVmInit`, listens for VM project-change events
and owns:

```text
change generation
debounce/hard dirty deadline
one in-flight save
latest-state queue
ensureReferencedAssetsDurable
optimistic baseRevision + mutationId
conflict/retry/token wait
IndexedDB recovery
ASA save-status messages
```

The implementation must not run upstream server autosave and ASA autosave simultaneously.

---

## Decision 8 — clean/default assets must also become durable

Scratch's `asset.clean` means the editor does not consider that asset newly dirty. It does
not prove ASA object storage contains the bytes.

Before every accepted document save, ASA derives referenced assets from `vm.toJSON()` and
ensures every reference has a canonical server asset record. Missing refs are uploaded from
VM asset bytes even when Scratch considers the asset clean.

This specifically protects the pinned default Scratch project/assets on first save.

---

## Decision 9 — runtime is a separate browser trust surface

Scratch runtime iframe uses a distinct browser origin and receives no ambient ASA account
session authority.

Editor/runtime requests use a short-lived project-scoped bearer capability. Core v1 uses
standard JWS/JWT via `jose`, exact issuer/audience/module/project/permissions and a separate
server signing key.

Normal ASA cookie API origin rules remain unchanged.

`/api/blocks/runtime/**` receives its own exact runtime-origin CORS/path policy and requires
bearer authority. The Scratch runtime origin must never be added as a generic trusted
cookie mutation origin.

Viewer/player authority is a separate immutable-version read-only capability.

---

## Decision 10 — `.sb3` is interchange, not storage

Import:

```text
.sb3
→ route-scoped safe ZIP processing
→ project.json + assets validation
→ durable blobs/aliases
→ canonical Blocks project document
→ Project Core save
```

Export:

```text
canonical draft/version
→ resolve exact assets
→ project.json + Scratch-named asset files
→ .sb3 ZIP
```

Full archives are never autosaved into Project Core JSONB.

---

## Decision 11 — sovereign baseline and backup precede activation

The old order that activated Blocks before sovereign/backup acceptance is rejected.

Correct programme order:

```text
M0 foundation
→ D0 design convergence
→ M0.1 schema correction
→ M1 durable persistence
→ M2 ASA product integration while still coming_soon
→ M3 local-network independence + backup/restore + deployment acceptance
→ M4 final activation coming_soon → active
```

Reason: once users can create Blocks projects, PostgreSQL-only backup is insufficient and
Scratch Foundation network unavailability must not break the supported school baseline.

---

## Decision 12 — backup consistency relies on immutable blob ordering

Save ordering is:

```text
blob bytes
→ blob/alias metadata
→ project document revision
```

Core programme GC is off and blobs are immutable. Baseline backup therefore captures
PostgreSQL first, then mirrors object storage without deleting extras, then verifies every
captured DB asset reference resolves in the object backup.

A missing referenced blob fails backup acceptance.

---

## Update policy

Scratch upstream never moves automatically from a branch or release watcher into
production.

A pin update must pass evidence appropriate to implemented milestones:

1. exact version/commit and license/security inventory;
2. ASA host image build/health;
3. old fixture load;
4. durable save/reopen and asset integrity after M1;
5. `.sb3` round trip after M1;
6. read-only player and immutable submission after M2;
7. local-library/network-deny and backup compatibility after M3.

All intentional upstream API couplings are enumerated in
`VSCR-D0-001-SCRATCH-HOST-CONTRACT.md`.

---

## Consequences

The architecture intentionally spends more design work before M1 coding so later agents
do not invent incompatible persistence/security systems.

The main costs are:

- a generic additive Project Core persistence-guard port;
- tenant-scoped object metadata/storage;
- separate runtime capability/origin policy;
- an ASA-owned save orchestrator instead of upstream server save;
- backup/deployment acceptance before product activation.

The benefit is that Visual Programming remains one ASA Lab capability: recoverable,
versioned, tenant-safe and deployable in a school without relying on the Scratch website.