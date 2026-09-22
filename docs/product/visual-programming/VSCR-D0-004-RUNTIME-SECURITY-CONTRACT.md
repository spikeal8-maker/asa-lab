# VSCR-D0-004 — Blocks runtime security contract

**Status:** canonical accepted runtime-security design  
**Master:** `../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`  
**Component routing:** `COMPONENT_MAP.yaml`

Этот контракт защищает ASA runtime boundary. Он не должен использоваться как повод удалить штатные Scratch Extensions или запретить их нормальные внешние service/device integrations.

## Trust surfaces

Две browser trust surfaces:

```text
A. normal ASA Web → /api/**
   authority: existing HttpOnly ASA session

B. Scratch runtime iframe → /api/blocks/runtime/**
   authority: short-lived Blocks bearer capability
   cookies: not authority
   credentials: omit
```

Редактор — доверенный встроенный код на том же origin ASA. Отдельный домен не
создаётся. Историческая модель отдельного runtime origin заменена Decision 2/8
в ADR-VSCR-001. Runtime API по-прежнему требует capability, а не account cookies.

## Capability profile

Use standard `jose` compact JWS/JWT. Initial profile:

```text
alg: HS256
issuer: asa-lab
audience: asa-blocks-runtime
editor/player TTL: 10 min
hard ceiling without new design: 15 min
```

Signing key is server-only, high entropy, never sent to browser/Scratch container/logs.

Capability binds at least tenant/project/module/mode/permissions/iat/nbf/exp/jti. Player is read-only and binds immutable versionId.

## Capability validation

Every protected runtime request verifies:

```text
signature + exact alg
issuer/audience
time bounds
moduleKey == blocks
project/version binding
mode
required permission
current ASA resource authority
```

Client body never chooses permissions.

## Editor runtime-session issuance

Normal ASA cookie-authenticated parent endpoint conceptually:

```http
POST /api/projects/{projectId}/blocks/runtime-session
```

Server:

```text
resolve current ASA actor
→ authorise project through normal Project Core
→ require module blocks
→ require current edit/read authority
→ issue short-lived exact capability
→ return configured runtimeOrigin + bootstrap metadata
```

Scratch iframe never receives ASA account cookie as authority.

## Current authority recheck

A valid runtime JWT is not frozen authorisation.

```text
verify token
→ recheck current ASA resource authority
→ execute only if authority still permits operation
```

Revoked access, deleted/trashed project or invalid publication/version relationship denies the next protected request even if token is cryptographically valid.

Do not create a process-local Scratch token blacklist as the primary model.

## Token refresh and browser handling

Child cannot mint a token. Parent Web owns the rotation lifecycle and keeps `expiresAt` only in memory.

```text
initial runtime-session
→ remember expiresAt in Parent memory
→ schedule proactive refresh 60 seconds before expiry
→ POST the same /api/projects/{projectId}/blocks/runtime-session endpoint
→ strict-parse the returned session and require the same configured runtimeOrigin
→ ASA_BLOCKS_TOKEN_UPDATE to the same projectId/sessionNonce
→ child replaces only its memory-only bearer
→ same iframe, VM, Project Core revision/fingerprint, durable-asset knowledge and unresolved mutation identity remain intact
```

A child `ASA_BLOCKS_TOKEN_REFRESH_REQUIRED` message, when used, joins the same Parent-owned single-flight refresh. It does not mint authority and does not create a second INIT.

Explicit Save has a timer-throttling fallback:

```text
Save click
→ if capability expired or <= 60 seconds remain, refresh first
→ successful TOKEN_UPDATE
→ only then ASA_BLOCKS_FLUSH_REQUEST
```

If mandatory refresh fails, is malformed, has the wrong runtime origin, is stale after reload/unmount, or Project Core authority has been revoked, the old capability is not extended and FLUSH is not sent. There is no automatic save retry/backoff in this contract. Successful token rotation is presentation-invisible: it does not change editor-ready state or reload the iframe/VM.

Token forbidden in URL/query/hash/localStorage/sessionStorage/IndexedDB/cookie/analytics/logs.

Runtime fetch to ASA API uses:

```text
Authorization: Bearer <token>
credentials: omit
```

## Origin CORS CSP boundary

Runtime API prefix:

```text
/api/blocks/runtime/**
```

For ASA runtime API requests:

```text
Origin must exactly equal the configured ASA origin
bearer capability required
cookies ignored as authority
Access-Control-Allow-Origin = exact runtime origin
no wildcard credentials
```

Normal ASA API paths keep existing cookie/origin policy. Runtime asset GET may
omit Origin only with `Sec-Fetch-Site: same-origin` and an exact-origin Referer
under `/internal/blocks/`; bearer and current project authority remain required.
An explicit foreign Origin is never replaced by the Referer.

The embedded document allows framing only by the same ASA origin.

### Runtime CSP principle

Нельзя смешивать два класса соединений:

```text
1. CORE ASA FLOW
   editor boot / ASA project / ASA assets / ASA save
   → only ASA/local configured endpoints
   → no hidden Scratch Foundation project/asset fallback

2. EXPLICIT SCRATCH EXTENSION FLOW
   user deliberately selects an extension/service/device
   → extension may require its documented external endpoint/device
   → this traffic is allowed only for the selected integration and must not grant ASA authority
```

Базовый CSP должен быть минимальным. Если конкретное штатное extension требует additional `connect-src`, WebSocket, browser permission, camera/microphone/Bluetooth/peripheral bridge or another capability, это добавляется **точечно для этой интеграции** после bounded security review/evidence.

Нельзя:

```text
удалять native extension только потому, что ему нужна сеть/устройство
добавлять '*' в connect-src
давать всем extensions универсальный доступ «на всякий случай»
считать legitimate user-selected extension traffic скрытым core fallback
```

Таким образом core ASA/Scratch остаётся независимым, а native integrations не уничтожаются blanket network-deny политикой.

## Iframe message authority

Parent uses exact runtime origin for `postMessage`. Child accepts INIT only from `window.parent` + exact ASA origin + protocol/project/session bindings.

`postMessage('*')` forbidden. Messages never contain ASA cookie/signing key/object-store credentials/arbitrary eval payload.

## Iframe sandbox

The shipping frame shares the ASA origin and is trusted bundled application code.
`allow-scripts allow-same-origin` on a same-origin frame is not an isolation
boundary and must not be described as one. Arbitrary extension script URLs are
rejected by the pinned VM loader; all pinned built-in extensions remain available.

Не расширять sandbox глобально ради одной функции. Когда конкретной native integration реально нужен download/popup/camera/mic/device permission, handle it in a dedicated integration task with least privilege and browser evidence.

Сохранение native extension entry/catalogue не означает автоматическую выдачу всех permissions.

## Runtime rate limits

Runtime routes use bounded limiter family designed for school NAT; ordinary single-IP limits must not break a classroom.

Exact limits live in selected M1-003/M1-004 implementation card and evidence. Limiter maps must be bounded; no unbounded per-jti/project in-memory maps.

## Endpoint permission matrix

| Endpoint                                    | Editor                 | Player               |
| ------------------------------------------- | ---------------------- | -------------------- |
| bootstrap/project JSON                      | allow                  | version-scoped allow |
| asset GET referenced by authorised document | allow                  | allow                |
| asset PUT                                   | allow                  | deny                 |
| draft PUT                                   | allow                  | deny                 |
| snapshot PUT                                | allow                  | deny                 |
| generic ASA account/classroom/admin routes  | deny by trust boundary | deny                 |

## Runtime error contract

Stable machine-readable families include missing/invalid/expired token, forbidden origin/permission/current authority/project/version mismatch, rate limit and dependency unavailable.

Do not expose raw capability bytes, signing material, projectJson or object-store credentials.

## Logging and privacy

Allowed logs: request id, path template, status, duration, safe project/runtime mode identifiers according to repo policy.

Forbidden logs: Authorization header, JWT body/signature, cookie, project JSON, asset bytes, signing/object credentials.

## Implementation ownership across M1

```text
M1-003 → runtime session/capability/current-authority/origin security
M1-004 → asset GET/PUT reuse same boundary
M1-005 → durable draft/save reuse same boundary
M2     → immutable/public player paths reuse read/publication authority
```

External Scratch extension integration permissions are separate bounded work and must not be smuggled into core capability authority.

## Security acceptance

Required negative/positive evidence includes:

```text
wrong origin/source/project/nonce/protocol denied
player writes denied
runtime token never persists/logs
core project/assets do not fallback to Scratch Foundation backend
optional external extension traffic only occurs after the user selects/uses that integration
one extension's external permissions do not become generic ASA API authority
unavailable extension service does not crash core editor/ASA platform
```
