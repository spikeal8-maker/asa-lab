---
task_id: TASK-ELECTRONICS-COURSE-ORDER-BASELINE-001
kind: repair
risk: high
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - Proven unordered exact Course query failure c051 General38158075015 Data114526278104
  - Programme452 category C dependency selected separately under AGENTS2.1
acceptance_boundary: slice
review: independent
---

# Deterministic ordering for the exact Course assertion

Programme452 dependency [555](https://github.com/spikeal8-maker/asa-lab/issues/555), not a pupil complaint closure. Read AGENTS, START and delivery workflow. Preserve accepted545 full lane snapshot and all Electronics candidates553/554/549, Learning lane and foreign unfinished UI work.

## Cause and exact scope

Saved General38158075015 exact c051c5cfb649206379bfb30df44ceff946a78a47, Data114526278104 step12: tests/courses/activity-participations.pg.spec.ts, “submits two Course blocks sharing one handout to separate exact Attempts and Projects”. The two exact correct block/project/submission triples arrive second/first; assertion requires first/second.3512 PASS/1 FAIL. Query and learning_origin_learner_list SQL function promise no order; both are byte-identical on failed c051 and green3d861/fe501. Saved raw SHA2565815bfe7e816d0afa31c35caa59762f01d3fe415ce0cd7739c9f98162c950aaa. No new broad audit or unchanged hopeful rerun.

ONE bounded author changes ONLY that query in tests/courses/activity-participations.pg.spec.ts: append ORDER BY context->>'courseBlockId'. Preserve the entire original expected array, fixtures, every assertion and all other bytes except necessary string quoting/format. Do not change SQL function, Learning/Electronics product, RLS/auth, migrations, timeout, test configuration, workflows/gates, dependencies or school/runtime. No local PostgreSQL/stack operation. Controller owns metadata/integration/Issues separately.

## Proof and acceptance

Author fresh preflight/card and saved cause first. Meaningful source inverse proves only ordering changes and original assertions remain; narrow formatting/lint and self-review. ONE unpublished exact SHA/tree with report and hashes then STOP. Controller independently verifies actual diff and foreign preservation. NEW independent exact-SHA review required; source readiness alone is not acceptance.

One actual targeted PostgreSQL scenario in existing isolated CI: pnpm exec vitest run tests/courses/activity-participations.pg.spec.ts -t "submits two Course blocks sharing one handout to separate exact Attempts and Projects". Use original migrations, restricted runtime, frozen dependencies/image mappings/security and literal NX_SKIP_NX_CACHE=true. No SKIP/PASS without PG. The canonical focused gate is pnpm gate:data; exact General must run its unchanged Data gate plus Governance/Code/Access and all4 SUCCESS on final source. No whole Electronics browser solely for this test-query dependency. NEW final independent review considers actual GitHub and PG evidence before APPROVE and separate technical closeout. Then controller returns to saved553/554/549 without replaying accepted repairs.

No pupil issue count, owner acceptance/release/deployment claim. School/K0/T3/class/device pending. Protected data, DB, server, networks and backups unchanged. NEXT_ALLOWED_TASK for author/reviewer: STOP.
