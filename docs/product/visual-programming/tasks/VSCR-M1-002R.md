# VSCR-M1-002R — Scratch maintainability repair before first visible editor

**Kind:** executable implementation slice  
**Risk:** high  
**Prerequisite:** VSCR-M1-002C accepted; VSCR-M1-002D not selected or started.  
**Execution:** coding starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-M1-002R` **and** `docs/execution/current.yaml.task.status` is exactly `in_progress`; `docs/execution/current.yaml.primary_lane.milestone.id` must be exactly `VSCR-M1-002` and its `owner_authorization` must be `accepted`.

## Goal

Remove the measured Scratch developer-surface debt introduced during A/C so that D can add the first
visible editor without multiplying CI cost, agent context, monolithic test harnesses or mixed runtime
responsibilities.

This is a **one-time corrective gate**, not a new permanent product milestone and not an owner-visible
capability checkpoint.

## Why this repair is mandatory

The post-C audit found that developer infrastructure was growing faster than product capability:

```text
Scratch focused gates were not actually focused
root package.json accumulated per-slice gate commands
protocol browser evidence lived in one oversized multi-responsibility harness
mandatory Scratch agent context duplicated the same rules across several documents
runtime protocol code/tests were close to the point where D would turn them into a monolith
maintainability budgets were incomplete or already being approached/exceeded
```

The audit is a baseline, not immutable truth. At task start, re-measure current `main`; keep fixes that
were already completed by intervening maintenance and change only the remaining debt.

## Scope

### 1. CI isolation

```text
Scratch focused gate must not build/test Electronics, Chess, Checkers or 3D
Scratch-only source/test/doc changes must not wake unrelated focused workflows because of a shared gate registry
full repository/governance gate remains available when shared-path/risk policy requires it
```

### 2. Stable Scratch gate entry point

Replace per-slice root command proliferation with one stable Blocks/Scratch gate interface, for example:

```text
pnpm gate:blocks --slice <slice-id>
```

Equivalent naming is allowed. Slice implementation belongs under `tools/blocks/**` (or another single
Scratch-owned tooling directory), not as a growing registry of `gate:blocks-m1-*` scripts in root
`package.json`.

### 3. Protocol test harness decomposition

Split the current browser protocol harness so HTTP fixtures, message helpers, assertions and scenario
orchestration are not all owned by one large file. Prefer normal Playwright specs/helpers where
practical. Preserve the accepted C behaviour exactly.

### 4. Runtime protocol decomposition before D

Separate protocol types/validation/session bridge/lifecycle tests enough that D does **not** add editor
mount/storage responsibilities into the accepted protocol module. This is a behaviour-preserving
refactor only; no new authority, storage or editor feature is introduced.

### 5. Agent-context reduction

Reduce the mandatory Scratch hot path by removing duplicated explanations. Target:

```text
Scratch router/README          about 3–4 KB
Scratch AGENT_GUIDE            about 5–6 KB
selected task card             about 4–6 KB when possible
START_HERE Scratch material    pointer/routing only, not a duplicate guide
canonical Master/D0            may remain larger when section-routed
```

Do not rewrite stable canonical contracts merely to chase a line count.

### 6. Maintainability budgets

Add automated Scratch-owned budgets that prevent a repeat of the same growth pattern. Baseline:

```text
production code   ideal <=150 lines, soft review >220, hard split/fail >=400
focused tests     ideal <=200 lines, soft review >300, hard split/fail >=400
mandatory docs    enforce existing byte caps; keep agent guide/router materially below the cap
large/shared code preserve symbol-level routing requirements
```

Exact implementation of soft warnings may differ; the hard guard must be machine-checkable.

## Expected write paths

```text
package.json                                      # remove/replace per-slice Scratch gate registry only
.github/workflows/scratch-focused.yml             # Scratch routing only
tools/blocks/**                                   # stable gate + maintainability checks
tools/verify-blocks-host-protocol.mjs             # split/deprecate, not expand
e2e/blocks/** or equivalent Scratch protocol tests/helpers
apps/web/src/blocks/runtime-protocol*.ts           # behaviour-preserving decomposition only
apps/web/src/blocks/**/*.spec.ts                   # protocol tests only
docs/product/visual-programming/README.md
docs/product/visual-programming/AGENT_GUIDE.md
START_HERE_FOR_AI.md                               # only if removing duplicated Scratch instructions
docs/product/visual-programming/components/*.yaml  # only if source/test ownership paths move
```

Any unrelated module path is out of scope unless the sole change is removing an accidental Scratch
trigger from a workflow path filter and the dependency is demonstrated first.

## Acceptance

```text
1. Scratch focused gate no longer builds/tests unrelated subject modules.
2. Root package.json no longer grows one command per Scratch slice.
3. A Scratch-only D change can use the stable Scratch gate without editing root package.json.
4. Protocol browser evidence is split into bounded helpers/specs; no multi-responsibility 400-line harness remains.
5. Accepted C protocol behaviour and security evidence stay green after refactor.
6. D cannot add storage/editor-mount concerns into the protocol bridge by convenience.
7. Mandatory Scratch context is materially smaller and within enforced caps.
8. New/changed Scratch files are protected by machine-checkable maintainability budgets.
9. No M1-002D user-visible editor/storage functionality is implemented in this repair.
```

## Tests/evidence

```text
node tools/validate-blocks-docs.mjs
stable Scratch focused gate
accepted C unit/browser protocol evidence
maintainability-budget check
workflow/path-filter inspection proving unrelated focused modules are not part of Scratch gate execution
full repository gate only where shared-path policy requires it
```

## Forbidden

```text
no real editor mount
no ScratchStorage/GUIStorage fixture implementation for D
no branding/File/Extensions work
no runtime JWT/API work
no durable persistence/assets/autosave
no rewrite of unrelated ASA modules
no global legacy max-lines cleanup
no rewrite of current.yaml architecture
no broad rewrite of Master/D0 contracts
```

## Bounded self-review

Verify only the repair surface:

```text
CI isolation
root command surface
protocol harness/module decomposition
mandatory context size
budget enforcement
C regression evidence
no D/B/M1-003+ functionality
```

Report exact before/after measurements for gate fan-out, relevant file sizes and mandatory Scratch
context.

## Independent review

Because this slice changes shared CI/tooling and the guardrails that future Scratch agents rely on,
acceptance requires a reviewer that is not the authoring execution context. Give the reviewer only:

```text
this task card
final diff
before/after measurements
Scratch focused-gate evidence
accepted C regression evidence
```

The reviewer verifies that the repair actually reduces fan-out/context/monolith risk and does not
silently weaken security evidence or skip required repository gates.

## Stop

STOP after repair evidence and independent review. `VSCR-M1-002D` remains blocked until this repair
is accepted and D is separately selected in `current.yaml`.
