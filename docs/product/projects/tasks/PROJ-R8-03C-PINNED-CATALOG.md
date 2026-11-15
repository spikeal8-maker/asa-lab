# PROJ-R8-03C — Закрепление публичных публикаций

**Issue:** #702 · **Programme:** #211 · **Selection:** only via docs/execution/current.yaml.

## User-visible slice
A verified platform_admin sees «Закрепить» / «Открепить» in Admin → Публикации. An eligible pin is a separate choice from ★ Выбор редакции, and the public Explore catalog orders pinned publications before other results server-side, across pagination, after search/module filters. Public card/detail indicate «Закреплено». Server confirmations survive page reload.

## Security and persistence
- One additive forward-only migration after the published frontier (verify number before creating); never change 0234–0238.
- Immutable revision-scoped pin, independent pinVersion CAS, expected revision/moderation/lifecycle version, Project → publication lock order.
- Only verified platform_admin; server API + SQL SECURITY DEFINER authorization; revoke direct table permissions for asalab_app; append-only audit with actor/action/requestId/change versions.
- Revoke/republish, moderation hide/restore, new published revision, archived/reactivated Project, suspended/reactivated Account retire prior pin. Do not reveal ineligible content or internal audit/person identifiers publicly.
- SQL pin-first sort before LIMIT/OFFSET. Stable remaining published_at DESC, publication_id DESC. Public response is a boolean only.
- No mutation of Working Project, Draft, ProjectVersion, student/learning records, or personal Collections.

## Boundaries
Existing admin publications UI, public list/detail projection and discovery UI, PostgreSQL safe migration, focused PG/API/real-browser tests; no additional tags/awards, reports, unlisted share, download, ratings or viewers in this slice.

## Required acceptance
1. Migration on populated DB + migration history preserved + zero replay.
2. Runtime restricted role cannot DML private pin tables, bypass role or use stale CAS; real SQL audit and concurrency negatives.
3. Hidden/revoked/ineligible resources do not appear and pins never resurrect after lifecycle transitions.
4. Real API and Chromium Playwright desktop/mobile 320/390/1440, pin/unpin/reload/order across first and later catalog pages, search/module, stale 409, admin permissions.
5. Existing #613/#672/#687/#692 regressions, exact-SHA focused and applicable general CI, independent final-SHA source/security review.
6. Ordinary merge or direct-main publishing only after mandatory gates. No live school server/deployment/production DB operations. Record NOT DEPLOYED.

Previous #692 PR is integrated; its final General run #40011685267 has Access A telemetry_unavailable and cancelled Data and remains **not full General PASS**. Distinguish that baseline debt from this slice. Do not close #211 pending full R7/R8 programme.