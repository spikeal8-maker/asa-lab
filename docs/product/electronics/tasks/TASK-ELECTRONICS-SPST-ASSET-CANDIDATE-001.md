---
task_id: TASK-ELECTRONICS-SPST-ASSET-CANDIDATE-001
kind: implementation
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Existing switch converted into a distinct two-terminal SPST

Owner explicitly requested completion of consolidated point38. Preserve the
existing visible SPDT body, slider, scale and left/common pins; remove only the
RIGHT outer pin for a new SPST variant. Original SPDT remains unchanged.

Read-only control-flow verification proves the actual visible source is
ProductionComponentVisual JSX tinkercad-spdt-three-pin, NOT the catalog owner
SVG fallback. Keep its 28x10 model body and transform, derive pin arrays
[-10,0] from [-10,0,10] in normal and selection rendering. Existing physical
footprint7.112x3.81mm and retained centres1.016/3.556,y3.81 stay unchanged.
No new artwork or protected asset edits. The rejected rocker57dc43f9 and
unintegrated owner-SVG derivation0d7ab958 are not the requested product image.

One cohesive implementation slice: separate switch-spst identity, exactly two
external electrical terminals left/common, left closed/right open, palette,
actuator mouse/touch, wiring, undo/redo and JSON save/reopen. Never hide a third
modeled terminal. Preserve old SPDT identities, both throws, generic legacy
switches and old document migrations. Both solver stamping and reported currents
must honor the new topology; open contact must not conduct. Provenance metadata
must honestly distinguish owner-authorized derivation of current runtime JSX
from byte-exact original SVG. Narrow necessary contract updates allowed; do not
weaken existing original-owner checks, invent owner-supplied provenance, or
modify protected files. No independent replacement art.

Executor owns product implementation and focused gate/self-review; separate
reviewer validates final exact SHA. Controller owns current.yaml only. Source
proof includes all unchanged body/slider/retained-pin geometry in both states,
selected outline, original SPDT unchanged, true two-pin electrical topology,
closed/open resistive and LED circuits, KCL/finite results, removed-terminal
rejection, old projects and deterministic results. Native actual production UI
at1440/390 verifies palette, positions, mouse/touch toggles, contacts, wiring,
undo/redo and serialize/reload; distinguish fixture roundtrip from server Save.

Use pnpm gate:electronics-m1 and bundle:check with NX_SKIP_NX_CACHE=true,
report freshly executed tasks. Fixed caps222000/2000000 cannot be raised.
No unrelated refactoring, deferred cleanup, server/Docker/DB or listening port.
If a cap fails, report exact measured cause and choose minimal in-slice sharing,
not unrelated extraction. Preserve foreign modifications. One verified slice
then STOP; controller handles integration and programme continuation.

## Bounded post-integration CI formatting repair

Exact main CI stopped on Prettier catalog.json. Author may format ONLY that
file, prove parsed JSON equality and focused format check, publish one repair
commit then STOP. No product semantics, build, gate rerun, refactoring or
validator baseline repair. Independent reviewer checks exact JSON equality.
