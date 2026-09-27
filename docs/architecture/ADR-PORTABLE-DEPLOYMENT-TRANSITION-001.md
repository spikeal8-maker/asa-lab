# ADR-PORTABLE-DEPLOYMENT-TRANSITION-001 — ASA Lab transition to the portable deployment standard

**Status:** ACTIVE TRANSITION EXCEPTION  
**Revision:** 1.2\
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

**Verification**

- `tools/docker-update.ps1` (`Assert-EmbeddedEntryConfiguration`) requires `-EntryOrigin` or `ASA_UPDATE_ENTRY_ORIGIN` and compares it with both saved Blocks origins before the backup/switch path; `tools/docker-update.sh` (`assert_embedded_entry_configuration`) applies the same explicit check on Linux.
- Both guarded updaters check `/internal/blocks/` through that entry after switching. `tools/deployment/editor-entry-check.mjs` checks exact origin equality. These are source-level checks of the current guard, not evidence that automatic entry persistence exists or that an update was run for this ADR.

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

**Verification**

- `tools/asa_manager.py:first_environment` writes loopback `ASA_BLOCKS_PARENT_ORIGIN`, `ASA_BLOCKS_RUNTIME_ORIGIN` and `ASA_UPDATE_ENTRY_ORIGIN`; `apps/api/src/blocks-runtime-config.ts` requires the saved runtime origin. This verifies the coupling that remains open.
- `docker/web/Caddyfile` routes `/internal/blocks/*` inside the primary Web entry; `apps/web/src/blocks/BlocksEditor.tsx` derives its browser origin from `window.location.origin` and rejects a session whose `runtimeOrigin` differs. The existing exact-origin updater checks above are compensating guards, not proof of portability after a host move.

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

**Verification**

- `tools/asa_manager.py` currently exposes `doctor/configure/install/check/update/backup/verify-backup/restore-check/acknowledge`; it has no `addresses` action or classified adapter selection. `tools/docker-update.ps1` and `tools/docker-update.sh` require an explicit entry origin and block mismatches.
- This source inspection verifies the present gap and explicit guard only. Classified loopback/LAN/VPN/virtual-adapter discovery and second-host access remain unverified until P2/P6.

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

**Verification**

- `tools/blocks/portable-smoke.mjs` fixes `origin` to `http://127.0.0.1:4610` and exercises the Scratch edit/save/fresh-reopen journey through that origin. Its configured address limits what that smoke can prove.
- The P0 source review found no second-host LAN or public/reverse-proxy run in this exception's evidence. Those acceptance results are `NOT_RUN` for this ADR; a green loopback smoke cannot close EX-04.

**Closure**

P6 adds acceptance for every supported entry mode and ties compliance claims to those results.

### EX-05 — DPL-NET-003 / DPL-CFG-001 / DPL-EXC-001: class-join entry acceptance pending

**Source-level transition**

The P0 baseline fixed the printable class-join QR and site label to `https://asa-lab.ru`. The P1-C1 source derives the QR destination and printed host label from the current portal browser origin, accepts only a canonical HTTP(S) origin, and disables printing when no valid entry exists. The installed ASA entry and previously printed cards are not changed by this source-level repair.

**Reason for keeping the exception open**

The source change does not prove that a second device can use a printed card through an approved LAN/public ingress. It also does not validate print/scan behavior or authorize a production deployment.

**Risk**

Until real entry-mode acceptance, a card printed from an unintended or unreachable entry could still direct a student to an unusable address. The deployment/ingress profile must establish the approved reachable entry; browser URL generation alone does not establish that trust or availability.

**Compensating controls**

- The QR URL contains the class code but not the student code. The class-join page asks for the student code separately, and the API validates both codes before StudentSeat sign-in.
- The QR URL is a navigation target only. It is not a browser-trust allowlist or authorization source; this exception does not permit using it as either.
- Invalid/non-HTTP(S) browser origins produce no QR and disable printing rather than substituting an installation-specific fallback.
- Full-compliance and LAN/public portability claims remain blocked while this gap is open.

**Verification**

- `apps/web/src/components/StudentAccessCards.tsx`: `portalEntry`, `classJoinUrl`, `data-qr-url` and `ClassJoinQr` show the browser-entry target and absence of a student code in that URL.
- `apps/web/src/pages/JoinClassPage.tsx` and `apps/api/src/classroom-join.controller.ts`: class-code resolution is followed by a separate student-code sign-in that validates both codes.
- `apps/web/src/components/testing/student-access-cards.spec.ts`: local, LAN and public URL generation plus invalid-origin rejection are source-level regression tests, not second-device evidence.
- `e2e/access-a.spec.ts`: the browser assertion requires the exact current portal origin and no student code in the QR; it checks 1440/1024/390/320 layouts in isolated CI, not a real LAN/public installation.
- `docs/execution/PORTABLE_DEPLOYMENT_IMPLEMENTATION_PLAN.md` records the fixed-origin gap at the P0 baseline and assigns its removal to P1.
- Second-device LAN/public card print/scan and sign-in acceptance: **NOT_RUN**. EX-05 remains **OPEN**.

**Closure**

EX-05 may close only after a supported approved LAN/public entry is exercised from a second device with a printed/scanned card, exact destination and separate Student Code sign-in, while browser-origin and authorization checks remain intact. A local deep link, generated URL or isolated browser test alone does not close it.

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
