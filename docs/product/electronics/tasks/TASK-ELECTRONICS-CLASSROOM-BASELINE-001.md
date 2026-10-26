---
task_id: TASK-ELECTRONICS-CLASSROOM-BASELINE-001
kind: maintenance
risk: medium
semantic_change: no
roadmap_slice: null
prerequisites:
  - Owner-approved CRM navigation already integrated in main
acceptance_boundary: slice
review: independent
---

# Align existing profile navigation regressions with accepted CRM navigation

Programme controller baseline repair under AGENTS section7, separate from the
Electronics752 cleanup. Main ce2773e0 already includes the owner-approved CRM
contract and tenth profile tab. Its General run40205135744 fails independently
of Electronics: unit navigation count9 versus10 and two mobile option-list
assertions omit the new tab. This is categoryC, not a cleanup defect.

Only test writes:

- apps/web/src/components/testing/classroom-student-profile.spec.ts
- e2e/classroom-profile-completion.spec.ts

Read identity compact contract and the accepted CRM section in
docs/product/ASA_USERS_ACCESS_AND_SETTINGS_SPEC.md. Keep production CRM,
ClassroomStudentPage, permissions, grants, API, schema, all foreign product code,
timeouts, retries, screenshots, workflows, dependencies and budgets unchanged.
Do not revisit the owner-paused engine-timed-api task. No local server/Docker or
live DB/data. Actual target overlap must be checked before edits.

Preserve strict assertions: exact ten-tab count, exact ordered labels including
Карточка и ИИ immediately before Настройки, and End focusing the actual last
Settings tab. Preserve all other keyboard, layout, mobile sizing and safety
assertions. No skips, relaxed matchers, removed assertions or product decisions.
The existing accepted teacher-scoped CRM capability is characterized, not changed.

For one final composition, inherit canonical main selection and merge the exact
source-reviewed752 candidate ece6b5fd without editing its four files. Then author
one separate test-only commit. Stop on conflicts or unknown contract intent.
This allows a single final General run to qualify the separate reviewed cleanup
and its baseline prerequisite; it does not combine their author/reviewer roles.
Controller owns main integration and current.yaml. No further convergence or
scope expansion without controller classification.

Focused unit file, scoped lint/format and routing must pass. Existing General CI
must prove full Data/RLS plus actual Access A journeys on the final composition;
do not claim local adapters as installed/browser acceptance. Supporting dated
evidence under docs/product/electronics/evidence is allowed if needed. Preserve
the earlier source cleanup and its receipts; no broad baseline re-recording.

NEW independent review checks exact final SHA, accepted contract intent, strict
expected order/count/focus, unchanged foreign product tree and no weakened tests.
The cleanup reviewer separately verifies inherited cleanup source on that final
composition. Executor reports one bounded candidate/self-review then STOP.
