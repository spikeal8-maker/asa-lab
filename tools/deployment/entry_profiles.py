"""Owner-selected public entry profiles, separate from account/database content."""

import ipaddress
import json
import os
from pathlib import Path
import re
import tempfile
import uuid
from urllib.parse import urlsplit

from .contracts import exact_origin, read_env, require


def entry_environment_matches(install):
    """A saved opt-in choice must be applied even when the release SHA is unchanged."""
    if install.env.get('ASA_BLOCKS_SAME_ORIGIN') != 'true':
        return True  # preserve the legacy no-change path
    keys = {
        'api': ('ASA_BLOCKS_SAME_ORIGIN', 'ASA_PUBLIC_WEB_ORIGINS',
                'ASA_PUBLIC_WEB_ORIGIN_PATTERNS', 'ASA_BLOCKS_RUNTIME_ORIGIN'),
        'web': ('ASA_BLOCKS_RUNTIME_ORIGIN',),
        'scratch': ('ASA_BLOCKS_PARENT_ORIGIN',),
    }
    records = install.identity()
    for service, names in keys.items():
        if service not in records:
            return False
        actual = install.container_environment(records[service])
        if any(actual.get(key, '') != install.env.get(key, '') for key in names):
            return False
    return True


def https_origin(value):
    exact_origin(value)
    parsed = urlsplit(value)
    require(parsed.scheme == 'https' and parsed.netloc == parsed.netloc.lower()
            and parsed.port != 443, 'ENTRY_PROFILE', 'Use canonical HTTPS origins (omit default port443).')
    require(parsed.hostname != 'localhost', 'ENTRY_PROFILE', 'Public entry cannot be localhost.')
    try:
        require(not ipaddress.ip_address(parsed.hostname).is_loopback, 'ENTRY_PROFILE', 'Public entry cannot be loopback.')
    except ValueError:
        require(bool(re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', parsed.hostname)),
                'ENTRY_PROFILE', 'Invalid public DNS name.')
    return value


def entry_profile(root, name, primary, existing):
    require(name == 'asa-owned', 'ENTRY_PROFILE', 'Unknown entry profile.')
    path = Path(root) / 'deployment' / 'entry-profiles' / f'{name}.json'
    profile = json.loads(path.read_text(encoding='utf-8'))
    require(set(profile) == {'schemaVersion', 'id', 'httpsOrigins', 'httpsSubdomainZones'}
            and profile['schemaVersion'] == 1 and profile['id'] == name,
            'ENTRY_PROFILE', 'Unsupported entry profile schema.')
    origins = [https_origin(value) for value in profile['httpsOrigins']]
    zones = profile['httpsSubdomainZones']
    pattern = r'https://\*\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}'
    require(isinstance(zones, list) and len(zones) <= 8
            and all(isinstance(zone, str) and re.fullmatch(pattern, zone) for zone in zones),
            'ENTRY_PROFILE', 'Invalid delegated HTTPS zones.')
    https_origin(primary)
    host = urlsplit(primary).hostname
    require(primary in origins or (urlsplit(primary).port is None and any(
        host.endswith(zone.removeprefix('https://*')) for zone in zones)),
        'ENTRY_PROFILE', 'Primary entry is outside the selected profile.')
    # Preserve explicit custom aliases; never erase a site's existing choices.
    old_origins = [https_origin(value.strip()) for value in existing.get('ASA_PUBLIC_WEB_ORIGINS', '').split(',') if value.strip()]
    old_zones = [value.strip() for value in existing.get('ASA_PUBLIC_WEB_ORIGIN_PATTERNS', '').split(',') if value.strip()]
    require(all(re.fullmatch(pattern, zone) for zone in old_zones), 'ENTRY_PROFILE', 'Invalid existing delegated zone.')
    origins = list(dict.fromkeys([*old_origins, *origins, primary]))
    zones = list(dict.fromkeys([*old_zones, *zones]))
    require(len(origins) <= 8 and len(zones) <= 8, 'ENTRY_PROFILE', 'Combined entries exceed API bounds; review aliases explicitly.')
    return {
        'ASA_ENTRY_PROFILE': name, 'ASA_ENTRY_PROFILE_SCHEMA': '1',
        'ASA_PUBLIC_WEB_ORIGINS': ','.join(origins),
        'ASA_PUBLIC_WEB_ORIGIN_PATTERNS': ','.join(zones),
        'ASA_BLOCKS_SAME_ORIGIN': 'true',
        # Retain the primary origin for older image metadata and updater checks.
        'ASA_UPDATE_ENTRY_ORIGIN': primary,
        'ASA_BLOCKS_PARENT_ORIGIN': primary,
        'ASA_BLOCKS_RUNTIME_ORIGIN': primary,
    }


def configure_entry(root, name, primary, *, apply=False):
    root = Path(root)
    path = root / '.env'
    require(path.is_file() and not path.is_symlink(), 'ENTRY_PROFILE', 'An existing regular private .env is required.')
    original = path.read_bytes()
    existing = read_env(path)
    selected = entry_profile(root, name, primary, existing)
    print('ENTRY_PROFILE ' + json.dumps(selected, sort_keys=True))  # only public configuration
    if not apply:
        print('PLAN_ONLY: no file, container, DNS or certificate changes')
        return selected
    lines = original.decode('utf-8-sig').splitlines()
    lines = [line for line in lines if line.partition('=')[0].strip() not in selected]
    updated = ('\n'.join(lines) + '\n' + ''.join(f'{key}={value}\n' for key, value in selected.items())).encode('utf-8')
    if all(existing.get(key) == value for key, value in selected.items()):
        print('NO_CHANGE: selected public entry configuration already saved')
        return selected
    # Same-directory atomic replacement; original private bytes retained for rollback.
    descriptor, temporary = tempfile.mkstemp(prefix='.env-entry-', dir=root)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            if hasattr(os, 'fchown'):
                original_stat = path.stat()
                os.fchown(stream.fileno(), original_stat.st_uid, original_stat.st_gid)
            stream.write(updated)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, path.stat().st_mode & 0o777)
        require(path.read_bytes() == original, 'ENTRY_PROFILE', 'Private configuration changed concurrently; retry after inspection.')
        backup = root / '.asa' / 'private-entry-backups'
        backup.mkdir(parents=True, mode=0o700, exist_ok=True)
        backup_path = backup / f'{uuid.uuid4().hex}.env'
        with os.fdopen(os.open(backup_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as stream:
            stream.write(original)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print('SAVED: public entry settings only; containers unchanged; private rollback copy under .asa/private-entry-backups')
    return selected
