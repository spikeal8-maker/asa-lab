---
task_id: TASK-ELECTRONICS-SAVE-RECOVERY-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Owner programme 452 priority input 6066364541; E01/K1
  - Preserve accepted autosave cadence 459 and suspended candidate 525
acceptance_boundary: slice
review: independent
---

# E01 — latest pupil work survives a failed save

Programme: [#452](https://github.com/spikeal8-maker/asa-lab/issues/452).
Owner input: [priority revision 3.0](https://github.com/spikeal8-maker/asa-lab/issues/452#issuecomment-6066364541).
Concrete repair: [#526](https://github.com/spikeal8-maker/asa-lab/issues/526).

## One pupil result

A pupil edits the schematic and Arduino sketch. A temporary network failure does not permanently stop saving the latest document: after recovery, without another edit, the existing serial queue obtains server confirmation and a second browser profile opens that same content/revision. Local and server durability are reported separately. A failed localStorage write must never claim that work was saved in the browser; retain the document in memory and offer an emergency copy while the editor remains open.

## Component / causal boundary

`electronics.persistence.project` in `../components/ui-assets-persistence.yaml`; HIGH persistence change, independent review required.
Read owner registry E01/K1, section5 SAV-01–SAV-12, section10; existing autosave459 contract and the mapped persistence/document invariants.
Start from the actual existing queue and local-draft module; no second persistence system.

Expected production paths:

- `apps/web/src/electronics/use-workbench-project-state.ts`
- `apps/web/src/electronics/workbench-autosave.ts`
- `apps/web/src/modules/project-local-draft.ts`
- `apps/web/src/components/editor-chrome/EditorPersistenceIndicator.tsx` — proved unconditional local-copy presentation
- `apps/web/src/electronics/WorkbenchHeader.tsx` — pass exact local durability and offer whole-document emergency copy
- `apps/web/src/pages/SchematicEditor.tsx` and `apps/web/src/electronics/use-electronics-workbench.ts` — narrow verified `PublicUser.id` wiring/lifetime boundary; protect the existing storage getter if its failure prevents the same editor retaining/exporting work, without changing notes ownership or semantics.

Shared local-draft callers must be found and checked independently; a returned outcome must remain compatible with existing callers. Do not rewrite Scratch or alter its persistence semantics.

Initial focused tests: mapped `workbench-autosave.spec.ts` and `workbench-project-state.spec.ts`.
Necessary extra test budget explicitly granted for the distinct shared-storage failure boundary (`modules/testing/project-local-draft.spec.ts`) and the existing production browser journey (`e2e/electronics-simulation.spec.ts`). If that browser source changes, regenerate only its canonical derived source hash, independently checking that all other coverage fields remain identical. No generated capabilities claim. Additional meaningful tests are explicitly allowed in the existing `components/editor-chrome/testing/editor-persistence-indicator.spec.ts` for the distinct truthful shared presentation boundary and existing `electronics/testing/workbench-presentation.spec.ts` for the affected header consumer; no new parallel harness.

## Historical causal BEFORE / accepted prerequisite

Separate shared fixture [#528](https://github.com/spikeal8-maker/asa-lab/issues/528) accepted exact `f0113e9ff28cfccfe372e8b0c456990f43256e0d`: General37829871415 all4 SUCCESS,166 fresh Nx/zero hits, NEW independent reviewer APPROVE, unchanged SHA integrated into main. Only `e2e/organization-login.ts` changed. The original0e97 run37827077075 failed before saving because a removed Portal title remained in the helper; those original logs/traces stay preserved, not causal E01 evidence.

Actual production-browser BEFORE `67e2f4d413f76679392bcd3b7647931c718e1e27`, run37830452725, reused the exact helper blob and both strict original scenarios. Controller and reviewer independently read original ZIP/raw JSON/network traces. Both reached intended saving failures: local-denial has no local copy/server50/UI166.7 but claims a copy; quiet recovery keeps server50/local+UI166.7 with one failed PUT and no successful retry. Recorded quiet wall interval69235ms, existing budget70000ms. No timeout increase, fake clock, focus/online/new edit or whole-suite rerun.

Original JSON, byte-for-byte:

- [Local denial](../evidence/save-recovery-526-before-local-denial.json), SHA256 `eb2e44af4a18f91270c26791ae106a356e632325db5e3fbbc9269592f29c04e5`.
- [Quiet recovery](../evidence/save-recovery-526-before-quiet-recovery.json), SHA256 `8bcc0ac77000845082d4519ec4998f76fecc357a7b989ae0df50cdef16f0e4bc`.

Original ZIP SHA256 `2e7b30589ffd5ef329b980c09c9261d88c0fc1bb00e0374daf2ccccb29051cef`; raw log/traces/screenshots remain outside repo at `C:/Users/spike/.codex/temp/electronics-e01/probe-after-fixture-528`. Do not repeat BEFORE without a concrete new cause. These expected BEFORE failures are not a green full browser gate or a proven rate of school incidents.

## Before / implementation

Use TWO directed scenarios in the actually built production editor on a precise baseline: localStorage failure with false local-copy messaging; last save failure followed by quiet transport recovery without another edit. Preserve saved raw network/DOM/trace evidence. Source hypotheses and fake-time probes do not replace these browser BEFORE results.
Use existing isolated GitHub Actions recipe, frozen lockfile and literal `NX_SKIP_NX_CACHE=true`. No local stack or school installation action. A directed workflow exception must be separately explicit; do not quietly change the ordinary workflow or rerun an entire suite in hope of success.

### Controller-authorized directed BEFORE ref

For these two BEFORE scenarios only, a temporary diagnostic ref may forward `--grep 'ELECTRONICS-E01 BEFORE'` to the existing registered browser gate after `--list` proves exactly two tests and the controller checks the actual source/workflow diff. On that ref only, skip the ordinary focused/benchmark/review-images jobs and remove the browser job's dependency on the skipped focused job; report them SKIPPED, not PASS. Preserve the entire existing isolated build/migration/Compose recipe, frozen installation, literal cache bypass, origins, ports, permissions, timeouts, artifact capture and cleanup. Save actual request/response/DOM/error trace and ordinary outputs under ignored `reports/playwright/electronics-e01`; preserve tracked screenshots unchanged. No product change before the causal BEFORE result is inspected.

Restore the workflow byte-for-byte to its canonical original Git blob before the final product candidate. Diagnostic workflow history must not enter main or the product diff. All ordinary full focused/browser/repository gates and independent exact-SHA review are still mandatory for acceptance. This limited exception authorizes a directed reproduction, not weaker existing assertions/timeouts or a new CI system.

Verified identity contract: production Electronics receives required current `PublicUser.id`; local records/keys and async scope generation bind to that user and project. Validate the recorded identity when reading. Preserve all schema1/2/unscoped legacy bytes; no silent adoption/sending or exposure of unattributed old work under a different identity, no deletion. Do not claim old unscoped work recovered. Existing Chess/Checkers defaults/read compatibility remain intact. Same-user relogin restores a correctly attributed draft; old load/save/retry results after project/user/unmount changes cannot affect another scope. Match local durability to the exact current document, not an older successfully written copy. Emergency copy carries the whole current schema and Arduino sketch, not PNG/CSV; never promise crash recovery for in-memory-only data.

Correct only proved causal paths: explicit local-write outcome, bounded/backed-off serial rearming of transient saves, truthful status, existing revision/CAS and scope isolation. Stop automatic attempts for conflict/permanent authorization failures; preserve the draft and resume only under the appropriate verified session/revision contract. New edits cannot mask unresolved conflict. No stale response may clear a newer local draft or mark a newer document saved.

## Bounded independent review repair R1

Published candidate `74928374ce93a41fd59ec8cc0b1fb96a5b55b290` received NEW independent **REQUEST_CHANGES**. Controller independently checked the registered browser command includes `e2e/electronics-interactions.spec.ts`: its `openEditor/readEditorDocument` fixture still reads only the old unscoped key, then returns an unchanged mock server document. After the product writes an attributed scoped draft, strict detach assertion361 cannot observe the new document. This is a current-diff test compatibility defect; returning legacy adoption to production is forbidden. The review also found no full production SAV-10 user/project isolation journey.

Actual ordinary run37839235069 on this SHA ended with focused and benchmark SUCCESS, browser FAIL (25 failures/99 passes), review-images SKIPPED. General37839211753 is terminal SUCCESS. The original browser log/ZIP and raw AFTER remain preserved. The strict detach failure confirms the old reader defect; other failures are not automatically declared resolved. Local-denial raw evidence contains the older50 document, latestUI166.7 and truthful memory-only wording; renderer crash evidence is incomplete because no crash event occurred. The cached trace shows Page.crash stayed pending until teardown; its underlying Chromium cause is unknown. Both are bounded existing test-evidence repairs, not permission to change product code.

One additional bounded repair is authorized in exactly:

- `e2e/electronics-interactions.spec.ts`: correct only the existing fixture reader to read and validate the exact attributed project/account identity using its existing authenticated fixture contract. Retain its strict component/wire/hole-binding/electrical checks, server fallback semantics and timeouts; no forced Save to mask an unsaved edit.
- `e2e/electronics-simulation.spec.ts`: add the missing SAV-10 scenario in the actually built editor, using real authorization and projects, different identities and pending old work/replies. Preserve schema and Arduino sketch, record request/local/server/DOM evidence, and prove no old-user draft submission or late result leakage. Correct the confirmed existing denial-fixture expectation: retain and validate the older scoped document written before denial, prove it differs from the latest unsaved document, verify the memory-only warning and whole latest schema plus changed sketch emergency download; do not delete the valid older record to manufacture null. Replace only the failed renderer-crash injection with the Chromium method used by the pinned [Playwright1.55.1 upstream crash fixture](https://raw.githubusercontent.com/microsoft/playwright/v1.55.1/tests/library/page-event-crash.spec.ts), recording the injection outcome. Require an actually observed abrupt renderer termination, no pagehide/safety submission, and exact full document recovery. Pending injection is not crash evidence; do not substitute graceful close/reload, extend timeout, skip the case or claim unproved crash durability.
- `generated/component-coverage.json`: only the canonical browser source digest after controller independently checks all other parsed fields remain identical.

No production edits in this review repair unless a new concrete defect is reproduced and the controller explicitly grants its narrow existing-file boundary. No new API/auth policy, legacy adoption, timeout increase, weakened checks, workflow exception, parallel harness, or changes to suspended525. Existing causal BEFORE stays preserved without rerun. Corrected final exact SHA needs the ordinary registered gates and another NEW independent review; source review and old local tests are not acceptance.

## Bounded independent review repair R2 after accepted529

Preserved526 R1 `c15e6e13dab91f72619c28ba0adc552a96fa2d77` remains unchanged in its published branch/tree. Independent review REQUEST_CHANGES and actual122PASS/3FAIL are historical evidence, not acceptance. Separate inherited fast-input repair529 was technically accepted exact `908e28f2bdeacffa18b83c79cb3be96c232d1bbd`: NEW reviewer APPROVE, General37854813209 and ordinary37854826793 terminalSUCCESS, original raw Save63.1ms/exit67.5ms full documents/reopen PASS. Resume526 only after canonical main selection; preserve accepted529 and all foreign/main state, originalc15 branch and evidence.

One controlled convergence of preservedc15 with canonical main is required on a new branch before bounded repair. Do not rewrite published commits, choose a blanket conflict winner or edit another executor's unfinished work. If a real convergence conflict occurs, stop that merge, report exact paths and seek a coordinated handoff; root then specifies owned integration boundaries. Old approval/local tests do not apply to the new combined candidate.

- `WorkbenchHeader.tsx` and/or `workbench.css`, at most2 new production paths: only proved JSON emergency CTA clipping caused by `.workbench-toolbar-group.right .workbench-pill:first-child` fixed77px. Original first child is the mobile library toggle, not the Code pill; the newly preceding JSON button activates this positional selector. Use the smallest semantic/class adjustment and check all affected right toolbar consumers/overrides. No global CSS/layout cleanup. Full label readable/clickable at1440/1024/390/320, no overlap/overflow; retain whole-document emergency download and no timeout change. Existing `workbench-presentation.spec.ts` and simulation browser receive narrow meaningful regression checks, including text fit rather than a center-point-only geometry check.
- Existing accepted529 `testing/arduino-code-panel-persistence.spec.ts`: narrowly adapt its existing mounted consumer to526 required verified userId/session and scoped local-draft contract. Preserve all five behavioral assertions, real panel/current-document/savequeue/autosave and no per-input HTTP. No production legacy-adoption rollback or new parallel harness.
- Existing `e2e/electronics-simulation.spec.ts`: adapt only accepted529 fast cases to verified scoped identity/local-record reader while retaining immediate fill/action, strict<260ms, full expected/local/PUT/server/reopen checks and physical raw JSON export. Complete previously blocked crash/SAV10 original scenarios on actual combined product; use saved traces first, no new BEFORE or timeout extension. No product change beyond CTA unless a new causal defect is independently confirmed and root grants its narrow boundary.
- Only canonical browser digest in `generated/component-coverage.json` after root independently checks all other generated fields identical. Existing mounted/presentation/browser surfaces and mapped workbench UI dependency suffice; no new harness/workflow/dependencies/assets.

New bounded executor handles this R2 and STOP; new independent reviewer verifies one final combined SHA, actual GitHub state/original raw evidence/all ordinary exact gates and STOP. Root integrates/closes technical526 only after required evidence/APPROVE; K0/T3/owner/class acceptance remain separately pending. Then fresh E04 selection under existing owner decision, never automatic525 resumption.

## Bounded independent review repair R3 — actual crash and scope evidence

Published R2 `520bc45afaad32b89d142fbcf313561c1170d72d` remains preserved, unaccepted. General37859012428 is terminal SUCCESS/all4; ordinary37859024247 has focused/benchmark SUCCESS, browser125PASS/2FAIL and review-images SKIPPED. NEW independent exact-SHA review REQUEST_CHANGES is [preserved](../evidence/save-526-r2-independent-review-520bc45a.md). Original ZIP11585852437 is42839587bytes, SHA256 `10eb920521beb6d772e4b703883134dcbec597df516a1598a08c0648db9fc9ab`,149membersCRC PASS; no redownload or repeat of causal BEFORE.

Only these existing `e2e/electronics-simulation.spec.ts` evidence boundaries and its canonical derived digest may change:

- SAV10: original snapshots retain first canonical `/projects/<first>/electronics/edit` path/title/value222.2 after hash-only assignment. Actual navigation resolver gives that pathname priority; the fixture never switches to the second project before expecting70. Repair actual same-renderer canonical navigation and assert new project identity/address before releasing the held old reply. Preserve strict full-schema/sketch/revision/local/server checks, actual account switch, no stale submission/result leakage, same-renderer requirement and physical final JSON export. No hard reload or deletion/adoption of drafts to manufacture passing evidence. These facts do not prove a product isolation defect.
- SAV02/08: actual `chrome://crash` call returns ERR_ABORTED after about16ms; crash wait reaches existing120000ms and no final crash receipt is produced. The underlying Chromium cause remains unresolved. Investigate the pinned Linux CI/browser behavior using saved trace first; do not blindly restore the previous unsuccessful Page.crash injection. Require independently observed abrupt renderer termination, no pagehide/safety PUT, full local schema/sketch recovery and subsequent server confirmation. An injection error or graceful close is insufficient. Record injection outcome even on failure where useful; no timeout increase, skipped test or weaker assertions.
- Generated coverage: only canonical browser source hash, after controller checks all other parsed fields identical. Preserve all accepted529 fast cases, new CTA checks and the other E01 scenarios byte-for-byte unless this exact boundary requires a justified adjacent helper change.

For directed verification before ordinary gates, controller may approve one temporary diagnostic ref that registers exactly the two original SAV02/08 and SAV10 cases, retaining the existing isolated build/migration/Compose/origin/security/frozen dependency/cache-bypass/artifact/cleanup recipe and all timeouts. Focused/benchmark/review-image jobs on this temporary ref may be SKIPPED explicitly, never reported PASS. Controller must inspect source/workflow diff and two-case registration before dispatch. A minimal additional crash diagnostic inside the same existing case needs a concrete hypothesis and controller approval; no parallel test harness or new installation. Restore the ordinary workflow byte-for-byte before the final product candidate; diagnostic workflow history must not enter main/product diff.

New bounded executor investigates/repairs this evidence and STOP. No product code is authorized by these failures; a newly reproduced product defect requires root classification and a separate bounded permission. Final exact combined SHA needs ordinary registered gates and a NEW independent reviewer. No technical closure, owner acceptance or programme completion is implied. Suspended525 and school evidence remain separate; E04 follows only accepted526.

## Bounded R4 — affected toolbar after independent R3 REQUEST_CHANGES

Preserve exact published R3 `0c8a0d5e606e037078e7d8a5bff47b70d299ab23`, tree33825fb81e99188ba992ca21c2d590b8b68355a4, branchcodex/electronics-save-recovery-526-review-r3. General37865142075 and ordinaryElectronics37865154341 are terminalSUCCESS/all4, browser127PASS. NEW independent HIGH review is REQUEST_CHANGES, not acceptance: [original report](../evidence/save-526-r3-independent-review-0c8a0d5e.md), original outside-repository SHA256a6b620fee6c81616ea2b02cb790e6f11cc4477f8e607b4e3c8f7e50b0d60462a; Markdown Git line-ending normalization may change repository bytes.

One proved current combined-diff defect: the new error-state emergency JSON action at1024 clips adjacent active Run. Original final raw records Run x892.546875/right1114.546875/width222 with viewport1024; original PNG visibly clips the caption. Canonical main has no added JSON action; the reviewer explicitly labels its counterfactual main geometry as source inference, not an executed baseline browser. Historicalc15/520 contain earlier E01 candidate clipping and do not establish canonical-baseline safety. Preserve all original semantic PASS receipts and all existing120000/5000/70000/260 budgets, not a repeat of completed investigation.

Only this R4 author may now make a minimal causal layout repair in `apps/web/src/electronics/workbench.css` and, only if necessary, `WorkbenchHeader.tsx` (default one production path, at most two). First inherit the newly published canonical selection/card/report from main using safe convergence on a new owned R4 ref based on preserved0c8; keep foreign work and all prior refs. Do not modify persistence, physics/Arduino/runtime/auth/dependencies, other controls/features, protected art or unrelated disabled-Send behavior. A layout consequence of correctly fitting the affected toolbar is permitted; global restyling/redesign/decomposition is not.

Use the existing production browser case in `e2e/electronics-simulation.spec.ts` for meaningful affected-action regression, recording complete readable/clickable emergency JSON and adjacent active Code/Save/Run bounds/hit targets/no overlap at1440/1024/390/320, with JSON-present/absent and applicable Run/Stop states. Mobile icon semantics may remain as already declared; do not force hidden desktop captions into mobile. Preserve full-document export and every original E01/529 assertion, real native scope switch/crash guards and budgets. No implementation-mirroring CSS/class assertions or new parallel browser harness. Update only canonical generated browser digest after controller independently verifies every other field.

All8 ordinary exact-head jobs, frozen dependencies/literal cache bypass/fresh counts and a NEW independent final-SHA review remain mandatory for the changed combined candidate. Old0c8 green CI and semantic receipts are historical evidence, not R4 acceptance. Author self-review and STOP after this one repair; controller verifies actual source/diff/original evidence then appoints a NEW reviewer. R3 own-guarded SIGKILL executes only within the existing isolated browser CI recipe; no local signal/stack/install, temporary workflow changes or extra broad rerun without concrete reason. No technical526 closure, next E04 activation, school/owner/class acceptance or deployment until its applicable evidence and review conditions are satisfied.

## Bounded R5 — truthful normal-state browser evidence

Preserve published R4 c25dd582e2856220fe893015c99257a186b982d6/tree33996f2118cf282ecc3a615f3b63946878150b60/refcodex/electronics-save-recovery-526-review-r4. General37869131311 terminalSUCCESS/all4; ordinary37869145318 focused/benchmarkSUCCESS, browser125PASS/2FAIL and review-imagesSKIPPED. NEW independent exact-head [review](../evidence/save-526-r4-independent-review-c25dd582.md) is REQUEST_CHANGES, not acceptance. Original log/ZIP/error contexts/failure traces and passing semantic raw receipts remain cached without repeat download; ZIP11590445960 SHA256e6c48f82e755488795c7f7692727a1584340f4d05a0bbf5ac30eb21cf403e00b/146membersCRC PASS.

One confirmed categoryA fixture defect: helper4055 expects disabled Save before denial, but exact browser frame records data-project-save-status=dirty and enabled Save. Canonical normalization makes the retained copy an actual local draft, not a server-saved document. The shared indicator legitimately has quiet/then delayed pending presentation; visible status for every normal state is not its contract. This wrong fixture assumption proves no product saving/UI defect. Failure precedes storage denial/layout measurements, so new denied-copy/UI acceptance is NOT_RUN. Preserve passing quiet/crash/scope/session/conflict/529 receipts as partial evidence.

One NEW bounded author safely inherits canonical R5 selection/card/review from main on a new owned ref based on preservedc25; preserve every prior ref and foreign work. Change only the existing denial browser case/helper in e2e/electronics-simulation.spec.ts and its canonical derived digest in generated/component-coverage.json. Correct normal-state names/setup expectations to the actual retained-local dirty state: verify its status and enabled Save, JSON absence/local durability and valid quiet/pending indicator presentation. Do not force Save, remove/adopt/reset storage, add sleeps/fake clocks, postpone the sixty-second deadline or weaken old-record preservation to manufacture a saved state. If genuine saved-state evidence is additionally needed, propose an honest bounded separate phase only after original denial assertions/raw evidence, without masking the failure or silently expanding the harness.

Retain full-schema/sketch exports, exact older local bytes/server-versus-current distinction, error visibility/truthful warning/actual failed request and every R4 caption/bounds/hit/overlap/page/scene/wire-menu check. Keep breadboard Run/Stop/both JSON states/all ten widths and sparse schematic/BOM four widths. Rename raw fields/state names truthfully as needed; capture actual status/geometry before assertions. Other126 cases/crash guards/529 source and every existing budget remain byte-identical. No product CSS/Header/persistence/physics/Arduino/auth/dependency/artwork/workflow edits are authorized by this evidence repair.

Separate interactions1925 failure expects catalog missing-image status; stage failure appears, catalog status is absent. Its case and image/catalog production files are unchanged relative to main. Cause is under separate read-only classification, not declared resolved or permission for asset repair inside526. All ordinary exact gates and a NEW independent reviewer remain mandatory; no blind rerun, timeout increase or skipped assertions. Author self-review/exact unpublished SHA/report and STOP. Controller verifies/publishes, handles any separate baseline blocker and obtains final exact acceptance. No next task, school/DB/network/backup/owner/class action.

## Preserved R5 — separate native-menu dependency

Exact published0dd31b4d97cba4cbda935c66968e180fdc630a04/tree759fc80b7a0e423f67a247d3ba663abe363cc888 remains unchanged. General37872258062 all4SUCCESS; ordinary37872270511 focused/benchmarkSUCCESS, browser126PASS/1FAIL, review-imagesSKIPPED. NEW [independent R5 review](../evidence/save-526-r5-independent-review-0dd31b4d.md) REQUEST_CHANGES: actual native Purple swatch is hidden/intercepted by Code drawer at1024. Only2of56 normal-state layouts are captured; final denial/export/remaining54 are NOT_RUN. Other original full-document/sketch/recovery/crash/scope receipts remain preserved PASS. ProvisionalC baseline attribution uses identical main stacking rules/consumer, not an executed main-browser comparison. Original ZIP SHA8c5786856d6fefa963ef2fb1265b7e4619a4a7b3a3b71d3ce9ccaf0af229e4a2/147CRC PASS stays cached.

Controller selects separate [530 bounded UI repair](TASK-ELECTRONICS-WIRE-MENU-LAYER-001.md) on canonical main; do not add its code to this preserved ref or start another526 implementation. After technical530 acceptance, root freshly selects526, safely converges the preserved candidate with accepted530/current state and obtains final ordinary exact gates/full denial+56/new independent review. No new causal BEFORE, timeout increase, weaker pointer assertions, old approval substitution or E04 activation. Original R5 review SHA256f305dc4145e1d79ffff488453d777c95fb6deebb78b58f4e01c061d18dad4dd1 before ordinary Git Markdown line-ending normalization.

## Required acceptance

1. Before/after production-browser proof for both defects; exact candidate SHA and raw evidence.
2. SAV-01–SAV-12 individually reported: schema AND sketch contents/revisions, server confirmation and second-profile open; network recovery without edits; session expiry/relogin; late replies; 409/two tabs; local-storage denial; newer local draft; exit during an in-flight save; project/user isolation; existing Stop/Run semantics; sustained one-minute cadence.
3. Keep the accepted 60-second dirty deadline without debounce starvation, immediate manual/safety save and one request at a time. No uncontrolled retry storm; no every-edit server traffic.
4. Actual browser lifecycle and abrupt close qualification: pagehide injection alone does not prove crash durability. If local storage is unavailable, never promise recovery after the process dies.
5. Preserve permissions, document/wire/component IDs, sketches, merge conflict protection, local runtime/physics and physical precision. E04 new power-supply setpoint persistence remains a subsequent bounded repair; report existing SAV-11 semantics without importing E04 into E01.
6. Shared consumer checks; meaningful focused tests, `gate:electronics-m1`, `gate:electronics-m1:browser`, `gate:repository`, diff-check, frozen dependencies, literal cache bypass and actual fresh counts. Required HIGH independent reviewer reads actual final SHA/GitHub state; author report alone is not proof.
7. A changed user-facing save/error/copy surface requires affected consumers and 1440/1024/390/320 evidence under the UI acceptance contract.

## Boundaries / STOP

No school deployment, DB/volume/backup/restore/network changes, new server/API/schema/auth policy, protected artwork, solver/Arduino semantics, cleanup/decomposition or edits to suspended525. Do not claim the specific historical lost work recovered or the whole class stable without evidence. Read-only K0 E27/E35 proceeds separately and missing school access does not block this isolated repair.
Executor handles this one slice, reports self-review/exact SHA/evidence and STOP. Reviewer gives one exact-SHA verdict and STOP. Controller handles separate bounded repairs/convergence and continues the existing programme after technical acceptance; no next slice is activated by this card itself.
