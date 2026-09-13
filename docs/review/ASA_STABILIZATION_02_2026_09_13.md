# ASA-STABILIZATION-02 — documentation and execution review

Technical stabilization receipt, 2026-09-13. Proposed state in Draft PR [#208](https://github.com/spikeal8-maker/asa-lab/pull/208), not a main merge, deployment or owner acceptance.

## A. Initial GitHub snapshot (before implementation)

| Reference | Exact commit / state |
|---|---|
| fetched origin/main | `982f637709898c9751e81e75f44d2b63f34516e4` |
| #208 base/head | main / `f3bb673c097f79972da5987efb6457ea64dcd3e5`; OPEN, Draft |
| docs recovery | `ea3ad1a8e092e0e7681f9900bc99b3709550783c` |
| Learning recovery | `8ea7771d902d92f5288685a031b134feb353f4cc` |
| Preview | `8b0d9bed481e5385e9f2bec3606513a7a5e2627c` |
| main...Preview | merge base `b963ef828f0e10042adacba4199bba972526c0df`, Preview ahead 3 / behind 69 |
| recovery...Preview | ahead 2 / behind 0, 16 changed files |

The initial #208 list contains 12 commits and 39 files: the documentation/context foundation, snapshots, amendment and its convergence receipts. Both immutable recovery refs were confirmed on GitHub, as were the current Preview ref, #208 head/base, full commit/path lists and exact-SHA workflows. Raw snapshot and logs are in the task runner report directory; current durable changes and receipts are published in GitHub.

Initial #208: [repository workflow 34753613364](https://github.com/spikeal8-maker/asa-lab/actions/runs/34753613364) passed governance/code/PostgreSQL/Access A; Electronics browser failed in attempt 1. Initial Preview: [34753382321](https://github.com/spikeal8-maker/asa-lab/actions/runs/34753382321) failed inherited Prettier and skipped downstream jobs. No stale/cancelled workflow is counted as a final pass.

## B. Documentation

Integrated V1.4 §3 now exposes all TARGET E2 banks/programming/assessment foundations and E3 discovery/access modes. §5 has assignment library, Question Bank/Quiz, ProgrammingTaskVersion, autograder, scoped temporary participants, distinct windows/timer, same-Attempt reconnect and explicit expiry policies. The canonical result chain stays shared by Python/Quiz/Electronics. §6 makes Knowledge discovery over the same library, with public/unlisted/read-only/self-study/teacher-led modes; publish != public and URL != authorization. Commerce is future, not an E3 blocker.

§10 retains **17 templates**, mapping banks/builders/participant access/class history onto existing templates/tabs. §11 names the requested content, class and assessment actions without exposing imaginary E1 buttons. §21 is retained as detail; its sections are cross-referenced correctly. §4.4 and LRN-PRV-001 clarify only the permitted existing author session heartbeat, not learner/academic writes.

Users 2.1 §40 explicitly retains persistent StudentSeat and excludes a new Account type, Auth system, Personal Workspace and automatic roster membership for temporary access. Exact-target scope, no unrelated data and bilateral linking proof remain. Learning 2.1 §88 was reviewed and retained: immutable Submission, append-only results/correction, selected result, CourseRun pins, lifecycle/result separation and server time remain consistent; no replacement academic pipeline was introduced.

PRG-001/002/003, ACC-ASM-001/002/003/004 and CAT-PRG-001 remain target with empty evidence/tests. No runner or E2/E3 implementation was added. Registry canonical IDs remain PRODUCT-INTEGRATED-V14@1.4, IDENTITY-ACCESS-V21@2.1, LEARNING-MASTER-V21@2.1; old editions stay superseded/authority none. Accepted Access A remains IDENTITY-ACCESS-V20@2.0.

Historical snapshot checksums, unchanged:

- `ASA_INTEGRATED_IMPLEMENTATION_SPEC_V1_3.md`: `155b419eb68f400eb74c39c2d77eb08493237d7ee28a938612974fdd34e99545`.
- `ASA_USERS_ACCESS_AND_SETTINGS_SPEC_V2_0.md`: `1121d062ba8b99f4ba77eaf241a5213d90838d8245755f2d6bc92ffe5ac59ae6`.
- `ASA_LEARNING_TECHNICAL_SPEC_V2_0.md`: `cb4eb424c0dfb497eba2440be35d5119542443dd563ed1c2359592fab6f81ee5`.

Targeted rendered contexts (all actual `pnpm agent:context --control` commands): Gradebook 3283 chars; batch Seats 1947 chars; Preview 2806 chars. Each is well below 8000 and retains targeted invariant/escalation routing rather than the full Master.

## C. Truthful Learning revision state

Previously direct_main ignored remote task-branch/PR fields while agent context rendered b963ef8 as head_sha. The value was historical and could be mistaken for actual main or the saved E1 work.

Schema 1.2 adds bounded `split_history` observations. `task.branch: main` is the delivery target; `head_sha: null` states that no integrated candidate exists; b963ef8 is labelled the historical common ancestor. Dated main/recovery/bounded_review refs are separate, with Preview pinned to recovery as its base. Shape validation cannot prove remote freshness; contexts explicitly require fresh GitHub fetch/CI and make no authority claim. The current observation uses main `982f637709898c9751e81e75f44d2b63f34516e4`, recovery `8ea7771d902d92f5288685a031b134feb353f4cc`, Preview `dce140868601b55c9a5449b38012e297c116d8be`.

Task remains TASK-LRN-COURSE-001, Issue 179, status in_progress, checkpoint e1_authorized_spec_integrated_delta_review, owner_acceptance pending. No new product slice is selected. Observed review/recovery branches are included in canonical-copy protection and cannot select their own state. Accepted/historical records retain their previous behavior and normative pins. [Revision semantics](../execution/REVISION_STATE_CONTRACT.md) documents meanings without duplicating live values.

This is the corrected **proposed** current.yaml in #208. Actual main still contains its previous state until owner-approved integration; publication of the proposal is not canonical main activation.

## D. Electronics failure classification

Exact failed test: `e2e/electronics-interactions.spec.ts:416`, native touch shelf scrolling / tap then canvas placement; expectation at line 443: schematic-component count expected 5, received 4, timeout 5000 ms; 50 tests passed, 1 failed.

Latest same workflow on main was [34282245855](https://github.com/spikeal8-maker/asa-lab/actions/runs/34282245855), SHA a51b4446995016dd472d3afd88c3df83dac3902a, PASS. This is an older path-filtered main run, not a claim of an Electronics run on latest main. The preceding documentation SHA e26ff39f passed [34753187401](https://github.com/spikeal8-maker/asa-lab/actions/runs/34753187401). #208 changes no product source, migration, e2e test, dependency lock, Docker/Compose or Electronics workflow inputs relative to its main baseline.

One controlled rerun of only failed job in [34753613315](https://github.com/spikeal8-maker/asa-lab/actions/runs/34753613315), same exact f3bb673c SHA, **attempt 2 PASS**. Classification: **flake/environmental browser touch timing**, not a demonstrated documentation PR regression. No Electronics code/test timeout was changed. Final #208 SHA still requires its own workflow outcome; earlier passes are historical evidence only.

## E. Preview and future convergence

Preview final review branch: `dce140868601b55c9a5449b38012e297c116d8be`. Draft [#210](https://github.com/spikeal8-maker/asa-lab/pull/210) targets immutable recovery, never main. Variant B removes special Identity readOnly and 0137; unchanged author heartbeat is allowed while all academic/learner-session writes are guarded. Separate lifecycle commit 68fbc3a2 removes only the impossible accepted-state comparison, with reproduced TS2367 evidence. Final bounded diff has 13 paths, including source/tests, three receipts and two screenshots; all 10 inherited CI formatting paths have unchanged blobs relative to recovery.

Local evidence after the decision: API build 15 tasks; Web build/typecheck 6 each; units 43; bounded fresh PostgreSQL 2; Playwright 1; relevant eslint/prettier, OpenAPI/contracts, migration check and governance PASS without Nx cache. Final source/test tree is 68fbc3a2; later Preview commit changes receipts/screenshots only. Normal GitHub PR workflow runs on recovery base, but inherited 10-file Prettier failure prevents full data/browser GitHub evidence. No workflow bypass or unrelated E1 formatting repair was introduced. Final exact Preview SHA dce140868601b55c9a5449b38012e297c116d8be has [GitHub run 34756918113](https://github.com/spikeal8-maker/asa-lab/actions/runs/34756918113): governance PASS, code Prettier FAIL on the same 10 inherited files, data/browser SKIPPED. See Preview branch receipt `docs/review/LRN_PREVIEW_STABILIZATION_02_2026_09_13.md` for exact commands and limitations.

[E1/main plan](LRN_E1_MAIN_CONVERGENCE_PLAN_2026_09_13.md): 135 E1 paths, 131 E1-only, 4 overlaps, 3 textual conflicts, 30 new ordered migrations 0107–0136 and unchanged common migrations. Critical semantic overlap is the Electronics project-save/simulation-start hook; App/API/ModuleEditorHost/3D save/OpenAPI/Identity/control-plane boundaries are addressed explicitly. **NO integration performed yet.** Future integration requires a separately selected bounded task, final GitHub repository gate and owner decisions. No next E1 feature slice is started.

## F. Actual validation and review

Executed via the same `pnpm gate:governance` script used in CI: `python tools/test_validate_document_registry.py` (12), `test_validate_task_document_refs.py` (6), `test_validate_agent_maintenance_docs.py` (11), `test_agent_targeted_context.py` (8), `test_agent_context.py` (20): **57 tests PASS**. All three corresponding live documentation validators PASS; Registry 27 documents. Control-plane suite **79 cases PASS**, including split schema/head/date/base/authority checks and actual Git fixture proving the observed feature branch cannot edit state. `pnpm control-plane:check` and full governance PASS. Nx cache was disabled; Python validation does not use Nx.

`git diff --check` for this stabilization amendment PASS. Whole #208 comparison retains the previously documented 27 Markdown hard-break warnings in the three byte-preserved historical snapshots; excluding those snapshots passes. Their bytes were not normalized just to hide historical whitespace.

POST_STEP_REVIEW: documentation and L3 execution semantics change; target requirements remain target, accepted Access pin unchanged, no product selection/acceptance altered. Source-of-truth boundaries made explicit; context budgets preserved. VERDICT: PASS for performed local documentation checks, pending exact final GitHub outcome.

CHALLENGE_REVIEW: checked stale SHA mislabelling, null unified head, recovery/base mismatch, short SHA, malformed dates, observation-as-acceptance, feature self-selection, old-schema compatibility and historical spec integrity. Preview review is a separate critical self-review, not an independent reviewer or owner acceptance. No tenant/RLS change, production migration, owner asset change, worktree deletion, recovery rewrite or published history rewrite.

PR #208 MERGED: NO. PREVIEW OWNER ACCEPTED: NO. E1 DONE: NO. DEPLOYED: NO. E2 STARTED: NO. E3 STARTED: NO. STOP after stabilization; future E1 slices use branch → small commits → push → exact-SHA CI → review → owner decision.
