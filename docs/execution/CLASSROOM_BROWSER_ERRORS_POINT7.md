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
  public dist. Docker retains them outside /srv and exports the same build's encrypted symbols; release retains
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

## Author self-review

HIGH / L3 privacy and release artifact boundary. No DOM/CSS/text changes.
Same existing bounded outbox, rate/retry/retention/ACK and client request ID.
No event message/reason/String(error), Error serialization or componentStack in
payload. Finite kind/capture/handling and max5 hashed asset frames, positive
bounded coordinates; unknown keys rejected both after storage reload and API.
Error names/getters and cross-origin/query/fragment frames cannot introduce raw
values. Window errors and boundary fallback remain distinct from actual recovery.
Private maps never become /srv files; only encrypted archive plus digest list
leaves the build. No credentials committed. Owner private key stays outside Git
and Docker, protected by owner/System Windows ACL. Public key enables builds on
other systems. Exact SHA and JS-digest checks fail closed; unknown development
builds can run but do not claim source localization. No historical root cause or
capacity claim. Independent final-SHA review and isolated browser/Docker evidence
are required separately and recorded in issue606/owner report.

## Bounded review repair R1

Initial review of30fe8a0 returned FAIL: Vite Worker JS/maps are Rollup assets,
not chunks. The first plugin skipped them, leaking maps to dist; release verified
after push. A real Worker fixture reproduced public map presence before repair.
R1 includes all emitted JS assets and their maps in encryption/digests, accepts
safe dotted Worker filenames, and verifies the loaded web runtime before push.
Only web release loading/publishing changes; other services keep original push.
Same Worker fixture now has zero public maps and the Worker in private archive.
Browser CI also requires the Worker to execute/answer. New independent final-SHA
review follows; no first-candidate publication or working runtime operation.
