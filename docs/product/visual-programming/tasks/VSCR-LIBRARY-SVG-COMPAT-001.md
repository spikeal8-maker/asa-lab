# VSCR-LIBRARY-SVG-COMPAT-001 — Classroom audit point 3

**Kind:** bounded maintenance repair  
**Risk:** high  
**Issue:** #599  
**Execution:** only the selected `scratch-library-svg` child lane in `docs/execution/current.yaml` with task `TASK-VSCR-LIBRARY-SVG-COMPAT-001` and `task.status=in_progress` authorises implementation. Preserve the existing classroom milestone and its pending acceptance.

## Goal

Save and reopen projects containing the observed built-in Scratch SVG
`1e2c3987e4cdb1f317b1773662719b13.svg`, preserving its original bytes and identities.
Owner selected audit point 3 only; publish to main, report and STOP. No deployment.

## Components / ownership

`blocks.assets.upload`: cross_boundary, high. Direct dependencies: existing asset
metadata/read and Project Core save/open guards. Read `components/assets.yaml` and
D0-003 sections 8–9, 11 and 17; preserve tenant, integrity and permission boundaries.

## Compatibility/security decision

The exact 586-byte asset (SHA-256
`56a5e1d10eefec3ee23ca969e01d809d8488bf57f56733c36f57639f548fb93b`)
has a standard SVG 1.1 PUBLIC declaration, rejected by the blanket DOCTYPE rule.
Proposed exception: only that standard SVG 1.1 public identifier and its exact W3C
system identifier (HTTP/HTTPS, XML whitespace and either quote style). No internal
subset, entities, arbitrary external DTD, active content or remote resource URLs.
Saxes validates syntax without resolving/loading DTDs. Validate the declaration as
inert text, retain all other checks and store the unchanged stream bytes/hashes.
Do not strip/rewrite the uploaded XML, alter hash links or add a client migration.
Independent security design review is required before implementing the exception.

## Expected write paths

- `apps/api/src/blocks-asset-upload.ts`: narrow declaration allowlist.
- `apps/api/src/blocks-asset-upload.spec.ts`: exact original, safe variants, negative
  DTD/entity/active-content cases, hash/cleanup/durable-write invariants.
- `apps/api/src/testing/fixtures/scratch-library/1e2c3987e4cdb1f317b1773662719b13.svg`:
  exact audited upstream library bytes; fixture provenance beside it.
- `tests/blocks/library-svg-roundtrip.spec.ts`: real upload/save/open/read composition
  with in-memory ports; not a real browser/database claim.
- `tools/blocks/gate.mjs`: register the cross-boundary regression in the existing gate.
- `.prettierignore` / `.gitattributes`: preserve only this exact hash-addressed
  fixture's bytes during formatting and Windows/Linux checkout.
- D0-003 section 9.1: the intentional reviewed compatibility exception, not blanket
  disabling of validation; `components/assets.yaml`: test mapping; this card/lane.

## Acceptance / checks

1. Exact file and benign declaration variants upload without changing bytes, MD5,
   SHA-256 or size. A project retaining that media saves and opens with the same
   asset and existing server guard; asset read returns the same bytes.
2. Unknown external declarations, internal subsets/entities, malformed XML, scripts,
   foreignObject, event handlers and external resource references still fail before
   durable writes. Filename/hash mismatch, upload limits and cleanup remain intact.
3. Focused tests, changed-source lint/format, API typecheck/build and routing pass;
   self-review and independent final-SHA security review. Exact-SHA CI reported
   separately from local fixtures and production acceptance.

## Independent review

Read-only security review of the proposed exception before code; then exact final
diff review for bypasses, entity/network resolution, byte identity, scope and storage
failure order. Repairs remain within this point. No whole-repository audit/reruns.

## Bounded self-review

Use POST_STEP_REVIEW / CHALLENGE_REVIEW per `docs/agent/review-protocol.md`.
Verify the selected outcome, all negative checks, immutable data and unchanged
actor/tenant access. DOM/CSS/layout impact: none. Real browser/DB/classroom load
are separate evidence; no readiness claim from mocks. Record exact test evidence.

## Stop

Do not begin point 4 save-failure diagnostics, auth, Electronics, unrelated CI repair,
upstream changes, Docker/site deployment or live data operations. `NEXT_ALLOWED_TASK: STOP`.

## Implementation evidence, 2026-10-18

- Independent compatibility/security design review: PASS before the exception was
  implemented. Installed Saxes behavior inspected: declaration callback is inert,
  contains internal subsets verbatim and does not resolve external resources.
- Reproduced the exact 586-byte asset failure in the existing capture pipeline;
  after repair it retains the original bytes, MD5 and SHA-256. Strict callback
  allowlist uses XML whitespace, matching quotes, exact identifiers and full-string
  equality, including rejection of trailing Unicode line separators.
- Upload suite: 68 PASS, including exact fixture, 3 safe declaration variants,
  20 forbidden DTD forms, 10 active/XML/external-content cases with allowed DTD,
  and existing format/size/hash/storage/immutability/budget regressions.
- Actual upload/save/open/asset-read composition with in-memory adapters: 1 PASS;
  repeated upload stays idempotent, all document/code/media survive, missing metadata
  prevents revision advance, and another tenant cannot open/read the project.
- Existing reader 10 PASS, runtime controller 7 PASS and CORS 3 PASS. Total: 89
  distinct relevant passing cases. No browser, PostgreSQL or S3 proof is claimed.
- Changed-file ESLint/Prettier, routing and diff hygiene: PASS. Strict API build and
  fifteen dependencies: PASS, 16 tasks executed with Nx cache skipped. No frontend
  or pinned upstream rebuild was needed for the local backend check.
- POST_STEP_REVIEW: PASS; CHANGE_CLASS: L3_CRITICAL (upload trust boundary);
  USER_RESULT: safe library SVG can retain identity through guarded save/open;
  INVARIANTS_TOUCHED: D0-003 reviewed declaration exception only;
  LAYOUT_IMPACT: none; VIEWPORTS: n/a; VISUAL_EVIDENCE: n/a;
  NEGATIVE_CHECKS: DTD/entities/active content/hash/limits/tenant/storage failure;
  DOC_DRIFT: D0-003 section 9.1 intentionally amended with the reviewed exception;
  UNVERIFIED: real browser/database/classroom load and exact-SHA general CI.
- CHALLENGE_REVIEW and published exact-SHA CI are recorded in issue #599 / owner
  report when complete. Existing baseline General CI failed only the unrelated
  journal width check (200px versus >=210px); no journal repair or rerun in this point.
