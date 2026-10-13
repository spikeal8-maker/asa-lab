"""Cleanup for the explicitly disposable delivery CI installation only."""

import hashlib
import os
from pathlib import Path

from .collector import verify_systemd_unit, verify_systemd_state
from .contracts import require
from .system import run


def cleanup_collector(root, operator, python):
    require(os.environ.get('GITHUB_ACTIONS') == 'true' and root.name.startswith('asa-delivery-') and
            root.stat().st_uid == os.getuid(), 'COLLECTOR_CLEANUP', 'Cleanup requires the owned disposable CI root.')
    name = 'asa-log-collector-asa-lab-ci-delivery.service'
    path = Path('/etc/systemd/system') / name
    if not path.exists(): return
    require(path.is_file() and not path.is_symlink() and path.stat().st_uid == 0 and path.stat().st_nlink == 1,
            'COLLECTOR_CLEANUP', 'Refusing to change an unowned CI runner unit.')
    identity = dict(root=str(root), owner=operator, mode='system', name=name)
    data = path.read_bytes()
    verify_systemd_unit(data.decode('utf-8'), identity, python)
    state = verify_systemd_state(identity, path, python, owned_unloaded=True)
    # A proven never-loaded partial file has no process to stop. Loaded units
    # still need complete effective owner/argv/drop-in verification above.
    if state['LoadState'] == 'loaded':
        run(['sudo', '-n', 'systemctl', 'stop', name])
    run(['sudo', '-n', 'systemctl', 'disable', name])
    # Recheck the exact verified inode content immediately before root unlink;
    # never delete another unit or recursively change any host directory.
    script = ('import hashlib,sys; from pathlib import Path; p=Path(sys.argv[1]); '
              's=p.lstat(); assert not p.is_symlink() and s.st_uid==0 and s.st_nlink==1; '
              'assert hashlib.sha256(p.read_bytes()).hexdigest()==sys.argv[2]; p.unlink()')
    run(['sudo', '-n', python, '-c', script, str(path), hashlib.sha256(data).hexdigest()])
    run(['sudo', '-n', 'systemctl', 'daemon-reload'])


def finish_cleanup(actions, primary_error):
    """Try each owned cleanup step, then preserve the original failure."""
    failures = []
    for action in actions:
        try: action()
        except Exception as exc:
            failures.append(exc)
            # No raw exception/output: even cleanup diagnostics may be foreign.
            print(f'CI_CLEANUP failed: code={getattr(exc, "code", "CLEANUP_ERROR")}')
    if failures and primary_error is None: raise failures[0]
