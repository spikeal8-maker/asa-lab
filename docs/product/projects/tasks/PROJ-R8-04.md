# PROJ-R8-04 — Public Project Comments

**Статус:** PREPARED / BLOCKED BY R8-03  
**Depends on:** accepted `PROJ-R8-03` Moderation Foundation + resolved `DEC-PROJ-111`.  
**TARGET:** `docs/product/ASA_PROJECTS_IMPLEMENTATION_TZ.md`  
**Decisions:** `docs/product/projects/DECISION_LEDGER.md`

---

## 0. Activation gate

Comments do not start until:

1. reports/cases/actions/audit are accepted;
2. rate-limit and abuse-handling foundation exists;
3. `DEC-PROJ-111` defines who may comment;
4. this exact slice is selected in `docs/execution/current.yaml`;
5. current main is delta-checked.

---

## 1. Пользовательский результат

Eligible users can discuss a public project safely:

- create a comment;
- reply within bounded thread depth;
- see recent comments on project page;
- open all comments;
- report a comment;
- author can manage discussion within owner boundaries;
- moderator can act through moderation foundation;
- project owner can disable comments if policy allows.

No direct messages are introduced.

---

## 2. Scope

In:

- public comments storage/API;
- bounded replies;
- create/list/delete-own semantics;
- owner hide/moderation boundary;
- moderator hide/remove through R8-03;
- comment reports;
- rate limits;
- body/thread size limits;
- safe rendering/XSS protection;
- pagination;
- disable-comments setting;
- mobile comments UI;
- loading/error states.

Out:

- private messages;
- chat;
- follower notifications unless separately approved;
- classroom ReviewComment reuse as public comments;
- unlimited nested discussion tree.

---

## 3. Domain rule

`PublicComment` is a public-project interaction. It does not replace classroom review/feedback comments and does not grant classroom permissions.

Conceptual fields:

```text
publication_id
comment_id
author_principal_id
parent_comment_id nullable
body
status
created_at
updated_at
```

Statuses must distinguish author deletion, owner hide, moderator hide/removal where product policy requires it.

---

## 4. Safety

Mandatory:

- server-side authorization;
- rate limits;
- body size limit;
- thread depth limit;
- XSS-safe output;
- no raw HTML trust;
- report integration;
- disable-comments enforcement at API level;
- minor/StudentSeat participation exactly per DEC-PROJ-111/current policy;
- public DTO does not expose private identity fields.

---

## 5. Owner vs moderator boundaries

Owner may, according to accepted policy:

- disable comments on own publication;
- hide/manage comments under own project;
- report abuse.

Owner cannot:

- erase platform moderation history;
- act as platform moderator outside own publication.

Moderator acts through R8-03 and does not become project author.

---

## 6. Required tests

- allowed principal creates comment;
- forbidden/anonymous/minor cases follow DEC-PROJ-111;
- disabled comments reject writes server-side;
- body/thread/rate limits enforced;
- XSS payload rendered safely;
- owner and moderator hide produce distinct canonical states where required;
- author own-delete semantics work;
- report routes to moderation foundation;
- private/revoked project comments unavailable;
- pagination stable;
- mobile bottom/inline comments UI works;
- no classroom ReviewComment data is mixed into public comments.

---

## 7. Acceptance Criteria

- **R8-04-AC01** comments only exist after accepted moderation foundation.
- **R8-04-AC02** participant policy is explicit and server-enforced.
- **R8-04-AC03** XSS/rate/depth/body limits pass.
- **R8-04-AC04** report integration works.
- **R8-04-AC05** owner/moderator boundaries are distinct.
- **R8-04-AC06** comments can be disabled.
- **R8-04-AC07** no DM/chat subsystem is introduced.
- **R8-04-AC08** mobile/accessibility regressions pass.

---

## 8. Hygiene

Standard threshold = 3 slices, but security trigger can require immediate L2. Audit duplicate moderation/auth logic, large threaded UI components, test-generated screenshots and new dependencies.

---

## 9. STOP conditions

STOP if R8-03 is incomplete, DEC-PROJ-111 is unresolved for active actors, abuse controls are absent, or implementation attempts to reuse classroom comments with incompatible semantics.