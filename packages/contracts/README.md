# contracts

OpenAPI/JSON Schema and event contract types.

Foundation skeleton (TASK-BOOT-001). Business behaviour is added in later phase tasks.

## Public artifact envelope v1

`validatePublicArtifact(unknown)` is the executable, closed runtime schema. A
successful result is a detached, deeply frozen projection suitable for JSON
serialization. Types alone do not validate untrusted data. Failure returns only
`invalid-public-artifact`, without reflecting private input.

Provenance contains only the public publication UUID (lowercase canonical form)
and its immutable revision number (integer 1–2,147,483,647). It contains no Project,
ProjectVersion, owner, tenant, classroom or session identifiers. Resolving and
authorizing that exact publication revision belongs to the subsequent service;
schema validity alone proves neither authorization nor provenance authenticity.

This version deliberately supports only `static-only` for viewer families
`three-d`, `electronics`, `blocks`, and `unsupported` with a null viewer family.
Reasons are closed literals. Both outcomes require readOnly=true,
interactive=false, download=false. These are artifact capabilities, not user or
class permissions. They promise no viewer, executable runtime or export.
Module payloads require a separately defined versioned schema and module-specific
sanitizer; arbitrary JSON, URLs, raw snapshots and extension bags are rejected.

Hard ceilings before schema acceptance: 4,096 UTF-8 JSON bytes, root-relative
depth 4, 32 visited values, 128 UTF-16 code units per string/key. v1's closed
shape is substantially smaller than these defensive ceilings. Unknown fields,
missing fields, non-finite numbers, wrong types, arrays, accessors, hidden/symbol
properties, custom prototypes and cyclic input fail closed. Only plain objects
with enumerable data properties are admitted. Output objects retain no mutable
references to the input. Exceptions from hostile objects also produce failure.

Schema tests are in `contexts/projects/testing/public-artifact.spec.ts`, included
by the existing `test:project-slice` and `gate:projects-publication` unit globs.
Focused check: `pnpm exec vitest run contexts/projects/testing/public-artifact.spec.ts`.
Contract typecheck: `pnpm exec tsc -p packages/contracts/tsconfig.json --noEmit`.
