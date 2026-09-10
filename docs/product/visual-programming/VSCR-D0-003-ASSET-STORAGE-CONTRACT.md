# VSCR-D0-003 — Blocks asset storage contract

**Status:** accepted design contract for the Visual Programming programme  
**Master:** [`../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`](../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md)

This contract fixes the physical and relational storage model for Scratch project assets.
It is intentionally detailed because asset identity, immutable historical versions and
cross-tenant isolation cannot be safely left to implementation-time guesses.

---

## 1. Separation of identities

Three concepts are distinct:

```text
Scratch compatibility identity:
  assetId + dataFormat + md5ext

ASA content integrity:
  SHA-256 of exact bytes

ASA physical location:
  private bucket + objectKey
```

Only the first two belong in the persistent Blocks project document. Physical location is
server infrastructure metadata.

`objectKey` MUST NOT appear in `BlocksProjectDocumentV1` after the M0.1 contract correction.

---

## 2. Supported v1 asset formats

Project-asset upload/read supports only:

```text
svg
png
jpg
wav
mp3
```

`json`, `sb2`, `sb3`, arbitrary ZIP and generic binary upload are not asset formats.

For v1 project assets:

```text
assetId = lowercase 32-hex MD5 of exact bytes
md5ext  = assetId + '.' + dataFormat
sha256  = lowercase 64-hex SHA-256 of exact bytes
```

The server computes both digests and never trusts client-supplied digest claims.

---

## 3. Relational model

The implementation introduces exactly two Blocks asset metadata concepts.

### 3.1 `blocks_blobs`

Logical DDL:

```sql
CREATE TABLE blocks_blobs (
    tenant_id   uuid        NOT NULL REFERENCES tenants(id),
    sha256      varchar(64) NOT NULL,
    data_format varchar(8)  NOT NULL,
    size_bytes  bigint      NOT NULL,
    object_key  text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, sha256, data_format),
    UNIQUE (tenant_id, object_key),
    CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CHECK (data_format IN ('svg', 'png', 'jpg', 'wav', 'mp3')),
    CHECK (size_bytes > 0)
);
```

### 3.2 `blocks_asset_aliases`

Logical DDL:

```sql
CREATE TABLE blocks_asset_aliases (
    tenant_id   uuid        NOT NULL REFERENCES tenants(id),
    asset_id    varchar(32) NOT NULL,
    data_format varchar(8)  NOT NULL,
    sha256      varchar(64) NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, asset_id, data_format),
    FOREIGN KEY (tenant_id, sha256, data_format)
      REFERENCES blocks_blobs (tenant_id, sha256, data_format)
      ON DELETE RESTRICT,
    CHECK (asset_id ~ '^[0-9a-f]{32}$'),
    CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CHECK (data_format IN ('svg', 'png', 'jpg', 'wav', 'mp3'))
);
```

The implementation migration may add indexes required by measured query paths, but it
MUST NOT change the identity semantics above without updating this contract.

Do not add a per-project blob-copy table merely to model project references; the canonical
project/version document already contains `assets[]`.

---

## 4. Tenant and RLS policy

Both tables are private tenant data.

The migration must follow the repository's current tenant/RLS conventions and include
negative cross-tenant tests. Direct public read is forbidden.

Application queries always contain tenant context explicitly in repository parameters,
and RLS/guard semantics provide defence in depth.

A runtime capability for one project does not turn tenant-wide asset aliases into public
objects. Asset GET additionally checks that the requested alias is referenced by the
authorised draft/version.

---

## 5. Object storage client

The selected S3 client is:

```text
@aws-sdk/client-s3
```

The implementation PR pins an exact version that passes the repository dependency
security and license gates.

A bot MUST NOT substitute another client, add a cloud-specific SDK or expose presigned
bucket credentials directly to Scratch unless this design contract is intentionally
revised.

Blocks depends on an application port; S3 SDK types do not leak into domain/public
contracts.

Target logical port:

```ts
interface BlocksBlobStorePort {
  putImmutable(input: {
    tenantId: string;
    sha256: string;
    dataFormat: BlocksAssetFormat;
    sizeBytes: number;
    sourcePath: string;
  }): Promise<{ objectKey: string }>;

  open(input: {
    tenantId: string;
    sha256: string;
    dataFormat: BlocksAssetFormat;
  }): Promise<ReadableStreamOrNodeReadable | null>;

  exists(input: {
    tenantId: string;
    sha256: string;
    dataFormat: BlocksAssetFormat;
  }): Promise<boolean>;
}
```

Exact stream type follows the API runtime, but callers do not receive S3 credentials or
bucket names.

---

## 6. Server-derived object key

Initial key scheme:

```text
tenants/{tenantId}/blocks/assets/{sha256[0:2]}/{sha256}.{dataFormat}
```

The server derives this value. A client cannot choose, override or persist it.

The bucket is private. Bucket name and endpoint come from environment/configuration.

Required configuration names:

```text
ASA_OBJECT_STORAGE_ENDPOINT
ASA_OBJECT_STORAGE_REGION
ASA_OBJECT_STORAGE_BUCKET
ASA_OBJECT_STORAGE_ACCESS_KEY
ASA_OBJECT_STORAGE_SECRET_KEY
ASA_OBJECT_STORAGE_FORCE_PATH_STYLE
```

Secrets are never committed and never returned to browsers.

---

## 7. Local/self-hosted MinIO

MinIO is the selected local/test/self-hosted S3-compatible backend unless deployment uses
an explicitly configured external S3-compatible service.

If MinIO is introduced into Docker Compose:

```text
it joins the existing ASA Compose project
service listens internally on 9000
management console is not publicly exposed by default
persistent data uses an ASA-managed named volume/path
credentials come from environment/secrets, not Git
healthcheck is present
```

A second permanent Compose project is forbidden.

Bucket existence is checked explicitly. Production must not silently switch to a new
bucket when the configured bucket is missing. Dev/test tooling may create the configured
test bucket in an isolated environment.

---

## 8. Asset upload endpoint

Logical route:

```http
PUT /api/blocks/runtime/projects/{projectId}/assets/{assetId}.{format}
Authorization: Bearer <editor capability>
Origin: <exact configured runtime origin>
```

The route is runtime-bearer-only. Cookies do not grant authority.

### 8.1 Request processing order

The exact safety order is:

```text
1. validate runtime origin/capability/project/permission
2. validate path assetId/format syntax
3. reserve/check runtime upload byte/request budget for this capability/project
4. enforce request byte limit while streaming
5. stream request body to an API-owned temporary file
6. compute MD5 + SHA-256 + size while streaming
7. validate actual content/container as the declared format
8. require computed MD5 == path assetId
9. derive final objectKey from tenant + SHA-256 + format
10. check whether immutable alias/blob already exists
11. for newly accepted unique bytes, account the actual size against runtime byte budget
12. ensure immutable object exists in private store
13. commit/reuse blocks_blobs metadata
14. commit/reuse immutable blocks_asset_aliases mapping
15. remove temporary file in finally
16. return canonical success response
```

An idempotent replay of an already existing exact alias does not consume the same
"new unique bytes" budget again, although it still consumes request-rate budget.

Do not buffer arbitrary 25 MiB assets per request into long-lived application memory when
streaming is available.

Temporary files use a server-generated random name under an API-owned temp directory and
are never derived from user file names or archive paths.

---

## 9. Content validation

Filename/MIME claims are insufficient.

At minimum:

```text
PNG: validate PNG signature/container
JPG: validate JPEG container markers sufficiently to reject arbitrary bytes
WAV: validate RIFF/WAVE container
MP3: validate recognised MP3 frame/ID3 structure, not extension alone
SVG: UTF-8/XML parse with root svg and the exact active/external-content policy below
```

### 9.1 SVG active/external-content policy

For core v1, uploaded/imported SVG MUST be rejected when any of the following is present:

```text
DOCTYPE or ENTITY declarations
<script>
<foreignObject>
any attribute whose local name starts with "on" (event handler)
an href/xlink:href with http:, https:, ftp:, file:, javascript:, protocol-relative //,
  or another external scheme
CSS @import
CSS url(...) targeting an external scheme/protocol-relative URL
```

The following reference classes may be allowed after normalisation/validation:

```text
local fragment: #id
data: URI embedded inside the same bounded SVG asset
```

The parser MUST NOT resolve external entities or fetch resources during validation.

SVG remains subject to the normal per-file byte limit. Nested data URIs are part of the
same SVG bytes and do not create a second hidden storage object; their total encoded size
is therefore bounded by that file limit.

If a compatibility fixture proves that a legitimate pinned Scratch project requires a
currently rejected construct, that becomes an explicit compatibility/security design
review. A bot MUST NOT simply disable SVG validation or add an external host to CSP.

The implementation should use small well-reviewed parsers/sniffers where appropriate and
must pass dependency security/license gates.

Do not render uploaded SVG in the main ASA origin for validation. SVG remains untrusted
content served only through the isolated runtime asset path with `nosniff` and restrictive
response headers.

---

## 10. S3/DB failure ordering

Object persistence happens before relational metadata that claims the blob is durable.

Consequences:

```text
S3 put fails
→ no blob/alias DB commit
→ upload fails

S3 put succeeds, DB commit fails
→ possible orphan object
→ request fails
→ do not delete object inline

blob metadata exists, alias insert conflicts with different SHA
→ return asset_identity_conflict
→ never retarget existing alias
→ possible orphan blob is acceptable
```

This ordering deliberately favours orphan storage over broken historical references.

---

## 11. Alias immutability

Primary key:

```text
(tenant_id, asset_id, data_format)
```

Once an alias maps to one SHA-256, it never maps to different bytes.

Upload cases:

```text
alias absent
  → create mapping

alias exists and same SHA/format
  → idempotent success

alias exists and different SHA
  → HTTP 409 / blocks_asset_identity_conflict
```

Do not `ON CONFLICT DO UPDATE sha256`.

The v1 MD5 rule should make different-byte alias collision extraordinarily unlikely; the
explicit conflict remains mandatory because security rules are not based on probability.

---

## 12. Exact upload response

Successful upload/replay returns:

```json
{
  "status": "ok",
  "asset": {
    "assetId": "0123456789abcdef0123456789abcdef",
    "dataFormat": "svg",
    "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "sizeBytes": 1234
  }
}
```

`status: "ok"` is mandatory compatibility surface for Scratch storage behaviour and
focused tests.

Do not return `objectKey`, bucket, endpoint, access key or secret.

---

## 13. Asset GET endpoint

Logical route:

```http
GET /api/blocks/runtime/projects/{projectId}/assets/{assetId}.{format}
Authorization: Bearer <editor-or-viewer capability>
```

Server order:

```text
1. verify capability/mode/project or version
2. load authorised draft/version document
3. require (assetId, format) in that document.assets[]
4. resolve same-tenant immutable alias
5. require alias SHA matches document canonical ref
6. open exact private blob
7. stream bytes with strict Content-Type + nosniff
```

A valid same-tenant alias that is not referenced by the authorised project/version is not
sufficient for read access.

For immutable asset responses, an implementation may use private browser caching if the
cache key cannot cross users/tenants and revalidation/security semantics are tested.
Bucket URLs remain private and are not exposed.

---

## 14. Canonical asset reference returned to documents

The only persistent project asset reference is:

```json
{
  "assetId": "32hex",
  "dataFormat": "png",
  "sha256": "64hex",
  "sizeBytes": 12345
}
```

The browser builds `assets[]` only from canonical server-returned refs or bootstrap refs
that originated from the server.

The persistence guard still re-verifies them; client cache is an optimisation, not
trust.

---

## 15. Deduplication

Deduplication boundary is one tenant:

```text
(tenant_id, sha256, data_format)
```

Two asset aliases in one tenant may reference one blob row/object when their exact bytes
match.

Do not implement cross-tenant shared metadata/authorisation in the core programme. A
provider may internally deduplicate encrypted/opaque physical bytes, but ASA application
semantics remain tenant-owned and must not leak existence or keys across tenants.

---

## 16. Limits and orphan-growth protection

Initial configurable content limits:

```text
SVG/PNG/JPG:                       10 MiB each
WAV/MP3:                           25 MiB each
unique assets referenced/project: 250 MiB total
projectJson:                       16 MiB
runtime concurrent uploads:         4 / capability
```

Because core programme GC is intentionally disabled, request-count limits alone are not
enough: a buggy or hostile authorised client could otherwise create unbounded orphan
unique blobs that are never committed into a project document.

Runtime security therefore also enforces initial new-unique-byte budgets:

```text
new unique asset bytes per capability lifetime: 512 MiB
new unique asset bytes per project / 5 minutes:    1 GiB
```

Only bytes that would create a new immutable blob/alias are charged to these byte budgets;
exact idempotent replays are not charged again. A failed upload before object acceptance is
not charged as durable bytes, while request-rate accounting still applies.

These are abuse ceilings, not project quota. The persistence guard still enforces the
250 MiB current-project reference total independently.

A future persistent tenant billing/quota subsystem is outside core M1 and MUST NOT be
invented as part of asset storage unless separately authorised.

The API rejects a stream once its configured per-file limit is exceeded and deletes its
temp file.

---

## 17. Project save interaction

The runtime save orchestrator does not rely on Scratch `asset.clean`.

For every `(assetId, dataFormat)` in the serialised VM state:

```text
canonical ref in bootstrap/runtime cache and exact bytes unchanged
  → reuse canonical ref

canonical ref absent
  → find exact VM asset bytes
  → PUT asset
  → cache server-returned canonical ref

bytes unavailable
  → do not PUT draft
  → recovery/error state
```

Clean pinned default assets are uploaded on first durable save if the project references
them and ASA has no canonical ref yet.

---

## 18. Object-store dependency degradation

Blocks object storage is a feature dependency, not a whole-platform dependency.

If object storage is unavailable:

```text
Blocks asset upload/load fails with retryable dependency state
Blocks editor reports degraded/error appropriately
unrelated ASA APIs/modules remain available
whole API process should not crash solely because S3/MinIO is unavailable after startup
```

Startup/configuration still fails fast for malformed credentials/config values. Runtime
network outage is handled as dependency degradation.

Expose a Blocks dependency health/readiness signal separately from whole-platform liveness.

---

## 19. Backup implications

No physical deletion exists in M1–M4, which makes backups safer.

Because asset object write precedes DB reference commit, backup/restore follows the order
defined in D0-005:

```text
capture PostgreSQL
→ mirror object store without deleting destination extras
→ verify every captured DB ref resolves
```

Do not implement object lifecycle expiration on the Blocks prefix before reference-safe GC
exists.

---

## 20. No GC in core programme

No task through activation may delete a blob/alias merely because the current draft no
longer references it.

Historical references may exist in:

```text
project_versions
submitted immutable versions
published versions
remix/copy lineage
backup snapshots
```

A later GC design must scan all authoritative reference sources, support dry-run and prove
restore/history safety.

---

## 21. Focused storage acceptance

Implementation must prove:

```text
1. migration creates tenant-scoped blob + immutable alias model
2. objectKey is absent from BlocksProjectDocumentV1
3. objectKey is server-derived and never returned to browser
4. bucket is private
5. supported format sniffing rejects arbitrary bytes
6. SVG rejects script/foreignObject/event handlers/external resource URLs/DTD entities
7. path assetId must equal computed MD5
8. SHA-256 is server-computed
9. same upload is idempotent
10. same alias + different bytes is conflict, not retarget
11. same-tenant same SHA dedup reuses blob when enabled
12. cross-tenant metadata/read is denied
13. project token cannot read an unreferenced same-tenant alias
14. S3 failure cannot create DB metadata claiming durability
15. DB failure after S3 may leave orphan but deletes nothing
16. temp files are cleaned on success/failure
17. per-file/project limits are enforced
18. per-capability/project new-unique-byte budgets stop orphan upload floods
19. exact response contains status=ok and canonical ref
20. exact bytes reload through authorised asset GET
21. MinIO/test backend joins the existing Compose project when selected
22. object-store outage degrades Blocks without taking down unrelated modules
```

The storage task MUST NOT activate `blocks` and MUST NOT implement GC.