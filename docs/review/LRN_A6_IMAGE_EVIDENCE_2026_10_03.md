# Learning A6.1 — ordered image zoom and pin evidence, 2026-10-03

This dated report records a bounded A6.1 result. The active Learning task,
checkpoint, blockers and current remote HEAD remain in `docs/execution/current.yaml`
and GitHub. This report is neither owner acceptance nor proof of an installed
ASA journey.

## Merged slice and exact-head evidence

[PR #483](https://github.com/spikeal8-maker/asa-lab/pull/483) merged at
`a969dcd80ad941f16e8beaa93c8b85bc97d1ca28` after independent APPROVE on
its exact final head `fee16a81a89b34f78f74e2ad5b297b9ca261c064`.
[General CI 37135356049](https://github.com/spikeal8-maker/asa-lab/actions/runs/37135356049)
and [Learning E1 37135356070](https://github.com/spikeal8-maker/asa-lab/actions/runs/37135356070)
both completed SUCCESS on that PR head. The first includes the repository
governance, code and data gates; the second exercised the isolated synthetic
Learning browser and database journey. The
[postmerge main general run 37136523383](https://github.com/spikeal8-maker/asa-lab/actions/runs/37136523383)
completed SUCCESS on merge SHA `a969dcd80ad941f16e8beaa93c8b85bc97d1ca28`:
governance, code, PostgreSQL/RLS and Access A browser jobs all succeeded.

The [Learning E1 artifact 11278162877](https://github.com/spikeal8-maker/asa-lab/actions/runs/37135356070/artifacts/11278162877),
named `learning-e1-fee16a81a89b34f78f74e2ad5b297b9ca261c064`, contains
the synthetic author and learner screenshots. The ordered published version 1
image is shown enlarged and pinned in `task-image-a6/published-v1-zoom-desktop.png`,
`published-v1-zoom-320.png`, `published-v1-pinned-desktop.png` and
`published-v1-pinned-320.png`. `published-v2-unavailable-320.png` records the
visible failure state. The learner's assigned Electronics project retains its
pinned material after the task card is collapsed, with
`vs-001/a6-lab-pinned-desktop.png`, `a6-lab-pinned-390.png` and
`a6-lab-pinned-320.png` in the same artifact. The test checks the author-published
version bytes and the learner's exact immutable image source; the pin uses that
source rather than a mutable draft. The screenshots were visually inspected.

## Programme boundary

A6.1 closes the ordered immutable image zoom/pin slice with desktop and 320/390 px
synthetic-browser evidence. A6 video and file/link materials remain to be built;
the complete V6 visible-delivery contract also requires those materials and
their mobile, unavailable and version behavior. A7 personal copy, A8 teacher
review, the rest of E1-FIX-13/E1 corrections, authenticated installed journey
and owner acceptance remain open. The Learning `acceptance_blocker` continues
to block owner acceptance, release claim and deployment authorization. No
production deployment, working database action, backup or local staging was
performed for this report.
