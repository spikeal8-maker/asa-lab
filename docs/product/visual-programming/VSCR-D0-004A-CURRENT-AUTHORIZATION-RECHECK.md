# VSCR-D0-004A — current authorisation recheck addendum

**Status:** accepted M0 design closure; normative amendment to D0-004 section 9  
**Parent contract:** [`VSCR-D0-004-RUNTIME-SECURITY-CONTRACT.md`](VSCR-D0-004-RUNTIME-SECURITY-CONTRACT.md)

This addendum closes one ambiguity found during the final M0 critical review. It changes no
M0 runtime code because the runtime API does not exist yet. It constrains the later M1
implementation.

---

## 1. Decision

A Blocks runtime JWT is a short-lived, cryptographically scoped capability. It is **not** a
frozen ten-minute copy of ASA authorisation state.

For every protected runtime request the server must first verify the capability signature,
claims, project/version binding, mode and permission from D0-004. It must then apply the
current ASA resource-authorisation rule for the capability subject and requested resource.

For authenticated editor mode this means:

```text
valid bearer capability
+ current principal still resolves in the token tenant
+ current principal still has the required read/edit authority for this project
+ current project state permits the requested operation
= request may proceed
```

A token that is cryptographically valid but whose principal no longer has the required
project access is denied.

---

## 2. Revocation semantics

The following changes must affect the next protected runtime request rather than waiting for
token expiry:

```text
project access revoked
learner/actor removed from the authorising relationship
project becomes non-editable for that actor
project is trashed/deleted
version/publication is no longer authorised for the requested player path
```

An already in-flight operation may complete according to the transaction semantics of that
operation; this addendum does not require distributed cancellation.

A normal ASA account-session logout does not by itself require a JWT blacklist. If the
underlying resource authority has not changed, the already issued capability may remain
usable until expiry. Expiry, signing-key rotation and current resource authorisation are
independent controls.

---

## 3. No revocation database in core v1

Do not introduce a Scratch-specific token blacklist, process-local denylist or unbounded
revocation map.

The required model is:

```text
stateless JWT verification
→ current ASA resource authorisation
→ endpoint-specific operation
```

This remains compatible with multi-instance API deployment and keeps ASA Project Core /
publication authority canonical.

A future dedicated immediate token-revocation subsystem, if ever required beyond current
resource authorisation, is a separate security design.

---

## 4. Editor request requirements

At minimum, current project authorisation is rechecked for:

```text
bootstrap / project JSON read
asset GET for the current draft
asset PUT
draft PUT
snapshot PUT
```

Write operations require current edit authority, not merely a token permission string.

Asset access still additionally requires the document-reference checks from D0-003 and the
persistence rules from D0-002. Current project authority does not turn same-tenant asset
aliases into tenant-wide readable objects.

The implementation should reuse the existing canonical ASA actor/project access path or a
subject-neutral equivalent extracted from it. It must not create a second Blocks-only role
model.

---

## 5. Player/publication requirements

For authenticated player mode, current read authority for the exact immutable version is
rechecked.

For a future public-publication capability with a dedicated public subject marker, account
membership cannot be rechecked because no account principal is required. Instead the
server must recheck that the exact publication/version relationship still authorises public
read. Unpublishing/revoking that publication must therefore stop subsequent protected
player reads even if a previously issued token has not expired.

The immutable project version itself is never rewritten as a revocation mechanism.

---

## 6. Implementation ownership across M1

The common runtime authorisation helper/boundary is established in `VSCR-M1-003` together
with capability verification.

Later slices reuse it:

```text
M1-003 → bootstrap/runtime read boundary + current project access recheck
M1-004 → asset GET/PUT reuses the same current-authority boundary
M1-005 → draft PUT and durable project load/save reuse the same current-authority boundary
M2     → immutable player/publication paths apply the corresponding current read/publication authority
```

A later task must not bypass this rule because the JWT already contains `permissions`.

---

## 7. Required security evidence

Before the relevant runtime operations are accepted, tests must prove at least:

```text
1. issue a valid editor capability while actor may edit
2. revoke the actor's project authority without expiring the token
3. the same still-valid token is denied on the next protected project read
4. the same still-valid token is denied on asset PUT and draft/snapshot writes when those routes exist
5. restoring current authority requires the normal ASA authorisation path; token claims are not mutated
6. project trash/delete denies the still-valid token
7. public player access is denied after the exact publication/version is unpublished, once that path exists
8. no process-local JWT denylist is required for these cases
```

Token expiry/tampering/origin/permission negative tests from D0-004 remain mandatory.

---

## 8. M0 boundary consequence

This is a design-only closure. It does **not** authorise M1-003 or add runtime endpoints.
`blocks` remains `coming_soon`.

For contradictions about revocation/current project authority, this addendum supersedes the
older D0-004 wording that bounded all post-issuance access changes only by the ten-minute
TTL. All other D0-004 rules remain unchanged.
