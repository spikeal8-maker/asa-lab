# Portable Self-Hosted Deployment Standard

**Document ID:** PORTABLE-DEPLOYMENT-STANDARD  
**Version:** 1.1  
**Status:** canonical  
**Scope:** ASA Lab and future self-hosted projects maintained in this engineering system  
**Issue:** #396

## 0. Normative language

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT** and **MAY** are normative.

- **MUST / MUST NOT** — release/deployment compliance requirement.
- **SHOULD / SHOULD NOT** — default engineering rule; deviation requires a documented reason.
- **MAY** — permitted implementation choice.

This standard describes product/deployment invariants. It does not authorize a live deployment, database restore, destructive migration, network publication or secret rotation.

## 1. Core model

The governing invariant is:

> **Application identity != machine identity != network identity.**

A project is one product even when implemented by many internal services. A supported host, its DHCP address, a Docker container ID and a public domain are deployment properties, not application identity.

Automation means: infer everything that is deterministic; request an external choice only when it cannot be inferred safely; persist that choice as installation state; do not ask for it again on ordinary update.

## 2. Requirements

### DPL-ARCH-001 — Application identity is independent of host and network

**MUST.** Changing a supported host, LAN address, DHCP lease, router, building or network MUST NOT require source-code modification or manual reconfiguration of internal service identities.

### DPL-ARCH-002 — Internal services form one product boundary

**MUST.** Web, API, database, object storage, embedded editors, workers and other project services MUST be operated as components of one installation unless an explicit architecture exception defines a separate product boundary.

### DPL-HOST-001 — Supported hosts are explicit

**MUST.** Every project MUST publish a support matrix for operating systems, CPU architectures, runtime versions, minimum disk/RAM and supported browsers. “Portable” means portable across the declared matrix, not arbitrary computers.

### DPL-AUTO-001 — Automation is deterministic, not guesswork

**MUST.** Install/update tooling MUST automatically resolve deterministic values. When an external decision is required (for example a public domain, tunnel credential or administrator permission), tooling MAY request it once and MUST persist it in installation configuration.

### DPL-NET-001 — Internal service discovery uses stable identities

**MUST.** Intra-stack communication MUST use stable service discovery names or an equivalent service registry. Container/host IP addresses MUST NOT be persisted as identities of internal services.

### DPL-NET-002 — Dynamic host addresses are not application identity

**MUST.** Discovered LAN/VPN/Tailscale addresses MAY be shown as access options but MUST NOT become permanent identity for API, embedded editors, storage or other business/runtime components.

### DPL-NET-003 — External entry belongs to deployment/ingress state

**MUST.** Public domains, LAN entry addresses, reverse proxies and tunnels MUST be modeled at the deployment/ingress boundary. Application modules MUST NOT contain installation-specific domains or IP addresses.

### DPL-NET-004 — Network discovery is classified and verifiable

**MUST.** Automatic address discovery MUST classify loopback, LAN, VPN and virtual adapters; it MUST NOT select the first IPv4 blindly. Ambiguous candidates SHOULD be presented as verified access options rather than silently trusted.

### DPL-NET-005 — Host ports are stable installation state

**MUST.** A selected host port MUST remain stable across restart and update. If it becomes unavailable, the operation MUST block with a clear diagnostic instead of silently choosing another port.

### DPL-NET-006 — Embedded components prefer one browser origin

**SHOULD.** Embedded editors and project modules SHOULD be exposed through the primary application entry (for example /internal/<component>/). A separate origin requires an architecture exception and explicit cross-origin security/testing.

### DPL-SEC-001 — Embedded messaging preserves origin, source and capability checks

**MUST.** iframe/postMessage integrations MUST validate the expected parent/source, exact allowed origin, message schema/protocol and active resource capability/session. Portability MUST NOT be achieved by using wildcard origins or disabling authorization.

### DPL-SEC-002 — Discovery does not grant browser trust

**MUST.** A network address becoming discoverable MUST NOT automatically make it a trusted mutation/origin source. Trust policy and network discovery are separate mechanisms.

### DPL-CFG-001 — Deploy-specific configuration is external and versioned

**MUST.** Hostnames, public URLs, credentials, host ports, provider settings and similar deploy-specific values MUST live outside reusable application code and MUST have an explicit configuration schema version.

### DPL-CFG-002 — Configuration has validation, precedence and migration

**MUST.** Installation tooling MUST define configuration defaults, precedence, validation, unknown/deprecated-key behavior and forward migration between supported configuration schema versions.

### DPL-SEC-003 — Secrets have an independent lifecycle

**MUST.** Secrets MUST be generated/stored separately from ordinary public configuration, MUST survive routine updates, MUST NOT be committed to source control, and MUST have explicit rotation plus protected export/restore semantics.

### DPL-DAT-001 — Persistent data is outside replaceable containers

**MUST.** User/database/object data MUST reside in declared persistent stores. Replacing Web/API/editor/worker containers MUST NOT destroy user data.

### DPL-REL-001 — A release is immutable and machine-identifiable

**MUST.** Each deployable release MUST identify source revision, immutable service artifacts (preferably image digests), database schema expectation and configuration schema version in one release manifest or equivalent immutable record.

### DPL-REL-002 — Running services agree on release identity

**MUST.** Acceptance MUST reject a mixed installation where required services report incompatible release identity or schema expectations.

### DPL-UPD-001 — One canonical operator update path

**MUST.** A project MUST expose one canonical update operation. Routine update MUST NOT require manual editing of source, Compose files or internal service addresses.

### DPL-UPD-002 — Update is a recoverable state machine

**MUST.** Update MUST persist enough state to distinguish preflight, prepared, backed-up, switching, verifying, accepted and failed states. Retry/recovery MUST be idempotent and MUST NOT depend on chat history or operator memory.

### DPL-BAK-001 — Risky update requires a verified backup

**MUST.** Before a migration or switch that can make persisted data incompatible with the previous release, tooling MUST create and verify the required backup before downtime/switch.

### DPL-BAK-002 — Backup covers cross-store consistency and restore

**MUST.** When data spans PostgreSQL, object storage, files or secrets, backup metadata MUST tie the required stores to one recovery set. A backup strategy is incomplete until restore is tested.

### DPL-MIG-001 — Released migrations are immutable and upgrade-tested

**MUST.** Released database migrations MUST NOT be edited in place. Upgrade testing MUST cover supported prior installation histories, not only an empty database. Recovery from an incompatible schema MUST use a defined forward repair or verified backup procedure.

### DPL-MOV-001 — Host migration is a first-class operation

**MUST.** A maintained self-hosted product MUST define export/restore or an equivalent host-migration procedure that preserves persistent data, required secrets and release/install identity without carrying an old DHCP/LAN address as application identity.

### DPL-TST-001 — Health is not product acceptance

**MUST.** Container running state, HTTP 200 and dependency health MUST NOT be reported as full installation/update success when a critical user journey has not been exercised.

### DPL-TST-002 — Each project declares an acceptance manifest

**MUST.** Every self-hosted project MUST identify its critical product journeys and the evidence required for install/update acceptance. ASA Lab includes authentication and persistent project/editor save/reopen journeys.

### DPL-TST-003 — Portability is tested through real entry modes

**MUST.** Where a mode is supported, CI or controlled acceptance MUST cover local entry, LAN/host entry and public/reverse-proxy entry as distinct environments. A loopback-only smoke test MUST NOT be used as proof of LAN/public portability.

### DPL-OPS-001 — One manager owns lifecycle operations

**SHOULD.** A project SHOULD expose one operator surface for install/start/stop/status/doctor/update/backup/restore/export/addresses. Low-level Docker commands remain implementation/debug tools rather than the ordinary owner workflow.

### DPL-EXC-001 — Exceptions are explicit and reviewable

**MUST.** Any intentional deviation from a MUST requirement requires a versioned architecture exception/ADR with scope, reason, risk, compensating controls, owner and verification. Silent exceptions are non-compliant.

## 3. Required acceptance dimensions

A project claiming compliance MUST provide evidence for the applicable dimensions:

- fresh install on each supported host class;
- restart/idempotent start;
- update from supported prior release;
- failed-update recovery;
- backup and verified restore;
- persistent-data survival after replaceable-container recreation;
- stable host ports;
- network/IP change without source edits;
- exact release identity;
- critical product journeys;
- host migration/export-restore where the product is distributed as self-hosted.

## 4. Security boundary

Portability never means trusting arbitrary Host/X-Forwarded-* values, disabling CSRF/origin checks, using postMessage targetOrigin="*", exposing databases/object stores publicly, or regenerating secrets on every install/update.

Network discovery answers “where might this installation be reachable?”. Security policy answers “which requests/origins are trusted?”. They MUST remain separate.

## 5. Future-project adoption

A new self-hosted project MUST adopt this standard before production readiness. It MAY implement the lifecycle manager differently from ASA Lab, but its externally visible contract and evidence MUST satisfy the applicable requirement IDs above.

The compact machine-readable source for agents and validators is:

- docs/agent/contracts/deployment.yaml

The ASA-specific convergence plan is:

- docs/execution/PORTABLE_DEPLOYMENT_IMPLEMENTATION_PLAN.md
