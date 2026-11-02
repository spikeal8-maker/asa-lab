# Closed 836 three-case CI evidence

This is an additive `evidence_subset: 836-runtime-three-v1` on the existing
`electronics-ui-679-557.yml` filename. The default `ui-679-557-six` still invokes
the original six-case runner with its original commands, assertions and budgets.
R4, strict/D13 suites, product/e2e sources, vendor assets, migrations, dependencies
and image transport are unchanged. The new subset has its own concurrency group.
There is no new default-branch workflow registration.

The fixed cases are two original E11 1440px journeys (stopped-fit and
running-controls), and the original catalog-owner temporary-image recovery case.
`contract.json` records their full file/describe/title identities and immutable
source baseline. This is a CI-only evidence branch; no native run, server update,
100-pupil qualification or release acceptance is implied by publishing it.

## Commands

The conditional focused step and offline local check use exactly:

```text
python3 tools/electronics_836_three_source.py --executables
node --test tools/test-electronics-836-runtime-three.mjs
python3 tools/test_electronics_836_three_source.py
pnpm exec vitest run tests/electronics/ui-679-557-qualification.spec.ts --maxWorkers=1
```

On Windows the same Python checks use the existing `python` executable instead
of `python3`; no interpreter installation is part of this slice.

After independent exact-SHA review, the controller may select one diagnostic run
at the frozen baseline (not executed by the source author):

```text
gh workflow run electronics-ui-679-557.yml --repo spikeal8-maker/asa-lab --ref <reviewed-ci-only-branch> -f evidence_subset=836-runtime-three-v1
```

GitHub `--ref` selects the branch's version of this already registered filename.
Do not dispatch the unmodified default definition expecting a three-case input.
The existing workflow-contract test changes trigger the unchanged R4 PR path
filter; this temporary evidence branch is published without creating a PR.
This does not remove any required integration gate.

## Fail-closed proof

Before Docker, the source guard checks the exact event/workflow/browser/ref pair,
the closed choice, clean exact HEAD, ancestry of the fixed baseline, and a Git
tree projection preserving every non-allowlisted source blob. Only the eight CI,
test and documentation paths in the guard may differ. Actual runner and workflow
bytes have independent hardcoded SHA256 pins. Updating only the declaration
together with changed runner bytes is insufficient. Clean committed Git mutants
exercise arbitrary commands, retries, workflow changes and product drift.
The focused job verifies these bytes before Node unit tests import the runner.

The guard module and its reviewed constants are trusted at the independently
reviewed commit. These checks do not claim protection against an authorized owner
rewriting the validator itself. There is no self-referential hash cycle. The
runtime runner also checks its own bytes and the guard's bytes against the fresh
source receipt before runtime requests, execution or evidence writes.

The source receipt directory is created **before** the existing isolated
`reports`/`e2e/artifacts` permission step. That unchanged step also makes the new
directory writable by container UID1000 when the host runner has another UID.
The POSIX regression proves denial before that step and actual child-UID writing
after it, using disposable temporary files only on isolated GitHub Linux runners.
It is explicitly skipped on Windows; no WSL, local engine or server is started.

The unchanged image guard verifies original Node/Caddy/PostgreSQL identities,
the Compose image-only overlay and exact API/Web revision labels. Its actual
three built-image receipts and PostgreSQL receipt are retained and checked against
the source receipt's complete base-layer identities. Runtime readiness must match
the exact candidate SHA/schema300, including expectedSchemaVersion300 and
synchronized=true. Only the closed three-case profile exports the canonical
ASA_EXPECTED_SCHEMA_VERSION assignment to GITHUB_ENV before Compose. The fixed
--expected-schema command revalidates the exact Git/source receipt and emits only
that single bounded integer assignment; the original six-case environment is unchanged.
Before asserting readiness, the runner retains runtime-readiness.json with only
HTTP status, closed ready/not_ready status, exact revision or null, bounded numeric
actual/expected schema or null, and boolean synchronization or null, bound to the
source SHA/schema. Arbitrary response text, fields and headers are excluded.
The receipt joins the final artifact inventory even when readiness fails, before
any discovery or native execution. A later product baseline requires one explicitly
authorized repin and review; arbitrary main drift is rejected.

Discovery freezes exactly three file/describe/title/project identities. Execution
requires three passed cases, one attempt each, zero retry/skip/flaky/error.
The runner adds trace retention, not worker, timeout or assertion changes.
E11 proof requires complete original journeys, whole-document CAS/revision,
cookies-only reopen with empty pre-app storage, both fulfilled lifecycle actions,
one user PUT after seed, and the actual final GET after lifecycle preserving the
saved revision. Original native PNG pairs, worker journal bytes/count and traces
are retained. Catalog proof requires native error/load and HTTP404/retry200,
unchanged empty document, zero project PUT and complete original observation.

PNG chunks/raster and selected trace-network resources are validated with the
standard library. ZIP paths, duplicates and size bounds fail closed; no extraction
is performed. Every retained file is listed with size/SHA256 in `qualification.json`.
Missing/partial/stale proof yields `FAIL_OR_INCOMPLETE`. The JSON always states
`fullElectronicsQualification: false` and `releaseAccepted: false`.

## Status and limits

Native qualification for this repair: **NOT_RUN**. Required independent review: **PENDING**.
The earlier exact8d63 diagnostic run41535936121 failed its strict runtime metadata
assertion before discovery; zero browser cases ran. The response fields were not
retained, so no specific observed null value is claimed. Source analysis found the
missing expected-schema environment assignment: the canonical API returns null
synchronization when expectedSchemaVersion is absent. Its isolated Linux cross-UID
permissions regression passed. Neither that result nor this source repair is native
three-case acceptance; the new exact-SHA diagnostic run remains controller-selected.
This source slice does not classify all remaining26 full-suite failures as
unrelated, lift blocker836, or authorize VM100 production update. The exact native
three-case receipts must be independently reviewed; broader relevant failures and
the canonical production blocker remain controller decisions under the existing
owner-authorized programme. A diagnostic run at this baseline cannot qualify a
later product revision; that requires the separately authorized baseline repin,
review and final qualification selected by the controller.
