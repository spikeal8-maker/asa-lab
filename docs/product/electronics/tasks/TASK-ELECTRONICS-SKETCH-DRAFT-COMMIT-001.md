---
task_id: TASK-ELECTRONICS-SKETCH-DRAFT-COMMIT-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Owner programme452 E01-K1 and independent exact526R1 request changes
  - Preserved causal fast-exit trace37845156460 on c15e6e13
acceptance_boundary: slice
review: independent
---

# Latest Arduino input is part of the saved circuit document

Programme [452](https://github.com/spikeal8-maker/asa-lab/issues/452), dependency [529](https://github.com/spikeal8-maker/asa-lab/issues/529) of open526.

## One pupil result / causal boundary

The latest visible sketch must reach the existing canonical document before immediate manual save or genuine editor departure. A quick edit followed by exit inside the current260ms pending window must not silently submit the older sketch. Preserve correct board and project identity and all newer non-sketch fields.

Primary `electronics.persistence.project` in `../components/ui-assets-persistence.yaml`; exact dependent UI boundary `ArduinoCodePanel` / `useElectronicsWorkbench.updateArduinoProgram`. Read only owner registry E01/K1, SAV-05/SAV-09/SAV-10/E14 code-to-document intent, existing document persistence contract and selected sources. No new persistence system.

Independent production BEFORE: exact c15e6e13dab91f72619c28ba0adc552a96fa2d77, ordinary37845156460 browser113544783257, SAV05/09 original trace. Fill181750.702-181770.950ms; genuine exit181922.282ms; final safety PUT182002.098ms returned200 with resistor333.3 but original sketch. Panel persist260ms; unmount clears pending timers without canonical commit. Git blob fe2db2ada782c4520aedaab9b9ec88cd1e47451a is identical on checked mainaf5 and c15: inherited baseline defect, separate from526. Original ZIP SHA25642204acd5030dbc6d7eae09668c99069fcc0b00192d413ebf7e3555109599196 is preserved outside repo under C:/Users/spike/.codex/temp/electronics-e01/c15e6e13-ci/run-37845156460. Do not repeat this measurement without a new reason. Closing panel alone stays mounted; do not claim it cancels the pending timer.

## Expected paths / budget

Implement from canonical main after this card is published; do not merge unaccepted526 product into this repair.

- Production: `apps/web/src/electronics/ArduinoCodePanel.tsx`; only if causally necessary `apps/web/src/electronics/use-electronics-workbench.ts` or existing document persistence consumer. Default one primary component, at most3 production paths. Controller must acknowledge any further causal boundary before edits.
- Meaningful focused tests: existing `apps/web/src/electronics/testing/arduino-code-contract.spec.ts` and existing mounted `workbench-project-state.spec.ts` if necessary. Source-string checks alone are insufficient; use existing mounted harness for behavior or a narrowly colocated panel test when no panel harness exists, explicitly report its necessity before creation (at most2 focused test files).
- Existing production browser `e2e/electronics-simulation.spec.ts`: narrow real fast-input/immediate manual save/genuine departure/reopen regression with full sketch and document comparison, unmodified deadlines. This third test surface is explicitly necessary to prove the pupil action rather than merely a callback mock.
- Only derived `generated/component-coverage.json` canonical browser source digest may follow changed browser source, after root independently checks all other fields unchanged.

## Acceptance / invariants

1. Prove immediate visible text is the canonical/current local content; immediate Save and genuine exit persist it and reopening observes identical sketch plus other circuit fields. Preserve a strict fast-exit case; no260ms sleep, polling before exit that hides pending input, timeout increase or forced extra edit.
2. Correct board identity across rapid board switching/deletion, latest circuit edits, user/project changes and unmount; no delayed mutation into a foreign scope. Preserve existing blocks/code mode, workspace, source, baud and serial settings. Assess affected debounces separately: expensive blocks generation/analysis need not become per-keystroke work.
3. Preserve minute autosave and no per-edit server traffic, serial PUT/CAS/auth, canonical runtime including Arduino state/capacitors/heat/damage and physical precision. Do not alter Arduino language/parser/runtime/scheduler or Stop/Run semantics.
4. Focused meaningful negative tests and self-review, exact candidate SHA, ordinary `pnpm gate:electronics-m1`, `pnpm gate:electronics-m1:browser`, `pnpm gate:repository` with frozen dependencies/literal NX_SKIP_NX_CACHE=true; actual fresh counts. Local stack forbidden; production browser/data in existing isolated Actions recipe. No workflow changes without specific controller permission.
5. NEW independent exact-SHA reviewer must read GitHub state, actual diff and original raw before/after evidence; implementer report is not proof. On REQUEST_CHANGES use separate bounded repair/new review. Technical CI/review acceptance is not school/owner/class/release acceptance.

## Preserved boundaries / stop

526 candidate c15 remains published/open without acceptance; its JSON-button clipping and crash/SAV10 evidence remain for a later explicitly selected526 repair. Suspended525 and already accepted programme results remain unchanged. No editor rewrite, global cleanup, UI restyling, schema/API/auth widening, owner images, school update/container restart/DB/backup/network actions. K0 installed-school version/full backups and T3 real-school hardware evidence remain separately pending.

Executor handles only529, returns one coherent unpublished candidate/self-review/evidence and STOP; root authorizes normal publication and required CI. Reviewer reads one final SHA, verdict and STOP. Controller continues programme after technical acceptance, with fresh canonical selection.
