# Public Projects — execution router

**Документационный статус:** `IMPLEMENTATION-READY / EXECUTION NOT ACTIVATED`.

Этот каталог не хранит и не подменяет активное execution state. Активная задача определяется только `docs/execution/current.yaml` согласно `AGENTS.md`.

---

## 1. Читать сначала

1. `PROJECTS_EXECUTION_READINESS.md` — что считается готовым после каждого accepted slice и полный dependency graph.
2. `../ASA_PROJECTS_IMPLEMENTATION_TZ.md` — canonical TARGET/execution contract.
3. `DECISION_LEDGER.md` — resolved и slice-specific unresolved decisions.
4. `../ASA_PROJECTS_CURRENT_ARCHITECTURE_AUDIT.md` + latest `PROJ-A0-DELTA-*.md` — фактический AS-IS.
5. `IMPLEMENTATION_SPEC_ERRATA.md` — обязательная коррекция stale AS-IS assertions глубокой Implementation Spec.
6. Active task card из `tasks/`.
7. Только нужные sections `../ASA_PROJECTS_IMPLEMENTATION_SPEC.md` и `../ASA_PROJECTS_UI_UX_SPEC.md`.
8. `../../delivery/REPOSITORY_HYGIENE_AND_OPTIMIZATION_POLICY.md` + `../../review/HYGIENE_AUDIT_TEMPLATE.md`.

При конфликте AS-IS утверждений фактический current code + Current Architecture Audit + latest delta + errata имеют приоритет над старым описательным текстом Implementation Spec. TARGET/acceptance определяет executable TZ + active task card.

---

## 2. Готовые task cards

| Slice | Статус документации | Card | Activation gate |
|---|---|---|---|
| PROJ-A0 Current Architecture Audit | DONE + DELTA VERIFIED | audit docs | refresh if relevant current main changed |
| PROJ-R7-01 Publication Foundation | PREPARED / BLOCKED | `tasks/PROJ-R7-01.md` | R3 accepted + owner/control-plane transition |
| PROJ-R7-02 Public Project Page | PREPARED / NOT ACTIVATED | `tasks/PROJ-R7-02.md` | R7-01 accepted + route decision |
| PROJ-R7-03 Public Artifact Contract | PREPARED / NOT ACTIVATED | `tasks/PROJ-R7-03.md` | R7-01 accepted + explicit transition |
| PROJ-R7-04A 3D Viewer | PREPARED / NOT ACTIVATED | `tasks/PROJ-R7-04A-3D.md` | R7-03 + stable 3D boundary |
| PROJ-R7-04B Electronics Viewer | PREPARED / NOT ACTIVATED | `tasks/PROJ-R7-04B-ELECTRONICS.md` | R7-03 + safe Electronics boundary |
| PROJ-R7-04C Blocks Viewer | PREPARED / NOT ACTIVATED | `tasks/PROJ-R7-04C-BLOCKS.md` | R7-03 + safe Blocks runtime boundary |
| PROJ-R7-04D Games Runner | PREPARED / NOT ACTIVATED | `tasks/PROJ-R7-04D-GAMES.md` | R7-03 + per-game stable runtime |
| PROJ-R7-05 Publication Editor/Media/Revisions | PREPARED / NOT ACTIVATED | `tasks/PROJ-R7-05.md` | R7-01/R7-02 + relevant decisions |
| PROJ-R8-01 Discovery Catalog | PREPARED / BLOCKED BY R7 | `tasks/PROJ-R8-01.md` | accepted R7 release gate + owner transition |
| PROJ-R8-02 Interactions/Public Author | PREPARED / NOT ACTIVATED | `tasks/PROJ-R8-02.md` | R8-01 + privacy/social decisions |
| PROJ-R8-03 Moderation Foundation | PREPARED / NOT ACTIVATED | `tasks/PROJ-R8-03.md` | stable publication/media + R8 activation |
| PROJ-R8-04 Comments | PREPARED / BLOCKED BY R8-03 | `tasks/PROJ-R8-04.md` | R8-03 accepted + commenter policy |
| PROJ-R8-05 Metrics/Related/Refinement | PREPARED / NOT ACTIVATED | `tasks/PROJ-R8-05.md` | core R8 + real metrics/ranking decision |

The existence of a task card does **not** authorize coding.

---

## 3. Execution sequence

```text
R3 Project lifecycle owner acceptance
→ PROJ-R7-01
→ PROJ-R7-02
→ PROJ-R7-03
→ selected R7-04 module viewers
→ PROJ-R7-05
→ R7 release gate acceptance
→ PROJ-R8-01
→ PROJ-R8-02
→ PROJ-R8-03
→ PROJ-R8-04
→ PROJ-R8-05
```

R7-03/viewer work and R7-05 may be scheduled as bounded branches of accepted R7 foundation only through explicit control-plane selection; no agent starts the next card automatically.

Graphics/static-only project types use R7-02 safe static fallback until a real interactive viewer is justified.

---

## 4. Current architecture facts that must not be forgotten

Verified AS-IS:

- canonical Project Core / Working Draft / immutable ProjectVersion already exist;
- Gallery/publication, copy/remix, reactions and Collections already exist and should evolve, not be duplicated;
- current publication is not bound to exact `project_versions.id`;
- current Gallery detail reads mutable `project_drafts.document_json` and exposes it as legacy work document;
- current copy source is also mutable draft;
- current Gallery requires a viewer session; target anonymous read must use a new sanitized immutable projection;
- project-specific revocable/expiring ShareLink is not provided by Learning `content_shares`;
- comments remain downstream of moderation.

Do not restore the stale claim that current Gallery is already a safe raw-document-free public boundary.

---

## 5. Hygiene cadence

No calendar cadence.

```text
each change → L0
each accepted bounded slice → L1
3 accepted ordinary slices → L2
2 accepted runtime/media/high-risk slices → L2
milestone/event trigger → L2 earlier
release/owner acceptance → L3
```

`BLOCK` prevents the next slice until fixed or owner-approved.

---

## 6. Current execution blocker

The last verified canonical execution snapshot still had projects lane on unfinished R3 Project Lifecycle with owner acceptance pending. Therefore R7 is prepared but not self-activated.

At actual start, **re-read current `docs/execution/current.yaml`**; historical status in documentation is never an authorization source.

---

## 7. Activation handoff pattern

```text
AGENTS.md
→ START_HERE_FOR_AI.md
→ pnpm agent:recover --scope <activated lane> --check
→ pnpm agent:context --scope <activated lane>
→ docs/execution/current.yaml
→ active Issue/task card
→ PROJECTS_EXECUTION_READINESS.md
→ ASA_PROJECTS_IMPLEMENTATION_TZ.md
→ Current Architecture Audit + latest delta + errata
→ DECISION_LEDGER.md
→ only needed Implementation/UI sections
→ relevant code/tests
```

One run = one bounded slice. After acceptance/evidence: **STOP**.