# Authentication and embedded editor entry diagnosis, 2026-10-21

## Observed, not assumed

Test Ubuntu still runs revision `e142835ed087995235d53f714f8185dfdfb00e0e`,
schema225. Read-only entry probes succeeded with trusted TLS through both the
configured domain and its LAN HTTPS entry. Both returned runtime configuration
and Scratch parent metadata fixed to the domain. One negative login request per
entry, with a deliberately nonexistent diagnostic account and no bot proof,
returned403 `bot_check_required`; no real password was tested. Authentication
rate limits and guards remained enabled. School-host behavior was not verified.

Source baseline inspected: `d57782d1bfb815af653d2783e102c1d6e22a4d4e`.

| Mechanism | Actual binding | Consequence |
| --- | --- | --- |
| Bot challenge | Action, nonce, User-Agent, issue/expiry time, process HMAC secret | Not IP-bound. An API restart invalidates outstanding proofs; a valid password is not tested until proof verification passes. |
| Abuse limits | Attested client address and account identifier | Shared NAT/proxy mistakes can aggregate a school. A429 is not a password rejection. |
| Login origin policy | Explicit allowed Web origins, with cross-site rejection | A healthy GET does not prove that login POSTs from a second address are permitted. |
| Production cookie | Secure, host-only browser cookie | Domain and IP legitimately have separate sessions. This does not change the stored account password. |
| Scratch server session | Saved runtime origin in `readBlocksRuntimeServerConfig`, session issuer, capability and request verifier | Moving the entry can leave API-issued editor authority bound to the old origin. |

Personal login previously displayed both bot-proof and origin403 responses as
“Ошибка сервера”. Organization login displayed them as incorrect credentials.
The accompanying UI correction distinguishes proof recheck, unsupported entry,
rate limit, invalid credentials, network timeout and real backend failure. It
retains the existing proof reset and changes no authentication decision.

## Permanent model

Use the existing portable standard and Issue396 transition plan; this report
does not close its exceptions or claim that a message correction fixes them.

1. Image identity contains code/artifacts, not a LAN IP, domain, user data or
   installation secrets. New installs generate their private installation
   configuration; updates retain it; restoration handles its required keys
   explicitly with the corresponding data.
2. One supported HTTPS portal entry is selected once per installation, with
   optional explicit aliases. Persist it as installation state and generate
   dependent origin/proxy configuration in one operation. Public domains cannot
   safely be guessed from arbitrary Host or forwarded headers.
3. Web/API/editor assets use same-origin paths. Embedded Scratch already derives
   its browser origin from the parent/iframe entry in current source. Complete
   the server-side transition by passing a validated entry into issued runtime
   sessions/capabilities and validating the same origin on subsequent requests,
   retaining actor/project/version/mode/expiry/source checks. Do not reflect an
   untrusted request origin into a signing authority.
4. A private-network address discovered on the machine is a connectivity hint,
   not automatic browser trust. Proxy hops, allowed entries and TLS remain
   installation configuration. Rebinding the old IP, allowing all origins, or
   treating every192.168.x.x origin as trusted is not a portability solution.
5. An installation/admin diagnostic surface should show configured entries,
   validated current entry, proxy-chain readiness, cookie/TLS readiness and
   embedded-editor readiness. Address changes must be verified before applying
   the generated configuration. No runtime admin origin editor is implemented
   by this small UI correction.

After restart an invalidated bot proof should require a normal fresh check;
never silently bypass the challenge or automatically repeat password attempts.
Persisting a challenge key is a separate design decision because replay state
must then also remain effective across replicas/restarts; merely fixing the
HMAC secret while keeping only an in-memory used-nonce map is not safe.

## Required acceptance for the remaining portability work

Test installation/update and restored configuration using local, LAN and
public/proxy entry as separate environments. Cover configured alternate
hostnames, rejected foreign origins and spoofed forwarded headers, shared-NAT
limits, expired/replayed/restart-invalidated bot proofs, host-only cookies, and
actual teacher/student sign-in plus Scratch save/reopen. A valid HTTP health
response or an isolated no-proof negative test is not a successful login.

This report and UI correction do not deploy a new release, change live origins,
restore a database, close an interrupted update receipt, disable protections,
or establish school-server acceptance.
