# Scratch maintenance task template

Use this for a bounded post-implementation Scratch change that is not a milestone package.

Do not copy execution state into this template. The active task still comes from
`docs/execution/current.yaml` + owner instruction.

## Request

```text
<one sentence describing the requested visible/behavioral change>
```

## Component IDs

Resolve from `../COMPONENT_MAP.yaml` before reading code:

```text
<blocks.component.id>
```

If no component matches, STOP and repair the component map first.

## Risk

```text
low | medium | high | critical
```

Use the policy in `../AGENT_GUIDE.md`.

## Minimal read set

```text
../README.md
../AGENT_GUIDE.md
../COMPONENT_MAP.yaml → exact component entry
<only mapped canonical contract section(s)>
<only mapped source file(s)>
<only mapped test file(s)>
```

Do not read unrelated Scratch subsystems.

## Expected write paths

```text
<small exact path set>
```

Any extra path must have a concrete dependency reason stated before editing.

## Acceptance

```text
1. <observable result>
2. <invariant preserved>
3. <focused test evidence>
```

## Forbidden

```text
no unrelated component refactor
no next milestone work
no activation/deploy/restart unless separately authorised
no widening security/persistence boundaries to make the local change easier
```

## Tests

```text
<mapped focused test/gate>
```

Run broader gates only when required by shared-path/risk policy.

## Bounded self-review

Use the `AGENT_GUIDE.md` checklist against:

```text
this maintenance card
the final diff
the mapped component contract
the focused test evidence
```

Do not reread the full Scratch project for self-review.

## Documentation completion

If source/test ownership moved or a new stable component/symbol was introduced:

```text
update ../COMPONENT_MAP.yaml in the same slice
```

If ownership did not change, report `component_map: unchanged`.

## Stop

After acceptance evidence and self-review, STOP. Do not begin another Scratch change without
separate selection.
