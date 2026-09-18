# ASA Lab Visual Programming — post-M0 readiness and order

**Programme:** `blocks` / `Визуальное программирование`  
**Status:** single Scratch readiness/order source; execution lives only in `docs/execution/current.yaml`.

## Planning principle

Двигаемся по работающим возможностям продукта, а не по количеству внутренних слоёв.

Главные вопросы этапов:

```text
можно ли собрать Scratch воспроизводимо?
можно ли реально открыть/запустить его в ASA?
можно ли аккуратно наложить ASA branding, не ломая Scratch?
может ли ASA-проект сохраняться/открываться?
есть ли recovery/conflict handling?
есть ли безопасная ASA-интеграция .sb3?
можно ли использовать версии в Gallery/Learning?
готовы ли deployment/backup/restore?
```

## Baseline

M0/M0.1 и M1-001 дали Blocks contract/context. M1-002A/C приняты. D и B интегрированы в main; повторная интеграция старой D-ветки не требуется. Исправления B интегрированы, но полная приёмка B/E не объявлена завершённой. Владелец отдельно выбрал VSCR-M4-002: локальный Scratch активен для всех и входит в стандартную установку. Не повторять исправленный #256 и не возвращать coming_soon/preview-скрытие.

Исторический baseline, CI, артефакт и границы прежнего согласования владельца: [датированный review](../../review/VSCR_M1_002B_READINESS_2026-09-15.md). Текущая задача по-прежнему определяется только `current.yaml`.

## Owner-selected local-file deployment exception

[VSCR-M4-002](tasks/VSCR-M4-002.md) supersedes the old all-or-nothing activation
rule for local-file editing. Scratch ships as the `scratch` service of the same
ASA installation; use [SCRATCH_INSTALLATION.md](../../deployment/SCRATCH_INSTALLATION.md).
Do not create a second deployment or choose a new port from this roadmap.
M1 managed-storage/security acceptance below is not automatically completed.

## First bounded step toward ASA persistence

Owner request to start persistence now selects [M1-003A](tasks/VSCR-M1-003A.md):
a non-exposed capability core only. It can be tested without changing the delivered
editor or introducing cookie/API trust. This is not acceptance of B/E or the whole
M1-003. Complete remaining host acceptance before wiring HTTP runtime sessions,
new protected endpoints and deployment. Assets/load-save/autosave retain the order below.
Do not reimplement the already delivered local-file installation while doing this work.

## Owner-selected persistence development, 17.09.2026

[M1-005A](tasks/VSCR-M1-005A.md) develops the save/document/asset coordination in
a Draft branch without waiting for a reviewer provider. PR278 remains unaccepted.
This is an explicit development-only exception to the serial prerequisites below,
not permission to merge or expose unreviewed writes. Preserve D0-002/003 semantics,
existing Project Core and all release/security/storage acceptance requirements.
No further model/provider loop is part of this work.

### Active bounded persistence candidate — M1-005B, 18.09.2026

`docs/execution/current.yaml` selects **VSCR-M1-005B / Issue #287**. The bounded
implementation continues in **Draft PR #288**, branch
`codex/scratch-real-storage-005b`. This is the one active persistence candidate;
do not start a parallel runtime/storage implementation.

The candidate already contains runtime capability/session, Project Core guard,
private S3-compatible storage, PostgreSQL blob/alias metadata, MinIO in the existing
Compose and protected runtime asset/draft API. The browser path is still incomplete:
Parent Web/child Scratch must be wired to the real runtime and prove
`save → close → new session → open` against PostgreSQL + object storage.

This owner-selected development exception permits the selected 005B work despite
the normal serial readiness gates below. It does **not** mark M1-003/M1-004/M1-005
as accepted, merged or production-ready. Before work or claims, fetch the actual
PR #288 HEAD; static SHA text is never execution authority.

## Strict order

```text
M0/M0.1  COMPLETE
M1-001    COMPLETE / OWNER-ACCEPTED

M1-002
  A standalone build
  → STOP
  C parent/iframe security boundary
  → STOP
  D real editor + fixture storage
  → FIRST VISIBLE SCRATCH / STOP
  B preserve Scratch shell + ASA logo/colour/avatar
  → product-shell evidence / STOP
  E integrated acceptance
  → owner acceptance / STOP

M1-003 runtime capability/auth/origin security
M1-004 durable assets + S3/MinIO
M1-005 ASA durable Scratch load/save
M1-006 autosave/recovery/conflicts/snapshot
M1-007 safe ASA .sb3 validation/import/export integration
M1-008 end-to-end M1 acceptance
M2 product UI + Gallery/player/remix + Learning
M3 deployment/backup/restore + optional local/offline alternatives
M4-001 managed-persistence activation acceptance (basic local-file access is M4-002)
```

Order: `A → C → D → B → E`. No automatic progression.

## Checkpoint 1 — First visible Scratch

Reached by accepted C+D:

```text
ASA parent
→ valid INIT
→ isolated real Scratch
→ fixture storage
→ workspace/stage
→ run/stop
→ no fake durable save
```

## Checkpoint 1B — ASA shell without rewriting Scratch

Reached by B:

```text
upstream Scratch remains the editor/runtime
→ Scratch product logo replaced with ASA logo
→ top product bar uses ASA palette
→ ASA avatar/account remains parent-owned
→ D hard-coded locale='en' removed
→ Settings remains native Scratch
→ language selector remains inside Settings
→ browser locale handled by Scratch itself
→ File/Edit remain native Scratch
→ Load/Save to computer remain native Scratch local functions
→ Extensions entry point/catalogue remain native Scratch
→ existing external-service/hardware integrations are not globally removed
→ semantic block/category colours remain unchanged
```

B does **not** add an ASA language system, ASA extension allowlist or replacement File menu.

Core project/asset/editor loading must not secretly depend on Scratch project/asset backend. Explicit external traffic from a user-selected extension is a separate, legitimate dependency of that extension.

## Checkpoint 2 — Durable ASA project

M1-005:

```text
open ASA Scratch project
→ edit
→ save to ASA
→ close/reopen
→ project JSON + referenced assets restored from ASA
```

Native `Save to your computer` may already exist because it is upstream Scratch local export; it is not evidence of ASA durable save.

## Checkpoint 3 — Robust editing

M1-006: autosave/recovery/conflict handling plus automatic draft preview tied to a
confirmed durable revision/checkpoint.

Autosave follows D0-008 and the platform capacity model:

```text
no full snapshot per editor action
→ batch/debounce
→ one save in flight
→ coalesce to newest generation
→ no-op unchanged fingerprint
→ unchanged assets are not uploaded again
→ confirmed durable revision
→ async draft preview update
```

Every accepted Scratch slice runs L0/L1 optimisation evidence; because this lane is
runtime/media-heavy, L2 is mandatory after every 2 accepted bounded slices or earlier
when the repository policy triggers it.

Before M1-006 coding starts, its task card must pin from D0-008:

```text
autosave debounce/cadence + classroom jitter distribution
retry/backoff caps and Retry-After behaviour
structured local-recovery store
finite recovery TTL/quota + logout/account-switch cleanup
save-state UI placement (no permanent bottom bar)
preview capture source, encoded format and derived card dimensions
benchmark fixtures/profile for P0/P2 comparison
```

These values are implementation configuration, but leaving them undefined until coding
is not allowed.

## Checkpoint 4 — Safe ASA .sb3 integration

M1-007 proves bounded ZIP/content validation, compatibility and ASA import/export flows. It does not justify hiding native Scratch local File UI during B.

## Checkpoint 5 — Product integration

M2: project cards + immutable player/publication/remix and Learning submission through
ASA version semantics.

Required card behaviour includes automatic owner-facing draft preview, separate
user-selected publication cover, title, description/instructions, notes/credits,
likes, views and remix count. Autosave never overwrites a manually selected cover.

## Checkpoint 6 — Deployment readiness

M3 proves:

```text
backup/restore
deployment topology
LAN/load evidence
local/right-cleared core media where required
core operation without hidden Scratch Foundation project/asset dependency
clear degradation when an optional external extension's own service/device is unavailable
```

M3 does not globally delete/block native Scratch network-backed or hardware extensions.

## Readiness matrix

| Task           | Readiness                                  | Unlock condition                                                                    |
| -------------- | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `VSCR-M1-001`  | COMPLETE / OWNER-ACCEPTED                  | integrated                                                                          |
| `VSCR-M1-002A` | COMPLETE / ACCEPTED                        | accepted host foundation                                                            |
| `VSCR-M1-002C` | COMPLETE / ACCEPTED                        | accepted security boundary                                                          |
| `VSCR-M1-002D` | IMPLEMENTED / INTEGRATED                   | real editor and fixture path are in main; preserve accepted C/D boundaries          |
| `VSCR-M1-002B` | IMPLEMENTED / ACCEPTANCE PENDING           | integrated repairs; B evidence and acceptance closed before E                       |
| `VSCR-M1-002E` | BLOCKED                                    | A+C+D+B accepted                                                                    |
| `VSCR-M1-003`  | DEVELOPMENT CANDIDATE / ACCEPTANCE PENDING | runtime security candidate is part of PR #288; normal acceptance chain remains open |
| `VSCR-M1-004`  | DEVELOPMENT CANDIDATE / ACCEPTANCE PENDING | durable asset candidate is part of PR #288; not accepted/merged by this label       |
| `VSCR-M1-005`  | IN PROGRESS — `VSCR-M1-005B`               | finish real browser wiring, exact save/open evidence and independent review         |
| `VSCR-M1-006`  | BLOCKED                                    | M1-005                                                                              |
| `VSCR-M1-007`  | BLOCKED                                    | durable project path accepted                                                       |
| `VSCR-M1-008`  | BLOCKED                                    | M1-006 + M1-007                                                                     |
| `VSCR-M2-*`    | BLOCKED                                    | M1-008                                                                              |
| `VSCR-M3-*`    | BLOCKED                                    | M2                                                                                  |
| `VSCR-M4-001`  | BLOCKED                                    | M3 deployment/restore acceptance                                                    |

`BLOCKED` means coding STOP **unless `current.yaml` explicitly selects an owner-authorized bounded exception**. Such an exception permits only the selected task; it never implies prerequisite acceptance.

## Historical D integration rule

D branch predates the latest B product decisions. Never merge stale D documentation over current `main`.

```text
current main docs/specs = authority
+
D implementation/tests = integrate carefully
-
stale D copies of B policy
```

For any recovery of historical D work, preserve current main docs and verify the integrated source first. This rule is not an instruction to re-merge D or restart B from its old branch.

## B execution rule

B is intentionally small:

```text
1. remove forced English locale
2. replace Scratch product logo with ASA logo
3. apply ASA colour only to product chrome
4. add parent-owned ASA avatar/account presentation
5. verify native Settings/File/Edit/Extensions were not accidentally removed or redesigned
6. verify external extension integrations were not blanket-blocked
7. STOP
```

## Task-card refresh rule

Before selecting next slice:

```text
prerequisite accepted
→ inspect actual interfaces
→ compare next card with reality
→ fix stale routing/docs first
→ validate docs
→ select exact task
```

## Stable invariants

```text
Scratch remains Scratch
ASA branding does not justify rebuilding Scratch UI
language selector remains in Scratch Settings
no forced ASA locale in B
File/Edit remain native Scratch
Extensions catalogue and existing external integrations remain
semantic category colours remain upstream
ASA avatar/account remains parent-owned
ASA durable save is separate from native local File export
autosave does not send a full project snapshot on every editor action
unchanged save does not create redundant revision/blob/alias data
automatic draft preview and manual publication cover are distinct
manual publication cover is never overwritten by autosave
canonical Scratch asset bytes are not destructively recompressed for optimisation
Scratch follows repository L0/L1/L2/L3 optimisation policy
core ASA project/assets do not silently rely on Scratch project/asset backend
basic local-file access stays active under owner-selected M4-002
M4-001 remains managed-persistence acceptance, not a reason to hide or redeploy the module
```
