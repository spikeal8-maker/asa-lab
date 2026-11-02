# Runtime image security baseline

This is a source/build candidate, not a production readiness receipt. The current
deployment blockers in `docs/execution/current.yaml`, including
`ELECTRONICS-836-COMMITTED-RESULT-QUALIFICATION`, remain applicable.

## Reviewed production inputs

`infra/security-runtime-images.json` is the current baseline for these official
Docker Library images. Tags are descriptive; immutable multi-platform index
digests determine the input. The recorded Linux/amd64 child manifests were
resolved independently from the official Docker Hub registry on 2 November 2026.

| Component | Previous default | Security candidate | Primary release source |
| --- | --- | --- | --- |
| Node.js | 22.23.2, Debian bookworm slim | 22.23.4, Debian bookworm slim | [Node.js security release](https://nodejs.org/en/blog/release/v22.23.4) |
| Caddy | 2.10.2, Alpine | 2.11.7, Alpine | [Caddy release](https://github.com/caddyserver/caddy/releases/tag/v2.11.7) |
| PostgreSQL | 17.7, Debian bookworm | 17.11, Debian bookworm | [PostgreSQL release](https://www.postgresql.org/docs/release/17.11/) |

Node remains on major 22 and PostgreSQL on major 17. This does not authorize
switching or restoring a running database. Before deployment, use the canonical
manager's complete backup and isolated restore acceptance; do not recreate its
volumes or run a second installation from a worktree.

API runtime builds refresh installed Debian packages before adding their runtime
dependencies. Web runtime builds refresh installed Alpine packages before
dropping privileges. `ASA_SECURITY_PATCHSET=2026-11-02` makes the reviewed patch
step explicit in the build cache. Refresh that marker, base digest and evidence
when accepting another security patchset; an old cached layer is not a fresh
package audit. Package repositories are not snapshot-pinned, so source rebuilds
are not claimed to be byte-identical. The release manifest must identify the
actual produced image digests.

## Separate current defaults from historical CI transports

The immutable 545 transport receipt and its five historical source/mirror image
identities are preserved. Its dated production defaults are no longer used as a
permanent freeze on runtime security updates. `tools/test_ci_image_transport.py`
checks current production defaults through `tools/runtime_image_baseline.py`,
while still challenging mutable references, changed CI transport identities and
weakened gates. The opt-in historical `--baseline-proof` remains a dated proof,
not an acceptance criterion for this new baseline.

Existing general/electronics CI transports intentionally continue to use their
previous immutable fixtures. Passing those jobs alone does **not** qualify the
new runtime inputs. The `Runtime Image Security` workflow builds API/web with
their new default inputs and pulls the exact candidate PostgreSQL digest.

## Evidence and limitations

Local checks are offline/source-only: baseline unit tests, Python compilation,
CI transport semantic/challenge checks and diff/format checks. No local Docker
Desktop or production Docker service is used by this slice.

The new CI workflow uses checksum-pinned official Trivy 0.76.1 and vulnerability
scanning only; it does not scan credentials. It fails for fixable High/Critical
findings, a missing recognised OS, or an end-of-support OS. Reports are retained
even if a scan fails. An unavailable scanner/database is not a clean result.

Until exact-SHA image builds and scans finish, this change does not prove that
the server's existing image findings are closed. Unfixed or lower-severity
findings, application authorization/browser acceptance, the PostgreSQL patch
upgrade and backup/restore all require their own qualification. Caddy's minor
version change needs actual runtime/browser checks, including the CSP rollout,
Scratch, workers/WASM and AI previews. No test-server or school deployment is
performed by this source slice.
