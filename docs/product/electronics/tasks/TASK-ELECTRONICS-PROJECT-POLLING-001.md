---
task_id: TASK-ELECTRONICS-PROJECT-POLLING-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Preserve accepted minute autosave and immediate local recovery protection
  - Preserve suspended candidates 569 and 566 and all other lanes
acceptance_boundary: slice
review: independent
---

# Owner point 2 — stop blind project polling

Programme #452; Issue #570. Primary component: `electronics.persistence.project`.
The owner selected this point explicitly and authorized main publication after checks.

## Scope

Remove the unconditional 3000-ms project GET timer from
`apps/web/src/electronics/use-workbench-project-state.ts`. Keep initial load,
clean/ready/stopped focus refresh, the in-flight guard, dirty/save/error guards,
late-response protection and CAS409 reconciliation. Existing focus is the user
return signal; no new background timer or teacher monitoring mode is introduced.
Write focused mounted cases in the existing project-state test and one real
production-browser case in `e2e/electronics-simulation.spec.ts`.

## Acceptance

- A clean idle editor makes no periodic project GET, demonstrated BEFORE/AFTER.
- One clean focus refresh can receive a newer remote revision.
- Dirty focus makes no GET; edits made after a GET begins survive its late reply.
- Initial open and CAS409 three-way recovery retain their existing coverage.
- The 60000-ms autosave deadline, local immediate readback, manual/exit saves,
  authentication, retries, physics and API behavior remain unchanged.
- Canonical `pnpm gate:electronics-m1` with `NX_SKIP_NX_CACHE=true`, actual directed
  built-browser evidence on frozen dependencies, applicable repository gate and
  independent review of the exact final SHA. A directed case is not the full
  browser gate. Preserve all suspended work; integrate only after required checks.

## Forbidden and stop

No API/server analysis removal, auth, telemetry, solver/Arduino, artwork, CSS,
other modules, school installation, working DB, Docker or network changes.
Do not increase timeouts, weaken assertions or change local protection/retry.
No point3/4. Report exact candidate/evidence and STOP for independent review.

Hygiene006 is accepted; canonical counted production count since it is1 (#553),
so no due hygiene checkpoint precedes this narrow reduction. No new production
source or large-file growth is introduced.


## Published development checkpoint — 14 October 2026

Point2 product code is pushed to main as one squash commit
`74a348a33e64731c670746fd8bd23349fb584f20`, tree
`921df699b565fde4875e8cfdbe9f0b47ef8a31c6`, parent
`d4659e5c6a0d7025ab73eada73e7451aeae10df4`. This is explicitly an
**unaccepted development publication**; Issue570 stays OPEN, technical/owner
acceptance and closure are pending. No deployment or school action occurred.

Independent source review APPROVE and functional review PASS apply to source
candidate `88d1360c532bff3d1fab7f31167f9999ff3ee512`, tree
`8276203a10d8da465b478d96ce17dc50ff63a159`. A new independent preservation
review verified all four published slice blobs/modes equal88 and all other4066
Git entries/current.yaml equal fresh main d465. Published feature/diagnostic refs
remain unchanged. Suspended569/566, all other lanes and their blockers are retained.
The combined main tree was not falsely described as a new focused/browser run.

Actual focused evidence [38611413891](https://github.com/spikeal8-maker/asa-lab/actions/runs/38611413891)
job116015459688 SUCCESS: canonical `pnpm gate:electronics-m1`,644 domain and433
editor tests PASS. Literal `NX_SKIP_NX_CACHE=true`; SDK1, typecheck42 and build27
fresh tasks, CacheSkipped. Directed built-browser job116016934140 SUCCESS:
metadata proves88, idle10s0GET; cleanfocus1GET receives a remote revision; late
held GET cannot overwrite a new pupil166.7-ohm edit or its byte-identical local
copy; dirtyfocus0GET. Existing timeouts/cadence/identity/CAS/retries are unchanged.
This one case is not a whole `gate:electronics-m1:browser` PASS.

Causal [BEFORE38611133072](https://github.com/spikeal8-maker/asa-lab/actions/runs/38611133072)
on old production blob aacc15dc with new test ba75631f failed exactly idle0GET
assertion:3requests at3000-ms intervals during10s. Frozen lock/compose/registry
input hashes and pinned image digests equal AFTER. Artifacts are cached once in
`C:/Users/spike/.codex/temp/electronics-e01/570-before-directed-38611133072` and
`570-after-directed-38611413891`; receipts include originals, CRC, SHA256,
source/build metadata, timelines and pupil screenshot. Source review record
`570-independent-review-88d1360c.md` SHA256
`24acd3b620a61ebe88cd31b84bf9d185eb1ce8537d0b7eb841590f7b7d81125b`.

Old feature General38611291291 had Governance/Code SUCCESS, Data116018207204
FAIL in3unrelated Observability Python fixtures (`spawnSync python ENOENT`,
admin-logs.worker.spec.ts44/891;3981tests passed), Access still running when
observed. No foreign repair/rerun is authorized. Fresh product publication
[main General38613886264](https://github.com/spikeal8-maker/asa-lab/actions/runs/38613886264)
on exact74a is **PENDING** at this checkpoint; the old feature conclusion is not
transferred to the combined main SHA. No repository PASS, acceptance or release
claim is made. Documentation checkpoint uses `[skip ci]` after local canonical
governance/control-plane checks; its own SHA has no remote-CI claim and does not
cancel/repeat the product workflow. Root reports before selecting another point.

## Four-point technical acceptance — 14 October 2026

Owner point2 is technically accepted through bounded completion569. Blind3000-ms project polling is removed; initial load, clean focus, CAS409 and late-GET protection remain. Immediate local protection (owner point3) is preserved and verified, with no new storage repair.

All four approved saving points are present in main
`387a4d02294ac1ffc9309a5e4a24e2ceff64d84c`, tree
`9e1fb353e5b4dd0e0a5d73c211b5480f9288dfc0`. New
[exact-main General38626738375](https://github.com/spikeal8-maker/asa-lab/actions/runs/38626738375)
completed SUCCESS: Governance116067686618, Code/types/build116068469409,
Data/PostgreSQL/RLS116070835413 and Access116070835621 all SUCCESS. This is the
actual main gate, not a transferred status from an older candidate.

A new final independent reviewer approved this exact main SHA with no findings,
including all six owned blobs/modes equal the reviewed source and all4072 foreign
entries/modes plus entire current.yaml preserved from its fresh parentdd686675.
Original report: `C:/Users/spike/.codex/temp/electronics-e01/four-points-final-main-independent-review-387a.md`,
SHA256 `90fd4abbd15a595ed80db2fea30e6cb0c7ca3e5939f5b09760730d449a20bc1b`.
The source review and functional/layout evidence belong to
`bdcda1b037b5d5840380126566ca9e436e4ec8fc`: [run38623487785](https://github.com/spikeal8-maker/asa-lab/actions/runs/38623487785)
SUCCESS, canonical `pnpm gate:electronics-m1`644 domain+434 editor and7 mounted
indicator tests;70 fresh Nx tasks, literal `NX_SKIP_NX_CACHE=true`. The three
directed built-browser cases pass: visible ACK with0 pending PUT,0 idle GET/10s
and preserved166.7 local copy, automatic retry60030ms/latest220.5 and manual
99ms/latest330.5. All product/runtime/build inputs between source and main were
independently verified equal; the source browser run is not falsely reported as
a new main run or a full ordinary browser gate.

Artifact11924045867:4600160bytes/39CRC entries, SHA256
`01203dfd2e657eb9b60274964e11ca8259062586b0c3fbcae9d405b302167f9a`.
Saved causal BEFORE and previous candidate/failed-CI records above remain
historical evidence. The new accepted_slices records for569/570/571 supersede
their unchanged historical suspended snapshots. Only the569 acceptance blocker
is resolved by the successful exact main gate and new independent approval.

This closes these bounded technical repairs only. Owner acceptance of the
installation/programme remains pending, deployment not_run. #566 cross-tab loss
repair and #452 remain open; school hardware evidence is separate. No other
complaint is accepted or activated, no working DB/network/installation action
was performed. STOP after the four approved points.
