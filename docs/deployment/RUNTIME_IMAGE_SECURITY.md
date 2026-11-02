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
their new default inputs and builds the PostgreSQL derivative from its pinned upstream digest. Its
checkout, build revision and artifact identity all use the same PR head SHA (or
the dispatch SHA), rather than labelling an implicit PR merge-tree as head code.

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

## First exact candidate scan and bounded API repair

Run [41508985118](https://github.com/spikeal8-maker/asa-lab/actions/runs/41508985118)
scanned source `f9c9cbb4e348735f69af0dd4629bcc1c07dff106`. All three scans
installed Trivy and downloaded its database successfully; these are real
fixable High/Critical failures, not infrastructure failures. Debian/Alpine OS
findings were zero. Remaining counts were API 12 (10 bundled npm findings and
two venv setuptools findings), web 6 (Caddy's compiled Go/module dependencies),
and PostgreSQL 26 (the official image's `gosu` binary).

The bounded API repair removes unused npm/npx from the final runtime image and
uninstalls setuptools after document dependencies have been installed. Node,
application packages and build/test package managers remain present. The
existing real document-reader tests run **after** removal in the Docker build;
CI additionally imports pypdf/defusedxml and verifies that unused tools are
absent. Runtime entrypoint/migration/seed scripts invoke Node directly. This is
attack-surface removal, not a scanner exclusion. The next exact image scan must
confirm the result; no successful API image result is claimed in advance.

Web and PostgreSQL remain blocked pending a separate derived-image slice.
`apk upgrade` cannot repair Go libraries statically compiled into Caddy, and
`apt-get upgrade` cannot repair the bundled gosu binary. Do not ignore these
findings, declare this source production-ready, or deploy it as a completed fix.

## Patched compiled dependencies and managed PostgreSQL transport

The follow-up candidate rebuilds Caddy **2.11.7**, with exactly go-jose **4.1.6**
and x/net **0.60.0**, and gosu **1.19** using official Go **1.27.3**. The compiler
image is pinned by its official registry index digest. Both upstream source
archives have explicit Docker `ADD --checksum` SHA-256 pins recorded in
`infra/security-runtime-images.json`. Go uses its normal authenticated module
checksum database, `GOTOOLCHAIN=local` prevents implicit compiler downloads,
and `go build -mod=readonly` rejects additional unresolved build dependencies.
The upstream module graph plus the two exact patch requirements select the
Caddy dependency versions. This intentionally patches the upstream module
sources during the build; it is an ASA derivative, not an unmodified official
Caddy binary. Build-info files in both runtime images record the actual compiler
and selected modules. No scanner ignore rule or severity downgrade is added.

Primary inputs: [Go releases](https://go.dev/dl/?mode=json),
[Caddy source](https://github.com/caddyserver/caddy/tree/v2.11.7),
[go-jose 4.1.6](https://github.com/go-jose/go-jose/releases/tag/v4.1.6),
[x/net 0.60.0](https://pkg.go.dev/golang.org/x/net@v0.60.0),
[gosu source](https://github.com/tianon/gosu/tree/1.19).

PostgreSQL remains **17.11/bookworm** with the official entrypoint, database
path, initialization and runtime user behavior. Only gosu is replaced and OS
packages refreshed. `compose.yaml` builds that derivative for source installs;
`ASA_POSTGRES_IMAGE` selects an immutable release image for managed installs.
Manifest **v3** adds PostgreSQL to the five v2 components and records the actual
GHCR digest. v1/v2 manifests remain valid and select their explicit historical **17.7**
Docker Hub manifest digest from the 545 receipt, independently rechecked against
its registry config (`PG_VERSION=17.7-3.pgdg12+1`). They never select the current
17.11 candidate from `runtime_defaults()` or require a new local derivative. They do not retroactively gain
this gosu fix. The release CI builds/publishes PostgreSQL alongside the other
components and checks all v3 image digests after Compose resolves.

The real disposable PostgreSQL CI smoke initializes a fresh isolated volume
through the root entrypoint, checks PID 1 is the non-root postgres UID, writes
a sentinel, reopens it through root stepdown, then reopens the same data as the
non-root Compose user. It publishes no ports, uses no external network and
cleans up only its uniquely named CI container/volume. Caddy CI validates the
real configuration with the rebuilt binary and verifies compiler/module build
info. These tests have to pass in the exact source candidate run; source-only
unit tests are not substitutes.

`Runtime Image Security` now runs for every main commit, plus relevant pull
requests. Publication waits for the exact main SHA's latest general and runtime
security workflows to succeed. API/web/PostgreSQL are loaded locally on the
isolated release runner, scanned **before** their push, and that same image is
pushed only if the High/Critical fixable and OS-support checks succeed. Scan
artifacts are retained on failure. The stable manifest is promoted only after
all image builds/scans and the existing backup/restore smoke complete. This
source candidate has not deployed any PostgreSQL or Caddy binary to a server.

## Required staged manager bridge (v3 publication is not activated)

Old installed managers reject an unknown v3 manifest before they can select and
check out the new manager source. Reader backward compatibility alone does not
solve that bootstrap boundary. This candidate therefore deliberately **continues
publishing v2**, controlled by `infra/deployment/release-channel.json` and the
fail-closed `publication_channel()` validator. Changing that file to v3 is
rejected by this implementation. The bridge v2 release carries the new v3 reader
but retains the historical v2 PostgreSQL selection. Its independently built,
scanned PostgreSQL derivative may exist in GHCR, but is not yet selected by the
stable v2 manifest. PostgreSQL CVE deployment closure is not claimed.

The separate activation slice must first attest successful publication **and
installation** of this v2 bridge on managed hosts (or provide a verified explicit
bootstrap path for hosts that skipped it). Only then may it activate v3 manifests
and their PostgreSQL derivative. Unknown legacy installations must fail closed;
they must not silently receive today's PostgreSQL baseline or a raw image ID
instead of an immutable manifest reference. This slice does not implement or
claim that later activation/installation step.
