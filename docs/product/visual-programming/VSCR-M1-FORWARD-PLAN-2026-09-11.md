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

M0/M0.1 и M1-001 дали Blocks contract/context. M1-002A/C приняты. D реализован отдельно и проходит owner acceptance/integration. `blocks` остаётся `coming_soon`.

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
M4-001 explicit activation
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

M1-006: autosave/recovery/conflict handling.

## Checkpoint 4 — Safe ASA .sb3 integration

M1-007 proves bounded ZIP/content validation, compatibility and ASA import/export flows. It does not justify hiding native Scratch local File UI during B.

## Checkpoint 5 — Product integration

M2: immutable player/publication/remix and Learning submission through ASA version semantics.

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

| Task           | Readiness                  | Unlock condition                                                  |
| -------------- | -------------------------- | ----------------------------------------------------------------- |
| `VSCR-M1-001`  | COMPLETE / OWNER-ACCEPTED  | integrated                                                        |
| `VSCR-M1-002A` | COMPLETE / ACCEPTED        | accepted host foundation                                          |
| `VSCR-M1-002C` | COMPLETE / ACCEPTED        | accepted security boundary                                        |
| `VSCR-M1-002D` | IMPLEMENTED / OWNER REVIEW | integrate exact D implementation without overwriting newer B docs |
| `VSCR-M1-002B` | BLOCKED                    | D owner-accepted + integrated; B card selected separately         |
| `VSCR-M1-002E` | BLOCKED                    | A+C+D+B accepted                                                  |
| `VSCR-M1-003`  | BLOCKED                    | E + owner acceptance of M1-002                                    |
| `VSCR-M1-004`  | BLOCKED                    | M1-003                                                            |
| `VSCR-M1-005`  | BLOCKED                    | M1-004                                                            |
| `VSCR-M1-006`  | BLOCKED                    | M1-005                                                            |
| `VSCR-M1-007`  | BLOCKED                    | durable project path accepted                                     |
| `VSCR-M1-008`  | BLOCKED                    | M1-006 + M1-007                                                   |
| `VSCR-M2-*`    | BLOCKED                    | M1-008                                                            |
| `VSCR-M3-*`    | BLOCKED                    | M2                                                                |
| `VSCR-M4-001`  | BLOCKED                    | M3 deployment/restore acceptance                                  |

`BLOCKED` means coding STOP.

## D integration rule

D branch predates the latest B product decisions. Never merge stale D documentation over current `main`.

```text
current main docs/specs = authority
+
D implementation/tests = integrate carefully
-
stale D copies of B policy
```

After D integration update `current.yaml`, `components/host.yaml` and runtime README to actual integrated state before selecting B.

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
core ASA project/assets do not silently rely on Scratch project/asset backend
only M4-001 activates blocks
```
