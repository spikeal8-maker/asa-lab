# Operational diagnostic sources

This source slice supplies finite, explicit source health for the stabilization
programme [#909](https://github.com/spikeal8-maker/asa-lab/issues/909). It performs
no deployment, remote reconfiguration, privilege escalation, generation or paid
provider request. Healthy samples are not a GPU quality/capacity guarantee and do
not claim complete historical coverage.

## Required source declaration

Host `catalog.json` now contains `requiredSources` version1, policy
`asa-connected-v1`: platform, auditMaxAgeSeconds900, and a nonempty array of
`{source, applicable, maxAgeSeconds, requireThrough, reason?}`. OS-only false
entries use `reason: other-platform`; Windows never excuses a Linux source on a
Linux host. Core Docker, database, resource, lifecycle, update and five service
recent-log IDs are explicit, even when a service disappears. Every closed DB
projection is explicit. Configured file/provider/backup sources become mandatory.
An operator acceptance run must also pin its expected configured IDs; removing a
configuration entry is not evidence that its previously required source is healthy.
The existing retained-history audit stays separate. Reader acceptance is a
separate slice; this declaration does not replace universal `coverageComplete`.

Source IDs: `operations:updates`, `operations:backup`, `provider:ollama`,
`provider:comfyui`, `database-events:ai_image_jobs` and
`database-events:ai_usage_journal`. Empty operation history is pending, malformed or
unreadable input is error, and an old last-success receipt remains pending until a
real new operation is observed. No synthetic empty `.asa/logs` directory is made.

## Durable receipts

Both protected source updaters (shell and PowerShell) preserve their original
`backups/update-*.receipt.txt` and append a closed event after writing it. The
published-release manager preserves `last-operation.json` and appends update
outcomes; its verified backup operation records success/failure independently.
An authorized no-change update records its actual release/identity/entry
verification without inventing a backup or replacing the previous switch receipt.
The operator may also import the existing canonical source/manager receipt during
collection; repeated identical receipts have the same event identity.

The private `.asa/operations/events.jsonl` has five explicitly named segments of
at most10 MiB each. Rotation only touches these diagnostic segments; it never
removes owner archives, configuration or backups. Append is locked and fsynced;
POSIX journal files are0600 and their private directory0700. Windows inherits the
trusted operator directory ACL. The existing raw private receipts remain intact;
only allowed enums, UTC times, revision/schema, actual duration and verified
hash/size metadata enter public diagnostics. Paths, URLs, images, entry origins,
credentials and arbitrary nested fields are dropped. A backup directory reports
`manifestSha256` and verified payload bytes; an external archive reports its
actual `archiveSha256/archiveBytes`. They are different facts.

A source-updater trigger is unknown unless the caller explicitly provides
`ASA_OPERATION_TRIGGER=manual|automatic|unknown` (shell); the published manager
knows its own `--scheduled` flag. A logging-write failure does not relabel a
successful application switch as a failed switch: the original receipt survives
and stderr reports a fixed diagnostics warning. Process termination or I/O failure
before a canonical receipt exists still requires existing host/process logs; this
adapter cannot invent an operation receipt for such an event. An external
success-only backup receipt proves the last verified success, not the absence of
later failures or a fresh remote restore verification.

## Operator configuration

The default has no network probes or external file reads. Add a versioned section
to the existing private `.asa/log-collector.json`, after selecting the real trusted
operator tunnel origins once:

```json
{
  "operationalSources": {
    "version": 1,
    "providers": {
      "ollama": { "origin": "http://127.0.0.1:11434" },
      "comfyui": { "origin": "http://127.0.0.1:8188" }
    },
    "providerIntervalSeconds": 60,
    "backupSuccessReceipt": "/PRIVATE/operator/last-backup-success.json",
    "updateMaxAgeSeconds": 604800,
    "backupMaxAgeSeconds": 129600
  }
}
```

These are standard loopback examples, not discovery results or a setting for a
specific computer. Use the already authorized tunnel endpoint of this install.
Configured remote probes/external receipts currently require a root-controlled
Linux config and root-controlled non-writable parents; receipt/config files are
private0600. Windows supports local operation journaling and collection, while
remote-provider sampling from Windows is not enabled by this source slice. No
automatic ownership repair, sudo, firewall, DNS, VPN, route, port or tunnel change
is performed. A missing required file or unsupported authority fails closed.

Only numeric loopback/RFC1918/IPv6-ULA HTTP(S) origins are accepted. Hostnames,
public/metadata/link-local addresses, credentials, path, query, fragment, headers
and unknown configuration keys are refused. DNS rebinding and environment HTTP
proxies are not used. Requests are only GET `/api/ps`, GET `/api/tags` and GET
`/system_stats`, with no redirects or authentication, a3-second absolute deadline
per request and256 KiB response bound. Model names/paths/digests, process argv,
usernames, prompts and arbitrary strings are discarded before persistence. Only
closed availability/failure enums, counts and actual integer RAM/VRAM/timing values
are retained. ComfyUI `/queue`, generation, interrupt, free-memory and model-load
endpoints are not called.

An optional external receipt has this closed schema:

```json
{
  "format": "asa-backup-success-v1",
  "status": "succeeded",
  "completedAt": "2026-11-02T00:00:00Z",
  "archiveSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "archiveBytes": 123456,
  "trigger": "automatic"
}
```

It must be produced by the actual backup verifier. Creating an example JSON is
not backup evidence. Unknown fields are ignored; a missing hash/positive byte
count/status/time/trigger is rejected. The collector never opens an archive or
contacts Yandex/cloud URLs supplied by this file.
The existing school `latest-success.json` envelope is also supported unchanged:
exact `status: verified_cloud_sha256`, `createdAt`, `size`, `sha256` and `trigger`
map to the same closed facts plus `verification: cloud_sha256`. Its archive name,
project, remote URL and restore-rehearsal object are dropped. `uploaded` or an
unknown status is not verified success. No rewrite of the backup producer or
extra download is required.

## AI projection and remaining gap

AI jobs and usage have composite owner/request native keys used only in private
hash deduplication. SQL selects a fixed diagnostic column list before subprocess
stdout; prompts, chat text, recipes, graphs, model names, owner/account/Seat/thread
IDs and storage keys are not public fields. Continuously repeated bounded keyset
pages detect a late terminal change even when admission was days ago. The event
time is first observation; separate created/admitted/started/finished timestamps
remain actual ledger facts. Unknown counts stay absent. Public fields use prefixes
such as `image_state` and `generation_status` so ordinary HTTP200/provider samples
cannot be mistaken for database records.

Stored image provider/storage/denial errors are visible independently of HTTP200
job polling. Catch-all worker exceptions that only leave a lease to expire still
have no durable cause code in the application: this read-only adapter cannot
recover one. App worker instrumentation is a separate required slice; neither
`requiredSources` nor this document claims those error reasons are complete.

## Checks

The same focused commands run locally and in the new operational diagnostics CI:

```sh
python -m unittest tools.deployment.test_operational tools.deployment.test_collector tools.deployment.test_contracts tools.deployment.test_backup_mounts
python tools/test_collect_logs.py
pnpm exec vitest run apps/api/src/operational-diagnostics.spec.ts
```

The isolated PostgreSQL job additionally runs `python tools/test_operational_database.py`
with explicit CI opt-in and the disposable container identity. It verifies actual
SQL output omits a multi-megabyte private prompt, records late state changes and
deduplicates replay. No local Docker or working data is used. Real configured
provider sampling and operation activation remain NOT_RUN until an authorized
installation accepts this source and operator configuration.
