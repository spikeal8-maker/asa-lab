# Scratch / Visual Programming — token-efficient agent guide

**Scope:** only ASA Lab `blocks` / Scratch-compatible implementation and maintenance.  
**Goal:** change one bounded concern without reading the whole module, repository or all
Scratch documentation.

**Global review authority:** `docs/agent/review-protocol.md`. Scratch risk labels only refine
component-specific routing and map to the global review classes: `low -> L0/L1`,
`medium -> L1/L2`, `high -> L3_CRITICAL`, `critical -> L3_CRITICAL + owner STOP/selection`.
This guide may add Scratch ownership/routing checks, but it must not weaken or replace the
global `POST_STEP_REVIEW` / `CHALLENGE_REVIEW` requirements.

## 0. Execution model — GitHub first

Follow root [policy](../../../AGENTS.md), [entry flow](../../../START_HERE_FOR_AI.md),
[GitHub-first protocol](../../delivery/GITHUB_FIRST_DEVELOPMENT_PROTOCOL.md) and
[change workflow](../../delivery/AGENT_CHANGE_WORKFLOW.md). They own execution selection,
recovery, authoring contexts, publication and CI evidence; this guide adds Scratch-specific rules.
Pinned artifact reuse and rebuild requirements belong to
[Scratch build optimisation](../../delivery/GITHUB_FIRST_DEVELOPMENT_PROTOCOL.md#scratch-build-optimisation).

## 1. Progressive disclosure

Start with the smallest safe context:

```text
router
→ compact component index
→ one subsystem card
→ one component entry
→ one task card only for milestone implementation
→ mapped contract section
→ mapped source/test
```

Do not preload all component cards, all D0 contracts, the roadmap or unrelated source trees.
Expand one dependency hop only when a concrete unresolved dependency requires it and record
why.

### Maintenance budget

Ordinary post-implementation maintenance should normally need:

```text
README router
COMPONENT_MAP index
one subsystem card
0–1 mapped contract sections
1–5 source files
1–2 focused tests
```

Master/ADR/task cards are milestone context, not default maintenance reading unless the
mapped component or global entry policy requires them.

## 2. Component-first lookup

Resolve a human request through `COMPONENT_MAP.yaml` by stable component ID or keywords.
Then open only its one `components/*.yaml` card and the matching entry.

If one request genuinely spans multiple components, list those IDs before editing and load
only their cards/direct dependencies.

If no component matches, STOP and repair routing before broad code search.

### Routing granularity

Create a stable component ID for an independently requested/owned/tested concern or a distinct
contract/risk boundary, not incidental wrappers/styling already owned by one component.
Independently maintained ASA UI controls normally get their own ID or a dedicated small source
module owned by an existing component.

Every component sharing implemented source must name its exact relevant `symbols`; large
sources require symbols even with one owner. Split a growing source without a stable bounded
symbol before accepting the slice. Update routing in the same slice.

## 3. What each layer owns

```text
current.yaml             active execution only; execution requires task.status=in_progress
forward plan             Scratch readiness/order only
COMPONENT_MAP.yaml       component ID/keywords → card route only
components/*.yaml        state/risk/ownership/contracts/source/tests/dependencies
tasks/*.md               one executable slice; no live readiness status
D0 contracts             exact design boundary
Master/ADR               stable destination/architecture
Git history              historical evidence only
```

Do not duplicate one of these responsibilities in another layer.

## 4. Ownership classes

Before editing inspect the component `ownership`:

```text
asa
  ASA-owned implementation; edit inside selected scope.

infrastructure
  ASA build/deployment surface; use infrastructure gates.

upstream_config
  use supported upstream configuration/props; avoid source patch.

upstream_patch
  only the exact reviewed compatibility patch is allowed.
  A new/third Scratch source patch is a STOP/design decision.

cross_boundary
  change spans trust/storage/project boundaries; high-risk review required.

shared_existing
  reuse existing ASA capability; do not clone it into Scratch.
```

This prevents “change any button” from becoming an uncontrolled Scratch fork.

## 5. Write rules

Before editing state:

```text
COMPONENT IDS
OWNERSHIP
RISK
EXPECTED WRITE PATHS
CONTRACT SECTIONS READ
TESTS TO RUN
```

Write the smallest coherent set. If implementation unexpectedly requires a path outside
mapped ownership, inspect that direct dependency first. Do not widen scope merely to keep
coding.

Never begin the next milestone/sub-slice automatically.

## 6. Risk profiles

### LOW

Text/CSS/local ASA presentation with no authority or persistence change.

```text
bounded self-review + mapped focused test
```

### MEDIUM

Component state/handlers, reviewed upstream config/patch or local orchestration.

```text
bounded self-review + focused tests + mapped type/lint/build evidence
```

### HIGH

JWT/capability, Origin/CORS/CSP, storage, persistence, autosave/recovery/conflict, sb3,
cross-tenant behaviour.

```text
bounded self-review + focused/repository-required gates + independent review before slice acceptance
```

### CRITICAL

Activation, destructive migration, live restore, tenant/RLS redesign or security-boundary
weakening.

```text
STOP without explicit owner selection and exact contract/task card
bounded self-review + independent review + owner acceptance mandatory
```

## 7. Review

The global authority is `docs/agent/review-protocol.md`. Every completed Scratch slice runs
`POST_STEP_REVIEW`; HIGH/CRITICAL work also runs `CHALLENGE_REVIEW`. Scratch cards only add
component-specific evidence:

```text
component IDs + ownership
expected vs actual write paths
mapped contract sections
mapped focused tests
routing card updated when source/test ownership changed
residual Scratch-specific risk
```

Do not reread the whole repository for review. A failed review repairs the current bounded
slice or stops; it never authorises the next task. Independent review receives the exact task
card, final diff, mapped component/contract entries and test evidence, not the whole project.

## 9. Documentation stays with the code

When a slice creates/moves/renames/deletes Scratch source or tests, update its subsystem
component entry in the same slice:

```text
planned paths → exact actual paths
planned tests → exact actual focused tests
state → implemented only after accepted evidence
shared/large code sources → exact symbols
obsolete alternatives removed
```

Update compact `COMPONENT_MAP.yaml` only when the stable ID, card route or human keywords
change.

Do not put SHA/PR/current readiness into component cards.

## 10. Stale routing

If two active Scratch documents disagree, STOP before coding the disputed behaviour. Repair
the canonical source/routing first rather than making the coding agent choose by judgement.

If an implemented component points to a missing source/test or nonexistent contract section,
that is a documentation failure.

Mandatory routing check:

```bash
node tools/validate-blocks-docs.mjs
```

A broad repository search is fallback only when this routing is stale or the task is truly
cross-cutting.
