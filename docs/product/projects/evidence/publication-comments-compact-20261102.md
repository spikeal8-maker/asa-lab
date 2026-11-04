# Compact publication comments — local UI acceptance

Owner request: reduce comment/reply height, preserve avatars, make replying
discoverable and allow the owner to try actual posting in the local preview.

Delivered: compact cards with 26 px initial avatars and a short timestamp (full
date in the tooltip); replies use an indented line instead of another padded card.
The one-line composer grows with content, with a 144 px height ceiling. The length
counter appears near the limit. Reply opens that same composer inside the selected
thread and focuses it. Cancel preserves the draft and returns the composer above
the list. Replying to a reply addresses its author in text and retains the original
root parent: the server's one-level nesting rule is unchanged.

Guests now see Reply; it opens the existing sign-in dialog with reply-specific
wording and makes no write request. Authenticated pupils still require server
comment permission. Avatars are currently initials, not newly exposed profile photos.

Verification: 15 unique focused component tests passed (11 discussion, four existing
project-like/dialog tests), including inline reply-to-reply and guest denial.
Real Chromium passed the Account/Seat comment scenario with the new inline posting,
persistence, class overrides, owner close, pinning and moderation. Measured widths:
1440/1024/768/600/390/320, no horizontal page overflow. The fixed short demo root
measured about 106 px on desktop and 124 px on mobile. Screenshots were inspected.
Web TypeScript, targeted ESLint, formatting and web build passed.

POST_STEP_REVIEW: L1_UI_BEHAVIOR, PASS for local implementation. New compact action
styles are scoped to `.publication-comments`; shared admin moderation controls
retain their previous dimensions. No API/schema/identity-policy changes. Full CI,
Main/release acceptance and production deployment are not claimed.

The native local tab was signed in through the ordinary class-code flow as a
disposable test pupil. A comment and reply were submitted and visibly saved there;
the tab remains signed in for owner testing. Only the disposable local classroom
was granted comment permission; publication/download remain OFF. Test credentials
stay outside the repository. Production site/database were untouched.

Evidence: `e2e/artifacts/publication-comment-compact/` and the existing discussion
browser scenario. Detailed local logs are under
`F:/Asa-Lab/operations/reports/publication-comments-20261101/compact-*`.
