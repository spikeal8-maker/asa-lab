# Arduino Uno and power-supply wire visibility

Current task/status/checkpoint are canonical in `docs/execution/current.yaml`.

The owner requests wires above Arduino Uno and the regulated power supply so contact connections remain visible. Only exact kinds `arduino-uno` and `regulated-power-supply` change. Batteries and other ordinary components keep their existing layering.

Render these bodies after breadboard bodies and before existing wire hit/paint layers; omit them from the later ordinary pass. Keep terminal overlays above wires, other ordinary relative order, foreign Stage props/readiness/UnoL and document identities unchanged.

Use the same exact-kind predicate to exempt only these targets from the Stage wire-pointer foreground-body drag redirect. Add focused regression coverage for target kinds, excluded ordinary/battery kinds, layer ordering and pointer redirect.

Scope: `WorkbenchStage.tsx`, existing presentation tests and component map only if required by the canonical generator. No hook, core, solver, LED, API, persistence, assets, workflow, dependency or cap edits. No local browser, Docker or heavy build.

One new author freezes a self-reviewed slice with focused checks; a new independent reviewer checks the exact SHA before ordinary publication. Existing strict CI supplies actual runtime evidence. Absent runtime/visual evidence stays NOT_RUN; source publication is not owner acceptance, closure, release or deployment.

Owner priority pauses #525 without losing history or candidates. #548 remains budget blocked; #544/#547 remain open until its demonstrated fix. Foreign/protected work remains untouched; any real dirty overlap stops writing.
