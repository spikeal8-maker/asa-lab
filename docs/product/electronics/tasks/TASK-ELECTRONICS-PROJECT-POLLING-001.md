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
