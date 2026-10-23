---
task_id: TASK-ELECTRONICS-ARDUINO-PSU-WIRE-LAYER-001
kind: repair
risk: medium
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Direct owner request for Arduino Uno and regulated power-supply wire visibility
acceptance_boundary: slice
review: independent
---

# Arduino Uno and power-supply wire visibility

Current task/status/checkpoint are canonical in `docs/execution/current.yaml`.

The owner requests wires above Arduino Uno and the regulated power supply so contact connections remain visible. Only exact kinds `arduino-uno` and `regulated-power-supply` change. Batteries and other ordinary components keep their existing layering.

Render these bodies after breadboard bodies and before existing wire hit/paint layers; omit them from the later ordinary pass. Keep terminal overlays above wires, other ordinary relative order, foreign Stage props/readiness/UnoL and document identities unchanged.

Use the same exact-kind predicate to exempt only these targets from the Stage wire-pointer foreground-body drag redirect. Add focused regression coverage for target kinds, excluded ordinary/battery kinds, layer ordering and pointer redirect.

Scope: `WorkbenchStage.tsx`, existing presentation tests and component map only if required by the canonical generator. No hook, core, solver, LED, API, persistence, assets, workflow, dependency or cap edits. No local browser, Docker or heavy build.

One new author freezes a self-reviewed slice with focused checks; a new independent reviewer checks the exact SHA before ordinary publication. Existing strict CI supplies actual runtime evidence. Absent runtime/visual evidence stays NOT_RUN; source publication is not owner acceptance, closure, release or deployment.

Owner priority pauses #525 without losing history or candidates. #548 remains budget blocked; #544/#547 remain open until its demonstrated fix. Foreign/protected work remains untouched; any real dirty overlap stops writing.

## Owner continuation: controlled PR694 test integration

This continuation supersedes the earlier Stage authoring scope and pause525 sentence
for the currently selected slice; the preceding product contract remains historical
and a preservation invariant. It does not resume525 or select new Stage edits.

The existing product layer logic must be verified rather than rewritten. The owner
attachment selects programme #679, then #681, then #557, and permits reviewed main
publication and closure only after mandatory acceptance. Current execution selection
remains exclusively in `current.yaml`.

Integrate existing PR694 F2 hunks from exact
`8fa878116c7b508ba12dcc3bca4341175e9c9168` with fresh main in one bounded cycle.
Its touch case already uses 390 x 844; no missing local mobile patch is assumed.
Preserve both current main Arduino coverage and F2 mouse/touch coverage in
`e2e/electronics-interactions.spec.ts`; generated browser metadata only if required.
Keep its existing finite test budget, native hit/drag, target and negative controls,
full document, Save and reopen assertions. No timeout increase, forced hit,
product rewrite, budget optimisation, workflow/script/dependency/cap edit.

A new author freezes the exact integrated SHA with focused checks and stops. A new
independent reviewer checks the full composition before publication. Obtain new
exact-SHA native target evidence, focused and required General gates. Existing old
F2 passes support reuse, not acceptance of the new composition. An overall browser
cancellation stays cancelled; classify external C/D separately without a gate waiver
or repeated unchanged full-suite runs. Keep #679 open until mandatory acceptance.
Only a concretely proved product regression permits a separately selected minimal
Stage repair; do not infer one from obsolete evidence contradicted by newer F2 PASS.

Record #681 as owner-closed without reopening or claiming every historical General
run passed. Continue independent #557 under its own canonical selection if an
external blocker prevents #679 closure. Draft PR state never authorises unreviewed
merge. School installation, live data and network remain outside scope.
