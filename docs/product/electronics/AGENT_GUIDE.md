# ASA Lab Electronics — token-efficient agent guide

**Scope:** Electronics/Arduino implementation, maintenance, design decisions and deployment.
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
PREREQUISITES
EXPECTED_WRITE_PATHS
EXPECTED_TESTS
EXPLICITLY_NOT_DOING
STOP_AFTER
```

If these cannot be stated precisely, do not code yet.

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

### `maintenance`

May repair/refine an already implemented capability. Must not begin a future roadmap capability, change architecture to make the fix easier, or deploy.

### `implementation`

May implement exactly one selected roadmap slice. The task must name its prerequisite acceptance. Completion never authorises the next roadmap slice.

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

### LOW

Text, local presentation, documentation, isolated refactor with no runtime semantics.

Required: focused test or documentation validation + bounded self-review.

### MEDIUM

Worker/controller orchestration, component model plumbing, local Arduino/runtime extension with established interfaces.

Required: focused tests + type/lint/build evidence + self-review.

### HIGH

Solver equations, convergence/tolerance policy, canonical clock, Arduino timing semantics, persistence/autosave, model identity, cross-worker/server parity.

Required: focused + golden/regression gates + independent review before acceptance.

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

There must be one canonical physical-time contract. UI cadence, React render rate and `setInterval` are presentation concerns only.

Do not add Servo, ultrasonic, `pulseIn`, interrupts, IR, NeoPixel or another timing-sensitive peripheral by inventing a second/third timer path. Missing timing primitive means the peripheral task is blocked.

## 8. Solver/model special rule

Do not add a new `componentTypeId === ...` branch to the general solver when behaviour can be expressed through DeviceModel/profile/model registry.

Changing solver equations requires analytical/reference fixture or an explicit plan for producing one. Green unit tests alone are not evidence of physical accuracy.

## 9. Worker special rule

Worker is an execution boundary, not a second physics implementation.

- direct engine and Worker results must preserve parity;
- one in-flight heavy solve by default;
- stale generation/session/document results are rejected;
- failures are visible/fail-closed;
- no silent synchronous fallback that reintroduces main-thread blocking.

## 10. Write discipline

Before adding a new file, check whether the mapped component already owns a suitable source. Before expanding a large hotspot file, decide whether the new concern deserves a stable module/symbol boundary.

If source/test ownership changes, update the matching subsystem card in the same slice. Update `COMPONENT_MAP.yaml` only when stable IDs, routes or human keywords change.

Do not copy active task/SHA/CI/deployment status into component cards.

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

Independent review is mandatory for HIGH/CRITICAL slices and for integrated milestone boundaries. The reviewer receives the bounded task, diff, mapped contracts and evidence — not the full repository by default.

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