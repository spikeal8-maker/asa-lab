# LRN-COURSE-01 — execution note

**Product result:** `LRN-COURSE-01`  
**Execution task:** `TASK-LRN-COURSE-001`  
**Issue:** #179  
**Policy:** direct development in `main`; production is not authorized by this task.  
**Baseline at activation:** `b963ef828f0e10042adacba4199bba972526c0df`.

## Owner authorization

Owner accepted Integrated Implementation Spec V1.3 and authorized the next development step: the full E1 result. This authorizes related DB/API/OpenAPI/UI/test/documentation changes inside E1 under repository policy. It does not authorize E2–E6, production deployment, destructive persistence changes, a new tenant/RLS model, or new subject kernels.

## Read first

1. `AGENTS.md`
2. `START_HERE_FOR_AI.md`
3. `pnpm agent:context --scope learning`
4. `docs/product/ASA_INTEGRATED_IMPLEMENTATION_SPEC.md` — especially §§0–4, 10–18, 20
5. relevant sections of `ASA_LEARNING_TECHNICAL_SPEC.md`
6. relevant actor/permission/UI sections of `ASA_USERS_ACCESS_AND_SETTINGS_SPEC.md`
7. Issue #179

Do not reread the entire historical V3/M0/M1 archive unless a concrete compatibility question requires it.

## Starting checkpoint

`e1_authorized_spec_integrated_delta_review`

The first implementation action is not another global audit. Address-check the current delta around:
- authored material/library and course builder;
- current course assignment/run endpoints;
- learner Account/StudentSeat paths;
- project save/submit;
- review/result/gradebook;
- current class/credential lifecycle;
- current notification/event infrastructure and Home attention projections.

Reuse correct components. Record only concrete gaps relative to E1 and start with a whole user transition.

## Recommended implementation order

Owner amendment 2026-09-16: **functional completeness first, final course/layout polish second**. Do not spend the next slice broadly re-laying out Course Builder while a required action is absent.

1. **Student entry closure:** Issue #271 — public teacher name/no email, compact second join step, StudentSeat `Главная`; Issue #272 — compact `Asolab.ru` cards and class QR deep-link straight to `Код ученика`.
2. **Course authoring closure:** normal course archive/restore instead of user-facing hard delete; structural published-version comparison; exact prepublish error pointing to the broken lesson/block/activity/setting; capability-aware actions for author-only vs teacher.
3. **Preserve the integrated academic path:** exact CourseVersion → CourseRun → Participation → save → immutable submit → review/return → resubmit → selected result/correction; whole/named/late-join and 30×10 gradebook are existing baseline and must not be rewritten.
4. **Final E1 acceptance:** mixed-data/upgrade, negative access, 320/390 desktop-mobile browser journey, owner-visible walkthrough, ledger/evidence alignment.
5. **Visual convergence pass:** only after steps 1–4 are functionally green, bring `Курсы и задания`, Course Builder and Class workspace to the final visual hierarchy/tabs/spacing. This pass must not invent missing backend behavior.

E2–E6 remain separate later stages; this E1 authorization does not automatically start Question Bank/Quiz/autograder/self-study/collaboration/organization work.

## Do not do

- no second Auth/RBAC/Learning/Gradebook engine;
- no hidden `100/60`;
- no hard-delete academic history;
- no SQL fixture for the exact user action being accepted;
- no full Quiz Engine/essay/file/rubric;
- no self-study/linking;
- no new collaboration/org dashboards;
- no waitlist;
- no general redesign of Electronics/3D;
- no production update.

## Execution-state boundary

This file is a static scope/task package. Do **not** update current checkpoint,
status, head SHA, gate outcomes or blockers here. Those values live only in
`docs/execution/current.yaml` and executable CI/evidence.

Implementation details that become durable product rules belong in the canonical
product/domain contracts. Temporary progress belongs in Git/CI or explicit review
evidence, not in this package.
