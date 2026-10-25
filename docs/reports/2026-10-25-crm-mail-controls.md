# CRM mail controls — bounded follow-up

Owner requires email to remain OFF until an actual SMTP service is supplied. No
SMTP address, credentials, live setting, database or Docker runtime was changed.
The existing persisted default remains OFF; saving settings never enables the
separate global any-channel account-confirmation policy.

## Implemented

- Explicit explanation that mail delivery and the MAX/Telegram/email global
  requirement are separate controls; accessible mail switch stays OFF by default.
- Disabled SMTP drafts may omit server, sender, username and site origin. Nonempty values,
  protected ports, origin, lengths and control characters remain validated; an
  enabled configuration still requires complete valid fields.
- Dedicated OFF action uses the last saved configuration, ignoring invalid
  unsaved input and preserving the saved password. It remains usable when the
  encryption key is unavailable; no password envelope is created in this path.
- Discard action restores saved settings and removes the in-memory password.
- Status distinguishes OFF, required connection test, checked connection and
  confirmed delivery. Missing encryption support cannot show a green ready state.
- Four-width existing browser scenarios cover initial OFF, explicit OFF save
  with empty fields, no automatic save/send, and OFF despite invalid draft fields.

## Evidence and limitations

Focused local tests: 28 passed (email service 19, mail controls 7, public mail API 2).
API `tsc --noEmit -p apps/api/tsconfig.json`, contracts and diff checks passed. Exact-SHA GitHub account-confirmation-focused.yml
must supply PostgreSQL and browser evidence; no local heavy browser/DB run.
No actual SMTP provider/inbox exists, so real delivery remains untested and the
feature must remain disabled on the working installation. Existing authentication,
mail-proof expiry/single-use, authorization and audit mechanisms are preserved.
