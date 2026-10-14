---
task_id: TASK-ELECTRONICS-SAVE-RETRY-CADENCE-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Preserve accepted 60000-ms ordinary autosave and per-edit local readback
  - Preserve published point2 and suspended 569/566 with all unrelated work
acceptance_boundary: slice
review: independent
---

# Owner point 4 — minute-spaced automatic save retries

Programme #452; Issue #571. Component `electronics.persistence.project`, ownership
cross_boundary. Owner approved this bounded point after points2/3. No new programme.

## Goal and proved cause

Current transient failure backoff retries after5/10/20/40 seconds before reaching
60000 ms. Replace that initial burst with a60000-ms delay after each transient
failure. Ordinary first-dirty autosave remains60000 ms. Later edits must neither
postpone nor accelerate the pending retry; send the latest document serially.

## Read and write boundary

Read `components/ui-assets-persistence.yaml` persistence entry and `README.md` §5.
Production writes: `apps/web/src/electronics/workbench-autosave.ts` and
`apps/web/src/electronics/use-workbench-project-state.ts` only for the retry helper
and its now-unneeded attempt counter. Focused tests: existing
`apps/web/src/electronics/testing/workbench-project-state.spec.ts` and
`e2e/electronics-simulation.spec.ts`; generated browser digest may be refreshed.
No source/test ownership change, so routing is unchanged. This is one component,
two production files and two focused test files. Both production files remain
below the large-source threshold and the hook shrinks. Hygiene006 is accepted;
canonical counted accepted production slices since it remain1 (#553); unaccepted
569/570 are preserved, not falsely counted as accepted. No due checkpoint.

## Acceptance

- Network/408/5xx and thrown transport failures wait60000 ms before each automatic
  retry; no5/10/20/40-second burst. A long request still cannot overlap another PUT.
- An edit during the delay updates immediate verified local recovery and the
  eventual retry payload, without resetting its deadline.
- A user-requested manual retry remains immediate. Existing departure safety
  rules remain unchanged, including their existing failure guard.
- Success stops retries; hard auth/permanent/conflict failures remain fail-closed.
  Identity verification, CAS409 merge, no-overwrite queue and local draft remain.
- Causal BEFORE/AFTER mounted test, one actual built-browser503/quiet-recovery
  scenario and manual exception, frozen inputs, exact checkout/build metadata.
- Canonical `pnpm gate:electronics-m1` with literal `NX_SKIP_NX_CACHE=true`, actual
  exact-SHA general CI and new independent review. One browser case is not a full
  `gate:electronics-m1:browser` result. Red unrelated CI prevents acceptance and
  release, without permission to repair a foreign module.

## Forbidden and stop

No ordinary autosave delay change, timeout/assertion weakening, auth/API semantics,
polling, local-protection regression, solver/Arduino, artwork/CSS, other modules,
installation/deployment, working DB, school, Docker or network actions. Preserve
570/569/566 and every foreign lane/blocker. No next task. Report exact source,
actual gates, independent review and residual risks, then STOP.

## Published development checkpoint — 14 October 2026

Product repair is pushed to main as one commit
`08477d7be1bde913d19dd1509035654c7607887b`, tree
`375d8204a5d1210b2a8e252f09a9fae408c0e6b5`, parent
`db94f4e7530ef2598bcbd8ce63434f481baa48c8`. This is an explicitly
**unaccepted development publication**. Issue571 remains OPEN; technical/owner
acceptance, closure and release are pending. No deployment or school action.

New independent source review APPROVE and functional acceptance PASS apply to
candidate `a418055cabe8754c1c6f884c403f8e658368e32e`, tree
`0c9ce1b8dcc96399bc5270ad18b468f510f9d42f`. A separate new independent
pre-push verifier checked the publication tree: all five reviewed blobs and modes
are identical to a418, all other4069 Git entries and modes plus current.yaml equal
the actual fresh parent db94. New foreign files were included in that comparison.
Published feature and diagnostic refs are preserved, and no569 code is included.
The combined main tree is not misreported as a new focused/browser execution.

Actual [focused/browser38616995130](https://github.com/spikeal8-maker/asa-lab/actions/runs/38616995130)
completed SUCCESS. Canonical `pnpm gate:electronics-m1`, job116034526702:
644 domain and434 editor tests PASS; literal `NX_SKIP_NX_CACHE=true`, SDK1,
typecheck42 and build27 fresh tasks, CacheSkipped. Directed built-browser
job116035905195 SUCCESS, metadata proves exact a418. Real HTTP503 is followed by
no retry at30.142s and59.014s; automatic retry starts at60.030s and saves the latest
220.5-ohm edit made during the delay. Its local copy was read back before success.
A subsequent deliberate330.5-ohm edit saves manually after102ms. Server replies
are503/200/200, and local recovery clears after confirmation. This is one browser
case, not the full `gate:electronics-m1:browser` suite.

Causal [BEFORE38616996039](https://github.com/spikeal8-maker/asa-lab/actions/runs/38616996039)
on actual source/build `fb176da2e2f4f99a04e63a5521c16896884aefcb` retained both
old production blobs and exactly the same new tests/digest. Expected failure:
second PUT after5023ms, two PUTs during30060ms with no new action. Build, database
startup and migrations succeeded. BEFORE/AFTER frozen lock/compose/registry hashes
and pinned Hub images match. Originals were downloaded once to
`C:/Users/spike/.codex/temp/electronics-e01/571-before-directed-38616996039`
and `571-after-directed-38616995130`; raw timelines, input hashes, build metadata,
server/local JSON and pupil screenshot are preserved. Author receipt and full
focused log are571-actual-receipt.json and571-after-focused-job.log in that cache root.

Source General38616758304 has completed FAILURE on exact a418:
Governance/Code/Access SUCCESS, Data116036823193 FAILURE. Its own completed Data-job log proves five
unrelated admin-logs.worker.spec.ts failures: `spawnSync python ENOENT`;3986 other
tests passed. This is categoryC relative to the two retry production files, based
on this exact run rather than an older workflow. New [exact main General38619237005](https://github.com/spikeal8-maker/asa-lab/actions/runs/38619237005)
is in progress at this checkpoint: Governance/Code SUCCESS; Data116045651628 and
Access116045651771 running. Neither observation is a repository PASS or
technical acceptance. Automatic release jobs are not a deployment performed by
this Electronics slice. No rerun, foreign-module message or repair is authorized.

Ordinary autosave remains60000ms, transient retries now wait60000ms after each
failure, manual save stays immediate and existing departure failure guards remain.
Identity/CAS, serial queue, latest-document semantics and per-edit local readback
are unchanged. Entire570/569/566 suspended records and all foreign lane data and
blockers remain preserved. A later observation of570's main General38613886264 is
CANCELLED(categoryE): Governance/Code succeeded, Data/Access cancelled before their
actual gates. Its original pending-at-observation snapshot remains unchanged.

Technical acceptance, Issue closure and release require applicable exact General
SUCCESS. Owner-authorized direct_main publication may be explicitly unaccepted
after independent source/functional approval and exact focused/browser evidence;
this does not weaken acceptance gates. Docs checkpoint uses `[skip ci]` after local
canonical governance and remote control-plane checks. STOP; no next point selected.
