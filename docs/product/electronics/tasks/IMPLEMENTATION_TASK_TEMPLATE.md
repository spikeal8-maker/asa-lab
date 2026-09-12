# Electronics implementation task template

Use for one bounded roadmap slice. Active execution still belongs only to `docs/execution/current.yaml`.

## Metadata

```text
Task ID: <E-OPT-XA or bounded repair id>
Kind: implementation
Risk: <low|medium|high|critical>
Roadmap stage: <E-OPT-X>
Prerequisite acceptance: <exact accepted capability/task>
```

## Goal

```text
<one observable/architectural result in one sentence>
```

## Component IDs

Resolve through `../COMPONENT_MAP.yaml` first:

```text
<electronics.component.id>
```

Normally one primary ID, at most two.

## Minimal read set

```text
../START_HERE.md
../COMPONENT_MAP.yaml
<one/two subsystem cards>
../ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md#<exact stage>
<exact normative README/contract sections>
<mapped source>
<mapped focused tests>
```

No broad Electronics README/tree preload.

## Expected write paths

```text
<exact production paths>
<exact test paths>
<routing card only if source/test ownership changes>
```

Default budget: ≤10 production files. More requires a written direct-dependency reason before editing.

## Explicitly not doing

```text
<future stage/capability>
<unrelated UI/solver/runtime refactor>
<deployment>
```

## Acceptance

```text
1. <requested result>
2. <invariant/dependency preserved>
3. <focused deterministic evidence>
4. <risk-required broader gate>
```

## Tests / gates

```text
<focused tests>
<pnpm gate:electronics-m1 if required>
<pnpm benchmark:electronics:ci if engine/runtime semantics touched>
<pnpm gate:electronics-m1:browser if real browser boundary touched>
<pnpm gate:governance if routing/control changed>
```

## Forbidden

```text
no next roadmap slice
no plan rewrite to justify current implementation
no hidden solver special-case when DeviceModel/profile applies
no UI timer as physical time
no owner asset replacement
no deployment/restart
```

## Review

HIGH/CRITICAL slices require independent review against this task, final diff, mapped contracts and exact evidence.

## Bounded self-review

Use `../AGENT_GUIDE.md` report format.

## Stop

After acceptance/review, report:

```text
NEXT_ALLOWED_TASK: STOP | <owner-selectable task>
```

Then STOP. Availability is not authorisation.