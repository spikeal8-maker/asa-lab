# ASA Lab Electronics — Maintenance, Cleanup & Optimization Execution Specification

**Status:** canonical normative specification after repository integration  
**Document role:** normative technical specification (ТЗ) for bounded Electronics maintenance/cleanup execution  
**Scope:** Electronics / Arduino maintainability, repository hygiene, UI maintainability, test architecture, legacy retirement and later engine/runtime hardening  
**Purpose:** define the permanent execution contract by which agents may safely analyze, clean, decompose and retire Electronics technical debt through small reversible steps without mixing cleanup with product development.

> This specification defines the cleanup/optimization programme, **not live task authorization**.  
> `docs/execution/current.yaml` remains the only active execution state.  
> Every executable change still requires one selected bounded task/card and the normal repository preflight.  
> A bot may understand the whole programme from this document, but may execute only the single work package selected by the active task.

---

## 0. Agent entry and authority contract

This specification is the canonical execution reference for requests such as:

```text
cleanup Electronics
optimize Electronics maintainability
remove technical debt
retire legacy Electronics code
clean test artifacts
reduce CSS/controller/UI complexity
decompose an Electronics hotspot
clean Electronics asset packaging
```

### 0.1 Required discovery path

An agent entering Electronics follows this route:

```text
root AGENTS.md / START_HERE_FOR_AI.md
→ docs/product/electronics/START_HERE.md
→ docs/execution/current.yaml (selected task only)
→ docs/product/electronics/COMPONENT_MAP.yaml
→ selected concrete task card
→ this specification at the exact selected WP-* section
→ ENGINEERING_HYGIENE_CONTRACT.md when cleanup/deletion/decomposition applies
→ mapped source/tests
→ execute one bounded outcome
→ verify
→ STOP
```

If no matching Electronics task is selected as executable in `current.yaml`, the agent **must not pick a work package from this specification on its own**. It reports the next owner-selectable work package and stops.

### 0.2 Authority and conflict order

This document owns **cleanup programme structure, work-package order, task boundaries and cleanup acceptance expectations**. It does not own product behaviour or electrical semantics.

When documents overlap, use the narrower authority:

```text
repository/root governance
→ docs/execution/current.yaml for live selection/status
→ selected task card for exact bounded outcome
→ README.md / DEVELOPMENT_SPEC.md for product/runtime behaviour
→ ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md for capability dependency order
→ ENGINEERING_HYGIENE_CONTRACT.md for deletion/legacy/hygiene rules
→ this specification for cleanup programme execution structure
```

A task may not rewrite these authorities merely to make its own implementation easier.

### 0.3 WP IDs are programme IDs, not task IDs

Identifiers in this specification such as `WP-HYG-01`, `WP-CSS-02` and `WP-SOLVER-01` are stable **work-package references** only. They are not valid active task IDs and never become executable by themselves.

Every executable step receives a separate validator-compatible task card, for example:

```yaml
prerequisites:
  - docs/product/electronics/ASA_ELECTRONICS_MAINTENANCE_EXECUTION_SPEC.md#wp-art-03--ignore-disposable-interaction-reports
```

The task card must map to exactly one primary `WP-*` outcome. If one work package proves too large, split it into multiple sequential task cards rather than broadening one card.

### 0.4 Definition of Ready

A cleanup task is ready to execute only when all are true:

```text
fresh GitHub main captured
active Electronics task in current.yaml matches the concrete card
card status is executable (normally in_progress)
exact WP-* prerequisite is named
primary component/ownership route resolved where applicable
write paths are bounded
focused proof is named
semantic-change classification is explicit
STOP boundary is explicit
no unclassified interrupted diff/work remains
```

### 0.5 Definition of Done for one cleanup task

A task is done only when:

```text
requested outcome only is implemented
no adjacent WP-* was started
focused exact-head evidence passes
required shared gate passes
behavioural/visual owner acceptance is obtained when required
changed ownership/routing docs are synchronized when applicable
residual risk is recorded
canonical live task status is updated only by the selected closeout step
NEXT_ALLOWED_TASK = STOP / OWNER REVIEW
```


## 1. Relationship to existing Electronics documents

This specification does not replace the existing Electronics roadmap, product specification or hygiene rules.

It works together with:

- `ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md` — long-term capability/dependency roadmap;
- `contracts/ENGINEERING_HYGIENE_CONTRACT.md` — mandatory hygiene, deletion and legacy-retirement rules;
- `AGENT_GUIDE.md` — one-concern-per-slice, risk, evidence and review rules;
- `START_HERE.md` and `COMPONENT_MAP.yaml` — routing into the minimum required context;
- `docs/execution/current.yaml` — canonical active task only.

This specification owns only the **ordered cleanup/optimization execution programme**: what may be investigated, the bounded work-package order, required evidence, start/stop rules and completion conditions.

---

## 2. Why this specification exists

Electronics is functional and heavily tested, but long development has accumulated maintainability debt in several distinct forms:

- stale execution/control-plane state can outlive the GitHub task it describes;
- test runs can write files into repository-owned paths and leave dirty worktrees;
- provenance/audit assets may be shipped as public Web runtime files although they are not runtime sources;
- a very large CSS file contains many repeated selectors and late cascade overrides;
- some tests verify source text rather than observable behaviour, so green CI can coexist with visually rejected UI;
- several UI/controller files have grown into multi-responsibility hotspots;
- `solver.ts` and Arduino runtime contain accepted but substantial architectural debt;
- explicit compatibility/legacy paths remain and need evidence-driven retirement.

The objective is **not** to rewrite Electronics. The objective is to remove accidental complexity while preserving accepted behaviour and physical/runtime semantics.

---

## 3. Non-negotiable execution policy

### 3.1 Atomic work only

Every slice has exactly one primary outcome:

```text
one concern
→ one bounded change
→ exact-head verification
→ review
→ STOP
```

No task may silently continue into the next work package in this specification.

A task that discovers another problem records it and stops. The discovery becomes a separate owner-selected task.

### 3.2 Fresh state before every action

Before any write:

1. fetch current `main` from GitHub;
2. read the current Electronics lane from `docs/execution/current.yaml`;
3. confirm the selected task/card and its status;
4. confirm no newer conflicting Electronics work has landed;
5. record expected write paths and tests;
6. only then edit.

Never trust a previous bot report, cached SHA, stale local checkout or old CI result.

### 3.3 One action after failure

After a transport/tool/CI failure:

```text
STOP
→ re-read actual GitHub state
→ identify what actually completed
→ only then decide the next single action
```

Never blindly repeat a merge, push, build, deploy or cleanup step after a failure.

### 3.4 GitHub-first verification

Heavy verification belongs in GitHub CI whenever the repository workflow supports it.

Owner/dev machines are for:

- displaying an exact already-tested candidate;
- visual/interaction acceptance when required;
- narrowly scoped environment verification that cannot be reproduced in CI.

They are not the default place for long builds, full browser suites or repository-wide tests.

### 3.5 No deletion by appearance

A file is never deleted because it looks old, duplicated, unused or large.

Removal requires the deletion proof from `ENGINEERING_HYGIENE_CONTRACT.md`, including:

```text
runtime/import references: zero or migrated
public/package exports: zero or migrated
persistence/schema dependency: none or migrated
normative/evidence dependency: none requiring retention
protected-owner status: not protected
replacement coverage: present where behaviour moved
tests after removal: PASS
required shared gates: PASS
```

Unknown evidence means **classify and STOP**, not delete.

### 3.6 Green CI is not visual acceptance

For visible UI/CSS changes:

```text
CI PASS != owner acceptance
```

Browser/DOM tests prove objective behaviour. Owner review proves the requested visual/interaction outcome when the requirement is inherently visual.

---

## 4. Scope boundaries

### 4.1 Included

This programme may address:

- execution/control-plane hygiene for Electronics;
- generated/test artifact hygiene;
- Web packaging of Electronics assets;
- CSS consolidation and responsibility boundaries;
- test architecture improvements;
- decomposition of oversized UI/controller surfaces;
- retirement of compatibility shims when proof exists;
- later solver/model hardening under E-OPT-4;
- later Arduino runtime convergence under E-OPT-5;
- final hygiene baselines and maintainability gates.

### 4.2 Explicitly excluded from cleanup slices

A cleanup task must not hide:

- new electrical behaviour;
- changed physical equations/tolerances;
- new component/peripheral capabilities;
- new Arduino language/runtime semantics;
- schema/persistence changes;
- owner artwork replacement/redrawing;
- deployment/activation;
- unrelated product UX expansion.

If such a change becomes necessary, stop and create the correct separately selected task.

---

## 5. Initial audit findings to re-verify before execution

These are **audit signals**, not live execution state. Every task must re-measure/re-confirm its own premise before editing.

### 5.1 Control-plane drift

The Electronics entry in `docs/execution/current.yaml` has been observed retaining a completed issue/PR as `in_progress` with owner acceptance still pending.

Risk:

- future agents may re-enter completed work;
- validators may accept a stale task as executable;
- handoff/recovery becomes misleading.

### 5.2 Test/worktree pollution

Electronics browser tests have written screenshots to tracked `e2e/artifacts/electronics-simulation/**` paths, while newer UX screenshots use `reports/interactions/**`.

Risk:

- ordinary test runs modify tracked PNGs;
- untracked report files accumulate;
- reviewers cannot easily distinguish accepted evidence from disposable run output.

### 5.3 Public asset packaging

The runtime source is documented as `component-database/`, while `owner-audit/`, `owner-supplied/`, `owner-approved/` and `owner-catalog/` are provenance/evidence roots.

Because these roots live under Web `public/`, they may be copied into the production Web output and exposed as public static URLs.

Risk:

- unnecessary image size in Web/runtime artifacts;
- audit/provenance material shipped despite not being runtime data;
- repeated byte-identical assets across runtime and evidence paths.

Protected owner assets must be preserved; the optimization target is **runtime packaging**, not asset deletion.

### 5.4 CSS cascade debt

`workbench.css` is a large reviewed hotspot with many selectors defined repeatedly at the same cascade scope.

Risk:

- late rules silently override earlier fixes;
- small visual changes become hard to reason about;
- tests can confirm the existence of a rule that is not the effective rule.

### 5.5 Source-text presentation tests

`workbench-presentation.spec.ts` contains many assertions against raw TSX/CSS source text.

Risk:

- source structure becomes a hidden API;
- refactors fail without behaviour changing;
- visual/interaction defects can still pass because a string exists in source;
- tests may encode an implementation rather than the user contract.

### 5.6 Large UI/controller hotspots

Known reviewed decomposition candidates include:

- `workbench.css`;
- `WorkbenchSidebars.tsx`;
- `use-electronics-workbench.ts`;
- `WorkbenchStage.tsx`;
- `ArduinoCodePanel.tsx`;
- `ProductionComponentVisual.tsx`.

These are active code, not dead code. Decomposition must follow responsibility boundaries and preserve behaviour.

### 5.7 Solver hotspot

`contexts/electronics/domain/solver.ts` is an accepted decomposition candidate and still contains significant knowledge of concrete component kinds/type IDs.

This is not a general cleanup target. It belongs to E-OPT-4-style model/solver hardening with reference/golden evidence.

### 5.8 Legacy paths

Known examples:

- `advanceLiveSimulation` — compatibility shim with no production runtime caller but active test/benchmark dependencies;
- Arduino `legacy-ms-v1` / `advanceArduinoRuntime` — active legacy bridge with production callers.

The former may become retireable through a bounded maintenance sequence. The latter must wait for E-OPT-5-style runtime convergence.

---

## 6. Programme order

The order below is deliberate. Low-risk repository hygiene comes first; solver/Arduino semantics come last.

```text
Phase 0  Control-plane correctness
Phase 1  Test/output hygiene
Phase 2  Asset/runtime packaging hygiene
Phase 3  Test architecture hardening
Phase 4  CSS cascade consolidation
Phase 5  UI responsibility decomposition
Phase 6  Controller/stage decomposition
Phase 7  Compatibility-shim retirement
Phase 8  Solver/DeviceModel hardening (E-OPT-4)
Phase 9  Arduino runtime convergence (E-OPT-5)
Phase 10 Final hygiene acceptance
```

No later phase or work package is automatically authorized by completion of an earlier one.

---

# Phase 0 — Control-plane correctness

## WP-HYG-01 — Reconcile completed Electronics task state

**Kind:** plan/governance  
**Semantic change:** no  
**Primary outcome:** canonical execution state stops advertising completed Electronics work as active.

### Required work

- re-check Issue/PR state directly from GitHub;
- update only the Electronics lane fields required to represent reality;
- preserve other lanes byte-for-byte except unavoidable formatting owned by the tool;
- do not touch Electronics production code.

### Acceptance

- current Electronics task is not falsely executable;
- completed issue/PR is represented consistently;
- `validate:electronics-agent-docs` and governance validation pass;
- no product/runtime diff.

### STOP

Do not begin artifact cleanup in the same change.

---

## WP-HYG-02 — Prevent future stale completed-task execution

**Kind:** analysis/inventory first; governance repair only if evidence justifies it  
**Semantic change:** no

### Question

Can the existing control-plane/agent validation detect the class of drift where `current.yaml` claims an Electronics PR/task is active after GitHub has already completed it?

### Acceptance

One of:

- existing mechanism already prevents it → record proof and STOP;
- no mechanism exists → define one bounded governance repair, without coupling normal local validation to fragile network availability.

### STOP

No production changes.

---

# Phase 1 — Test and output hygiene

## WP-ART-01 — Inventory tracked Electronics screenshots

**Kind:** analysis/inventory  
**Semantic change:** no

Classify every tracked Electronics screenshot/evidence file as:

- accepted historical evidence;
- golden/reference input;
- generated/reproducible output;
- obsolete/unreferenced deletion candidate;
- unknown → STOP.

Do not delete anything in this inventory task.

### Acceptance

Produce an exact path inventory with owner/reference/test dependencies and proposed lifecycle class.

---

## WP-ART-02 — Separate disposable browser output from tracked evidence

**Kind:** maintenance  
**Semantic change:** no

### Goal

A normal browser test run must not modify tracked screenshots unless the task explicitly regenerates accepted evidence.

### Preferred direction

- disposable run screenshots → ignored reports/artifact output;
- accepted evidence → explicit capture/promotion command or reviewed evidence task;
- no hidden golden regeneration during ordinary tests.

### Acceptance

- focused browser run leaves tracked worktree clean;
- accepted evidence remains reproducible/traceable;
- no test assertions weakened.

---

## WP-ART-03 — Ignore disposable interaction reports

**Kind:** maintenance  
**Semantic change:** no

If `reports/interactions/**` is confirmed disposable output, add the narrow ignore rule or redirect output into an already ignored reports root.

### Acceptance

- interaction tests no longer leave untracked report files;
- no accepted evidence path becomes accidentally ignored.

### STOP

Do not combine with WP-ART-02 unless the write paths and acceptance are truly inseparable.

---

# Phase 2 — Asset and runtime packaging hygiene

## WP-ASSET-01 — Prove runtime vs provenance asset boundary

**Kind:** analysis/inventory  
**Semantic change:** no

### Required proof

For each Electronics asset root:

- runtime references/imports;
- build/public exposure;
- protected-owner classification;
- documentation/evidence dependencies;
- whether runtime requires the bytes at their current URL.

Expected roots include:

```text
component-database/
owner-audit/
owner-supplied/
owner-approved/
owner-catalog/
```

### Acceptance

A signed-off mapping:

```text
runtime-required
provenance-required-but-not-runtime
historical-evidence
unknown
```

No moves or deletions in this task.

---

## WP-ASSET-02 — Remove provenance-only data from Web public output

**Kind:** maintenance  
**Semantic change:** no  
**Risk:** medium because protected assets move location even though bytes must not change.

### Rules

- never redraw/normalize/recompress owner assets;
- preserve exact bytes and provenance metadata;
- runtime URLs for `component-database/` remain stable unless separately designed;
- move or package provenance-only roots outside the Web public runtime;
- update only documentation/tests that actually own those paths.

### Acceptance

- runtime Electronics assets still load byte-exactly;
- protected provenance remains in Git/recovery scope;
- provenance-only URL returns are no longer part of the Web runtime where intended;
- Web artifact size decreases measurably;
- asset validation and browser Electronics gates pass.

### STOP

Do not delete provenance material.

---

## WP-ASSET-03 — Add static-public budget/guard if justified

**Kind:** maintenance/governance  
**Semantic change:** no

Existing Web bundle budgets primarily cover JS/CSS. Decide whether a bounded guard is needed for unexpectedly large `public/` output so provenance cannot silently return to runtime packaging.

Acceptance must be based on measured runtime needs, not an arbitrary tiny size target.

---

# Phase 3 — Test architecture hardening

## WP-TEST-01 — Classify `workbench-presentation.spec.ts` assertions

**Kind:** analysis/inventory  
**Semantic change:** no

Classify assertions into:

```text
A. architecture/source guard — source-level check may be appropriate
B. DOM/interaction behaviour — migrate to component/browser behaviour test
C. visual requirement — migrate to computed geometry/style/browser evidence
D. obsolete implementation lock — deletion candidate after replacement proof
```

Do not rewrite hundreds of assertions in one task.

---

## WP-TEST-02..N — Migrate source-text assertions in small groups

**Kind:** maintenance  
**Semantic change:** no

Each task migrates one coherent contract only, for example:

- simulation button state;
- mobile shelf geometry;
- wire panel controls;
- terminal visibility;
- inspector behaviour.

### Default budget

```text
1 behaviour contract
≤2 production files unless no production change is needed
≤2 focused test files
```

### Acceptance

- new behavioural test fails if the user-visible contract is broken;
- equivalent brittle source-text assertion is removed only after replacement exists;
- broader Electronics gates remain green.

### STOP

Never combine several unrelated UI behaviours to reduce task count.

---

## WP-TEST-10 — Split oversized E2E suites by responsibility

Only after output/evidence paths are stable.

Suggested responsibility boundaries, not mandated filenames:

```text
basic/editor interactions
wires and terminals
runtime/simulation
Arduino
instruments
transients/damage
mobile/responsive
```

Acceptance is unchanged test coverage and simpler ownership, not line-count reduction.

---

# Phase 4 — CSS cascade consolidation

## WP-CSS-01 — Build effective cascade map

**Kind:** analysis/inventory  
**Semantic change:** no

For the highest-risk repeated selectors, record:

- every definition location;
- media-query scope;
- specificity;
- which declaration wins in representative desktop/mobile states;
- which definitions are intentional overrides vs historical leftovers.

Prioritize:

```text
simulation button
shell/header
component library
inspector
wire inspector
mobile shelf
stage controls
```

No CSS edits in this inventory task.

---

## WP-CSS-02 — Consolidate simulation/header styles

One visible surface only.

### Acceptance

- one canonical base rule per state;
- responsive override only where required;
- computed style before/after proves no unintended regression;
- desktop/mobile browser check;
- owner visual acceptance if appearance changes.

---

## WP-CSS-03 — Consolidate component library/mobile shelf

Same discipline: one surface, one task, no inspector changes.

---

## WP-CSS-04 — Consolidate inspector styles

Desktop and mobile rules may be handled together only if their cascade is one inseparable contract; otherwise split into separate tasks.

---

## WP-CSS-05 — Physical CSS file decomposition

Only after duplicate/cascade behaviour is understood and stabilized.

Possible responsibility modules:

```text
workbench-shell.css
workbench-stage.css
workbench-library.css
workbench-inspector.css
workbench-wire-controls.css
workbench-responsive.css
```

Exact filenames are not normative.

### Acceptance

- no visual/behaviour change unless separately authorized;
- no specificity escalation used as a shortcut;
- browser regression evidence at representative desktop/mobile sizes;
- final import order is explicit and documented.

---

# Phase 5 — UI responsibility decomposition

## WP-UI-01 — Sidebars responsibility inventory

**Kind:** analysis/inventory

Map `WorkbenchSidebars.tsx` into cohesive responsibilities before extraction.

Expected candidates:

- component library/catalog;
- component inspector shell;
- component-specific inspector sections;
- selected-wire compact inspector;
- help/information surfaces.

No code move yet.

---

## WP-UI-02 — Extract component library

Move only catalog/library responsibility.

### Acceptance

- public prop contract is minimal;
- touch placement/search/filter behaviour unchanged;
- mobile/desktop browser scenarios pass;
- no new global state/source of truth.

---

## WP-UI-03 — Extract selected-wire inspector

Only after library extraction is accepted.

---

## WP-UI-04 — Extract component inspector shell

Component-specific sections may remain colocated initially if splitting them would create excessive prop plumbing.

---

## WP-UI-05 — Review residual `WorkbenchSidebars`

Classify the remaining file as cohesive/canonical or schedule the next bounded extraction.

---

# Phase 6 — Controller and stage decomposition

## WP-CTRL-01 — Controller state/action inventory

**Kind:** analysis/inventory

Map `use-electronics-workbench.ts` state and commands into domains:

```text
viewport/pan/zoom
selection/clipboard
catalog placement
wire drafting/editing
component drag
simulation/runtime controls
Arduino/runtime projections
persistence-facing coordination
```

Record cross-domain dependencies and mutation ownership.

No extraction yet.

---

## WP-CTRL-02 — Extract one low-coupling domain

Start with the domain that has the clearest stable contract after inventory, not automatically the shortest code.

Likely candidates:

- viewport state/actions;
- selection/clipboard commands.

### Acceptance

- one source of truth remains;
- undo/redo/persistence semantics unchanged;
- focused + browser regression pass.

---

## WP-CTRL-03..N — Continue one domain at a time

Wire interaction and simulation/runtime coordination are higher risk and should be extracted later than simple viewport/selection concerns.

---

## WP-STAGE-01 — Stage responsibility inventory

Map `WorkbenchStage.tsx` into:

- background/grid;
- visible wires;
- component bodies;
- terminals/hit targets;
- selection/interaction overlays;
- wire editing handles/guides;
- tooltips/diagnostics.

No render-layer movement until z-order and pointer behaviour are explicitly documented.

---

## WP-STAGE-02..N — Extract one render layer at a time

Every extraction must prove unchanged z-order, hit-testing and pointer semantics.

---

# Phase 7 — Compatibility-shim retirement

## WP-LEGACY-01 — Re-inventory `advanceLiveSimulation`

**Kind:** analysis/inventory

Reconfirm:

- production runtime callers;
- test callers;
- benchmark callers;
- public export dependencies;
- historical evidence mentions.

No deletion.

---

## WP-LEGACY-02 — Migrate benchmark callers

Move only active benchmark tooling to the canonical engine/clock path.

### Acceptance

- benchmark semantics remain equivalent;
- baseline/golden is not regenerated merely to make the migration pass;
- performance comparison remains meaningful.

---

## WP-LEGACY-03 — Migrate remaining active test callers

One coherent caller group at a time if necessary.

---

## WP-LEGACY-04 — Remove `advanceLiveSimulation` only after proof

Deletion is allowed only when:

```text
production callers = 0
test callers = 0
benchmark/tool callers = 0
public consumers = 0
historical evidence remains truthful without rewriting history
replacement tests = PASS
```

Delete only the obsolete helper/exports, not active preflight helpers in the same file.

---

# Phase 8 — Solver / DeviceModel hardening

This phase belongs to **E-OPT-4-level risk**. Do not begin it as ordinary cleanup.

## WP-SOLVER-01 — Component-specific branch inventory

**Kind:** analysis/inventory  
**Semantic change:** no

For every concrete component branch in `solver.ts`, classify:

```text
orchestration legitimately owned by solver
model behaviour that belongs in DeviceModel/profile registry
presentation/diagnostic logic that belongs elsewhere
legacy bridge
unknown/design decision required
```

No equations move in this task.

---

## WP-SOLVER-02..N — Move one model family at a time

Each semantic move is a separately selected high-risk task with:

- analytical/reference fixture where applicable;
- golden/regression comparison;
- direct/Worker parity;
- numerical quality checks;
- independent review when required by the existing guide.

Never pursue a line-count target.

---

# Phase 9 — Arduino runtime convergence

This phase belongs to **E-OPT-5-level risk**.

## WP-ARD-01 — Re-inventory legacy clock callers

Reconfirm all production/test/public dependencies on:

```text
legacy-ms-v1
advanceArduinoRuntime
instruction-us-v1
advanceClockedArduinoRuntime
```

No runtime change.

---

## WP-ARD-02..N — Converge one caller class at a time

Possible classes:

- stateless/snapshot solver callers;
- Arduino model callers;
- tests/reference tooling;
- capability metadata.

### Acceptance

- canonical physical-time contract preserved;
- reset/pause/resume/input event behaviour remains deterministic;
- no second scheduler/timer path introduced;
- parity and Arduino correctness suites pass.

---

## WP-ARD-FINAL — Retire legacy profile only after zero production dependency

Same deletion-proof discipline as other legacy retirement.

---

# Phase 10 — Final hygiene acceptance

## WP-FINAL-01 — Full Electronics hygiene audit

**Kind:** analysis/inventory / governance acceptance

Re-measure:

- large production sources and growth;
- CSS repeated effective selectors;
- source-text test count;
- tracked generated-output pollution;
- Web public Electronics asset size;
- active legacy bridges;
- orphan/dead candidates;
- generated artifact ownership;- routing/control-plane correctness.

Update `evidence/hygiene-baseline.yaml` only from verified facts.

---

## WP-FINAL-02 — Residual debt register

Every remaining concern must be one of:

```text
canonical-active
active-legacy-bridge + retirement condition
compatibility-shim + retirement condition
generated + generator
historical-evidence
protected-owner-asset
dead-orphan-candidate + missing proof
decomposition-candidate + reason
```

No unclassified large/legacy concern remains.

---

## WP-FINAL-03 — Owner acceptance and STOP

Final result is accepted only when:

- required CI is green for the final exact candidate;
- no hidden semantic changes occurred under cleanup labels;
- owner-visible UI remains accepted where affected;
- canonical execution/routing state is current;
- rollback/history/evidence remain intact.

Then STOP. This specification still does not auto-authorize E-OPT-4, E-OPT-5 or another product feature.

---

## 7. Standard task template for this programme

Every cleanup task should be written in this compact form:

```text
TASK:
<one task ID>

BASE:
fresh main fetched immediately before work

GOAL:
<one observable outcome>

KIND:
analysis/inventory | maintenance | repair | plan/governance | design-decision

SEMANTIC_CHANGE:
no | yes

EXPECTED_WRITE_PATHS:
<small exact list>

EXPECTED_TESTS:
<small exact list>

DO NOT:
<explicit adjacent work that is forbidden>

PREFLIGHT:
verify main
verify current.yaml task selection
verify relevant premise/caller/path

ACTION:
perform one bounded change

VERIFY:
focused exact-head checks
required shared gate
visual owner check only when applicable

REPORT:
HEAD
changed files
checks
residual risk

STOP:
yes
```

Default maintenance budget remains the repository guide's budget:

```text
1 primary concern
≤5 production files
≤2 focused test files
no roadmap/architecture expansion
```

If a task cannot fit this budget, split it before implementation unless the task card explicitly justifies the exception.

---

## 8. Evidence rules by task class

| Task class | Minimum evidence |
| --- | --- |
| Governance/control-plane | routing/governance validation; no production diff |
| Test/output hygiene | focused test run + clean worktree proof |
| Asset packaging | asset validation + Web build + runtime URL checks + size measurement |
| Source-test migration | replacement behavioural test proves the same contract |
| CSS consolidation | computed-style/geometry browser evidence + representative responsive checks |
| UI/controller decomposition | focused tests + type/build + browser regression; no behaviour drift |
| Legacy shim retirement | zero caller/export proof + replacement tests + broader required gate |
| Solver/model change | reference/golden/numerical evidence + parity + required independent review |
| Arduino runtime change | clock/correctness/replay evidence + parity + required independent review |

Do not run a repository-wide suite merely as a substitute for focused acceptance. Run focused proof first, then repository-mandated broader gates.

---

## 9. Metrics: what optimization means

Optimization is not measured by fewer files or fewer lines alone.

### Good outcomes

- canonical task state matches reality;
- normal test runs leave the worktree clean;
- runtime Web artifact contains runtime assets, not audit archives;
- one visible UI state has one understandable CSS ownership path;
- behavioural tests check behaviour rather than implementation spelling;
- large files shrink because responsibilities move to stable boundaries;
- solver learns fewer concrete component details as DeviceModels mature;
- legacy bridges disappear only when callers truly reach zero;
- Electronics remains deterministic and testable.

### Bad metrics / forbidden incentives

Do not optimize toward:

```text
minimum line count
maximum file count
zero duplicate strings at any cost
rewriting working code for style
regenerating golden evidence to hide differences
removing protected/history files to make the repository smaller
```

---

## 10. Recommended immediate sequence

After this specification is integrated, the recommended first owner-selectable sequence is:

```text
1. WP-HYG-01   reconcile stale Electronics execution state
2. STOP + verify
3. WP-ART-03   eliminate disposable interaction-report pollution
4. STOP + verify
5. WP-ART-01   inventory tracked screenshots
6. STOP + owner decides evidence retention policy
7. WP-ASSET-01 prove runtime/provenance asset boundary
8. STOP + owner review
9. WP-ASSET-02 remove provenance-only assets from Web public packaging
10. STOP + verify exact Web/runtime behavior
```

Only after those low-risk foundations should CSS/test/UI decomposition begin.

---

## 11. Repository integration contract

For this specification to remain discoverable and executable without becoming a second control plane:

1. `START_HERE.md` routes cleanup/optimization/decomposition/legacy-retirement requests here after active-task confirmation;
2. `AGENT_GUIDE.md` requires programme cleanup tasks to read the selected `WP-*` section in addition to the hygiene contract;
3. `tasks/MAINTENANCE_TASK_TEMPLATE.md` requires concrete cleanup cards to cite one exact `WP-*` prerequisite;
4. `ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md` references this specification from the cross-cutting hygiene section while retaining ownership of capability dependency order;
5. this specification never stores live task status, branch, SHA, CI result or deployment state;
6. existence of this specification never activates a work package.

Live progress belongs in GitHub issues/PRs, concrete task cards, evidence and `docs/execution/current.yaml`.

### 11.1 Change control for this specification

Changes to phase order, work-package meaning, cleanup authority or deletion policy require a separately selected `plan/governance` or design task. Ordinary maintenance tasks may not edit this specification merely to legitimize their implementation.

---

## 12. Definition of programme completion

The cleanup/optimization programme is complete when all of the following are true or explicitly classified as retained debt:

- control-plane/routing state is current and fail-closed;
- disposable test output does not pollute tracked/untracked worktrees;
- provenance assets are preserved without being unintentionally shipped as runtime Web data;
- CSS ownership is understandable and major same-scope override clusters are retired;
- visual/interaction requirements are predominantly protected by behavioural/browser tests rather than source-string existence checks;
- UI/controller hotspots have bounded responsibilities or accepted retention rationale;
- `advanceLiveSimulation` compatibility shim is retired or has a current evidence-backed retention reason;
- solver and Arduino legacy concerns have either completed their E-OPT hardening path or remain explicitly classified with retirement conditions;
- final hygiene baseline reflects the actual repository;
- no protected owner asset, historical evidence or generated artifact has been removed without its required proof/authorization;
- the final exact candidate passes required gates and owner review for any affected UI.

**Final rule:** a cleaner repository is not permission to start another feature. The next feature or cleanup work package still requires explicit owner selection.