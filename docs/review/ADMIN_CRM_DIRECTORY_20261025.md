# CRM directory final slice — author self-review

POST_STEP_REVIEW

- STEP: complete the authorized Users CRM catalog, filtered spreadsheet export,
  factual aggregates and explicit organization/class access hierarchy.
- CHANGE_CLASS: L3_CRITICAL.
- CHANGED: additive 0249 reader/binding/audit helpers; typed filters, bounded CSV
  preparation and fresh session recheck; filter lookup, full-base analytics,
  binding manager and default full Account card. Old migrations/readers remain.
- USER_RESULT: filter and sort before paging, see exact matched count, download
  the complete authorized result or an explicit size/time error, analyze retained
  observations, assign/revoke one class organization with an audited reason.
- INVARIANTS_TOUCHED: IDA-AUTH-001, IDA-SCOPE-001, IDA-CTX-001, IDA-SEAT-001,
  IDA-REV-001, IDA-ORG-001, IDA-LINK-001.
- LAYOUT_IMPACT: AdminUsersCatalog and new directory-only CSS/components; full
  card status/class copy and Account default tab; one SMTP eligibility sentence.
  Existing shared admin CSS/framework unchanged.
- VIEWPORTS: written built-browser cases at 1440/1024/390/320; not executed
  locally. Screenshots requested at 1440/390 for filters/analytics and bindings.
- VISUAL_EVIDENCE: pending exact-SHA CI. Playwright listing compiles all 21 admin
  browser cases, including four new directory cases; listing is not browser PASS.
- TESTS: actual focused run of 8 API/web files, 57 tests PASS; subsequent updated
  catalog/API subset 18 tests PASS, including the new concurrency regression.
  API TypeScript PASS on combined source descended from SMTP cache repair
  `12505fb1fb6a42eddcce5ca235f872007cb79233`. OpenAPI/JSON contracts PASS;
  control-plane validation PASS; whitespace check PASS.
- NEGATIVE_CHECKS: actual units cover closed/duplicate query input, impossible
  dates/ages, CSV quoting/formulas/unknown-vs-zero/secret exclusion, size limit,
  overlapping actor export rejection, fresh session denial, current actor/scope
  late-response discard, same-criteria DOM retention, stale export discard and
  organization launcher without forbidden legacy history.
- DOC_DRIFT: surface/test catalogs, master policy, API schema and program map
  updated. Accepted slice 2 proof is recorded separately from slice 3 acceptance.
- UNVERIFIED: isolated PostgreSQL execution/upgrade and browser/layout evidence
  remain for CI; no local DB/Docker/server/browser was launched. Local full web
  typecheck is blocked by the known shared dependency/build-output baseline
  (react-markdown/remark/three/module SDK and dependent modules); captured output
  contains zero diagnostics under apps/web/src/admin. Dependencies were untouched.
- VERDICT: focused author/source checks PASS; complete acceptance pending the
  independent exact-SHA review and required CI evidence.

## Boundary challenge

The typed identity boundary remains Account versus StudentSeat; no name/email
merge or inferred person count. Linked-profile aggregate counts records with at
least one explicit link, not both directions of each link. Organization targets
use real Account membership or the dedicated class binding, never tenant equality.
Only current owner/school_admin membership opens the bound class's Seat learning
card. Linked Account identities and private Account AI/profile detail stay closed.
Organization filters cannot probe a different organization's membership.

Export buffers at most 10,001 candidate records, then rejects over 10,000 or
16 MiB. SQL operations have eight-second statement/two-second write-lock budgets;
two process exports and one per actor are allowed. No read client is held while
writing the preparation audit. Final checks bind every returned typed ID to
current membership/class mapping, current actor role and the still-active same
session. Audit says prepared, never confirmed download. There is no silent cap.

The new PostgreSQL suite writes >50 row pagination/export/count checks, exact
binding/current membership/mapping revoke and foreign-scope negatives, hidden
Account fields, audit/CAS, actual retained referrer and legacy-plus-journal AI
deduplication. These are written requirements, not a claim they ran locally.

First retained browser-declared visit source is labelled separately from
registration attribution. Historic campaigns, IP geography and missing tokens
are unknown. Existing bounded referrer capture continues; old visit normalization
and semantic receipt hashes are unchanged. AI aggregates include retained quota
admissions absent from the journal, without double counting owner/request pairs.
Organization AI explicitly covers authorized Seats only. Empty stored observations
do not prove absence of use. Existing project/history readers remain read-only;
this slice adds no native project-version editing.

No Main publication, deployment, SMTP configuration or external delivery is claimed.
