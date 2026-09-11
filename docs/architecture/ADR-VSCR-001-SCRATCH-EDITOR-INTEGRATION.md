# ADR-VSCR-001 — Scratch-backed visual programming

**Status:** accepted architecture  
**Module key:** `blocks`  
**Product:** `Визуальное программирование`

This ADR contains only the stable architectural decisions that every Scratch implementation
must preserve. It does not contain execution state, milestone progress or exact implementation
steps.

Execution state: `docs/execution/current.yaml`  
Product master: `docs/product/ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`  
Implementation router: `docs/product/visual-programming/README.md`

## Context

ASA Lab already owns identity, projects, immutable versions, classrooms, Learning,
publication and deployment. Scratch is integrated as an editor/runtime engine, not as a
second website/backend.

The supported school baseline must remain usable without depending on
`scratch.mit.edu` availability.

## Decision 1 — keep one ASA capability

Use the existing module key:

```text
blocks
```

Do not create a parallel `scratch` module.

User-facing product naming is ASA Lab `Визуальное программирование`. Scratch is a factual
compatibility statement, not ASA product branding.

## Decision 2 — isolated ASA-owned host

Scratch GUI/VM packages do not enter the main ASA Web dependency graph.

The pinned upstream source is built into a separate runtime container and exposed through an
ASA-owned host around the shipping standalone distribution.

```text
ASA Web
→ separate-origin iframe
→ ASA Scratch host
→ pinned Scratch GUI/VM runtime
```

The upstream playground is technical build evidence only, not the product host.

## Decision 3 — ASA remains system of record

Scratch owns editing/runtime mechanics.

ASA owns:

```text
identity / authorisation
project/draft revisions
immutable versions
Learning submissions
Gallery publication/remix provenance
asset durability
save/recovery/conflict semantics
backup/deployment/activation
```

There is no Scratch account database, LMS, classroom database, project backend, social
backend or gradebook inside ASA.

## Decision 4 — logical project document, separate binary storage

The persistent Blocks document contains Scratch `projectJson` plus logical asset references.

```text
assetId + dataFormat + sha256 + sizeBytes
```

Physical object location (`objectKey`, bucket, provider) is server-only metadata and never
part of the project document.

`.sb3` is import/export interchange, not autosave storage.

## Decision 5 — tenant-private immutable assets

Binary costumes/images/sounds use private S3-compatible object storage with tenant-scoped
metadata.

Scratch compatibility identity and ASA integrity identity remain separate:

```text
assetId/md5ext  Scratch compatibility
sha256          ASA byte integrity
objectKey       server-only location
```

Browser JavaScript never receives bucket credentials or tenant-wide object authority.

## Decision 6 — generic Project Core durability hook

Project Core may receive one generic additive async pre-save durability port so Blocks can
prove referenced assets are durable before a draft revision commits.

Blocks-specific persistence logic remains outside generic Project Core.

The generic project API must not become a bypass around Blocks durability rules.

## Decision 7 — ASA owns save correctness

Upstream Scratch server save is disabled.

ASA owns generation-aware save orchestration, optimistic revision semantics,
conflict/retry/recovery handling and save-status reporting.

Upstream save and ASA save must never run in parallel.

## Decision 8 — separate runtime trust surface

Scratch iframe runtime is not an ambient ASA account session.

Runtime requests use short-lived project/version-scoped bearer capability authority on
`/api/blocks/runtime/**`, with exact origin/CORS/CSP handling.

The runtime origin is never added to generic cookie-authenticated mutation trust.

A valid capability still requires current ASA resource authority checks where defined by the
runtime-security contract.

## Decision 9 — immutable publication and controlled remix

A published Blocks work executes an immutable project version, never the author's mutable
current draft.

Cross-tenant remix must server-materialise referenced assets into destination tenant
ownership before committing the copied project. JSON-only cross-tenant copy is insufficient.

Learning reuses ASA's existing immutable `project_version_id` submission semantics; there is
no Scratch-specific LMS.

## Decision 10 — sovereign baseline before activation

Before `blocks` becomes active, the supported baseline must prove:

```text
durable save/reopen
safe conflict/recovery behavior
local/right-cleared default and library media
controlled extension policy
no implicit Scratch Foundation network dependency
Postgres + object-store backup/restore
failure isolation
school deployment/load evidence
```

`coming_soon → active` is a separate explicit owner decision.

## Decision 11 — exact upstream pin, reviewed updates only

The current upstream source/version lock lives in:

```text
infra/scratch-editor/upstream.env
```

No bot upgrades Scratch merely because a newer commit/release exists.

A pin update requires exact diff/provenance review, dependency/license/security review and
evidence appropriate to the implemented milestone.

## Consequences

This architecture intentionally prefers explicit boundaries over short-term shortcuts.

Benefits:

```text
one ASA identity/project/Learning system
recoverable/versioned projects
private tenant-safe assets
isolated runtime trust
school self-hostability
bounded future maintenance
```

Costs:

```text
separate host/container
runtime capability layer
object storage metadata
save orchestration
backup/restore acceptance before activation
```

Exact implementation detail belongs in the selected D0 contract and component/task card,
not in this ADR.
