# ASA Games Platform — R0 current-state audit

**Status:** refreshed pre-implementation audit  
**Observed baseline:** `main@c9fbb773bc4b2c4e19c181ef586ee6300a9cfed6`  
**Purpose:** replace stale assumptions from the old Games docs branch before any shared schema/API work.

## 1. Repository and agent governance

The previous Games architecture branch diverged from a much newer `main`; it is supporting research, not current-state evidence.

The repository already has a compact agent-routing system: document registry, domain contracts, surface maps and targeted context. `tools/agent_context.py` caps targeted rendered context at 8,000 characters. Games must integrate with that system instead of adding another large always-read guide.

Current root routing files are already large (`AGENTS.md` about 21.7 KB; `START_HERE_FOR_AI.md` about 14.9 KB), so Games adds only compact, scoped files.

## 2. Identity — current facts

### StudentSeat is a Principal, not an Account

`0026_student_seat_principal.sql` extends `principals` to `account | student_seat`. A seat principal has `seat_id` and no `account_id`; `student_seat_principal()` creates it lazily for an active/issued seat.

`0047_seat_principal_lookup.sql` exposes a one-row `principal_for_seat()` SECURITY DEFINER lookup rather than giving the runtime broad access to the principals table.

### One human can have more than one principal path

`0050_account_learners.sql` allows an Account to occupy a classroom StudentSeat. The classroom seat still gets its own `student_seat` principal even though the seat is linked to an Account. Therefore an Account principal and one or more seat principals may represent different scopes of the same human.

Personal Account-owned work remains separate from classroom-seat work.

### Home tenant is not a universal gaming identity

`0062_principal_home_tenant.sql` resolves home tenant only for an account principal; a seat principal has no account id and returns no home tenant through that path.

### LearnerIdentity is school-scoped

`0086_learning_identity_foundation.sql` creates `learner_identities` under `(tenant, school)` and links either a seat or an account. It is designed for learning evidence/convergence. Its key and school lineage are immutable.

**R0 consequence:** `GamePlayerProfile` must not be implemented as a naive unique FK to `principals.id`, and `learner_identity.id` must not silently become a global gaming identity. R0 must define a stable gaming subject/resolver above the existing authenticated subject paths.

## 3. Checkers — current facts

`contexts/checkers/application/game-service.ts` already has:

- modes `bot | class | local | lesson | friend | quick | rated`;
- two-player session validation;
- versioned authoritative session state;
- `expectedVersion` conflict handling;
- participant/side authorization;
- existing Russian-64 rules application;
- repository port `find/create/save`.

The web presentation adapter already projects legacy personal, classroom-server and session-service matches and uses safe opponent fallback labels.

**R0/R1 consequence:** do not rewrite Russian-64 rules or create a second Checkers engine. R1 should adapt existing rules/session concepts into the generic Match Core.

## 4. Chess Live — current facts

`contexts/chess-live/application/ports.ts` remains a strong donor for:

- idempotency command receipts;
- optimistic versioning;
- challenge acceptance;
- durable events/sequence;
- matchmaking ticket lifecycle;
- rating state/ledger.

It is still tenant-scoped and chess-specific (`white/black`, chess rating pools, chess model), so it cannot simply be renamed into Games Core.

**R4 consequence:** extract/generalize patterns through compatibility adapters; preserve mature Chess behavior until parity is proven.

## 5. Realtime — current facts

`apps/realtime-gateway/src/index.ts` is still a foundation stub whose health is `live: true, ready: false`.

**Consequence:** no large realtime implementation is needed for R0/R1. Command correctness can remain HTTP/snapshot-authoritative; the full Gateway/Room Runtime belongs to R6.

## 6. Deployment/concurrency

The repository is actively changing in parallel. Any R0 decision that depends on identity, tenancy, Checkers or Chess must record the exact observed `main` SHA and re-check if that area changes before acceptance.

Do not modify `docs/execution/current.yaml` merely to make Games appear active during this docs-only preflight.

## 7. Audit verdict

The value-driven Games direction remains viable, but R0 identity must be redesigned around current identity reality:

`authenticated ASA subject → gaming-subject resolver → public GamePlayerProfile`

rather than:

`principal_id → GamePlayerProfile` by direct assumption.

No shared Games SQL/API implementation is authorized by this audit.
