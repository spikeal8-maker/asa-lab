---
task_id: TASK-ELECTRONICS-VISUAL-SOURCE-REVIEW-001
kind: maintenance
risk: low
semantic_change: no
roadmap_slice: null
prerequisites:
  - docs/product/electronics/contracts/ENGINEERING_HYGIENE_CONTRACT.md#6-large-source-and-decomposition-review
  - Issue 517 exact-candidate independent REQUEST_CHANGES for the large-source growth boundary
acceptance_boundary: slice
review: independent
---

# One visual-source responsibility re-review

Bounded documentation-only dependency [#518](https://github.com/spikeal8-maker/asa-lab/issues/518) of programme [#452](https://github.com/spikeal8-maker/asa-lab/issues/452). This review unblocks the separate repair #517; it does not accept that product candidate or perform a whole Electronics inventory.

## Boundary and minimal route

Primary component: `electronics.ui.workbench`, ordinary-image entry in [ui-assets-persistence.yaml](../components/ui-assets-persistence.yaml). Read root policy, Electronics router, AGENT_GUIDE §10, Engineering Hygiene Contract §§6/8 and the visual-source baseline entry. Inspect only the actual `ProductionComponentVisual.tsx` source and its mapped consumers/dependencies needed to understand responsibility boundaries.

Independently reviewed candidate `d6a78196c6c2423ebad59de4e682141d3d9d837d` contains visual source blob `ab292c4a22f9689b018d1dea1d760120cafa29ec` (reported 72,432 bytes), against the existing 60,089-byte reviewed baseline. Verify these facts yourself, including actual main size/blob and accumulated growth. That candidate received REQUEST_CHANGES and remains unaccepted. Its test-only successor is preserved by #517; this task does not edit or converge that product branch.

## Permitted result

1. Review the file's actual responsibilities, consumers, cohesion, ordinary-image lifecycle isolation and remaining decomposition debt. Record exact source revision/blob, measured bytes, factual findings and retention rationale in one dated evidence report.
2. Only after that review update this file's `reviewed_bytes` and rationale in `evidence/hygiene-baseline.yaml`. Keep its decomposition-candidate classification. A measured reviewed candidate size may be retained as the reviewed ceiling even while the product candidate is unaccepted; say explicitly that source review is not product acceptance.
3. Preserve all other baseline entries, validators, thresholds, checkpoint counters, ownership, protected images, production code and tests. No extraction, shrinking, cleanup, schema or runtime change.

Expected write paths: `docs/product/electronics/evidence/visual-source-responsibility-518-20261007.md` and this single entry in `docs/product/electronics/evidence/hygiene-baseline.yaml`. Controller alone manages selection and closeout in `current.yaml`. The implementer works from canonical selected main, publishes a coherent doc-only candidate, reports and STOP.

## Acceptance

Exact final SHA passes selected-card/routing validation, `pnpm gate:governance`, `pnpm control-plane:check`, formatting and `git diff --check`. A NEW independent reviewer verifies actual source facts and exact doc diff before APPROVE. No browser rerun is needed for this doc-only slice. The eventual #517 product candidate still requires its original focused, full browser and repository gates.

After integration and diagnostic closeout, the controller formally resumes #517 with its existing candidate. #516 and #505/PR #506 remain suspended. No owner acceptance, release, deployment, database or local runtime action is authorized.
