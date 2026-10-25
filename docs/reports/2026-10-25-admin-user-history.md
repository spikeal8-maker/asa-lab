# Retained per-user history

User-authorized bounded slice: projects, publication and AI usage history in
Admin → Users. Main publication only; no deployment or live DB migration.

- Account and StudentSeat stay distinct; neither linking nor tenant coincidence
  combines personal history or grants organizational access.
- Read-only API `/api/admin/v1/users/:kind/:targetId/history`, three categories,
  newest first, limit 1..100 (UI 25), typed stable keys and microsecond keyset.
- Sources: currently owned projects including archived rows, saved versions,
  immutable publication revisions, separately labelled retained legacy gallery
  rows and AI usage journal from its introduction. No first-50 truncation.
- Metadata only: no project documents, conversation text, preview bytes,
  credentials or arbitrary upstream error text. Unknown tokens stay unknown;
  bigint token values remain strings. Current statuses are labelled as current.
- No invented prior autosaves, ownership transfers, deleted rows or publication
  state transitions. Cutoff is not a cross-request MVCC snapshot.
- Each page rechecks SQL grants/typed target. Continuation binds actor, scope,
  target and category, expires after one hour. Read statement timeout 8s.
- Success audit follows successful SQL and releases its pool client first;
  audit failure prevents response. Organization personal history is explicitly
  unavailable until exact source workspace lineage exists.
- Lazy UI, category/identity/scope reset, late-response guards, retry keeping
  already loaded pages, expired-cursor restart and four-width browser coverage.

POST_STEP_REVIEW: L3_CRITICAL; IDA-AUTH-001 / IDA-SCOPE-001 / IDA-CTX-001 /
IDA-SEAT-001. Layout radius: new local history component/styles and both typed
catalog row consumers. Existing shared CRM layout unchanged. New migration 0246
only; old migrations are not edited. New code requires this migration and does
not fall back to an unscoped reader. Independent source challenge found and
closed legacy-row suppression and premature success-audit defects.

Validation: focused API/UI units and API typecheck locally; PostgreSQL,
built-Web typecheck and browser layout evidence on exact published SHA via
Account Confirmation Focused GitHub Actions. Final CI outcome is reported with
the final task response, not inferred from this pre-CI handoff note.
