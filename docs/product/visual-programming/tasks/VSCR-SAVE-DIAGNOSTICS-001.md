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
