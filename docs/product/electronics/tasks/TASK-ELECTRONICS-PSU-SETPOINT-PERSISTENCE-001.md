---
task_id: TASK-ELECTRONICS-PSU-SETPOINT-PERSISTENCE-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Technical acceptance of E01/526 and mandatory hygiene542
  - Owner-approved persistence of PSU U/I/value with runtime-only output
acceptance_boundary: slice
review: independent
---

# Keep pupil PSU settings across Stop and server reopen

Bounded [543](https://github.com/spikeal8-maker/asa-lab/issues/543) in existing programme452, original E04. Selection only canonical current.yaml on main. No new programme, inventory, solver repair, runtime accuracy change or school deployment.

## Cause, approved result and mapped context

Actual setRegulatedPowerSupplyControls stores only runtimeOverrides during Run; Stop clears them and loses U/I. Persisting the voltage alias naively causes sameCanonicalStructure to call beginGeneration(document,0), silently resetting physics. Both mechanisms belong to this single user repair.

Read router, mapped electronics.ui.workbench in components/ui-assets-persistence.yaml and one direct dependency electronics.worker.live-controller in components/engine-worker-clock.yaml; owner E04/E29/K6-A in ASA_ELECTRONICS_OWNER_REPAIR_PRIORITY_20261008.md, clock contract sections1/6/9 and review/state/persistence contracts at exact mapped symbols. Accepted526 recovery and original browser evidence are preserved, not rerun as a new inventory. Controller-provided external e04-psu-bounded-preparation.md is navigation, not acceptance.

Already approved: retain ONLY voltageSetpointVolt/currentLimitAmp and consistent value alias through live edits, Stop/Start, ordinary Save/autosave and reopen. outputEnabled remains runtime-only while running; persisted pre-Run output and all other properties remain intact. A live permitted edit preserves time, Arduino, capacitor, heat, damage and other canonical runtime state; intentional Stop then new Start resets physical state from zero. No new owner decision needed.

## Exact production and supporting paths

- apps/web/src/electronics/use-electronics-workbench.ts: separate persisted U/I/value from runtime-only output, normal commit and no-op handling, no direct per-knob HTTP or copying all measured/override state.
- apps/web/src/electronics/live-simulation-worker-controller.ts: ONLY narrow normalization of a consistent regulated-PSU alias for structural comparison; preserve actual U/I timed-input delivery and progressed generation. Do not ignore other component values, inconsistent aliases, missing/legacy fallback or true structure changes.
- apps/web/src/electronics/testing/psu-setpoint-persistence.spec.ts: new meaningful production-mounted hook/project-state/recovery/queue tests, existing public boundary mocks only.
- apps/web/src/electronics/testing/live-simulation-worker-controller.spec.ts: narrow alias/input/generation/full-state continuity and structural negative regressions; retain all old bodies.
- e2e/electronics-simulation.spec.ts: one actual user journey plus only two owner-policy expectation updates described below; retain every existing526/532/530/533 and physical test/assertion/timeout.
- docs/product/electronics/components/ui-assets-persistence.yaml: only actual new test routing; generated/component-coverage.json only through the existing generator for canonical browser digest.

No project-state/autosave/local-draft/auth/server/solver/model/scheduler/Arduino/compiler/Stage/Sidebar/visual/CSS/artwork/dependency/workflow/current/card write by author. A required additional product path returns a concrete proposal before writing. Root handles selection/closeout/publication. Other authors must not concurrently write these paths; stopped clean539/540 candidates are future integration concerns, not an automatic global blocker.

## Meaningful tests and real pupil BEFORE/AFTER

Mounted: Run7.5V/0.15A persists U/I/value and scoped recovery whole-document; Stop/Run keeps them; output-only does not create dirty/revision/queue; combined patch persists only U/I/value; identical/invalid/type/NaN/Infinity/clamp cases; preserve full sketch/workspace/wires and other fields. Manual Save and normal minute autosave use the real accepted queue, no per-input requests or stale in-flight overwrite. Fake timers only in mounted tests.

Worker: consistent PSU alias changes keep progressed generation and actual timed-input order/boundary/committed state; non-PSU values, inconsistent alias and legacy value fallback still trigger the required structural path. Forwarded canonical state must remain continuous rather than fabricated equal across physically advancing ticks; meaningful RC/heat/damage/Arduino continuation, intentional Stop/Start reset0. Preserve quantum/instruction/budgets/precision/quality/faults and never publish yielded/incomplete electrical frames.

Two existing browser assertions encode superseded owner policy: MATH-10B expects persisted0.1A after live0.2A; live supply/oscilloscope expects server5V after live8V. Update ONLY to approved persistent0.2A/correctCV and8V; retain real CC→CV measurements, ON/OFF, single-generation/ready horizons, runtime-only scope values, full wiring and unchanged timeouts. Explicit normal Save/quiet autosave precedes server persistence assertion; do not expect per-knob PUT.

Actual built-editor BEFORE/AFTER: same full supported circuit, genuine Run/ready → inspector7.5/0.15 → live electrical result/continuous state → Stop → Run with same U/I and intentional fresh physical time → manual Save/full actual PUT/server/revision → separately ordinary quiet minute/latest document/no storm → cookies-only context without old local draft/full server schema+existing sketch reopen and Run. Genuine Worker observer may record complete ready/requested/committed/compute/UI frames without altering them. Keep initial BEFORE source and identical scenario; do not substitute isolated probes or shortened programs for production actions. Four applicable viewports1440/1024/390/320; controls remain native accessible/no overflow/clipping, physical elapsed/accuracy unchanged.

## Gates / delivery / STOP

NEW author fresh preflight/exact-card selection/actual dirty paths; frozen literal NX_SKIP_NX_CACHE=true focused gate, necessary lint/routing/generator validation, bounded self-review and ONE unpublished candidate/report thenSTOP. No local extra stack, deployment, push or CI dispatch by author. Controller independently checks actual diff/source/evidence, publishes one exact final source and justified BEFORE/AFTER in isolated CI; ordinary exact Electronics/General all8 and NEW independent reviewer required. Required failures classified before repair; no hopeful whole reruns, longer expectations or scope expansion. Final integration preserves all accepted and parallel work. STOP author/reviewer; controller continues452 after accepted repair.

School K0/version/full backups NOT_VERIFIED, real pupil T3/class15+15/owner/deployment remain separately pending; no installation/DB/network/backup operations or runner substitute.

## Supporting harness R1 after actual native BEFORE

Same four full tests with ONLY old two PSU product files restored: [probe25d421bc / run37996551503](https://github.com/spikeal8-maker/asa-lab/actions/runs/37996551503), job114043997947. At1440 real Run/edit/Stop proves original user defect: expected retained7.5V, actual5V at existing line8416/5000ms. Whole raw113194B SHA c02136e26faa8f1c003fa312291ee33cef9725a9684ff467e624701c97faee33, trace/PNG/original ZIP11647835996 cached once. Ready C=H102700→452002 generation1 and localWhileOutputOff=null are retained. Do not repeat this established BEFORE without a new cause.

Other widths1024/390/320 failed BEFORE Electronics at unchanged organization-login.ts:14: desktop banner Войти hidden behind responsive menu. Their snapshots show public landing/banner Меню. This is supporting scenario setup, not proof of a PSU or Portal product defect. NEW bounded author edits ONLY e2e/electronics-simulation.spec.ts plus generated/component-coverage.json using existing canonical generator. Authenticate through the same native organization UI at desktop width, then apply requested viewport BEFORE all actual Electronics actions; retain original four widths, complete fixture/sketch, worker/physics/continuous state, U/I/Stop/manual Save/quiet-minute/cookies-only reopen and every existing assertion/timeout. No shared login/Portal/product/CSS fix, no API-login replacement or timeout change. Exact043a product remains unchanged. Preserve old043a/c601/25d421 refs, inherit this canonical checkpoint ordinarily, one unpublished harnessR1SHA/report then STOP. Controller directedAFTER then final exact ordinary gates/NEW reviewer; established1440BEFORE retained.

## Supporting harness R2: normal mobile catalog collapse

Independent directed review of f3f23ae0ce754b6369bd9a9130f4d1f0c70d96ac / probe592c1e9b144cae2735f032143f146d396a9d83f9 / run37999511262 is REQUEST_CHANGES, not product acceptance. Original report SHA256 ede22f6c53ca0ea461de4556c2d37a6b96b353c91465467b145095959fff2422 is retained externally.1440 and1024 whole Save/server/revision/cookies-only reopen and progressed Arduino/thermal state independently PASS;1440 quiet autosave59931ms,2PUT.390/320 stop before Run: native Enter selects PSU, actual trace includes both inputs, but catalog stays open and existing max980 CSS hides inspector. This is a normal scenario setup cause, not a proved PSU/CSS/Portal defect.

NEW bounded R2 author only e2e/electronics-simulation.spec.ts and existing generated/component-coverage.json through canonical generator. On applicable mobile widths natively collapse open Catalog details before initial inspector input and after cookies-only reopen; verify actual closed button and visible inspector. No forced clicks, hidden-input writes, DOM/style mutation, includeHidden workaround, shared helper or product change. Preserve exact043a/f3 product, all four full fixture/sketch journeys, selection, real input/hit/overflow checks, live continuity/Stop/Start/manual Save/quiet-minute/full PUT/server/revision/reopen and every existing assertion/timeout. No repeat established BEFORE or successful desktop directed cases without cause; controller may target only two changed mobile cases for AFTER, then final ordinary all8 gates/new exact independent review remain mandatory. Inherit latest canonical selection and accepted545 infra by ordinary merge preserving foreign work. Frozen install, lint/format/discovery/digest/inverse preservation proof, bounded self-review, ONE unpublished candidate/report then STOP. No push/CI/deployment by author.
