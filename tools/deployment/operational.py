"""Closed operational receipts and read-only provider samples. No application data writes."""
from contextlib import contextmanager
import argparse
import datetime as dt
import hashlib
import http.client
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import stat
import sys
import threading
import time
from urllib.parse import urlsplit

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment.paths import plain_paths

MAX_EVENT_BYTES = 2048
SEGMENT_BYTES = 10 * 1024**2
SEGMENTS = 5
READ_BATCH = 1024**2
HTTP_BYTES = 256 * 1024
HTTP_SECONDS = 3
PROVIDERS = {'ollama': ('/api/ps', '/api/tags'), 'comfyui': ('/system_stats',)}
STATUSES = ('succeeded', 'failed', 'retry_required', 'started')
UTC = dt.timezone.utc


def stamp():
    return dt.datetime.now(UTC).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def checked_time(value):
    if not isinstance(value, str) or len(value) > 40:
        raise ValueError('invalid operational timestamp')
    try:
        parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None or not 1970 <= parsed.year <= 2100 or parsed > dt.datetime.now(UTC) + dt.timedelta(minutes=5):
            raise ValueError()
    except (ValueError, OverflowError):
        raise ValueError('invalid operational timestamp') from None
    return parsed.astimezone(UTC).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def number(value, maximum=2**60):
    return type(value) is int and 0 <= value <= maximum


def operation(value):
    if not isinstance(value, dict) or value.get('version') != 1 or type(value.get('version')) is not int:
        raise ValueError('unsupported operational event')
    for key, allowed in (('operation', ('updates', 'backup')), ('status', STATUSES),
                         ('producer', ('manager', 'source-updater', 'backup-receipt')),
                         ('trigger', ('manual', 'automatic', 'unknown'))):
        if value.get(key) not in allowed:
            raise ValueError('invalid operational enum')
    result = {key: value[key] for key in ('version', 'operation', 'status', 'producer', 'trigger')}
    result['at'] = checked_time(value.get('at'))
    for key, length in (('revision', 40), ('previousRevision', 40), ('archiveSha256', 64), ('manifestSha256', 64)):
        item = value.get(key)
        if isinstance(item, str) and re.fullmatch('[a-f0-9]{' + str(length) + '}', item): result[key] = item
    for key, high in (('schema', 99999), ('archiveBytes', 2**60), ('verifiedPayloadBytes', 2**60), ('durationMs', 9007199254740991)):
        if number(value.get(key), high): result[key] = value[key]
    if value.get('phase') in ('backup', 'build', 'switch', 'verify_entry', 'completed', 'prerequisite'):
        result['phase'] = value['phase']
    if value.get('verification') == 'cloud_sha256': result['verification'] = 'cloud_sha256'
    return result


def from_source_receipt(raw, trigger='unknown'):
    if len(raw) > 64 * 1024: raise ValueError('source receipt exceeds bound')
    fields = {}
    for line in raw.decode('utf-8-sig').splitlines():
        key, separator, value = line.partition('=')
        if not separator or key in fields: raise ValueError('invalid source receipt')
        fields[key] = value
    statuses = {'success': 'succeeded', 'failed_after_backup': 'failed', 'retry_with_updated_updater': 'retry_required'}
    if fields.get('status') not in statuses: raise ValueError('unsupported source receipt status')
    for key, width in (('previous_revision',40), ('deployed_revision' if fields['status']=='success' else 'attempted_revision',40), ('backup_sha256',64)):
        if not re.fullmatch('[a-f0-9]{'+str(width)+'}', fields.get(key,'')): raise ValueError('incomplete typed source receipt')
    if fields['status']=='success' and (not re.fullmatch('[0-9]{1,5}',fields.get('schema_version','')) or int(fields['schema_version'])<1): raise ValueError('source receipt lacks verified schema')
    try: at = dt.datetime.strptime(fields['updated_at_utc'], '%Y%m%dT%H%M%SZ').replace(tzinfo=UTC).isoformat()
    except (KeyError, ValueError): raise ValueError('invalid source receipt time') from None
    return operation({'version': 1, 'operation': 'updates', 'producer': 'source-updater',
        'status': statuses[fields['status']], 'trigger': trigger, 'at': at,
        'revision': fields.get('deployed_revision', fields.get('attempted_revision')),
        'previousRevision': fields.get('previous_revision'), 'archiveSha256': fields.get('backup_sha256'),
        'schema': int(fields['schema_version']) if re.fullmatch('[0-9]{1,5}', fields.get('schema_version', '')) else None})


def from_manager_receipt(value):
    if not isinstance(value, dict) or value.get('status') not in ('success', 'failed_switch'):
        raise ValueError('unsupported manager receipt')
    selected = value.get('selected') if isinstance(value.get('selected'), dict) else {}
    before = value.get('previous') if isinstance(value.get('previous'), dict) else {}
    if not isinstance(selected.get('revision'),str) or not re.fullmatch('[a-f0-9]{40}',selected['revision']) or not str(selected.get('schema','')).isdigit() or not 1 <= int(selected['schema']) <= 99999:
        raise ValueError('manager receipt lacks a typed selected release')
    return operation({'version': 1, 'operation': 'updates', 'producer': 'manager', 'at': value.get('at'),
        'status': 'succeeded' if value['status'] == 'success' else 'failed',
        'trigger': value.get('trigger', 'unknown'), 'phase': value.get('phase'),
        'revision': selected.get('revision'), 'previousRevision': before.get('revision'),
        'schema': int(selected['schema']) if str(selected.get('schema', '')).isdigit() else None})


def from_backup_receipt(value):
    if not isinstance(value, dict): raise ValueError('invalid verified backup receipt')
    # Existing school producer is immutable here. Its verified-cloud status is a
    # closed legacy envelope, not permission to read its remote/archive fields.
    legacy = 'format' not in value and value.get('status') == 'verified_cloud_sha256'
    if legacy:
        if value.get('project') != 'asa-lab-school' or value.get('trigger') not in ('scheduled', 'manual'):
            raise ValueError('invalid school backup receipt')
        safe = {'format':'asa-backup-success-v1', 'status':'succeeded', 'completedAt':value.get('createdAt'),
                'archiveSha256':value.get('sha256'), 'archiveBytes':value.get('size'),
                'trigger':'automatic' if value['trigger'] == 'scheduled' else 'manual'}
    else: safe = value
    if safe.get('format') != 'asa-backup-success-v1' or safe.get('status') != 'succeeded' or not number(safe.get('archiveBytes')) or safe['archiveBytes'] == 0 or not isinstance(safe.get('archiveSha256'), str) or not re.fullmatch('[a-f0-9]{64}', safe['archiveSha256']):
        raise ValueError('invalid verified backup receipt')
    return operation({'version': 1, 'operation': 'backup', 'producer': 'backup-receipt', 'status': 'succeeded',
        'at': safe.get('completedAt'), 'trigger': safe.get('trigger'), 'archiveBytes': safe['archiveBytes'], 'archiveSha256': safe['archiveSha256'],
        **({'verification':'cloud_sha256'} if legacy else {})})


def private_file(path, *, root_owned=False):
    path = Path(path)
    if not path.is_absolute(): raise ValueError('operational input must be absolute')
    plain_paths(path.parent, (path.name,))
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 64 * 1024:
        raise ValueError('invalid bounded operational input')
    if root_owned:
        if os.name == 'nt': raise ValueError('configured remote sources require root-controlled Linux input')
        for node in (path, *path.parents):
            metadata = node.stat()
            if metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) & 0o022:
                raise ValueError('operational configuration/input must be root controlled')
        if stat.S_IMODE(info.st_mode) & 0o077:
            raise ValueError('operational input must be private')
    return path.read_bytes()


@contextmanager
def operation_lock(root):
    root = Path(root)
    names = ['.asa/operations/events.lock', *['.asa/operations/events.jsonl' + ('.' + str(i) if i else '') for i in range(SEGMENTS)]]
    plain_paths(root, names)
    directory = root / '.asa/operations'
    for node in (root/'.asa', directory):
        if not node.exists():
            node.mkdir(mode=0o700)
            if os.name != 'nt':
                parent_fd = os.open(node.parent, os.O_RDONLY | os.O_DIRECTORY)
                try: os.fsync(parent_fd)
                finally: os.close(parent_fd)
    for node in (directory, *[root/name for name in names]):
        if node.exists():
            metadata = node.stat()
            if node == directory:
                if not stat.S_ISDIR(metadata.st_mode): raise ValueError('invalid operational directory')
            elif not stat.S_ISREG(metadata.st_mode) or metadata.st_size > (1 if node.name=='events.lock' else SEGMENT_BYTES): raise ValueError('invalid bounded operational file')
            if os.name != 'nt' and (metadata.st_uid != os.geteuid() or stat.S_IMODE(metadata.st_mode) & 0o077): raise ValueError('operational journal must be private and operator owned')
    fd = os.open(directory/'events.lock', os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    with os.fdopen(fd, 'r+b') as stream:
        if not stream.read(1): stream.write(b'0'); stream.flush()
        if os.name == 'nt':
            import msvcrt
            stream.seek(0); msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
        try: yield directory
        finally:
            if os.name == 'nt': stream.seek(0); msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else: fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def append_operation(root, value):
    event = operation(value)
    raw = (json.dumps(event, sort_keys=True, separators=(',', ':')) + '\n').encode()
    if len(raw) > MAX_EVENT_BYTES: raise ValueError('operational event exceeds bound')
    with operation_lock(root) as directory:
        current = directory/'events.jsonl'
        if current.exists() and current.stat().st_size + len(raw) > SEGMENT_BYTES:
            for i in range(SEGMENTS - 1, 0, -1):
                before = directory/('events.jsonl' + ('.' + str(i-1) if i > 1 else ''))
                after = directory/('events.jsonl.' + str(i))
                if i == SEGMENTS - 1: after.unlink(missing_ok=True)
                if before.exists(): os.replace(before, after)
        fd = os.open(current, os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
        with os.fdopen(fd, 'ab') as stream:
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        if os.name != 'nt':
            directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
            try: os.fsync(directory_fd)
            finally: os.close(directory_fd)
    return event


def append_safely(root, value):
    try: append_operation(root, value)
    except (OSError, ValueError):
        print('OPERATION_DIAGNOSTICS_FAILED: original operation receipt remains authoritative', file=sys.stderr)
        return False
    return True


def origin(value):
    if not isinstance(value, str) or len(value) > 200 or any(c.isspace() for c in value): raise ValueError('invalid provider origin')
    try:
        url = urlsplit(value)
        address = ipaddress.ip_address(url.hostname or '')
        private = address.is_loopback or any(address in ipaddress.ip_network(network) for network in (('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16') if address.version == 4 else ('fc00::/7',)))
        if url.scheme not in ('http', 'https') or not private or address.is_link_local or address.is_multicast or address.is_unspecified or url.username is not None or url.password is not None or url.path not in ('', '/') or url.query or url.fragment or not 1 <= (url.port or (443 if url.scheme == 'https' else 80)) <= 65535:
            raise ValueError()
    except (ValueError, TypeError): raise ValueError('provider requires one explicit private numeric HTTP(S) origin without credentials/path/query') from None
    return url.scheme, str(address), url.port or (443 if url.scheme == 'https' else 80)


def configuration(config, path=None):
    value = config.get('operationalSources', {})
    if not isinstance(value, dict) or set(value) - {'version', 'providers', 'backupSuccessReceipt', 'providerIntervalSeconds', 'updateMaxAgeSeconds', 'backupMaxAgeSeconds'} or type(value.get('version', 1)) is not int or value.get('version', 1) != 1:
        raise ValueError('unsupported operational sources configuration')
    providers = value.get('providers', {})
    if not isinstance(providers, dict) or set(providers) - set(PROVIDERS): raise ValueError('unsupported provider sources')
    for name, item in providers.items():
        if not isinstance(item, dict) or set(item) != {'origin'}: raise ValueError('provider source requires an origin only')
        origin(item['origin'])
    for key, low, high in (('providerIntervalSeconds', 10, 300), ('updateMaxAgeSeconds', 3600, 31*86400), ('backupMaxAgeSeconds', 3600, 7*86400)):
        if key in value and (type(value[key]) is not int or not low <= value[key] <= high): raise ValueError('operational source interval outside bound')
    if 'backupSuccessReceipt' in value:
        name = value['backupSuccessReceipt']
        if not isinstance(name,str) or len(name)>4096 or any(ord(c)<32 for c in name) or not Path(name).is_absolute() or '..' in Path(name).parts: raise ValueError('backup receipt must name one bounded absolute private file')
    if path is not None and (providers or value.get('backupSuccessReceipt')): private_file(path, root_owned=True)
    return value


def fetch_json(target, path):
    scheme, host, port = origin(target)
    connection = (http.client.HTTPSConnection if scheme == 'https' else http.client.HTTPConnection)(host, port, timeout=HTTP_SECONDS)
    deadline = time.monotonic() + HTTP_SECONDS
    timer = None
    try:
        connection.connect()  # Numeric address, direct connection, no proxy/DNS lookup.
        protected_socket = connection.sock
        def abort():
            # HTTPConnection may detach its socket after Connection: close;
            # the response still owns a file reference during a slow body.
            try: protected_socket.shutdown(socket.SHUT_RDWR)
            except (OSError, AttributeError): pass
        timer = threading.Timer(max(0.001, deadline-time.monotonic()), abort)
        timer.daemon = True; timer.start()
        connection.request('GET', path, headers={'Accept': 'application/json'})
        response = connection.getresponse()
        if response.status != 200: raise ValueError('provider HTTP unavailable; redirects are never followed')
        declared = response.getheader('Content-Length')
        if declared is not None and (not declared.isdigit() or int(declared) > HTTP_BYTES): raise ValueError('provider body exceeds bound')
        data = bytearray()
        while True:
            if time.monotonic() >= deadline: raise TimeoutError('provider deadline')
            chunk = response.read1(min(65536, HTTP_BYTES + 1 - len(data)))
            if not chunk: break
            data.extend(chunk)
            if len(data) > HTTP_BYTES: raise ValueError('provider body exceeds bound')
        if time.monotonic() >= deadline: raise TimeoutError('provider deadline')
        value = json.loads(data)
        if not isinstance(value, dict): raise ValueError('provider JSON must be an object')
        return value
    except (OSError, http.client.HTTPException):
        if time.monotonic() >= deadline: raise TimeoutError('provider deadline') from None
        raise
    finally:
        if timer: timer.cancel()
        connection.close()


def provider_sample(name, values):
    result = {'availability': 'reachable'}
    if name == 'ollama':
        loaded, catalog = values
        for data in (loaded, catalog):
            if not isinstance(data.get('models'), list) or len(data['models']) > 256 or not all(isinstance(m, dict) for m in data['models']): raise ValueError('invalid bounded model inventory')
        result.update(loadedModels=len(loaded['models']), availableModels=len(catalog['models']))
        for source, key in (('size', 'modelBytes'), ('size_vram', 'vramBytes')):
            if all(isinstance(m, dict) and number(m.get(source)) for m in loaded['models']):
                result[key] = sum(m[source] for m in loaded['models'])
                if not number(result[key]): raise ValueError('provider aggregate exceeds bound')
    else:
        data = values[0]
        system, devices = data.get('system'), data.get('devices')
        if not isinstance(system, dict) or not isinstance(devices, list) or len(devices) > 8: raise ValueError('invalid GPU health schema')
        for source, key in (('ram_total', 'ramTotalBytes'), ('ram_free', 'ramFreeBytes')):
            if not number(system.get(source)): raise ValueError('invalid provider RAM counters')
            result[key] = system[source]
        if result['ramFreeBytes'] > result['ramTotalBytes']: raise ValueError('invalid provider RAM counters')
        result['devices'] = []
        for device in devices:
            if not isinstance(device, dict): raise ValueError('invalid GPU device')
            projected = {}
            if device.get('type') not in ('cuda', 'cpu', 'mps', 'xpu'): raise ValueError('invalid GPU type')
            projected['type'] = device['type']
            for key in ('index', 'vram_total', 'vram_free', 'torch_vram_total', 'torch_vram_free'):
                if number(device.get(key), 31 if key == 'index' else 2**60): projected[key] = device[key]
            if projected['type'] == 'cuda' and not {'index','vram_total','vram_free'} <= set(projected): raise ValueError('invalid GPU counters')
            if projected.get('vram_free', 0) > projected.get('vram_total', 0): raise ValueError('invalid GPU counters')
            result['devices'].append(projected)
    return result


def collect(collector, normalize):
    config = configuration(collector.config, collector.root/'.asa/log-collector.json')
    operational_events(collector, normalize, config)
    backup_event(collector, normalize, config)
    provider_events(collector, normalize, config)


def observe_operation(c, normalize, event):
    event = operation(event)
    key = 'operations:last:' + event['operation']
    previous = c.state(key)
    if previous is None or event['at'] >= previous['at']: c.set_state(key, event)
    encoded = json.dumps(event, sort_keys=True, separators=(',', ':'))
    payload = {**event, 'level': 'error' if event['status'] == 'failed' else 'warn' if event['status'] != 'succeeded' else 'info'}
    c.add(normalize(event['operation'], json.dumps(payload), event['at'], 'operation:' + encoded, 'operational-receipt-v1'))


def backup_event(c, normalize, config):
    if not config.get('backupSuccessReceipt'): return
    try:
        event = from_backup_receipt(json.loads(private_file(Path(config['backupSuccessReceipt']), root_owned=True)))
        observe_operation(c, normalize, event)
        latest = c.state('operations:last:backup')
        age = time.time()-dt.datetime.fromisoformat(latest['at'].replace('Z','+00:00')).timestamp()
        state = 'error' if latest['status'] == 'failed' else 'pending' if age > config.get('backupMaxAgeSeconds',36*3600) else 'ok'
        c.status('operations:backup', state, 'Verified external backup success receipt; remote archive was not fetched')
    except (OSError, ValueError, TypeError, KeyError):
        c.status('operations:backup', 'error', 'Configured backup receipt invalid/unreadable; input details omitted')


def operational_events(c, normalize, config):
    cursors, active, pending = c.state('operations:cursors', {}), {}, False
    paths = [c.root/'.asa/operations'/('events.jsonl' + ('.' + str(i) if i else '')) for i in range(SEGMENTS)]
    events = []
    try:
        # Preserve legacy receipts too; only the closed typed projection escapes.
        manager = c.root/'.asa/last-operation.json'
        if manager.exists(): events.append(from_manager_receipt(json.loads(private_file(manager.absolute()))))
        for receipt in sorted((c.root/'backups').glob('update-*.receipt.txt'))[-64:]:
            events.append(from_source_receipt(private_file(receipt.absolute())))
        for path in paths:
            plain_paths(path.parent, (path.name,))
            if not path.exists(): continue
            info = path.stat()
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > SEGMENT_BYTES: raise ValueError('invalid operational journal')
            identity = f'{info.st_dev}:{info.st_ino}'
            offset = cursors.get(identity, 0)
            if type(offset) is not int or not 0 <= offset <= info.st_size: raise ValueError('invalid journal cursor')
            with path.open('rb') as stream:
                stream.seek(offset); raw = stream.read(READ_BATCH)
            consumed = raw.rfind(b'\n') + 1
            if raw and not consumed and len(raw) >= MAX_EVENT_BYTES: raise ValueError('invalid operational journal line')
            for line in raw[:consumed].splitlines():
                if len(line) > MAX_EVENT_BYTES: raise ValueError('operational line exceeds bound')
                events.append(operation(json.loads(line)))
            active[identity] = offset + consumed
            if active[identity] < info.st_size: pending = True
        for event in events: observe_operation(c, normalize, event)
        c.set_state('operations:cursors', active)
        for name, age in (('updates', config.get('updateMaxAgeSeconds', 7*86400)), ('backup', config.get('backupMaxAgeSeconds', 36*3600))):
            latest = c.state('operations:last:' + name)
            state = 'pending' if pending or latest is None else 'error' if latest['status'] == 'failed' else 'pending' if latest['status'] != 'succeeded' or time.time()-dt.datetime.fromisoformat(latest['at'].replace('Z','+00:00')).timestamp() > age else 'ok'
            c.status('operations:' + name, state, 'No verified operation receipt yet' if latest is None else 'Operational receipt backlog' if pending else 'Observed typed operation outcome')
    except (OSError, ValueError, TypeError, KeyError):
        c.status('operations:updates', 'error', 'Operational input invalid/unreadable; no raw fields persisted')
        c.status('operations:backup', 'error', 'Operational journal invalid/unreadable')


def provider_events(c, normalize, config):
    for name, item in config.get('providers', {}).items():
        source, key = 'provider:' + name, 'provider:last:' + name
        last = c.state(key, {})
        interval = config.get('providerIntervalSeconds', 60)
        if last and time.time()-last.get('checked', 0) < interval: continue
        at = stamp()
        started = time.monotonic()
        try:
            sample = provider_sample(name, [fetch_json(item['origin'], p) for p in PROVIDERS[name]])
            elapsed = round((time.monotonic()-started)*1000)
            c.add(normalize('metrics', json.dumps({'kind': 'provider_health', 'healthService': name, 'sampleDurationMs': elapsed, **sample}), at, source + ':' + at, source))
            c.status(source, 'ok', 'Read-only bounded provider health sample', at)
            c.set_state(key, {'checked': time.time(), 'state': 'ok'})
        except (OSError, ValueError, TypeError, KeyError, RecursionError, http.client.HTTPException) as error:
            reason = 'timeout' if isinstance(error,TimeoutError) else 'connection_failed' if isinstance(error,OSError) else 'invalid_sample'
            c.add(normalize('metrics', json.dumps({'kind': 'provider_health', 'healthService': name, 'availability': 'unavailable', 'healthFailure': reason, 'sampleDurationMs': round((time.monotonic()-started)*1000), 'level': 'error'}), at, source + ':' + at, source))
            c.status(source, 'error', 'Read-only provider health unavailable: ' + reason + '; remote details omitted')
            c.set_state(key, {'checked': time.time(), 'state': 'error'})


def required_sources(config, database_sources, platform):
    rows = {}
    def add(name, through=False, applicable=True):
        rows[name] = {'source': name, 'applicable': applicable, 'maxAgeSeconds': 300, 'requireThrough': through}
        if not applicable: rows[name]['reason'] = 'other-platform'
    for name in ('docker','database-events','metrics','docker-lifecycle','operations:updates','operations:backup'): add(name, name in ('metrics','docker-lifecycle'))
    for name in ('api','web','scratch','postgres','minio'): add(name + ':recent', True)
    for name in database_sources: add('database-events:' + name, True)
    add('linux:journal', True, platform == 'linux')
    for name in ('windows','windows:System','windows:Application','windows:Security'): add(name, name != 'windows', platform == 'windows')
    for item in config.get('fileSources', []): add(item['source'])
    settings = configuration(config)
    for name in settings.get('providers', {}): add('provider:' + name)
    return {'version': 1, 'policy': 'asa-connected-v1', 'platform': platform,
            'auditMaxAgeSeconds': 900, 'sources': [rows[k] for k in sorted(rows)]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('source-update',))
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--receipt', type=Path, required=True)
    parser.add_argument('--trigger', choices=('manual','automatic','unknown'), default='unknown')
    args = parser.parse_args(argv)
    try:
        append_operation(args.root, from_source_receipt(private_file(args.receipt.absolute()), args.trigger))
        return 0
    except (OSError, ValueError, TypeError, KeyError):
        print('OPERATION_DIAGNOSTICS_FAILED: invalid/unreadable receipt or journal; private details omitted', file=sys.stderr)
        return 2


if __name__ == '__main__': raise SystemExit(main())
