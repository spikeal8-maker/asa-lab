# Learning A6.2a — immutable PDF task file evidence, 2026-10-03

This report records the bounded A6.2a PDF result. The active Learning task,
checkpoint and blockers remain in `docs/execution/current.yaml`. This report is
neither owner acceptance nor proof of an installed ASA journey.

## Merged slice and exact-head evidence

[PR #486](https://github.com/spikeal8-maker/asa-lab/pull/486) merged at
`44aa8088fded6236b2bd95a5ddec75585b6bf8b6` after independent review of
its final head `ff14f0a4315776b746df299be2b37226e7c30ea1`.
[General CI 37141857611](https://github.com/spikeal8-maker/asa-lab/actions/runs/37141857611)
completed SUCCESS on that head, including governance, code, PostgreSQL/RLS and
Access A browser jobs. [Learning E1 37141857631](https://github.com/spikeal8-maker/asa-lab/actions/runs/37141857631)
also completed SUCCESS on that exact head: fresh and populated database upgrade,
restricted runtime regression and the isolated teacher/learner browser journey.
The [postmerge main General run 37142913495](https://github.com/spikeal8-maker/asa-lab/actions/runs/37142913495)
completed SUCCESS on merge SHA `44aa8088fded6236b2bd95a5ddec75585b6bf8b6`:
governance, code, PostgreSQL/RLS and Access A browser jobs all succeeded.

The [Learning E1 artifact 11280379499](https://github.com/spikeal8-maker/asa-lab/actions/runs/37141857631/artifacts/11280379499),
named `learning-e1-ff14f0a4315776b746df299be2b37226e7c30ea1`, contains
synthetic browser evidence under `e2e/artifacts/learning/vs-001/`:
`a6-file-author-published-desktop.png`, `a6-file-author-published-390.png`,
`a6-file-learner-desktop.png`, `a6-file-learner-390.png`,
`a6-file-learner-320.png` and `a6-file-unavailable-320.png`.

The teacher can upload one PDF task block up to 400,000 bytes in the canonical
ordered editor, preview the draft and published version, then assign the
published version. The learner sees the file name and PDF type and downloads the
file as an attachment. The browser test verifies exact published bytes and that
an existing Direct assignment keeps version 1 bytes after the teacher publishes
version 2; the learner cannot fetch version 2 without its own assignment. The
PostgreSQL regression checks Direct and Course Activity exact-version access,
excluded viewers, immutable version media, replacement and restore. Invalid
media and the size boundary are checked by focused API/database tests. The
mobile screenshots include 390 and 320 px learner views and an unavailable-file
state.

## Programme boundary and current priority

A6.2a closes only the immutable PDF material slice. Video, other file formats,
the complete link journey and full V6 visible-delivery contract remain open.
The new media endpoints are not yet described in `schemas/openapi.yaml`; that
documentation needs a separate bounded reconciliation before full API contract
closure. A7 personal copy, A8 teacher review, other E1 corrections, authenticated
installed journey and owner acceptance also remain open.

Owner review on 2026-10-04 selected visible-first V-UX2A Assignment list as the
next Learning UX slice in `docs/execution/current.yaml` and
`docs/product/learning/ASA_LEARNING_UX_REDESIGN_SPEC.md`. Recording this earlier
PDF result does not change that selected priority or authorize more A6 backend
or media work. No production deployment, working database action, backup or
local staging was performed for this report.
