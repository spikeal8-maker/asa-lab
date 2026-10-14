# TASK-RELEASE-UI-TELEMETRY-FIXTURE-001: bounded actor repair

Final source: d9aa03130d3e7c78fa5d7f659d4f2d7bc16accde
Branch: codex/release-ui-actor-fixture-repair, ordinary push and remote SHA verified
Canonical selection/base: 02c6c37594abc8854774d5d0f12fc2e1576e4bfe

## Cause
Full previous General improved to400PASS/2FAIL. The remaining classroom printing/layout scenarios occasionally waited long enough to flush product quality. The old fixture returned account-1/workspace-1, which are not UUIDs. Shipping TelemetryQuality generated the snapshot with that identity; the strict synthetic receipt helper correctly rejected it and the original mutation handler counted it.

## Exact repair
Only e2e/fixtures/classroom-owner.ts changed:3synthetic UUID constants and6consistent identity replacements. User/account/owner teacher share the owner UUID, listed/active workspace share the workspace UUID, co-teacher has a distinct valid UUID. No class/student IDs, API paths, assertions, receipt validators, product code, workflow or package changes. Diff1file,+9/-6.

## Meaningful cheap proof
An external temporary Node harness transpiled/imported the actual fixture and shipping TypeScript without a browser, server, database or build. It captured the real /api/auth/me handler response through fakePage.route, passed that session through shipping telemetryActor/setTelemetryContext/telemetryContext, constructed a real TelemetryQuality snapshot and submitted it through the same actual API handler. It also captured teachers to verify identity bindings.
- Before: actorValid=false, snapshotValid=false, HTTP400, business mutations1.
- After: actorValid=true, snapshotValid=true, HTTP200 persisted, business mutations0.
- User/account, listed/active workspace and owner teacher bindings remain equal; both teacher Account UUIDs valid.
Evidence: OBS-UI-ACTOR-capture.cjs, OBS-UI-ACTOR-before.json, OBS-UI-ACTOR-after.json.

## Other verification
Preflight SAFE_TO_START. Prettier check PASS. Targeted ESLint one file PASS, with existing absent cached Nx ProjectGraph warning. git diff --check/staged exact-path review PASS. Self-review confirms consistent identity replacement only.
AST preservation:1257expect call nodes across5UI specs identical; classroom fixture0assertions; original mutation-push call,15API path literals and classId declaration identical. Strict receipt helper, its29unit tests and classroom Scratch spec retain identical blob hashes. No redundant unit or browser rerun. Evidence: OBS-UI-ACTOR-preservation.json, OBS-UI-ACTOR-eslint.txt.

## Limits / handoff
Local harness proves actual fixture identity/receipt compatibility, not browser execution or layout acceptance. Historical400PASS/2FAIL is previous SHA evidence, not final source CI. Fresh independent review, full final-main General and Portable Release remain required. This author did not push main, cancel workflows or change the live site.

STOP: one bounded repair complete.
