# Scratch / Visual Programming — token-efficient agent guide

**Scope:** only ASA Lab `blocks` / Scratch-compatible implementation and maintenance.  
**Goal:** let an agent change one bounded Scratch concern without reading the whole module,
whole repository, or all Scratch documentation.

## 1. Default operating model

Use **progressive disclosure**.

Start with the smallest context that can safely answer the task:

```text
router README
→ compact COMPONENT_MAP index
→ one referenced subsystem card
→ one task card if this is milestone implementation
→ one canonical contract section
→ mapped source file(s)
→ mapped focused test(s)
```

Do not preload every subsystem card, every D0 contract, the full roadmap, old audits, or
unrelated source trees. Expand only when a concrete unresolved dependency requires it.

### Default context budget

For an ordinary maintenance change, begin with:

```text
1 router
1 compact component index
1 subsystem card
0–1 task card
0–2 contract sections/files
1–5 source files
1–2 focused tests
```

This is a routing rule, not an arbitrary hard security ceiling. If correctness requires more,
expand one dependency hop and state why.

## 2. Component-first lookup

Every maintainable Scratch concern has a stable component ID in `COMPONENT_MAP.yaml`.
The compact index points to one small `components/*.yaml` card containing actual/planned
source ownership, contract section and focused tests.

Examples:

```text
blocks.host.branding
blocks.host.extensions
blocks.runtime.capability
blocks.assets.upload
blocks.project.autosave
blocks.sb3.import
blocks.gallery.player
```

When the user asks for a small change:

```text
resolve component ID
→ open only referenced card
→ inspect only that component entry
```

Do not load all subsystem cards.

If a request spans multiple components, list those IDs explicitly before editing and load
only their referenced cards.

## 3. Read rules

### Always read

```text
AGENTS.md
START_HERE_FOR_AI.md
current authorised task context
visual-programming/README.md
this AGENT_GUIDE.md
COMPONENT_MAP.yaml compact index
one referenced components/*.yaml card
```

### Read only when mapped or required

```text
Master sections required by global Scratch entry flow
Scratch ADR
selected D0 contract section(s)
forward plan for planning questions
task card for selected milestone implementation
Project Core/Learning/Gallery docs only when the component crosses those boundaries
```

### Do not read by default

```text
all component cards
all D0 contracts
historical readiness audits
superseded addenda
old PR bodies/comments
historical consolidated implementation package
unrelated module docs
all of apps/web or apps/api
```

A broad repository `grep/search` is permitted only when:

```text
the component index/card is stale,
the mapped symbol/path no longer exists,
or the request is genuinely cross-cutting.
```

Record that reason in the final report.

## 4. Write rules

Before editing, state:

```text
COMPONENTS
EXPECTED WRITE PATHS
CONTRACTS READ
TESTS TO RUN
RISK LEVEL
```

Write only the smallest coherent set. If implementation unexpectedly needs a path outside
mapped ownership, stop and inspect that dependency before widening scope.

Never start the next milestone package because the current one finished early.

## 5. Risk profiles

### LOW

Examples: text, spacing, CSS, local icon visibility, local presentation with no authority or
persistence change.

Required review:

```text
bounded self-review
focused unit/browser test where present
```

### MEDIUM

Examples: event handler, component state, message-shape implementation inside an already
accepted contract, non-security orchestration.

Required review:

```text
bounded self-review
focused tests
type/lint/build gate required by task/component
```

### HIGH

Examples: JWT/capability, origin/CORS/CSP, persistence guard, S3/MinIO, asset validation,
cross-tenant behaviour, `.sb3` parsing/import, recovery/conflict semantics.

Required review:

```text
bounded self-review
focused + repository-required gates
independent review before owner acceptance
```

### CRITICAL

Examples: activation, destructive migration, live restore, security-boundary weakening,
public bucket or tenant/RLS redesign.

Required action:

```text
STOP unless explicitly authorised by owner and exact contract/task card exists
independent review + owner acceptance mandatory
```

## 6. Bounded self-review after every implementation slice

Do this after code/tests, using only:

```text
selected task/maintenance card
final diff
mapped component contract(s)
focused test results
```

Do **not** reread the whole project.

Checklist:

```text
1. Did I implement exactly the requested outcome?
2. Did I touch only justified paths?
3. Did I add behavior not requested by the task?
4. Did I preserve mapped invariants and neighbour boundaries?
5. Are acceptance criteria evidenced by tests rather than assumed?
6. Did I leave dead code, duplicate paths or a second source of truth?
7. Did source/test ownership change? If yes, did I update the subsystem card?
8. Did I accidentally begin a future task?
9. What concrete residual risk remains?
```

Report form:

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

A `FAIL` self-review means fix the current slice or stop; it does not authorise widening.

## 7. Independent review policy

Do not use a second full-project review after every button change. That wastes context.

Independent review is expected for:

```text
M1-002 host boundary acceptance
M1-003 runtime security
M1-004 storage/content validation
M1-005 persistence guard/load-save
M1-006 autosave/recovery/conflict
M1-007 sb3 safety/compatibility
M1-008 end-to-end milestone acceptance
M2 Gallery/player/remix security-sensitive work
M3 sovereign/deployment/backup acceptance
M4 activation
```

The reviewer receives the exact task card, final diff, relevant subsystem card, mapped
contract sections and evidence—not the whole repository unless review discovers an
unresolved dependency.

## 8. Documentation update rule

Documentation is part of the implementation result.

When a task creates, renames, moves or deletes a Scratch source/test surface, update the
matching `components/*.yaml` entry in the same slice.

Update the compact `COMPONENT_MAP.yaml` only when a stable component ID/card/state/risk
routing entry itself changes.

After a milestone task is accepted:

```text
planned source paths → actual source paths
planned tests → actual focused tests
component state → implemented
obsolete alternatives removed
new stable symbols/components recorded
```

Do not copy temporary SHA/PR state into component cards. Live execution state stays in
`current.yaml`.

## 9. Handling stale documentation

If two active Scratch documents disagree:

1. stop before coding the disputed behavior;
2. prefer the canonical hierarchy in `README.md`;
3. compare with actual code and accepted owner decision;
4. repair the canonical document/routing card first;
5. remove superseded wording from the default read path.

Do not make a coding bot choose architecture by “best judgement” between conflicting docs.

If `COMPONENT_MAP.yaml` or a subsystem card points to a missing/renamed source or test, treat
that as a routing defect. Repair routing before doing a broad code search.

## 10. Small-maintenance example

Request: “hide the Extensions button in Scratch”.

Expected context:

```text
README.md
AGENT_GUIDE.md
COMPONENT_MAP.yaml → blocks.host.extensions → components/host.yaml
only blocks.host.extensions entry
D0-001 → Extensions section
mapped editor config / patch file
mapped host browser test
```

Unnecessary context:

```text
components/runtime.yaml
components/assets.yaml
components/project.yaml
components/gallery-learning.yaml
S3 contracts
Project Core persistence
Learning
sb3 import
whole apps/web
whole apps/api
```

That is the standard to preserve as the implementation grows.
