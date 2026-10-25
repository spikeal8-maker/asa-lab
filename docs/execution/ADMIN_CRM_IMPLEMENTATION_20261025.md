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

## 2. SMTP settings and verified email change

- Platform-only SMTP configuration/status/test UI, encrypted password, redacted
  readback/logs/audit, explicit sender/transport validation and timeouts.
- Admin requests a new address; existing verified email/login stays effective
  until the new address is proven by a short-lived one-use link. No token in
  CRM, logs or exports. Expiry, cancellation, duplicate address, concurrency,
  delivery failure/retry and session consequences are explicit and tested.
- No fake verification or successful-delivery claim when SMTP is unconfigured.

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
