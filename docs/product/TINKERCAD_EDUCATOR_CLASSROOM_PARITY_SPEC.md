# ASA Lab — Educator and Classroom Parity Contract

**Status:** normative amendment derived from owner video `2026-07-27 21-12-34.mp4`.  
**Priority:** higher than earlier assumptions about read-only teacher access or mandatory organization onboarding.  
**Scope:** adult educator registration, educator capability, class creation, StudentSeat provisioning, class-code entry, roster, learner creator portal, teacher project supervision and assisted editing.

## 1. Non-negotiable product rules

1. An eligible adult can create a personal creator account using email/password and begin using projects immediately.
2. Educator capability can be activated through explicit self-attestation; an organization is not required before the first class.
3. The browser never grants capabilities. The server records a capability grant, policy version and audit event.
4. A teacher remains a creator with personal projects outside classes.
5. A class is a workspace with Students, Activities, Projects, Moderation and Co-teachers.
6. A class has an age/grade band, optional subject/topic metadata and Safe Mode policy.
7. A StudentSeat can be created without email and password, individually or in bulk.
8. The same class code supports assigned-handle StudentSeats and existing registered accounts.
9. Safe Mode restricts public/social exposure; it does not block project creation.
10. Teachers can inspect exact versions, react to learner work and open an authorised learner project in assistance mode.
11. Teacher assistance is explicitly contextualized and audited; silent editing is prohibited as an ASA Lab safety improvement.
12. Project publication, class assignment and teacher reactions remain distinct concepts.

## 2. Account/capability model

```text
Account
├── Profile
├── AgePolicyResult
├── CapabilityGrant
│   ├── creator
│   ├── educator
│   ├── guardian
│   ├── school_admin
│   └── platform_admin
├── OrganizationMembership optional
├── ClassroomMembership
├── ManagedChildLink
├── StudentSeat principal (separate)
└── Entitlements
```

### 2.1 Educator grant

```text
creator
→ open educator onboarding
→ review educator/privacy notice
→ attest authorization
→ server grants educator
→ Classes navigation becomes available
```

The account holder cannot self-grant `school_admin` or `platform_admin`.

Suggested grant states:

```text
provisional
verified
suspended
revoked
```

Every transition records actor, source, policy version and AuditEvent.

## 3. Adult account activation

Parity mode may permit an eligible adult account to begin using personal projects and a pilot classroom without a blocking email-confirmation page because the reference recording shows immediate access.

Required safeguards:

- explicit `emailVerificationState`;
- verification message sent in parallel;
- verified email required for password recovery completion, billing, ownership transfer and other sensitive operations;
- configurable stricter policy for production deployments.

## 4. Class lifecycle

```text
create
→ active
→ archived
→ restored
→ deleted/retained according to policy
```

Create payload concept:

```json
{
  "title": "8К2",
  "ageBand": "11-14",
  "topicKeys": ["physics", "robotics"],
  "safeModeDefault": true
}
```

A class may belong to an organization, but `organizationId` is optional for the first parity release. Topic tags are metadata and do not hard-code subject modules into Classroom Core.

## 5. StudentSeat lifecycle

```text
issued
→ first_join
→ active
→ suspended
→ credential_reset
→ transferred
→ removed
→ deleted according to retention policy
```

Minimum fields:

```text
id
classroomId
displayLabel
loginHandle
normalizedLoginHandle
credentialVersion
safeMode
status
lastActiveAt
createdBy
createdAt
```

No email is required. Plain credentials are shown only at issuance/print time and are not stored recoverably.

### 5.1 Bulk provisioning

Bulk provisioning must include:

- one learner per line or an explicitly documented mapping format;
- normalization and validation;
- duplicate detection inside the batch and against the roster;
- preview before commit;
- deterministic per-row errors/results;
- idempotent retry behaviour;
- printable/QR credential output.

## 6. Class code and join

```text
ClassroomJoinCode
├── tokenHash
├── formattedCode
├── version
├── status
├── expiresAt optional
├── rotatedAt optional
└── revokedAt optional
```

Flow:

```text
enter link/code
→ resolve class
→ show class identity
→ choose:
   - assigned StudentSeat handle
   - existing registered account
→ confirm
→ create membership/session
```

Requirements:

- accept equivalent formatting with spaces/dashes/case normalization;
- store only a hash of the secret token;
- support rotation and revocation;
- rate-limit attempts;
- avoid roster enumeration;
- bind the resulting session to one principal.

## 7. Roster

Required columns:

```text
learner
principal type
login handle
last active
badges
Safe Mode
row actions
```

Required actions by policy:

```text
assign badge
edit profile settings
rename StudentSeat
add/remove class membership
reset credential
suspend/reactivate
archive/delete subject to retention
```

Every mutation emits an AuditEvent.

## 8. Class workspace navigation

```text
Students
Activities
Projects
Moderation
Co-teachers
```

Future ASA Lab additions may include Overview, Review, Grades and Settings without removing the observed parity tabs.

Class workspace header includes:

- class title;
- class code;
- share link;
- global Safe Mode;
- help/instructions.

## 9. Learner project supervision

Teacher gallery:

```text
learner selector
previous/next
privacy state
module tabs
sort
grid/list
project cards
```

Project Viewer:

```text
exact preview
simulate
versions
teacher reaction
assistance/edit affordance
class context
copy link
visibility
dates
report
```

### 9.1 Teacher assistance modes

```text
view_only
assist_learner_project
create_teacher_copy
restore_version_as_new_draft
```

`assist_learner_project` requires:

- explicit `classroom.student_work.edit` grant;
- visible learner/class banner;
- AuditEvent on open/save/exit;
- optional learner notification according to policy;
- no cross-class access.

Silent teacher mutation of learner work is prohibited.

## 10. Adult publication

Adult personal project properties:

```text
title
description
tags
visibility: private | unlisted | public
license
public display name
```

Publishing creates or selects an immutable ProjectVersion. Public display name is distinct from the private account username.

Adding a personal educator project to a class activity must reference/copy a selected immutable starter version; it must never expose the mutable educator draft.

## 11. API surface target

Names may change, but the capability boundaries must not.

```text
POST /api/accounts/register/adult
POST /api/capabilities/educator/self-attest
GET  /api/classes
POST /api/classes
GET  /api/classes/:id
POST /api/classes/:id/seats
POST /api/classes/:id/seats/batch
GET  /api/classes/:id/roster
PATCH /api/classes/:id/policies
POST /api/classes/:id/join-codes/rotate
POST /api/class-join/resolve
POST /api/class-join/studentseat
POST /api/class-join/account
GET  /api/classes/:id/learners/:learnerId/projects
GET  /api/classes/:id/learners/:learnerId/projects/:projectId
POST /api/projects/:id/reactions
POST /api/projects/:id/teacher-assistance-sessions
GET  /api/projects/:id/versions
```

## 12. Required tests

- adult account can work before email confirmation in configured parity/pilot mode;
- underage account cannot self-attest educator;
- client cannot forge educator capability;
- educator can create class without organization in the parity release;
- non-educator cannot create class;
- Safe Mode defaults according to policy;
- bulk handles are normalized and collision-safe;
- plaintext class-code token is not stored;
- StudentSeat cannot authenticate against another class by reusing a handle;
- registered-account and StudentSeat join paths both work;
- teacher sees only authorized class learners;
- teacher assistance requires explicit grant, banner and audit;
- project version history remains immutable;
- restore creates a copy;
- public display name does not expose private username;
- no email/password is required for StudentSeat;
- brute-force and roster-enumeration attempts are rate-limited.

## 13. Visual evidence gate

Required owner-review screens:

1. adult email registration;
2. educator attestation modal;
3. class create form;
4. empty class workspace;
5. individual StudentSeat form;
6. bulk StudentSeat form and preview;
7. populated roster;
8. class code/share screen;
9. registered-account versus StudentSeat join choices;
10. StudentSeat handle login;
11. learner creator home;
12. teacher learner gallery;
13. teacher project viewer;
14. version journal;
15. teacher-assisted editor with visible context banner.

A green unit-test count does not replace this visual gate.
