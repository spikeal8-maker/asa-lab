# ADR-VSCR-001 — Scratch-backed visual programming

Status: **accepted for VSCR-M0 foundation**  
Issue: **#176**  
Module key: **`blocks`**

## Context

ASA Lab already owns authentication, subject-neutral projects, immutable project
checkpoints, classroom membership, learning assignments, publication and project
previews. Reimplementing those concerns inside a copy of `scratch.mit.edu` would
create a second identity/LMS/project system and break ASA Lab's module boundary.

The Scratch Foundation maintains the editor as the open-source
`scratchfoundation/scratch-editor` monorepository. VSCR-M0 uses the editor as a
subject runtime, not as a replacement for ASA Lab application services.

## Decision

### 1. Keep the existing `blocks` product capability

The reserved ASA Lab module key `blocks` becomes the visual-programming module
compatible with Scratch 3 projects. We do not add a competing `scratch` project
type next to it.

The M0 provider is real, but its manifest stays `coming_soon`. This is a safety
gate: Project Core must not offer project creation until the bidirectional
save/load bridge is complete.

### 2. Keep Scratch behind a separate build/runtime boundary

The upstream editor is built into its own container. Scratch packages do not
become dependencies of the main Vite/Nx web application. This limits dependency
collisions and lets an upstream update be tested or rolled back independently.

The M0 upstream lock is:

- version `15.1.1`;
- commit `82c5fea6d3e60c781f25c09b375045f9b46a43f7`;
- repository `https://github.com/scratchfoundation/scratch-editor.git`.

`infra/scratch-editor/upstream.env` is the machine-readable lock.

### 3. ASA Lab owns persistence

The ASA document envelope is:

```text
BlocksProjectDocumentV1
├── schemaVersion = 1
├── format = scratch-3
├── projectJson = Scratch project.json | null
└── assets[]
    ├── assetId
    ├── dataFormat
    ├── objectKey
    ├── sha256
    └── sizeBytes
```

`projectJson` belongs in the existing Project Core draft/version JSON storage.
Costume, sound and other binary bytes do not. Asset bytes will be stored through
ASA object storage and referenced by stable keys/digests.

The provider therefore rejects top-level embedded `.sb3` payloads and common
inline-binary fields on asset references. This prevents autosaves and immutable
checkpoints from duplicating an entire ZIP archive in PostgreSQL JSONB.

### 4. `.sb3` is an interchange format

M1 will implement import/export at the integration boundary:

```text
.sb3 import -> unpack -> validate project.json -> persist assets -> ASA document
ASA document -> resolve assets -> assemble ZIP -> .sb3 export
```

An `.sb3` archive is not the primary persistence model.

### 5. ASA Lab remains the system of record

Scratch runtime responsibilities:

- block editor and palettes;
- VM and project execution;
- stage/rendering;
- sprites, costumes and sounds;
- Scratch 3 file compatibility.

ASA Lab responsibilities:

- accounts and sessions;
- authorisation and tenant/class scope;
- projects, drafts and checkpoints;
- assignments/submissions and grading;
- gallery/publication/remix provenance;
- object storage, backups and deployment;
- moderation and product telemetry.

There will be no Scratch user database, Scratch classroom database or parallel
Scratch social backend.

## Update policy

Scratch upstream updates are never promoted directly from a moving branch.
A version change must update `upstream.env`, rebuild the isolated image and pass
at least:

1. ASA module validation tests;
2. upstream image build/health check;
3. representative old-project load tests;
4. `.sb3` round-trip tests once M1 exists;
5. network-deny/offline tests once the sovereign runtime exists.

Only then can the pinned commit change.

## VSCR milestones

### M0 — foundation (this change)

- real `blocks` module provider and schema;
- hard boundary against binary `.sb3` persistence in JSONB;
- exact Scratch Editor upstream lock;
- isolated Docker build/runtime;
- tests and this ADR;
- module intentionally remains non-creatable.

### M1 — persistence bridge

- initialise Scratch VM project state;
- load/save `projectJson` through Project Core optimistic revisions;
- content-addressed asset storage through MinIO/S3;
- debounced autosave with conflict handling;
- stage snapshot into existing project preview storage;
- `.sb3` import/export.

### M2 — product integration

- enable module creation only after M1 gates pass;
- editor host/reverse proxy;
- project gallery/remix flow;
- assignment submission pinned to an immutable project version;
- read-only viewer/player.

### M3 — sovereign/offline acceptance

- deny outbound Scratch-service traffic and prove core editing still works;
- locally serve required media libraries and extensions;
- document unsupported extensions explicitly;
- optional cloud variables and Scratch Link/hardware work remain separate.

## Consequences

The first branch contains a usable integration foundation without exposing a
false-save experience to students. The cost is that VSCR-M0 is not yet a
user-visible Scratch replacement; activation is deliberately deferred until ASA
Lab can guarantee durable project persistence.
