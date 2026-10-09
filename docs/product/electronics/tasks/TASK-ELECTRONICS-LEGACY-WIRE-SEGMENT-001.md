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
