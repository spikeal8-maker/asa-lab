# CRM unified card navigation — bounded slice 2

Baseline: `faeffe785034b162112073798a56b3346d604644`.
Scope: owner-authorized CRM navigation and existing authorized management entry points.

## Implemented

- Platform Account has one navigation: profile, projects, publications/history,
  AI conversation, logins/actions, security/access, notes. Existing project-version,
  publication and AI request/token/model/error history remains available.
- Seat has one launcher with the applicable equivalent navigation. Platform-only
  retained history is inside this card; exact-class educational readers keep their
  current read-only scope and do not invoke the forbidden organization Seat history API.
- Profile editing stays separate from capability/status changes. Access has its own
  mandatory reason field. Existing Account administrator/login/MAX controls are
  together under security/access; self protection and server-side last-admin checks
  are unchanged. Capability states now list only the three server-accepted states.
- Neutral exact-class links open the existing classroom route, whose own permissions
  govern available actions. Organization directory is explicitly read-only.
- Same-context refresh preserves mounted fields and selected pane. Subject, scope or
  responsibility changes remount the card. Late results cannot repopulate a changed
  subject or a card whose access was denied; 401/403 removes retained detail.

## Evidence

- Scoped preflight: SAFE_TO_START; clean baseline, no blockers, control-plane PASS.
- `node node_modules/vitest/vitest.mjs run apps/web/src/admin/testing/crm-user-card.spec.ts apps/web/src/admin/testing/admin-crm-panel.spec.ts apps/web/src/admin/testing/admin-user-catalog.spec.ts apps/web/src/admin/testing/admin-user-history.spec.ts apps/web/src/admin/testing/admin-page.spec.ts --maxWorkers=1`: 26 tests PASS, no result cache.
- Focused ESLint: exit 0. Local Nx graph was unavailable, so its module-boundary
  rule reported its usual skip; this is not a full repository lint claim.
- Contracts: PASS. Changed files formatted; `git diff --check` clean.
- Web typecheck attempted: known shared dependency/junction gaps prevent a full
  local pass (374 diagnostics after fixing the new fixture type; no admin-path
  diagnostics). No dependencies installed or relinked. CI remains authoritative.
- Playwright list: 21 tests discovered. Updated existing four-width coverage at
  1440/1024/390/320 and 1440/390 screenshots; browser execution belongs to GitHub.
- New unit suite registered in `account-confirmation-focused.yml` explicit test list.

## Limits and handoff

No deployment, Docker/browser workload, database action, SMTP setting or activation.
No API authorization widening, global role, identity merge or new viewing code.
Organization participant/role editing still has no writer in this card/directory;
platform administration does not imply class-owner privileges. Class changes use
existing scoped routes and their current server grants. Organization Seat retained
publication/version/AI receipt history remains unavailable through the legacy reader;
its core scoped project/conversation/activity readers remain available. Seat notes
have no existing equivalent API and are not invented. These gaps require separately
selected backend/product work rather than client permission claims.

Independent review and exact-SHA GitHub browser/type/data evidence are pending.
This slice is implemented and locally checked, not deployed or owner-accepted.
