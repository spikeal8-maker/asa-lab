# TASK-ELECTRONICS-M1-001 work status

Execution source: `docs/delivery/EXECUTION_MANIFEST.yaml`  
Owner scope: Issue #63  
Current PR: #72

```text
task: TASK-ELECTRONICS-M1-001
branch: agent/r4-electronics-m1
status: in_progress / production_editor_integration
production evidence checkpoint: e604762057a839c2683c5788e83e1b686273828c
owner integration directive: PR #72 comment 5147079314
owner-confirmed full archive SHA-256: c5bfd26760db7a92d06e0b51b0bde3bb45595278a762bab3ab9198abb04b4d75
```

Portal shell is merged by PR #71. R3A Electronics Gateway remains completed.
R3B is blocked/deferred; full R3 completion is not claimed.

## What is already preserved

The branch contains:

- full owner archive inventory and immutable reference evidence;
- transparent production SVG candidates;
- one physical-scale contract;
- ordinary LED colour/brightness frames;
- RGB, seven-segment, resistor-band and motion/state contracts;
- breadboard visuals, hole maps and connectivity metadata;
- standalone review pages and focused evidence.

Those standalone pages are no longer the delivery result. The actual Electronics
editor still uses the old hard-coded eight-entry runtime catalog and old asset
root. The owner explicitly requires integration into a real project.

## Active checkpoint

```text
production_editor_integration
```

The working route `/projects/:projectId` must consume the production manifest,
render production SVG at physical scale, use production pins/footprints and
persist state/hole bindings.

Required live editor scope:

- battery holders 1/2/3/4/6/8×AA; 5×AA remains missing;
- parametric resistor;
- ordinary LED colours, brightness and faults;
- 4-pin momentary tactile button;
- 3-pin SPDT;
- 3-pin potentiometer;
- diode and lamp;
- RGB LED;
- seven-segment display;
- breadboards 170/420/882.

Other production candidates appear in the full library as honest
`visual_only / simulation_not_yet_supported` items until a typed electrical model
exists.

## Integration rules

- new runtime catalog comes from `/assets/electronics/production/manifest.json`;
- `/assets/electronics/components` is legacy migration fallback only;
- review status `integration_candidate` is allowed in Draft runtime;
- `production_ready` remains false until owner accepts the integrated editor;
- only one `WORLD_UNITS_PER_MM` is used;
- pin anchors come from production manifest;
- battery contacts are at free lead ends, never arbitrary body points;
- breadboard hole/rail groups participate in netlist;
- save/reload/checkpoint preserve variants, states and hole bindings;
- legacy schema-v1/v2 opens additively without data loss;
- fake numerical success for unsupported candidates is forbidden.

## Owner acceptance flow

The next checkpoint must be shown inside a real project on `localhost:4610`:

1. breadboard 420 on the actual stage;
2. battery holder 2×AA connected by lead ends to rails;
3. resistor, LED, tactile button and SPDT snapped into holes;
4. RGB LED and seven-segment snapped with correct pitch;
5. resistor bands change from resistance/tolerance;
6. ordinary LED colour and brightness change;
7. RGB channels mix;
8. seven-segment shows `0`, `8`, `A` and arbitrary mask;
9. internal breadboard connectivity and diagnostics work;
10. save/reload restores exact positions, variants, state and holes;
11. immutable checkpoint is created.

Required screenshots come from the real editor:

```text
library-production
breadboard-empty
breadboard-components-snapped
led-rgb-display-states
connected-running
reload-checkpoint
```

## Focused checks

Only focused adapter, migration, scale, pin, breadboard, LED/RGB/display state
and real-editor browser checks run before owner review. Browser collectors must
report zero unexpected console/page/request/HTTP 5xx errors.

## Prohibited until owner acceptance

- full repository matrix;
- merge PR #72;
- R4-M2;
- new branch;
- additional permanent Compose projects;
- claiming standalone labs as integrated product functionality.

Deploy exact final SHA only to the existing `asa-lab-dev`, leave the actual
Electronics project open and stop for owner review.
