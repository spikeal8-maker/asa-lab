---
task_id: TASK-ELECTRONICS-UI-AUTH-QUALIFICATION-001
kind: repair
risk: medium
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - Published field-grab and SPDT shadow repairs on accepted main
acceptance_boundary: slice
review: independent
---

# Reuse genuine UI authentication cookies in isolated UI qualification cases

Qualification dependency: [#666](https://github.com/spikeal8-maker/asa-lab/issues/666).

This qualification-only dependency supports the owner's programme to verify, publish and close unfinished electronics UI work, specifically #544 and #547. The dated [e142 evidence](../evidence/ui-auth-qualification-e142835e-20261020.md) distinguishes shared authentication capacity from product behavior. Historical task snapshots and receipts remain unchanged.

## Bounded change

Modify only the `ELECTRONICS-E03 native field boundary real API` describe block in `e2e/electronics-interactions.spec.ts`, authentication fixture setup in `e2e/electronics-switch-shadow.spec.ts`, and generated `component-coverage.json` hash if freshness requires it. Perform one genuine UI login in a disposable `beforeAll` browser context per group/worker, capture only cookies, then close that bootstrap context. Retain normal authentication, CSRF and bot-challenge protections. Do not mint sessions through SQL, API shortcuts or injected application state.

Each case starts in its own fresh context with only those cookies and creates its own project. Do not transfer localStorage, sessionStorage, project state, page state or an entire storageState. Preserve each case's viewport/theme, seeded circuit, native trusted gestures, full intended document, server/rendered comparisons, exactly one Save PUT, CAS increment, and separate cookies-only fresh reopen assertions. Keep strict browser failure collection. Existing per-case local recovery/draft checks remain unchanged.

No rate-limit, API/product/persistence, solver/core/hook/LED, workflow/guard/registry, package/dependency, protected asset or deployment change. No extra waits, retries, timeouts, forced clicks, second Save activation or assertion weakening. Existing workflow supports only strict/classroom profiles, not a targeted input; use the unchanged strict workflow after review. No local Docker, browser, heavy build or database operation.

## Verification and closure boundary

The author performs narrow lint/format, test discovery, generator freshness, source-preservation and self-review checks, freezes one SHA and stops. A NEW independent reviewer verifies exact source and unchanged scenario assertions before publication and one justified strict CI run. Require all 32 field cases and eight shadow cases to finish with actual native interaction, complete whole-document Save/CAS and fresh cookies-only reopen evidence. Check required focused/repository conclusions at that exact SHA and obtain independent actual runtime/visual review before technical acceptance or closing the respective issue/branch. #548 and owner/device acceptance remain separate; missing evidence stays pending. This task does not authorize unrelated failure repair or claim all Electronics work accepted.
