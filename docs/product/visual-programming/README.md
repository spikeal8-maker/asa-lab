# Visual Programming / Scratch — agent router

**Purpose:** minimal entry point for ASA Lab `blocks` / `Визуальное программирование`.  
**Authority:** routing only; it never selects work.

Active execution state comes only from `docs/execution/current.yaml`. An owner instruction may authorise selecting/updating that state, but it does not bypass the control plane. Do not read this whole directory for a Scratch change.

## 1. Choose the work profile

### Milestone implementation

```text
AGENTS.md / START_HERE_FOR_AI.md
→ authorised VSCR task selected in current.yaml with task.status = in_progress
→ Master required sections + ADR as required by global entry flow
→ this router
→ exact tasks/<task>.md
→ COMPONENT_MAP.yaml
→ only referenced subsystem-card entries
→ only mapped contract/source/test files
```

### Bounded maintenance after implementation

For a request such as “change a button”, “rename a label”, “hide an element”:

```text
current.yaml selects the bounded maintenance task/scope with task.status = in_progress
→ this router
→ COMPONENT_MAP.yaml keywords/component ID
→ exactly one referenced components/*.yaml card
→ only that component entry
→ mapped contract section + source + focused test
→ bounded self-review
```

Do not load the roadmap, all D0 contracts, all subsystem cards or unrelated ASA modules by
default. Expand one dependency hop only when a concrete unresolved dependency requires it.

## 2. Canonical documents

| Need | Canonical source |
| --- | --- |
| stable product goal / invariants / milestone order | `../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md` |
| stable architecture decision | `../../architecture/ADR-VSCR-001-SCRATCH-EDITOR-INTEGRATION.md` |
| token-efficient workflow / risk / self-review | `AGENT_GUIDE.md` |
| human request/component ID → subsystem card | `COMPONENT_MAP.yaml` |
| readiness/order | `VSCR-M1-FORWARD-PLAN-2026-09-11.md` |
| one selected implementation slice | `tasks/<task-id>.md` |
| host / branding / controls / iframe / fixture storage | `VSCR-D0-001-SCRATCH-HOST-CONTRACT.md` |
| Project Core durability | `VSCR-D0-002-PERSISTENCE-CONTRACT.md` |
| asset identity / S3 / MinIO / asset API | `VSCR-D0-003-ASSET-STORAGE-CONTRACT.md` |
| runtime capability / current authority / Origin/CORS/CSP | `VSCR-D0-004-RUNTIME-SECURITY-CONTRACT.md` |
| deployment / backup / activation | `VSCR-D0-005-DEPLOYMENT-ACTIVATION-CONTRACT.md` |
| immutable Gallery publication/player/remix | `VSCR-D0-006-PUBLICATION-REMIX-CONTRACT.md` |
| `.sb3` compatibility / ZIP safety | `VSCR-D0-007-SB3-IMPORT-COMPATIBILITY-CONTRACT.md` |

Git history is evidence/history, not an alternative active specification.

## 3. Component routing

`COMPONENT_MAP.yaml` is intentionally only a compact lookup index:

```text
human keywords / stable component ID
→ one components/*.yaml card
```

The subsystem card alone owns:

```text
implementation state
risk
ownership class
canonical contract section
actual source/test ownership when implemented
direct dependencies
```

Cards:

```text
components/module.yaml
components/host.yaml
components/runtime.yaml
components/assets.yaml
components/project.yaml
components/sb3.yaml
components/gallery-learning.yaml
components/sovereign-deployment.yaml
```

Never load all cards for one local change.

## 4. Ownership classes

Every component declares one ownership class so an agent knows how freely it may change the
surface:

```text
asa               ASA-owned code/config; change inside selected scope
infrastructure    ASA deployment/build ownership
upstream_config   use supported upstream configuration surface; avoid source patch
upstream_patch    only the exact reviewed compatibility patch is allowed
cross_boundary    touches multiple ASA boundaries; high-risk review required
shared_existing   reuse an existing ASA subsystem; do not create a Scratch copy
```

An upstream-owned control that is not already mapped to `upstream_config` or an accepted
`upstream_patch` is not “just another button”. STOP and review the integration boundary
before editing upstream Scratch source.

## 5. Current factual baseline

Integrated today:

```text
moduleKey      blocks
projectType    scratch-3
moduleVersion  0.1.1
availability   coming_soon
asset ref      assetId + dataFormat + sha256 + sizeBytes
objectKey      server-only, forbidden in Project Core JSON
Scratch pin    exact reviewed commit in infra/scratch-editor/upstream.env
```

The implementation state/readiness of future work is **not repeated here**. Read only
`VSCR-M1-FORWARD-PLAN-2026-09-11.md` when the question is “what comes next?”.

## 6. Branding invariant

Canonical ASA product mark:

```text
apps/web/public/asa-lab-mark.svg
```

Scratch product logo/navigation is not ASA product chrome. Do not maintain a second
independently editable ASA logo for the runtime host. Factual compatibility wording such as
“совместимо с проектами Scratch 3 (.sb3)” is permitted where appropriate.

## 7. Maintenance workflow

For a future local change:

```text
1. verify current.yaml selects the exact bounded maintenance task/scope with task.status = in_progress
2. resolve the component ID by exact ID or COMPONENT_MAP keywords
3. open one subsystem card and one component entry
4. inspect its ownership/risk/contracts/sources/tests
5. state exact expected write paths before editing
6. change only the smallest coherent source set
7. run mapped focused evidence
8. run node tools/validate-blocks-docs.mjs
9. perform bounded self-review from AGENT_GUIDE.md
10. update the same subsystem card if real source/test ownership changed
11. STOP
```

If a mapped implemented source/test disappears or is renamed, repair routing before doing a
broad repository search.

## 8. Hard boundaries

```text
no automatic next task
no parallel scratch module/account/LMS/project backend
no Scratch GUI/VM dependency in apps/web
no objectKey in project JSON
no silent last-write-wins
no generic cookie trust for Scratch runtime origin
no public object-store shortcut
no Gallery current-draft shortcut for published Blocks
no JSON-only cross-tenant remix
no activation before durability + sovereign + backup/restore acceptance
no deploy/restart/live restore without explicit owner instruction
```

## 9. Documentation completion rule

A Scratch implementation slice is not complete until routing still works for the next agent:

```text
implemented component card points to exact actual source paths and focused tests
obsolete planned paths removed
ownership/risk still correct
new stable component ID added only when a genuinely new concern exists
node tools/validate-blocks-docs.mjs passes
bounded self-review records residual risk
next slice not started
```
