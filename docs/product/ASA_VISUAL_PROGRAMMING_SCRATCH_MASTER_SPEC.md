# ASA Lab Visual Programming — Scratch integration master specification

**Version:** 3.0  
**Date:** 11 September 2026  
**Module:** `blocks`  
**Product name:** `Визуальное программирование`

This is the **stable product/architecture master**. It defines the destination, invariants and
milestone order. It is intentionally short enough to remain useful to humans and agents.

It does **not** select the active task. Execution state lives only in
`docs/execution/current.yaml` plus explicit owner instruction.

For implementation/maintenance routing, start at:

```text
docs/product/visual-programming/README.md
→ AGENT_GUIDE.md
→ COMPONENT_MAP.yaml
→ one selected task card / one matching D0 contract
```

Do not read all Scratch documentation by default.

---

## 1. Product goal

ASA Lab provides a self-hostable visual-programming environment using the Scratch 3
editor/runtime model while ASA remains the system of record.

Primary learner journey:

```text
create ASA Visual Programming project
→ open ASA-branded editor
→ edit blocks, sprites, costumes and sounds
→ run
→ durable autosave to ASA Lab
→ close/reopen and receive the same project
→ create immutable version/checkpoint
→ submit / publish / remix / export .sb3 when applicable
```

The supported school baseline must not depend on `scratch.mit.edu` being reachable.

---

## 2. Ownership boundary

Scratch owns:

```text
block editing mechanics
VM/runtime execution
renderer
paint/sound editor mechanics
Scratch 3 project compatibility
```

ASA owns:

```text
identity and authorisation
projects and drafts
immutable project versions
classrooms and Learning submissions
Gallery publication/player/remix
asset durability
save/recovery/conflict semantics
object storage
backup/restore
deployment and activation
product branding
```

There must not be a second Scratch account system, LMS, social backend, gradebook or project
database inside ASA.

---

## 3. Stable architecture

```text
ASA Lab Web
└── separate-origin iframe
    └── ASA Scratch Host
        ├── pinned Scratch GUI standalone distribution
        ├── ASA host bootstrap/config
        ├── ASA Scratch storage adapter
        └── ASA save/recovery orchestrator
             ↓ short-lived capability
        ASA Blocks Runtime API
        ├── Project Core use cases
        ├── Blocks durability guard
        ├── tenant-private asset metadata
        ├── private S3-compatible blob store
        └── existing snapshot/version systems
```

Scratch GUI/VM dependencies remain outside the main ASA Web dependency graph.

---

## 4. Canonical project document

```ts
interface BlocksProjectDocumentV1 {
  schemaVersion: 1;
  format: 'scratch-3';
  projectJson: Record<string, unknown> | null;
  assets: BlocksAssetReferenceV1[];
}

interface BlocksAssetReferenceV1 {
  assetId: string;
  dataFormat: 'svg' | 'png' | 'jpg' | 'wav' | 'mp3';
  sha256: string;
  sizeBytes: number;
}
```

Identity rules:

```text
assetId    Scratch compatibility identity; v1 lowercase 32-hex MD5
sha256     ASA server-computed integrity digest
objectKey  server-only physical locator; never in project JSON
.sb3       interchange only; never autosave persistence
```

A durable Blocks document may not reference an unverified/missing asset.

---

## 5. Product branding and host boundary

User-facing product branding is **ASA Lab — Визуальное программирование**.

Canonical product logo source:

```text
apps/web/public/asa-lab-mark.svg
```

Required product result:

```text
Scratch logo in product chrome      absent
ASA Lab logo                        present
navigation to scratch.mit.edu       absent
Scratch account/community chrome    absent
Scratch cloud/backpack ownership    absent
```

A no-op click handler on an upstream Scratch logo is insufficient: the Scratch product mark
itself must not be displayed as ASA product chrome.

Factual compatibility/attribution wording is allowed, for example:

```text
совместимо с проектами Scratch 3 (.sb3)
```

Upstream default Scratch project/media may be used only as a non-user-facing compatibility
fixture during gated M1 development. Before activation, production default project/library
media must be ASA-owned/right-cleared or intentionally empty unless a separate explicit
rights review permits otherwise.

Exact host controls and the two authorised minimal upstream compatibility patches are
specified only in `VSCR-D0-001-SCRATCH-HOST-CONTRACT.md`.

---

## 6. Security invariants

1. Runtime iframe authority is a short-lived bearer capability, not an ASA account cookie.
2. `/api/blocks/runtime/**` has an exact runtime-origin/CORS/CSP boundary.
3. The runtime origin is never added to generic cookie-authenticated mutation trust.
4. A valid JWT alone is insufficient; current ASA project/version/publication authority is
   rechecked for protected runtime requests.
5. Editor and player capabilities are distinct; player authority is read-only and version-bound.
6. Runtime token never goes into URL, localStorage, sessionStorage, IndexedDB or logs.
7. Browser input and asset metadata are untrusted.
8. Bucket/object-store credentials and physical object keys never reach browser JavaScript.

Exact rules live in D0-004 + D0-004A.

---

## 7. Persistence and asset invariants

1. `projectJson` is Project Core JSON state; binary assets are separate durable objects.
2. Scratch compatibility identity (MD5/assetId) and ASA integrity identity (SHA-256) are distinct.
3. Asset aliases/blobs are tenant-private.
4. Asset GET requires reference by the authorised draft/version, not merely same-tenant existence.
5. No silent last-write-wins on revision conflict.
6. S3/object-store failure degrades Blocks only; unrelated ASA modules continue working.
7. Reference-safe binary GC is deferred until historical-version safety is proven.
8. `.sb3` import/export must use bounded ZIP safety and deterministic compatibility rules.

Exact persistence/storage rules live in D0-002, D0-003 and D0-007.

---

## 8. Gallery and Learning invariants

### Gallery

A Blocks publication must pin an immutable `project_version_id` (or equivalent genuinely
immutable canonical version). Player must never substitute the author's current draft.

Cross-tenant remix cannot copy JSON only; referenced assets must be server-side
re-materialised into destination tenant ownership before the destination project is committed.

Exact rules live in D0-006.

### Learning

Do not create a Scratch-specific LMS/submission subsystem. Reuse ASA Learning's existing
immutable `project_version_id` submission lineage once Blocks versions are durable.

---

## 9. Code-placement invariants

```text
contexts/blocks/**              subject/domain/application/infrastructure
apps/api/**                     transport and composition
apps/web/src/blocks/**          ASA parent UI / iframe shell
infra/scratch-editor/**         isolated Scratch host/runtime image
```

Core contexts must not import Scratch GUI/VM packages merely for convenience.
Blocks-specific policy must not leak into generic Project Core except through generic,
additive ports/contracts required by the accepted persistence design.

As the implementation grows, actual component ownership is recorded in
`docs/product/visual-programming/COMPONENT_MAP.yaml`.

---

## 10. Milestone order

```text
M0/M0.1  foundation/document contract                       COMPLETE

M1-001    @asa-lab/blocks bounded context
M1-002    ASA-owned standalone Scratch host + iframe protocol
M1-003    runtime capability + exact origin/CORS/CSP
M1-004P   exact content-validation dependency decision
M1-004    tenant-private asset metadata + S3/MinIO
M1-005P   exact Scratch semantic validation decision
M1-005    durability guard + durable load/save
M1-006    autosave/recovery/conflict/snapshot
M1-007P   ZIP/legacy-media dependency + corpus decision
M1-007    safe .sb3 import/export
M1-008    full M1 durability/security acceptance

M2        product UI + immutable Gallery/player/remix
M3        sovereign local media/extensions + network deny + backup/restore/deployment
M4-001    explicit coming_soon → active activation
```

Each task is separately selected, implemented, tested, reviewed and accepted.
No bot automatically advances to the next task.

---

## 11. Activation gate

`blocks` remains `coming_soon` until explicit M4-001 owner acceptance after all required
M1–M3 evidence.

Before activation the baseline must prove at least:

```text
durable save/load/reopen
safe autosave and conflict handling
supported sb3 round-trip
immutable Gallery player/publication/remix semantics
rights-cleared local default/media baseline
controlled extensions
no implicit Scratch Foundation network dependency
Postgres + object-store backup/restore evidence
failure isolation
school LAN/NAT load evidence
```

Completing M1 or M2 does not activate the module.

---

## 12. Agent execution invariant

For every Scratch implementation or maintenance change:

```text
resolve exact component/task first
read the smallest mapped context
state expected write paths and risk level
implement one bounded slice
run mapped focused evidence
perform bounded self-review
update COMPONENT_MAP.yaml when source/test ownership changes
STOP after the selected slice
```

A conflicting or stale component map/contract is a documentation defect to repair before
coding the disputed behaviour. A bot must not invent architecture merely to keep moving.

Deployment, service restart, live restore and activation always require separate explicit
owner instruction.
