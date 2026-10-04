# ADR-VSCR-002 — Local-first Scratch classroom runtime

**Status:** accepted owner architecture, 2026-10-03  
**Module:** `blocks`  
**Program:** issue #468  
**Capacity:** C3000 / S4500 / T5000, issue #477

## Context

Scratch GUI/VM is browser software. ASA integrates it with identity, Project Core, durable
storage, Learning and publication. Classroom logs showed that the current integration can
create unnecessary network/server pressure: rapid remote autosave, repeated runtime/static
traffic, fragile transient-failure handling and expensive asset authority/data paths.

The architectural mistake to avoid is treating Scratch as if normal program execution were a
server workload. It is not.

## Decision 1 — Scratch execution is local

After bootstrap, Scratch VM execution, block scheduling, variables/lists, sprite state,
renderer, paint/sound mechanics and ordinary run/stop execute in the student's browser.

ASA API/PostgreSQL/object storage/FRP are not in the execution loop. A transient server outage
must not stop an already loaded Scratch program merely because the server is temporarily
unavailable.

## Decision 2 — server contact is allow-listed

Normal server contact exists only for:

```text
initial identity/project authorization
initial project document load
user-project asset load not already local
durable remote checkpoint/save
upload of new/changed project assets
scoped runtime capability refresh
explicit ASA preview/version/submission/publication flows
```

Remote polling or a server request for each editor/VM action is not normal architecture.

## Decision 3 — local safety and remote durability are separate

Fast local recovery uses origin-scoped structured browser storage such as IndexedDB. Remote
durable save is authoritative ASA persistence. Local recovery is not a second server backend.

No runtime capability, cookie, password or object-store credential may be persisted inside
recovery records.

## Decision 4 — minute-scale remote autosave

The current 5–8 s remote save cadence is superseded.

```text
dirty generation
→ fast local recovery
→ bounded minute-scale remote checkpoint
→ newest generation only
→ one remote save in flight
→ confirmed server revision
```

Later edits must not cause debounce starvation. CLASS-30/C3000 load shaping may distribute
client phases/retries, but may not lose newest work or silently extend dirty work indefinitely.

## Decision 5 — exit semantics

Controlled ASA navigation away from a dirty editor performs an immediate durable save and
waits for its result before normal navigation.

Browser/process termination cannot guarantee arbitrary network I/O. Therefore
`visibilitychange/pagehide` must make local recovery immediately flushable before teardown.
Forced close/crash is recovered on reopen, then reconciled with server revision.

## Decision 6 — transient failure is recoverable

Retryable network/5xx failures use bounded retry/backoff and retain only newest pending work.
Authorization/revocation/integrity/conflict failures are not blindly retried.

A single transient asset or capability-refresh failure must not require F5 of the whole ASA
page. An already loaded VM remains local while remote recovery is attempted.

## Decision 7 — StudentSeat identity is independent of Account refresh

Temporary network/API failure is not logout. StudentSeat state distinguishes authenticated,
reconnecting and definitively invalid. Account refresh cannot be selected merely because a
StudentSeat used a generic `/api/projects/**` path.

## Decision 8 — immutable static delivery

Pinned/versioned Scratch vendor bytes and stock library bytes are static public artifacts.
Once a browser has a specific immutable version, warm reopen should use browser cache without
FRP revalidation where safe.

Entry/bootstrap documents remain revalidated. Private project/API responses are never made
public-cacheable. The same public ASA entry remains; no second Scratch site is required.

## Decision 9 — proportional asset/data path

Asset requests keep required current scoped authorization, but repeated equivalent authority
reconstruction and unnecessary full-project work inside one request are performance defects.
Optimization is measurement-led and remains fail-closed.

## Decision 10 — capacity

Scratch correctness is first proven with 30 independent users. ASA Lab must then satisfy
C3000 = 3 000 simultaneous active users as the normal design/production target. S4500 is surge and T5000 is the stress ceiling; none of these profiles count idle tabs as active work.

No production-school load test is authorized by this ADR.

## Decision 11 — evidence before tuning

Do not treat increasing pg pool, FRP poolCount, timeouts or hardware as a fix without
measurement. Do not remove authorization for speed. Measure amplification first, repair it,
then size infrastructure.

## Consequence

```text
open project → bootstrap/download
work locally → no server compute loop
local recovery → frequent and local
remote save → minute-scale
controlled exit → immediate durable save
temporary outage → reconnect/recover, not logout/F5
warm reopen → browser cache
classroom → CLASS-30 evidence
platform → C3000/S4500/T5000 evidence
```

Implementation is split by
`docs/product/visual-programming/SCRATCH_CLASSROOM_STABILIZATION_SPEC_V1.md`.
