# VSCR-D0-004 — Blocks runtime security contract

**Status:** canonical accepted runtime-security design  
**Master:** `../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`  
**Component routing:** `COMPONENT_MAP.yaml`

This is the single active security contract for the Scratch runtime trust surface. It includes
the accepted current-authority/revocation rule that previously lived in D0-004A.

It does not authorise coding by itself.

## Trust surfaces

ASA has two separate browser trust surfaces:

```text
normal ASA Web → /api/**
  authority: existing HttpOnly ASA account/student session
  origin: existing ASA Web origin policy

Scratch runtime iframe → /api/blocks/runtime/**
  authority: short-lived Blocks bearer capability
  origin: exact configured Scratch runtime origin
  cookies: ignored
  credentials: omit
```

The Scratch runtime origin must never be added as a generic trusted origin for normal
cookie-authenticated ASA mutations.

## Capability profile

Use the standard `jose` package; do not implement handwritten JWT/JWS crypto.

Core v1 profile:

```text
algorithm        HS256 only
issuer           asa-lab
audience         asa-blocks-runtime
editor TTL       10 minutes
player TTL       10 minutes
hard TTL ceiling 15 minutes without a new design decision
```

Signing secret:

```text
ASA_BLOCKS_RUNTIME_SIGNING_KEY
```

It is server-only, high entropy, minimum 32 random bytes, never committed, never mounted into
the Scratch container, never returned to ASA Web and never logged.

Editor capability contains at least:

```text
iss / aud / sub / jti
tenantId
projectId
moduleKey = blocks
mode = editor
permissions = project:read, project:save, asset:read, asset:write, snapshot:write
iat / nbf / exp
```

Player capability is bound to the exact immutable `versionId` and contains read-only
permissions only. It must not contain project:save, asset:write or snapshot:write.

## Capability validation

Every protected runtime request verifies at least:

```text
signature valid
alg exactly HS256
iss exactly asa-lab
aud includes asa-blocks-runtime
nbf/exp valid with small bounded clock skew
jti valid UUID
moduleKey exactly blocks
mode valid for endpoint
path projectId equals token projectId
required permission present
versionId exact on version-scoped player routes
```

The verifier never selects an algorithm from untrusted token input.

Capability permissions are server-issued. HTTP bodies never choose their own permission
list.

## Editor runtime-session issuance

Cookie-authenticated parent endpoint:

```http
POST /api/projects/{projectId}/blocks/runtime-session
Content-Type: application/json

{"mode":"editor"}
```

Before signing, the API must:

```text
resolve current ASA actor through existing session logic
load/authorise project through canonical Project Core access
require project.moduleKey == blocks
require current edit authority
require project state permits editing
construct permissions server-side
issue bounded capability
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

`runtimeOrigin` comes only from validated server configuration.

This issuance endpoint remains under normal ASA Web cookie/origin policy. The iframe does not
call it directly with ambient cookies.

## Current authority recheck

A valid Blocks capability is **not** a frozen authorisation snapshot until token expiry.

For every protected runtime request:

```text
verify capability cryptography + claims + resource binding
→ recheck current ASA authority for the exact actor/resource/operation
→ execute only if current authority still permits it
```

For authenticated editor mode this means the principal still resolves in the token tenant,
still has required project read/edit authority and the current project state still permits the
operation.

Changes that must affect the next protected request include:

```text
project access revoked
actor removed from authorising relationship
project becomes non-editable
project trashed/deleted
publication/version no longer authorised for a player path
```

A still-valid token is denied after such a change. Core v1 does not add a Scratch-specific
JWT blacklist or unbounded process-local revocation map.

A normal ASA logout does not by itself require a JWT denylist when underlying project
resource authority remains unchanged; token expiry and current resource authority are
independent controls.

The common current-authority helper/boundary is established with M1-003 and reused by later
asset, draft, snapshot and player operations. A later slice must not bypass this rule merely
because the JWT contains a permission string.

## Token refresh protocol

The iframe cannot mint or refresh its own capability.

```text
child approaches expiry or receives expired-token response
→ child emits ASA_BLOCKS_TOKEN_REFRESH_REQUIRED
→ ASA parent requests a fresh normal cookie-authenticated runtime session
→ parent sends ASA_BLOCKS_TOKEN_UPDATE to exact runtime origin/sessionNonce
→ child replaces token in memory
→ an idempotent pending mutation may retry with the same mutationId
```

Runtime tokens remain memory-only. They must not appear in URL query/hash,
localStorage/sessionStorage/IndexedDB, cookies or logs.

## Origin CORS CSP boundary

Configuration includes:

```text
ASA_BLOCKS_RUNTIME_ORIGIN
```

For `/api/blocks/runtime/**` browser traffic:

```text
Origin must exactly match configured runtime origin
Authorization bearer capability required by protected route
credentials omitted
Access-Control-Allow-Origin is exact, never *
Access-Control-Allow-Credentials is not enabled
runtime-specific abuse limits apply
```

The normal generic ASA cookie mutation-origin policy remains unchanged for every other path.
The runtime-specific path handling must not become a generic origin bypass.

ASA parent CSP permits only the exact runtime origin in `frame-src`.
Runtime CSP uses exact ASA parent in `frame-ancestors` and exact API endpoint/origin in
`connect-src`.

Runtime iframe sandbox begins as:

```html
sandbox="allow-scripts allow-same-origin"
```

Core mode does not add popup, top-navigation, forms, download, camera, microphone or
geolocation permissions.

## Runtime rate limits

M1-003 must establish bounded runtime-specific request accounting rather than reusing an
unbounded in-memory map.

The exact initial request/byte ceilings for asset upload remain owned by D0-003. Runtime
security owns the capability/project-scoped accounting boundary and must support bounded
cleanup at capability expiry/window end.

A bot must not disable abuse protection merely because Scratch generates bursty requests.
Any changed ceiling requires measured evidence and an explicit contract update.

## Protected operation requirements

At minimum current authority is rechecked for these operations when they exist:

```text
bootstrap/project JSON read
asset GET
asset PUT
draft PUT
snapshot PUT
immutable player/version read
```

Write operations require current edit authority in addition to token permission.

Asset requests also require D0-003 document-reference/tenant checks. Current project authority
never makes same-tenant asset aliases tenant-wide readable.

## Player/publication authority

Authenticated player mode rechecks read authority for the exact immutable version.

A future public-publication capability may use a dedicated public subject marker. In that
case the API rechecks that the exact publication/version relationship still authorises public
read. Unpublishing that relationship must deny subsequent protected player reads even if an
already-issued capability has not expired.

The immutable project version itself is not rewritten as a revocation mechanism.

## Runtime response/error rules

Runtime authentication/authorisation failures must be explicit and stable enough for the host
to distinguish at least:

```text
missing/invalid capability
expired capability
origin rejected
permission denied
current authority revoked
resource/version mismatch
rate/byte limit exceeded
dependency unavailable
```

Do not leak signing material, bucket credentials, object keys or sensitive authorisation
details in errors/logs.

## M1-003 acceptance

M1-003 is not accepted until focused security evidence proves at least:

```text
1. valid editor capability is issued only to currently authorised editor
2. tampered/expired/wrong-audience/wrong-project/wrong-permission token is rejected
3. wrong runtime Origin is rejected without widening normal ASA origin trust
4. token is absent from URL/persistent browser storage/logs
5. issue token while actor may edit, revoke project authority, same still-valid token is denied next request
6. project trash/delete denies still-valid token
7. restoring authority happens through normal ASA authorisation, not token mutation
8. no process-local Scratch JWT denylist is required for those cases
9. refresh is parent-mediated and bound to exact project/sessionNonce/runtime origin
10. non-Blocks ASA cookie-authenticated routes preserve their existing origin/auth behaviour
```

Later M1-004/M1-005/M2 acceptance extends the same current-authority tests to asset writes,
draft/snapshot writes and public player publication revocation as those endpoints become real.
