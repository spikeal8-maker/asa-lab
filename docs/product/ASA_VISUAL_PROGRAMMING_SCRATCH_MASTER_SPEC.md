# ASA Lab Visual Programming — Scratch integration master specification

**Version:** 3.1  
**Module:** `blocks`  
**Product:** `Визуальное программирование`

## 0. How to use this master

This is the stable product/architecture master. It defines destination, invariants and
milestone order; it does not select active work.

Execution state lives only in `docs/execution/current.yaml` + explicit owner instruction.

Scratch routing:

```text
docs/product/visual-programming/README.md
→ COMPONENT_MAP.yaml
→ one subsystem card
→ exact task card when milestone coding is selected
→ mapped canonical contract/source/test
```

Global Scratch entry may read §§0–4 plus the selected task stub. Ordinary post-implementation
maintenance should use component routing and not preload the full programme roadmap.

## 1. Product goal

ASA Lab provides a self-hostable Scratch-3-compatible visual-programming environment while
ASA remains the system of record.

```text
create ASA Visual Programming project
→ open ASA-branded editor
→ edit/run blocks, sprites, costumes and sounds
→ durable autosave to ASA
→ close/reopen same project
→ immutable version/checkpoint
→ submit / publish / remix / .sb3 interchange when applicable
```

The supported school baseline must not depend on `scratch.mit.edu` availability.

## 2. Ownership boundary

Scratch owns editor/runtime mechanics:

```text
block editor
VM execution
renderer
paint/sound editor mechanics
Scratch 3 project compatibility
```

ASA owns:

```text
identity and authorisation
projects/drafts/immutable versions
classrooms and Learning submissions
Gallery publication/player/remix
asset durability and object storage
save/recovery/conflict semantics
backup/restore/deployment/activation
product branding
```

There is no second Scratch account system, project backend, classroom/LMS, social backend or
gradebook inside ASA.

## 3. Stable architecture

```text
ASA Lab Web
└── separate-origin iframe
    └── ASA Scratch Host
        ├── pinned Scratch GUI standalone distribution
        ├── ASA bootstrap/config/protocol
        ├── ASA Scratch storage adapter
        └── later ASA save/recovery orchestrator
             ↓ short-lived capability
        ASA Blocks Runtime API
        ├── Project Core use cases
        ├── Blocks durability guard
        ├── tenant-private asset metadata
        ├── private S3-compatible blob store
        └── existing snapshot/version systems
```

Scratch GUI/VM dependencies remain outside the main ASA Web dependency graph.

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

```text
assetId    Scratch compatibility identity; v1 lowercase 32-hex MD5
sha256     ASA server-computed integrity digest
objectKey  server-only physical locator; never project JSON
.sb3       interchange only; never autosave persistence
```

A durable Blocks document may not reference missing/unverified assets.

## 5. Product branding and host boundary

User-facing product branding is **ASA Lab — Визуальное программирование**.

Canonical logo source:

```text
apps/web/public/asa-lab-mark.svg
```

Required result:

```text
Scratch product logo/navigation      absent
ASA Lab canonical logo               present
Scratch account/community ownership  absent
Scratch cloud/backpack ownership     absent
```

A no-op click handler on the Scratch logo is insufficient. Factual compatibility wording
such as `совместимо с проектами Scratch 3 (.sb3)` is allowed.

Upstream default Scratch media is allowed only as a gated, non-user-facing M1 compatibility
fixture. Production default/library media before activation must be ASA-owned/right-cleared
or deliberately empty unless separately approved.

Exact host controls and the only two authorised upstream compatibility patches live in
D0-001.

## 6. Security invariants

1. Scratch iframe authority is a short-lived bearer capability, not an ASA account cookie.
2. Runtime routes have exact path-scoped Origin/CORS/CSP handling.
3. Runtime origin never becomes generic cookie-authenticated mutation trust.
4. A valid capability is not frozen authority: current ASA resource authority is rechecked.
5. Editor/player authority is distinct; player is read-only and immutable-version-bound.
6. Runtime tokens remain memory-only and never enter URL/persistent browser storage/logs.
7. Browser input and asset metadata are untrusted.
8. Bucket credentials/object keys never reach browser JavaScript.

The single canonical runtime-security contract is D0-004.

## 7. Persistence and asset invariants

1. `projectJson` is Project Core JSON state; binary assets are separate durable objects.
2. Scratch compatibility identity (MD5/assetId) and ASA integrity (SHA-256) are distinct.
3. Asset aliases/blobs are tenant-private and immutable.
4. Asset GET requires reference by the authorised draft/version, not tenant-wide existence.
5. No silent last-write-wins on revision conflict.
6. Blocks storage/runtime failure must not take down unrelated ASA modules.
7. Binary GC remains off until historical-reference safety is designed/proven.
8. `.sb3` import/export requires bounded ZIP and compatibility rules.

Exact rules live in D0-002, D0-003 and D0-007.

## 8. Gallery and Learning invariants

A Blocks publication pins an exact immutable `project_version_id` (or genuinely equivalent
immutable version). Player never substitutes the author's mutable current draft.

Cross-tenant remix re-materialises referenced assets into destination tenant ownership before
committing the destination project; JSON-only cross-tenant copy is invalid.

Learning reuses ASA's existing immutable `project_version_id` submission lineage. Do not
create a Scratch-specific LMS/submission system.

Exact publication/remix rules live in D0-006.

## 9. Code-placement invariants

```text
contexts/blocks/**              subject/domain/application/infrastructure
apps/api/**                     transport and composition
apps/web/src/blocks/**          ASA parent UI / iframe shell
infra/scratch-editor/**         isolated Scratch host/runtime image
```

Core contexts do not import Scratch GUI/VM packages for convenience. Blocks-specific policy
enters generic Project Core only through accepted generic additive ports/contracts.

Actual implementation ownership lives in
`docs/product/visual-programming/components/*.yaml`; the compact component index only routes
to those cards.

## 10. Milestone order

```text
M0/M0.1  foundation/document contract                         COMPLETE

M1-001    @asa-lab/blocks bounded context

M1-002    ASA-owned Scratch host milestone
  M1-002A standalone build + minimal ASA host shell
  M1-002B ASA branding + File/Extensions controls
  M1-002C parent/iframe protocol boundary
  M1-002D ScratchStorage/GUIStorage fixture adapter
  M1-002E integrated host acceptance + independent review

M1-003    runtime capability + exact Origin/CORS/CSP/current authority
M1-004P   exact content-validation dependency decision
M1-004    tenant-private asset metadata + S3/MinIO
M1-005P   exact Scratch semantic-validation decision
M1-005    durability guard + durable load/save
M1-006    autosave/recovery/conflict/snapshot
M1-007P   ZIP/legacy-media dependency + corpus decision
M1-007    safe .sb3 import/export
M1-008    full M1 durability/security acceptance

M2        product UI + immutable Gallery/player/remix
M3        sovereign media/extensions + network deny + backup/restore/deployment
M4-001    explicit coming_soon → active activation
```

Each task/sub-slice is separately selected, evidenced, self-reviewed and accepted. No bot
automatically advances.

## 11. Task routing stubs

### VSCR-M1-001

Exact executable card:

```text
docs/product/visual-programming/tasks/VSCR-M1-001.md
```

### VSCR-M1-002

M1-002 is a milestone router, not one giant coding task:

```text
tasks/VSCR-M1-002.md
→ A → STOP
→ B → STOP
→ C → STOP
→ D → STOP
→ E independent acceptance/review → STOP
```

M1-003 remains blocked until M1-002E evidence and explicit owner milestone acceptance.

### VSCR-M1-003+

Exact future coding cards are written/refined only after prerequisite interfaces are
accepted. Distant roadmap text must not freeze speculative source paths/tests.

M1-004P/M1-005P/M1-007P are explicit design/dependency-selection gates before their
security-sensitive implementation tasks.

M2/M3/M4 implementation cards remain blocked until prior milestone interfaces/evidence are
accepted.

## 12. Activation gate

`blocks` remains `coming_soon` until explicit M4-001 owner acceptance.

Before activation prove at least:

```text
durable save/load/reopen
safe autosave/recovery/conflict handling
supported sb3 round-trip
immutable Gallery/player/remix
Learning immutable submission
rights-cleared local default/library media
controlled extension policy
no implicit Scratch Foundation dependency
PostgreSQL + object-store backup/restore
failure isolation
school LAN/NAT load evidence
```

M1 or M2 completion never activates the module.

## 13. Agent execution invariant

For every Scratch implementation/maintenance slice:

```text
resolve exact component/task first
read the smallest mapped context
state ownership/risk/expected write paths
implement one bounded slice
run mapped focused evidence
run node tools/validate-blocks-docs.mjs
perform bounded self-review
update the owning subsystem card when real source/test ownership changes
STOP
```

A stale/conflicting route is a documentation defect to repair before coding disputed
behaviour. A bot must not invent architecture merely to keep moving.

Deployment, restart, live restore and activation always require separate explicit owner
instruction.
