# Several entry addresses for one ASA installation

The optional versioned `deployment/entry-profiles/asa-owned.json` is deployment
configuration for the owner's installations, not a universal application default.
It includes these HTTPS entries:

| Entry | Evidence / prerequisite |
| --- | --- |
| `asa-lab.ru` | Main domain; current Windows DNS lookup was refused |
| Every subdomain of `asa-lab.ru` | Explicit owner delegation, including future/nested names |
| `lab.alikinas.ru` | Existing production alias |
| `161.104.46.160` | VPS; current DNS A answer for `lab.alikinas.ru` |
| `94.29.44.211` | Test router public IP, recorded infrastructure snapshot |
| `192.168.1.115:4610` | Test Ubuntu trusted local HTTPS entry |
| `172.23.104.170:4610` | School address from deployment documentation, corroborated by owner; HTTPS not verified |

The zone rule `https://*.asa-lab.ru` accepts all valid present/future subdomains
at the standard HTTPS port, including `pretest.asa-lab.ru` and
`future.pretest.asa-lab.ru`. The apex is configured separately. It does not
match foreign suffixes, HTTP, arbitrary ports or bare `*`. Every delegated
subdomain must remain under the installation owner's control.

## Select once, preserve on ordinary update

After installing a release containing this feature, use the canonical installation
directory. For a new installation, the existing manager accepts the same
`--entry-profile asa-owned --entry-origin <primary HTTPS origin>` options on
`install`. For an existing installation first preview:

```sh
python tools/asa_manager.py configure-entry --root /srv/asa-lab --entry-profile asa-owned --entry-origin https://test.asa-lab.ru
```

Review the public configuration, then save it:

```sh
python tools/asa_manager.py configure-entry --root /srv/asa-lab --entry-profile asa-owned --entry-origin https://test.asa-lab.ru --apply
```

On Windows use `python` and the actual canonical installation path for `--root`.
Use the school's actual verified HTTPS origin when selecting its primary entry.
These commands do not configure DNS, TLS, proxy sites, firewall or start services.
The existing guarded update activates the selected configuration with its normal
backup/release checks. Do not apply the new configuration to old images as a
substitute for an actual release. No live deployment is performed by this PR.

When that same feature release is already running, the manager detects the saved
entry configuration drift and performs its normal backed-up switch even with the
same release SHA. A read-only `check` reports the pending configuration; it does
not restart services. Matching settings retain the ordinary no-change path.

The manager saves the selected profile/schema, exact aliases, delegated zone,
primary entry and `ASA_BLOCKS_SAME_ORIGIN=true` in private `.env`, outside the
user database. Existing custom aliases, secrets and database URLs are preserved.
The original private file is retained under ignored `.asa/private-entry-backups/`;
never upload those backups. Repeating the selection is idempotent. Ordinary
update reads the saved `.env` without requiring this command again. New profile
revisions do not silently expand an existing installation's trust settings.

## Browser and Scratch behavior

The browser opens Web, API and `/internal/blocks/` through its chosen entry.
The server issues a Scratch capability for that exact validated origin. Runtime
transport/preflight and persistence use the same configured policy. A token from
entry A cannot be used at entry B; project/actor/expiry/permissions remain checked.
Delegated browser mutations require their Origin host to equal the actual Host
received from ingress; `X-Forwarded-Host` cannot grant trust. Ingress must preserve
the original Host. CORS returns an exact origin and never enables credentials.
Legacy installations remain on their fixed-origin behavior until opted in.
The existing `www.asa-lab.ru` canonical redirect is preserved.

DNS and a browser-trusted certificate must exist for every address actually used.
An IP appearing in this profile does not prove a valid IP certificate, reachability,
or that the school currently serves HTTPS. The recorded legacy school HTTP entry
is deliberately not enabled as a production authentication workaround. It needs
HTTPS ingress; credentials/bot checks and secure cookies remain protected.
Sessions on different hosts remain separate; this feature is not cross-domain SSO.

## Evidence and limits

Focused tests exercise future/nested entries, actual Fastify login/preflight,
runtime GET/PUT/OPTIONS transport, real JWT issue/verification, cross-entry token
rejection, revocation, malicious suffix/port/forwarded-host rejection, legacy
behavior, configuration plan/apply/idempotence and private-field preservation.
CI runs the focused suite on Ubuntu and Windows without Nx result cache.
There are no database migrations or changes to data volumes/host networking.
Real school HTTPS login, second-device Scratch save/reopen and a complete fresh
image deployment through all aliases remain NOT_RUN. This is not full portable
deployment acceptance; the transition ADR remains open.
