# R8-03B — Редакционное выделение «Выбор редакции»

Issue #691, parent programme #211. Follows merged moderation PR #687.
**One visible increment:** verified platform_admin marks/unmarks an eligible exact immutable
PublicationRevision from Admin → Публикации. Catalog and public detail show a
compact «★ Выбор редакции» while the selected revision is publicly eligible.
This is NOT a sorting pin, nor a configurable badge family.

Backend: additive migration 0237, CAS on editorialVersion, currentRevisionId
and moderationVersion, Project→state lock order, verified administrator in Nest/SQL,
append-only audit actor/action/target/request/version, no direct table access by
app role. Badge expires after author revision update, hide/restore, revoke or
resource policy restriction; restore never automatically renews the badge.
Public DTO exposes only featured:boolean, not editorial internal identity/audit.

UX: no mock content or invented success. Server-confirmed reversible button,
409 conflict explained, desktop/mobile 1440/390 and 320 adaptive.
Projects/Drafts/Versions/Collections/Classroom unchanged.
Required: isolated PostgreSQL and populated upgrade, authorization/audit negatives,
real browser catalog/detail and admin, existing moderation/copy regressions,
exact-SHA focused and General gates and independent review before merge.
No production migration, deployment or data deletion. Next slice: pin ordering.
