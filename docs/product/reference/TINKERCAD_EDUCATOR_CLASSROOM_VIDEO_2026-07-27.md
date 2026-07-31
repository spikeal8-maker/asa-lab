# Tinkercad educator registration, class creation and StudentSeat flow — owner video evidence

**Evidence ID:** `tinkercad-educator-classroom-video-2026-07-27`  
**Status:** normative reference evidence for the ASA Lab parity programme.  
**Source:** owner-provided recording `2026-07-27 21-12-34.mp4`.  
**Recording:** 715.266667 seconds, 1920×1080, 60 fps, 42,916 video frames.  
**Source SHA-256:** `1842b4328f345494a8fd7399ea1a9e3290abd6aa6f446d9ff5336af9f1904ca3`.  
**Data classification:** every account, class, code and learner identifier visible in the recording is synthetic test data supplied by the owner. Storage in the private ASA Lab repository/evidence area is permitted. Public redistribution requires owner approval because the recording captures a third-party product interface.

## Analysis method

- video metadata and all 42,916 frames were processed;
- scene and transition changes were indexed;
- 143 periodic samples at five-second intervals were reviewed;
- 56 focused full-resolution keyframes were inspected around registration, educator activation, publication, classroom and learner-work transitions;
- nine contact sheets were reviewed;
- six functional clips were produced locally.

This document records visible behaviour. Anything not demonstrated by the recording remains `unverified`.

---

## Executive conclusion

The recording verifies the complete bridge from a newly registered adult educator to an operational classroom and to teacher inspection of a StudentSeat project:

```text
public landing
→ contextual educator entry
→ country/region and date of birth
→ email/password registration
→ anti-abuse check
→ account created without an observed blocking email-confirmation gate
→ creator dashboard
→ educator attestation
→ personal project creation and project visibility settings
→ class creation
→ Safe Mode policy
→ individual or bulk StudentSeat provisioning
→ class code/share link/printable credential strips
→ StudentSeat login using class code and assigned learner handle
→ student creator portal
→ student creates a private project
→ teacher roster receives last-active information
→ teacher opens learner portfolio
→ teacher opens the exact project viewer and version history
```

ASA Lab must reproduce this product logic while improving the confusing Autodesk identity hand-off, client-facing irreversible role selection, repeated anti-bot puzzles and ambiguous teacher-edit semantics.

---

## Verified timeline

| Time | Surface | Visible behaviour | Required ASA Lab behaviour |
|---|---|---|---|
| 00:00–00:05 | Public landing | Marketing landing with login, registration and product navigation. | Anonymous public shell; no teacher-only landing. |
| 00:05–00:10 | Context chooser | Educator, student/class entry, personal account and existing-account login paths. | Entry router; the selected route must not itself grant capabilities. |
| 00:10–00:25 | Registration policy | Country/region and full date of birth are collected before credentials. | Resolve jurisdiction and age policy server-side before consent and capability decisions. |
| 00:25–01:10 | Credentials | Email, password, live password rules, terms/privacy and duplicate-email error. | Native ASA identity, retained fields, early uniqueness checks and understandable password rules. |
| 01:10–01:30 | Anti-abuse/account creation | Visual challenge, account-created receipt and redirect. | Risk-based abuse protection; no routine repeated puzzle loop. |
| 01:30–01:50 | Creator home | Adult account immediately reaches the creator dashboard; no blocking email-confirmation screen is observed. | Adult pilot account may start in personal workspace immediately; email state remains explicit. |
| 01:50–02:10 | Profile and educator activation | Profile exposes private username, display name, role and bio. Selecting educator opens an attestation dialog. | Separate Account, Profile and CapabilityGrant models. |
| 02:05 | Educator attestation | User attests authority to moderate learners and accepts child-privacy terms; the reference describes the role as irreversible. | Server-issued, audited, reviewable and revocable educator capability. |
| 02:10–02:30 | Empty classes | Teaching/archive/co-teaching/registered tabs; create class and external classroom integration. | Role-aware class list and clear empty state. |
| 02:30–03:20 | Personal project | Educator creates/opens a Circuits project independently of a class. | Educator remains a creator; personal project never requires Classroom. |
| 03:20–04:45 | Project actions/publication | Properties, duplicate, version history, add to class activity, add to collection, delete. Properties expose title, description, tags, private/unlisted/public visibility, licensing and anti-abuse challenge. | Platform-level project lifecycle and publication, independent of Electronics. |
| 04:45–05:30 | Create class | Required class name, grade/age band, topic multi-select and Safe Mode control. | Classroom, GradeBand, topic metadata and ClassroomSafetyPolicy. |
| 05:30–05:40 | Class onboarding | One-time new-class announcement and transition into class workspace. | Optional first-run onboarding must not block normal operation. |
| 05:40–05:55 | Class workspace | Students, Activities, Projects, Moderation and Co-teachers tabs; class code/share link; global Safe Mode. | Canonical P4 class workspace shell. |
| 05:55–06:15 | Add one StudentSeat | Consent notice; teacher-facing learner label and unique learner login handle. | `displayLabel` and `loginHandle` are different fields; creation is audited. |
| 06:15–06:40 | Bulk StudentSeat creation | Paste one learner per line; optional comma mapping; row validation and preview. | Bulk parser, preview, duplicate detection and deterministic per-row result. |
| 06:40–06:55 | Roster | Learner, type `StudentSeat`, handle, last active, badge count, Safe Mode and row actions; search/sort/select/bulk actions. | Operational roster, not decorative cards. |
| 06:55–07:00 | Class code/share | Large grouped code, copy link, copy code, privacy notice and learner instructions. | Rotatable/revocable code, hashed storage and explicit share-link lifecycle. |
| 07:00–07:10 | Activities/moderation/co-teachers | Activity empty state, moderation empty state and co-teacher invitation link. | Separate contexts and granular co-teacher grants. |
| 07:10–08:40 | Seat controls/printing | Per-seat Safe Mode/row actions and printable strips containing class code plus learner handle. | Credential-card/QR export and reset/suspend/revoke lifecycle. |
| 09:20–10:05 | Student entry chooser | Student-with-class-code route and grouped class-code input. | Dedicated StudentSeat route separate from registered-student and personal login. |
| 10:05–10:30 | StudentSeat login | Code resolves a class; learner enters teacher-assigned handle; no email/password shown. | Class code + seat handle authentication, throttling and roster-enumeration resistance. |
| 10:30–10:40 | Student portal | Student sees class and teacher while retaining Home, Classes, Projects, Collections, Tutorials and Challenges. | Student remains a creator; Safe Mode restricts publication/social actions, not creation. |
| 10:40–11:00 | Student creates project | Student opens Circuits and creates a private project. | Project owner is the StudentSeat principal; class membership grants teacher visibility. |
| 11:00–11:15 | Teacher monitoring | Roster last-active updates; global/per-seat Safe Mode visible. | Activity projection and `lastActiveAt` without copying project payload into activity feed. |
| 11:15–11:20 | Learner portfolio | Learner switcher, previous/next, privacy, module tabs, sort, grid/list and project cards. | Module-aware learner portfolio reusable across subjects. |
| 11:20–11:25 | Project viewer | Exact preview, simulate, edit affordance, learner/class context, classroom link, privacy, dates and report. | Universal ProjectViewer; teacher intervention must be explicit and audited. |
| 11:25–11:40 | Version history | Multiple versions; restore text states that a copy is created. | Immutable versions; restore-to-copy, never destructive rollback. |

---

## 1. Educator registration and capability model

### 1.1 Visible registration flow

```text
educator entry
→ country + date of birth
→ email + password
→ terms
→ anti-abuse check
→ creator account
→ profile role selection
→ educator attestation
```

No email-confirmation page was observed before the educator reached the creator dashboard, created a personal project, changed publication settings and created a class.

### 1.2 Educator activation is not organization onboarding

The recording does not request a school name, organization domain, employment verification or administrator invitation. It uses self-attestation. Therefore exact parity permits a low-friction provisional educator path, but ASA Lab must not implement it as a trusted browser-side role switch.

Required server model:

```text
CapabilityGrant
- accountId
- capability: creator | educator | guardian | school_admin | platform_admin
- status: provisional | verified | suspended | revoked
- source: self_attestation | organization_invite | admin_grant
- policyVersion
- grantedAt / grantedBy
- verifiedAt optional
- revokedAt optional
- auditEventId
```

The educator route starts onboarding. Only the server creates or revokes authority.

### 1.3 Email verification policy

Owner-approved ASA behaviour:

- allow an adult pilot account to use personal projects and create a pilot class without blocking on email confirmation;
- send verification in parallel;
- expose `emailVerificationState` in settings;
- require verified email for recovery, billing, ownership transfer, high-volume invitations and other sensitive operations.

---

## 2. Profile and workspace context

Visible profile elements include private username, display name, role, bio, avatar and links.

Required separation:

```text
Account.email / username       credential identity
Profile.displayName            policy-controlled presentation
Profile.bio                    optional presentation
CapabilityGrant                server authority
OrganizationMembership         organization grants
ClassroomMembership            classroom grants
WorkspaceContext               active personal/school scope
```

One person may simultaneously be a creator, educator, co-teacher, guardian and school administrator. The UI switches context; it does not mutate the person's capabilities.

---

## 3. Personal educator projects and publication

The educator creates a personal project before any class. The visible project menu contains:

```text
Properties
Duplicate
Version history
Add to class activity
Add to collection
Delete
```

Properties contain:

- title;
- description;
- up to ten tags;
- visibility: private, share-by-link/unlisted, public;
- license/public-domain selection;
- anti-abuse challenge for publication.

Required invariants:

1. Draft save is not publication.
2. Publication references an immutable ProjectVersion.
3. Private, class, organization, unlisted and public remain separate visibility states.
4. Add-to-activity references or copies a chosen immutable starter version; it never exposes the mutable educator draft.
5. Duplicate/Remix creates a new project and preserves lineage.
6. Version restore produces a copy/new draft and never overwrites immutable history.
7. Publication metadata belongs to Project Core and is reusable by every module.

The full public page, comments, likes and Remix UI remain unverified by this recording.

---

## 4. Classroom creation contract

Visible fields:

```text
class name (required)
grade / age band (required)
subject/topic multi-select
Safe Mode on/off
```

Topic selection is metadata and must not hard-code subject modules into Classroom Core.

Suggested model:

```text
Classroom
ClassroomGradeBand
ClassroomTopicTag
ClassroomSafetyPolicy
ClassroomJoinCode
ClassroomShareLink
```

Safe Mode is available at class creation, globally in the class header and per learner in the roster.

---

## 5. StudentSeat provisioning

### 5.1 Separate labels

The reference distinguishes:

```text
displayLabel   teacher-facing learner label
loginHandle    learner-facing assigned login name
```

Neither value is a public profile by default.

### 5.2 Individual and bulk creation

Bulk creation supports one learner per line and optional comma-separated mapping. ASA Lab must provide:

- preview before commit;
- trim/normalization;
- minimum and maximum length validation;
- duplicate detection inside the batch and against the class roster;
- deterministic per-row result;
- repeat-safe submission/idempotency;
- partial-success report or an explicit all-or-nothing mode.

### 5.3 Credential delivery

The reference supports printable strips. ASA Lab should support printable cards and QR, but must avoid storing retrievable plaintext credentials after issuance.

Required lifecycle:

```text
StudentSeatCredential
- issue
- rotate/reset
- suspend
- revoke
- archive
- print/export receipt
```

---

## 6. StudentSeat authentication

Visible path:

```text
select student-with-class-code
→ enter grouped class code
→ class preview
→ enter assigned learner handle
→ enter class
```

No email or password is shown. The recording does not prove an additional PIN.

Minimum parity allows class code + assigned handle. Owner-approved security improvements may add optional PIN or one-time activation according to deployment policy.

Security requirements:

- normalize spaces, dashes and case in class codes;
- hash join codes at rest;
- rotate and revoke codes;
- rate limit code and handle attempts;
- avoid revealing whether a roster handle exists;
- bind a session to a specific StudentSeat principal;
- default to Safe Mode capabilities.

---

## 7. Student remains a creator

After joining, the StudentSeat sees the broad creator portal and can create a private project. Therefore:

> Safe Mode restricts public publication, public profile exposure and social actions. It must not reduce the learner to an assignment-only account.

The project owner is the StudentSeat principal. Teacher visibility comes from authorised classroom membership and policy, not from teacher ownership of the learner's draft.

---

## 8. Teacher monitoring and learner portfolio

The roster visibly provides last active, badges, Safe Mode and per-row operations. The teacher can open a module-aware learner portfolio and then an exact Project Viewer.

Required views:

```text
Classroom roster
→ learner portfolio
→ module tabs / sort / grid-list
→ Project Viewer
→ exact immutable version
→ version history
```

Access rules:

- teacher sees only learners in an authorised class;
- every access to a learner project is auditable;
- the learner project is read-only by default;
- any assistance/edit mode must be explicitly entered, visibly bannered and audited;
- restore creates a copy; immutable versions never change.

---

## 9. Co-teachers, activities and moderation

The class shell visibly contains separate Activities, Moderation and Co-teachers tabs. Full workflows were not demonstrated, but the shell proves that they are first-class contexts.

Co-teacher authority must be granular:

```text
classroom.view
classroom.roster.manage
classroom.activity.assign
classroom.student_work.view
classroom.comment.write
classroom.review.write
classroom.grade.write
classroom.badge.award
classroom.settings.manage
```

An invitation link must have expiration, acceptance, revocation and audit.

---

## 10. Exact parity versus ASA Lab improvements

### Copy as closely as possible

- contextual educator entry;
- adult creator workspace available immediately;
- educator remains a personal project author;
- class creation fields and Safe Mode prominence;
- operational roster density;
- individual and bulk StudentSeat workflows;
- shareable class code and printable learner credentials;
- StudentSeat login without email;
- learner remains a creator;
- teacher learner-portfolio and Project Viewer;
- immutable version history and restore-to-copy semantics.

### Improve intentionally

- native ASA identity rather than Autodesk redirects;
- educator capability is server-issued, reviewable and revocable;
- no routine repeated CAPTCHA;
- explicit email-verification state rather than ambiguous absence;
- clearer bulk parser and row-level errors;
- code rotation/revocation and safer credential delivery;
- explicit audited teacher-assistance mode;
- stable workspace/context switcher;
- clearer distinction between display label, login handle and public profile.

---

## 11. Implementation order established by this evidence

1. **Account and onboarding foundation** — public landing, contextual entry, native registration, age/jurisdiction policy, capabilities, profile, sessions and context switching.
2. **Educator capability** — audited provisional/verified/revoked grant and account menu/settings.
3. **Creator portal and Project Core** — personal projects, properties, immutable versions and visibility.
4. **Classroom shell** — class creation, GradeBand/topics, code/link, Safe Mode and tabs.
5. **StudentSeat lifecycle** — individual/bulk provisioning, credentials, login, reset/revoke and printable/QR delivery.
6. **Student creator portal** — private projects under Safe Mode.
7. **Teacher monitoring** — roster, activity, learner portfolio, universal Project Viewer and audited exact-version access.
8. **Activities/review/publication/community** — only after their remaining reference gaps are captured.

---

## 12. Still unverified

- exact email-verification and recovery rules;
- formal educator verification beyond self-attestation;
- school/platform administration console;
- organization creation and ownership;
- full Activity/Assignment creation and submission/review flow;
- complete moderation and co-teacher operations;
- public project page, comments, likes, bookmarks and Remix;
- billing and checkout;
- whether StudentSeat can have an optional PIN in the reference product.

These items must remain linked to reference tasks or owner-approved deviations rather than being invented silently.
