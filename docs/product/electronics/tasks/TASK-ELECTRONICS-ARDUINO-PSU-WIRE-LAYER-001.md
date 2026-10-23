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


## Selected delta: real F2 acceptance

This delta supersedes the exact-integration-only authoring boundary above, not the
product preservation contract. Independent composition review approved integrated
source `88930020db9627b085c86f3257b3ff19809c2a95`, but identified that F2's mocked
PUT ignores baseRevision, reload uses the same context, and PSU slider operation
is absent. Those checks cannot establish real CAS, isolated reopen or PSU-control
acceptance. Preserve this integration and its history; do not publish it as closure.

Select one TEST-ONLY repair restricted to F2 cases and minimal public helpers in
`e2e/electronics-interactions.spec.ts`, plus necessary generated browser metadata.
Use genuine UI authentication once per group and isolated real projects/contexts.
Expected fixture and edited documents must be independent and canonical under
public server/client normalization; never derive expected from observed PUT/GET.
Prove exactly one intended native Save and its one matching full-document PUT,
observed baseRevision, acknowledged server revision plus one, fresh server GET and
cookies-only fresh-context reopen with the full expected document. Journal actual
storage/persistence evidence durably before assertions or teardown and fail closed
on unknown writes, missing evidence or races. Fresh context must not inherit draft
storage. Preserve primary errors; no forced input, retries or extra Save masking.

Preserve mouse1440 and touch390x844 wire crossing/selection/drag, target body and
terminal ordering/start/cancel and ordinary battery/LED/resistor negatives. Add
native PSU slider usability as a negative control with crossing wires, without
selecting product repair until actual evidence establishes a concrete cause.
Keep original finite budgets and all unrelated main Arduino/F1 tests byte-exact;
reuse small public helpers rather than wholesale harness transplantation. No
workflow/script, dependency, cap, product, core/hook, API/persistence or asset edits.

Freeze focused checks and exact source for NEW independent review, then one
justified exact-SHA verification. Missing runtime stays NOT_RUN. Keep all acceptance
blockers and issue679 OPEN until mandatory acceptance; cancelled broad CI does not
waive a gate. Owner-closed681 remains closed; independent557 is next when eligible.


## 23 October: actual harness repair and scoped technical qualification

This selection supersedes the earlier integration-only/no-new-gate boundary for
this bounded continuation. Product code is already integrated through PR694 and
PR695; it is not selected for another implementation. Execution status remains
exclusively in `docs/execution/current.yaml`.

[The dated actual receipt](../evidence/ui679-557-actual-repair-scoped-qualification-20261023.md)
selects one test-harness repair author for the two existing test files and a
separate additive six-case qualification author. Preserve all native actions,
assertions, complete independent documents, Save/CAS, cookies/storage checks,
viewports, acquisition deadlines and finite case budgets. No product repair,
forced input, skipped coverage, timeout/cap increase or repeated unchanged broad
run is authorized.

Technical acceptance of these two issues requires the exact six existing cases,
all PASS, exact focused and raw-budget evidence, full General gates and a NEW
independent actual review. The command `pnpm gate:electronics-ui-679-557:browser` runs locally, in CI and
owner evidence. Freeze exact full test titles/paths from discovery; reject extra,
missing, duplicate or skipped cases, including at execution. The full Electronics
gate remains global verification and its cancelled result stays non-PASS. This
prospective scoped technical criterion does not claim full Electronics PASS,
physical owner acceptance, release or deployment, and clears no foreign blocker.

The separate qualification author may add one small runner/manual workflow and
necessary script/catalogue registration and exact transport workflow/browser
identity allowlist with adversarial tests. Preserve existing guarded image
identity, PostgreSQL/migrations, API/Web startup, source/build and artifact
provenance; no spoofed workflow identity. Do not edit the foreign dirty existing
Electronics workflow or clean another worktree. Check all actual target overlaps
before writes. New independent source and final composition reviews precede one
justified exact-SHA qualification. Source publication alone is not acceptance.

F2's actual failure is pre-app initialization installed after loading the home
realm followed by hash-only project navigation. Install initialization before a
genuine full document navigation so the journal records real pre-app storage.
Keep native mouse1440 and touch390x844, PSU slider and ordinary/terminal negatives,
real independent full-document Save/CAS and cookies-only fresh reopen. Preserve
primary helper failures and journal evidence before teardown; never synthesize
missing pre-app values or relax empty storage assertions.
