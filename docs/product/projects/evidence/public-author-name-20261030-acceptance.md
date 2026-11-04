# Existing public author name: technical source acceptance

Owner clarification DEC-PROJ-124 supersedes the mistaken suggestion of a new
author-name field or user name-visibility switch. Registration already stores the
public display name. Internal whole-profile visibility was incorrectly hiding it
in publications; this was an implementation defect, not an owner-selected setting.

PR884 exact candidate `343235de2bb208926e5920b81a36c82266e44e18` merged as
`edfbd0057f1a37a473ced5799c6598e8c49aede1`. Independent exact Code/Security PASS.

## Result

Forward migration0285 reads only existing profiles.display_name through the exact
recorded Account author principal, without a whole-profile visibility condition.
Private helper EXECUTE is revoked from PUBLIC/asalab_app. Public catalog/detail,
admin list, admitted copies and collections use a consistent projection. New
publication snapshots record the correct name; old publications display it on
read without republishing or UPDATE of immutable PublicationRevision/ProjectVersion.
Canonical profile renaming updates current public identity presentation.

No new fields/consent/full-profile disclosure, email/login fallback, classroom
roster lookup, source/license/history rewriting or authorization expansion.
Seat/legacy attribution retains the previously approved fallback. All five copied
function definitions independently compared: only author-name expressions changed;
authorization, locks, order and admission remain intact. Historical SQL untouched.

## Verified evidence

- [Public Projects41095438714](https://github.com/spikeal8-maker/asa-lab/actions/runs/41095438714):
  actual PostgreSQL/API and built-browser gate SUCCESS; all28 browser cases PASS.
- [General41095438423](https://github.com/spikeal8-maker/asa-lab/actions/runs/41095438423):
  all four jobs SUCCESS: governance, code/build, PostgreSQL/RLS and Access A.
- Genuine populated284→285 upgrade checks old generic labels, unchanged immutable
  rows, current names/admin/revocation and denial of direct helper/profile access.
  Existing PG checks also cover copy attribution, collections, profile renaming and
  visibility negatives. Browser registers a real test display name and asserts it
  on cards and detail, without forcing profiles.visibility to public.
- Migration/lint/format/diff checks PASS. Exact migration LF digest retained.
  Missing local generated declarations were not repaired or treated as acceptance.
- Artifact `public-projects-343235de2bb208926e5920b81a36c82266e44e18` contains actual
  catalog/detail screenshots at seven widths under e2e/artifacts/public-projects.
  Controller inspected catalogue390 and detail-normal-viewport390: actual entered
  test display names are visible. Test previews are not a new3D renderer.
- One initial test assumed retired Gallery detail returned data. Final test keeps
  gallery_work/gallery_list empty and retains active Public Projects name checks;
  no legacy private document projection was restored.
- Read-only production diagnosis for the owner's existing electrical publication
  confirmed recorded Account author, nonempty display name, internal nonpublic
  profile flag and frozen generic author label. No names/credentials dumped.

No working database migration or site deployment performed. The running site must
receive a separately authorized ready release before this fix becomes visible.
Owner visual acceptance remains pending; no next source slice selected.
