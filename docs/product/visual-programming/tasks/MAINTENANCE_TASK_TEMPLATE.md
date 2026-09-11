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

The compact index points to one `../components/*.yaml` card. Open only that card and the
matching component entry.

If no component matches, STOP and repair routing first.

## Risk

```text
low | medium | high | critical
```

Use the policy in `../AGENT_GUIDE.md`.

## Minimal read set

```text
../README.md
../AGENT_GUIDE.md
../COMPONENT_MAP.yaml compact index
<one referenced ../components/*.yaml card>
<only mapped canonical contract section(s)>
<only mapped source file(s)>
<only mapped test file(s)>
```

Do not read other Scratch subsystem cards unless a concrete dependency requires one more hop.

## Expected write paths

```text
<small exact path set>
<the matching components/*.yaml card only if ownership/routing changes>
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
the mapped component entry + contract
the focused test evidence
```

Do not reread the full Scratch project for self-review.

## Documentation completion

If source/test ownership moved or a new stable component/symbol was introduced:

```text
update the matching ../components/*.yaml card in the same slice
```

Update `../COMPONENT_MAP.yaml` only when the stable component ID/card/state/risk routing
itself changes.

If ownership did not change, report `routing_docs: unchanged`.

## Stop

After acceptance evidence and self-review, STOP. Do not begin another Scratch change without
separate selection.
