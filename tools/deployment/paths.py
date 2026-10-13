"""Reject redirected diagnostic paths, including Windows Python 3.11 junctions."""

import os
import json
from pathlib import Path
import stat
import tempfile


def plain_paths(root, names):
    """Inspect lexical ancestors with lstat before any mkdir/chmod/publication.

    All Windows reparse points are refused, not only symlinks/junction tags.
    Missing paths may be created later; unreadable paths fail closed.
    """
    root = Path(root)
    if '..' in root.parts:
        raise ValueError('Diagnostic paths must not contain parent traversal')
    root = Path(os.path.abspath(root))
    paths = list(reversed(root.parents)) + [root]
    for name in names:
        parts = Path(name).parts
        if Path(name).is_absolute() or '..' in parts:
            raise ValueError('Diagnostic child paths must remain inside the root')
        paths.extend(root / Path(*parts[:i]) for i in range(1, len(parts) + 1))
    for path in dict.fromkeys(paths):
        try:
            info = path.lstat()
        except FileNotFoundError:
            continue
        attributes = getattr(info, 'st_file_attributes', None)
        if os.name == 'nt' and attributes is None:
            raise ValueError('Cannot verify Windows diagnostic path attributes')
        if stat.S_ISLNK(info.st_mode) or (attributes or 0) & 0x400:  # FILE_ATTRIBUTE_REPARSE_POINT
            raise ValueError('Diagnostic paths must not be symlinks or reparse points')
        if stat.S_ISREG(info.st_mode) and info.st_nlink > 1:
            raise ValueError('Diagnostic configuration paths must not be multiply linked')


def atomic_bytes(path, data, mode=0o640):
    """Publish by replacing an entry; never truncate a pre-existing temp/link."""
    path = Path(path)
    plain_paths(path.parent, ())
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(prefix='.' + path.name + '.', suffix='.tmp', dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, 'wb') as stream:
            if os.name != 'nt': os.fchmod(stream.fileno(), mode)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def atomic_json(path, value):
    # Match the manager JSON envelope without changing its unrelated writer.
    atomic_bytes(path, (json.dumps(value, ensure_ascii=True, indent=2) + '\n').encode('utf-8'), mode=0o600)
