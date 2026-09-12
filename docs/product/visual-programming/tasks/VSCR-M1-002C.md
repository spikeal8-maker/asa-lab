# VSCR-M1-002C — Parent/iframe protocol boundary

**Kind:** executable implementation slice  
**Risk:** high  
**Prerequisite:** VSCR-M1-002A accepted.  
**Execution:** coding starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-M1-002C` **and** `docs/execution/current.yaml.task.status` is exactly `in_progress`; `docs/execution/current.yaml.primary_lane.milestone.id` must be exactly `VSCR-M1-002` and its `owner_authorization` must be `accepted`.

## Goal

Establish the finite ASA parent ↔ Scratch-host bootstrap boundary with strict source/origin,
protocol, project and nonce validation. This slice creates the safe mount precondition; it does not
need to provide product branding or durable storage.

## Components

```text
blocks.host.protocol
```

Open only that entry in `components/host.yaml` plus its direct host-build dependency if needed.
Its component entry owns the exact D0-001 protocol and D0-004 origin/security contract sections
for this slice.

## Minimal read set

```text
../README.md
../AGENT_GUIDE.md
../COMPONENT_MAP.yaml
../components/host.yaml → blocks.host.protocol
only the exact contract sections mapped by blocks.host.protocol
actual host shell accepted in M1-002A
```

## Expected write paths

```text
apps/web/src/blocks/**                  # minimal reusable parent component/tests only
infra/scratch-editor/host/protocol.js
infra/scratch-editor/host/status.js
infra/scratch-editor/host/main.js       # composition only
infra/scratch-editor/host/index.html    # only if bootstrap marker/wiring requires it
e2e/blocks-host-protocol.spec.ts
../components/host.yaml → blocks.host.protocol only
```

## Protocol scope

Implement only the finite message set from D0-001:

```text
parent → child
  ASA_BLOCKS_INIT
  ASA_BLOCKS_TOKEN_UPDATE
  ASA_BLOCKS_FLUSH_REQUEST
  ASA_BLOCKS_STOP

child → parent
  ASA_BLOCKS_READY
  ASA_BLOCKS_STATUS
  ASA_BLOCKS_TOKEN_REFRESH_REQUIRED
  ASA_BLOCKS_FLUSH_RESULT
  ASA_BLOCKS_FATAL
```

Every accepted post-init message binds protocolVersion, projectId and sessionNonce. No generic
RPC/eval bridge and no wildcard `postMessage('*')` target.

## Acceptance

```text
editor does not mount before valid INIT
wrong event.source/origin/project/nonce/protocol is rejected
parent sends only to exact configured runtime origin
fixture token stays memory-only
TOKEN_UPDATE changes only in-memory authority fixture
runtime failure produces controlled parent error state
no production hidden editor route is exposed
```

## Tests/evidence

```text
browser wrong-origin/source/nonce/project negatives
no postMessage target '*'
no token in URL/localStorage/sessionStorage/IndexedDB/logs
parent survives child FATAL/runtime crash
node tools/validate-blocks-docs.mjs
```

## Forbidden

```text
no product branding/File/Extensions work
no real JWT issuance or verification
no generic CORS policy change
no S3/MinIO
no Project Core save
no ScratchStorage load/save implementation
no M1-003 work
```

## Bounded self-review

Review only the protocol component, final diff, mapped protocol/security contract sections and
mapped browser evidence. Confirm security transport implementation did not leak forward into
M1-003.

## Independent review

Because this is a HIGH-risk trust-boundary slice, acceptance requires a reviewer that is not the
authoring execution context. Give the reviewer only:

```text
this task card
final diff
blocks.host.protocol component entry
mapped D0-001/D0-004 sections
browser/protocol evidence on the exact SHA
```

The reviewer checks origin/source/project/nonce binding, token leakage, wildcard messaging,
controlled failure behaviour and scope creep. A product defect is `FAIL/STOP`; fix it through a
separately selected bounded repair task and rerun the review.

## Stop

STOP after self-review, independent review and evidence. `VSCR-M1-002D` is the next planned slice:
it mounts the real editor through controlled fixture storage and creates the first visible Scratch
checkpoint. D requires separate selection in `current.yaml`.
