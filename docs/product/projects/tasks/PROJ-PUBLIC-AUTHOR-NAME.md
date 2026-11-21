# TASK-PROJ-PUBLIC-AUTHOR-NAME-001

Owner corrected the existing product contract: the registration display name is
the public author name. No user-facing name privacy toggle exists. Internal
whole-profile visibility must not suppress this field. Do not add a duplicate
name field or require publishing the whole profile. Decision DEC-PROJ-124.

## Bounded result

Catalog and project detail show the existing canonical public display name,
including prior publications whose frozen author label was the generic fallback.
Avoid rewriting immutable ProjectVersion/PublicationRevision/source/license
history. New publication attribution and public/copy/admin projections must be
consistent with their canonical contracts. Inspect these paths before selecting
the smallest correct additive fix. No email/login fallback or full profile DTO.

Identity remains exact: use recorded author/owner lineage, never guessed name,
email, current viewer or another project. Preserve unavailable/revoked/hidden/
learning and account/seat permissions. Account.displayName is not the same as
private classroom roster data: retain approved StudentSeat public projection and
do not invent or expose new classroom metadata as part of this Account fix.

Existing migration SQL stays immutable; if SQL changes, one forward migration
after the actual remote frontier, restricted-role checks and upgrade from data
containing old generic labels. No live DB mutation or deployment in this slice.

## Evidence

One author first reports minimal implementation strategy, then bounded code,
focused tests and self-review. Exact independent Code and Security review.
Real PG/API: private-profile Account with existing public display name shows that
name, old publication works without republish, exact identity, no other private
field exposed, immutable rows unchanged, copy/admin semantics checked, visibility
negatives unchanged. Registration/profile canonical contract and public-name
fallback handling are exercised. Actual built browser catalog+detail author text
and relevant existing public regressions; General before Main. No dependency
repair or local heavy PG/build/browser. Report and STOP.
