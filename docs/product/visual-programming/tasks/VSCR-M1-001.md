# VSCR-M1-001 — Extract `@asa-lab/blocks` bounded context

**Status:** READY FOR OWNER SELECTION  
**Risk:** medium  
**Behavioral goal:** none; structural extraction only.

## Goal

Move the already accepted Blocks subject contract/provider out of API composition into a
normal isolated ASA context without changing runtime/product behavior.

## Components

Read these entries in `../COMPONENT_MAP.yaml`:

```text
blocks.module.contract
blocks.assets.reference
```

Do not read host/storage/Gallery/Learning/sb3 components for this task.

## Minimal read set

```text
AGENTS.md
START_HERE_FOR_AI.md
../README.md
../AGENT_GUIDE.md
../COMPONENT_MAP.yaml entries above
../../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md §§2,4,9,10,12
../VSCR-D0-002-PERSISTENCE-CONTRACT.md only for future boundary awareness
current contexts/three-d package structure as repository convention
current apps/api/src/blocks-module.ts
current apps/api/src/blocks-module.spec.ts
current apps/api/src/module-registry.ts
```

Do not read every D0 contract.

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
apps/api/src/blocks-module.ts          # delete after migration
apps/api/src/blocks-module.spec.ts     # delete/move after migration
pnpm-lock.yaml                         # workspace-link update only if generated normally
.github/workflows/scratch-m0-focused.yml # only if commands/paths must follow moved tests
../COMPONENT_MAP.yaml                  # replace old actual paths with new actual paths
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
preview behavior
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

No Nest/Fastify/pg/React/Scratch GUI/VM dependency may enter `contexts/blocks` in this task.

`apps/api/src/module-registry.ts` should import:

```ts
import { BLOCKS_MODULE } from '@asa-lab/blocks';
```

## Tests/gates

At minimum run the exact equivalent of:

```text
nx build module-sdk
nx build blocks
nx run blocks:typecheck
nx run blocks:lint
Blocks context tests
existing modules controller tests
API typecheck
boundaries:check
updated focused Scratch workflow
repository-required gate for shared workspace/dependency changes
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
no module activation
no unrelated refactor
no M1-002 work in the same slice
```

## Done

```text
@asa-lab/blocks exists and builds
API composes BLOCKS_MODULE through public context import
old API-local Blocks provider/spec removed after migration
behavior remains semantically identical
COMPONENT_MAP.yaml points to actual new source/test paths
focused + required repository gates pass on exact final SHA
```

## Bounded self-review

Use `../AGENT_GUIDE.md` checklist against only this task, final diff and test evidence.

Extra questions:

```text
Did any behavior change accidentally?
Did any Scratch/runtime dependency enter the bounded context?
Did I alter module availability?
Did I start host/storage work?
Did I update component-map paths from API-local to contexts/blocks?
```

Then STOP. M1-002 requires separate owner selection.
