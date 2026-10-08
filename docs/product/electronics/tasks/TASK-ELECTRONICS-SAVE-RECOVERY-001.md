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
- Only the existing affected save indicator/emergency-copy consumer if proved necessary; name the exact path to the controller before adding it.

Shared local-draft callers must be found and checked independently; a returned outcome must remain compatible with existing callers. Do not rewrite Scratch or alter its persistence semantics.

Initial focused tests: mapped `workbench-autosave.spec.ts` and `workbench-project-state.spec.ts`.
Necessary extra test budget explicitly granted for the distinct shared-storage failure boundary (`modules/testing/project-local-draft.spec.ts`) and the existing production browser journey (`e2e/electronics-simulation.spec.ts`). If that browser source changes, regenerate only its canonical derived source hash, independently checking that all other coverage fields remain identical. No generated capabilities claim.

## Before / implementation

Use TWO directed scenarios in the actually built production editor on a precise baseline: localStorage failure with false local-copy messaging; last save failure followed by quiet transport recovery without another edit. Preserve saved raw network/DOM/trace evidence. Source hypotheses and fake-time probes do not replace these browser BEFORE results.
Use existing isolated GitHub Actions recipe, frozen lockfile and literal `NX_SKIP_NX_CACHE=true`. No local stack or school installation action. A directed workflow exception must be separately explicit; do not quietly change the ordinary workflow or rerun an entire suite in hope of success.

### Controller-authorized directed BEFORE ref

For these two BEFORE scenarios only, a temporary diagnostic ref may forward `--grep 'ELECTRONICS-E01 BEFORE'` to the existing registered browser gate after `--list` proves exactly two tests and the controller checks the actual source/workflow diff. On that ref only, skip the ordinary focused/benchmark/review-images jobs and remove the browser job's dependency on the skipped focused job; report them SKIPPED, not PASS. Preserve the entire existing isolated build/migration/Compose recipe, frozen installation, literal cache bypass, origins, ports, permissions, timeouts, artifact capture and cleanup. Save actual request/response/DOM/error trace and ordinary outputs under ignored `reports/playwright/electronics-e01`; preserve tracked screenshots unchanged. No product change before the causal BEFORE result is inspected.

Restore the workflow byte-for-byte to its canonical original Git blob before the final product candidate. Diagnostic workflow history must not enter main or the product diff. All ordinary full focused/browser/repository gates and independent exact-SHA review are still mandatory for acceptance. This limited exception authorizes a directed reproduction, not weaker existing assertions/timeouts or a new CI system.

Correct only proved causal paths: explicit local-write outcome, bounded/backed-off serial rearming of transient saves, truthful status, existing revision/CAS and scope isolation. Stop automatic attempts for conflict/permanent authorization failures; preserve the draft and resume only under the appropriate verified session/revision contract. New edits cannot mask unresolved conflict. No stale response may clear a newer local draft or mark a newer document saved.

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
