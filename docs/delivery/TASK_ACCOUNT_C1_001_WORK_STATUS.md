# TASK-ACCOUNT-C1-001 — Work Status

Status: `in_progress / implementation complete / final matrix pending`

Canonical references:

- Issue: #48
- Delivery branch: `assistant/docker-linux-bootstrap`
- Draft PR: #70
- Current product focus: `TASK-ACCOUNT-C1-001`
- Next blocked focus: `TASK-ELECTRONICS-SLICE-001`

## Preserved foundation

Account C1 extends the accepted Alpha baseline. It does not replace the
existing public entry, adult registration, Account/Profile/Principal model,
Personal Workspace, `sessions_v2`, email/username login, legacy teacher bridge,
or principal project ownership.

## Implemented Account C1 surface

The following server-derived operations are available:

```text
POST   /api/capabilities/educator/self-attest
GET    /api/workspaces
POST   /api/session/context
GET    /api/account/profile
PATCH  /api/account/profile
GET    /api/account/sessions
DELETE /api/account/sessions/:id
POST   /api/account/sessions/revoke-all
```

The web application exposes the same surface at `#/account` and through the
PortalHeader account menu.

## Security invariants

- Educator eligibility is calculated from the server-stored Account birth
  date; the client cannot choose a capability, grant state, role, or tenant.
- Self-attestation is limited to adults, creates only a provisional educator
  grant, is idempotent, and writes one audit event.
- Active workspace switching is limited to active memberships and updates only
  the current SessionV2 row.
- Profile updates are limited to normalized `username` and `displayName`.
- Session APIs return safe metadata only. Cookie tokens and token hashes are
  never returned.
- A current session cannot revoke itself through the session list. Revoked and
  expired sessions stop resolving immediately.
- The application role has no direct read access to Account or SessionV2
  tables; the API uses the restricted security-definer contract.

## Additive migration

`migrations/0011_account_c1_management.sql` adds only the missing workspace
status, membership state, safe session metadata, and restricted management
functions. Migration `0010` and existing tenant, teacher, project, backup, and
volume data remain unchanged.

Focused migration evidence:

```text
empty database: 10 migrations applied, second pass 0
copy of current test database: 0011 applied, second pass 0
```

## Focused verification

```text
Account management unit tests: 6/6 PASS
Account PostgreSQL/API tests: 6/6 PASS
Account Chromium owner flow: 1/1 PASS
console errors: 0
pageerror: 0
unexpected requestfailed: 0
```

The PostgreSQL suite covers adult and underage policy, forged input, grant
idempotency and audit, workspace isolation/suspension, profile conflict,
session expiry and revocation, raw-token protection, existing teacher
compatibility, and preservation of Personal Workspace projects.

The Chromium flow covers a new adult Account, two real browser sessions,
educator self-attestation, profile update, workspace switching, single-session
revocation, logout/login, and preserved Electronics and Chess projects.

Owner-preview evidence is generated locally and intentionally remains
untracked:

```text
e2e/artifacts/owner-preview/account-c1/01-public-entry-desktop.png
e2e/artifacts/owner-preview/account-c1/02-project-hub-electronics-chess.png
e2e/artifacts/owner-preview/account-c1/03-account-profile-desktop.png
e2e/artifacts/owner-preview/account-c1/04-workspace-switched-desktop.png
e2e/artifacts/owner-preview/account-c1/05-session-management-desktop.png
e2e/artifacts/owner-preview/account-c1/06-account-profile-mobile.png
```

The mandatory full release-candidate matrix is run once on the published
implementation SHA. PR #70 remains Draft and no merge or release tag is part
of this task.
