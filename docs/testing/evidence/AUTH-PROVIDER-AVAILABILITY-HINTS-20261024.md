# Auth provider availability and field guidance — 24 October 2026

Provider discovery previously converted both network failure and a valid empty
response into an unexplained empty list. The hook now distinguishes loading,
ready and error. Login and registration show a safe, polite status and explicit
retry on failure while retaining password entry. Unknown/unavailable providers
remain hidden; a successful empty/disabled result does not claim an outage.
No provider authentication or verification fallback policy is changed.

Retry does not reset form inputs or registration drafts. Existing request
deduplication, aborted/unmounted response guards and refresh cadence remain.
The existing social-flow invalidation still applies if its provider becomes
unavailable; no new ability to authenticate a hidden provider is introduced.

The email/login and registration password requirements remain visible and are
associated using `aria-describedby`. Login still accepts legacy usernames and
passwords without imposing the registration minimum. The age requirement stays
visible next to the date field. Optional date guidance uses native details/
summary with a short pointer title, keyboard focus and touch activation; no
critical information depends on hovering.

One focused local run passed **29 tests**, covering discovery outage, safe
failure text, explicit retry, disabled-vs-failed distinction, late unmount/abort
and existing auth registration/choice behaviour. ESLint reported no errors;
the local Nx boundary rule noted the missing cached project graph. Full build,
independent review and browser/layout evidence are separate acceptance gates.

Only auth components/pages and scoped auth CSS are modified by this slice.
Landing-page and browser-scenario files are owned by the other assigned author.
No live site, provider settings or production account data was changed.
