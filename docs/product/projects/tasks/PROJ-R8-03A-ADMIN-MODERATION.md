# PROJ-R8-03A — Admin publication hide / restore (visible safety slice)

**Issue:** #686, parent #211. **Selected by owner on 2026-10-21.**
**Predecessors:** accepted Public Projects initial publish #613 and exact-copy #672 in main.
**Scope:** safety-critical bounded moderation action ahead of broader R8 community rollout. This does not declare R7/R8 complete or authorize comments.

## User-visible result
Verified platform administrator opens **Admin → Publications**, sees a bounded paginated list of schema-2 live/hidden public publications with real preview, author, module, date and state; selects a publication and hides it with a nonempty reason; can restore it with explicit confirmation and recorded reason. Author sees the moderation reason in publication status. The original Working Project, immutable ProjectVersion and owner's private drafts remain untouched. No permanent content deletion is offered in this slice.

## Authorization
- Platform scope only, verified platform_admin capability; organization moderator/owner, ordinary Account, StudentSeat, anonymous have no access to list, preview or writes. The server transport AND privileged SQL independently check this.
- No guest metadata leak, no direct table grants; migration security definer functions are narrowly scoped with revokes, bounded input and lock discipline.
- Every actual state transition writes an append-only administrative audit event with actor, publication, before/after, reason and request ID. No report-driven automatic deletion.
- Stale/replayed actions, double clicks, navigation and error states cannot silently undo moderation.

## Distribution boundary
Moderator hiding a schema-2 publication excludes it from public list, detail, frozen image, copy, Gallery compatibility, Collections/public read and any future artifact route using canonical project_publication_readable. Hide survives owner publish/update/revoke until a platform administrator restores it. Restoration never republishes an already-revoked/otherwise-ineligible Project.

## Files
- New additive migration `0236_project_publication_moderation.sql`, no historical SQL edits.
- API `apps/api/src/admin-public-projects.controller.ts` and app registration, narrowly scoped owner status reason.
- UI `apps/web/src/admin/AdminPublicationsPage.tsx`, navigation, admin-page mount, focused CSS/API module.
- Focused unit, real PostgreSQL authorization/privacy/lifecycle and built-browser desktop/mobile tests, no unsupported device claims.
- Update migration expected versions/count/legacy data preservation tests without reducing strict guards.

## DoD
Full one-actor hide and restore using real admin auth, audit, PG and browser evidence on exact final SHA, an independent non-author review, approved main integration, post-main readback and scope-only smoke. No live installation, production DB, global admin user privileges, or cleanup.

## Out of scope — later visible increments
Featured/pinned/badges, public report queue, cases and appeals, media-only moderation, revision selection, download/export/import and interactive viewers. No comments until R8-03 full foundation.