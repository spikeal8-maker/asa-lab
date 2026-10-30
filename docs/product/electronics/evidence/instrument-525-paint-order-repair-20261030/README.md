# Mirror 525 paint-order oracle repair

Bounded test-only repair on canonical main `d9e747ebf6397e8ef8e54515c6b83e0a6d709c08`,
composed with the exact independently reviewed `f2f94ad22728ed744539ec490f53a74e1c8e1f47`
dependency paths from `0027` (including its pure PSU geometry extraction).
The composition manifest records each imported blob and all disjoint main paths.
Current Projects Catalog, execution state, API and foreign work are preserved.
No new production implementation is authored by this repair.

The fixture intentionally paints the regulated supply body below wires, ahead
of ordinary bodies. Its independent expected DOM order is exactly
`bench-supply, source, meter, load, generator, scope`. Logical document-array
order remains strictly checked everywhere else. This repairs only the false
rendered-ID order oracle, with no sort, observed-derived expectation or relaxed
identity/cardinality check.

Five exact spec replacement hunks are recorded in `edits.json`: the order oracle,
a holder for the existing reopened collector, its assignment, and finally
snapshots before/after cleanup. Both collectors' existing `counts` getters
return fresh plain objects containing numbers. The holder adds no observer or
lifecycle. An unavailable reopened collector is explicitly `null`. Original
success-path collector assertions, native-action assertions, screenshots,
ledger checks, closures and completion semantics are unchanged. No UI action,
request, deadline or coverage change is introduced.

`proof.py` verifies all 16 actual raw captures byte-identical to their canonical
archived ZIP entries, their original false completion flags, exact paint order,
and six rejected wrong/order/missing/duplicate identity cases. It reverses the
five permitted hunks and requires exact full f2 spec byte equality. The complete
success-path native assertions/screenshots/browser-check segment is additionally
compared byte-for-byte. Only generated `browserEvidenceSha256` changes from f2.
Original and corrected full-spec gzip freezes are retained for future identical
BEFORE/AFTER use; hashes and Git blobs are in the manifest/results.

`collector-proof.mjs` uses genuine Chromium and both actual unchanged collectors
without a backend, network request or UI action. It verifies early-no-reopen
`null`, independent count snapshots, count retention through context closure,
and rejection by the original `assertEmpty()` after collecting genuine browser
console/page errors. This is diagnostic collector evidence, not a product
journey or substitute for missing strict-run evidence.

Checks actually run, without Nx cache or builds:

- `pnpm generate:electronics-component-coverage` — canonical generator; only
  browser hash changes relative to f2.
- `pnpm exec prettier --check e2e/electronics-simulation.spec.ts docs/product/electronics/generated/component-coverage.json` — PASS.
- `pnpm exec eslint e2e/electronics-simulation.spec.ts` — PASS.
- `pnpm validate:electronics-component-information` — PASS, 44 component rows.
- `node tools/validate-electronics-agent-docs.mjs` — PASS, 30 components,
  4 cards, 162 task cards. The already-started canonical validation wrapper also
  finished all 114 validator self-tests PASS; no repetition is needed.
- `pnpm exec playwright test e2e/electronics-simulation.spec.ts --list --grep ELECTRONICS-525` — exactly 16 tests.
- `pnpm exec vitest run tests/production/electronics-component-coverage.spec.ts apps/web/src/electronics/testing/wire-psu-native-routing.spec.ts` — 2 files, 15 tests PASS.
- `pnpm exec vitest run apps/web/src/electronics/testing/workbench-presentation.spec.ts` — 20 tests PASS, including the existing intentional paint-order contract.
- `proof.py` and `node .../collector-proof.mjs` — PASS, detailed results retained.
- `git diff f2f94ad --check -- <two repair paths> <this evidence directory>` — PASS.
  The composed main diff also exposes one pre-existing blank-EOF warning in
  imported `psu-switch-native-hit-877/focused-tests.log:13`. That historical
  evidence remains exact f2 bytes; it was not rewritten for whitespace cleanup.

No new build, full Web suite, native91 matrix, canonical gate or CI run was
performed. Historical f2 General run `41087390394` failed Access on the unchanged
classroom teacher roster fixture (`loginHandle`, line59), before Electronics
load; its Code/Data/Governance jobs passed. That category C failure is not
repaired or represented as a green General gate here.

The original strict run `41080294495` remains cancelled, 0/16 complete. Its saved/
reopened full documents and pure checks do not retroactively supply missing
browser checks or final screenshots. New independent exact-SHA source and
final-composition review must precede one newly authorized strict BEFORE run.
No product mirror AFTER, owner acceptance, closure, release, deployment,
Docker/port/server or database action is claimed. #544/#547 remain open.

TASK: TASK-ELECTRONICS-INSTRUMENT-MIRROR-001; ISSUE: 525.
STATUS: frozen source review candidate; executor STOP after push.
NEXT_ALLOWED_TASK: independent source/final-composition review of the exact SHA.
