# Scratch maintenance task template

Use this only for a bounded post-implementation Scratch change that is not a milestone task.
Active execution state still comes only from `docs/execution/current.yaml`. An owner request
may authorise creating/selecting this bounded maintenance task, but editing begins only after
`current.yaml` reflects the exact task/scope **and** its task status is `in_progress`.

## Goal

```text
<one sentence describing the requested visible/behavioural result>
```

## Components

Resolve by ID/keywords from `../COMPONENT_MAP.yaml` before reading code:

```text
<blocks.component.id>
```

Open only the referenced subsystem card and matching component entry. If no component fits,
STOP and repair routing first.

## Ownership and risk

Copy from the subsystem card; do not invent a lower risk:

```text
ownership: <asa | infrastructure | upstream_config | upstream_patch | cross_boundary | shared_existing>
risk: <low | medium | high | critical>
```

An unmapped upstream Scratch UI control is not automatically safe to patch. STOP for design
review rather than creating a new upstream patch casually.

## Minimal read set

```text
../README.md
../COMPONENT_MAP.yaml
<one referenced ../components/*.yaml card and one component entry>
<only mapped canonical contract section(s)>
<only mapped source file(s)>
<only mapped focused test file(s)>
```

Use `../AGENT_GUIDE.md` for review/risk rules when needed. Do not load other Scratch
subsystems unless a concrete direct dependency requires one more hop.

## Expected write paths

```text
<small exact path set>
<matching subsystem card only if actual source/test ownership changes>
```

Any extra path requires a concrete dependency reason before editing.

## Acceptance

```text
1. <observable requested result>
2. <mapped invariant preserved>
3. <focused test/browser evidence>
```

## Tests

```text
<mapped focused test/gate>
node tools/validate-blocks-docs.mjs
```

Run broader gates only when required by shared-path/risk policy.

## Forbidden

```text
no unrelated component refactor
no next milestone/sub-slice work
no new upstream patch unless an exact reviewed task/contract authorises it
no security/persistence widening to make a local UI change easier
no deploy/restart/activation unless separately authorised
```

## Bounded self-review

Review only:

```text
this maintenance card
final diff
mapped component entry + exact contract section
focused evidence
```

Report:

```text
SELF_REVIEW: PASS | PASS_WITH_RISK | FAIL
components: ...
ownership: ...
scope: ...
acceptance: ...
tests: ...
unrequested_changes: none | ...
routing_docs: unchanged | updated
residual_risk: none | ...
next_allowed_task: STOP
```

## Documentation completion

If actual source/test ownership moved or a stable concern changed:

```text
update the matching ../components/*.yaml entry in the same slice
```

Update compact `../COMPONENT_MAP.yaml` only if component ID/card route/human keywords change.

## Stop

STOP after evidence and self-review. Do not begin another Scratch change automatically.
