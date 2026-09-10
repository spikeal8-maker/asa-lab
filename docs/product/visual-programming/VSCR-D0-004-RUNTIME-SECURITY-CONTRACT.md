# VSCR-D0-004 — Blocks runtime security contract

**Status:** accepted design contract for the Visual Programming programme  
**Master:** [`../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`](../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md)

This contract fixes the capability, CORS/origin, iframe and abuse-protection model. A
coding agent MUST NOT solve a runtime 403/CSP problem by widening ASA's normal cookie
trust boundary.

---

## 1. Trust surfaces are separate

ASA has two different browser trust surfaces:

```text
A. normal ASA Web → /api/**
   authority: existing HttpOnly ASA account/student session
   origin: existing configured ASA Web origin policy

B. Scratch runtime iframe → /api/blocks/runtime/**
   authority: short-lived Blocks capability in Authorization header
   origin: exact configured Scratch runtime origin
   cookies: ignored / credentials omitted
```

The runtime origin is never added as a generic trusted origin for normal ASA cookie
mutations.

---

## 2. Runtime capability format

Use the standard `jose` package to create and verify compact JWS/JWT capabilities.

Initial profile:

```text
JWS alg: HS256
JWT issuer: asa-lab
JWT audience: asa-blocks-runtime
editor TTL: 10 minutes
player TTL: 10 minutes
hard TTL ceiling without new design decision: 15 minutes
```

Dependency rule:

```text
package: jose
version: exact version pinned by implementation PR
requirement: repository dependency-security + license gates PASS
```

Do not implement custom JWT encoding/signature code with raw string concatenation or
handwritten crypto.

---

## 3. Signing key

Environment:

```text
ASA_BLOCKS_RUNTIME_SIGNING_KEY
```

The value is a high-entropy deployment secret, minimum 32 random bytes represented in the
format selected by the implementation configuration loader.

It is:

```text
server-only
not committed
not returned by config endpoints
not mounted into Scratch container
not sent to ASA Web
not logged
```

Core v1 uses one active key. Rotating the key through deployment invalidates existing
runtime capabilities; with a 10-minute TTL this is acceptable. Online multi-key rotation
is not required for v1 and must not be invented opportunistically.

---

## 4. Required capability claims

Editor token payload contains at least:

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

Player token contains:

```json
{
  "moduleKey": "blocks",
  "mode": "player",
  "projectId": "project-uuid",
  "versionId": "immutable-version-uuid",
  "permissions": ["project:read", "asset:read"]
}
```

Player token MUST NOT contain:

```text
project:save
asset:write
snapshot:write
```

For a public publication where no account principal is required, the later M2 issuance
route may use a dedicated public subject marker instead of an account principal, but it
must still bind project/version and read-only permissions exactly.

---

## 5. Token header validation

Verifier accepts only the configured algorithm/profile.

Required checks on every runtime request:

```text
signature valid
alg exactly HS256
iss == asa-lab
aud contains asa-blocks-runtime
nbf/exp valid with small bounded clock skew
moduleKey == blocks
jti valid UUID
path projectId == token projectId
required permission present
mode valid for endpoint
versionId exact for version-scoped player endpoints
```

Never select a verification algorithm from an untrusted token without enforcing the
configured algorithm.

---

## 6. Editor runtime-session issuance

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
4. require project is editable by actor
5. require project status permits editing
6. construct exact permissions, never accept permissions from body
7. issue 10-minute token
```

Response:

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

`runtimeOrigin` comes from validated server configuration, never client input.

The endpoint itself remains under the normal ASA Web cookie/origin policy.

---

## 7. Player issuance

The M2 implementation uses a separate version-scoped issuance path. Logical authenticated
shape:

```http
POST /api/projects/{projectId}/versions/{versionId}/blocks/runtime-session
```

It must:

```text
authorise read of the immutable version
require version belongs to project
require module blocks
issue mode=player token
bind exact versionId
```

A later public-publication issuance route may exist, but it must first prove that the
requested immutable version is the version authorised by ASA publication metadata.

Do not reuse editor session endpoint with a client-supplied arbitrary permissions list.

---

## 8. Refresh model

The iframe cannot mint/refresh its own capability.

Flow:

```text
child sees expiry approaching or receives 401 expired
→ child emits ASA_BLOCKS_TOKEN_REFRESH_REQUIRED
→ parent calls normal cookie-auth runtime-session endpoint again
→ parent sends ASA_BLOCKS_TOKEN_UPDATE with exact runtime origin + sessionNonce
→ child replaces in-memory token
→ pending exact mutation retries with same mutationId
```

Suggested refresh threshold:

```text
refresh when <= 2 minutes remain
```

Multiple simultaneous refresh requests in one parent page are coalesced.

Token expiry never clears IndexedDB recovery or silently discards a pending save.

---

## 9. Revocation semantics v1

Capabilities are short-lived stateless credentials. Core v1 does not introduce a token
revocation database solely for Scratch.

Explicit consequence:

```text
logout/key rotation does not revoke an already issued token before exp unless another
server-side resource check independently denies the operation
```

Maximum exposure is bounded by the 10-minute TTL.

Every runtime operation still verifies path/resource consistency, token permissions and
current resource existence/status. A trashed/deleted/nonexistent project cannot be mutated
just because an old capability still names it.

If future threat modelling requires immediate revocation, that is a separate security
design; do not add a hidden in-memory denylist that breaks multi-instance deployments.

---

## 10. Runtime token browser handling

Token is kept only in JS memory inside parent/iframe runtime lifetime.

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

Runtime fetch:

```js
headers.Authorization = `Bearer ${token}`
credentials = 'omit'
```

Recovery data may contain project state and unsent asset bytes but never the runtime
capability.

---

## 11. Path-scoped CORS/origin policy

Runtime browser API prefix:

```text
/api/blocks/runtime/**
```

For requests under that prefix, the API performs runtime-specific origin handling before
the generic mutation-origin decision.

Configured origin:

```text
ASA_BLOCKS_RUNTIME_ORIGIN
```

For a browser request:

```text
Origin MUST exactly equal configured runtime origin
```

Response/preflight headers:

```text
Access-Control-Allow-Origin: <exact runtime origin>
Vary: Origin
Access-Control-Allow-Methods: GET, PUT, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type
Access-Control-Max-Age: bounded configured value
```

Do not return:

```text
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

Runtime endpoints never become cookie-authorised because a cookie happened to accompany a
request.

---

## 12. Existing normal ASA origin policy remains intact

Current ASA app has a global mutation-origin check for non-GET/HEAD/OPTIONS API requests.
The implementation must add a narrow runtime-path branch without changing the meaning of
normal paths.

Required structure conceptually:

```text
if path starts /api/blocks/runtime/
  → runtime origin/CORS + bearer trust surface
else
  → current isAllowedMutationOrigin(...) cookie mutation policy unchanged
```

Forbidden shortcut:

```text
resolveAdditionalWebOrigins += ASA_BLOCKS_RUNTIME_ORIGIN
```

That shortcut would trust Scratch-origin code for unrelated normal ASA mutations and is a
security defect.

---

## 13. Parent ASA CSP must allow only the configured runtime frame

Current ASA CSP uses `default-src 'self'` and does not generically allow arbitrary
cross-origin frames. The Blocks shell therefore needs an exact configured runtime origin
in its parent CSP `frame-src` policy.

Target parent policy addition:

```text
frame-src 'self' <ASA_BLOCKS_RUNTIME_ORIGIN>
```

This is not a change to ASA's `frame-ancestors`; ASA itself remains protected from being
framed by other sites.

The runtime origin value is validated as an absolute HTTP(S) origin and safely rendered
into CSP; do not concatenate arbitrary request/body strings into security headers.

---

## 14. Runtime CSP

The Scratch host response sets its own CSP. Initial target policy is local-first and has
no Scratch Foundation network origins:

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

If the pinned standalone build demonstrably requires another directive such as a narrowly
scoped `unsafe-eval`, the host implementation must prove it with a browser failure/test and
record the exception in this contract. Do not add broad external hosts merely to make
Scratch load.

M3 network-deny acceptance verifies the final CSP against actual browser traffic.

Runtime headers also include:

```text
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Permitted-Cross-Domain-Policies: none
```

---

## 15. Iframe message authority

Parent uses the exact runtime origin in `postMessage`.

Child accepts INIT only from `window.parent` and the expected ASA parent origin derived
from the iframe referrer; after INIT it additionally requires exact `sessionNonce` and
project ID.

A postMessage does not itself grant API authority; the bearer capability still determines
server operations.

No message may contain:

```text
ASA account cookie
object-store credentials
signing key
arbitrary JavaScript/eval payload
```

---

## 16. Initial iframe sandbox

Core iframe:

```text
sandbox="allow-scripts allow-same-origin"
```

`allow-same-origin` is required because the separate runtime origin owns IndexedDB recovery
and normal browser-origin APIs. Since the iframe origin differs from ASA Web, this does not
collapse the ASA/Scratch origin boundary.

No popup/top-navigation/forms/download/camera/microphone permission is included in core
mode.

---

## 17. Runtime-specific abuse protection

The existing ordinary mutation limiter is inappropriate for thirty learners behind one
school NAT because rapid autosave can make one IP look like one abusive user.

Runtime routes therefore use their own limiter.

Initial configurable ceilings:

```text
successful/authenticated requests per jti: 300 / 5 minutes
coarse all-runtime requests per IP:       12000 / 5 minutes
invalid-token attempts per IP:              300 / 5 minutes
runtime-session issuance per normal session: 60 / 5 minutes
concurrent asset PUT per jti:                  4
```

The normal generic mutation limiter is not double-applied to authenticated runtime paths.

A representative NAT test must model at least 30 simultaneous editor capabilities and
prove ordinary autosave does not produce 429 responses.

The coarse IP ceiling remains to cap accidental/hostile floods; it is deliberately much
higher than a normal single-user mutation budget.

---

## 18. Endpoint permission matrix

| Endpoint | Editor | Player |
| --- | --- | --- |
| bootstrap/project JSON | allow | version-scoped allow |
| asset GET referenced by authorised document | allow | allow |
| asset PUT | allow | deny |
| draft PUT | allow | deny |
| snapshot PUT | allow | deny |
| generic ASA account/classroom/admin routes | deny by trust boundary | deny |

Server tests verify every deny, not only UI hiding.

---

## 19. Error contract

Runtime auth errors use stable machine-readable families, for example:

```text
401 runtime_token_missing
401 runtime_token_invalid
401 runtime_token_expired
403 runtime_origin_forbidden
403 runtime_permission_denied
403 runtime_project_mismatch
403 runtime_version_mismatch
429 runtime_rate_limited
```

Do not put raw token claims or token bytes in error bodies/logs.

OpenAPI documents the selected final codes in the implementation change.

---

## 20. Logging/privacy

Allowed request log fields:

```text
requestId
path template / non-query path
status
duration
projectId when repository policy permits
runtime mode
safe jti hash/prefix only if needed for rate diagnostics, never raw token
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

---

## 21. Security implementation changed paths

Expected minimum paths may include:

```text
apps/api/src/blocks-runtime-token.service.ts
apps/api/src/blocks-runtime.controller.ts
apps/api/src/blocks-runtime-session.controller.ts
apps/api/src/blocks-runtime-rate-limit.ts
apps/api/src/app.factory.ts
apps/api/src/origin-policy.ts only if a generic validated-origin helper is reused safely
apps/web/src/blocks/**
infra/scratch-editor/nginx.conf.template
schemas/openapi.yaml
tests/blocks/**
e2e/blocks-*.spec.ts
.env*.example
package.json / pnpm-lock.yaml for jose only in the authorised dependency slice
```

Do not modify other subject contexts.

---

## 22. Focused security acceptance

Must prove:

```text
1. valid editor token authorises only its exact project operations
2. wrong project path fails
3. wrong tenant/module fails
4. tampered/expired/not-yet-valid token fails
5. algorithm confusion is rejected
6. player token cannot write draft/asset/snapshot
7. runtime requests use credentials: omit and no cookie authority
8. runtime origin is exact; wildcard CORS absent
9. runtime origin cannot mutate normal ASA APIs
10. normal ASA Web origin policy is unchanged for non-runtime routes
11. parent CSP permits only configured runtime frame origin
12. runtime frame-ancestors permits only configured ASA parent origin
13. wrong-origin/wrong-nonce iframe messages fail
14. token never appears in URL/localStorage/IndexedDB/logs
15. parent refreshes token; pending exact mutation survives expiry
16. 30-editor shared-NAT test avoids false 429 under normal workload
17. invalid-token flood is still bounded
18. no Blocks security failure crashes unrelated ASA APIs
```

Any requirement to weaken a global security header/policy is a STOP condition, not an
implementation shortcut.