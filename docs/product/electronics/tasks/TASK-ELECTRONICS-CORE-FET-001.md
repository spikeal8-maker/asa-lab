---
task_id: TASK-ELECTRONICS-CORE-FET-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - This prospective controller selection is accepted on main before product writes
  - Fresh main and candidate refs, scoped preflight and actual overlapping-work check
  - One composer applies the retained FET-only delta to fresh accepted main; PR651 remains deferred
  - Independent public-API BEFORE and analytic reference fixed before the repair
acceptance_boundary: slice
review: independent
---

# СТ-04 / Q-FET-01–02: согласованный ток и нелинейная сходимость

Issue [658](https://github.com/spikeal8-maker/asa-lab/issues/658), programme
[452](https://github.com/spikeal8-maker/asa-lab/issues/452). This is a prospective
selection for one FET correction, not acceptance of all СТ-04 or the programme.
On 20 October 2026 the owner explicitly appointed the controller to manage
Electronics development through separate authors and independent reviewers.
The controller selects this bounded correction; product writes start only after
this card and its own lane are accepted on main.

## One visible result

Both supported reference circuits solve in the existing core and editor. Source,
FET and resistor currents agree with the declared model and KCL. A valid circuit
does not end as `nonconvergent` because stamping and observation disagree.

## Component and minimal read set

Primary component: `electronics.engine.solver`, ASA-owned, high risk, routed by
`../COMPONENT_MAP.yaml` to the matching entry in
`../components/engine-worker-clock.yaml`.

Read the root policies and `../START_HERE.md`, that exact component entry,
`../README.md` §10/§12, and this card. The owner package is
[SPEC.md revision 2.1](https://github.com/spikeal8-maker/asa-lab/blob/docs/electronics-core-stabilization-20261020/docs/delivery/handoffs/electronics-core-stabilization-20261020/SPEC.md)
§5.2, СТ-04 and Q-ROB-04, with its adjacent README revision 2.2. This card carries
the complete selected numerical references; the executor need not reload the
whole programme.

Exact implementation context is `contexts/electronics/domain/solver.ts`: existing
FET stamping, iteration evaluation and current observation inside the public
`solveCircuit` path. Read `contexts/electronics/domain/simulation.ts` only at the
`analyseCircuit` public boundary, without editing it. Existing focused references
are `contexts/electronics/testing/solver.spec.ts` and
`contexts/electronics/testing/capacitor-transient-model.spec.ts`.

## BEFORE and independent reference

The controller's public-API reproduction on main
`dcdf72185673808ee6798462da5399c94cfe194e` observed:

| Fixture | Independently expected | Actual BEFORE |
| --- | --- | --- |
| Q-FET-01: Vd=5 V, Vg=3 V, Vs=0, k=0.01 A/V², Vth=2 V | Id=10 mA | FET 10 mA; source 10.500000005 mA; KCL residual 0.500000005 mA; `nonconvergent`, 2 iterations |
| Q-FET-02: same circuit with Rs=100 Ω from source to ground | Vs=(3−√5)/2=0.38196601125 V; Id=(3−√5)/200=3.8196601125 mA | Vs=0.522388059557 V; FET 2.281131657 mA; source 5.223880601 mA; KCL residual 2.942748944 mA; `nonconvergent`, 2 iterations |

The existing solver and capacitor specs actually passed 161/161. This does not
establish the independent FET requirements. DC 5 V / 1 kΩ gave 5 mA; RC 5 V,
1 kΩ, 100 µF at 100 ms gave 3.152020032326 V versus analytic 3.160602794143 V,
inside the 1% reference tolerance. These are dated BEFORE observations, not
final-source or browser acceptance.

Preserve the declared active-region law `Id=k·max(Vgs−Vth,0)²`. Q-FET-02 solves
`I=0.01·(1−100I)²` using the physical root. For Q-ROB-04 use Vg=2.5, 3 and 4 V,
Rs=100 Ω and compute the physical root independently before the repair; verify
that each point actually lies in the active region. Required isolated reference
tolerances are 10 nA current and 10 µV voltage, with finite results, solved status
and quality PASS. Do not weaken KCL or add an undeclared physical shunt.

Two source-confirmed causes guide the bounded experiment: active stamping adds
`1e-4 S` absent from the observed current law; numerical overdrive can change
without changing the region name, allowing premature iteration termination.
A valid repair must address both, not merely remove the shunt or repeat a golden.

## Standalone selection after the inherited gate failure

The controller prospectively changes the composition of this same Issue658
slice. Independent review established that PR651 is not a functional dependency
of the FET correction. The earlier composite
`e8a7c2bd04ad5ec75acfd7d3f4f00482f37efcfa` remains retained: its FET source was
independently approved, eight reference cases and ten additional independent
cases passed, but focused run `39442503268` failed with 922 PASS / 1 FAIL. The
inherited `delay(2000)` case took 5812 ms against its unchanged 5000 ms budget.
General run `39442503313` was still running at the controller's decision; neither
that observation nor any prior PASS accepts the next source. These facts remain
historical evidence, not a reason to increase budgets or restart attempt counters.

The selected result is now **fresh accepted main plus the same FET-only repair**,
the same eight-case reference spec and its test-route entry. Do not hold this
independent correction behind an unaccepted unrelated PR651 change. Preserve the
whole original PR651 at `de9d84a4108a5952b921b40d1575651265391873` and parent
`16cbed5d981989528f2d1bd8f62e2a1c4063781f`; do not change its remote branch or
declare it accepted. All six paths below on observed main
`83714ca4a36ff272859fd2818935f2ef5630644b` are byte-identical to that parent:

- `contexts/electronics/domain/arduino-circuit-scheduler.ts`
- `contexts/electronics/domain/simulation.ts`
- `contexts/electronics/domain/solver.ts`
- `contexts/electronics/testing/engine-timed-api.spec.ts`
- `contexts/electronics/testing/simulation-contract.spec.ts`
- `contexts/electronics/testing/solver.spec.ts`

The composer may mechanically exclude de9 only from our derivative by restoring
these accepted-main bytes. Five non-FET files must equal fresh accepted main
exactly; `solver.ts` must equal that main plus only the same four textual edits
inside two existing FET regions. This is not rollback of accepted code. Do not
remove an accepted test, change `delay(2000)` or its 5000 ms assertion, or author
new scheduler, simulation or legacy/generic test semantics. Unaccepted PR651
source/tests remain available in its unchanged original candidate.

Continue PR660 only through normal forward commits/merge, without force-push or
rewriting published history. Preserve e8 and all its reviews, attempts and CI.
The composition decision changes no defect identity or diagnostic-budget counter.

The controller `/root` assigns `/root/fet_runtime_author` as the sole composer
and `/root/core_baseline` as independent final reviewer; the reviewer does not
author product changes. Inherit this selection from main before new source writes.

The controller previously transferred only the `solver.ts` writer from the
advisory `electronics-arduino` scope to `electronics-core-fet`. That handoff is
unchanged. Stopped R27 remains stopped: task status, retained sources/reviews,
existing blocker and explicit-resume rule are preserved. This standalone choice
grants no permission to resume or accept Issue546, PR651 or R27.

All other agents on this composition are read-only. If another author is actually
writing intersecting files, stop product writes and obtain a concrete controller
handoff. A known ref alone is not permission to overwrite foreign dirty work.
The standalone source requires new exact-source tests and independent review;
old composite evidence does not automatically transfer. Existing PR651 and
Issue546 failures, blockers and acceptance conditions remain open separately.

## Exact new write scope

- `contexts/electronics/domain/solver.ts`: accepted-main source plus only the
  retained four FET edits in its existing stamping and iteration regions.
- `contexts/electronics/testing/fet-dc-reference.spec.ts`: retain the same eight
  independent reference/regression cases; no assertion or tolerance change.
- `docs/product/electronics/components/engine-worker-clock.yaml`: only add the
  new spec path to `electronics.engine.solver.tests` when the spec is created;
  no other component, source, contract or map change.
- This card and only this task's own `docs/execution/current.yaml` lane are
  controller-owned documentation, not author-selected execution permission.

The six paths listed above are additionally allowed only for the mechanical
exclusion of the unaccepted dependency. This exceeds the ordinary file/test
budget solely for restoring accepted-main bytes, not authoring more production
or test semantics. New repair code remains one solver plus one spec and its route.
A new helper needs a separate scope decision. No Arduino/runtime, NPN/LED,
D2/D4 UI, owner SVG, qualification, timing, workflow, data or deployment change.

This does not select E-OPT-4 as a whole or replace the current D2/D4 slice. Its
50 ms, pace 0.125, 6250 µs lookahead and all other accepted criteria remain
unchanged. No new current clamp, region threshold or MOSFET model is selected.

## Acceptance and required evidence

1. Through the public core API, Q-FET-01 and Q-FET-02 meet the fixed references,
   current/voltage tolerances and quality/KCL requirements.
2. Vg=2.5/3/4 V feedback points match their independently calculated physical
   roots; changing the gate changes current as the model prescribes.
3. Cutoff and existing ohmic behaviour remain finite and consistent. A deliberately
   insufficient iteration budget gives a bounded honest failure, not false solved.
4. Existing accepted DC, diode/LED, NPN/PNP, PSU, RC and generic/prepared routing
   regressions remain correct. The five restored files equal fresh main; no
   accepted test or timing assertion is removed, skipped or weakened.
5. Compare stamp and published terminal currents, including source and Rs;
   use convergence of the numerical operating point, not region names alone.
6. In the built existing editor, actually open and run both FET circuits and
   check displayed current/voltage against the accepted state. Source-only,
   DOM-only and a planned browser action are not completed visual acceptance.

## Commands, review and delivery

After main has accepted selection, the author runs:

```bash
pnpm agent:preflight --scope electronics-core-fet --check
pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-CORE-FET-001
NX_SKIP_NX_CACHE=true pnpm test contexts/electronics/testing/fet-dc-reference.spec.ts contexts/electronics/testing/solver.spec.ts contexts/electronics/testing/capacitor-transient-model.spec.ts
NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1
NX_SKIP_NX_CACHE=true pnpm benchmark:electronics:ci
NX_SKIP_NX_CACHE=true pnpm gate:electronics-classroom-d13-v3:browser
NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1:browser
NX_SKIP_NX_CACHE=true pnpm gate:repository
```

Use existing gate commands without narrowing suites, retries or profile changes.
The classroom and strict conclusions are separate facts. Run browser/data gates
in their authorised isolated environment with actual prerequisites; missing
prerequisites mean NOT_RUN/BLOCKED, never PASS. Record the exact final source SHA,
actual work done without Nx cache, required independent source and runtime review,
and concrete screenshots/measurements. Classify unrelated red CI per AGENTS.md;
it authorises no foreign repair and no acceptance bypass.

`solver.ts` exceeds 50,000 bytes: retain the existing decomposition-candidate
classification and review its bounded retained responsibility. Apply
`../contracts/ENGINEERING_HYGIENE_CONTRACT.md` and existing baseline without
raising thresholds, resetting review sizes or declaring a full hygiene checkpoint.
This production-changing repair counts toward the three-slice hygiene interval;
this prospective documentation-only selection does not. A due checkpoint is not
waived by the selection.

The author performs self-review and stops at this bounded result. A different
reviewer evaluates the standalone final bytes and actual evidence; old composite
review is not final-source acceptance. The controller may integrate only after
all applicable slice acceptance conditions are satisfied, then continues the
owner programme. Separately record tested, pushed, CI, IN_MAIN, deployed and
owner accepted. All standalone AFTER, browser, integration and owner results are
pending at amended selection. No deployment, working-database or installation
action is authorised.
