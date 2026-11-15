"""Explicit legacy compaction recovery. PLAN on a forensic copy; never starts a collector.

No imports from the installed application. Original receipts/mappings are never minted.
The optional incident APPLY guard is separately reviewed, pinned infrastructure code.
"""
import sys
if __name__ == '__main__' and (not sys.flags.isolated or not sys.dont_write_bytecode):
    print('{"status":"BLOCKED","code":"ISOLATED_PYTHON_REQUIRED","historyHealthy":false}')
    raise SystemExit(1)
import argparse
import contextlib
import gzip
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import time
import signal

KIND = 'verified-successor-v1'
DOMAIN = b'asa-retired-successor-v1\0'
PATTERN = re.compile(r'seg-(\d{16})-(\d{16})\.jsonl(?:\.gz)?$')
INDEX = 'sqlite-backup/' + hashlib.sha256(b'diagnostics/private/index.sqlite').hexdigest() + '.sqlite'
GUARD_SHA256 = 'c82a304985a775a14861c8f76f40816487e15b51fbb51be82f1d7864bb2c1335'  # Server-setings c3a362f32f8f5efdf63257517a28b8f8f1bf1791, LF-normalized reviewed artifact.


class RecoveryBlocked(RuntimeError): pass


def need(value, code):
    if not value: raise RecoveryBlocked(code)


def encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()


def sha(data): return hashlib.sha256(data).hexdigest()


def verify_retirement_authority(meta, key):
    """New collector verifies the separately typed authority, never an original receipt."""
    proof = meta.get('retirementAuthorityProof')
    value = {k: v for k, v in meta.items() if k != 'retirementAuthorityProof'}
    need(isinstance(meta.get('retirementAuthority'), dict) and meta['retirementAuthority'].get('kind') == KIND and isinstance(proof, str)
         and re.fullmatch(r'[a-f0-9]{64}', proof), 'RETIREMENT_AUTHORITY_INVALID')
    need(hmac.compare_digest(proof, hmac.new(key, DOMAIN+encoded(value), hashlib.sha256).hexdigest()),
         'RETIREMENT_AUTHORITY_INVALID')


def state(db, name):
    row = db.execute('SELECT value FROM state WHERE key=?', (name,)).fetchone()
    if not row: return {}
    need(len(row[0]) <= 16*1024**2, 'STATE_LIMIT')
    value = json.loads(row[0]); need(isinstance(value, dict), 'STATE_INVALID')
    return value


def schema_guard(db, writing=False):
    for table in ('events', 'state', 'segment_verification'):
        row=db.execute('SELECT type,sql FROM sqlite_master WHERE name=?',(table,)).fetchone()
        need(row and row[0]=='table' and 'VIRTUAL' not in row[1].upper(), 'INDEX_SCHEMA_UNSUPPORTED')
    if not writing: return
    columns=db.execute('PRAGMA table_info(state)').fetchall()
    need([c[1] for c in columns]==['key','value'] and columns[0][5]==1, 'STATE_SCHEMA_UNSUPPORTED')
    need(not db.execute("SELECT 1 FROM sqlite_master WHERE type='trigger' AND tbl_name='state'").fetchone(), 'STATE_WRITE_SIDE_EFFECTS')
    need(all(not i[2] or i[3]=='pk' for i in db.execute('PRAGMA index_list(state)')), 'STATE_WRITE_SIDE_EFFECTS')
    tables=db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    need(len(tables)<=100, 'INDEX_SCHEMA_LIMIT')
    for (table,) in tables:
        need(not any(r[0]=='state' for r in db.execute('SELECT "table" FROM pragma_foreign_key_list(?)',(table,))),
             'STATE_WRITE_SIDE_EFFECTS')


def segment(reader, name):
    need(isinstance(name, str) and PATTERN.fullmatch(name), 'SEGMENT_NAME_INVALID')
    data = reader('diagnostics/store/'+name, 8*1024**2)
    if name.endswith('.gz'):
        with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream: raw = stream.read(4*1024**2+1)
    else: raw = data
    need(0 < len(raw) <= 4*1024**2 and raw.endswith(b'\n') and b'\r' not in raw, 'SEGMENT_BODY_INVALID')
    lines = raw.split(b'\n')[:-1]; entries = [json.loads(line) for line in lines]
    need(all(isinstance(e, dict) and isinstance(e.get('id'), str) and re.fullmatch(r'[a-f0-9]{64}', e['id'])
             for e in entries), 'EVENT_ID_INVALID')
    need(len({e['id'] for e in entries}) == len(entries), 'DUPLICATE_EVENT_IDS')
    return data, raw, entries, lines


def analyze(db, reader, manifest_sha, targets=None):
    """Pure reads/verification. reader paths are .asa-relative and bounded."""
    schema_guard(db)
    need(re.fullmatch(r'[a-f0-9]{64}', manifest_sha), 'FORENSIC_MANIFEST_REQUIRED')
    retired, metadata = state(db, 'retired:segments'), state(db, 'retired:metadata')
    need(not state(db, 'compaction:pending'), 'COMPACTION_PENDING')
    names = sorted(set(retired)-set(metadata)) if targets is None else sorted(targets)
    need(0 < len(names) <= 32 and set(names) <= set(retired), 'LEGACY_TARGET_SET_INVALID')
    catalog = json.loads(reader('diagnostics/store/catalog.json', 16*1024**2))
    active = catalog['segments']; need(isinstance(active, list), 'CATALOG_INVALID')
    ranges = []
    for meta in active:
        match = PATTERN.fullmatch(meta['file']); need(match, 'CATALOG_INVALID')
        need(meta['file'] not in retired, 'ACTIVE_RETIRED_OVERLAP')
        ranges.append((int(match[1]), int(match[2]), meta))
    key = reader('diagnostics/private/segment-verification.key', 128)
    need(len(key) == 32, 'VERIFICATION_KEY_INVALID')
    originals, owners, seen = {}, {}, set()
    total_bytes = 0
    for name in names:
        data, raw, entries, lines = segment(reader, name)
        total_bytes += len(raw); need(total_bytes <= 3*1024**2, 'LEGACY_BATCH_LIMIT')
        first, last = map(int, PATTERN.fullmatch(name).groups())
        # Absence does NOT reconstruct the lost mapping; it restricts this tool
        # to completed compaction predecessors, not partially remapped history.
        need(not db.execute('SELECT 1 FROM events WHERE seq BETWEEN ? AND ? LIMIT 1', (first, last)).fetchone(),
             'ORIGINAL_MAPPING_STILL_PRESENT')
        originals[name] = (data, raw, entries, lines)
        for event, line in zip(entries, lines):
            need(event['id'] not in seen, 'DUPLICATE_EVENT_IDS'); seen.add(event['id'])
            need(len(seen) <= 16384, 'LEGACY_EVENT_LIMIT')
            rows = db.execute('SELECT seq,published FROM events WHERE id=? OR id=?',
                              (bytes.fromhex(event['id']), event['id'])).fetchall()
            need(len(rows) == 1, 'CURRENT_ID_ABSENT_OR_AMBIGUOUS')
            seq, published = rows[0]; need(published == 1, 'CURRENT_ID_UNPUBLISHED')
            candidates = [m for a, b, m in ranges if a <= seq <= b]
            need(len(candidates) == 1, 'CURRENT_SEGMENT_AMBIGUOUS')
            owner = candidates[0]['file']
            owners.setdefault(owner, {'meta': candidates[0], 'wanted': []})['wanted'].append((event, line))
    authority, current_entries = {}, {}
    for name, target in owners.items():
        meta = target['meta']; data, raw, entries, lines = segment(reader, name)
        first, last = map(int, PATTERN.fullmatch(name).groups())
        rows = db.execute('SELECT seq,id,published FROM events WHERE seq BETWEEN ? AND ? ORDER BY seq', (first, last)).fetchall()
        ids, mapping = [], hashlib.sha256()
        for seq, identity, published in rows:
            identity = bytes.fromhex(identity) if isinstance(identity, str) else identity
            need(isinstance(identity, bytes) and len(identity) == 32 and published == 1, 'SUCCESSOR_MAPPING_INVALID')
            ids.append(identity); mapping.update(str(seq).encode()+b':'+identity)
        receipt = db.execute('SELECT proof,metadata FROM segment_verification WHERE name=?', (name,)).fetchone()
        need(receipt and len(receipt[1]) <= 1024**2, 'SUCCESSOR_RECEIPT_MISSING')
        proof, text = receipt; saved = json.loads(text)
        basis = name+':'+sha(data)+':'+mapping.hexdigest()+':'
        need(isinstance(proof, str) and hmac.compare_digest(proof, hmac.new(key, (basis+text).encode(), hashlib.sha256).hexdigest()),
             'SUCCESSOR_HMAC_INVALID')
        need(saved['file'] == name and meta['sha256'] == saved['sha256'] == sha(raw)
             and meta['rawBytes'] == saved['rawBytes'] == len(raw)
             and meta['count'] == saved['count'] == len(rows) == len(entries)
             and ids == [bytes.fromhex(e['id']) for e in entries], 'SUCCESSOR_BODY_MAPPING_INVALID')
        for e, line in zip(entries, lines):
            need(e['id'] not in current_entries, 'CURRENT_SEGMENT_AMBIGUOUS')
            current_entries[e['id']] = (e, line, name)
        authority[name] = dict(file=name, compressedSha256=sha(data), rawSha256=sha(raw),
                               mappingSha256=mapping.hexdigest(), receiptSha256=sha((proof+':'+text).encode()))
    proposals = {}
    for name, (data, raw, entries, lines) in originals.items():
        successors = set()
        for event, line in zip(entries, lines):
            current = current_entries.get(event['id'])
            need(current and current[0] == event and current[1] == line, 'EXACT_EVENT_BODY_MISMATCH')
            successors.add(current[2])
        need(all(isinstance(e.get('time'), str) for e in entries), 'EVENT_TIME_INVALID')
        meta = dict(file=name, schema=2, sha256=sha(raw), bytes=len(data), rawBytes=len(raw), count=len(entries),
                    first=min(e['time'] for e in entries), last=max(e['time'] for e in entries),
                    retirementAuthority=dict(kind=KIND, forensicManifestSha256=manifest_sha,
                        predecessorCompressedSha256=sha(data),
                        originalMappingRecovered=False, orderedIdsSha256=sha(b''.join(bytes.fromhex(e['id']) for e in entries)),
                        successors=[authority[n] for n in sorted(successors)]))
        meta['retirementAuthorityProof'] = hmac.new(key, DOMAIN+encoded(meta), hashlib.sha256).hexdigest()
        proposals[name] = meta
    return dict(proposals=proposals, files=len(names), records=len(seen), successors=len(owners),
                fingerprint=sha(encoded(proposals)), keySha256=sha(key))


class SQLiteSidecars:
    """Pin every existing sidecar before SQLite can write; reject unsafe aliases."""
    def __init__(self, parent, uid):
        self.parent = parent; self.uid = uid; self.identities = {}; self.pins = []
        try: self.check()
        except BaseException:
            self.close(); raise

    def check(self):
        for suffix in ('-wal', '-shm', '-journal'):
            name = 'index.sqlite'+suffix
            try:
                fd = os.open(name, os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK, dir_fd=self.parent)
            except FileNotFoundError:
                need(name not in self.identities, 'SQLITE_SIDECAR_DISAPPEARED')
                continue
            except OSError:
                raise RecoveryBlocked('SQLITE_SIDECAR_UNSAFE') from None
            try:
                info = os.fstat(fd)
                need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and
                     info.st_uid == self.uid and not info.st_mode & 0o077,
                     'SQLITE_SIDECAR_UNSAFE')
                identity = (info.st_dev, info.st_ino)
                need(name not in self.identities or self.identities[name] == identity,
                     'SQLITE_SIDECAR_REPLACED')
                current = os.stat(name, dir_fd=self.parent, follow_symlinks=False)
                need((current.st_dev,current.st_ino) == identity and stat.S_ISREG(current.st_mode),
                     'SQLITE_SIDECAR_REPLACED')
                if name not in self.identities:
                    self.identities[name] = identity; self.pins.append(fd); fd = None
            finally:
                if fd is not None: os.close(fd)

    def close(self):
        for fd in self.pins: os.close(fd)
        self.pins.clear()


def apply_metadata(db, reader, expected, manifest_sha):
    """One SQLite transaction; never changes events/original receipts/catalog/errors/retired set."""
    need(not db.in_transaction, 'TRANSACTION_ALREADY_OPEN')
    need(callable(getattr(reader, 'revalidate', None)), 'REVALIDATION_READER_REQUIRED')
    if hasattr(reader, 'before_commit'): reader.before_commit()
    db.execute('BEGIN IMMEDIATE')
    try:
        schema_guard(db, writing=True)
        metadata = state(db, 'retired:metadata')
        names = set(expected['proposals'])
        missing = set(state(db, 'retired:segments'))-set(metadata)
        need(missing == names or not missing and all(metadata.get(n) == expected['proposals'][n] for n in names),
             'LEGACY_DEBT_CAS_CHANGED')
        current = analyze(db, reader, manifest_sha, names)
        need(current['fingerprint'] == expected['fingerprint'] and current['keySha256'] == expected['keySha256'], 'SUCCESSOR_CAS_CHANGED')
        # reader revalidates all previously observed bytes before commit.
        if hasattr(reader, 'revalidate'): reader.revalidate()
        ledger = state(db, 'retired:successor-recovery:v1')
        record = dict(kind=KIND, forensicManifestSha256=manifest_sha, files=expected['files'],
                      records=expected['records'], metadataSha256=expected['fingerprint'], requiresFixedCollector=True,
                      fileBindings={n:sha(encoded(m)) for n,m in current['proposals'].items()})
        ledger_key = reader('diagnostics/private/segment-verification.key', 128)
        record['ledgerProof'] = hmac.new(ledger_key, b'asa-retired-successor-ledger-v1\0'+encoded(record), hashlib.sha256).hexdigest()
        prior = ledger.get(expected['fingerprint']); need(prior is None or prior == record, 'RECOVERY_LEDGER_CAS_CHANGED')
        for name, meta in current['proposals'].items():
            need(name not in metadata or metadata[name] == meta, 'RETIREMENT_METADATA_CAS_CHANGED')
            metadata[name] = meta
        ledger[expected['fingerprint']] = record
        db.execute('INSERT OR REPLACE INTO state VALUES(?,?)', ('retired:metadata', json.dumps(metadata)))
        db.execute('INSERT OR REPLACE INTO state VALUES(?,?)', ('retired:successor-recovery:v1', json.dumps(ledger)))
        if hasattr(reader, 'revalidate'): reader.revalidate()
        if hasattr(reader, 'before_commit'): reader.before_commit()
        db.commit()
    except BaseException:
        db.rollback(); raise


def load_guard(path):
    need(os.name == 'posix' and os.geteuid() == 0, 'ROOT_LINUX_REQUIRED')
    # No installed app imports; only this exact independently reviewed stdlib artifact.
    path = Path(path); need(path.is_absolute(), 'PINNED_GUARD_REQUIRED')
    for item in (path, *path.parents):
        info = item.lstat()
        need(not stat.S_ISLNK(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022, 'GUARD_NOT_ROOT_TRUSTED')
    info = path.lstat()
    need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= 128*1024, 'PINNED_GUARD_REQUIRED')
    data = path.read_bytes().replace(b'\r\n', b'\n')
    need(sha(data) == GUARD_SHA256, 'GUARD_HASH_MISMATCH')
    namespace = {'__name__': 'approved_forensic_guard', '__file__': str(path)}
    exec(compile(data, str(path), 'exec'), namespace)
    return type('Guard', (), {k: staticmethod(v) if callable(v) else v for k, v in namespace.items() if not k.startswith('__')})


class Reader:
    def __init__(self, root, guard, manifest=None, private=False):
        self.fd, self.guard, self.manifest = guard.directory(root, private=private), guard, manifest
        self.private = private
        self.observed = {}
    def __call__(self, relative, limit):
        with self.guard.opened(self.fd, relative) as fd:
            before = os.fstat(fd); need(before.st_size <= limit and before.st_nlink == 1, 'FILE_LIMIT_OR_LINK')
            need(not self.private or before.st_uid == 0 and stat.S_IMODE(before.st_mode) == 0o600, 'FORENSIC_FILE_NOT_PRIVATE')
            chunks, size = [], 0
            while chunk := os.read(fd, min(1024**2, limit+1-size)):
                chunks.append(chunk); size += len(chunk); need(size <= limit, 'FILE_LIMIT_OR_LINK')
            data = b''.join(chunks)
            need(self.guard.signature(before) == self.guard.signature(os.fstat(fd)), 'FILE_CAS_CHANGED')
        value = (size, sha(data), self.guard.signature(before))
        need(relative not in self.observed or self.observed[relative] == value, 'FILE_CAS_CHANGED')
        self.observed[relative] = value
        if self.manifest is not None and relative not in ('manifest.private.json', 'receipt.json'):
            expected = self.manifest['copies'][relative]
            need(expected['bytes'] == size and expected['sha256'] == sha(data), 'FORENSIC_FILE_HASH_MISMATCH')
        return data
    def revalidate(self):
        for relative, (size, _, _) in list(self.observed.items()): self(relative, max(size, 1))
    def close(self): os.close(self.fd)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--guard-tool', required=True)
    parser.add_argument('--root')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args(argv)
    try:
        guard = load_guard(args.guard_tool)
        frozen = Reader(args.snapshot, guard, private=True)
        try:
            manifest_bytes = frozen('manifest.private.json', 16*1024**2)
            need(sha(manifest_bytes) == args.manifest_sha256, 'FORENSIC_MANIFEST_HASH_MISMATCH')
            manifest = json.loads(manifest_bytes)
            need(manifest['receipt']['format'] == 'asa-diagnostic-forensic-v1' and
                 manifest['receipt']['scope'] == 'HOST_COLLECTOR_ONLY' and
                 manifest['receipt']['qualification'] == 'NOT_A_VERIFIED_RECOVERY_SNAPSHOT' and
                 manifest['receipt']['recoverySnapshotVerified'] is False, 'FORENSIC_FORMAT_INVALID')
            receipt = json.loads(frozen('receipt.json', 1024**2))
            need(receipt == {**manifest['receipt'], 'manifestSha256':args.manifest_sha256}, 'FORENSIC_RECEIPT_INVALID')
            frozen.manifest = manifest
            copies = manifest['copies']
            need(isinstance(copies, dict) and len(copies) <= 100000 and
                 sum(m.get('bytes',0) for m in copies.values()) <= 8*1024**3, 'FORENSIC_COPY_LIMIT')
            for relative, metadata in copies.items():
                if relative.endswith('/'):
                    check = guard.directory(Path(args.snapshot)/relative, private=True)
                    os.close(check)
                else:
                    need(type(metadata.get('bytes')) is int and metadata['bytes'] >= 0, 'FORENSIC_FORMAT_INVALID')
                    need(metadata['bytes'] <= 256*1024**2, 'FORENSIC_COPY_LIMIT')
                    frozen(relative, max(metadata['bytes'],1))
            frozen(INDEX, 256*1024**2)
            with guard.opened(frozen.fd, INDEX) as index:
                with contextlib.closing(sqlite3.connect('file:/proc/self/fd/'+str(index)+'?mode=ro&immutable=1', uri=True)) as db:
                    db.execute('PRAGMA query_only=ON')
                    def frozen_reader(relative, limit): return frozen('raw/'+relative, limit)
                    expected = analyze(db, frozen_reader, args.manifest_sha256)
            frozen.revalidate()
        finally:
            frozen.close()
        if args.apply:
            need(args.root, 'LIVE_ROOT_REQUIRED')
            need(not Path(args.root).is_relative_to(Path(args.snapshot)) and
                 not Path(args.snapshot).is_relative_to(Path(args.root)), 'FORENSIC_LIVE_PATH_OVERLAP')
            identity = guard.registered_runner(args.root, None)
            guard.quiescent(args.root, None)
            live = Reader(Path(args.root)/'.asa', guard)
            try:
                with guard.opened(live.fd, 'diagnostics/private/collector.lock') as lock:
                    import fcntl
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    guard.quiescent(args.root, None)
                    # Fork only the metadata writer. Existing owner creates any WAL/SHM,
                    # not root; no shell/PAM/old application code is executed.
                    pid = os.fork()
                    if pid == 0:
                        try:
                            os.setgroups([]); os.setgid(identity['gid']); os.setuid(identity['uid']); os.umask(0o077)
                            with guard.opened(live.fd, 'diagnostics/private/index.sqlite') as fd:
                                info = os.fstat(fd)
                                need(info.st_uid == identity['uid'] and info.st_nlink == 1 and not info.st_mode & 0o022, 'INDEX_OWNER_OR_LINK_INVALID')
                                diagnostics = os.open('diagnostics', os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW, dir_fd=live.fd)
                                try:
                                    parent = os.open('private', os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW, dir_fd=diagnostics)
                                finally: os.close(diagnostics)
                                try:
                                    with contextlib.closing(SQLiteSidecars(parent, identity['uid'])) as sidecars, contextlib.closing(sqlite3.connect('file:/proc/self/fd/'+str(parent)+'/index.sqlite?mode=rw', uri=True, timeout=10)) as db:
                                        def check_index():
                                            sidecars.check()
                                            current = os.stat('index.sqlite', dir_fd=parent, follow_symlinks=False)
                                            need(stat.S_ISREG(current.st_mode) and (current.st_dev,current.st_ino) == (info.st_dev,info.st_ino), 'INDEX_REPLACED')
                                        check_index()
                                        live.before_commit = check_index
                                        apply_metadata(db, live, expected, args.manifest_sha256)
                                finally: os.close(parent)
                            os._exit(0)
                        except BaseException: os._exit(1)
                    deadline = time.monotonic()+60
                    while True:
                        done, status = os.waitpid(pid, os.WNOHANG)
                        if done: break
                        if time.monotonic() >= deadline:
                            os.kill(pid, signal.SIGKILL); os.waitpid(pid, 0)
                            raise RecoveryBlocked('METADATA_APPLY_DEADLINE')
                        time.sleep(0.1)
                    need(os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0, 'METADATA_APPLY_FAILED')
            finally: live.close()
        print(json.dumps(dict(status='METADATA_APPLIED' if args.apply else 'PLAN', files=expected['files'],
                              records=expected['records'], successors=expected['successors'], requiresFixedCollector=True,
                              historyHealthy=False, originalMappingRecovered=False)))
        return 0
    except Exception as error:
        code = str(error) if isinstance(error, RecoveryBlocked) else 'RECOVERY_FAILED'
        if 'guard' in locals() and isinstance(error, guard.Blocked) and re.fullmatch(r'[A-Z_]{1,80}', str(error)):
            code = str(error)
        print(json.dumps(dict(status='BLOCKED', code=code, historyHealthy=False)))
        return 1


if __name__ == '__main__': raise SystemExit(main())
