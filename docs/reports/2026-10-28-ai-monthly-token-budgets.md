# Monthly model token budgets — source candidate

The Settings tab has an independent **Save token limits** form for global and
default-per-principal model budgets. Empty is unlimited, zero denies fresh
answers. A model can receive its budget before it is globally published. Budget
configuration never grants model visibility, adapter compatibility or provider
enablement. Existing retired-model budget rows remain visible for administration.

`ollama-local` identifies the one active local slot. Changing that slot's physical
model does not reset the month's usage. Account and StudentSeat principals have
separate user budgets; no named-user override or new identity selector was added.

## Accounting and authorization

- Migration 0276 wraps the existing supported `ai_generation_begin`; the reviewed
  underlying function is private. Exact replay precedes new-budget checks and
  still uses existing owner/Seat authorization. Legacy receipt guards remain.
- Admission and its hold commit together with existing quota/message/receipt
  side effects. Denial rolls the whole statement back. A hold is at most 8192 and
  the available room in both finite scopes. It is a concurrency reservation,
  never an actual token count or output limit.
- Already admitted replies and their bounded native continuation finish fully.
  Existing provider limits, local `num_predict: -1`, money limits and hourly
  operation quotas are unchanged. No paid fallback was added.
- Actual provider input/output from the existing journal settles once; terminal
  conflicts fail. Unknown usage keeps its hold without expiration. The UI
  distinguishes pending usage from confirmed counts. Unknown historical model
  attribution or counts restrict finite affected budgets instead of becoming zero.
- Reservation-backed usage follows the pinned UTC month; legacy usage uses its
  original admission timestamp. Thread deletion does not remove the journal or
  reservations. Image/ComfyUI jobs are excluded; a text parent invoking an image
  tool still counts its own text usage. Explicit provider tests retain their
  separate paid-operation admission and are labeled outside chat token budgets.
- Getters aggregate a month in one grouped pass, using indexed reservation-month
  joins and a separate indexable legacy timestamp range. Policy reads take a
  shared lock; model/month global then principal locks serialize budget admission
  and settlement. Cap edits use exclusive revision CAS and immutable audit receipts.
  Locks end before HTTP/inference begins.
- Own-user projections contain only that principal's usage/remaining, availability
  reason and UTC reset. Global spending stays in the platform-admin projection.

## Verification

The source tests exercise full-answer overage, pre-dispatch denial and rollback,
zero/unlimited, historical known usage on first enabling, retained unknown holds,
CAS/idempotency, hidden-before-published limits, legacy-worker rejection,
Account/Seat isolation, native rounds and lowering caps during dispatch, free
replay after provider disablement, deletion retention and pinned late settlement.

Local checks use direct commands (no Nx cache):

- `pnpm exec vitest run apps/api/src/ai-token-budgets.spec.ts apps/web/src/admin/testing/ai-token-budgets.spec.ts tests/admin/ai-token-budgets.embedded.spec.ts`: 25 PASS.
- The above plus `apps/api/src/ai-native-search.spec.ts` and `apps/api/src/ai-usage-journal.spec.ts`: 58 PASS before the final additional retention/replay assertions; the 25 changed tests were rerun successfully afterwards.
- `pnpm test:ai-chat`: 1204 PASS, 2 known Windows attachment/native failures,
  8 skipped. The failures concern POSIX file mode `0600` versus Windows `0666`
  and the resulting unknown upload/cleanup diagnostic; those files were not repaired.
- Contracts build, API/Web TypeScript and changed product-file ESLint: PASS.
- New real PostgreSQL and browser tests collect successfully; execution is
  **NOT_RUN locally**. No Docker, working database, live vendor, paid service or
  workstation inference process was used.

`tests/admin/ai-token-budgets.pg.spec.ts` uses independent PostgreSQL connections
inside a newly created, exactly named `asa_ai_budget_<uuid>_test` CI database,
then closes its own pools and drops only that database. It reuses the existing
isolated migration coordinator and creates no ad-hoc roles or grants. It does
not move or delete another suite's history to obtain budget room.

`pnpm e2e:ai-token-budgets` uses the built Web, real API and isolated PostgreSQL.
Only inference is a controlled loopback CI transport with explicit synthetic
token counts, not real-vendor quality evidence. Its hard GitHub-CI guard runs
before binding port 11434. The existing real-overview CI build is reused; safe
accounting metadata and before/after 1440/390/320 light/dark screenshots are
preserved. Screenshots and native 200% zoom remain **NOT_VERIFIED** until actual
CI evidence is opened and reviewed. No API-success responses are mocked.

CODE is a source candidate. Real PostgreSQL concurrency, built-browser evidence,
independent review, integration, deployment and owner acceptance remain separate
controller/owner actions. This report does not select another slice or claim release.
