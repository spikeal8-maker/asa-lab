# Product specifications V1.4 / 2.1 stabilization review

POST_STEP_REVIEW

- STEP: preserve local E1/docs development on GitHub and produce one current set of target specifications on a branch based on current main.
- CHANGE_CLASS: L2_DOMAIN_MUTATION (documentation semantics only; no runtime mutation).
- CHANGED: three canonical specs, byte-pinned historical snapshots, Registry, two compact contracts, active Learning normative refs, requirement ledger and historical-reference validators.
- USER_RESULT: future work resolves current specs through compact targeted context; accepted Access A still references Users 2.0.
- INVARIANTS_TOUCHED: existing identity, immutable version, Attempt/Result separation and single Gradebook projection remain intact; new programming/temporary-access requirements are TARGET only.
- TESTS: five requested Python test suites PASS (57 tests total); live registry/task-ref/maintenance validators PASS; pnpm gate:governance PASS with NX_SKIP_NX_CACHE=true (Python checks, no Nx tasks/cache); working-tree git diff --check PASS before staging. Full staged diff --check reports 27 inherited Markdown hard-break lines in the three byte-exact historical snapshots; these bytes are intentionally preserved. The amendment diff excluding those snapshots passes.
- NEGATIVE_CHECKS: active task rejects superseded refs; done without owner acceptance rejects superseded refs; accepted history still rejects wrong revision; one-byte/line-ending snapshot change rejects checksum; no unrelated module source in three requested contexts; all contexts below 8000 characters.
- DOC_DRIFT: none in registered current authorities. Unmerged recovery copies retain their original state and are not current-main claims.
- UNVERIFIED: product implementation, repository/code/data gates, deployment and owner acceptance. Governance in current direct_main baseline disables PR/lease remote comparisons; branch SHA is checked independently through GitHub.
- VERDICT: PASS for documentation amendment only.

CHALLENGE_REVIEW (separate critical self-review, not independent owner acceptance)

- Current main and converged documentation were combined in an isolated worktree. The sole textual conflict in START_HERE_FOR_AI.md was resolved by retaining current-main Scratch scope/readiness restrictions and the new registry review authority. No mechanical ours/theirs resolution.
- No old accepted result is relabeled as accepted under a new specification. Historical byte hashes are executable Registry invariants; active references must remain canonical.
- No content/runtime/auth/Gradebook fork is permitted by the new text. Temporary access is a semantic target within existing identity contracts; physical tenant/RLS redesign and runner work remain separately authorized work.
- Programming Run/Check do not create official Submissions. Exact immutable Submit and grader evidence feed the shared resolver; failure is not a fabricated academic outcome.
- Published versions, class history and assessment evidence survive new drafts, credential expiry and proof-based linking. Shared links/class codes never establish learner identity.
- E1 Preview implementation is not accepted by this documentation review. Its zero-write and authorization regressions remain a separate step.

## Historical byte receipts

- PRODUCT-INTEGRATED-V13: `docs\product\ASA_INTEGRATED_IMPLEMENTATION_SPEC_V1_3.md`, SHA-256 `155b419eb68f400eb74c39c2d77eb08493237d7ee28a938612974fdd34e99545` → PRODUCT-INTEGRATED-V14.
- IDENTITY-ACCESS-V20: `docs\product\ASA_USERS_ACCESS_AND_SETTINGS_SPEC_V2_0.md`, SHA-256 `1121d062ba8b99f4ba77eaf241a5213d90838d8245755f2d6bc92ffe5ac59ae6` → IDENTITY-ACCESS-V21.
- LEARNING-MASTER-V20: `docs\product\ASA_LEARNING_TECHNICAL_SPEC_V2_0.md`, SHA-256 `cb4eb424c0dfb497eba2440be35d5119542443dd563ed1c2359592fab6f81ee5` → LEARNING-MASTER-V21.
