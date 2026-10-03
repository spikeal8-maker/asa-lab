# Learning A5/V4 — dated programme evidence, 2026-10-03

This report reconciles merged A5 engineering work against the V4 visible-delivery
contract. It records evidence at the stated SHAs; the active task, checkpoint,
blocker and current remote HEAD are read from `docs/execution/current.yaml` and
GitHub. It is not owner acceptance or proof of an installed ASA journey.

## Merged engineering slices

| Slice | Exact PR head | Merge commit | Exact-head CI |
| --- | --- | --- | --- |
| [#450](https://github.com/spikeal8-maker/asa-lab/pull/450), original status and publication guard | `5ca813b4ed33118d6943e267bed7892f7cd0cfd4` | `c50cd73b23ccc2baff7f172f11169b193e37807c` | [Learning E1 36865959092](https://github.com/spikeal8-maker/asa-lab/actions/runs/36865959092) and [general 36865959095](https://github.com/spikeal8-maker/asa-lab/actions/runs/36865959095): SUCCESS |
| [#451](https://github.com/spikeal8-maker/asa-lab/pull/451), generic duplicate guard | `61341c2a771b5078204f2cadd5cf3a8d0807ddd7` | `c945a048200855e65a433813e79f18e6dc6a38e4` | [Learning E1 36875799897](https://github.com/spikeal8-maker/asa-lab/actions/runs/36875799897) and [general 36875799868](https://github.com/spikeal8-maker/asa-lab/actions/runs/36875799868): SUCCESS |
| [#454](https://github.com/spikeal8-maker/asa-lab/pull/454), original editor write guard | `ccd068a12053d7b1dfc808c46d429aac71babff8` | `be2899db361546d05d855f7894946b9d21066f6c` | [Learning E1 36891013689](https://github.com/spikeal8-maker/asa-lab/actions/runs/36891013689) and [general 36891013852](https://github.com/spikeal8-maker/asa-lab/actions/runs/36891013852): SUCCESS |
| [#455](https://github.com/spikeal8-maker/asa-lab/pull/455), server-derived learner list and actions | `a65edc28ccc1f0cd257035889c54b39b7fad4f58` | `0190ca1a447570adad3f0e9d5936da5485e6ec61` | [Learning E1 36906690770](https://github.com/spikeal8-maker/asa-lab/actions/runs/36906690770) and [general 36906690725](https://github.com/spikeal8-maker/asa-lab/actions/runs/36906690725): SUCCESS |
| [#458](https://github.com/spikeal8-maker/asa-lab/pull/458), learner archive and restore | `418b15600287c35e287c7681a49686ef71077e5e` | `c4c6216d1cb82d41e2e92183acb03839cc55499a` | [Learning E1 37110642905](https://github.com/spikeal8-maker/asa-lab/actions/runs/37110642905) and [general 37110642910](https://github.com/spikeal8-maker/asa-lab/actions/runs/37110642910): SUCCESS |
| [#467](https://github.com/spikeal8-maker/asa-lab/pull/467), accepted archive return after teacher correction | `904bbb19ae17101c621670699d7ca5cf0657f1bb` | `7a88d56db12311b1c6bc29a467558aee3cef6c95` | [Learning E1 37115694054](https://github.com/spikeal8-maker/asa-lab/actions/runs/37115694054) and [general 37115694008](https://github.com/spikeal8-maker/asa-lab/actions/runs/37115694008): SUCCESS |
| [#478](https://github.com/spikeal8-maker/asa-lab/pull/478), V4 narrow teacher correction evidence | `8a98543f04e7bb3b641fa2e7b8584f330e66ac2e` | `aca44e8dd499ae5cf133f50708b7b9cb50ce8743` | [Learning E1 37128241336](https://github.com/spikeal8-maker/asa-lab/actions/runs/37128241336) and [general 37128241303](https://github.com/spikeal8-maker/asa-lab/actions/runs/37128241303): SUCCESS |

The [postmerge general run 37116760444](https://github.com/spikeal8-maker/asa-lab/actions/runs/37116760444) also completed SUCCESS on main merge SHA `7a88d56db12311b1c6bc29a467558aee3cef6c95`, including governance, code, PostgreSQL/RLS and Access A browser jobs. Cancelled duplicate general runs on PR heads are superseded by the successful exact-head runs above; they are neither PASS evidence nor product failures.

The [#478 postmerge general run 37129217088](https://github.com/spikeal8-maker/asa-lab/actions/runs/37129217088) completed SUCCESS on main merge SHA `aca44e8dd499ae5cf133f50708b7b9cb50ce8743`, including governance, code, PostgreSQL/RLS and Access A browser jobs.

Before #478, the [#481](https://github.com/spikeal8-maker/asa-lab/pull/481) Electronics save-safety baseline repair merged at `3aa3557a9d457d84ba4dc06384c7a83c1a74a4dc` (exact PR head `fa626d970f3c787a996b41dcfc526f2e7e022015`). Its [general 37123581353](https://github.com/spikeal8-maker/asa-lab/actions/runs/37123581353), [Learning E1 37123581417](https://github.com/spikeal8-maker/asa-lab/actions/runs/37123581417) and [Electronics focused 37123581412, attempt 2](https://github.com/spikeal8-maker/asa-lab/actions/runs/37123581412/attempts/2) workflows completed SUCCESS on that head. This is a prerequisite for the #478 Learning browser journey, not A7 evidence or owner acceptance.

## Contract and browser boundary

The merged code protects proven Learning originals against generic status,
publication, duplicate and post-submission editor mutations. It derives learner
workflow and allowed actions server-side, separates a Learning Archive preference
from Project status and academic history, and allows a lawful teacher correction
to bring accepted archived work back to Active with a linked revision Attempt.
Direct and Course PostgreSQL regressions and real synthetic-browser journeys ran
in the cited Learning E1 workflows. The #467 exact-head independent review
approved the corrected origin, eligibility and history guards.

The #455 artifact `learning-e1-a65edc28ccc1f0cd257035889c54b39b7fad4f58`
contains inspected populated Active learner cards for Electronics, and Submitted
and Completed cards for Electronics and 3D, at desktop and 390 px mobile widths.
The #458 artifact
`learning-e1-418b15600287c35e287c7681a49686ef71077e5e` contains inspected
Electronics and 3D Learning Archive cards at those widths. The #467 artifact
`learning-e1-904bbb19ae17101c621670699d7ca5cf0657f1bb` contains inspected
teacher correction/history, returned Active desktop/mobile, Learning hub and
editor screenshots. Its browser test also checks the HTTP 200 Start receipt for
Attempt 2 on the same Project and the preserved database origin/history.

## V4 visual closeout and open programme evidence

`ASA_LEARNING_VISIBLE_DELIVERY_PLAN.md` requires owner-visible screenshots for
the initial state, key action/state and narrow/mobile state when responsive UI is
affected. The #478 [Learning E1 artifact 11276430810](https://github.com/spikeal8-maker/asa-lab/actions/runs/37128241336/artifacts/11276430810), named `learning-e1-8a98543f04e7bb3b641fa2e7b8584f330e66ac2e`, contains controller-inspected `a5-v4-teacher-correction-mobile.png` before the teacher action and `a5-v4-teacher-returned-mobile.png` after it at 390 × 844, plus `a5-v4-teacher-returned.png` at 1440 × 900. These complete the previously missing narrow teacher visual evidence on the exact #478 head. Together with the earlier A5 evidence above, **V4 technical and visual evidence is closed**; the #478 independent review approved its final head before merge.

A7 personal copy has not been delivered by A5; A6 rich materials, A8 teacher
review workspace and other E1 corrections/verification remain separate work.
`E1-FIX-14` and the Learning task stay in progress. Owner acceptance, release
claim and deployment authorization remain blocked. No production deployment,
working database action, backup or local staging was performed for this report.
