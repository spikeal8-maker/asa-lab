---
task_id: TASK-ELECTRONICS-LOGIN-FIXTURE-001
kind: repair
risk: medium
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - Owner programme452 E01 first; actual directed run37827077075 precondition failure
  - Preserve526 diagnostic0e97 and suspended525 ed4
acceptance_boundary: slice
review: independent
---

# E01 prerequisite — actual authenticated browser readiness

Programme [#452](https://github.com/spikeal8-maker/asa-lab/issues/452), separate fixture [#528](https://github.com/spikeal8-maker/asa-lab/issues/528), blocked product repair [#526](https://github.com/spikeal8-maker/asa-lab/issues/526).

## One result / actual cause

The existing organization-login fixture recognizes a successful organization login after the accepted Portal Home title removal, while still rejecting a logged-out/failed-login state. No Portal or Electronics product behaviour is changed.

Actual directed BEFORE run37827077075 exact0e97ac647070186c199b9550a43c2978228dc71f (parent verifiedmainffb42f89) failed both tests at `e2e/organization-login.ts:27`, unchanged5000ms: removed heading `/^(Мои проекты|Главная)$/`. Saved original error-context/trace shows authenticated personalized `main` «Главная», project navigation and loginPOST200; no draftPUT or storage scenario was reached. Category C shared test baseline, not an E01 product failure. Reuse saved original log/traces under `C:/Users/spike/.codex/temp/electronics-e01/before-0e97ac64/run-37827077075`; no repeated downloads.

## Exact implementation boundary

Change only `e2e/organization-login.ts`, the existing `loginWithOrganization` ready assertion after submit. Read the actual current Home/Projects route, authenticated navigation/session and all direct fixture consumers. Preserve organization/credentials/challenge/submit checks and existing assertion timeouts. Read-only lookup of existing Portal readiness selectors and tests is allowed; do not edit Portal, API/auth, dependencies, save scenarios or any product. Do not replace authenticated readiness with generic main, accepting an anonymous page, or an unverified delay. No assertion removal or weaker login contract.

Mapped concern is the existing Electronics production-browser prerequisite (the selected persistence card's existing `e2e/electronics-simulation.spec.ts`/interactions consumers), with a justified shared fixture boundary; no new runtime component or inventory.

## Evidence / independent acceptance

One new bounded implementer produces a coherent fixture candidate and stops; a different new reviewer independently checks the exact published SHA/GitHub state/actual saved traces and consumers. Self-report alone is not proof.

For a directed verification only, the controller may compose that exact fixture candidate with the already published two E01 BEFORE tests and the controller-authorized temporary diagnostic workflow from0e97. This diagnostic ref must contain NO product changes. Controller checks actual combined diff and `--list` exactlytwo BEFORE tests before one justified dispatch. Preserve the existing isolated recipe, frozen dependencies, literal `NX_SKIP_NX_CACHE=true`, ports/origins/security/timeouts/artifact capture and cleanup. The two tests must pass authentication and reach their intended E01 causal assertions, with original raw request/DOM/local/server evidence. Expected saving failures remain failures and are NOT a green full browser gate; focused/benchmark/review-images SKIPPED are NOT PASS. No blind rerun or broad hopeful suite.

Final fixture candidate contains only the helper correction; original canonical workflow Gitblob21d10e90a8f2d2e15583d2062c2745fa2531359b remains byte-identical, two diagnostic tests/workflow history do not enter this fixture diff. Required final `pnpm gate:repository` / General exact-SHA CI, diff-check, meaningful before/after authenticated browser evidence, independent review and controller integration/closeout. If review finds a defect, use a separate bounded repair/review cycle.

## Resume / STOP

Keep526 open and preserve0e97 original evidence; keep525 ed4 suspended and all accepted results unchanged. After technically accepted528, controller selects526 afresh and may implement ONLY after actual E01 causal BEFORE is inspected. No product, protected originals, deployment, local stack, working DB, backup, network, solver/Arduino, timeout or next runtime repair in this fixture slice. Executor/reviewer STOP; controller continues owner programme452.
