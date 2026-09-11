# VSCR-D0-004 — Blocks runtime security contract

**Status:** canonical accepted runtime-security design  
**Master:** `../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`  
**Component routing:** `COMPONENT_MAP.yaml`

This is the single active security contract for the Scratch runtime trust surface. It preserves
the detailed accepted D0-004 requirements and incorporates the current-authority/revocation
closure that previously lived in D0-004A.

It does not authorise coding by itself.

## Trust surfaces

ASA has two separate browser trust surfaces:

```text
A. normal ASA Web → /api/**
   authority: existing HttpOnly ASA account/student session
   origin: existing configured ASA Web origin policy

B. Scratch runtime iframe → /api/blocks/runtime/**
   authority: short-lived Blocks capability in Authorization header
   origin: exact configured Scratch runtime origin
   cookies: ignored
   credentials: omit
```

The runtime origin is never added as a generic trusted origin for normal ASA cookie
authenticated mutations.

A runtime capability is not an ASA account session and does not grant authority to generic
account, classroom, admin or unrelated subject APIs.

## Capability profile

Use the standard `jose` package to create and verify compact JWS/JWT capabilities.

Initial v1 profile:

```text
JWS alg: HS256
JWT issuer: asa-lab
JWT audience: asa-blocks-runtime
editor TTL: 10 minutes
player TTL: 10 minutes
hard TTL ceiling without a new design decision: 15 minutes
```

Dependency rule:

```text
package: jose
version: exact version pinned by implementation PR
dependency security/license gates: required PASS
```

Do not implement custom JWT encoding/signature code with handwritten crypto or untrusted
algorithm selection.

### Signing key

Environment:

```text
ASA_BLOCKS_RUNTIME_SIGNING_KEY
```

The value is high entropy, minimum 32 random bytes in the representation selected by the
implementation configuration loader.

It is:

```text
server-only
not committed
not returned by config endpoints
not mounted into Scratch container
not sent to ASA Web
not logged
```

Core v1 uses one active signing key. Deployment key rotation invalidates existing runtime
capabilities, which is acceptable with the bounded TTL. Online multi-key rotation is not
required for v1 and must not be invented opportunistically.

### Required claims

Editor capability contains at least:

```json
{
  "iss": "asa-lab",
  "aud": "asa-blocks-runtime",
  "sub": "principal-uuid",
  "jti": "uuid-v4",
  "tenantId": "tenant-uuid",
  "projectId": "project-uuid",
  "moduleKey": "blocks",
  "mode": "editor",
  "permissions": [
    "project:read",
    "project:save",
    "asset:read",
    "asset:write",
    "snapshot:write"
  ],
  "iat": 0,
  "nbf": 0,
  "exp": 0
}
```

Player capability contains at least:

```json
{
  "moduleKey": "blocks",
  "mode": "player",
  "projectId": "project-uuid",
  "versionId": "immutable-version-uuid",
  "permissions": ["project:read", "asset:read"]
}
```

Player capability MUST NOT contain:

```text
project:save
asset:write
snapshot:write
```

A future public-publication capability may use a dedicated public subject marker instead of
an account principal, but it still binds the exact project/version and read-only permissions.

## Capability validation

Every protected runtime request verifies at least:

```text
signature valid
alg exactly HS256
iss == asa-lab
aud includes asa-blocks-runtime
nbf/exp valid with small bounded clock skew
moduleKey == blocks
jti valid UUID
path projectId == token projectId
required permission present
mode valid for endpoint
versionId exact for version-scoped player endpoints
```

Never select a verification algorithm from untrusted token input without enforcing the
configured profile.

Capability permissions are constructed server-side. HTTP request bodies never choose their
own permissions.

Capability validation is necessary but not sufficient: the current resource-authority
recheck below is also mandatory for protected operations.

## Editor runtime-session issuance

Cookie-authenticated parent endpoint:

```http
POST /api/projects/{projectId}/blocks/runtime-session
Content-Type: application/json
```

Body v1:

```json
{
  "mode": "editor"
}
```

Before signing:

```text
1. resolve current ASA account/student actor through existing session logic
2. load/authorise project through existing Project Core access path
3. require project.moduleKey == blocks
4. require current edit authority
5. require current project state permits editing
6. construct exact permissions server-side
7. issue a 10-minute capability
```

Logical response:

```json
{
  "protocolVersion": 1,
  "projectId": "uuid",
  "runtimeToken": "compact-jws",
  "expiresAt": "RFC3339",
  "draftRevision": 12,
  "hasProjectJson": true,
  "assets": [],
  "recoveryNamespace": "opaque-non-secret",
  "runtimeOrigin": "https://configured-runtime-origin"
}
```

`runtimeOrigin` comes only from validated server configuration, never client input.

The endpoint remains under the normal ASA Web cookie/origin policy. The Scratch iframe does
not receive ambient account cookies as runtime authority.

### Player issuance

Authenticated immutable-version player issuance is logically separate from editor issuance:

```http
POST /api/projects/{projectId}/versions/{versionId}/blocks/runtime-session
```

It must:

```text
authorise read of the exact immutable version
require version belongs to project
require module blocks
issue mode=player
bind exact versionId
issue read-only permissions only
```

A later public-publication issuance route first proves that the requested immutable version
is the one authorised by ASA publication metadata.

Do not reuse the editor session endpoint with a client-supplied permission list.

## Current authority recheck

A Blocks runtime JWT is a short-lived cryptographically scoped capability. It is **not** a
frozen copy of ASA authorisation state until token expiry.

For every protected runtime request:

```text
verify capability signature + claims + resource binding + mode + permission
→ apply current ASA resource-authorisation rule for subject/resource/operation
→ execute only if current authority still permits it
```

For authenticated editor mode:

```text
valid bearer capability
+ current principal still resolves in token tenant
+ current principal still has required read/edit authority for project
+ current project state permits requested operation
= request may proceed
```

A cryptographically valid token whose principal no longer has required resource authority is
denied.

Changes that affect the next protected runtime request include:

```text
project access revoked
learner/actor removed from authorising relationship
project becomes non-editable for that actor
project is trashed/deleted
version/publication is no longer authorised for requested player path
```

An already in-flight operation may finish according to that operation's transaction
semantics; distributed cancellation is not required.

A normal account-session logout does not by itself require a JWT blacklist if underlying
resource authority remains unchanged. Expiry, signing-key rotation and current resource
authorisation are independent controls.

Do not introduce a Scratch-specific token blacklist, process-local denylist or unbounded
revocation map in core v1.

Required model:

```text
stateless JWT verification
→ current ASA resource authorisation
→ endpoint-specific operation
```

This remains compatible with multi-instance API deployment.

The implementation should reuse the canonical ASA actor/project access path or a
subject-neutral equivalent. It must not create a second Blocks-only role model.

At minimum, current authority is rechecked for these operations when they exist:

```text
bootstrap/project JSON read
asset GET
asset PUT
draft PUT
snapshot PUT
immutable player/version read
```

Write operations require current edit authority, not merely a token permission string.

Asset access additionally requires D0-003 document-reference/tenant checks. Current project
authority does not make same-tenant asset aliases tenant-wide readable.

For a future public player capability, the server rechecks that the exact
publication/version relationship still authorises public read. Unpublishing that relationship
denies subsequent protected reads even if a previously issued token remains unexpired.

The immutable project version itself is never rewritten as a revocation mechanism.

The common current-authority boundary is established in M1-003 and reused by later M1/M2
operations; later slices must not bypass it because the JWT already contains a permission.

## Token refresh and browser handling

The iframe cannot mint or refresh its own capability.

Flow:

```text
child sees expiry approaching or receives expired-token response
→ child emits ASA_BLOCKS_TOKEN_REFRESH_REQUIRED
→ parent calls normal cookie-auth runtime-session endpoint again
→ parent sends ASA_BLOCKS_TOKEN_UPDATE to exact runtime origin + sessionNonce
→ child replaces in-memory token
→ pending exact mutation may retry with same mutationId
```

Suggested refresh threshold:

```text
refresh when <= 2 minutes remain
```

Multiple simultaneous refresh requests in one parent page are coalesced.

Token expiry never clears recovery data or silently discards a pending save.

Runtime capability is kept only in JS memory for the parent/iframe runtime lifetime.

Forbidden storage/transport:

```text
URL
query string
hash fragment
localStorage
sessionStorage
IndexedDB recovery
cookie
analytics
console/request logs
HTML data attributes
```

Runtime fetch uses:

```js
headers.Authorization = `Bearer ${token}`
credentials = 'omit'
```

Recovery data may contain bounded project state and unsent asset bytes but never the runtime
capability.

## Origin CORS CSP boundary

Runtime browser API prefix:

```text
/api/blocks/runtime/**
```

Configured origin:

```text
ASA_BLOCKS_RUNTIME_ORIGIN
```

Runtime requests use a narrow path-specific trust branch before the normal generic mutation
origin decision.

For browser runtime requests:

```text
Origin MUST exactly equal configured runtime origin
bearer capability required for protected endpoints
cookies are not authority
credentials omitted
```

Response/preflight policy:

```text
Access-Control-Allow-Origin: <exact runtime origin>
Vary: Origin
Access-Control-Allow-Methods: GET, PUT, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type
Access-Control-Max-Age: bounded configured value
```

Forbidden:

```text
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

For every other path, existing normal ASA cookie-origin behaviour remains unchanged.

Conceptually:

```text
if path starts /api/blocks/runtime/
  → exact runtime Origin/CORS + bearer trust surface
else
  → existing isAllowedMutationOrigin(...) behaviour unchanged
```

Forbidden shortcut:

```text
resolveAdditionalWebOrigins += ASA_BLOCKS_RUNTIME_ORIGIN
```

That would trust runtime-origin code for unrelated normal ASA mutations.

### Parent ASA CSP

ASA parent CSP permits only the exact configured runtime frame origin:

```text
frame-src 'self' <ASA_BLOCKS_RUNTIME_ORIGIN>
```

The value is validated as an absolute HTTP(S) origin and rendered safely into CSP. Never
concatenate request/body strings into security headers.

ASA's own `frame-ancestors` protection is not weakened.

### Runtime CSP

The Scratch host sets its own local-first CSP with no implicit Scratch Foundation origins:

```text
default-src 'self'
base-uri 'none'
object-src 'none'
form-action 'none'
frame-ancestors <exact ASA Web origin>
script-src 'self'
style-src 'self' 'unsafe-inline'
img-src 'self' data: blob:
media-src 'self' blob:
font-src 'self' data:
connect-src 'self' <exact ASA API origin> blob:
worker-src 'self' blob:
```

If the pinned standalone build demonstrably requires another directive such as narrowly
scoped `unsafe-eval`, the implementation must prove the need with browser evidence and
update this contract explicitly. Do not add broad external hosts merely to make Scratch
load.

M3 network-deny acceptance verifies final browser traffic and CSP.

Runtime headers include at least:

```text
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Permitted-Cross-Domain-Policies: none
```

## Iframe message authority

Parent uses the exact runtime origin as `postMessage` target.

Child accepts INIT only from `window.parent` and the expected ASA parent origin. After INIT,
messages additionally bind exact `protocolVersion`, `sessionNonce` and project ID; flush
pairs also bind a request ID.

A postMessage does not grant API authority. The bearer capability still controls server
operations.

Messages must not contain:

```text
ASA account cookie
object-store credentials
signing key
arbitrary JavaScript/eval payload
```

No generic RPC/eval bridge exists. `postMessage('*')` is forbidden.

## Iframe sandbox

Core iframe:

```html
sandbox="allow-scripts allow-same-origin"
```

`allow-same-origin` is required for the separate runtime origin's own IndexedDB/browser
origin APIs and does not collapse the boundary with ASA Web because the origins differ.

Core mode does not add popup, top-navigation, forms, download, camera, microphone or
geolocation permission.

## Runtime rate limits

Runtime routes use their own bounded limiter family because ordinary single-IP mutation
limits are inappropriate for a school NAT with many simultaneous learners.

Initial configurable ceilings:

```text
successful/authenticated requests per jti:     300 / 5 minutes
coarse all-runtime requests per IP:           12000 / 5 minutes
invalid-token attempts per IP:                  300 / 5 minutes
runtime-session issuance per normal session:     12 / 5 minutes
concurrent asset PUT per jti:                      4
```

Asset persistence additionally applies D0-003 unique-byte ceilings:

```text
new unique asset bytes per capability lifetime: 512 MiB
new unique asset bytes per project / 5 minutes:    1 GiB
```

M1-003 establishes bounded capability/project/IP limiter structure and session-issuance
limits. M1-004 charges unique-byte budgets only after it knows whether incoming bytes create
a new immutable blob/alias; exact idempotent replays do not consume the same unique-byte
budget twice.

The normal generic mutation limiter is not double-applied to authenticated runtime paths.

All limiter maps/caches are bounded; never introduce an unbounded per-jti/project Map that
grows for process lifetime.

A representative NAT test models at least 30 simultaneous editor capabilities and proves
ordinary workload does not produce false 429 responses.

The coarse IP ceiling remains to bound floods. These limits do not replace D0-003 per-file
and current-project size limits.

## Endpoint permission matrix

| Endpoint | Editor | Player |
| --- | --- | --- |
| bootstrap/project JSON | allow | version-scoped allow |
| asset GET referenced by authorised document | allow | allow |
| asset PUT | allow | deny |
| draft PUT | allow | deny |
| snapshot PUT | allow | deny |
| generic ASA account/classroom/admin routes | deny by trust boundary | deny |

Server tests verify every deny, not only UI hiding.

## Runtime error contract

Runtime auth/security errors use stable machine-readable families. Initial families include:

```text
401 runtime_token_missing
401 runtime_token_invalid
401 runtime_token_expired
403 runtime_origin_forbidden
403 runtime_permission_denied
403 runtime_current_authority_denied
403 runtime_project_mismatch
403 runtime_version_mismatch
429 runtime_rate_limited
503 runtime_dependency_unavailable
```

Do not expose raw token claims, token bytes, signing material, object-store credentials or
internal authorisation details in bodies/logs.

OpenAPI documents the selected final status/code families in the implementation change.

## Logging and privacy

Allowed runtime request-log fields:

```text
requestId
path template / non-query path
status
duration
projectId when repository policy permits
runtime mode
safe jti hash/prefix only when needed for diagnostics
```

Forbidden:

```text
Authorization header
JWT body/signature
cookie
projectJson
asset bytes
signing key
```

## Implementation ownership across M1

The common runtime security/current-authority boundary is established in M1-003.

Later slices reuse it:

```text
M1-003 → bootstrap/runtime read boundary + current project authority recheck
M1-004 → asset GET/PUT reuse same current-authority boundary
M1-005 → draft PUT and durable load/save reuse same current-authority boundary
M2     → immutable player/publication paths apply current read/publication authority
```

Expected M1-003 implementation areas may include API capability/session/limiter composition,
path-scoped origin handling, parent/runtime CSP configuration, OpenAPI and focused security
tests. Exact filenames are deliberately deferred to the M1-003 task card after M1-002 is
accepted; this contract must not force speculative future path names.

Do not modify unrelated subject contexts.

## M1-003 acceptance

M1-003 security evidence must prove at least:

```text
1. valid editor capability authorises only exact project operations
2. wrong project path fails
3. wrong tenant/module fails
4. tampered/expired/not-yet-valid token fails
5. algorithm confusion is rejected
6. player token cannot write draft/asset/snapshot
7. runtime requests use credentials: omit and no cookie authority
8. runtime Origin is exact; wildcard CORS absent
9. runtime origin cannot mutate normal ASA APIs
10. normal ASA Web origin policy remains unchanged for non-runtime routes
11. parent CSP permits only configured runtime frame origin
12. runtime frame-ancestors permits only configured ASA parent origin
13. wrong-origin/wrong-nonce iframe messages fail
14. token never appears in URL/localStorage/sessionStorage/IndexedDB/logs
15. parent refreshes token and pending exact mutation can survive expiry
16. runtime-session issuance churn is bounded
17. 30-editor shared-NAT test avoids false 429 under normal workload
18. invalid-token flood remains bounded
19. asset unique-byte budgets prevent authorised upload loops from creating unbounded orphan storage
20. no Blocks security failure crashes unrelated ASA APIs
21. issue valid editor capability while actor may edit, revoke actor project authority without expiring token, then same token is denied on next protected read
22. project trash/delete denies the same still-valid capability
23. later asset PUT/draft/snapshot routes deny same token after authority revocation
24. future public player reads are denied after exact publication/version is unpublished
25. no process-local JWT denylist is required for those revocation cases
```

Any requirement to weaken a global security header/policy or bypass current resource
authorisation is a STOP condition, not an implementation shortcut.
