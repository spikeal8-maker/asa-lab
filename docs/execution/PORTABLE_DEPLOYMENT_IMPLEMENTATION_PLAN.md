# ASA Lab Portable Deployment Implementation Plan

**Issue:** #396  
**Branch for Slice 1:** architecture/portable-deployment-standard-396  
**Canonical standard:** docs/architecture/PORTABLE_SELF_HOSTED_DEPLOYMENT_STANDARD.md  
**Compact contract:** docs/agent/contracts/deployment.yaml

## 1. Purpose

Converge ASA Lab on the portable self-hosted deployment standard without turning the standard itself into a hidden mega-refactor.

The work is split into bounded slices. Slice 1 changes documentation/governance only. Runtime, database, live Docker and school PCS remain untouched.

## 2. Verified baseline at Slice 1 start

Baseline main: `8a661ece9535ca045719c42005765f725233703e`.

Already aligned:

- Docker Compose uses named services such as `api`, `postgres`, `minio` and `scratch`.
- Caddy exposes embedded Scratch through the ASA entry under `/internal/blocks/`.
- `BlocksEditor.tsx` derives the browser-side runtime origin from `window.location.origin`.
- ASA already has a portable manager, backup/restore tooling, document registry and governance gate that can host compliance enforcement.

Confirmed gaps/debt:

1. `tools/asa_manager.py:first_environment` persists `127.0.0.1:4610` into Blocks/update origin settings.
2. `tools/docker-update.ps1` still requires an operator-supplied exact EntryOrigin and requires saved Blocks origins to equal it.
3. `apps/api/src/blocks-runtime-config.ts` issues runtime sessions from a persisted `ASA_BLOCKS_RUNTIME_ORIGIN`.
4. Base `compose.yaml` publishes Web only on `127.0.0.1` by default; LAN publication is not a first-class automatic profile.
5. `apps/web/src/components/StudentAccessCards.tsx` contains the fixed public origin `https://asa-lab.ru`.
6. `tools/blocks/portable-smoke.mjs` proves the editor journey through `127.0.0.1:4610`, not through a real LAN/public entry.

Items requiring dedicated audit before claiming compliance:

- configuration schema/version migration;
- immutable release artifact/digest coverage across every service;
- cross-store PostgreSQL/MinIO/secrets recovery consistency;
- support matrix and host adapters;
- host export/restore acceptance;
- update-state recovery semantics against the full standard;
- browser secure-context behavior for supported LAN mode.

## 3. Delivery phases

### P0 — Canonical standard and enforcement

Deliverables:

- canonical standard with stable requirement IDs and MUST/SHOULD/MAY;
- compact machine contract;
- Document Registry routing;
- permanent agent-entry routing;
- governance validator + tests;
- this implementation plan.

Acceptance: governance gate fails if the standard, machine contract, routing or requirement-ID parity drifts.

### P1 — Dynamic entry/origin convergence

Goal: application modules do not persist a DHCP/LAN IP as their identity.

Work:

- define request/session-derived browser entry model;
- preserve postMessage source/origin/capability checks;
- remove fixed Blocks runtime identity where it represents the host entry rather than a real separate origin;
- align API mutation-origin policy with approved installation/public entries without trusting arbitrary Host headers;
- remove fixed public domain from reusable StudentAccessCards behavior.

Required evidence:

- local entry works;
- LAN entry works from a second browser host;
- foreign origin is rejected;
- login -> open Scratch -> edit -> save -> reopen succeeds.

### P2 — Host profiles and network discovery

Introduce explicit installation profiles:

- local;
- lan;
- public.

Work:

- enumerate/classify host adapters;
- verify candidate addresses;
- expose `manager addresses`;
- make host bind/profile explicit and persistent;
- keep selected host ports stable;
- never silently switch ports or trusted origins.

### P3 — Configuration and secrets lifecycle

Work:

- version installation configuration;
- define precedence/defaults/unknown-key behavior;
- add forward config migrations;
- separate public configuration from secrets;
- preserve secret identity across update;
- define protected export/rotation.

### P4 — Release and update convergence

Work:

- audit release manifest against REL-001/REL-002;
- pin immutable artifact identity for all required services;
- make update phases explicit/recoverable;
- prove retry after interruption;
- prevent mixed release identity;
- retain previous release/recovery evidence where safe.

### P5 — Data portability

Work:

- define one recovery-set manifest for PostgreSQL + object storage + required secrets;
- verify checksums/inventory;
- test restore;
- implement/export host migration path;
- prove restore on a different supported host/network without carrying old dynamic IP identity.

### P6 — Product acceptance and compliance

Work:

- define ASA acceptance manifest;
- add local/LAN/public portability journeys for supported modes;
- add static/runtime checks for installation-specific address leakage;
- classify legitimate localhost/test/docs usages instead of naive grep;
- make release/install/update claims depend on applicable acceptance.

### P7 — Reusable project bootstrap

Extract a reusable blueprint for future self-hosted projects:

- standard manager command contract;
- release manifest schema;
- configuration schema pattern;
- backup/recovery-set manifest;
- compliance validator starter;
- CI acceptance template.

A future project adopts the standard rather than cloning ASA-specific IP/domain assumptions.

## 4. Slice rules

- One phase/slice at a time.
- No live deployment is implied by merging documentation/tooling.
- Database and object-store changes require separate evidence.
- Security checks are replaced only by equivalent or stronger controls; portability never means disabling origin/capability/CSRF protections.
- Existing working installation remains the fallback until an exact candidate passes its required acceptance.
