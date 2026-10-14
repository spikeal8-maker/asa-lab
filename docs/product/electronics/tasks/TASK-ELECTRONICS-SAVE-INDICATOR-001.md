---
task_id: TASK-ELECTRONICS-SAVE-INDICATOR-001
kind: repair
risk: low
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Preserve accepted 60-second autosave and immediate local recovery protection
  - Preserve blocked cross-tab candidate 566 without integration or repair
acceptance_boundary: slice
review: independent
---

# Owner point 1 — truthful saving feedback

Programme #452; Issue #569. Primary component: `electronics.persistence.project`.
This is presentation only: pending edits must not pretend a network save is active.

## Scope

Change `apps/web/src/components/editor-chrome/EditorPersistenceIndicator.tsx`, its
mounted tests and one directed case in `e2e/electronics-simulation.spec.ts`.
The only runtime consumer is Electronics `WorkbenchHeader`; retain its status
and current-document `localCopySaved` source of truth. Add the source/test mapping
to `components/ui-assets-persistence.yaml`; regenerate only the canonical source
coverage digest if needed.

## Acceptance

- Dirty means waiting for server upload. Explain a local browser copy only when
  the current document has confirmed readback; otherwise promise no durability.
- Saving is shown only during an actual request; success only after current
  document acknowledgement. Preserve error, offline, auth and conflict honesty.
- Mounted transitions cover immediate status changes and stale success removal.
- One actual built-browser scenario records no PUT before the existing minute
  deadline, the waiting label, a held real request, then acknowledgement feedback.
- Check 1440/1024/390/320 layout and screenshots 1440/390; no page overflow.
- Focused component/project-state tests, Electronics focused gate, applicable
  repository gate and new independent review on the exact final SHA. Built-browser
  evidence uses the existing isolated CI recipe and frozen dependencies with
  literal `NX_SKIP_NX_CACHE=true`; a directed diagnostic is not a whole-gate PASS.

## Forbidden and stop

Do not change autosave interval, scheduler, polling, retries, local draft storage,
API/auth, physics, Arduino, assets, other modules or #566. No Docker installation,
school, working database or network action. Existing checks/timeouts stay intact.
Preserve all candidates and all other lanes. Report point 1 and STOP; no point 2.

## Blocked checkpoint — 14 October 2026

Preserved final candidate `d3d417cfd1aaeafe2d037e428298c60d57a8bb3d`, tree
`36fbfb94fe32d7ed8358128f107d912b545dd29b`, branch
`codex/electronics-save-indicator-569`. The single final convergence retains all
six slice files byte-for-byte from `85cee9ab`; all foreign main/current state was
preserved. Product code is **not integrated in main**. No Issue closure,
deployment, database operation or owner acceptance is claimed.

The bounded R1 additionally changes only saved-state CSS opacity to1 so the
existing1400-ms acknowledgement is visible. The900-ms presentation delay and
60000-ms autosave interval remain unchanged. Independent source/visual review
found no remaining slice defect, but its final verdict is **BLOCKED** by the
required common gate below; this is not technical acceptance.

Exact candidate evidence: [directed run38603937841](https://github.com/spikeal8-maker/asa-lab/actions/runs/38603937841)
focused job115989895473 SUCCESS: canonical `pnpm gate:electronics-m1`,644 domain
+431 editor tests, plus7 otherwise uncovered indicator tests. Literal
`NX_SKIP_NX_CACHE=true`; NxSDK1/typecheck42/build27 tasks Cache Skipped. Browser
job115991080347 SUCCESS: actual Web metadata provesd3, zero PUT while pending
with verified local copy, one held real200 request, visible saving then visible
acknowledged saved. Effective opacity1 includes the ancestor chain; responsive
1440/1024/390/320 and ACK1440 PNG passed. This is one directed case, not the full
browser gate. Artifact11914598066:4254575 bytes,33 CRC-checked entries, SHA256
`7b0cb2095ab38014473d87811606ff9a69750bf77a0c8015b4090cf3b463be11`.

[General38603732138](https://github.com/spikeal8-maker/asa-lab/actions/runs/38603732138)
on exactd3, attempt2: **FAILURE**. Governance/Code/Access SUCCESS. Initial Data
job115991747220 failed before tests because pinned Node ECR manifest returned429
Data limit exceeded (categoryD). One authorized failed-Data-job-only retry
116000847298 passed image build and ran the canonical `pnpm gate:data`; no
successful jobs were repeated. It failed one unrelated Observability fixture:
`apps/api/src/admin-logs.worker.spec.ts:23`, “keeps all nine newly collected
database sources private through query and ZIP paths”: `spawnSync python ENOENT`
while creating its fixture, before the expected18-record/privacy assertions.
421 files/3972 tests passed, one test failed. The test blob equals main7e;
latest checked maincf29 still contains the Python call and unchanged Dockerfile.
ClassificationC does not authorize repairing Observability inside569.

Shared evidence cache `C:/Users/spike/.codex/temp/electronics-e01/` contains the
once-downloaded browser ZIP/timeline/screenshots, canonical focused log and
`569-final-general-data-attempt2-failedstep.log` (SHA256
`96d1b9e588491d20d51208e50568ffab45b4c895fb81fd6d22ff3cc280b76d51`).
Cancelled duplicate/incorrect runs38603809262/38603813523 are not acceptance
evidence. The one authorized retry is exhausted; no blind rerun is permitted.

Resume only after the concrete external fixture dependency has a separately
accepted fix, fresh remote/current/dirty checks and required exact gate evidence
+new independent acceptance. Preserve all other lanes and suspended566 in full.
STOP point1; points2–4 are not selected. Deployment and school actions remain
not requested.

## Owner-authorized four-point completion — 14 October 2026

The owner now requires all four approved saving/server-request points in main
and verification together. This bounded completion transfers only the preserved
indicator source, its CSS and compatible tests onto the current main which
already contains the polling and retry repairs. It preserves immediate local
draft protection; no additional storage repair is selected. The previous
checkpoint above remains historical evidence, not authorization or acceptance
of this new combined version.

Verify the existing three directed production-browser cases together: truthful
pending/request/visible acknowledgement, no blind idle project polling with
safe focus reconciliation, and minute-spaced transient retries with immediate
manual save and latest local document. Run canonical `pnpm gate:electronics-m1`
with literal `NX_SKIP_NX_CACHE=true`, the otherwise uncovered mounted indicator
tests, applicable exact General, and a new independent review of the combined
SHA. Reuse saved causal BEFORE evidence; no repeated baseline measurement is
required. Preserve the 570/571 cases and update only the generated source digest.

The existing 569 acceptance blocker's cause and prohibited acceptance actions
remain. The latest explicit owner instruction additionally permits unaccepted
development publication in main after new independent source/functional approval
and successful exact focused and all three directed browser cases. This scoped
permission is recorded in the blocker's `allows`; its `integration` restriction
continues to prohibit technically accepted integration. It does not close the
external cause or allow repository success, technical acceptance, Issue closure,
release, owner acceptance or deployment while required gates are unmet. Preserve
the entire previous 571 task and suspended 570/569/566 records and all unrelated
lane state.

No unrelated module repair, additional original-owner problem, school/runtime
update, database or network operation is included. Report the four-point result
and STOP.
