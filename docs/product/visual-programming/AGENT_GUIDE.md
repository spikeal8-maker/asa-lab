# Scratch / Visual Programming — token-efficient agent guide

**Scope:** only ASA Lab `blocks` / Scratch-compatible implementation and maintenance.  
**Goal:** change one bounded concern without reading the whole module, repository or all
Scratch documentation.

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

Examples:

```text
"кнопка расширений" → blocks.host.extensions
"логотип Scratch"   → blocks.host.branding
"CORS Scratch"      → blocks.runtime.origin-security
"автосохранение"    → blocks.project.autosave
"импорт sb3"        → blocks.sb3.import
```

If one request genuinely spans multiple components, list those IDs before editing and load
only their cards/direct dependencies.

If no component matches, STOP and repair routing before broad code search.

### Routing granularity

The map is a maintenance map, not a DOM inventory. Create a distinct stable component ID when
a concern can be independently requested/owned/tested or has a different contract/risk
boundary. Do not create IDs for incidental wrappers or styling-only markup that is wholly
owned by one existing component.

When implemented source is shared by multiple mapped components, each component entry must
name the exact relevant `symbols`. A large code source must also expose symbols even when only
one component currently owns it. If a source has no stable bounded symbol and keeps growing,
split the code before accepting the slice rather than making future agents reread a monolith.

For newly implemented ASA UI, independently maintained controls such as a toolbar action,
status indicator or dialog normally either get their own component ID or live in a dedicated
small source module owned by one existing component. Update routing in the same slice.

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

## 7. Bounded self-review after every implementation slice

Use only:

```text
selected task/maintenance card
final diff
mapped component entries + contract sections
focused test evidence
```

Do not reread the whole project.

Checklist:

```text
1. Did I implement exactly the requested outcome?
2. Are all touched paths justified by mapped ownership/dependencies?
3. Did I add unrequested behaviour?
4. Did I preserve neighbour/security/persistence boundaries?
5. Is acceptance evidenced by tests rather than assumed?
6. Did I create duplicate/dead code or a second source of truth?
7. Did actual source/test ownership change, and is the subsystem card updated?
8. Did I accidentally begin a future task/sub-slice?
9. What concrete residual risk remains?
```

Report:

```text
SELF_REVIEW: PASS | PASS_WITH_RISK | FAIL
components: ...
scope: ...
acceptance: ...
tests: ...
unrequested_changes: none | ...
routing_docs: unchanged | updated
residual_risk: none | ...
next_allowed_task: STOP | <owner-selectable task>
```

`FAIL` means repair the current slice or stop; it never authorises scope expansion.

## 8. Independent review

Do not run a second full-project review after every small UI change.

Independent review is required before acceptance of every HIGH/CRITICAL executable slice and
for integrated high-risk milestone boundaries, including:

```text
M1-002C protocol boundary
M1-002D storage-adapter boundary
M1-002E integrated host acceptance
M1-003 runtime security
M1-004 storage/content validation
M1-005 persistence/load-save
M1-006 recovery/conflict
M1-007 sb3 safety
M1-008 end-to-end M1 acceptance
M2 Gallery/remix security-sensitive work
M3 deployment/backup
M4 activation
```

`Independent` means the reviewer is not the authoring execution context for that slice. It may
be another agent/context or a human reviewer. The reviewer receives only the exact task card,
final diff, relevant component entries, mapped contract sections and test evidence—not the
entire repository by default.

Reviewer responsibilities:

```text
verify scope and acceptance independently
challenge author assumptions at the mapped boundary
check evidence belongs to the exact reviewed SHA
report PASS / PASS_WITH_RISK / FAIL
never silently edit product code while claiming independent review
```

A product defect found by an independent reviewer is `FAIL/STOP`. The fix belongs to a
separately selected bounded repair task owned by the affected component; after repair, review
runs again. If a genuinely independent reviewer is unavailable, the slice remains
unaccepted—it does not downgrade itself to self-review.

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
