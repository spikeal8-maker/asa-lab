# ADR-PORTABLE-DEPLOYMENT-TRANSITION-001 — ASA Lab transition to the portable deployment standard

**Status:** ACTIVE TRANSITION EXCEPTION  
**Revision:** 1.0  
**Scope:** ASA Lab current self-hosted installation/update architecture only  
**Standard:** docs/architecture/PORTABLE_SELF_HOSTED_DEPLOYMENT_STANDARD.md v1.1  
**Owner:** ASA Lab repository owner  
**Tracking:** Issue #396  
**FULL_COMPLIANCE_CLAIM:** BLOCKED  
**COMPLIANCE_STATUS:** TRANSITIONAL_NON_COMPLIANT

## 1. Decision

The portable deployment standard is canonical immediately, but ASA Lab is **not yet fully compliant** with every MUST requirement.

This ADR is the versioned exception required by DPL-EXC-001 for the known P0 baseline gaps below. It is a temporary compatibility/safety bridge, not permission to add new installation-specific IP/domain coupling.

Until every open exception below is closed with evidence:

- ASA Lab MUST NOT claim full Portable Deployment Standard compliance;
- loopback-only evidence MUST NOT be presented as proof of LAN/public portability;
- existing fail-closed update/origin guards remain in force;
- P1/P2/P6 implementation proceeds only as separate bounded slices.

A newly discovered MUST deviation is not implicitly covered by this ADR. It must be added here (or to a new versioned exception) before any compliance/release claim that depends on it.

## 2. Open exceptions

### EX-01 — DPL-AUTO-001: EntryOrigin is still supplied for update

**Current behavior**

The guarded updater currently requires the operator to provide the actual ASA entry origin for the update path instead of persisting/reusing that external choice automatically on ordinary updates.

**Reason**

The dynamic/persisted entry model has not yet converged. Removing the explicit value now would weaken the existing fail-closed guard before the replacement model exists.

**Risk**

Manual re-entry is non-portable and can be mistyped or become stale after a network move.

**Compensating controls**

- update preflight requires one exact entry origin;
- that origin must match the configured ASA Blocks parent/runtime origin before backup/switch;
- the updater verifies the unified ASA/Scratch entry after start;
- no second Scratch public endpoint or fallback wildcard origin is allowed.

**Closure**

P1/P2 must replace repeat manual entry with a persisted/discovered installation entry model while preserving exact browser-origin/security checks.

### EX-02 — DPL-NET-002 / DPL-NET-003: host entry is still persisted into Blocks runtime configuration

**Current behavior**

The first environment writes a loopback ASA entry into Blocks/update origin settings, and the API runtime-session configuration still relies on a persisted `ASA_BLOCKS_RUNTIME_ORIGIN`.

**Reason**

Browser-side Scratch embedding has already converged on the current ASA origin, but the server/session and installation layers have not yet converged on a request/session-derived entry model.

**Risk**

A host/network move can leave persisted runtime origin state coupled to the previous machine/network entry.

**Compensating controls**

- Scratch remains behind the primary ASA Web entry at `/internal/blocks/`;
- postMessage source/origin/capability checks remain exact;
- the updater blocks entry-origin mismatch instead of silently accepting it;
- no wildcard origin or arbitrary Host-header trust is introduced.

**Closure**

P1 must remove host/DHCP entry as persistent module identity and prove local + LAN behavior with foreign-origin rejection.

### EX-03 — DPL-NET-004: automatic network discovery is not yet a supported installation capability

**Current behavior**

ASA does not yet classify/verify host adapters and automatically present stable local/LAN/public profiles.

**Reason**

Network discovery/profile selection is intentionally deferred to P2 so P0 does not become a runtime refactor.

**Risk**

Operators cannot yet rely on one automatic address-discovery workflow when moving the installation to another network.

**Compensating controls**

- no “automatic LAN portability” claim is allowed;
- current update paths fail closed on explicit mismatches;
- host ports are not silently reallocated as a workaround.

**Closure**

P2 implements classified adapter discovery, verified candidate addresses and persistent local/LAN/public installation profiles.

### EX-04 — DPL-TST-003: portability evidence is still loopback-biased

**Current behavior**

The current portable Scratch smoke proves the journey through `127.0.0.1:4610`; it does not by itself prove a second-host LAN entry or public/reverse-proxy entry.

**Reason**

Real-entry acceptance is deferred to the dedicated portability acceptance phase.

**Risk**

A green loopback smoke could be mistaken for proof that a moved/LAN/public installation works.

**Compensating controls**

- loopback smoke is explicitly classified as loopback evidence only;
- full LAN/public portability MUST NOT be claimed from it;
- existing browser/security checks remain required.

**Closure**

P6 adds acceptance for every supported entry mode and ties compliance claims to those results.

## 3. Known gaps that are not silently classified

The P0 implementation plan lists additional areas that require audit before compliance can be claimed (configuration schema/versioning, immutable artifact coverage, cross-store recovery consistency, host support matrix, host migration, update recovery and secure-context behavior).

Those are **not automatically waived** by this ADR. If audit proves a MUST deviation, it must be added to a versioned exception before a compliance claim.

## 4. Update instruction during the exception

The current AGENTS.md requirement to provide `-EntryOrigin` / `ASA_UPDATE_ENTRY_ORIGIN` before a guarded update is a **temporary DPL-AUTO-001 compensating control**.

It MUST remain until the P1/P2 replacement has exact-head evidence and this exception is revised/closed. It MUST NOT be documented as the target portable behavior.

## 5. Exit criteria

This exception can be retired only when:

1. every EX-* item is CLOSED with exact evidence;
2. the implementation plan records the responsible completed phase;
3. the portable deployment validator and repository CI pass on the closing HEAD;
4. the applicable local/LAN/public product acceptance is complete;
5. no replacement MUST deviation remains undocumented.

Closing the ADR does not itself authorize deployment.
