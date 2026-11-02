# One original E11 stopped-fit390 qualification

Issue836 remains open. This additive workflow selects exactly the existing
`E11 stopped-fit: native outward selection, real DC and whole save reopen at 390px`
case from `e2e/electronics-selection-outline.spec.ts`. The original case, all
assertions, native inputs, observation/lifecycle budgets and default30s timeout
are unchanged. Running1440 and all other cases are outside this command.

The reviewed product/test candidate is
`fadc2ee0c46c9a704641d68f334d82f4d9b5ac05`. A source guard admits only descendants
whose delta is this fixed CI/documentation slice; product, migration, dependency
or full-workflow changes stop before Docker. Only newly created receipts under
this job's owned reports directory may be untracked; tracked changes are denied.
The new workflow accepts no inputs.
Its exact source and commands are hashed; the existing immutable transport guard
admits only this additional workflow/browser pair after those checks. R4 and UI679
workflows, image receipts, overlays and strict full-suite requirements remain
unchanged. No environment spoof or alternate transport proof is used.

After independent exact-SHA review, the controller must first confirm that this
workflow is registered on the default branch: [GitHub requires that for manual
dispatch](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).
That source-only activation is separate from this Draft PR and is not performed
by the author. Then dispatch `e11-stopped-fit-390.yml` on the reviewed candidate
branch, not an arbitrary Main product revision. Only `workflow_dispatch` can run its browser job.
The job uses Ubuntu24.04, frozen Node/pnpm/Python dependencies, the existing
original Node/Caddy/frontend/PostgreSQL identities and an isolated disposable
Compose project. It applies normal migrations and verifies image layers, build
revision and runtime readiness/schema before running the fixed Node entrypoint:

```sh
node tools/run-e11-stopped-fit-390.mjs
```

This command is intended only inside that workflow's existing test-runner
container, never against school/live data or local Windows Docker. The exact
discovery must contain one case; execution must contain one successful attempt
with zero retries/skips/flakes. The original raw JSON must report a completed
journey, all nine native PNG pairs, clean lifecycle/worker journals and a retained
Playwright trace. Source, discovery, execution, raw/PNG/journals/trace and a SHA256
manifest are uploaded under `reports/e11-stopped-fit-390`, including partial failure
evidence. Missing/incomplete proof fails; PASS does not establish whole Electronics,
school100-pupil acceptance, deployment permission or issue836 completion.

Offline checks (no Docker/browser/database):

```sh
node --test tools/run-e11-stopped-fit-390.test.mjs
python -m unittest discover -s tools -p test_e11_single_case_contract.py -v
```

Native execution is NOT_RUN until the reviewed workflow actually completes.
