# User-authorized CRM completion — 25 October 2026

This is a bounded program/acceptance map, not a second task-state authority.
Execution task and applicable blockers remain in `current.yaml`. The owner asks
to complete the Users area as a CRM and authorizes Main publication; deployment
is excluded. SMTP is not configured; owner explicitly selected SMTP settings in
the administration interface. Do not claim live mail delivery before configured.

## 1. Full typed CRM card and authorized detail

- Account and StudentSeat cards: profile, age/birth date where known, canonical
  identity/link relationships, scoped roles/capabilities, access, sessions,
  observed IP/device, projects/publications, paginated actual AI conversation.
- Platform admin may read all relevant CRM/project/conversation detail, per this
  explicit owner decision. Class managers/teachers see only their exact current
  classes and learner educational context; organization membership or matching
  tenant never grants private Account content. No new viewing codes/step-up.
- Profile/access edits validate server-side, use conflict detection, protect
  self/last administrative access, and audit who/what/why. Keep credentials out.
- Preserve immutable learning and publication history; read-only project preview
  does not grant an editor mutation or change grading/review authority.

Accepted core source: `a143178cbc24b3d92a7b24e87bdc2fcf5d289c77`.
Controller accepted independent source review and the exact-source
[focused run](https://github.com/spikeal8-maker/asa-lab/actions/runs/40204580489)
(API, isolated PostgreSQL and built-browser checks passed). Integrated baseline
`ce2773e01bea3db4ad849bb5cadb23adb9468442` adds disjoint Electronics documentation.
This pointer records slice 1 acceptance, not slice 2 verification or deployment.

## 2. SMTP settings and verified email change

- Owner placement decision: mail belongs to **Администрирование → Подтверждения**.
  Show a concise global rule and keyboard-accessible MAX / Telegram / Почта tabs;
  keep connection diagnostics and deployment explanation in collapsed details.
  Config/save/test actions belong to their provider. Preserve long-label usability
  and all applicable states at 1440/1024/390/320, with evidence at 1440/390.
- Platform-only SMTP configuration/status/test UI, encrypted password, redacted
  readback/logs/audit, explicit sender/transport validation and timeouts.
- Admin requests a new address; existing verified email/login stays effective
  until the new address is proven by a short-lived one-use link. No token in
  CRM, logs or exports. Expiry, cancellation, duplicate address, concurrency,
  delivery failure/retry and session consequences are explicit and tested.
- No fake verification or successful-delivery claim when SMTP is unconfigured.
  Connection verification alone does not prove inbox delivery; only consumed
  current-configuration proof establishes enforcement eligibility. Global policy
  remains unchanged. Own existing-email confirmation does not revoke sessions.
- Use the existing installation settings key and explicitly persisted validated
  site origin; never infer proof links from Host/forwarded headers. Raw proof is
  only in the email and temporary browser memory, removed from the fragment before
  diagnostics; no admin readback, audit, export or access-log token.

Accepted slice 2 source: `9a49dad2acace00cb04adb62f4b0ccd0972e2737`, with
independent source acceptance and [exact-source focused proof](https://github.com/spikeal8-maker/asa-lab/actions/runs/40209048818)
(API/SMTP, isolated PostgreSQL and built browser checks passed). Integrated
`d4fe9f6ff8d1d69b0fc95f27a65c5b71037728f9` includes only disjoint Electronics docs.
This is acceptance evidence, not a claim of configured SMTP or deployment.

## 3. Catalog filters, export and factual acquisition analytics

- Server filtering/sorting includes typed users, access/role/class, age where
  known, activity and observed acquisition/source facts. Reset pagination and
  ignore old responses on criteria/context changes.
- Download the entire authorized filtered result as a spreadsheet-compatible
  table, not only the visible page. Neutralize spreadsheet formula injection;
  exclude credentials, verification tokens and mail secrets; audit export.
- CRM analytics: distinct Account/Seat counts, registration/login sources,
  activity/tools/AI, explicit unknown coverage. No invented attribution from
  proxy IP, no counting a linked Seat and Account as two known unique people.
- Capture future acquisition observations with bounded/sanitized fields;
  separate declared referrer/UTM observations from authenticated identity.

Slice 3 authored implementation: additive `0249_crm_directory.sql` reader shares
one filtered authorized base between keyset page, exact count, aggregates and
full CSV. It adds explicit audited organization-class binding, searchable filter
values/manager, same-criteria refresh retention and default full Account card.
No tenant inference, person merge, SMTP/proof change or old receipt-body extension.
Legacy acquisition source/UTM/geo remain honestly unknown; existing bounded safe
referrer collection continues for future visits. Analytics includes retained
legacy AI admissions without journal duplication and labels token coverage.

Slice 3 independent source review passed at
`872e35f446695c740b16eb3eae7884e2671eb19a`; its
[focused run](https://github.com/spikeal8-maker/asa-lab/actions/runs/40213298987)
passed. The integrated Main `c53c848c25327893df29ab1cff54a1d1c2daf6df`
also received [successful exact-Main verification](https://github.com/spikeal8-maker/asa-lab/actions/runs/40213995670).
These runs include isolated SQL and four-width browser evidence, not production
deployment or a 5000-user capacity proof. Local source results are recorded in
`docs/review/ADMIN_CRM_DIRECTORY_20261025.md`. Export bounds are explicit errors,
not partial files.
Native project-version editing is outside this read-only CRM; existing stored
version viewing remains available through retained history.

## Acceptance for each slice and final program

One author per slice, focused unit/type checks, independent L3 challenge review,
isolated PostgreSQL/security evidence and built-browser responsive evidence
(1440/1024/390/320, screenshots 1440/390). No local production DB/Docker test
load or site update. Commit coherent slices, publish exact-SHA verification
branches, integrate reviewed passing work to Main. Classification of unrelated
red CI and bounded convergence follow AGENTS §2.1. A completed slice does not
end the owner-authorized program; continue sequentially until all three criteria
are met or a real blocker requires the owner.

Final report separates implemented/tested/Main from not deployed and not yet
configured external SMTP. Describe any remaining gap explicitly.
