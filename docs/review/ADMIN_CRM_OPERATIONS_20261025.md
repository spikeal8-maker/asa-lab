# Scoped CRM operations and retained detail — slice 3

Baseline: `8a31dde2608b9c0cb016d26d419642357b5330cd`.

## Implemented

- Exact organization membership role/state commands with fresh server authorization,
  expected version, mandatory reason, resource serialization and before/after audit.
  Platform admin may manage supported roles including owner. Organization owners
  manage non-owner memberships; school_admin manages only member/educator and
  cannot alter administrators or promote itself. Legacy student memberships stay
  read-only. Last active organization owner/administrator protections remain.
- Explicit platform co_teacher assignment/revoke for an exact class preserves
  primary owner, active educator eligibility, canonical tenant links and the five
  colleague ceiling. No global Account teacher role or identity conversion.
- Seat educational notes append immutable observations with version/reason/audit,
  paginated reads and current exact-class authority. Retained versions,
  publications and AI receipts use exact Seat/class lineage, never linked personal
  Account history. Legacy Account history reader remains unchanged.
- Unified cards expose these controls. Organization Account rows expose only
  scoped responsibilities, not private personal content. Platform scope selection
  offers server-side name search, named selection and visible bounded-list guidance.
- Project inspection displays saved metadata and available snapshot, on-demand
  JSON and JSON download without running code or granting editor access. A saved
  version never displays a current snapshot as its historical image.
- CSV cancellation aborts waiting and prevents late downloads without clearing a
  replacement export. Existing 10,000-record/16-MiB/eight-second limits are visible.

## Verification

- Scoped admin-auth preflight: SAFE_TO_START, clean baseline, control-plane PASS.
- Integrated web regression: 27 tests PASS across catalog, CRM card, Account panel
  and legacy history suites. Earlier 20-test project/export pass overlaps these.
- Retained detail: 2 UI tests and 3 controller tests PASS; focused ESLint exit 0.
- Responsibilities: 10 focused controller/UI tests PASS.
- API typecheck PASS. Web typecheck is locally blocked by known shared dependency
  declarations; two new integration diagnostics found were corrected. Full web
  typecheck/build remains a GitHub requirement.
- Integrated changed-file ESLint exit 0; formatting and git diff --check clean.
- Contracts PASS (182 OpenAPI paths). Browser discovery: 22 tests, no browser run.
  Existing four-width CRM journey now covers responsibilities, notes and saved
  version inspection; separate cancellation regression added. New PostgreSQL
  suites are explicitly registered in account-confirmation-focused.yml.
- All tests above were uncached direct runs. Local Nx boundary checking reports
  its existing unavailable-graph skip; no full repository gate is claimed.

## Limits

No push, deployment, Docker, local database/browser workload, live database action
or SMTP changes. PostgreSQL/browser proof and independent L3 review are pending
on the final commit. This is implemented and locally checked, not deployed or
owner-accepted. Existing server CSV work may finish after client cancellation;
the client discards the result and does not download it.

## Bounded source-review repair

Source review of `27365953` found that the note writer reused archived-class read
permission, and that the first-100 scope chooser still needed resource codes.
The repair adds a separate active-class write check and server-issued `canWrite`;
archived history remains readable while the form and append command are denied.
Notes lock the same platform privilege fence, exact class, current actor class/
organization membership rows and target Seat before fresh authorization. This
also fences legacy co-teacher row deletion, which does not lock the class.
New isolated PostgreSQL cases cover archived read/write separation, learner denial,
both orders of append versus legacy co-teacher revocation, and an archive transaction
barrier. They are queued for CI, not claimed as locally executed evidence.

Organization/class selection now searches the bounded server list by name,
shows loading, empty-result and first-100 refinement guidance, and discards stale
search results. Resource code entry was removed. Three note UI cases and six focused
responsibility UI cases passed, including finding an organization/class outside the initial 100.
The existing four-width browser journey now uses named search/selection.
