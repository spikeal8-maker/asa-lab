#!/usr/bin/env python3
"""Verify an encrypted ASA Lab backup stored in a synced Yandex Disk directory.

Reads the age identity only on this workstation. By default does NOT extract
sensitive data. --extract explicitly writes a fresh private backup directory;
never runs SQL or changes the active ASA Lab installation.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile

AGE_DEFAULT = Path('F:/ASA-recovery/age.exe')
IDENTITY_DEFAULT = Path('F:/ASA-recovery/asa-cloud-age-identity.txt')
SNAPSHOT = re.compile(r'^asa-lab-(\d{8}T\d{6}Z)-([0-9a-f]{8})\.tar\.age$')
MAX_FILE_BYTES = 20 * 1024**3
MAX_ARCHIVE_BYTES = 50 * 1024**3


def yandex_sync_directory() -> Path:
    if sys.platform != 'win32':
        raise ValueError('Automatic Yandex Disk discovery needs Windows; specify --archive')
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Yandex\Yandex.Disk.4') as key:
        folder, _ = winreg.QueryValueEx(key, 'CurrentUserSyncPath')
    return Path(folder) / 'ASA-Backups'


def find_latest(folder: Path) -> Path:
    if not folder.is_dir():
        raise FileNotFoundError(f'Synced backup folder not found: {folder}')
    archives = [file for file in folder.iterdir() if file.is_file() and SNAPSHOT.fullmatch(file.name)]
    if not archives:
        raise FileNotFoundError(f'No encrypted ASA backups in {folder}')
    return sorted(archives, key=lambda p: (SNAPSHOT.fullmatch(p.name).group(1), p.name))[-1]


def host_path(path: Path) -> Path:
    """Use Win32 extended-length paths for deeply nested MinIO objects.

    This affects local filesystem operations only. Neither archive paths nor
    destination roots are taken from the extended-path namespace directly.
    """
    if sys.platform != 'win32':
        return path
    native = str(path)
    if native.startswith('\\\\?\\'):
        return path
    if native.startswith('\\\\'):
        return Path('\\\\?\\UNC\\' + native[2:])
    return Path('\\\\?\\' + native)


def safe_destination(root: Path, member: tarfile.TarInfo) -> Path:
    """Extract the archive's ONE wrapper directory into the selected backup root.

    Archive member `snapshot/manifest.json` must become `root/manifest.json`,
    because verify_backup() and restore-verified-backup.py consume exactly root.
    Keeping the wrapper makes a verified encrypted archive unusable for restore.
    """
    name = member.name.replace('\\', '/')
    if member.isdir():
        name = name.rstrip('/')
    parts = name.split('/')
    if (not name or name.startswith('/') or any(x in ('', '.', '..') for x in parts)
            or ':' in name or member.issym() or member.islnk() or member.isdev()
            or not (member.isfile() or member.isdir())):
        raise ValueError('Unsafe archive path or file type')
    base = root.resolve()
    if len(parts) == 1:
        if not member.isdir():
            raise ValueError('Archive files require exactly one common directory wrapper')
        candidate = base
    else:
        # Every component is validated above; no need to resolve this deep
        # path before creation (Win32 otherwise rejects paths over MAX_PATH).
        candidate = base.joinpath(*parts[1:])
    if not candidate.is_relative_to(base):
        raise ValueError('Archive entry escapes destination')
    return host_path(candidate)


def verify_or_extract(args) -> dict:
    source = args.archive or find_latest(args.yandex_folder or yandex_sync_directory())
    source = source.resolve()
    if not source.is_file() or not args.age.is_file() or not args.identity.is_file():
        raise FileNotFoundError('Archive, age binary or private identity file is absent')
    if not SNAPSHOT.fullmatch(source.name):
        raise ValueError('Unexpected archive filename; expected asa-lab-YYYYMMDDTHHMMSSZ-xxxxxxxx.tar.age')

    root = None
    if args.extract:
        root = (args.output or (Path.home() / 'Downloads' / f'ASA-Restore-{source.stem.removesuffix(".tar")}')).resolve()
        if root.exists():
            raise FileExistsError('Destination exists; refusing to mix recovery sets')
        # Never put decrypted files into a recognized cloud sync tree, even
        # when --archive names a specific file instead of using discovery.
        # Offline archives in /srv/asa-restore may legitimately extract into a
        # sibling folder; being near the source is not by itself unsafe.
        cloud_root = args.yandex_folder.resolve().parent if args.yandex_folder else None
        if cloud_root is None and sys.platform == 'win32':
            try:
                cloud_root = yandex_sync_directory().resolve().parent
            except (OSError, ValueError):
                # A standalone archive may not be in a configured sync tree.
                pass
        if cloud_root is None and source.parent.name.casefold() == 'asa-backups':
            cloud_root = source.parent
        if cloud_root and root.is_relative_to(cloud_root):
            raise ValueError('Decrypted data must not be placed in Yandex Disk')
        if shutil.disk_usage(root.parent if root.parent.exists() else Path.home()).free < max(source.stat().st_size * 2, 512 * 1024**2):
            raise ValueError('Insufficient disk space for extracted backup')
        root.mkdir(parents=True, mode=0o700)

    process = subprocess.Popen([str(args.age), '-d', '-i', str(args.identity), str(source)],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=1024 * 1024)
    digests = {}
    count = 0
    total = 0
    manifest = None
    archive_prefix = None
    try:
        with tarfile.open(fileobj=process.stdout, mode='r|*') as stream:
            for member in stream:
                count += 1
                if count > 1_000_000 or member.size > MAX_FILE_BYTES:
                    raise ValueError('Archive exceeds size or entry limits')
                # The source must be one self-contained backup, never mixed roots.
                prefix = member.name.replace('\\', '/').split('/')[0]
                if archive_prefix is None:
                    archive_prefix = prefix
                elif prefix != archive_prefix:
                    raise ValueError('Archive mixes multiple top-level backup roots')
                # Use synthetic destination for verify-only mode to validate every path.
                target = safe_destination(root or Path.home(), member)
                if member.isdir():
                    if root:
                        target.mkdir(parents=True, mode=0o700, exist_ok=True)
                    continue
                total += member.size
                if total > MAX_ARCHIVE_BYTES:
                    raise ValueError('Uncompressed archive exceeds safety limit')
                relative = '/'.join(member.name.replace('\\', '/').split('/')[1:])
                if relative in digests:
                    raise ValueError('Duplicate archive file: ' + relative)
                sha = hashlib.sha256()
                captured = bytearray() if relative == 'manifest.json' and member.size < 1024 * 1024 else None
                output = None
                try:
                    if root:
                        target.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
                        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                        output = os.fdopen(fd, 'wb')
                    entry = stream.extractfile(member)
                    if entry is None:
                        raise ValueError('Cannot read archive member')
                    while chunk := entry.read(1024 * 1024):
                        sha.update(chunk)
                        if output:
                            output.write(chunk)
                        if captured is not None:
                            captured.extend(chunk)
                finally:
                    if output:
                        output.close()
                digests[relative] = (sha.hexdigest(), member.size)
                if captured is not None:
                    manifest = json.loads(captured)
        process.stdout.close()
        if process.wait(timeout=90) != 0:
            raise ValueError('Age archive decryption or authentication failed')
        if not isinstance(manifest, dict) or manifest.get('format') != 'asa-backup-v1' or manifest.get('complete') is not True:
            raise ValueError('Backup manifest is missing or incomplete')
        expected = manifest.get('files')
        if 'manifest.json' not in digests:
            raise ValueError('Backup manifest must be directly inside its archive wrapper')
        if not isinstance(expected, dict) or not expected:
            raise ValueError('Backup inventory is absent')
        for rel, meta in expected.items():
            if rel not in digests or not isinstance(meta, dict):
                raise ValueError(f'Missing or malformed manifest entry: {rel}')
            actual_hash, actual_size = digests[rel]
            if meta.get('sha256') != actual_hash or meta.get('bytes') != actual_size:
                raise ValueError(f'Backup checksum or size mismatch: {rel}')
        if len(digests) != len(expected) + 1:  # plus manifest.json itself
            raise ValueError('Unexpected file inventory membership')
        result = {'archive': source.name, 'snapshot': manifest.get('createdAt'),
                  'schema': (manifest.get('runtime') or {}).get('schema'),
                  'files_verified': len(expected), 'total_entries': count, 'extracted': bool(root)}
        print('VERIFIED ' + json.dumps(result, ensure_ascii=False))
        if root:
            print(f'EXTRACTED_TO {root} (contains private credentials; do not synchronize)')
        return result
    except BaseException:
        if process.poll() is None:
            process.kill()
        if process.stdout:
            process.stdout.close()
        process.wait(timeout=10)
        if root and root.exists():
            shutil.rmtree(host_path(root))
        raise


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--archive', type=Path, help='Specific .tar.age; default: newest in synced Yandex Disk')
    p.add_argument('--yandex-folder', type=Path, help='Override ASA-Backups synced folder')
    p.add_argument('--age', type=Path, default=AGE_DEFAULT)
    p.add_argument('--identity', type=Path, default=IDENTITY_DEFAULT)
    p.add_argument('--extract', action='store_true', help='Explicitly write decrypted private data to a new folder')
    p.add_argument('--output', type=Path)
    a = p.parse_args()
    if a.output and not a.extract:
        p.error('--output requires --extract')
    try:
        verify_or_extract(a)
        return 0
    except (OSError, ValueError, tarfile.TarError, json.JSONDecodeError) as exc:
        print(f'BLOCKED: {exc}', file=sys.stderr)
        return 2

if __name__ == '__main__':
    sys.exit(main())