# VSCR-D0-005 — Blocks deployment, backup and activation contract

**Status:** accepted design contract for the Visual Programming programme  
**Master:** [`../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`](../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md)

This contract fixes the browser-visible topology, Docker ownership, backup ordering,
degradation and final activation gate. It prevents a local-development URL or incomplete
backup story from being promoted into a school deployment.

---

## 1. Deployment principle

Scratch runs as a separate browser origin but remains part of the **same ASA Lab
installation**.

A separate origin does not mean a separate product, database, identity system, deployment
control plane or permanent Compose project.

Target topology:

```text
student browser
├── ASA Web/API origin
└── Blocks runtime origin

server/install
├── existing ASA API/Web/PostgreSQL
├── Scratch runtime container
└── private S3-compatible object storage (local MinIO or configured external service)
```

---

## 2. Required configuration

Browser-visible/runtime configuration:

```text
ASA_WEB_ORIGIN
ASA_BLOCKS_RUNTIME_ORIGIN
ASA_BLOCKS_RUNTIME_PORT
ASA_BLOCKS_RUNTIME_BIND_ADDRESS
```

Recommended defaults for developer machine only:

```text
ASA_BLOCKS_RUNTIME_PORT=4613
ASA_BLOCKS_RUNTIME_BIND_ADDRESS=127.0.0.1
```

Object storage configuration is defined by D0-003.

Runtime signing key is defined by D0-004.

Every origin setting is parsed/validated as an absolute origin. Paths, credentials,
fragments and arbitrary header text are rejected.

---

## 3. Browser-visible runtime URL rule

`127.0.0.1` always means the **browser's own machine**.

Therefore this is valid only when browser and server are the same developer computer:

```text
http://127.0.0.1:4613
```

It MUST NOT be returned to a student browser on another PC.

The parent obtains the runtime origin from server-validated deployment configuration,
ultimately returned by the runtime-session response. Frontend code does not synthesize a
runtime URL from `window.location` plus guessed ports.

---

## 4. Supported deployment shapes

### 4.1 Developer localhost

```text
ASA Web/API:       configured localhost/127.0.0.1 development origin
Blocks runtime:    http://127.0.0.1:4613
Object storage:    local test/MinIO or configured development S3
```

This mode is not evidence that a remote classroom can reach the runtime.

### 4.2 School LAN without local DNS/TLS

Example shape:

```text
ASA Web/API:       http://192.168.x.y:<asa-port>
Blocks runtime:    http://192.168.x.y:4613
```

The actual server address is installation configuration, not committed code.

Requirements:

```text
runtime bind explicitly allows LAN clients
host firewall allows only required LAN ingress
API CORS runtime origin exactly matches the LAN runtime origin
ASA parent CSP frame-src exactly includes that runtime origin
runtime CSP frame-ancestors exactly includes the ASA Web origin
```

A browser opened on the LAN must receive the server address, never localhost.

### 4.3 Public/reverse-proxy HTTPS

Recommended shape:

```text
https://<asa-web-host>
https://<blocks-runtime-host>
```

The runtime subdomain/origin is routed to the Scratch Nginx container by the existing
installation's reverse-proxy layer.

If the parent is HTTPS, runtime MUST also be HTTPS; do not create mixed-content iframe/API
traffic.

The Scratch container may remain private on the Docker network when the reverse proxy
terminates TLS.

---

## 5. Docker/Compose ownership

Scratch runtime joins the existing ASA Compose project.

Logical service:

```text
scratch-editor
  image/build: infra/scratch-editor/Dockerfile
  internal port: 8080
  health: /healthz
  no database
  no account/session secret
  no object-store credential
```

A host port is published only when the deployment mode needs direct browser access.

Preferred binding expression conceptually:

```text
${ASA_BLOCKS_RUNTIME_BIND_ADDRESS:-127.0.0.1}:${ASA_BLOCKS_RUNTIME_PORT:-4613}:8080
```

Exact Compose syntax follows the existing repository compose conventions and
`compose:check`.

Do not add a second `docker-compose.yml` that operators must start independently as the
normal installation.

---

## 6. Runtime container networking

The Scratch container serves static editor files. It does not need database access,
object-store credentials or ASA signing keys.

Browser JavaScript, not the container server, calls the ASA runtime API.

Therefore the container itself should have the minimum Docker network access needed for
health/reverse proxy routing. Do not grant host network mode merely to make local URLs
work.

M3 browser network-deny tests remain necessary because blocking Docker egress alone does
not block JavaScript executing in the student's browser.

---

## 7. Object storage placement

Self-hosted deployments may use MinIO in the same Compose project. Public/cloud deployments
may configure an external S3-compatible endpoint.

The API is the only component with long-lived object-store credentials.

The Scratch container and browser receive only ASA API URLs/capabilities.

No production deployment may depend on a developer's local filesystem path for durable
costumes/sounds.

---

## 8. Availability lifecycle

The module availability sequence is fixed:

```text
M0/M0.1/D0/M1/M2/M3: coming_soon
M4-001 only:          active
```

Do not activate after M1 merely because save/load works.

Public creation requires all of:

```text
durable persistence
crash/conflict recovery
read-only immutable player
Learning immutable submission
Gallery/remix integration
local supported libraries
browser network-deny acceptance
PostgreSQL + object-store backup/restore evidence
real deployment topology smoke
security/dependency gates
```

---

## 9. Why backup is a pre-activation requirement

After Blocks introduces external binary blobs, a PostgreSQL-only backup can restore a
project graph whose costumes/sounds no longer exist.

That is unacceptable for learner work.

Backup/restore is therefore part of M3 acceptance and a hard predecessor of M4 activation.

---

## 10. Backup consistency invariant

The save pipeline guarantees:

```text
blob bytes persisted
→ blob/alias metadata committed
→ project document revision committed
```

Blobs are immutable and core programme GC is disabled.

This permits a safe baseline backup sequence without a distributed transaction:

```text
1. record candidate/build/config identity
2. capture PostgreSQL backup
3. mirror/copy Blocks object storage to backup destination
   without deleting destination-only objects during the capture
4. generate object manifest/digests/metadata as supported by backup tooling
5. validate every Blocks asset ref reachable from the captured DB resolves in the captured
   object set
6. mark backup successful only after validation
```

Extra objects copied after the DB snapshot are harmless orphans. Missing objects referenced
by the captured DB are a failed backup.

Do not reverse this into `object snapshot → later DB snapshot` unless another mechanism
proves objects created between those snapshots cannot be referenced by the DB capture.

---

## 11. Backup scope

A complete Blocks-capable backup includes at least:

```text
PostgreSQL:
  projects/drafts/versions
  Blocks blob metadata
  Blocks asset aliases
  publication/submission metadata that references project versions

Object store:
  configured private bucket/prefix containing Blocks blobs

Manifest:
  application/build identity
  Scratch upstream commit/version
  backup timestamps
  bucket/prefix identity
  verification result
```

Secrets themselves do not belong in the backup manifest committed to evidence.

---

## 12. Restore acceptance

Restore testing occurs only in an isolated destination according to repository/owner backup
rules.

Required proof:

```text
1. restore PostgreSQL backup into isolated test DB
2. restore/copy object set into isolated test bucket/prefix
3. point isolated ASA stack at restored data
4. open at least one historical Blocks project version
5. verify projectJson loads
6. verify every referenced asset byte/digest resolves
7. run player
8. export sb3 and reopen fixture
```

Do not perform a production restore as part of ordinary Visual Programming development.

---

## 13. Backup failure policy

Backup is failed if:

```text
DB capture fails
object mirror fails
manifest generation fails
reference verification finds one missing blob
restored isolated version cannot reopen
```

A warning is not sufficient for missing learner asset data.

---

## 14. Runtime/object dependency degradation

Visual Programming dependencies are not whole-platform liveness dependencies.

States must distinguish:

```text
READY
BLOCKS_RUNTIME_UNAVAILABLE
BLOCKS_STORAGE_UNAVAILABLE
BLOCKS_DEGRADED
```

When Blocks storage/runtime is unavailable:

```text
Electronics/Chess/Checkers/3D/Learning shell remain available
normal ASA account APIs remain available
Blocks new edit/save may be disabled/retryable
existing parent shell shows a clear Blocks-specific state
```

Do not make the entire API return 503 solely because MinIO/S3 is temporarily unreachable
after process startup.

Invalid mandatory deployment configuration may still fail startup fast; a runtime outage
is different from malformed configuration.

---

## 15. Health contract

Keep normal whole-platform liveness/readiness semantics stable.

Add Blocks dependency evidence through a dedicated/internal health field or endpoint that
can represent degradation without redefining unrelated module health.

At minimum operators/tests must be able to distinguish:

```text
Scratch static runtime reachable?
Blocks object store reachable?
Blocks configured bucket reachable?
```

Do not expose object-store secrets or signed credentials in health output.

---

## 16. Sovereign deployment test

M3 candidate must be tested from the **browser/client network point of view**, not only
inside Docker.

With Scratch Foundation hosts blocked/failed:

```text
ASA page loads
runtime iframe loads from configured ASA runtime origin
approved sprite/costume/sound library loads locally
new technical project edits/saves/reloads
existing historical project loads
player runs
assignment immutable version opens
sb3 import/export works
no unexpected external request succeeds or is attempted outside allowlist
```

A browser network log is part of acceptance evidence.

---

## 17. LAN classroom load test

Before activation run a representative shared-NAT/LAN test.

Minimum scenario:

```text
30 concurrent editor sessions
one server/runtime installation
representative small Scratch project per session
project-change/autosave traffic for >= 5 minutes
occasional costume/sound upload
```

Assert:

```text
no false runtime 429 from ordinary load
no lost revision under concurrent users
no cross-project/cross-tenant asset access
API/DB remain responsive within agreed budgets
runtime/object dependency errors are isolated if injected
```

This test validates deployment/rate assumptions that localhost testing cannot.

---

## 18. Activation task VSCR-M4-001

Activation is a separate smallest-possible change.

Expected product change:

```text
BLOCKS_MODULE.manifest.availability
coming_soon → active
```

Plus only directly required wiring/tests/documentation proving that the normal creator can
now select/create `blocks`.

Activation MUST NOT simultaneously add:

```text
new storage implementation
new token model
new library mirroring
new migrations unrelated to availability
backup implementation
new deployment topology
Scratch upstream update
```

If any such work is still needed, activation is premature.

---

## 19. Activation preflight evidence

All items must be green/non-skipped on the release candidate:

```text
M1 durability acceptance
M2 product acceptance
M3 sovereign acceptance
browser save/reload
browser network deny
historical-version restore
viewer write denial
Learning immutable submission
Gallery/remix
30-client LAN/NAT workload
PostgreSQL + object backup/isolated restore
runtime origin/CSP/CORS negative tests
dependency security/license gates
Compose validation
```

Known unrelated repository blockers must be resolved by their own task before a production
activation is accepted; do not waive a high/critical security gate specifically for
Blocks activation.

---

## 20. Post-activation rollback

If a production defect requires stopping new use, prefer changing Blocks availability back
to a non-creatable state while preserving all existing data.

Rollback objectives:

```text
stop new project creation if necessary
preserve drafts/versions
preserve asset aliases/blobs
preserve ability to recover/read existing work where safe
avoid deleting learner data
```

Do not roll back by dropping Blocks tables, deleting object prefixes or resetting the
working database.

---

## 21. Upstream/runtime deployment update

Changing Scratch upstream pin is independent from ASA application deployment.

A runtime image update must pass the master upstream compatibility gates before promotion.

No updater watches Scratch and directly replaces the live container. Automated monitoring
may open a proposal/PR only.

---

## 22. Expected changed paths for deployment slices

A selected deployment/activation task may touch only the needed subset of:

```text
compose*.yaml
infra/scratch-editor/**
apps/api/src/app.factory.ts
apps/api/src/blocks-*.ts
apps/web/src/blocks/**
.env*.example
tools/** only for authorised backup/deployment tooling
tests/blocks/**
e2e/blocks-*.spec.ts
schemas/openapi.yaml when API/health contract changes
docs/product/visual-programming/**
```

No production restart/deploy is implied by committing these files.

---

## 23. Focused deployment/activation acceptance

Must prove before `active`:

```text
1. remote browser receives reachable server runtime origin, not 127.0.0.1
2. HTTP LAN and HTTPS proxy topology rules are tested as applicable
3. mixed-content configuration is rejected/avoided
4. Scratch runtime joins existing Compose project
5. object storage joins same installation or explicit external S3 config
6. runtime container has no DB/object/signing secrets
7. Blocks dependency outage does not take down unrelated modules
8. complete backup includes DB + object set
9. backup verification detects a deliberately missing referenced object
10. isolated restore opens historical project/version assets
11. browser network-deny passes
12. 30-session LAN/NAT workload passes
13. module remains coming_soon until this evidence exists
14. activation diff is narrow and separately reviewable
15. rollback preserves learner project/blob data
```

If one precondition is missing, the correct result is **do not activate**.