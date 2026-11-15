# VSCR-SAVE-DIAGNOSTICS-001 — Classroom audit point 4

**Kind:** bounded maintenance repair  
**Risk:** high  
**Issue:** #601  
**Execution:** only selected child lane `scratch-save-diagnostics`, task `TASK-VSCR-SAVE-DIAGNOSTICS-001`, with `task.status=in_progress` in `docs/execution/current.yaml` authorises edits. Existing classroom acceptance remains pending.

## Goal

Ordinary Scratch save failures reach the existing structured diagnostic logs,
including failure before a draft PUT while storing media. Owner selected point 4:
publish to main, report and STOP. No deployment or next auth repair.

## Components / contract

Primary: `blocks.host.storage-adapter`; dependencies: `blocks.host.protocol`,
`blocks.host.identity-shell` and existing shared diagnostics/outbox/API. Risk high,
cross-boundary telemetry. Read host component card, D0-001 Parent/iframe protocol
and Scratch storage adapter; preserve storage/CAS/replay/local recovery and auth.

## Expected write paths / bounded vertical dependency

- `infra/scratch-editor/host/{storage,editor,main,status}.js`: terminal save callback
  through existing host wiring; exceptions in reporting cannot interrupt saves.
- `apps/web/src/blocks/{runtime-protocol.ts,BlocksEditor.tsx}`: bound, strictly
  validated finite status → existing `autosave_failed` diagnostic.
- `apps/web/src/{client-diagnostics.ts,client-diagnostic-outbox.ts}` and
  `apps/api/src/client-diagnostics.controller.ts`: fixed failure vocabulary and
  narrowly scoped coalescing. These nine production files form one required path;
  do not create a parallel log transport or general telemetry refactor.
- Focused regressions: `tools/blocks/save-semantics.test.mjs`, runtime-protocol
  tests, existing client diagnostics/outbox/controller tests, and
  `tests/blocks/save-diagnostics.spec.ts` for cross-boundary delivery.
  `infra/scratch-editor/tests/editor-autosave.test.mjs` verifies the necessary
  editor callback wiring and disposal boundary.
- Existing cumulative gate, mapped host card and D0-001 exact protocol section;
  this task card and its selected execution lane.

## Acceptance

1. Terminal asset upload, draft write and local preparation failures emit one
   privacy-safe logical-save report, without relying on controlled exit.
2. Only fixed `scratch-save-asset`, `scratch-save-draft`, `scratch-save-prepare`
   failure codes, bounded HTTP status/duration and optional server request UUID
   cross the bridge. No raw errors, documents, URLs, code, asset IDs or credentials.
3. Parent verifies exact source/origin/project/nonce and strict new status keys;
   outbox and API validate the vocabulary. Different stages remain visible;
   duplicate stage reports and generic exit duplicates are bounded/coalesced.
4. Successful/renewed retry is not a terminal failure. Save outcomes, revisions,
   replay, recovery and rate limits remain intact. Failed diagnostics cannot
   change the save result, throw into Scratch or trigger session/logout handling.
5. Focused regression and cross-boundary evidence, lint/types/build/routing,
   self-review and independent exact final-SHA review. Report CI separately.

## Independent review

Read-only final diff challenge of sanitization, forged/untrusted messages, request
correlation, deduplication and preservation of save failure/success semantics.
Review actual focused evidence; no whole repository audit or repeated unchanged tests.

## Bounded self-review

POST_STEP_REVIEW / CHALLENGE_REVIEW per the shared protocol. Layout impact none:
no user DOM/CSS/text changes. State exactly which failures are observable and which
browser/upstream/database scenarios were not verified. Never claim a mock as real
browser/PostgreSQL or server diagnostic as a proven pupil loss.

## Stop

No upstream patch, save scheduling/CAS redesign, auth, deployment, live data,
Electronics or unrelated CI repair. `NEXT_ALLOWED_TASK: STOP`.

## Implementation evidence, 2026-10-18

- Storage publishes finite terminal asset/draft/initial-preparation failures through
  the existing editor/main/status wiring. A failed fallback upload produces one
  logical report; no report is emitted for successful token renewal/retry. Observer
  errors preserve the real save rejection and unchanged confirmed revision.
- Parent checks exact frame/origin/project/nonce, exact allowed payload keys,
  three fixed codes and bounded metadata. Existing diagnostic outbox/intake enforce
  Scratch/autosave/save context; no exception text, URLs, media/code or tokens.
- Scratch-specific dedup retains distinct stages while coalescing same-stage and
  following generic-exit duplicates. Quotas/retention/retries are unchanged.
- Focused Vitest: protocol 10, client diagnostics 9, outbox 19, API intake 6,
  cross-boundary source/storage → reporter → mounted BlocksEditor → outbox → real
  intake/structured stdout 3; existing parent lifecycle 37 and teardown 2: 86 PASS.
- Node storage semantics 18 and editor callback/disposal 6: 24 PASS. Total 110
  distinct relevant cases. Ports/HTTP/VM/DOM are test fixtures, not real Scratch GUI,
  database, browser or school-load evidence. Initial cross-boundary fixture lacked
  the normal bootstrap projectJson; corrected the fixture, without weakening checks.
- Changed-source/test ESLint passes with actual browser globals for host JS.
  API+web strict builds share one uncached Nx dependency graph: 17 tasks PASS.
  Bundle budgets PASS; initial graph 471811/600000, Electronics208465/209000 bytes.
- Local protocol browser smoke did not reach product assertions: its configured
  runtime did not expose the empty parent-origin meta required by the fixture.
  Classified local target/fixture mismatch, not PASS; no rerun/new local stack or
  fixture weakening. Browser evidence remains for isolated exact-SHA CI.
- SELF_REVIEW / POST_STEP_REVIEW: PASS; L3_CRITICAL telemetry trust boundary;
  layout impact none, viewports/visual evidence n/a. No auth, save schedule, CAS,
  replay, upstream dependency/patch, UI text/DOM/CSS, live data or deployment change.
- Asset FetchTool failures expose only the final HTTP status; no request UUID is
  invented. Draft responses retain their validated server request UUID. Errors
  before the adapter is invoked are outside this observer's scope.
- Exact final source, required independent review and CI are recorded in issue #601
  and the owner report. Stop after point4; no full-release/owner acceptance claim.
