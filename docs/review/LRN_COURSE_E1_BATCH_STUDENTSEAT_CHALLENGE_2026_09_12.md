# LRN-COURSE E1 — Batch StudentSeat challenge review

Date: 2026-09-12
Scope: E1 Batch StudentSeat hard acceptance only.

## Contract

The implemented flow is:

`client precheck -> authoritative server preview -> idempotent batch commit -> one-time printable credentials`.

Server preview owns the row classification vocabulary:

- `valid` — the row can create a new StudentSeat;
- `duplicate` — duplicate within this batch or the same existing Seat;
- `conflict` — the login belongs to a different profile;
- `invalid` — malformed row/label/handle/safe-mode.

The commit stores `created/duplicate/conflict/invalid` per row and never stores plaintext credentials in batch persistence.

## Security and identity invariants

- teacher scope is re-checked by `requireEducator` and `classroom_teacher_access`;
- batch creation reuses `classroom_management_add_seat`, so existing roster audit and Learning seat triggers remain authoritative;
- credential creation reuses `classroom_seat_credential_issue`, preserving credential versioning and session revocation;
- batch tables are RLS-protected and direct runtime access is revoked;
- class code is not a personal credential.
## Idempotency and secret handling

- one UUID `requestId` identifies the whole commit;
- request scope + canonical JSON payload are hashed server-side;
- same request + same scope/payload returns the stored logical row result;
- same request + different scope/payload returns `request_conflict` / HTTP 409;
- a replay does not rotate credentials and returns no old plaintext secret;
- the UI retains the same requestId after a failed response, so a retry is safe;
- the first successful response keeps the dialog open and exposes new credentials only for newly created rows;
- credential cards are rendered from that one-time response and include class code, login and secret;
- no plaintext credential appears in `classroom_student_seat_batches`, `classroom_student_seat_batch_rows` or batch audit payloads.

## Evidence

Fresh isolated DB `asa-seat-batch`:

- all 134 migrations applied; migration container exit `0`;
- API build PASS;
- web build PASS;
- `tests/account/access-a.pg.spec.ts`: **6/6 PASS**;
- batch test proves preview statuses, real StudentSeat sign-in, same-request reuse, request conflict, 403 unauthorized access, 101-row rejection and runtime table denial;
- `tests/courses/learning-course-upgrade.pg.spec.ts`: **4/4 PASS**;
- the `0135` upgrade test proves existing Seat, credential and receipt rows are unchanged and new batch tables start empty;
- `pnpm db:migrate --check`: PASS;
- `pnpm contracts:check`: PASS;
- `git diff --check`: PASS.
## Challenge findings

1. The previous controller loop was not authoritative or whole-batch idempotent; it has been replaced by a DB-owned batch contract.
2. Several new controller messages were corrupted by shell encoding during implementation. The corruption was detected and repaired before acceptance; changed batch files now contain no `????` corruption.
3. OpenAPI initially lagged behind the implemented preview/commit contract and was corrected, including the pseudonym-only minimum batch input.
4. Existing `0134` upgrade test assumed it was the last migration. Its boundary was corrected to `<=0134`; `0135` has its own additive upgrade test.
5. Replay intentionally returns the same logical result but not the original plaintext credentials. This is required by the one-time credential invariant, not an idempotency defect.

## Remaining evidence boundary

A real browser print-dialog/physical page visual check is intentionally deferred to the final E1 browser journey. The print-only DOM/CSS path, one-time data source and production web build are already present.

POST_STEP_REVIEW: **PASS**

CHALLENGE_REVIEW: **PASS**

Verdict: **Batch StudentSeat hard acceptance is closed for E1; no E2 work was started.**