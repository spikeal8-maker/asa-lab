# Durable retirement and explicit verified-successor recovery

This is an incident recovery contract, not a fresh history generation, log import,
application restore or healthy-coverage claim. No PostgreSQL/MinIO/business schema,
quota, source cadence, model, UI or browser assertion changes are involved.

## Cause and retained authority

The previous compaction commits sequence remapping and retirement and deletes its
durable intent without preserving verified original metadata. The original may
have been created earlier in that same publish cycle and thus absent from the old
catalog/cache. Later publish bookkeeping can lose that metadata even without a
crash. Restart cannot reconstruct a gapped original sequence mapping.

The fix verifies original bytes/count/current ownership before remapping, persists
the exact original metadata in the same SQLite transaction as retirement, and
merges that durable addition into publish's earlier local snapshot. It does not
mint original HMAC receipts. Tests cover a newly-written first-cycle predecessor
and cold restart before/after the compaction commit.

Historical H03 evidence (read-only, not a current health assertion): protected
HOST copy manifest SHA256
`eccb0bf480fd636f1d527da4a4b78e024668d2f4e34dbc8e6f600d25481889d5`.
Operation `e8416d12f84f4cf9b85f14bba94c8924` found31 predecessors/607 unique records,
all607 published under current sequences in one authenticated active successor.
All607 JSON objects **and exact JSONL lines** match; no missing/unpublished/ambiguous
IDs or failed successor proofs were found. The original private copy remains the
rollback/forensic reference. Operator ZIPs had0/31 original reference matches and
are not a substitute for it.

## Explicit new authority, not an invented old receipt

`tools/retired_successor_recovery.py` is standalone standard-library operator code.
It never imports/executes the old installed collector or constructs `Collector`.
Normal collector startup has no dependency on an external repository/tool.

PLAN reads the protected copy's backed-up SQLite using read-only immutable mode,
so it creates no SHM/WAL and does not touch live history. Every copied forensic file and directory is checked against the private manifest,
root modes and closed receipt before recovery analysis (bounded8GiB total,256MiB/file,100000 entries). Root0700/0600, no-follow descriptors,
the independently recorded manifest hash and the existing local verification key
are required; a normalized/export flag is not authority.

Every legacy record must have exactly one current published index identity, exactly
one active owning segment and an identical JSON object and raw line. The existing
successor receipt is checked against actual compressed/raw bytes, size/count, the
complete current sequence/ID mapping and HMAC. Absent/unpublished/duplicate IDs,
ambiguous owners, missing/wrong receipts, partial matches, changed mappings and
stale/replaced bytes deny the whole batch. This bounded contract permits at most
32 predecessor files,3MiB old raw data and16384 unique records. Original filename
ranges must have no surviving index rows; no old mapping is inferred from them.

Recovered metadata carries `retirementAuthority.kind=verified-successor-v1`, the
forensic manifest reference and successor/mapping/receipt/content references.
`originalMappingRecovered` remains false. Its HMAC uses a separate domain and field
`retirementAuthorityProof`; original `segment_verification` rows are never created
or changed. A separately domain-signed `retired:successor-recovery:v1` ledger binds the batch/files.
The fixed collector checks this typed authority and detects stripping/tampering.
The new attestation remains verifiable after the owning successor is itself
compacted/retired: normal runtime needs neither its old file/mapping nor external
backup access. Ordinary retirement grace/catalog protection/retention continue unchanged.

## Reviewed artifacts and limited compatibility

Stage this exact reviewed helper as trusted root-owned code, not from the mutable
old installation. Run with isolated/no-bytecode Python (`-I -B`); other CLI launches
are rejected before imports/data access. Also stage the separately reviewed
Server-setings artifact at commit `c3a362f32f8f5efdf63257517a28b8f8f1bf1791`,
`scripts/diagnostic_forensic_snapshot.py`, LF SHA256
`c82a304985a775a14861c8f76f40816487e15b51fbb51be82f1d7864bb2c1335`.
The incident helper validates that exact hash and root-controlled path before
executing its read-only identity/manager/path guards.

This guard preserves the reviewed legacy dfee four-source and3e five-source
runner contracts. It additionally recognizes only two complete materializations
of the preventive five-source runtime from app commit
`6a98bddd8953eff732ec7d2cbb3de8cdec8abdee`:

- Raw Git LF bundle: `b5d79dbc1c97bf4d94226b4c2c06eac4795c7366ae1a9b17add83a46c0790731`.
- Canonical checkout with the `.gitattributes` PowerShell CRLF rule:
  `9ab3c329ec7f6a532ff8c4d3f47a036430f038716de7dc575e8df96d003ee74a`.

Each profile pins every file's raw length and SHA256 as well as the aggregate
scriptDigest. No mixed profiles, shifted file boundaries, arbitrary newline
normalization or digest fallback are allowed. A merge/doc/helper-only revision
may differ from6a98 only if registration and all five actual runtime files satisfy
that exact closed profile plus canonical owner/root/project/unit constraints.
This repin changes no preventive runtime bytes and promises no arbitrary future
release compatibility. Metadata/HMAC verification executes no installed old code.
The exact guard passed29 Linux synthetic tests with no skips (operator operation
32974a9574f4436caceb1a9936d52192); this component proof is not whole CI, live
compatibility acceptance or permission to apply recovery.

```sh
sudo python3 -I -B /root/approved/retired_successor_recovery.py \
  --snapshot /var/backups/asa-forensics/h03-host-20261102-909 \
  --manifest-sha256 eccb0bf480fd636f1d527da4a4b78e024668d2f4e34dbc8e6f600d25481889d5 \
  --guard-tool /root/approved/diagnostic_forensic_snapshot.py
```

Without `--apply` this is PLAN only. Closed stdout gives counts/status, never names,
IDs, event bodies, key, configuration or raw SQLite/host error text.

## Isolated rehearsal before any live apply

1. Independently verify the original private copy/manifest. Keep it immutable.
2. Create a separate protected working clone, never a hardlink to the original DB,
   key or store. Record its own baseline hashes. Do not point a real service/API
   at it or fabricate a systemd unit to bypass the identity guard.
3. A separately reviewed offline harness may call the helper's `analyze` and
   `apply_metadata` only on that clone: the first uses its standalone read-only
   SQLite backup; the second is the same transaction core exercised by synthetic
   tests. The production CLI's live identity checks must not be disabled for a
   rehearsal. Keep both actual source revisions and harness provenance.
4. Require exact607/607 authority and complete target-set equality; compare every
   events row, original receipt, retirement marker, catalog/error and source file
   before/after. Only retired metadata and the separately typed ledger may change.
   Test tampering/partial match and precommit faults: all must leave state unchanged.
5. Cold-reopen the clone and invoke reviewed fixed-runtime retained-history
   validation methods on an in-memory SQLite backup, without constructor/cycle/
   publish or collection. Existing catalog/source/audit gaps remain visible until
   independently verified; this is not full collector startup or healthy coverage.

Historical operator evidence: the reviewed infra PR62 harness at
`0a7dd4abbe8bfd0f1d8bcccfc1c4558dc252435e` used app6a98 and the former pinned6b0
guard for an actual isolated clone rehearsal:31 files/607 records/1 successor,
all156886 index rows (150787 published,6099 unpublished),854 active and535 retired
segments, and three negative challenges passed; original/live bytes were unchanged.
See [the exact operator receipt](https://github.com/spikeal8-maker/Server-setings/pull/62#issuecomment-6590126719).
That historical result remains valid for those exact artifacts. It does not prove
this new helper's operator execution, live application or full collector startup.

## Apply metadata only, after review and successful rehearsal

The preferred supported order is **immutable fixed-runtime update first**, then
explicit quiescence of that fixed runner, metadata repair, and controller-approved
resume of only the fixed runtime. The normal updater has no collector hold flag;
do not assume it leaves the runner paused. It may start the fixed runner with the
existing debt/error still visible. Verify the installed exact five-source profile,
canonical registration and preservation of the existing USER owner UID/GID, then
explicitly quiesce that own fixed runner before APPLY. Do not hand-edit registration/
digests, invent a hold option or fabricate a unit. If update, identity or quiescence
verification fails, STOP; do not repair under an unrecognized runtime or resume
old dfee code. Have the immutable release and rollback ordering ready beforehand.
Recovery-first is not established as safe: the former guard recognized only
dfee/3e, and metadata repair would not install the preventive fix.

Explicit operator quiescence is required. The helper never stops, starts,
enables, restarts or resets any service/manager. It verifies the canonical registered
owner/unit/user bus and holds the existing collector lock. A private forensic copy
must already exist; this helper does not create or overwrite one.

Add `--root /srv/asa-lab --apply` to the PLAN command only after that sequence.
Under the lock, a forked metadata writer permanently drops to the registered
UID/GID (no shell/PAM), so new SQLite WAL/SHM are not accidentally root-owned for a
user collector. Inside one `BEGIN IMMEDIATE` transaction it revalidates all current
authority, the complete missing-metadata target set and observed file identities/
hashes, then writes only retired metadata and the separate provenance ledger.
State-table triggers/extra uniqueness and foreign-key side effects are rejected;
newer unrelated unpublished events remain untouched. File changes or any fault
before commit roll back the entire transaction. A child deadline has an ambiguous
commit outcome: inspect the durable ledger in a new protected read-only snapshot
before retry; never clear state or blindly repeat. Repeated identical metadata
application is idempotent and still revalidates the authority.

The helper does NOT clear `retired:segments`, source errors or catalog, change
original sequence/ID mappings, create original receipts, GC files or claim health.
The old dfee collector must NOT resume after metadata repair. A failed/ambiguous
repair is a controller STOP with preserved debt/evidence, not permission to resume
old code or clear errors. After successful repair, verify the same fixed runtime
identity before controlled resume and separately qualify actual startup/coverage.
Resume, whole-app update, rollback and visible coverage qualification are controller
steps, not commands implemented here.

Tests: `python -m unittest discover -s tools -p 'test_retired*.py' -v`.
The existing explicit `tools/test_collect_logs.py` CI entrypoint includes these
regressions. Synthetic success is not H03 application/rehearsal evidence.
