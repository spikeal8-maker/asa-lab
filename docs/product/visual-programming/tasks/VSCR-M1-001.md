# VSCR-M1-001 — Extract `@asa-lab/blocks` bounded context

**Kind:** executable implementation slice  
**Risk:** medium  
**Prerequisite:** M0/M0.1 integrated and this task explicitly selected by owner/current execution flow.  
**Behavioral goal:** none; structural extraction only.

## Goal

Move the already accepted Blocks subject contract/provider out of API composition into the
normal isolated `@asa-lab/blocks` context without changing runtime or product behaviour.

## Components

Resolve only:

```text
blocks.module.contract
blocks.assets.reference
```

Read only:

```text
../COMPONENT_MAP.yaml
../components/module.yaml → blocks.module.contract
../components/assets.yaml → blocks.assets.reference
```

Do not load host/runtime/storage/Gallery/Learning/sb3 cards.

## Minimal read set

```text
../README.md
../AGENT_GUIDE.md
../COMPONENT_MAP.yaml
../components/module.yaml → blocks.module.contract
../components/assets.yaml → blocks.assets.reference
../../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md §§0–4,9–11,13
../../../architecture/ADR-VSCR-001-SCRATCH-EDITOR-INTEGRATION.md
current contexts/three-d package structure only as repository convention
current apps/api/src/blocks-module.ts
current apps/api/src/blocks-module.spec.ts
current apps/api/src/module-registry.ts
```

No D0 storage/persistence/runtime contract is required for this structural move unless the
current code unexpectedly crosses one of those boundaries; if that happens, STOP before
widening scope.

## Expected write paths

```text
contexts/blocks/package.json
contexts/blocks/project.json
contexts/blocks/tsconfig.json
contexts/blocks/index.ts
contexts/blocks/module.ts
contexts/blocks/domain/document.ts
contexts/blocks/domain/validation.ts
contexts/blocks/testing/module.spec.ts
apps/api/package.json
apps/api/src/module-registry.ts
apps/api/src/blocks-module.ts          # delete after imports migrate
apps/api/src/blocks-module.spec.ts     # delete/move after tests migrate
pnpm-lock.yaml                         # workspace-link update only if generated normally
.github/workflows/scratch-m0-focused.yml # only if moved build/test paths require it
../components/module.yaml
../components/assets.yaml              # blocks.assets.reference entry only
```

Any additional path requires a concrete dependency reason before editing.

## Required invariant preservation

Exactly preserve:

```text
moduleKey blocks
moduleVersion 0.1.1
availability coming_soon
projectType scratch-3
schemaVersion 1
editor/viewer routes
empty document shape
asset validation
preview behaviour
```

No persistence, runtime API, Web editor or host functionality is added.

## Target code split

```text
contexts/blocks/
  domain/document.ts
    BlocksAssetFormat
    BlocksAssetReferenceV1
    BlocksProjectDocumentV1

  domain/validation.ts
    validateBlocksDocument and structural helpers

  module.ts
    BLOCKS_MODULE and preview/provider assembly

  index.ts
    public exports only
```

No Nest/Fastify/pg/React/Scratch GUI/VM dependency enters `contexts/blocks` in this task.

`apps/api/src/module-registry.ts` imports the public package:

```ts
import { BLOCKS_MODULE } from '@asa-lab/blocks';
```

## Tests/gates

Run the moved/final equivalents of:

```text
nx build module-sdk
nx build blocks
nx run blocks:typecheck
nx run blocks:lint
Blocks context tests
existing modules controller tests
API typecheck
boundaries:check
focused Scratch workflow
repository-required gate for shared workspace/dependency changes
node tools/validate-blocks-docs.mjs
```

Do not claim PASS from an older SHA.

## Forbidden

```text
no host changes
no database migration
no S3/MinIO
no Project Core guard
no runtime endpoints
no Web editor route
no activation
no unrelated context refactor
no M1-002 work
```

## Done

```text
@asa-lab/blocks exists and builds
API composes BLOCKS_MODULE through public context import
old API-local provider/spec are removed after migration
behaviour is semantically unchanged
components/module.yaml records actual new source/test paths and symbols
components/assets.yaml records actual asset-reference ownership if moved
focused + required repository gates pass on exact final SHA
```

## Bounded self-review

Use `../AGENT_GUIDE.md` against only this card, final diff, the two mapped component entries
and exact test evidence.

Check explicitly:

```text
Did any behaviour change?
Did a Scratch/runtime dependency enter the bounded context?
Did availability change?
Did I start host/storage work?
Did I update actual routing paths after moving the provider?
```

## Stop

STOP after evidence and self-review. M1-002 is a separate milestone and requires separate
owner selection after M1-001 acceptance.
