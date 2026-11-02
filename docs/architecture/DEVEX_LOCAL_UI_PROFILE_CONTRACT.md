# Versioned local UI effect profiles

Revision: 1.0

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

`ASA DevEx changed UI shadow` runs beside the unchanged mandatory General CI.
Every PR and accepted `main` push receives a selection result; there are no
workflow path filters. Exact Git classification precedes dependency installation.
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
All 16 browser cases must actually pass without skips, and source proof is
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
