# Native MAX external-only backend — 24 October 2026

The owner decision is normative in `ASA_ACCOUNT_CONFIRMATION_SPEC.md` §6.1.
Only native MAX pairing registration becomes external-only; ordinary, Telegram
and the separate raw Mini App contracts retain their credential requirements.

Migration 0241 stores actual absent Account and mirrored teaching-user email/
password as NULL, with `password_configured=false`. A private canonical bootstrap
creates the existing Profile, Principal, personal tenant/workspace, membership,
creator grant and session. PUBLIC/application execution is revoked; the ordinary
public bootstrap rejects NULL credentials. No fake address, empty hash, hidden
random password or name-based account merge is introduced.

The MAX-only entry checks approved actor proof, original browser nonce, current
configuration, expiry, one-time consumption, assertion uniqueness, non-link
purpose and age 18+. Account/identity/session and native-delivery receipt commit
atomically. Existing last-usable-method self-unlink rules are preserved.

Nullable session/profile/API types retain real NULL. Both password entry paths
reject absent hashes through the decoy path rather than throwing. Account-page
display is null-safe. Avatar loading uses an explicit Account/StudentSeat
presentation kind instead of email, so an email-less Account can load its avatar
without issuing an Account-only request for a StudentSeat.

One focused local run passed **77 tests** across MAX, Telegram, auth forms,
account management, ordinary identity and missing-hash login boundaries. A later
single new avatar identity test passed after the reviewer identified that email
must not distinguish an Account from a StudentSeat. The earlier suite was not
repeated. ESLint reported no errors, with the existing local missing-Nx-graph
warning. A generic PyYAML whole-OpenAPI read hit a pre-existing duplicate `a1`
anchor; this slice does not alter those unrelated baseline anchors.

Four new cases in the existing provider-lifecycle PostgreSQL suite cover real
NULL personal/teaching scope, password denial/later explicit configuration,
sole-method unlink, invalid age/nonce/approval/expiry/generation/link purpose,
concurrent single creation, private-helper ACLs and rollback of all authority
on a forced username conflict. They are included in `test:auth-confirmation:pg`;
actual PostgreSQL/build/browser verification runs in GitHub, not against the
installed site. Browser scenarios and their separate report belong to the
assigned browser author. No live settings, database or containers were changed.
