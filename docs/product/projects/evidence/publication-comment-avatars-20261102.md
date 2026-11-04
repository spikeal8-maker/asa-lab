# Real comment avatars — local acceptance

Owner request: show the user's actual avatar in publication comments, retain
initials when absent, verify desktop/mobile, do not deploy the site.

Implemented through additive migration 0291: Account profile image, the learner's
selected built-in avatar or available selected custom classroom image. Unselected
automatic catalog defaults are not invented for commenters without an avatar.
The comment DTO exposes an opaque comment-based URL, not Account/Seat IDs, email,
classroom metadata or inline image data. Both creation receipts and list/reply/pin
projections use the same DTO. Existing display names and permissions are unchanged.

The image endpoint rechecks public publication/comment/parent visibility and active
author eligibility. Private, hidden, deleted, foreign-publication and ineligible
learner images are unavailable. Only bounded PNG/JPEG/WebP profile envelopes and
matching raster signatures are served; catalog redirects are restricted to the
existing local avatar set. No external URL is fetched. Responses use no-store,
nosniff and same-origin resource policy. Existing applied migrations were not edited.

The UI accepts only its exact comment-avatar endpoint, loads images lazily in the
existing fixed 26 px circle and uses initials on absence or image failure. No
increase in card height: the measured demo root remains 106 px desktop / 124 px
mobile. Actual account and learner avatar images were visually inspected alongside
a commenter without a photo.

Checks: 25 unique focused PostgreSQL/component tests passed, including exact image
bytes/MIME, selected built-in/custom learner images, own-create receipt, hidden
parent/author restrictions, cross-publication denial and safe fallback. Real
Chromium scenario passed (26.4 seconds), including successful image decode at all
discussion widths. Screenshots inspected at 1440/1024/390/320. API build, web build,
TypeScript, targeted ESLint and formatting passed. Full release CI is separate.

POST_STEP_REVIEW / challenge: L3 persistence/public-read boundary, local PASS.
No second avatar storage or identity authority; original images remain in the
canonical profile/classroom sources. The new function exposes only appearance
already selected by the author of a readable public comment. Direct image access
cannot reveal hidden comment authors. New fields are additive and old clients may
ignore them; apply 0291 before the API/UI. Existing discussions and uploaded images
survive application rollback. Production Docker/database/site were untouched.

Evidence: `e2e/artifacts/publication-comment-avatars/`. Only synthetic local profiles
were used. Preview credentials remain outside the repository. The disposable preview
received only the additive 0291 plan through the existing migration runner; canonical
tests used the full final migration lineage in a separate isolated database.
