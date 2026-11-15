# Publication comments — implementation and local acceptance

Owner request: persistent comments beneath public publications, independent class
and StudentSeat controls, owner discussion close and platform-admin moderation.
Production deployment is explicitly excluded. Slice: `TASK-PROJ-R8-04-COMMENTS-001`.

## Delivered behavior

- New public discussion tables, forced RLS, no direct runtime table grants; only
  guarded functions use the authoritative live Account/Seat session. Mixed cookies
  are rejected by the existing mutation guard; revoked Seat never falls back to Account.
- Accounts can comment; guests read only. Class default is OFF. Each learner has
  inherit/allow/deny independently of publication/download. Existing policy writers
  omitting new fields preserve comment settings. Rating eligibility is deferred.
- Text is limited to 2,000 Unicode code points, rendered as escaped React text.
  One reply level, keyset pages of at most 30, ten new comments/minute and 100/hour
  per principal. Actor advisory locking and a unique mutation key prevent duplicate
  submissions after lost responses and concurrent retries.
- Comments bind to the published revision, never the private draft. Existing
  records remain when the author closes discussion. Closing/reopening does not
  revoke an independent administrator prohibition. Authors can delete their own
  comments even after discussion closes; project owners can hide/restore locally.
- Admin → Publications → Comments provides lazy paginated moderation, complaints,
  separate moderator hiding/restoring, complaint resolution and discussion close.
  A reason and current version are mandatory. Actions use the existing administrative
  audit. Author deletion, owner hiding and moderator hiding remain distinct.
- Public responses redact hidden/deleted body and author/private identity IDs.
  Moderators can review stored text and history. Individual report reasons are
  bounded to the latest 20 per comment with the total count displayed.
- UI handles timeout, denied access, stale versions, duplicate clicks and identity
  changes. Late reads cannot replace acknowledged writes or restore retired permissions.
  Reply counters and rate/page lookups have supporting indexes.

## Verification actually performed

- Fresh PostgreSQL 17.7 isolated `*_test` database: all 283 migrations applied;
  migration-file validation passed. No production database used.
- Focused API/PostgreSQL/component regression: 68 passed. Added stale-refresh
  regression increases the unique focused set to 69; changed discussion suites
  passed 15/15, including final SQL checks 8/8 after the reply-count index addition.
- Real Chromium scenario passed on the compiled web/API (13.1 seconds): learner
  posting and persistence after reload, reply, class default OFF, individual
  deny/allow, owner close/reopen, guest read-only, report, admin hide/close and audit.
  Zero page errors. Checks also ran against the development preview.
- Discussion widths 1440/1024/768/600/390/320; class settings, learner settings
  and admin moderation 1440/1024/390/320. No horizontal page overflow.
- Web and API TypeScript checks, E2E TypeScript check, targeted ESLint, web/API
  builds and diff whitespace check passed. Existing Vite large-chunk warning remains;
  this is not a new performance or 5,000-user load-test claim.
- A separate disposable demo shows real electronics playback plus stored comments
  and a reply, with the same discussion on Scratch. Native browser tab 7 is left on
  the local electronics example. Screenshots use synthetic identities only.
- New regression tests are included in the publication code/browser gates and
  their workflow evidence paths. The entire publication gate/full CI was not run
  locally; no release or Main acceptance is claimed.

Selected evidence:

- `e2e/artifacts/publication-comments/discussion-1440.png`
- `e2e/artifacts/publication-comments/discussion-390.png`
- `e2e/artifacts/publication-comments/class-permission-390.png`
- `e2e/artifacts/publication-comments/learner-permission-390.png`
- `e2e/artifacts/publication-comments/admin-moderation-320.png`
- `e2e/artifacts/publication-comments/receipt.json`

## POST_STEP_REVIEW / challenge

CHANGE_CLASS: L3_CRITICAL (new persistence and permissions).
LAYOUT_IMPACT: new discussion and moderation classes; existing class-policy form
now has an independent third setting. All affected surfaces checked as above.
NEGATIVE_CHECKS: guest write, class denial, individual denial, mixed/expired session,
forged SQL actor/session pair, direct table read, foreign teacher, revoked admin,
revoked publication, stale CAS/revision, deep/cross-publication replies, XSS text,
rate/body limits, duplicate/concurrent mutation, identity retirement and stale GET.
HISTORY: soft flags preserve records; moderator restore cannot resurrect deleted
or owner-hidden text. Public redaction is server-side.
COMPATIBILITY: apply additive 0289 before the new API. Old policy clients preserve
new values; new controls stay disabled if an old server omits them. Missing comment
API is an explicit unavailable/error state. Rolling the application back preserves
stored discussions; do not reverse/drop the new tables or rewrite migration checksums.
VERDICT: PASS for this locally verified implementation; independent release review,
full exact-SHA CI, owner acceptance and deployment are not claimed.

## Remaining boundaries

No rating formula, notifications or unlimited nesting. No 5,000-user load validation.
Deletion is a public tombstone, not erasure of moderation history. Public discussion
does not reuse classroom review/feedback records. Code remains in the existing
publication-detail feature branch; production Docker/site/database are unchanged.
