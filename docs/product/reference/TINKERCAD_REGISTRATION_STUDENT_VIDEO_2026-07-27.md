# Tinkercad registration and registered-student flow — owner video evidence

**Status:** normative private-repository reference evidence for ASA Lab.  
**Source:** owner-provided recording `2026-07-27 20-32-36.mp4`.  
**Recording:** 530.233333 s, 1920×1080, 60 fps, H.264/AAC, 31,814 video frames.  
**Data classification:** every identifier shown is synthetic test data supplied by the owner. Storage in the private ASA Lab repository/evidence area is allowed. Public redistribution requires owner approval because the recording contains a third-party product interface.

## Analysis method

- 31,814 frames were decoded.
- 531 periodic samples at one-second intervals were measured.
- visual-difference and histogram transitions were indexed;
- five ten-second contact sheets and focused transition sheets were reviewed;
- 56 full-resolution keyframes were extracted;
- five functional clips were produced locally:
  1. entry and registration choice;
  2. Autodesk account registration;
  3. child confirmation and guardian email;
  4. login and class-code join;
  5. student shell, badges and profile.

This report records visible behavior. It does not claim implementation details that were not shown.

## Executive conclusion

The video confirms that account creation, child safety, student class entry and the creator portal are separate but connected systems.

The reference flow is:

```text
public entry
→ choose school/personal context
→ age-aware registration
→ pending child approval
→ approve by teacher class or guardian
→ account sign-in
→ class-code join
→ student creator portal
→ class activity, projects, badges and privacy-aware profile
```

ASA Lab should reproduce the product logic, while removing the confusing Autodesk hand-offs, repeated CAPTCHA loops and manual guardian logout/re-entry.

## Verified timeline

| Time | Surface | Visible behavior | ASA Lab requirement |
|---|---|---|---|
| 00:00–00:18 | Public landing and entry | Tinkercad marketing page; Start/Join entry is opened. | ASA Lab needs an unauthenticated landing with Sign in, Create account, Join class. |
| 00:18–00:50 | Context chooser | School: educator and student/class entry; personal account creation; existing account sign-in. | Use an entry router only; server capabilities determine roles. |
| 00:50–00:55 | Registration method chooser | Email-based registration, Google, Apple, additional sign-in methods. | ASA Lab may support native email first; external providers are optional adapters. |
| 00:55–01:15 | Country and age step | Country/region plus full date of birth are requested before credentials. | Age band must be resolved before consent and publication policies. |
| 01:15–02:00 | Username/password step | Username and password; live password requirements; username availability is checked. | Check username availability early; show clear password policy; avoid vendor context switching. |
| 02:00–03:41 | Anti-bot and retry loop | Multiple visual CAPTCHA rounds; unavailable username causes re-entry and another attempt. | ASA Lab should use low-friction risk-based anti-abuse, not repeated puzzles. |
| 03:41–04:45 | Restricted child account state | Account exists but project work is restricted; approval required within 14 days; teacher or guardian approval options. | Implement explicit `pending_approval` state with deadline, restrictions and status page. |
| 04:45–05:32 | Guardian email approval path | Guardian email receives approval link. The link expects a Tinkercad account and may require sign-out/re-entry when the child is logged in. | ASA Lab should use a one-time consent link and allow guardian account creation in one flow. |
| 05:32–06:37 | Account sign-in return | Personal account sign-in routes through Autodesk identity and returns to Tinkercad pending state. | ASA Lab should own the flow and preserve redirect context deterministically. |
| 06:37–07:06 | Registered student joins class | Student enters teacher-provided code, sees class/account confirmation, then joins. | Class-code join is separate from login; confirm class and current identity before commit. |
| 07:06–07:40 | Student class shell | Joined class appears in `Your classes`; View class, join another class, transfer projects; class activity may be empty. | Student dashboard requires class list and class activity, not only assignments. |
| 07:40–07:56 | Badges | Received and available skill badges; badge taxonomy and detail affordance. | `BadgeDefinition` and `BadgeAward` are first-class student surfaces. |
| 07:56–08:06 | Student profile | Profile header, active date, bio, module tabs, filters, sort, grid/list; public portfolio currently empty. | Use one module-aware profile/portfolio surface with Safe Mode policy. |
| 08:06–08:43 | Profile and account settings | Safe Mode banner, restricted profile editing, private username, optional display name and bio, sign-out-all-devices. | Implement privacy-aware profile plus security/session management. |
| 08:43–08:50 | Student creator home | Module-grouped starter projects for 3D, Circuits and Codeblocks remain available. | A student remains a creator; Safe Mode restricts publication/social actions, not all creation. |

## 1. Contextual entry is a router, not a role switch

The entry surface presents distinct paths:

```text
In school
├── Educators
├── Students with class code
└── Student accounts

On your own
└── Personal account

Existing account
└── Sign in
```

The choice controls the authentication/onboarding route. It must not grant `educator`, `school_admin` or any other server capability.

## 2. Registration flow observed

### 2.1 Registration methods

The personal-account path offers:

- native registration;
- Google;
- Apple;
- additional sign-in methods;
- existing-account sign-in.

### 2.2 Age-aware first step

Before credentials, Autodesk requests:

- country/region;
- full date of birth.

This causes the downstream flow to become a child-account flow when the supplied age is under the applicable threshold.

ASA Lab should model an `AgeBand`/policy result rather than scatter age checks through UI components.

### 2.3 Credentials

The next step requests:

- username;
- password.

Password rules are shown live. Username availability is checked, but the recording shows the user reaching an unavailable-name error after substantial effort.

Recommended ASA Lab behavior:

- check availability while typing or on blur;
- retain completed fields on error;
- avoid language changes during the same flow;
- allow a recovery-safe email/guardian path appropriate to the age policy.

### 2.4 Anti-abuse

The flow uses multiple image CAPTCHA rounds and may repeat after username retries.

ASA Lab should implement risk-based abuse protection with server rate limits and optional challenge escalation. A routine child onboarding flow should not require repeated visual puzzles.

## 3. Pending child account and approval

After account creation, the new account enters a restricted state:

```text
pending_approval
deadline: 14 days
project capability: restricted
```

The visible page offers two approval paths.

### 3.1 Teacher approval

```text
Join teacher class
→ class membership
→ approval granted through moderated classroom
```

### 3.2 Guardian approval

```text
enter guardian email
→ guardian receives one-time approval link
→ guardian authenticates or creates account
→ child account approved
```

The reference flow has a serious usability problem: when the child is currently logged in, the approval link tells the guardian to sign out and reopen the email link under a Tinkercad account.

ASA Lab should instead preserve an approval transaction:

```text
ConsentRequest(tokenHash, childAccountId, guardianEmail, expiresAt, status)
```

The guardian link should open a dedicated flow that can:

- authenticate an existing guardian;
- create a guardian account;
- approve or decline;
- return a clear completion receipt;
- never require manual re-navigation to the original email.

## 4. Required account state machine

```text
anonymous
→ registration_started
→ credentials_created
→ pending_approval
   ├── approved_by_guardian
   ├── approved_by_educator_class
   ├── declined
   └── expired
→ active_safe_mode
→ active_standard (only when policy permits)
→ suspended/deleted
```

State transitions must be server-side, audited and time-bounded.

## 5. Registered-student class-code join

The recording shows the registered-student path, not the nickname/no-account StudentSeat path.

Visible sequence:

```text
signed-in student
→ enter grouped class code
→ preview class + current account identity
→ confirm “Go to class”
→ membership created
→ “Your classes” page
```

The confirmation step is important: it prevents joining the wrong class or using the wrong signed-in account.

The class list shows:

- class title;
- teacher name;
- `View class`;
- `Join another class`;
- `Transfer projects`.

This implies that project ownership remains with the student account and that project transfer between class contexts is a separate action.

## 6. Student account is still a creator account

After joining the class, the student receives the same broad creator shell:

- Home;
- Classes;
- Projects;
- Collections;
- Tutorials;
- Challenges;
- Help.

The final dashboard still offers module-grouped starters for:

- 3D;
- Circuits;
- Codeblocks.

Therefore:

> Safe Mode must restrict publication, profile exposure and social actions; it must not turn the student into an assignment-only account.

## 7. Class activity surface

Opening the joined class shows the class title and teacher. The empty state says that the teacher has not created activities yet.

ASA Lab needs:

```text
ClassroomMembership
ClassroomActivity
ActivityVersion
AssignmentWork
```

but the learner class home should exist even when no activity has been assigned.

## 8. Badges

The account displays badge previews in the sidebar and a dedicated `Your badges` page.

Visible badge taxonomy includes:

- Design Thinking;
- Electronics;
- Coding;
- 3D Printing;
- 3D Artist;
- Robotics;
- Architecture;
- Sustainability;
- Innovation;
- Curiosity;
- Collaboration;
- Communication.

Required model:

```text
BadgeDefinition
BadgeCriteria
BadgeAward
awardedBy
evidenceRef
awardedAt
revokedAt
```

## 9. Student profile and privacy

The profile surface includes:

- username;
- active-since date;
- biography;
- module tabs (`3D`, `Circuits`, `Codeblocks`);
- copyable filter;
- application/type filters;
- sort;
- grid/list.

Settings show:

- Safe Mode banner;
- restricted profile-editing message;
- profile privacy/locked state;
- private username visible to the user and moderators;
- optional display name;
- bio;
- `Sign out on all devices`.

ASA Lab should separate:

```text
Account username        private credential/display handle
Public display name     policy-controlled
Profile visibility      private/restricted/public
Project visibility      per project/version
Safe Mode               capability policy
Session management      active session revocation
```

## 10. What to copy exactly and what to improve

### Copy as a product invariant

- contextual entry paths;
- age-aware onboarding;
- separate teacher and guardian approval;
- explicit pending/restricted state;
- class-code confirmation step;
- student remains a creator;
- Safe Mode;
- module-aware dashboard/profile;
- badges;
- sign-out-all-devices;
- class list and activity empty states.

### Improve in ASA Lab

- keep registration inside one ASA Lab flow;
- avoid Autodesk/Tinkercad context switching;
- use one language consistently;
- avoid repeated CAPTCHAs;
- validate username early;
- preserve form state;
- use one-time guardian approval transactions;
- do not require guardian manual logout/reopen;
- show a clear onboarding progress indicator;
- clearly explain what is restricted and what remains available;
- provide a visible approval-status page.

## 11. Domain model additions

```text
Account
Credential
Profile
AgeBand
ConsentRequest
GuardianLink
EducatorApproval
AccountRestriction
CapabilityGrant
Entitlement
Session
OrganizationMembership
ClassroomMembership
ClassroomJoinCode
ClassroomJoinAttempt
SafeModePolicy
BadgeDefinition
BadgeAward
AuditEvent
```

`ManagedChildLink` and `StudentSeat` remain separate concepts.

## 12. P0.5 implementation slices

### A. Public entry router

- Sign in;
- Create account;
- Join class;
- Educator;
- Registered student;
- Personal account.

### B. Native registration

- country/locale;
- date of birth or policy-safe age-band resolution;
- username/display name;
- password;
- anti-abuse;
- duplicate-name handling;
- pending approval result.

### C. Approval center

- guardian email link;
- educator/class approval;
- deadline;
- resend/cancel;
- audit;
- explicit status.

### D. Registered student join

- class code;
- class/account confirmation;
- join;
- class list;
- join another class;
- transfer-project placeholder.

### E. Student portal

- creator Home;
- Projects;
- Classes;
- Collections;
- Learning;
- Challenges;
- Badges;
- profile/settings;
- Safe Mode.

## 13. Still unverified

The recording does not fully verify:

- educator onboarding/verification;
- organization creation;
- teacher class creation;
- no-account nickname StudentSeat flow after entering a class code;
- guardian approval completion after successful guardian authentication;
- exact age thresholds by jurisdiction;
- billing;
- full assignment/submission/review flow;
- publication/remix/community.

The next owner video on class creation should extend the Classroom reference contract rather than overwrite this account/student contract.
