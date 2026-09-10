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

1. **Authoring convergence:** same content root survives author→teacher; edit/save/publish; historical-version-to-new-draft; learner preview without writes.
2. **Direct project complete:** exact version → audience → save → immutable submit → review/return → resubmit → selected result/correction.
3. **Class operations:** Account join + StudentSeat; batch Seat preview/commit; one-time cards; archive/restore; individual conditions; notification prefs/reminders.
4. **Course convergence:** exact CourseVersion → CourseRun → child ActivityRuns/Participations; repeated blocks; late join; same direct runtime.
5. **Gradebook:** learner×ActivityRun 30×10; exact submission/history/correction; teacher Home/queue.
6. **Candidate:** mixed-data upgrade, negative access tests, browser journeys, required repository gate.

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

## Progress note format

Keep this file short. Update only:
- current checkpoint;
- concrete changed files/migrations;
- exact tests actually run;
- owner-visible demo/evidence;
- remaining E1 MUSTs;
- blocker, if one is real.

Do not paste long logs into the note.
