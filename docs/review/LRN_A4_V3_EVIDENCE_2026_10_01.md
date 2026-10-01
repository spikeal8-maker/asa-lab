# Learning A4/V3 — dated engineering evidence, 2026-10-01

This report records historical merged evidence. The active task, checkpoint, blocker and live SHA are read only from `docs/execution/current.yaml`; this report is not a second execution state. The A4/V3 engineering path was present in main at the dated postmerge SHA below. The evidence does not establish full E1 or owner acceptance.

## Merged evidence

| Slice | Exact PR head | Merge commit | Exact-head checks |
| --- | --- | --- | --- |
| [#447](https://github.com/spikeal8-maker/asa-lab/pull/447), personal Learning Project badge | `d417e0fc29af784cd25aadde612a94ae8452c2fd` | `d09ad5c2e2e9e6f7094c083248a54db150fed86f` | [Learning E1 36830863275](https://github.com/spikeal8-maker/asa-lab/actions/runs/36830863275) SUCCESS; [general 36830863288](https://github.com/spikeal8-maker/asa-lab/actions/runs/36830863288) SUCCESS |
| [#448](https://github.com/spikeal8-maker/asa-lab/pull/448), repeated Direct StudentSeat Start | `2a1eae13666da11cf920abde99ad365e38986c33` | `19e9bd8e0422a674569e1613f65ded34d8eba5ea` | [Learning E1 36845180389](https://github.com/spikeal8-maker/asa-lab/actions/runs/36845180389) SUCCESS; [general 36845180061](https://github.com/spikeal8-maker/asa-lab/actions/runs/36845180061) SUCCESS |

The [postmerge general run 36847533131](https://github.com/spikeal8-maker/asa-lab/actions/runs/36847533131) completed SUCCESS on main `19e9bd8e0422a674569e1613f65ded34d8eba5ea`.

## Earlier A4 implementation lineage

GitHub reports each PR below as MERGED at the listed commit. This is implementation lineage, not an exact-head CI or acceptance claim for those earlier PRs.

| PR | Scope | Merge commit |
| --- | --- | --- |
| [#426](https://github.com/spikeal8-maker/asa-lab/pull/426) | Immutable Project origin | `71df9193fe13ae2a5d47e80c4d073d5f58ece8a2` |
| [#427](https://github.com/spikeal8-maker/asa-lab/pull/427) | Canonical Attempt numbering | `4c292b1e1936047a7ed30a4e98c7b124608e1a10` |
| [#428](https://github.com/spikeal8-maker/asa-lab/pull/428) | Atomic exact-run Start command | `782a8f477723c3e0cc97c832ccd2ede38dd2d2f8` |
| [#429](https://github.com/spikeal8-maker/asa-lab/pull/429) | Linked Seat/Account work access | `949175e8a6c30da70ac763cc8f0d607895ab2a2c` |
| [#431](https://github.com/spikeal8-maker/asa-lab/pull/431) | Immutable-origin work read | `5d49d99dd82b46577db8d5ff948c98cd88d2e863` |
| [#432](https://github.com/spikeal8-maker/asa-lab/pull/432) | Exact-origin Attempt submit | `ee0e6215dd3516d6cf9ac7369472235646bc6753` |
| [#433](https://github.com/spikeal8-maker/asa-lab/pull/433) | Origin-backed learner list | `5417bce0f59f8aa72d0176d721e7a297d66fa6ec` |
| [#434](https://github.com/spikeal8-maker/asa-lab/pull/434) | Atomic Start and Submit UI | `ec2927cddbe688eb5cff3d69af4b3c6392daa1bc` |
| [#439](https://github.com/spikeal8-maker/asa-lab/pull/439) | Close legacy non-atomic Start paths | `8f912db03040c3d331fac2b8fad53db964fd9807` |

## What the bounded evidence proves

- #447 labels authorized personal Projects with immutable Learning origin in one batch without widening the Project list. The E1 browser artifact shows an ordinary Project without the badge before Start and a Learning Project with the badge after Start on desktop and 390 px mobile. The ordinary Project remains unmarked and privacy labels remain visible.
- #448 exercises a real StudentSeat browser double action, a lost successful Start response, retry with the same request ID, and a second tab with another request ID. Both tabs, reload and Open Work resolve to the same Project, Participation, Run and current Attempt. Isolated CI database checks find one Project, one draft, one origin and one current Attempt, with two matching idempotency ledger rows.
- These final V3 checks complement the previously merged A4 origin and Start implementation in main. They establish bounded engineering evidence for the atomic Start/immutable origin and visible badge path; they are not a live owner journey or whole E1 acceptance.

The CI browser uses authenticated synthetic actors in an isolated test stack. `authenticated_live_journey: not_run` in the ledger means that no installed owner-facing authenticated journey was run.

## Remaining boundary

This evidence does not verify the entire E1-FIX-13 or E1-FIX-14 product fixes or an authenticated owner journey. A5 project protection and learning archive, A6 rich task shell, A7 personal copy, A8 teacher review workspace, and other E1-FIX-01–17 correction/verification work remain outside this reconciliation. The acceptance blocker continues to block owner acceptance, release claim and deployment authorization. No installation or working database was changed for this report.
