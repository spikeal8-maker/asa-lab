# TASK-3D-M0-001 work status

State source: `docs/execution/current.yaml`

Programme source: `docs/delivery/EXECUTION_MANIFEST.yaml`

Owner scope: Issue #94

Merged PR: #95

Rendered from the control plane; `pnpm control-plane:check` fails on drift.

```text
task: TASK-3D-M0-001
branch: agent/three-d-m0
status: done
checkpoint: merged_to_main
execution_lease: released_after_merge
convergence baseline: e3707e9147ab51a10173bec4471f2b8b1d67d84f
completed revision: e1962722246295d7d84d94800c21f18ff5a245c3
merge revision: 2a119a258b5fe36e05bc8aa8548e95ca87042cf5
```

## Owner decision

The owner requested permanent integration on 2026-08-12. PR #95 was taken out
of Draft and merged into `main`; Issue #94 is closed. The permanent development
stack on ports 4610/4611 was rebuilt from merge revision `2a119a2` without
replacing its PostgreSQL volume. The active Checkers and Chess lanes remain
independent and do not own the merged 3D paths.

## Required result

```text
create 3D project
→ open shared Editor Host
→ render a lazy WebGL 2 workplane
→ add one box
→ select, move, rotate, scale and set exact dimensions
→ undo/redo
→ save through Project Core
→ reload the identical validated scene
```

## Architecture constraints

- first-party `contexts/three-d` provider;
- pure schema-versioned JSON document in millimetres;
- direct Three.js runtime isolated from React and Project Core;
- route-level lazy loading;
- no Three.js instances, meshes, WASM objects or binary blobs in project JSON;
- no server-side geometry;
- worker protocol reserved for later Manifold boolean operations;
- existing authorization, tenant/RLS, revision and checkpoint contracts remain authoritative.

## Prohibited in M0

- SketchForge embedding or fork integration;
- Autodesk/Tinkercad code, branding, assets or copied interface text;
- OCCT, STEP, fillet/chamfer, physics, AR or collaboration;
- Codeblocks, Service Worker, WebGPU or Module Federation;
- object-storage or tenant-model redesign;
- claiming Tinkercad parity from the foundation slice.

M0 remains part of `main`. Boolean modelling, expanded CAD interchange and
broader Tinkercad-like functionality require separately activated milestones;
they do not remove or disable the merged foundation.
