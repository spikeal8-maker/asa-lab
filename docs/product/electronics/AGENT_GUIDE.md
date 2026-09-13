# ASA Lab Electronics — token-efficient agent guide

**Scope:** Electronics/Arduino analysis, implementation, maintenance, design decisions and deployment.
**Primary goal:** complete one bounded concern with the minimum safe context and then stop.

## 1. Progressive disclosure

Default read order:

```text
START_HERE.md
→ COMPONENT_MAP.yaml
→ one subsystem card
→ one selected task card
→ mapped normative sections
→ mapped source/tests
```

The full normative `README.md` is not default context. Read only exact headings/sections required by the selected card/task. Broad repository search is fallback only when routing is stale or the request is truly cross-cutting.

## 2. One concern per slice

A slice must have one primary outcome. It may touch supporting files only when they are direct dependencies of that outcome.

Before editing, print/record:

```text
TASK_KIND
GOAL
COMPONENT_IDS
OWNERSHIP
RISK
SEMANTIC_CHANGE: yes | no
PREREQUISITES
EXPECTED_WRITE_PATHS
EXPECTED_TESTS
EXPLICITLY_NOT_DOING
STOP_AFTER
```

If these cannot be stated precisely, do not code yet.

Concrete cards use one YAML frontmatter block at the start of the Markdown file.
Templates supply its eight fields: `task_id`, `kind`, `risk`, `semantic_change`
(`yes|no`), `roadmap_slice` (exact E-OPT slice or `null`), `prerequisites` (references,
not completion status), `acceptance_boundary` (`slice|milestone`) and `review`
(`self|independent`). Metadata is not duplicated in prose. The validator rejects
missing/unknown fields, malformed declarations and review weaker than §13 requires.

Every active Electronics task needs exactly one card, independent of its product ID.
Only `TASK-ELECTRONICS-GOVERNANCE-<nnn>` and `TASK-ELECTRONICS-CONTROL-<nnn>` may use
an owner-selected governance scope without a product card. All other task IDs use
`TASK-ELECTRONICS-<UPPERCASE-CONCERN>-<nnn>` and are fail-closed when no card matches.
Before executable work, `pnpm validate:electronics-agent-docs --task <selected-id>`
must match canonical `current.yaml` with `status: in_progress`. Default validation
also checks planned cards; their existence never activates them. Review metadata
declares a requirement, not proof that review occurred.

### Default size budget

Maintenance:

```text
1 primary component ID
≤5 production files
≤2 focused test files
no roadmap/architecture change
```

Milestone implementation:

```text
1 primary subsystem, at most 2 component IDs
≤10 production files by default
one accepted prerequisite boundary
one acceptance gate
```

Exceeding a budget is not automatically forbidden, but the task card must explain why before editing. Otherwise split the work.

## 3. Task kinds and allowed behaviour

### `maintenance` / `repair`

May repair/refine an already implemented capability. Must not begin a future roadmap capability, change architecture to make the fix easier, or deploy.

### `implementation`

May implement exactly one selected roadmap slice. The task must name its prerequisite acceptance. Completion never authorises the next roadmap slice.

### `analysis/inventory`

Read-only for product/runtime; may create evidence/docs within the selected card's scope.
Requires `semantic_change: no`: no normative behaviour changes or architecture/API decisions.
Record any discovered design question and STOP for a separately selected decision task.
Bounded self-review and declared validation suffice; this kind or an area's risk alone does
not require independent review. It cannot substitute for integrated milestone acceptance.

### `design-decision`

May inspect alternatives, produce a decision/proof fixture and update stable contracts. It must not implement the following milestone.

### `component/peripheral`

May add exactly one capability only when its engine/clock/runtime prerequisites are already accepted. A sensor that needs missing timing primitives is a STOP, not permission to invent UI timers.

### `deployment`

May deploy only an exact already-tested SHA. It must not modify product behaviour to make deployment pass.

### `plan/governance`

May repair routing, plan, task cards and agent rules. No product/runtime edits.

## 4. Roadmap dependency rule

`ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md` owns long-term dependency order. `docs/execution/current.yaml` owns what is active now.

An agent must distinguish:

```text
planned      != active
implemented  != deployed
merged       != deployed
green CI     != owner acceptance
available    != authorised to start
```

If a later capability has already been implemented out of order, record that fact but do not pretend its missing prerequisite is complete. Close the prerequisite explicitly before building further dependencies on it.

Changing the plan is a separate governance/design task. An implementation task may not rewrite dependencies to legitimise its own scope.

## 5. Risk classes

Component/card risk describes the area. Task risk describes the actual proposed change;
reading a HIGH/CRITICAL area does not itself make a slice HIGH/CRITICAL.
Every task declares `Semantic change: yes|no`. Changing a normative behavioural contract
counts as semantic change even when the diff contains only documentation.

### LOW

Text, local presentation, documentation, isolated refactor with no runtime semantics.

Required: focused test or documentation validation + bounded self-review.

### MEDIUM

Worker/controller plumbing or model wiring that preserves established timing, runtime,
persistence and engine-parity contracts. Changes to those semantics are HIGH.

Required: focused tests + type/lint/build evidence + self-review.

### HIGH

Solver equations, convergence/tolerance policy, canonical clock, Arduino timing semantics, persistence/autosave, model identity, cross-worker/server parity.

Required evidence: focused + golden/regression checks as applicable to the changed contract.
Review is determined by [§13](#13-independent-review), not by the component's area label alone.

### CRITICAL

Destructive migration, production DB/volume action, activation, security/RLS boundary weakening, owner-asset replacement, irreversible deployment action.

Required: STOP without explicit owner-selected task; independent review and rollback evidence mandatory.

## 6. Electronics invariants

Every accepted slice preserves:

- deterministic netlist independent of wire drawing geometry;
- breadboard group electrical connectivity;
- fail-closed unsupported/invalid/nonconvergent semantics;
- finite successful numeric results;
- independent KCL/source/power quality checks;
- deterministic normalized result for equal input/version;
- UI does not invent electrical truth;
- client simulation remains local and server verification reuses the same engine/model set;
- owner SVG provenance and protected artwork rules;
- user document does not persist computed current/voltage/temperature as truth.

If a requested change conflicts with an invariant, stop and escalate the design decision.

## 7. Clock and Arduino special rule

Apply the [determinism/clock contract](DEVELOPMENT_SPEC.md#13-determinism-and-execution-failures)
and [peripheral extension requirements](DEVELOPMENT_SPEC.md#14-component-and-peripheral-extension-contract).

Do not add Servo, ultrasonic, `pulseIn`, interrupts, IR, NeoPixel or another timing-sensitive peripheral by inventing a second/third timer path. Missing timing primitive means the peripheral task is blocked.

## 8. Solver/model special rule

Do not add a new `componentTypeId === ...` branch to the general solver when behaviour can be expressed through DeviceModel/profile/model registry.

Changing solver equations requires analytical/reference fixture or an explicit plan for producing one. Green unit tests alone are not evidence of physical accuracy.

## 9. Worker special rule

Worker changes preserve [execution/failure semantics](DEVELOPMENT_SPEC.md#13-determinism-and-execution-failures)
and require the applicable [isolation/parity evidence](DEVELOPMENT_SPEC.md#71-architecture-acceptance-evidence).
Use those exact sections when scoping a Worker repair; no full specification preload.

## 10. Write discipline

Before adding a new file, check whether the mapped component already owns a suitable source. Before expanding a large hotspot file, decide whether the new concern deserves a stable module/symbol boundary.

If source/test ownership changes, update the matching subsystem card in the same slice. Update `COMPONENT_MAP.yaml` only when stable IDs, routes or human keywords change.

Do not copy active task/SHA/CI/deployment status into component cards.

`sources` contains exact readable files only; `symbols` names real TS/TSX/JS/MJS
top-level declarations (export is optional); nested/local declarations do not qualify.
`asset_roots` separately identifies
protected owner-supplied/owner-audit directories; it is never a preload or edit grant.
Explicit empty `sources`/`tests` means there is no mapped code/test entry; consult
the prerequisite contract before selecting implementation. It does not imply readiness.

## 11. Tests and evidence

Use the smallest gate that proves the acceptance contract, then any repository-mandated broader gate for the touched risk/shared paths.

Typical Electronics evidence may include:

```text
pnpm gate:electronics-m1
pnpm gate:electronics-m1:browser
pnpm benchmark:electronics:ci
pnpm gate:governance
```

Do not claim a broader PASS than the commands actually run. Evidence belongs to the exact reviewed SHA/content.

## 12. Bounded self-review

Review only:

```text
selected task card
final diff
mapped component entries
exact mapped contract sections
focused test evidence
```

Questions:

1. Did the diff implement only the requested outcome?
2. Is every touched path justified by component ownership/dependency?
3. Did I start a later roadmap capability?
4. Did I weaken a simulation/asset/persistence invariant?
5. Did I create a second source of truth or duplicate runtime?
6. Are tests proving acceptance rather than only compilation?
7. Did source/test ownership change and routing stay current?
8. Is residual risk explicit?

Report:

```text
SELF_REVIEW: PASS | PASS_WITH_RISK | FAIL
components: ...
scope: ...
acceptance: ...
tests: ...
unrequested_changes: none | ...
routing_docs: unchanged | updated
residual_risk: none | ...
NEXT_ALLOWED_TASK: STOP | <owner-selectable task id>
```

`FAIL` means repair the current slice or stop. It never authorises scope expansion.

## 13. Independent review

Independent review is mandatory for actual CRITICAL operations, HIGH semantic changes,
and integrated milestone acceptance boundaries. This includes solver equations,
convergence/tolerance policy, canonical physical time, Arduino timing/runtime,
persistence/schema/autosave, security/RLS, cross-boundary engine parity, owner-asset
replacement and production/destructive/irreversible operations.

Read-only inventory, analysis, documentation-only routing and test-only characterization
with `Semantic change: no` require bounded self-review and applicable routing/governance
validation; a HIGH/CRITICAL component label alone does not require a second agent.
This exception does not cover changing normative semantics, weakening assertions or an
integrated milestone acceptance. If such a decision is discovered during inventory,
record it and STOP for a separately selected design/implementation task.

When required, the reviewer receives the bounded task, diff, mapped contracts and evidence
— not the full repository by default.

A defect found in independent review becomes a bounded repair to the current slice. The author does not silently broaden the task or begin the next milestone.

## 14. Deployment discipline

Implementation ends before deployment. A deployment task must separately prove:

- exact target SHA already exists in GitHub;
- target CI/gates are acceptable;
- compose/env/schema delta is understood;
- DB migration need is explicit;
- backup/rollback exists before switching;
- candidate image/stack was tested separately when practical;
- post-deploy health/version/schema/user-flow checks pass;
- rollback is performed if acceptance fails.

Never deploy moving `main`; deploy the exact gated SHA.

## 15. Stop rule

After acceptance evidence and self-review, **STOP**. Do not “continue while context is warm”. Token efficiency and safety both depend on starting the next task in a fresh bounded context.
