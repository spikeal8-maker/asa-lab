# Electronics maintenance task template

Use only for a bounded change to an already implemented Electronics capability. It does not authorise a roadmap milestone.

## Goal

```text
Task ID: <exact selected task id>
Kind: maintenance
Area risk / ownership: <from subsystem card>
Risk: <actual task risk with reason>
Semantic change: <yes|no>
```

```text
<one requested visible/behavioural correction>
```

## Component

Resolve through `../COMPONENT_MAP.yaml`:

```text
<one primary electronics.component.id>
```

If no route exists, STOP and repair routing first.

## Risk / ownership

Record area risk/ownership from the card, then classify the actual change using
[AGENT_GUIDE §5](../AGENT_GUIDE.md#5-risk-classes). A non-semantic task may have lower
risk than the area; explain the scope instead of downgrading a semantic change.

## Minimal read set

```text
../START_HERE.md
../COMPONENT_MAP.yaml
<one subsystem card entry>
<0–1 exact normative sections>
<1–5 mapped production files>
<1–2 focused tests>
```

## Expected write paths

```text
<small exact path set>
```

Default budget: one component, ≤5 production files, ≤2 focused test files.

## Acceptance

```text
1. requested defect/maintenance outcome is observable
2. mapped invariant preserved
3. focused test/evidence passes
```

## Forbidden

```text
no future roadmap capability
no architecture rewrite for convenience
no sensor/peripheral addition
no solver semantic change hidden inside UI maintenance
no persistence/schema/RLS widening
no deployment/restart
```

## Tests

Run the mapped focused test first, then only risk/shared-path required broader gates.

## Self-review

Use [AGENT_GUIDE §§12–13](../AGENT_GUIDE.md#12-bounded-self-review) for self-review and
the semantic independent-review decision. Verify no unrequested behaviour or second source of truth.

## Documentation

Update the subsystem card only if actual source/test ownership changed. Update `COMPONENT_MAP.yaml` only if ID/card route/keywords changed.

## Stop

`NEXT_ALLOWED_TASK: STOP` is the default. Do not begin another maintenance item automatically.
