# CRM slice 2 — author handoff

Bounded author report; task authority remains `current.yaml`. No publication,
deployment, Docker, local browser/server or database action was performed.

## Result and review

- Admin → Подтверждения: concise global rule, accessible keyboard tabs for MAX,
  Telegram and Почта. Messenger transport/native-proof behavior is preserved;
  receiver details and diagnostic facts are in collapsed connection details.
- SMTP read/save/connection test/one-recipient test require platform authority.
  Password uses the existing installation settings key, AES-256-GCM with purpose
  AAD, fresh IV and no readback. Only TLS 465 / required STARTTLS 587, validated
  sender/host/origin, certificate checks and bounded timeouts are supported.
- Mail proof keeps the old canonical Account email/login/verified state until
  one-use 30-minute proof succeeds. Exact version, reason and request UUID,
  persisted cooldown/hour budget, cancellation, supersession, config version,
  duplicate-address races and inactive Accounts are checked. Change revokes
  sessions and refresh credentials; own verification preserves sessions. An
  existing external-only Account may gain email without a new identity/password.
- Raw proof exists only in mail delivery and temporary browser memory. Database
  stores SHA-256; APIs/audit do not return proof or SMTP secret. A blocking local
  bootstrap strips the fragment before runtime configuration, MAX SDK or
  diagnostics; one-use memory is cleared. Public POST has no cookie/refresh
  effects and a 15-second deadline with ambiguous-result handling.
- SMTP connection testing alone does not establish enforcement eligibility.
  Current-configuration consumed email proof is also required. No global policy
  toggle is changed; existing unavailable/unverified-provider fallback remains.
- SQL 0248 is additive with explicit function/table ACLs; old migrations are
  unchanged. Three forward-upgrade consumers include the new version/checksum.

Self/challenge review: L3_CRITICAL; identity and deployment invariants preserved.
Checked exact Account vs Seat/teacher authority, old/new state, replay, concurrent
consume/request serialization, config changes, errors and secret handling. No
known source blocker. Independent final-SHA review and remote checks remain.

## Actual local checks

- Initial focused verification/auth regressions: 4 files / 102 tests PASS
  (`email.service`, `account-verification.service`, `account-verification.guard`,
  `auth-request`).
- New SMTP/controller/proof/UI units: 18 distinct tests PASS across
  `email.service.spec.ts`, `email.controller.spec.ts`, `email-api.spec.ts` and
  `admin/testing/email-settings.spec.ts`; latest service/public-proof/UI pass
  was 14 tests after final behavior edits. Exact Russian error/subject assertions
  and explicit UTF-8 source-byte checks PASS.
- Existing CRM-card/dashboard units: 10 tests PASS.
- API TypeScript: `pnpm exec tsc -p apps/api/tsconfig.json --noEmit` PASS.
- `pnpm contracts:check` PASS: OpenAPI 175 paths and JSON schemas.
- Targeted ESLint errors repaired; local module-boundary rule cannot execute
  without the Nx cached graph. No full repository gate is claimed.
- Changed-file Prettier check and `git diff --check` PASS. Surface/catalog/workflow
  YAML syntax and 0248 normalized-LF checksum pin PASS. OpenAPI uses the repository
  Node validator (Python's older YAML loader rejects pre-existing reused anchors).

Local tooling limits: broad Web TypeScript and `app.factory.spec.ts` collection
cannot resolve existing shared-install dependencies (`@asa-lab/module-sdk`,
react-markdown/three and others). No shared node_modules junction was removed or
relinked. Dependency manifest/lockfile pins Nodemailer 10.2.1 and types 8.0.2;
isolated frozen CI installation is authoritative.

## Remote evidence still required

- `pnpm test:email-verification:pg`: 9 isolated PostgreSQL tests, including real
  authority/ACLs, refresh revocation, expiry/replay, concurrent requests/consume,
  duplicate-address race, null-email Account, config version and audit.
- Existing Account Confirmation Focused workflow explicitly includes new units,
  a separate isolated mail-PG step and the existing built-SPA browser suite.
- Browser contracts cover SMTP unconfigured/edit/save/test-failure/connection/test
  letter, public ready/confirmed/invalid proof at 1440/1024/390/320, pending CRM
  mail in the existing full-card four-width fixture, and own-account email proof.
  Existing messenger diagnostic and both-provider save-layout assertions remain,
  opening details/selecting the relevant tab. Screenshots are produced by CI.
- VIEWPORTS / VISUAL_EVIDENCE: NOT_RUN locally by instruction. Visual acceptance
  is pending CI; no claim of demonstrated or release-ready UI.

External SMTP is intentionally unconfigured. The owner supplies real mailbox
credentials/site origin after deployment and checks actual inbox receipt. No
live email, production database or deployment success is claimed.

MAP_NODES_CHANGED: SURF-ACCOUNT-EMAIL-PROOF / CTRL-ACCOUNT-VERIFIED-EMAIL;
TST-EMAIL-PROOF-UNIT-001 / TST-EMAIL-PROOF-PG-001. Source acceptance pointer for
slice 1 and latest owner mail-placement criteria are in the program map.
NEXT_ALLOWED_TASK for this author: STOP after the bounded commit. The controller
owns independent review, exact-SHA remote evidence and subsequent program work.

## Bounded browser CI repair after first candidate

Exact source `6cf29d5c953c35c6b9d2b836c2ba4e187995f0c7`, focused run
`40208145481`: API/types/unit, isolated mail PostgreSQL (9 cases) and installation
checks PASS. Authentication browser suite: 75 PASS / 7 FAIL; later administrator
browser step did not run. All three failure causes are slice-local category A:

- Four SMTP width cases: the synthetic `email*` route glob excluded the slash in
  `/email/test`, letting the baseline unexpected-mutation response win. Use an
  anchored regex for exactly the configuration and test endpoints. The expected
  failed-connection text and subsequent success/test-recipient assertions remain.
- Public proof at 390/320: inherited `.login-card {width:100%}` plus 16px mobile
  side margins exceeded viewport width by 32px. Give this specific card a border
  box width of viewport minus 32px, centered margins and no inherited full-screen
  minimum height. No overflow hiding. Keep existing overflow checks/screenshots
  and add explicit four-width card inset assertions.
- Single-flight confirmation: the new mailbox component independently called
  `accountVerification` while its parent already owned the in-flight check. Pass
  server-observed availability from both existing parents; mailbox reads only its
  email status. The existing stalled-check/focus/logout/late-result browser proof
  remains unchanged. A new unit proves parent readiness changes update the action
  without issuing another global verification request.

Repair local check: `pnpm exec vitest run
apps/web/src/admin/testing/email-settings.spec.ts apps/web/src/email-api.spec.ts
apps/web/src/auth-providers.spec.ts`: **36/36 PASS**, fresh Vitest execution.
No API/SQL changes; API typing was not repeated. Changed-file formatting and diff
checks apply. No local browser/database/stand was used. Exact repair-SHA CI and
visual evidence remain pending; no claim that the repaired browser cases passed.
