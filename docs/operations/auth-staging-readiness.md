# ASA Lab — staging authentication readiness and controlled live-test handoff

## Scope and safety

This is a read-only public preflight, not a production rollout or a genuine bot-login E2E.
The CLI in `tools/auth-staging-readiness.mjs` makes unauthenticated GET requests only to
`https://test.asa-lab.ru` or HTTP loopback. It sends no credentials, creates no sessions,
and does not change webhooks, accounts, databases, provider settings or Docker configuration.
Output deliberately excludes response bodies, launch links and exception messages.

Never direct the production MAX/Telegram bot webhook to the test server, copy
production tokens into the test environment, or use real student records as fixtures.

## Usage

```bash
node --test tools/auth-staging-readiness.test.mjs
node tools/auth-staging-readiness.mjs
node tools/auth-staging-readiness.mjs --expect-ready
node tools/auth-staging-readiness.mjs --expect-live-proof
```

By default, exit 0 means the public test site and provider listing are reachable and parseable.
It does **not** mean the providers are enabled. `--expect-ready` fails when either
MAX or Telegram is not advertised as ready. `--expect-live-proof` checks the
application's native-confirmation eligibility flag; even a passing flag is not
independent proof that a real bot, callback, database link and browser session worked.
A failed check exits 2. Tests require only Node.js >=22.

## Read-only baseline: 2026-10-21

- On the Ali_Robs Windows device, `https://test.asa-lab.ru/` and
  `/api/auth/providers` returned HTTP 200.
- The public provider response on **the test installation** was:
  MAX `disabled`; Telegram `disabled`; email `not_configured`.
- These statuses do not prove whether separate staging bot credentials exist
  or are valid; the API process has not shown them as enabled.
- 1Panel `asa_update_plan` returned `ready=false` with blocker
  `previous_operation/FAILED_RECEIPT`. Current test revision
  `e142835ed087995235d53f714f8185dfdfb00e0e`, schema 225.
- A previous test-site acceptance reached HTTP 403 at
  `teacher_registration_or_login`; an earlier verification encountered `ENTRY_ORIGIN`.
- The test Linux Tailscale peer was online. SSH from D2-R2 failed at
  connectivity (502); SSH from Ali_Robs reached the test peer but was refused
  as `Permission denied (publickey,password)`. No test-server shell authorization
  was established. Ali_Robs only saved a temporary first-contact SSH host key.

## Required next gates

1. Repair restricted test-server shell authorization or add read-only MCP
   methods for sanitized API logs and network probes. Do not loosen
   production firewalls, SSH access rules, VPN or routing.
2. Resolve the existing staging `FAILED_RECEIPT`, `ENTRY_ORIGIN` and
   teacher-login HTTP 403 via evidence and the supported recovery flow;
   do not suppress acceptance checks, wipe data or blindly update.
3. Inside the staging API process, check the configured secret fingerprint,
   bot identity, token validity, DNS/TLS/HTTPS and per-request status.
   Never print token values, encryption keys, cookies or full webhook payloads.
4. Activate **separate** test MAX and Telegram bots with exclusive HTTPS
   webhook ownership. Retest the public readiness report.
5. With authorized test accounts, confirm old Account ID/roles remain
   unchanged after linking. Exercise new-registration, linked login,
   repeat click, expiry, cancellation, competing user and mobile flows.
6. Capture scrubbed correlation IDs for real client -> bot -> webhook ->
   database -> authenticated browser. Run independent PostgreSQL/Playwright
   checks on the exact build. Publish only via ordinary reviewed PR.

## Evidence standard

Attach commit SHA, installation origin, sanitized API status/reason,
timestamps, isolated database assertion results and redacted browser traces.
No claim of live authentication success is justified by this public probe alone.
Do not modify `asa-lab.ru` as part of staging readiness.
