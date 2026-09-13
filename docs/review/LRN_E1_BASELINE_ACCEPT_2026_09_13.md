# ASA-E1-BASELINE-ACCEPT-01 — integrated baseline receipt

This is a dated integration receipt, not E1 completion, owner acceptance or deployment. Current task state is authoritative only in `docs/execution/current.yaml`.

## Accepted history

- Observed at: `2026-09-13T17:33:24+00:00`.
- Before main: `b31e113a19f6234a0504ff6bade991294b10d38b`.
- Docs [PR #208](https://github.com/spikeal8-maker/asa-lab/pull/208) exact head: `d71e8610d1b014a3981560678dd33118b233edc4`; all nine required checks passed before owner-authorized normal merge.
- Docs merge / E1 base: `14abd08bd5a5a695a34f5a31dc6742eea3e2b53a`. Its tree equals the accepted Docs head.
- Prior E1 head: `4bb5897561c657fdbdcf906a40e030d729f0d429`.
- Retargeted [PR #213](https://github.com/spikeal8-maker/asa-lab/pull/213) candidate: `fbac8cb19461f7c0b8e17ef92fe953feccf1048d`; base main. Reconciliation conflicts: zero.
- Candidate tree: `206b233852611009d56e2f77860d8c574d5e7f2b`, identical to the prior E1 head. Full E1 binary diff over the new Docs base equals the prior stacked diff (SHA256 `234efd787d8a397d7f2293512f495be94bcd9132d71e2c5d278f59adc17b432f`). No semantic changes were introduced by retargeting.
- Actual E1 baseline merge: `9b3f72ec00aeb1664c2a032f0ab269b822f0e362`. Verified origin/main equals this merge and its complete tree equals the tested candidate.

## Exact candidate validation

All 18 required checks ran and passed again on `fbac8cb19461f7c0b8e17ef92fe953feccf1048d` after retargeting. Data/browser jobs were not skipped. This includes fresh schema, populated main-before-E1 upgrade, mixed-data fixtures, migration analyzer, PostgreSQL/RLS, Learning and Access A browsers, Electronics, 3D, Scratch, Chess, Checkers, governance, code, types, API/web builds and CLA.

- [3D Core Focused](https://github.com/spikeal8-maker/asa-lab/actions/runs/34771202990): PASS.
- [ASA Lab Governance and Code Gates](https://github.com/spikeal8-maker/asa-lab/actions/runs/34771202964): PASS.
- [Checkers M1 Focused](https://github.com/spikeal8-maker/asa-lab/actions/runs/34771202913): PASS.
- [Chess R1 Focused](https://github.com/spikeal8-maker/asa-lab/actions/runs/34771202960): PASS.
- [Contribution License Agreement](https://github.com/spikeal8-maker/asa-lab/actions/runs/34771201062): PASS.
- [Contribution License Agreement](https://github.com/spikeal8-maker/asa-lab/actions/runs/34771266592): PASS.
- [Contribution License Agreement](https://github.com/spikeal8-maker/asa-lab/actions/runs/34771841879): PASS.
- [Electronics R4-M1 Focused](https://github.com/spikeal8-maker/asa-lab/actions/runs/34771203025): PASS.
- [Learning E1 Convergence](https://github.com/spikeal8-maker/asa-lab/actions/runs/34771202944): PASS.
- [Scratch Documentation Routing](https://github.com/spikeal8-maker/asa-lab/actions/runs/34771202941): PASS.
- [Scratch Focused](https://github.com/spikeal8-maker/asa-lab/actions/runs/34771202994): PASS.

Local `pnpm gate:governance` passed for Docs and the reconciled E1 candidate with `NX_SKIP_NX_CACHE=true` and `NX_DAEMON=false`. No cached result is counted as new evidence. Independent exact-SHA Docs and E1 challenge reviews passed. The unchanged runtime/test blobs preserve the earlier detailed semantic reviews in [the convergence receipt](LRN_E1_MAIN_CONVERGENCE_2026_09_13.md).

Thirty additive migrations retain 0107–0136 numbering; no collision or modification of a main migration. Preview B, ordinary author last_seen_at heartbeat, no academic/learner mutations and no credential refresh after Preview 401 are preserved. Migration 0137 and a special Identity Preview resolver remain absent. Attempt lifecycle, selected Result/Gradebook projection, one-time StudentSeat batch credentials/idempotency and exact immutable project evidence are unchanged.

The earlier 4bb58975 Electronics native-touch attempt had 50/51 passes, followed by one unchanged-SHA 51/51 pass. Its trace showed a fixed tap outside the canvas; the cause of viewport movement was not proven. The new candidate's actual Electronics outcome is independently recorded by its linked workflow; no Electronics source/test/workflow was changed during baseline acceptance.

Chess workflow `34771202960`, attempt 1 on the new candidate, passed navigation (5/5) and local Chess (4/4), but one of two live scenarios failed at the first rating assertion after resignation. Preserved trace shows the white rating GET completed about 13 ms before the successful resign POST response; the following black rating read already returned 1176 with one rated game. Independent review confirmed that the test waits for polled winner text while rating persistence finishes separately. One diagnostic failed-job rerun on the unchanged candidate passed navigation (5/5), local Chess (4/4) and live Chess (2/2). The initial failure remains disclosed. No Chess product code, test assertion, timeout or workflow was changed, and no wider atomicity fix is claimed.

## Post-merge execution receipt

The separate `docs(execution): record integrated E1 baseline` commit changes only current.yaml and this receipt. It uses the existing single-history shape without a `kind` discriminator: head_sha and product_merge_sha identify the actual E1 merge above. convergence_baseline_sha retains historical common ancestor `b963ef828f0e10042adacba4199bba972526c0df`; main/observed_at are a dated post-merge snapshot, not a promise to track later main commits.

Before this state commit was pushed, main incorporated reviewed Scratch normalization and selected VSCR-M1-002D in `e1a28c4f3eb9810487a9195f75e4c1f62caa0abe`. The push guard stopped the unpublished state commit. Its Learning-only changes were reapplied without conflicts on that new main; the Scratch task and gates remain exactly as selected there. The final state commit has that Scratch merge as its parent and still records `9b3f72ec00aeb1664c2a032f0ab269b822f0e362` as the actual E1 integration baseline. The earlier main/observed_at snapshot remains explicitly historical.

TASK-LRN-COURSE-001 remains in_progress with owner_acceptance pending. The checkpoint records baseline integration only. Normative V1.4/2.1 references, accepted Access A Users 2.0 pin, current Scratch task selection, other lanes, gates and blocking fields are unchanged. Recovery and bounded-review observations remain historical; their remote SHA equality was checked explicitly because legacy single-history validation does not itself validate those observations.

- Learning recovery: `recovery/e1-learning-20260913` at `8ea7771d902d92f5288685a031b134feb353f4cc`.
- Docs recovery: `recovery/docs-foundation-20260913` at `ea3ad1a8e092e0e7681f9900bc99b3709550783c`.
- Preview evidence: `codex/e1-preview-stabilized-20260913` at `dce140868601b55c9a5449b38012e297c116d8be`; [PR #210](https://github.com/spikeal8-maker/asa-lab/pull/210) was closed without merge on 2026-09-13 after [recording incorporation through the E1 baseline](https://github.com/spikeal8-maker/asa-lab/pull/210#issuecomment-5654912439). Its branch is retained as bounded evidence. Owner acceptance remains separate.

Post-state-commit CI and the final published main SHA are attested in the final task report; they cannot be self-embedded in their own commit. Production Docker, databases, dumps, volumes and owner assets are untouched.

## Remaining owner decisions

Historical published-version draft recovery; Teacher Home attention block; full class archive/restore acceptance; broader reminder/mixed-history acceptance; final complete E1 journey; owner acceptance; release hardening and deployment decision remain open. No new E1 slice, E2 or E3 is started. STOP for the owner to select one remaining E1 slice.
