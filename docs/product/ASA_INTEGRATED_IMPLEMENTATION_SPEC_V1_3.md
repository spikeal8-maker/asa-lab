# ASA Lab — Integrated Implementation Specification V1.3

**Document:** `ASA-INTEGRATED-IMPLEMENTATION`  
**Status:** NORMATIVE TARGET + DELIVERY CONTRACT  
**Accepted by owner:** 2026-09-10 for use as the integrated roadmap; acceptance does not authorize production.  
**Canonical path:** `docs/product/ASA_INTEGRATED_IMPLEMENTATION_SPEC.md`  
**Current execution state:** only `docs/execution/current.yaml`.  
**Academic semantics:** `ASA_LEARNING_TECHNICAL_SPEC.md`.  
**Users/access/settings:** `ASA_USERS_ACCESS_AND_SETTINGS_SPEC.md`.

This document is the compact canonical edition of the accepted V1.3 plan. It deliberately does not duplicate SQL, OpenAPI or every historical ledger row. Those live in executable migrations/OpenAPI and the existing Requirements Ledger. The purpose here is to make the target product, delivery order, page boundaries, user actions and acceptance gates unambiguous without forcing agents to reread the historical planning archive.

## 0. Non-negotiable product model

1. ASA Lab is a platform first. A school or organization is an optional context, not the parent of every Account.
2. One Account may simultaneously be a maker, learner, author, teacher, reviewer and organization member in different scopes.
3. Roles/personae do not authorize. Authorization is server-derived from the authenticated principal, current resource, scope, grant/capability, state and policy.
4. `StudentSeat` is a persistent learning profile with an individual credential; class code alone never proves control of a child profile.
5. Course content, delivery and people are different objects:
   - `Course/CourseVersion` — content;
   - `Classroom/Group` — people;
   - `CourseRun` — one delivery of one version;
   - `CourseEnrollment/ActivityParticipation` — learner participation.
6. Direct assignment and course activity converge on one runtime after `ActivityRun`.
7. Published content, Submission and published result revisions are immutable. Correction means a new version/revision with provenance.
8. A UI button is not authority. Every sensitive mutation rechecks server-side.
9. Existing Result A, Learning M0/M1/VS foundations, school contexts, projects and subject editors are reused. Do not start a second Auth/RBAC/Learning/Gradebook system.
10. A finished stage means a person can complete the promised action through the product, not that a table/enum/API exists.

## 1. End-state

The target system must allow these complete journeys:

### Personal user
Register -> Personal Workspace -> create projects -> read Knowledge -> optionally self-study -> keep personal work independent of any school.

### Author
Enable authoring -> create material -> edit draft -> preview -> publish immutable version -> later create a new draft/version -> keep the same material after enabling teaching.

### Independent teacher
Enable teaching -> create class without organization -> prepare learners -> create/publish course -> assign -> receive submissions -> review/return/correct -> see canonical result in gradebook.

### Learner
Enter through Account participation or StudentSeat credential -> see next step -> use real Electronics/3D editor -> server-confirm save -> submit exact evidence -> receive review -> revise if allowed -> see the same selected result as the teacher.

### Team/organization
Invite editor/publisher/teacher/reviewer/mentor/coordinator -> each receives only scoped actions -> run one course in multiple groups -> create an independent adaptation when allowed -> management sees permitted learning aggregates without automatic access to all learner details.

## 2. Canonical academic chain

For executable learning activity:

```text
LearningActivityVersion
→ ActivityRun
→ ActivityParticipation
→ Attempt
→ Submission
→ AssessmentResultRevision
→ ResultSelection
→ GradebookProjection / LearnerResultProjection
```

For course delivery:

```text
CourseVersion
→ CourseRun
→ CourseEnrollment
→ child ActivityRun(s)
→ ActivityParticipation
→ Attempt
→ Submission
→ AssessmentResultRevision
```

Attempt lifecycle, pedagogical decision and selected result are separate concepts. `changes_requested` closes the current attempt and, when policy permits, opens a new attempt linked by `revisionOfAttemptId`.

## 3. Delivery order

| Stage | Task | User-visible result | Must not be postponed |
|---|---|---|---|
| E1 | `LRN-COURSE-01` | first complete theory + project course from authoring to review/revision and 30×10 gradebook | unified library, Account+Seat, exact submission, review, notification, class settings, batch Seats, preview-as-learner, version recovery |
| E2 | `LRN-COURSE-02` | durable quizzes + essay/file/manual/rubric + prerequisites/course result + 30×100 gradebook/export | server answer persistence/timer, all 8 quiz types, mixed/manual, rubric, result consistency |
| E3 | `ASA-SELF-01` | public Knowledge + real self-study without fake school + StudentSeat→Account linking | public read != enrollment, personal scope/RLS, bilateral proof, preserved history |
| E4 | `ASA-COLLAB-01` | scoped coauthor/publisher/teacher/reviewer/mentor/coordinator work | invitations/grants, cross-owner safe materialization, help/discussion, run capacity |
| E5 | `ASA-ORG-01` | organization/team, groups/bulk, adaptation/copy, learning summary/detail | no capture of personal content, distinct runs, scoped aggregates, ownership transfer |
| E6 | `ASA-EXPERIENCE-01` | remaining settings/preferences/data requests/moderation/support/platform operations | no fake toggles/placeholders for required functions |

Default priority is E1→E2→E3→E4→E5→E6. Owner may reorder independent E3/E4 work after E1. No stage starts automatically.

## 4. E1 — `LRN-COURSE-01`

E1 is the active next product result.

### 4.1 Authoring and one library

`Курсы и задания` is one library, not two role-dependent systems.

Tabs:
- `Мои`;
- `Предоставленные` (becomes populated in E4);
- `Архив`.

Author-only can create/open/edit/save/preview/publish own content but cannot see roster or class management. Enabling teaching adds deliver/class actions; it never hides or replaces existing author content.

A new material is private by default. `Publish version` freezes a version; it does **not** make it public to the internet.

### 4.2 Course builder

Course workspace:
- Overview;
- Content;
- Usage;
- Versions;
- Settings.

Desktop content layout: outline left, current lesson/block editor center, selected block properties right. Mobile uses sequential panels, not three compressed columns.

E1 supports theory content plus project activity using existing Electronics and 3D modules. One published activity reused twice in a CourseVersion means two executable occurrences and therefore two child ActivityRuns in the CourseRun.

Prepublish validation shows the exact invalid block/setting. Dirty/saving/saved/failed states are real and reload-safe.

### 4.3 Version recovery

Published versions are read-only.

`Создать черновик из этой версии` creates a new draft from an exact historical snapshot and records the base version. Publishing it creates the next monotonic version number. It never rewrites the old version or old CourseRuns.

E1 requires a structural comparison at least at section/lesson/block/activity/policy level. Character-by-character diff is not an E1 blocker.

### 4.4 Preview as learner

`Предпросмотр как ученик` renders the exact draft/published version and, for a Run preview, its effective generic rules.

It must not create or mutate:
- Account/Seat;
- Enrollment/Participation;
- Attempt/Submission;
- Completion/Result;
- a real learner session.

It is not impersonation and never reveals a real learner's private answer/draft.

### 4.5 Class and learners

Class workspace:
- Overview;
- Learners;
- Learning;
- Gradebook;
- Team;
- Settings.

E1 class settings groups:
1. basic — title, supported description, current context read-only, timezone for deadline input;
2. joining/access — Account join approval, class code, individual StudentSeat credentials, shared-device mode;
3. learning-tool access — only settings supported by current safety caps;
4. notifications/safety — own class notification shortcut + two learner reminder controls.

Class code does not list children and does not authenticate an arbitrary Seat.

### 4.6 Batch StudentSeat

`Добавить несколько` supports pasted rows, with one pseudonym per row as the minimum input.

Flow:
1. client format precheck;
2. authoritative server preview;
3. per-row `valid/duplicate/conflict/invalid`;
4. one idempotent batch commit;
5. per-row result;
6. retry with same key+payload returns the same logical result.

CSV/XLSX ETL is not required in E1; copy/paste from a spreadsheet is sufficient.

After issue/reset, plaintext StudentSeat secret is available only in the protected response of that operation. A print-friendly card sheet may be produced from that one-time response. There is no endpoint to read an old plaintext credential later. Lost card -> reset that Seat -> new card.

### 4.7 Class lifecycle

Normal class UI uses archive, not destructive deletion of academic history.

Archive preserves roster history, runs, enrollments, attempts, submissions, results and audit. Restore does not reopen closed/cancelled runs, reactivate withdrawn learners or create credentials/attempts.

Transfer of teacher responsibility is an E4/E5 staff action. It is not a hidden transfer of tenant/learning context/personal workspace.

### 4.8 Assignment and audience

Assignment form has at most three meaningful steps:
1. material/exact version;
2. audience;
3. conditions/result preview.

E1 audience:
- whole class = dynamic;
- named learners = snapshot.

Late join must converge exactly once regardless of ordering between enrollment and child activity materialization. Leaving preserves history and prevents new starts according to policy. Retrying a command cannot duplicate Run/Participation.

### 4.9 Dates and individual conditions

Store instants in UTC; show/input with an explicit source timezone. Changing Account display timezone does not move the deadline.

Effective precedence for supported values:

```text
ActivityParticipation override
> ActivityRun explicit/pinned setting
> course block template
> LearningActivityVersion default
```

Individual conditions always target an exact learner + exact run/activity occurrence. Supported E1 controls include deadline/open/close override, extra attempts, late policy where allowed, excused status and history. They never change learner identity, credentials, staff role, content version or grade outside the correction flow.

### 4.10 Work and Submission

Start/resume/save/submit use the real Electronics/3D editor.

Rules:
- one active Attempt per ActivityParticipation;
- normal resume does not spend a new attempt;
- submit uses the latest server-confirmed saved revision;
- Submission pins immutable ProjectVersion/evidence/digest;
- a later mutable draft cannot change the submitted object;
- lost response is resolved with operation status/idempotent retry, not a blind second Attempt/Submission.

### 4.11 Review and revision

Submitted manual project appears in a real work queue. The reviewer opens exact Submission plus pinned task/version.

Supported result modes must not be faked:
- ungraded: no artificial score;
- completion: no artificial score;
- graded: use real maxPoints and pinned grading basis.

Accept/return are pedagogical decisions. Return creates the allowed new attempt/revision path while preserving the previous Submission. Result correction is append-only, requires reason and optimistic expected revision.

`ProjectFeedback`/badges remain feedback, not official grade.

### 4.12 Gradebook

Primary gradebook is a matrix:
- rows = learners;
- columns = concrete ActivityRuns;
- cells = canonical state + selected result.

Repeated delivery of the same content creates separate columns. Distinguish:
- not assigned;
- not started;
- in progress;
- submitted/waiting review;
- changes requested;
- completed/result;
- no grade.

Cell opens exact work/history/review. E1 acceptance dataset = 30 learners × 10 assignments. Mobile may switch to `by learners` / `by work`; E2 scales to 30×100 and adds export.

### 4.13 Notifications in E1

Academic truth, work queue and notifications are separate.

Required in-app event categories:
- assignments/conditions;
- work awaiting review;
- review/results;
- deadline soon;
- overdue work;
- completion;
- questions/announcements when supported;
- requests/invitations.

A user can:
- disable all ordinary learning notifications for themselves;
- toggle categories;
- override categories for a specific class.

A teacher may separately configure only supported learner reminders for a class (minimum: deadline-soon and overdue). This does not change due dates, submissions, grades, queue state or another teacher's preferences.

`unread` is notification state. `awaiting review` and `unfinished` are work counts and must not be derived from unread.

Submit must commit academic state even if notification delivery fails. Delivery is retry/deduplicated from persisted event/outbox-equivalent evidence.

### 4.14 Teacher attention on existing Home

Do not create a new teacher dashboard engine.

Existing Home may show a compact `Требует внимания` block for an Account with teaching duties:
- awaiting review -> work queue;
- active classes -> class list;
- pending learner requests -> request/class page;
- nearest relevant actions/deadlines -> existing target page.

Counts use existing canonical/read projections. Error in one source is unavailable/retry, not zero. These counts are not unread messages.

### 4.15 E1 hard acceptance

E1 cannot be declared done unless all are true:
1. author-only creates, edits, reopens and publishes through UI; roster denied;
2. enabling teaching preserves same content IDs/versions;
3. course is built and assigned through product UI, not pre-created by SQL;
4. whole-class/named and late-join rules are correct;
5. Account learner + StudentSeat use real Electronics; 3D path separately proven;
6. exact submitted version remains visible after learner edits the draft;
7. submitted work can be officially reviewed; no hidden 100/60;
8. return -> new Attempt -> resubmit -> decision preserves history;
9. learner/work view/gradebook resolve the same selected result; correction conflict works;
10. 30×10 matrix distinguishes missing states correctly;
11. mixed-data upgrade preserves historical projects/courses/feedback/results;
12. notification off/category/class overrides do not alter academic state;
13. batch 30 StudentSeats + one-time print cards are repeat-safe;
14. class archive/restore preserves history;
15. preview-as-learner creates zero academic records;
16. draft from old version creates a new future version, never destructive rollback;
17. teacher Home links to existing queues without new source of truth;
18. owner receives a real browser-visible demonstration and exact candidate.

Production remains a separate exact-candidate authorization.

## 5. E2 — durable assessment

E2 extends E1, not a parallel engine.

Mandatory quiz types:
`single_choice`, `multiple_choice`, `boolean`, `numeric`, `short_text`, `matching`, `ordering`, `long_text_manual`.

QuizVersion owns question content/order/grading definition. LearningActivityVersion owns attempts/time/pass threshold/feedback release/result selection.

Server requirements:
- selected questions/options frozen at attempt start;
- answers persisted server-side with optimistic version;
- reload/two tabs recover or conflict explicitly;
- server-authoritative timer;
- expiry works with browser closed;
- `auto_submit` or `expire_without_submission` according to policy;
- manual/mixed result stays provisional until required review;
- regrade scoped to exact ActivityRun and appends revisions.

Also E2:
- essay immutable text/hash;
- file via immutable AssetVersion and safe upload gate;
- teacher observation with real staff actor;
- RubricVersion;
- prerequisite/unlock rules;
- CourseCompletion separate from CourseResult;
- course result modes `no_course_grade`, `points_sum`, `weighted_categories`;
- gradebook 30×100, mobile modes, scoped CSV/XLSX export.

## 6. E3 — Knowledge, self-study, linking

### Knowledge
Public user-facing content kinds:
- `article`;
- `video_resource`;
- `lesson`;
- `course`.

These are content/presentation kinds, **not** new LearningActivity kinds.

Minimum public metadata where applicable:
title, summary, system topic/category, tags, level, age band, estimated duration, language, exact published version, author/owner display, immutable cover asset.

Filters: search, kind, topic, level, age, language. Community projects remain separate from Knowledge.

Public read does not create Enrollment/Participation. Publish does not automatically mean public.

### Access/enrollment presets
- private — assigned only;
- public read only;
- public self-study;
- public teacher-led enrollment/application.

Self-study must use the common academic runtime without fake school/class/teacher. A self-study course that requires mandatory human review is only startable when a real permitted reviewer path exists; otherwise show the limitation and allow only permitted reading.

### StudentSeat -> Account
Linking requires proof of the exact Seat and authenticated/re-authenticated Account plus required classroom approval/safety checks. Never merge by name/email/device/IP. Preserve learner identity, enrollments, participations, attempts, submissions, results and historical actors.

## 7. E4 — collaboration

One invitation/grant mechanism with exact recipient, action/template, scope, issuer, expiry, state and audit.

Required duties:
- editor/coauthor;
- publisher;
- teacher/co-teacher;
- reviewer;
- mentor;
- coordinator.

Editor does not get publish/roster. Publisher does not automatically get edit. Reviewer sees assigned Submission, not all learner data. Mentor cannot publish grade. Coordinator manages permitted participants/announcements without answer keys.

Cross-owner use must create/pin a runtime-safe materialization in the target context before the first external delivery. Full independent adaptation/copy UI belongs to E5.

Open teacher-led CourseRun may use:

```text
maxParticipants: null | positive integer
```

Admission is server-atomic. Two concurrent users cannot both take the last seat. Pending application does not reserve a seat unless a future explicit policy says so. Waitlist is out of scope.

## 8. E5 — organization

Organization is an optional team scope.

E5 provides:
- team/staff management and delegation ceiling;
- groups/subgroups;
- multi-class/bulk delivery with per-target outcome;
- permitted course adaptation/copy with provenance;
- distinct CourseRuns for distinct deliveries;
- summary vs detail vs export permissions;
- ownership/responsibility transfer with acceptance;
- organization defaults applied to new pins, not historical grades.

Organization membership never makes all personal content organization-owned. Leaving an organization removes dependent future access, not personal work or historical academic evidence.

Learning summary is built from Programs/CourseRuns/Enrollments/Participations/Submissions/canonical results. Login/click metrics are not learning progress.

## 9. E6 — completion of account/operations surfaces

Finish only the bounded remainder:
- supported account preferences;
- notification channel preferences for actually connected providers;
- full own invitation/request inbox;
- own data/export/closure process under adopted retention policy;
- moderation cases;
- ticket-bound SupportSession;
- platform admin/operations/security flows.

No fake switches or placeholder pages count as done. Support never uses a universal user password/impersonation and does not bypass academic correction by direct DB update.

## 10. Page atlas

There are 17 **templates**, not 17 pages for every user and not 17 new domains.

1. Knowledge catalog.
2. Knowledge/material public card.
3. Courses & assignments library.
4. Material/course author workspace.
5. Class list.
6. Class workspace.
7. CourseRun/assignment delivery workspace.
8. Teaching work queue.
9. Exact submission review.
10. My learning list.
11. Course/activity learner player.
12. Gradebook.
13. Invitations/requests.
14. My organizations.
15. Organization workspace.
16. Profile/settings.
17. Notifications.

Registration/login/class-code entry, Home, personal projects, Community, games, subject editors and existing platform admin remain existing surfaces.

Page budget:
- top bar: max one primary mutation and two secondary actions;
- one row/card: open + one menu for rare actions;
- complex recurrent object -> page/tab;
- one confirmation -> dialog;
- no modal-on-modal;
- mobile uses sequential panels, not tiny desktop layouts.

## 11. Main action catalog

These are action semantics, not 47 simultaneously visible buttons.

Content: create, save draft, preview, publish version, access/enrollment settings, assign, adapt/copy, archive.  
Class: create, add learner, batch add, issue/reset credential, print current cards, class settings, individual conditions, extra attempt, excused, archive/restore.  
Learner: start/resume, save, submit, complete theory, ask for help when a recipient exists.  
Review: publish decision, return/revision, correct result, select attempt when policy allows.  
Delivery: audience/rules, close/cancel run, capacity.  
Collaboration: invite/revoke staff, transfer responsibility, message/announcement.  
Public/self: self-start/enroll/application, close enrollment.  
Account: author/teacher capability, own notification/preferences, read notifications.  
Organization: create, manage team/settings, transfer ownership, summary/detail/export.

Every mutation has pending/error/conflict/success and safe retry semantics. A button must not change unrelated objects.

## 12. Access and UI rules

Menu is derived from server entitlements:
- personal Account always keeps personal projects/learning;
- `Курсы и задания` only with a content action;
- `Классы` only with class.create/staff class read;
- learner classes live under `Моё обучение`, not staff shell;
- `Преподавание` appears for assigned teaching/review/help/coordination work;
- organizations only for actual membership/ownership;
- platform administration only for platform grants.

Seat menu is reduced to learning, learning work, help, learning profile and logout.

Unknown private UUID returns safe not-found without owner metadata. Known but blocked action may show a precise reason and legal next step.

## 13. Notification rules

Academic state is never driven by read/unread.

Key events:
- learning assigned;
- work submitted;
- changes requested;
- result published/corrected;
- join request/decision;
- meaningful condition change;
- staff invitation;
- question/reply;
- linking/recovery state;
- access/security change;
- deadline soon;
- overdue;
- course/work completion.

Recipients are determined from current scoped authority, then personal delivery preferences are applied. Optional external channels do not become mandatory merely because MAX/email login exists.

Security-critical events are not disabled as marketing notifications.

## 14. Versioning, errors, concurrency

- idempotency key + request digest on create/publish/assign/start/submit/invite/batch operations;
- expected revision for conflicting draft/review/result changes;
- retry same key+same payload -> same logical result;
- same key+different payload -> conflict;
- no silent overwrite from two tabs;
- one active Attempt per participation;
- no duplicate child materialization;
- no null->zero in gradebook;
- error/partial failure is not an empty list or false success;
- asynchronous projections expose current/pending/asOf semantics where needed.

## 15. Security/data boundaries

Mandatory negative tests cover:
- foreign content/class/learner UUID;
- author without roster;
- publisher without edit;
- reviewer without correction;
- mentor without grade;
- coordinator without answer keys;
- summary-only without detail/export;
- org admin without platform admin;
- pending/expired invite without grant;
- Account + Seat cookie conflict;
- revoke during open page/job;
- shared-device leakage after logout.

No plaintext secrets in logs/screenshots/evidence. No real child accounts in acceptance. Forced RLS/guarded functions and immutable history are preserved.

Personal self-study or any cross-context DDL that changes protected tenant/RLS semantics requires the one exact architectural authorization demanded by repository policy; it does not justify a general rewrite.

## 16. Non-functional requirements

Learning flows target WCAG 2.1 AA and must support keyboard, focus, labels, semantic errors/status, reduced motion and non-color-only state.

Layout checkpoints: 320, 390, 768, 1024, 1366, 1440, 1920. Full lifecycle need not run at every width.

Targets from Learning Master:
- useful 30×100 gradebook render SHOULD be <=2s in documented production-like conditions;
- ordinary learning API SHOULD target p95 <=500ms excluding large assets/regrade;
- course editor SHOULD handle 20 sections / 200 lessons / 1000 blocks without full expensive rerender per keystroke.

These are measured targets, not assumed PASS.

## 17. Evidence and Definition of Done

During development: focused checks for changed behavior.  
Ready candidate: one required repository/CI gate plus exact browser journeys and migration/upgrade evidence.  
Deployment: exact candidate identity + schema/readiness + short real-domain smoke. Do not rerun the same entire suite only because report wording changed.

Fixtures may create synthetic users/load, but may not perform the user action being accepted. If course creation is accepted, the course is created through UI. If invite acceptance is accepted, the grant is not preinserted by SQL. If grade correction is accepted, the new result is written through the product command.

Meaningful statuses:
`SPECIFIED → IMPLEMENTED → LOCALLY_VERIFIED → CI_VERIFIED → DEMONSTRATED → OWNER_ACCEPTED → DEPLOYED`.

Only owner decides OWNER_ACCEPTED. Only installed exact candidate may be DEPLOYED.

## 18. Release rule

Each completed accepted stage/checkpoint may be released independently. Future E2–E6 work is never a prerequisite for publishing a ready E1 candidate.

Before production:
- exact code/image identity;
- supported migration path;
- current backup point when DB changes;
- known failure/recovery behavior.

Do not create a new database, tenant, domain, deployment platform or `latest`-based update in order to ship a feature. Returning an old app image is not automatically a database rollback.

## 19. Deliberate exclusions from this target

Not required unless separately authorized later:
- waitlist;
- school timetable/attendance/quarter grades;
- parent dashboard;
- certificates;
- payments;
- SCORM/LTI;
- video conferencing;
- global personal messenger;
- mass marketing email/SMS/MAX campaign builder;
- separate analytics warehouse;
- large-media hosting/transcoding;
- offline multi-node synchronization;
- new STEM kernels;
- cross-tenant class transfer by one ordinary button.

## 20. Agent operating rule

For the active stage:
1. read `AGENTS.md`, `START_HERE_FOR_AI.md`, `pnpm agent:context --scope learning`;
2. read only the stage section here plus the relevant Master/Access sections and current code delta;
3. reuse already-correct implementation instead of rebuilding it;
4. implement one whole user transition across the necessary DB/API/UI layers;
5. run focused checks and save a usable checkpoint;
6. finish all MUSTs of the stage;
7. run the required candidate gate once, demonstrate, and stop for owner acceptance/release decision.

Do not restart a general architecture audit, create a second queue, or advance to the next stage automatically.
