# Scratch design-decision task template

Use this template for a bounded prerequisite such as `VSCR-M1-004P`, `VSCR-M1-005P` or
`VSCR-M1-007P`. A design card chooses/proves one dependency or contract detail; it does not
implement the following product milestone.

## Metadata

```text
**Kind:** design decision slice
**Risk:** <low | medium | high | critical>
**Prerequisite:** <accepted previous interfaces>
**Execution:** work starts only when docs/execution/current.yaml.task.id is exactly <TASK-ID>.
```

## Goal

```text
<one decision/question that must be closed before implementation>
```

## Components

```text
<only mapped components whose contract/dependency choice is being resolved>
```

Open only their subsystem entries and exact mapped contract sections.

## Minimal read set

```text
../README.md
../AGENT_GUIDE.md
../COMPONENT_MAP.yaml
<one/few relevant component entries>
<accepted prerequisite interface(s)>
<exact canonical contract section(s)>
<candidate dependency metadata/source evidence only as needed>
```

Do not read unrelated Scratch milestones.

## Decision criteria

Define before evaluating candidates, for example:

```text
compatibility with accepted interface
security properties
license suitability
maintenance health
bounded resource behaviour
browser/server environment fit
failure semantics
testability
```

Do not change criteria after seeing a preferred candidate without documenting why.

## Expected write paths

Normally documentation/control only:

```text
<this exact design card>
<canonical D0/component card only if the accepted decision changes stable contract/routing>
```

Dependency/code changes belong to the following implementation task unless this exact design
card explicitly exists to perform a bounded proof fixture.

## Evidence

Record only evidence needed to reproduce the decision:

```text
candidate/version
license/security source
compatibility proof or fixture
limits/failure behaviour
rejected alternatives with short reason
```

Avoid pasting large external documents into the repository.

## Acceptance

```text
one exact decision exists
its constraints/limits are explicit
the following implementation task can be written against real accepted interfaces
no implementation milestone was started
node tools/validate-blocks-docs.mjs passes
```

## Bounded self-review

Review only this decision card, changed canonical section/component metadata and evidence.
Report the normal `SELF_REVIEW` fields from `../AGENT_GUIDE.md`.

## Independent review

Include this section in the concrete task card whenever risk is HIGH/CRITICAL. The reviewer is
not the authoring execution context and reviews the bounded decision/evidence only. A rejected
decision is `FAIL/STOP`, not permission to start implementation with another unreviewed choice.

## Forbidden

```text
no implementation of the following milestone
no speculative future filenames/API beyond accepted interfaces
no dependency addition merely to "try it" unless the exact proof fixture is part of the card
no automatic next-task selection
```

## Stop

STOP after the design decision, evidence, required independent review and owner acceptance.
The following implementation card is written/refined separately, then separately selected in
`current.yaml`.
