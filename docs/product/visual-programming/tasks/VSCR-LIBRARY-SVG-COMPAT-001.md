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
