# Publication discussion and actions — local verification

Owner scope: improve the publication page, persisted comment likes, pinning,
sorting, visual project reactions, clipboard feedback and personal-copy feedback;
remove the electronics viewer's lower instruction strip. No site deployment.
Continues `TASK-PROJ-R8-04-COMMENTS-001` on the existing publication-detail branch.

## Delivered

- Comment cards with initials, compact reaction/reply controls and a contextual
  menu for pinning, deletion, owner hiding and reporting. One highlighted pinned
  root is available to the project owner and active platform administrator.
- Server-side newest/oldest/popular sorting and keyset pages. The pinned projection
  is also retained in normal pages for old clients; the new UI deduplicates it.
  Changing sort retains the compose draft. Popular order is live, not a frozen
  analytical snapshot; changed reactions can move records between page reads.
- Persisted comment likes with live Account/Seat validation, self-like rejection,
  idempotent desired-state commands and a serialized canonical counter. Class
  comment-write permission is not required for liking. Own reactions remain
  removable after hiding; hidden text is not disclosed by the receipt.
- Pinning checks publication ownership or live platform-admin authority, root
  visibility and the shared settings version. Existing owner/admin audit is used.
  Hiding a pinned root removes it from the public pinned projection.
- Project heart styling and motion respect reduced-motion preferences. Clipboard
  success switches to a green check for 2.4 seconds; failure keeps a selectable URL.
  Compact success is announced without another overlapping visual notification.
- Personal-copy progress, confirmed check, short project receipt and canonical
  editor link. The real public copy count is refreshed without remounting the viewer.
  No automatic editing or fabricated increment. Existing platform/author/class
  acquisition permissions and idempotency remain authoritative.
- Electronics instruction footer removed from the DOM; code panel stays aligned
  with the scheme. Editor, simulation math and document formats are unchanged.

## Evidence and checks

- 48 unique focused API/PostgreSQL/component tests passed across the changed
  suites, including 11 real PostgreSQL tests on a fresh isolated database.
  All 284 migrations applied there. No migration checksum was rewritten.
- Real Chromium scenario passed against development and compiled web/API: comment
  persistence, like persistence after reload, pinning, sorting, class/Seat controls,
  author close, report/moderation and admin audit. Compiled scenario: 13.5 seconds.
- A real isolated electronics publication was copied into a private project; the
  copy API could reopen it, and the new header count matched the server. Clipboard
  check appearance and automatic reset were observed. No browser page errors.
- Native screenshots checked at 1440/1024/768/600/390/320, no horizontal page
  overflow. Final screenshots include cards, replies, project actions and mobile.
- API build, web build, web TypeScript, targeted ESLint, E2E behavior and focused
  formatting checks passed. Prior GitHub failure was formatting of the generated
  receipt JSON; that file is formatted in this change. Full exact-SHA CI is separate.

Snapshots: `e2e/artifacts/publication-discussion-ui/` (synthetic local identities).
Detailed local logs: `F:/Asa-Lab/operations/reports/publication-comments-20261101/`.

## POST_STEP_REVIEW / challenge

CLASS: L3, persistence/authorization plus UI. No second identity authority, no
classroom-review reuse, no new global administrator role. RLS denies direct table
access; guarded functions recheck live sessions and roles. Concurrent duplicate
likes do not inflate counters. Pinning uses CAS and cannot expose a hidden reply
or root. Old six-argument readers retain pinned comments; old clients can ignore
the extra fields. Missing reaction counters on an old server do not become fake
zero-count controls. Clipboard and copy success appear only after acknowledgment.

Apply additive migration 0290 before the new API/UI. Existing 0289 and stored
discussion history are preserved. Application rollback preserves both new tables
and counters; do not drop data or rewrite applied migration checksums. This is local
implementation acceptance, not owner/release acceptance or a 5,000-user load claim.

No production Docker, database, deployment or Yandex backup was changed.
