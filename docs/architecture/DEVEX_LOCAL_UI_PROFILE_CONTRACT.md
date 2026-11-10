# Versioned local UI effect profiles

Revision: 1.1

## 1. Authority and result boundaries

This contract defines local verification for the existing `dev:check` command.
Surface Maps, Domain Contracts, Document Registry and executable Test Catalogs
remain the existing sources of routing and checks. `current.yaml` remains the
only execution-state source.

The canonical SHADOW plan is retained without changing its risk class, unknowns,
affected paths, fallback checks or mandatory CI obligations. A local effect proof
does not establish complete dependency coverage. In particular, a proven local
effect may coexist with propagated L3 controls and uncertain consumers.

`LOCAL_PASS` means every selected local check actually passed for the bound
source. Exit 0 has this limited meaning. `CI_PENDING`, `RELEASE_NOT_READY` and
`release_ready: false` and `integration_ready: false` remain explicit. Unknown coverage, unrun mandatory checks,
formal CI, independent review and owner acceptance are not waived. This command
never authorizes integration or release. Failed checks take precedence over
pending CI, unknown coverage and report-storage errors.

## 2. collect-picker-presentation-v1

The registered `SURF-PROJECT-COLLECTION-PICKER` declares this version and its three
fixed catalog IDs. The helper validates that declaration and those exact trusted
commands. An unsupported or unavailable proof selects legacy broad local checks.
Direct critical files, imports, API code, configuration and other production
paths cannot enter this profile. Preflight, all affected lanes, handoffs and
execution blockers are checked before execution as before.

Supported production effect families:

- In `collect-picker.css`, change the finite primitive numeric `px` value of the
  unique `min-height` declaration under exactly `.collect-picker-create input`.
  All other CSS must remain equivalent under the normalization below. Negative,
  small or excessively large values are not declared correct by this proof;
  regression tests and browser acceptance must catch incorrect UI results.
- In `CollectPicker.tsx`, add, change or remove only the existing owned dialog's
  `aria-busy` attribute. Values may be `{busy}`, `{!busy}`, `{true}`, `{false}` or
  the literal strings `"true"` and `"false"`. The existing `busy/setBusy`
  `useState(false)` binding, imports, props, functions and handlers remain
  unchanged. The dialog must remain unique, without spread attributes or
  duplicate `aria-busy`. Other expressions fall back to broad checks.

The exact source read from the Git merge-base is compared with current source.
Git checkout CRLF is normalized to LF for comparisons; the bound source digest
still hashes the actual bytes. Baseline preservation uses this same checkout
normalization and otherwise requires exact source.
The helper parses each language, masks only the permitted attribute/value, then
formats both remainders using the same installed Prettier and repository config.
Formatted remainders must be identical. TypeScript comment/directive tokens and
CSS comment tokens must also remain exact, so normalization does not excuse
comment or lint-directive edits. Deterministic line reflow from adding an
attribute is allowed. Unsupported syntax, resource changes, property/selector
changes and production additions/deletions/renames are rejected.

This is a reusable effect proof, not a recognizer for one correct patch. The
first planned samples are min-height 34 to 44 and `aria-busy={busy}`; neither
sample is installed by the engine change.

## 3. Additive regressions and fixed checks

The owned test family is `apps/web/src/components/CollectPicker*.spec.ts`, with
the exact supported names `CollectPicker.spec.ts` and
`CollectPicker.<alphanumeric-or-hyphen-name>.spec.ts`. Every baseline family
file must remain present and byte-equivalent. New files may be added; changing,
removing or renaming baseline tests requires broad verification. New regression
files use static imports from React, React DOM, Vitest, `./CollectPicker` and
`../api`, and explicitly mock `../api`. Dynamic/module-loader imports and direct
network/process/evaluation APIs are unsupported. This shape check is not a
sandbox for arbitrary JavaScript; tests remain reviewed executable source.

Browser coverage is the single existing
`e2e/project-collections-baseline.spec.ts`, registered by its exact filename in
`playwright.settings-ui.config.ts`. The existing catalog entry
`TST-COLLECT-PICKER-BROWSER-001` uses the concrete command
`pnpm exec playwright test --config playwright.settings-ui.config.ts e2e/project-collections-baseline.spec.ts`
and explicit `local_check.eligible: false`.

The existing spec, config and `e2e/fixtures/project-collections.ts` remain
byte-preserved and source-bound with checkout line-ending normalization. Browser
spec changes, additions, removals or fixture/config changes use broad checks.
The same concrete spec covers both current callers: MyProjectsPage at `#/projects`
and CreatorHomePage through useHomeProjectActions at `#/home`. The original 16
MyProjects cases remain intact; eight Home cases cover empty and long-populated
collection lists at 1440/1024/390/320 using the actual project menu and the same
dialog layout oracles, screenshots and close/reopen checks. Home uses exact typed
personal-module and public-shelf GET fixtures; other requests still fail closed.
There is no browser-family discovery or new-browser admission in the local
profile. The concrete spec remains `CI_NOT_RUN` locally; its actual final-source
browser execution is required in isolated CI. Controlled REST fixtures establish
UI behavior, not real authorization or database evidence.

The fixed catalog commands invoke the helper's `--format`, `--lint` and
`--components` modes. They run installed package binaries without a shell or a
new dependency. Formatting covers both owned production files and every family
test; ESLint covers the component and every family test. Vitest uses the fixed
path prefix `apps/web/src/components/CollectPicker`, equivalent to the canonical
`pnpm exec vitest run apps/web/src/components/CollectPicker`. It must report the
exact expected family, at least one executed passing test case per file, and no
failed, skipped, pending or todo assertions. Empty or incomplete green output is
blocked; a real test failure stays FAIL. No server, browser, PostgreSQL, RLS,
repository lint, repository typecheck or repository build is in this local set.
Unsupported or ignored files matching the runner's family prefix are rejected
before local execution; they cannot run outside the declared bound file set.

## 4. Source binding and evidence

The proof hashes both production files and the full selected test family. The
runner verifies that digest, extends the existing run/source binding with those
inputs and rechecks source/catalog bindings before every selected command and
after completion. Symlinks, junctions, unsafe names and source changes invalidate
the result. Report storage retains the existing ignored-path safeguards.

Reports show the local effect class separately from the canonical CI class and
unknowns, every selected result, all deferred mandatory IDs and elapsed wall
time. The unchanged full CI remains mandatory until separately reviewed actual
same-source equivalence evidence supports a later contract change.

### Isolated CI shadow

The original `ASA DevEx changed UI shadow` ran beside mandatory General CI.
Every PR and accepted `main` push received a selection result without path filters.
This section records the shadow behavior used as evidence for §7. Exact Git
classification precedes dependency installation.
Only changes to the two owned production files and additive named component
regressions reach the existing AST/source proof. All other diffs report
`FULL_CI_REQUIRED` with zero narrow checks. Missing or invalid event/source/base
identity fails closed rather than selecting a successful fallback.

An eligible source runs the same `pnpm dev:check --changed --base <event-base>`
command and three catalog checks as the developer. Its current receipt must
match event HEAD, base, merge-base, the original proof and all three actual PASS
records. No unrelated executed check, incomplete receipt or integration/release
claim is accepted. The job then builds only `web:build` and its Nx dependencies,
and runs the exact catalog browser command for
`e2e/project-collections-baseline.spec.ts` on supported Ubuntu 24.04/Chromium.
All 24 browser cases must actually pass without skips, and source proof is
repeated after browser execution. PostgreSQL/RLS, full lint/typecheck and the
repository build are absent from this shadow route; General CI retains them.

`FOCUSED_PASS` qualifies only this executed subset. `CI_PENDING` and both
readiness flags remain false until the separate mandatory full-CI/integration
process provides its own evidence. This initial parallel mode adds runner cost;
it establishes neither runner savings nor equivalence or faster full integration.
Selection, digests, per-check durations, browser reports and screenshots are
preserved by source SHA and run/attempt. Command stdout/stderr from the
token-bearing local-runner step is excluded from uploaded receipts.

## 5. Acceptance limits

Engine tests prove selection, execution and rejection boundaries. The initial
production-component tests exercise existing busy and collection lifecycles;
aria feature evidence is N/A until a subsequent real UI change adds a permanent
unconditional regression that fails before the feature and passes afterward.
Actual L0/L1 changes require the UI layout contract, four viewports, browser
evidence in isolated CI and measured edit-to-result/runner cost. No engine-only
test establishes a speed gain, complete layout acceptance or owner acceptance.


## 6. Scoped focused-CI applicability

The separately reviewed CI applicability extension uses the existing v1 effect
proof only for Account Confirmation, Learning E1 and Public Projects Publication.
It does not alter the canonical SHADOW risk, unknowns, plan or deferred mandatory
IDs. All four General jobs and `ASA / required` remain fully enforced. The
source-bound local checks and concrete 24-case browser route remain separate
verification obligations; applicability does not establish their success.

Each focused workflow checks the exact event HEAD, comparable base and clean
checkout before installing proof dependencies. Its cheap Git classification
admits only the existing production paths and additive named component tests;
path admission cannot skip a suite. Current proof, CI-contract, dependency,
formatter and concrete browser controls must also match the event base. Unrelated
execution-state updates may advance the base without invalidating these bindings.
Only the existing AST/CSS proof of an actual L0/L1 effect, with its complete
current source digest, can select `NOT_APPLICABLE`. Manual dispatch, unknown
base, control drift, unsupported effects and every broader/security/infrastructure
diff retain the original complete suite. Invalid source identity or malformed
proof fails closed.

Suite jobs depend on applicability before allocating their services or matrix.
The applicability receipt records source/base, reason, digest, zero executed
tests and `NOT_APPLICABLE` or `NOT_RUN`; it never reports a focused-test PASS.
Native skipped suite jobs and a successful applicability workflow are not evidence
that those tests ran. Integration and release flags remain false. Full-CI,
independent-review and owner-acceptance requirements are not waived.

Learning additionally requires both complete `first` and `second` partitions.
Each existing matrix artifact carries a receipt written only after the real
code/data and browser commands succeed on the event SHA. The final job requires
native matrix success and both distinct exact-source, same-run receipts, with
explicit attempt provenance. Missing, duplicated, stale, cancelled, failed or
skipped applicable partitions cannot produce PASS. A successful exact-source
N/A proof and an actually skipped whole matrix skip the final checker before
allocating another runner; the applicability receipt alone records zero tests.
Every uncertain or failed selection still reaches the strict final checker,
which accepts only real complete partitions and never fabricates a test PASS
for N/A. No partition artifacts are downloaded or accepted on the N/A route.

This routing change requires its own exact-SHA CI and an actual UI trial before
claiming runner savings. Existing same-source pilot measurements establish the
bounded effect and retain the full General baseline; they do not establish a
median, automatic release readiness or the new route's realized aggregate cost.

## 7. General applicability: general-collect-picker-v1

This version starts with `FAST_ENABLED = False`. Eligible PRs run `PARALLEL`,
which requires the four full General jobs and the bounded UI job on the same
merge candidate. The local profile and canonical SHADOW ranks and unknowns
continue to apply.
`main` pushes always execute Governance, Code, PostgreSQL/Data/RLS and Access A
including auth and migration controls. Release evidence still requires the full
exact-source General result and the existing release verifier. General retains
the D0 triggers for unfiltered PRs and `main` pushes and the exact
`ASA / required` check name.

Before Node installation, the selector validates exact event source, clean Git
state, diff whitespace and change paths. On PRs, the GitHub merge candidate must
have the exact event base and source parents in that order. Its tree must equal
the source checkout tree exercised by all jobs. A different tree blocks the
required result until the branch is updated. A `main` push binds its own SHA and
tree directly. A PR targeting `main` can become a bounded candidate
only for the existing production-file modifications and additive named component
regressions. Unknown, unmapped, critical or unsupported changes retain FULL.
The selector takes bounded authorization from the contract in the accepted
`main` event base. A base without this version bootstraps through FULL.
The complete tools, workflow, Surface Map/Domain Contract and Test Catalog trees,
dependency manifests, formatter/policy and concrete browser inputs must match
that accepted base. A change to those controls selects FULL.

A candidate installs only exact proof dependencies and invokes the existing
`collect-picker-presentation-v1` AST/CSS helper. Only an actual L0/L1 effect with
the complete current source digest and the fixed catalog/browser obligations
can select the bounded route. Malformed identity or proof is BLOCKED. A valid
unsupported effect selects FULL. Governance is required on each route.
PARALLEL and FAST call the existing changed-UI workflow as a reusable job. It
executes the same three `dev:check` format/lint/component checks, validates their
current receipt, builds only the Web dependency closure, and runs the existing
24-case `project-collections-baseline.spec.ts` on Ubuntu 24.04/Chromium without
skips. Proof and clean source are checked again after browser execution. The
local receipt remains `LOCAL_PASS`, `CI_PENDING`, `RELEASE_NOT_READY`; the final
CI subset receipt is `FOCUSED_PASS`. PARALLEL also runs full Code/Data/Access.
Once activated, FAST skips those jobs with the pinned-plan `NOT_APPLICABLE`
explanation and reports `full_regression_verified: false`.

`ASA / required` consumes native same-run job results and outputs. It revalidates
the exact plan, source/base/control identities, merge candidate tree and source
digest. FULL and PARALLEL delegate full checks to the original four-success
aggregator. PARALLEL and FAST require actual bounded-job success, three completed
local checks and all 24 browser cases bound to the same plan, run and attempt.
Failed, cancelled, missing, contradictory or unknown jobs, plans or outputs
block PASS. Both readiness flags are false on every route. The wiring is a
versioned semantic
extension of the immutable-image guard; original full-path images, services,
Compose operations, gate commands and security controls remain protected.

The full Code job runs the actual effect-helper integration through the existing
dependency wrapper with the same catalog/local command:
`node tools/devex-python.mjs tools/test_devex_ci_contract.py --helper-integration`.
Code does not inherit validator packages from Governance or an earlier wrapper's
temporary environment. This invocation checks its own interpreter requirements
and prepares and removes an isolated environment when PyYAML is unavailable.

After the contract is accepted on `main`, run the first authorized pilot from
that base with one supported CollectPicker effect and its permanent regression.
Run `pnpm dev:check --changed --base <accepted-main-sha>` locally, then use the
normal PR workflow. Confirm `PARALLEL` and matching source, base and tree in the
selection and bounded receipts, the four full job successes and `ASA / required`
on that candidate. Compare that pair with the existing L0/L1 shadow pilots
recorded for PRs 948 and 956. Retain the full `main` result after integration.

After independent review of that comparison, a separate reviewed `main` change
can set `FAST_ENABLED = True` in the same versioned adapter. The activation PR
itself selects FULL because it changes a control. Later eligible PRs take FAST
only from an accepted base containing that exact adapter. FAST evidence cannot
establish full regression, release readiness or a speed gain by itself.
