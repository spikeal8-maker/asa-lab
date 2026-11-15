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


## Actual standalone evidence and strict-baseline hold, 2026-10-20

Remote draft PR660 is `e826794c1cb4aec1280630040f2652272b3d5de1`, tree
`5e162fa4744feabe7845c87556a744fe4ff27f7b`. Local full focused gate passed
913 model and645 editor tests; type/build,114 routing tests and169 targeted
cases (eight new FET plus161 existing solver/RC) passed. Independent source
review approved eight references plus ten independent cases. Both FET circuits
were actually exercised in the built editor and approved; auth/storage were
mocked, explicitly bounding that evidence rather than asserting owner data flow.

Exact cloud focused job `118707282327` and classroom-profile focused job
`118717587341` succeeded. Benchmark job `118708507269` in run `39445810814`
succeeded on exacte826/dirtyfalse: five phases include core50 cases, native
browser5, low-end browser5, load and memory. Report artifact `12277101199`,
17376bytes, SHA256
`ef200a0a663325d2ed8c84ea40f9bca77d5bf1477479cf6ffe09d2f548c742a9`.
General `39445810773` succeeded. These facts do not accept the complete slice.

Required strict run `39445810814` **FAILED:159 PASS /11 FAIL of170**. Browser
artifact `12278495147`,379456161bytes, SHA256
`bc24701a122cd0562fb17f6e573714f7b3f27e530487544f2d11ff904f0d0134`.
Independent classification identifies ten ready-cadence acquisition failures
repeated on accepted075 strict `39350682439`, job `118394940376`. Relevant
source/fixtures contain no FET, and the exact runtime delta is four hunks only
in FET loops, not executed by those fixtures. The DC1024 failure throws
`Integer clock observer overflow` above500frames from unchanged e2e; it is NOT
claimed historically identical, and its complete root cause is not proved.

At the dated controller observation, required classroom run `39448747806` on
exacte826/profile `classroom-d13-v3` remains **in_progress**; its focused and
benchmark jobs succeeded. No full classroom PASS is recorded. Await the complete
result/native evidence and final independent acceptance. All earlier composite
source/reviews/failures and attempt accounting remain retained.

`ELECTRONICS-658-STRICT-BASELINE` blocks integration, technical acceptance,
Issue closure, owner acceptance and release claims. Existing required strict
and classroom gates are unchanged. AGENTS§2.1C failure classification supplies
no waiver or automatic integration, including if classroom later passes. A
separate baseline fix or explicit owner integration-boundary decision is required
before merge; this card does not select either outcome or authorise foreign
repairs. PR660 stays Draft, Issue658 open, owner acceptance pending. No resumed
R27/Issue546 work, deployment or working-data operation is authorised.


## Final classroom failure and bounded native review, 2026-10-20

Superseding the earlier in-progress observation: exact-e826 classroom
`39448747806` completed **FAIL:168 PASS /2 FAIL of170**. General
`39445810773` remains SUCCESS; strict `39445810814` remains FAIL159/11.
Verified classroom artifact `12278554216`,268394292bytes, ZIP SHA256
`5ebf51135c8572bca93e62eb88f12c41001fa50bae1efb07b4e1a5071ea23d16`.
Independent reader report `classroom-39448747806-review/review-report.json`,
SHA256 `5d92085b45e4e5d3d8215cbac07494cf80b697b05c365cd62df78207473ddd22`,
records11of12 qualification ledgers PASS. Blockly is FAIL_OR_INCOMPLETE: only
100ms was reached;50ms and1ms remain NOT_REACHED, never PASS by omission.

Its generation1 ready record at4995.3ms has brightness70/0/0; paint at5051.4ms
still000 with loaded images,56.1ms after ready. First70 paint is5090.1ms.
The fixture has Uno/resistor/ordinary LED, no FET. This observes a native
ready/paint mismatch, not proof of the complete pipeline cause. The other
classroom failure is catalog missing image, retained as known baseline. The
total168/2 and catalog classification are controller-supplied, not independently
recomputed by this bounded artifact reader.

Five native D13 verdict files report PASS with empty findings. Independent visual
inspection covered ONLY matrix300 high/low and negative-open PNGs; static samples
do not prove temporal acceptance. Full native temporal review, all raw
wire/receipt hashes and final-prefix source pins were NOT independently checked;
expected tree was controller-supplied. No replay or product run was performed by
the reader. Do not promote these bounded findings to full native PASS.

Both required browser gates remain failed. Preserve
`ELECTRONICS-658-STRICT-BASELINE`, owner acceptance pending and PR660 Draft;
no integration, technical acceptance, Issue closure, release claim or gate waiver.
The separate baseline-fix/explicit-owner-boundary decision and final independent
acceptance requirements remain unchanged. This update selects no product repair,
foreign source changes, R27/546 resume or new test execution.
