# Compact Projects catalog: technical source acceptance

PR880 candidate `6bd11e64842baaee28ad72a519f5d0b461ca03a8` merged as
`c729dbf92c97cf01a8753e17d0ee298d9004054b`. Independent exact Code review PASS.
No authorization/API changes; reviewer found no new security-boundary change.

## Implemented

Canonical UI/UX sections4–7,21,70–72 applied to supported existing data:
bounded400px desktop search beside title, modest My Projects link, horizontal
selected module chips, image-first cards with small type/editorial marks, two-line
title, single-line author and actual like/date data. Loaded count explicitly says
shown rather than pretending to be a server total. Four/three/two/one columns
adapt to available width. Unknown module filters retain recovery.

Search/query URLs, pagination/stale-response/error guards, API and visibility
permissions remain unchanged. No fabricated metrics, featured DTO, new categories,
card viewers, 3D viewer or global shell/detail-page change.

## Exact evidence

- [Public Projects 41087156379](https://github.com/spikeal8-maker/asa-lab/actions/runs/41087156379):
  code/real PostgreSQL/build admission and all28 actual browser cases PASS.
- [General 41087156451](https://github.com/spikeal8-maker/asa-lab/actions/runs/41087156451):
  all four jobs SUCCESS, including PostgreSQL/RLS and Access A.
- Four focused behavioral units, ESLint and diff check PASS. Existing gate executes
  the new unit through its directory scope and requires the file.
- Artifact `public-projects-6bd11e64842baaee28ad72a519f5d0b461ca03a8` contains
  `e2e/artifacts/public-projects/catalogue-{320,360,390,430,768,1024,1440}.png`.
  Real isolated PG publications, long text, exact columns, first-screen density,
  search width, filter URL roundtrip, keyboard outline and loading/empty/network
  failure/retry are checked. Final1440/390 screenshots inspected by controller.
  Test previews labelled V1 are test fixtures, not proof of a new 3D renderer.
- The first browser run exposed an artificial focus assertion after pointer
  category selection. Final test uses real Shift+Tab/Tab, asserts focus leaves
  and returns, and retains the strict computed outline/shadow check. Product
  styling was not loosened; no fake focus classes or forced browser events.

## Owner author-name finding and remaining scope

Owner reported generic author labels during this work. SQL in0274 deliberately
freezes `profiles.display_name` only when profile.visibility is public; otherwise
it freezes 'Автор проекта'. Profiles default private (0010). A later profile
change does not rewrite immutable PublicationRevision attribution. The existing
PG test explicitly checks both privacy and republishing to a public name.

This presentation slice does NOT resolve that product gap or expose private
display names/login/email. Follow-up should provide an explicit, understandable
public author-name choice and define updates to prior publication attribution,
including StudentSeat safeguards. Do not infer permission to make full profiles
public. Existing generic labels in screenshots are honestly retained.

Separate editorial banner, advanced author/tag/studio search and public author
identity controls are not claimed complete. Site deployment was not run; owner
visual acceptance remains pending. No next implementation slice selected.
