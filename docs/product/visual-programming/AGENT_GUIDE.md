# Scratch / Visual Programming — token-efficient agent guide

**Scope:** only ASA Lab `blocks` / Scratch-compatible implementation and maintenance.  
**Goal:** let an agent change one bounded Scratch concern without reading the whole module,
whole repository, or all Scratch documentation.

## 1. Default operating model

Use **progressive disclosure**.

Start with the smallest context that can safely answer the task:

```text
router README
→ one component entry
→ one task card if this is milestone implementation
→ one canonical contract section
→ mapped source file(s)
→ mapped focused test(s)
```

Do not preload every D0 contract, the full roadmap, old audits, or unrelated source trees.
Expand only when a concrete unresolved dependency requires it.

### Default context budget

For an ordinary maintenance change, begin with:

```text
1 router
1 component entry
0–1 task card
0–2 contract sections/files
1–5 source files
1–2 focused tests
```

This is a routing rule, not an arbitrary hard security ceiling. If correctness requires more,
expand one dependency hop and state why.

## 2. Component-first lookup

Every maintainable Scratch concern has a stable component ID in `COMPONENT_MAP.yaml`.
Examples:

```text
blocks.module.contract
blocks.host.branding
blocks.host.file-menu
blocks.host.extensions
blocks.host.protocol
blocks.runtime.capability
blocks.assets.upload
blocks.project.persistence
blocks.project.autosave
blocks.sb3.import
blocks.gallery.player
```

When the user asks for a small change, resolve the component before searching code.

If one component entry is enough, do not read adjacent components.
If a request spans multiple mapped components, list them explicitly before editing.

## 3. Read rules

### Always read

```text
AGENTS.md
START_HERE_FOR_AI.md
current authorised task context
visual-programming/README.md
this AGENT_GUIDE.md
matching COMPONENT_MAP.yaml entry
```

### Read only when mapped or required

```text
Master spec
D0 contracts
forward plan
task cards
Project Core docs
Learning docs
Gallery docs
storage/security contracts
```

### Do not read by default

```text
historical readiness audits
superseded addenda
old PR bodies/comments
unrelated module docs
all of apps/web or apps/api
all D0 contracts at once
all task packages at once
```

A broad `grep/search` of the repository is permitted only when the component map is stale,
the mapped symbol no longer exists, or the request is genuinely cross-cutting. Record that
reason in the final report.

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

Examples: event handler, component state, message shape implementation inside an already
accepted contract, non-security orchestration.

Required review:

```text
bounded self-review
focused tests
type/lint/build gate required by task/component
```

### HIGH

Examples: JWT/capability, origin/CORS/CSP, persistence guard, S3/MinIO, asset validation,
cross-tenant behaviour, `.sb3` parser/import, recovery/conflict semantics.

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
STOP unless explicitly authorised by owner and exact contract/task package exists
independent review + owner acceptance mandatory
```

## 6. Bounded self-review after every implementation slice

Do this after code/tests, using only the task contract, final diff, mapped contracts and test
results. Do **not** reread the whole project.

Checklist:

```text
1. Did I implement exactly the requested outcome?
2. Did I touch only justified paths?
3. Did I add behaviour not requested by the task?
4. Did I preserve mapped invariants and neighbour boundaries?
5. Are acceptance criteria actually evidenced by tests, not assumed?
6. Did I leave dead code, duplicate paths or a second source of truth?
7. Did source/test ownership change? If yes, did I update COMPONENT_MAP.yaml?
8. Did I accidentally begin a future task?
9. What concrete residual risk remains?
```

Report form:

```text
SELF_REVIEW: PASS | PASS_WITH_RISK | FAIL
scope: ...
acceptance: ...
tests: ...
unrequested_changes: none | ...
component_map: unchanged | updated
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

The reviewer should receive the task card, diff, mapped contracts and evidence—not the whole
repository unless the review finds an unresolved dependency.

## 8. Documentation update rule

Documentation is part of the implementation result.

When a task creates, renames, moves or deletes a Scratch source/test surface, update the
matching component entry in the same slice.

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

1. stop before coding the disputed behaviour;
2. prefer the canonical hierarchy in `README.md`;
3. compare with actual code and accepted owner decision;
4. repair the canonical document first;
5. mark/remove superseded wording from the default read path.

Do not make the coding bot choose architecture by “best judgement” between conflicting docs.

## 10. Future small-maintenance example

Request: “hide the Extensions button in Scratch”.

Expected context:

```text
README.md
AGENT_GUIDE.md
COMPONENT_MAP.yaml → blocks.host.extensions
D0-001 § Extensions
mapped editor config / patch file
mapped host browser test
```

Unnecessary context:

```text
S3 contracts
Project Core persistence
Gallery remix
Learning
sb3 import
whole apps/web
whole apps/api
```

That is the standard to preserve as the implementation grows.
