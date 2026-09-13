# Electronics design-decision task template

Use for one prerequisite architectural/technical decision. It chooses/proves a boundary; it does not implement the following product milestone.
Read-only discovery uses an `analysis/inventory` card under [AGENT_GUIDE](../AGENT_GUIDE.md#analysisinventory), not this decision template.

## Metadata

Copy this frontmatter to the very start of the concrete card and replace placeholders.
Field meanings and validation are owned by [AGENT_GUIDE §2](../AGENT_GUIDE.md#2-one-concern-per-slice).

```yaml
---
task_id: <TASK-ELECTRONICS-...-001>
kind: design-decision
risk: <low|medium|high|critical>
semantic_change: <yes|no>
roadmap_slice: null # exact E-OPT slice for roadmap work
prerequisites: [] # exact required acceptance/interface references
acceptance_boundary: slice # milestone only for integrated acceptance
review: <self|independent>
---
```

## Question

```text
<one decision that must be closed>
```

Examples: stable engine facade shape, clock event-trace contract, source-level vs AVR vs hybrid runtime choice.

## Component IDs

Resolve only the components whose contract/dependency is being decided.

## Decision criteria

Define criteria before evaluating candidates, for example:

```text
determinism
compatibility
physics/timing correctness
browser bundle cost
runtime performance
failure semantics
testability
licensing
maintenance cost
portability
```

Do not change criteria after seeing a preferred candidate without recording why.

## Minimal read set

```text
../START_HERE.md
../AGENT_GUIDE.md
../COMPONENT_MAP.yaml
<relevant component entries>
<exact plan stage>
<accepted prerequisite interfaces>
<candidate metadata/source evidence only as needed>
```

## Expected writes

Normally documentation/control plus an optional bounded proof fixture. Production implementation belongs to the following task.

## Evidence

Record only reproducible evidence needed for the decision: candidate/version, compatibility proof, benchmark/size if relevant, failure limits, licensing/security facts and short rejected-alternative reasons.

## Acceptance

```text
one exact decision exists
constraints/limits are explicit
following implementation can be written against an accepted interface
the following milestone was not started
review required by AGENT_GUIDE §13 completed
```

## Forbidden

Apply [AGENT_GUIDE §13](../AGENT_GUIDE.md#13-independent-review) to the actual decision.
A normative semantic decision counts as `Semantic change: yes` even in a docs-only diff.

```text
no implementation of the following milestone
no plan-skip
no speculative future API/files beyond the accepted decision
no dependency addition merely to experiment unless proof fixture explicitly authorises it
no deployment
```

## Stop

STOP after decision/evidence/review. The following implementation task is separately selected.
