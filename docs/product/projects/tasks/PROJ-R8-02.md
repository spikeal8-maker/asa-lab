# PROJ-R8-02 — Interactions and Public Author Projection

**Статус:** PREPARED / NOT ACTIVATED  
**Depends on:** accepted `PROJ-R8-01` and stable R7 publication/remix contracts.  
**TARGET:** `docs/product/ASA_PROJECTS_IMPLEMENTATION_TZ.md`  
**Decisions:** `docs/product/projects/DECISION_LEDGER.md`

---

## 0. Activation gate

Start only when this exact slice is selected and relevant decisions are resolved:

- DEC-PROJ-109 reaction `wow` visual policy;
- DEC-PROJ-110 depth of public author projection / Studio scope;
- minor profile/publication policy remains fail-closed and current.

---

## 1. Пользовательский результат

Public Projects gets useful but controlled social context:

- save to Collections;
- eligible reactions;
- real copy/remix count when persisted;
- safe public author projection;
- link from project to author’s other eligible public projects;
- clear provenance for remixed projects.

The goal is reputation and discovery support, not creation of a full social network.

---

## 2. Scope

In:

- Collections interaction UX on catalog/detail;
- existing reaction compatibility/convergence;
- real counters backed by persistent data;
- safe author/public-profile projection;
- other public projects by same author where policy allows;
- provenance presentation;
- privacy/minor guards;
- rate limits/idempotency for interaction mutations as needed.

Out:

- comments;
- direct messages;
- followers/subscriptions unless separately approved;
- full Studio collaboration/ownership unless DEC-PROJ-110 explicitly enables a bounded sub-slice;
- fake reputation score;
- ML recommendations.

---

## 3. Social signals rule

Only persistent real signals may appear:

- like;
- save;
- copy/remix count;
- view/open/launch only after their counting contract exists;
- `wow` only according to accepted compatibility/UX decision.

No universal star rating `4.8/5`.

Counters must have documented meaning and dedup semantics where relevant.

---

## 4. Public author projection

Minimum safe projection:

- public display label;
- public avatar if permitted;
- generic public account/profile kind where allowed;
- eligible public project count;
- public projects list.

Must not expose:

- email/login;
- class/school membership;
- tenant/workspace IDs;
- internal roles/permissions;
- private project counts;
- minor-sensitive data.

Student/minor projection follows accepted Identity/privacy policy and may be more restrictive than adult Account projection.

---

## 5. REUSE / MODIFY / BUILD

### REUSE

- Collections domain;
- existing reaction storage/functions where semantically valid;
- copy/provenance;
- Identity public-safe projection patterns if available.

### MODIFY

- interaction DTOs/counters;
- author projection endpoints/components;
- Gallery legacy reaction compatibility.

### BUILD

- minimal public author/profile endpoint/surface only if no safe existing projection exists;
- aggregate counters only where source data is persistent and indexed.

No second likes/bookmarks/profile domain.

---

## 6. Required tests

- save add/remove uses existing Collections;
- duplicate reaction mutation is idempotent/canonical;
- unauthorized persistent interaction prompts/denies correctly;
- real copy/remix count matches persistent source;
- public author DTO excludes school/class/private identity fields;
- minor-restricted projection remains restricted;
- author page/list excludes private/unlisted/revoked projects;
- provenance survives source visibility changes without leaking forbidden details;
- interaction UI works mobile/keyboard;
- catalog/detail performance does not degrade through N+1 author/count queries.

---

## 7. Acceptance Criteria

- **R8-02-AC01** Collections is the only save domain.
- **R8-02-AC02** reactions/counters are real and persistent.
- **R8-02-AC03** public author projection is privacy-safe.
- **R8-02-AC04** no classroom/school/private identity leakage.
- **R8-02-AC05** provenance remains visible within policy.
- **R8-02-AC06** no second social/profile domain is created.
- **R8-02-AC07** API performance avoids obvious N+1/regression.

---

## 8. Hygiene

Standard threshold = 3 slices. Trigger earlier if interaction counters create new heavy queries, duplicate social storage, or public profile logic starts coupling to Identity internals.

---

## 9. STOP conditions

STOP if safe minor projection is unresolved for the active path, new social storage duplicates existing domains, Studio collaboration expands scope, or counter semantics cannot be proven from persistent data.