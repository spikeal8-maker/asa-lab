# Scratch Classroom Stabilization — specification v1

**Status:** owner-approved architecture/program; implementation is not implied complete  
**Program issue:** #468  
**Capacity target:** #477 / `docs/architecture/CAPACITY_AND_SLO.md`  
**Mixed classroom dependency:** #460  
**Architecture:** `docs/architecture/ADR-VSCR-002-LOCAL-FIRST-CLASSROOM-RUNTIME.md`

## 1. Goal

Make Scratch a local-first browser editor. ASA provides authority and durable persistence,
not ordinary Scratch computation.

```text
open/auth/load
→ Scratch works locally in browser
→ local recovery protects new work
→ remote durable sync at minute scale
→ controlled exit saves immediately
→ short network failure recovers without F5/logout
→ warm static reopen is cache-heavy, not tunnel-heavy
→ CLASS-30
→ platform capacity (#477)
→ mixed Scratch/Electronics acceptance
```

## 2. Evidence baseline

The 25.09–01.10 incident archive and current-code audit established:

- Scratch VM/runtime executes in browsers, not as one server VM.
- The investigated 01.10 lesson window did not show a mass API 5xx collapse.
- Scratch static/resource traffic was approximately 310 MB in that window, with observed
  bursts around 192 requests/s.
- FRP logged 1 264 `work connection pool is full, discarding` events in the same window.
  This proves pressure, not loss of every corresponding HTTP request.
- A separate 30.09 episode contains real `pg-pool` connection timeout failures.
- At the #469 selection baseline, Scratch host source selected 5–8 s remote autosave;
  the #469 source change selects one 55–65 s interval per editor mount.
- Local IndexedDB recovery already exists at a much faster local cadence.
- Controlled `saveBeforeExit()` exists, but pagehide/local-flush semantics require repair.
- StudentSeat transient failure can be reduced to anonymous and generic 401 refresh is not
  identity-owned.
- Capability refresh is fragile after transient failure.
- `/library-assets/**` is already immutable-cacheable; non-versioned core vendor bytes
  revalidate.
- Runtime asset DB work requires profiling for repeated authority/project/metadata operations.

These are repair inputs, not a claim about the exact deployed school revision.

## 3. Invariants

### Local compute

Scratch VM, renderer and editor mechanics run locally. Normal block execution never depends on
a server round-trip.

### Allowed server responsibilities

Bootstrap authority/load, user project assets, durable save, new asset upload, scoped
capability refresh and explicit ASA preview/version/submission/publication.

### Two-level protection

```text
local recovery → fast IndexedDB protection of newest unconfirmed work
remote save    → authoritative ASA durability at minute scale
```

### Save

- no 5–8 s remote save stream;
- later edits cannot postpone checkpoint forever;
- newest pending generation wins;
- one remote save in flight;
- unchanged fingerprint/assets are no-op;
- retry is bounded and conflict/auth/integrity remain explicit.

### Exit

Controlled dirty exit saves immediately and waits. Pagehide first makes local recovery flush
immediate. Forced process close is recovered from local storage; no false remote guarantee.

### Session/runtime

Transient network/5xx != logout. StudentSeat reconnects. Temporary asset/token failure
recovers without mandatory F5 when safe. Loaded VM continues local execution during short
server outage.

### Static delivery

Immutable versioned static bytes should be browser-cache hits on warm reopen. Bootstrap stays
revalidated; private project/API data is never public-cacheable.

### Security

No performance repair weakens tenant/principal/project/capability/revision/integrity/origin
or asset-ownership boundaries.

## 4. Work packages

| Order | Issue | Task | Result |
|---:|---:|---|---|
| 1 | #469 | VSCR-CLASSROOM-01-SAVE-60S | minute remote autosave + fast local recovery |
| 2 | #470 | VSCR-CLASSROOM-02-EXIT-SAFETY | controlled exit + pagehide local flush |
| 3 | #471 | VSCR-CLASSROOM-03-STUDENTSEAT-RESILIENCE | reconnect != logout |
| 4 | #472 | VSCR-CLASSROOM-04-RUNTIME-RECOVERY | asset/token transient recovery |
| 5 | #473 | VSCR-CLASSROOM-05-STATIC-DELIVERY | versioned immutable core static |
| 6 | #474 | VSCR-CLASSROOM-06-DB-PATH | measure/reduce asset DB amplification |
| 7 | #475 | VSCR-CLASSROOM-07-OBSERVABILITY | privacy-safe incident correlation |
| 8 | #476 | VSCR-CLASSROOM-08-CLASS30 | 30 independent Scratch users |
| 9 | #477 | platform capacity | canonical platform capacity acceptance |
| 10 | #460 | mixed classroom | Scratch + Electronics shared acceptance |

Presence here does not activate work. `docs/execution/current.yaml` remains execution authority.

## 5. Electronics relationship

Electronics #459 already owns the minute remote autosave policy for Electronics. Scratch uses
the same product principle through its own storage/recovery path.

Issue #460 owns mixed classroom/FRP/session/save evidence. Scratch first supplies its own
bounded repairs and CLASS-30 evidence; it does not duplicate #460.

## 6. Platform capacity

Scratch does not own or duplicate the platform CCU number. The current platform target,
technical runtime contract and acceptance semantics are defined only by issue #477 and
`docs/architecture/CAPACITY_AND_SLO.md`.

Scratch contributes bounded module evidence: CLASS-30 correctness, local-first execution,
minute-scale durable save, cache-heavy warm reopen, transient-failure recovery and measured
asset/API/DB amplification. It does not introduce a Scratch-specific server topology.

Do not invent CPU/RAM/pool/RPS settings before benchmark.

## 7. Acceptance hierarchy

1. Focused correctness and security per package.
2. CLASS-30: 30 independent StudentSeat contexts, cold/warm open, library use, minute save,
   new media, token rotation, controlled exit, forced-close recovery and fault injection.
3. Platform capacity #477: run the current canonical capacity profile and record RPS/latency,
   save rate, DB pool wait/timeouts, object-store operations, transport pressure, bytes/user,
   retries, logout and project loss.
4. Existing #460 mixed Scratch + Electronics acceptance.

## 8. Non-solutions

Not accepted as a standalone fix: only increasing pg pool, FRP pool, timeouts or hardware;
removing authorization; saving every few seconds “for safety”; telling pupils to press F5;
mapping any network failure to anonymous; live-school destructive load testing.

No deployment, restart, production DB operation or live-school load is authorized here.
