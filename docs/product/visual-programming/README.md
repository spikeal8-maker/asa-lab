# Visual Programming / Scratch — agent router

**Purpose:** minimal-entry documentation for all ASA Lab Scratch/Blocks work.  
**Module:** `blocks` / `Визуальное программирование`  
**Status:** routing document only; never selects work by itself.

## 1. First rule

Active work is selected only through `docs/execution/current.yaml` + explicit owner instruction.
This directory explains **how** to work on Scratch; it does not authorise a task.

For any Scratch change, do **not** read this whole directory. Start here, then use
`COMPONENT_MAP.yaml` to resolve the smallest component scope.

Default read path:

```text
AGENTS.md
→ START_HERE_FOR_AI.md
→ current authorised task
→ this README
→ AGENT_GUIDE.md
→ one matching COMPONENT_MAP.yaml entry
→ only the contract/task/source/test files named by that entry
```

If the component cannot be resolved, expand one dependency hop at a time. Broad repository
scans and reading all Scratch contracts are a last resort, not the default workflow.

## 2. Canonical documents

| Need | Read |
| --- | --- |
| product goal / stable invariants / milestone order | `../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md` |
| token-efficient agent workflow / maintenance rules | `AGENT_GUIDE.md` |
| exact component → source → contract → test routing | `COMPONENT_MAP.yaml` |
| Scratch host / branding / File / Extensions / iframe | `VSCR-D0-001-SCRATCH-HOST-CONTRACT.md` |
| Project Core durability guard | `VSCR-D0-002-PERSISTENCE-CONTRACT.md` |
| asset identity / S3 / MinIO / upload/read | `VSCR-D0-003-ASSET-STORAGE-CONTRACT.md` |
| runtime JWT / origin / CORS / CSP / rate limits | `VSCR-D0-004-RUNTIME-SECURITY-CONTRACT.md` + `VSCR-D0-004A-CURRENT-AUTHORIZATION-RECHECK.md` |
| deployment / backup / activation | `VSCR-D0-005-DEPLOYMENT-ACTIVATION-CONTRACT.md` |
| Gallery publication / player / remix | `VSCR-D0-006-PUBLICATION-REMIX-CONTRACT.md` |
| `.sb3` compatibility / legacy media / ZIP safety | `VSCR-D0-007-SB3-IMPORT-COMPATIBILITY-CONTRACT.md` |
| current post-M0 milestone plan | `VSCR-M1-FORWARD-PLAN-2026-09-11.md` |
| one implementation slice | `tasks/<task-id>.md` when present |

Historical audits/addenda are evidence only. They are not part of the default coding read
path and must never override the canonical documents above.

## 3. Current factual baseline

Integrated M0/M0.1:

```text
moduleKey      blocks
projectType    scratch-3
moduleVersion  0.1.1
availability   coming_soon
project asset  assetId + dataFormat + sha256 + sizeBytes
objectKey      server-only, forbidden in Project Core JSON
Scratch pin    exact reviewed immutable commit from infra/scratch-editor/upstream.env
```

Not yet implemented:

```text
@asa-lab/blocks bounded context
ASA-owned Scratch host
runtime capability API
S3/MinIO asset persistence
durable load/save
autosave/recovery/conflict handling
.sb3 product import/export
Gallery/player/remix
sovereign local media/extensions baseline
activation
```

## 4. Readiness

```text
M0/M0.1     COMPLETE / IN MAIN
M1-001      READY FOR OWNER SELECTION
M1-002      BLOCKED until M1-001 accepted
M1-003      BLOCKED until M1-002 accepted
M1-004P     design work may be selected separately
M1-004      BLOCKED until M1-003 + M1-004P
M1-005P     design work may be selected separately
M1-005      BLOCKED until M1-004 + M1-005P
M1-006      BLOCKED until M1-005
M1-007P     design work may be selected separately
M1-007      BLOCKED until durable M1 storage/load-save + M1-007P
M1-008      BLOCKED until M1-006 + M1-007
M2+         BLOCKED until preceding milestone acceptance and exact task cards
```

`READY` means eligible for owner selection. It never means “start automatically”.
`BLOCKED` means STOP before coding.

## 5. Branding invariant

Canonical product logo source:

```text
apps/web/public/asa-lab-mark.svg
```

Scratch logo must not appear as ASA product chrome. Do not create a second independently
editable ASA logo for the Scratch host. Factual compatibility wording such as
“совместимо с проектами Scratch 3 (.sb3)” is allowed where appropriate.

## 6. Maintenance changes after implementation

For a future small request such as “change a button”, “adjust a label”, “hide an element”:

1. resolve the component ID in `COMPONENT_MAP.yaml`;
2. read only its `contracts`, `sources`, `tests`, and direct dependency entries;
3. do not read unrelated persistence/storage/Gallery/Learning documents;
4. change only the smallest source set;
5. run the component-focused test/gate;
6. perform the bounded self-review from `AGENT_GUIDE.md`;
7. update `COMPONENT_MAP.yaml` if source/test ownership changed.

If the map points to a missing/renamed file or cannot identify the component, STOP and repair
the map before expanding into a broad code search.

## 7. Hard boundaries

```text
no automatic next task
no Scratch logo as product chrome
no Scratch GUI/VM packages in apps/web dependency graph
no scratch-www/account/community/LMS copy
no objectKey in project JSON
no silent last-write-wins
no generic cookie trust for Scratch runtime origin
no public bucket shortcut
no Gallery current-draft shortcut for published Blocks
no cross-tenant JSON-only remix
no activation before durability + sovereign + backup/restore gates
no deploy/restart/live restore without explicit owner instruction
```

## 8. Completion rule for every Scratch task

Every accepted implementation slice must leave the documentation usable for the next agent:

```text
actual source paths recorded in COMPONENT_MAP.yaml
actual focused test/gate recorded
obsolete paths removed
one task only completed
bounded self-review recorded in report
known residual risk stated explicitly
next task not started
```
