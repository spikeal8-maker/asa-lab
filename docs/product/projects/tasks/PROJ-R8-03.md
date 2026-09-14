# PROJ-R8-03 — Moderation Foundation

**Статус:** PREPARED / NOT ACTIVATED  
**Depends on:** stable R7 publication/media contracts and explicit R8 activation.  
**TARGET:** `docs/product/ASA_PROJECTS_IMPLEMENTATION_TZ.md`

---

## 0. Activation gate

This slice must be accepted **before comments**. Coding starts only when selected in control-plane and current Identity/Authz/audit infrastructure has been delta-checked.

---

## 1. Пользовательский результат

ASA Lab can receive and process reports on public projects/media, restrict violating public content, explain the action to the owner, and restore content after correction without deleting the underlying Working Project.

Moderation controls public distribution and safety; it does not become author editing.

---

## 2. Scope

In:

- report creation;
- moderation case;
- moderation action;
- reason/status model;
- audit trail;
- request changes;
- remove from discovery;
- restrict/hide specific media where media exists;
- hide/restrict publication;
- restore;
- owner-facing reason/state;
- resubmission/review flow where applicable;
- rate limits/abuse controls;
- moderator/admin authorization.

Out:

- public comments themselves;
- direct messaging;
- moderator rewriting author title/description as normal flow;
- deletion of Working Project as routine moderation action;
- automatic hiding after one report without policy decision.

---

## 3. Domain separation

```text
Report = incoming signal
ModerationCase = review/work item
ModerationAction = auditable platform action
Publication/Media moderation state = public effect
Working Project = remains author-owned
```

Do not model a report as an automatic moderation action.

---

## 4. Minimum actions

- `no_action`;
- `request_changes`;
- `hide_media` where applicable;
- `remove_from_discovery`;
- `hide_publication` / equivalent restricted state;
- `block_publication` where policy requires;
- `restore`.

Each action records actor, reason, target, previous/new state and timestamp through canonical audit mechanism or a narrowly scoped auditable record if no generic mechanism exists.

---

## 5. Permissions

- ordinary user may report eligible public content;
- owner cannot erase platform moderation history;
- moderator can perform only approved moderation actions;
- moderator does not call ordinary author-edit endpoint to rewrite content;
- admin exceptional action remains auditable;
- frontend visibility is not authorization.

---

## 6. Owner experience

For `Требуются изменения`, owner receives:

- what is affected;
- why;
- what must be changed;
- whether publication remains editable;
- how to resubmit/republish.

A hidden/restricted project should have a meaningful owner state instead of disappearing from their workspace.

---

## 7. Required tests

- report does not auto-delete publication;
- rate limit/duplicate abuse behavior works;
- non-moderator cannot execute moderator actions;
- moderator cannot author-edit through moderation contract;
- restrict removes content from required public surfaces/caches;
- restricted media URL stops being public where applicable;
- owner Working Project and ProjectVersions remain intact;
- reason/audit actor recorded;
- restore returns eligible content without rewriting history;
- request changes/resubmit path works;
- private/moderation internals are not exposed to public viewer.

---

## 8. Acceptance Criteria

- **R8-03-AC01** reports, cases and actions are distinct concepts.
- **R8-03-AC02** all platform moderation actions are auditable.
- **R8-03-AC03** moderation affects public state, not author ownership of Working Project.
- **R8-03-AC04** restrict/restore is reversible where policy permits.
- **R8-03-AC05** owner receives actionable reason.
- **R8-03-AC06** server-side permissions/rate limits pass.
- **R8-03-AC07** this foundation is sufficient for R8-04 comments activation.

---

## 9. Hygiene

Security/safety-sensitive slice. L2 may be triggered before normal counter if moderation logic starts duplicating generic Identity/Authz/audit mechanisms or a controller accumulates report/case/action/UI responsibilities.

---

## 10. STOP conditions

STOP if moderation requires destructive Project deletion as normal behavior, if no auditable authorization boundary can be established, or if implementation would silently broaden moderator authoring rights.