---
task_id: TASK-ELECTRONICS-LEGACY-WIRE-SEGMENT-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Owner programme452 E07 and explicit parallel repair instruction6084548550
  - Independent acceptance of selected parallel card guard536 before executable dispatch
acceptance_boundary: slice
review: independent
---

# E07 — drag the visible segments of a saved legacy wire

Existing programme [452](https://github.com/spikeal8-maker/asa-lab/issues/452), bounded repair [538](https://github.com/spikeal8-maker/asa-lab/issues/538). Selection lives only in current.yaml. Route through `electronics.ui.workbench` and `../components/ui-assets-persistence.yaml`; inspect only actual document/geometry/Stage consumers and applicable document/UI invariants. Earlier accepted wire-vertex work493 is preserved, not repeated.

## Confirmed mechanism

On exact604ac63d, a saved wire with absent vertices renders the default four-point route. moveWireSegment passes vertices??[] to mutation, sees one segment and ignores the middle/last visible segments. The first segment is also incorrectly treated as the whole diagonal. Production Vite SSR receipt/reproducer are preserved at C:/Users/spike/.codex/temp/electronics-e01/e07-legacy-segment-production-before.json and adjacent .mjs; no product source was copied or edited to obtain it. Explicit vertices:[] intentionally renders one straight segment and already works. insertWireVertex already materializes the default route correctly.

The exact original failing owner document is unavailable. Fix and independently accept this specific mechanism; do not claim every original E07 case reproduced or solved without its input.

## Exact implementation boundary

Only production `apps/web/src/electronics/workbench-document.ts::moveWireSegment`: materialize the actually displayed intermediate default points when vertices is absent and a real permitted drag occurs. Preserve explicit[]/existing vertices, no-op identity, endpoint IDs, colour, 48-vertex limit and deterministic topology. No Stage/hook/CSS/physics/catalog/artwork rewrite.

Meaningful direct regressions in existing `apps/web/src/electronics/testing/workbench-document.spec.ts`; an independently isolated appended case in registered `e2e/electronics-interactions.spec.ts`, exclusively assigned to this author. Update only necessary exact subsystem ownership if missing. No simulation.spec/package/workflow/generated digest change; report an actual necessary additional boundary before editing it.

## Required pupil acceptance

Cover all three actually drawn segments, missing versus explicit empty versus existing vertices, zero delta/no-op, limit48, immutable unrelated components/connections and unchanged electrical netlist. In the real built browser open a genuinely saved legacy document, drag visible middle/last segments with ordinary mouse and touch input, Undo/Redo, save via real API, close/reopen and compare complete document/vertices/IDs/topology. Use existing real seed/auth helpers; mocked API round trips in unrelated interaction fixtures do not prove persistence. No convenient hidden-point search, force/synthetic delivery, timeout increase or weaker assertions. Capture actual pointer/action/raw document and screenshots before assertions.

One author produces exact candidate/focused checks/self-review then STOP. Root inspects actual diff; ordinary required exact gates and a NEW independent reviewer of actual source/browser/API evidence precede integration. Controller continues the programme; candidate530/526/525 and every accepted repair remain preserved. No school/container/DB/network/backup action or global complaint acceptance claim.

## Independent acceptance repair R1

Preserved candidate `42c4e1f17634ffedbb955d16298b0f4f3a74dfc3` received [NEW independent REQUEST_CHANGES](../evidence/legacy-wire-538-independent-review-42c4e1f1.md). Only existing interactions observer installation before first navigation or actual-current-document setup plus explicit presence. Keep trusted native events, full geometry/netlist/document, save/reopen and limits; causal product line unchanged. Preserve proved browser BEFORE without repeat.

A NEW bounded author implements only this demonstrated test defect, then returns one unpublished exact SHA/self-review and STOP. The controller checks actual source, obtains directed production-browser evidence, required exact-source gates and a NEW independent reviewer. Neither passing partial actions nor author reports accept the complete complaint; owner-original inputs and school evidence remain separately pending. No product reimplementation, timeout increase, subset document comparison, forced interaction, physical weakening or unrelated Portal repair.

## Selected final convergence of preserved R1

Preserved native-observer source51991c0339009f3e358bf405fddb8c48743262ef already has NEW independent APPROVE, ordinary General37969136934/Electronics37970573601 all8SUCCESS and original real mouse/touch/full Save/reopen evidence. Do not reimplement it or rerun BEFORE. Root read-only merge-tree with current accepted main is clean: only four task paths remain, no conflict and no actual merge performed during selection. Owner E07 original document remains unavailable; source-mechanism evidence cannot close every unknown owner case.

ONE NEW bounded convergence author uses clean538 checkout, preserves published source branch and creates a new codex final-composition branch. Fetch actual canonical main and non-destructively merge it ONCE; retain all accepted code/current/foreign scenarios/ownership entries and exact causal product line/eight direct tests/two trusted full persistence journeys. No manual conflict resolution: if an actual conflict or overlapping dirty foreign work appears, preserve it andSTOP. No new product/test changes without a demonstrated composition defect and separately selected repair. No lease/history guard bypass or self-selection. Source current/card is inherited from main; do not edit them. Only merge four existing task paths; no workflow/dependency/physics/art/cleanup/deployment changes. Inspect node_modules junction; do not reinstall shared dependencies.

Fresh preflight/card validation, frozen dependency identity, literal NX_SKIP_NX_CACHE=true gate:electronics-m1 with actual fresh counts, diff/source/foreign tests preservation and bounded selfreview. ONE unpublished final SHA/tree/report/hashmanifest thenSTOP; no author push/CI/local stack. Root independently checks actual composition, publishes required exact ordinary General/Electronics all8, then NEW final independent reviewer checks actual originals/whole saved and reopened documents/native actions/GitHub exact state. Old source APPROVE or local checks do not accept this new composition. No additional old measurements or full browser run hoping for green. No school/DB/network/Docker/backup action or global original-complaint closure.

## Selected attributed draft reader composition repair

The ONE clean merge is preserved unpublished6a0edfc99c185ebad02c5f81536d98b15f7c76ee/tree572ef954785dd6843e5f8949eb735a46685dc9ab, parents51991c03+main152361c2; no manual changes,3799 other entries exactmain. Before any gate, author and controller found a concrete composition issue: E07 localDocument still reads legacy asa-project-local-draft:projectId, while accepted E01 writer writes attributed schema3 key with userId/identityKind. Existing main interaction reader already supports the latter. seedTeacher teacherId is not the authenticated accounts.id; obtain actual session.user.id using read-only /api/auth/me after existing login, assert authenticated/account identity.

ONE NEW bounded author may change ONLY E07 setup/localDocument within existing interactions spec. Read the exact encoded attributed account key using actual authenticated ID/project. Strictly validate schemaVersion3/identityKind account/userId/projectId/moduleKey electronics/safe baseRevision/updatedAt/non-null object nonarray full document; invalid/mismatched records must fail, not fallback. Genuine missing local record may remain null for afterSave/fresh-context no-local assertions. Do not read another user/legacy key, fall back to server/in-memory document or change product storage. Retain entire full-document/netlist/vertices/native mouse/touch/UndoRedo/onePUT/revision/cookies-only reopen checks, default timeouts and original observer. All other old scenarios/foreign main code unchanged.

Start from CLEAN preserved6a0 on a fresh codex reader-repair branch; canonical latest main phase is authoritative, local older current remains historical until controller final metadata convergence. No main chasing/second merge or current/card/map/WF/package/dependency edits during this repair. Fresh preflight/task validation, narrow reader guard challenges (current user accepted, absent null, foreign/schema/identity/module invalid rejected), format/lint/discovery and literal NX_SKIP_NX_CACHE=true focused with actual fresh0cache; inspect node_modules junction and do not reinstall shared dependencies. ONE unpublished SHA/tree/selfreview/whole source inverse/foreign proof/hashmanifest thenSTOP. Root independently checks exact result, runs ONE justified changed-cause two native E07 built-browser journeys/fullSave/reopen, required ordinary exact all8 and NEW final independent review. Old source APPROVE/clean merge do not accept composition; no repeat BEFORE/product repair/physics/timeouts weakening/school/DB/network/Docker/backup action.
