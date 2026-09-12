# Electronics design-decision task template

Use for one prerequisite architectural/technical decision. It chooses/proves a boundary; it does not implement the following product milestone.

## Metadata

```text
Task ID: <bounded design id>
Kind: design-decision
Risk: <low|medium|high|critical>
Prerequisite: <accepted interfaces/evidence>
Following implementation: <task id, not authorised here>
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
required independent review completed for HIGH/CRITICAL
```

## Forbidden

```text
no implementation of the following milestone
no plan-skip
no speculative future API/files beyond the accepted decision
no dependency addition merely to experiment unless proof fixture explicitly authorises it
no deployment
```

## Stop

STOP after decision/evidence/review. The following implementation task is separately selected.