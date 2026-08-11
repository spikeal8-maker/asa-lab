# TASK-3D-M0-001 work status

State source: `docs/execution/current.yaml`

Programme source: `docs/delivery/EXECUTION_MANIFEST.yaml`

Owner scope: Issue #94

Current PR: #95

Rendered from the control plane; `pnpm control-plane:check` fails on drift.

```text
task: TASK-3D-M0-001
branch: agent/three-d-m0
status: in_progress
checkpoint: foundation_vertical_slice
execution_lease: codex-three-d-m0
convergence baseline: e3707e9147ab51a10173bec4471f2b8b1d67d84f
```

## Owner decision

The owner prioritised the ASA-native 3D foundation. Electronics PR #92 remains
open and untouched; its corrective task is paused and no completion is claimed.
This transition activates only the M0 vertical slice, not the entire R10 scope.

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

Stop after focused checks and desktop/tablet/mobile evidence. PR #95 remains
Draft until the owner reviews the live vertical slice.
