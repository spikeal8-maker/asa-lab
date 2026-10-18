# Classroom audit point 7: browser exception localization

Owner selected F05 only. Historical50 window_error messages do not establish50
editor crashes or a single cause. Missing historical symbols cannot be recreated
by applying a new build's maps. Publish main, report and STOP; no deployment.

## Acceptance and bounded write set

- client-error-details, client-diagnostics/outbox and existing App/Editor
  boundaries: standard exception kind, max5 same-origin asset frames and truthful
  capture scope/handling. No message, function names, componentStack, user values,
  query or fragment. Observer failures never affect product actions.
- Existing API client-diagnostics intake validates nested keys/types/bounds;
  existing collector/admin JSON retains the safe structured fields.
- Vite private-symbol plugin writes encrypted revision/digest-bound maps outside
  public dist. Docker exports the same build's encrypted symbols; release retains
  encrypted artifact only. Public repo must never receive plaintext maps or key.
- Offline lookup verifies exact revision and generated JS digest before resolving
  source coordinates. Unknown frames/revision/hash fail closed. Built Chromium
  fixture demonstrates exception -> sanitized envelope -> exact original line.
- Relevant focused tests/CI, uncached web/API builds, privacy challenge and HIGH
  independent final-SHA review. Layout impact none, no DOM/CSS/text changes.

Tools, build config, package test script and focused/release workflow changes are
limited to these evidence/artifact boundaries. No dependency/lockfile changes,
engine repair guesses, auth/SQL, install/network/ports or live operations.

## Limits

Boundary fallback displayed is evidence of handling, not successful recovery or
durable save. Uncaught browser reports do not prove a full editor crash. No raw
stack is retained. Source maps identify a location, not automatically a root
cause. Missing historical build maps remain unavailable. Owner key must be kept
outside Git and retained to read future encrypted artifacts. Scope excludes
metrics/IP and5000-user capacity. NEXT_ALLOWED_TASK: STOP after point7 report.
