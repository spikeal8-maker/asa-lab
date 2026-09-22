#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
profile=${ASA_COMPOSE_PROFILE:-production}
operator=${SUDO_USER:-$(id -un)}
python=$(command -v python3)
[ "$(id -u)" = 0 ] || { echo 'Install the systemd service with sudo; the operator must have Docker access.' >&2; exit 78; }
# Configure as the Docker operator so private settings never become root-owned.
runuser -u "$operator" -- "$python" "$root/tools/asa_manager.py" configure --profile "$profile" --enable-auto-update
"$python" - "$root" "$operator" "$python" <<'PY'
import json
from pathlib import Path
import re
import sys
root, user, python = sys.argv[1:]
if not re.fullmatch(r'[a-z_][a-z0-9_-]*\$?', user):
    raise SystemExit('Invalid service user')
def quote(value):
    if '\n' in value or '\r' in value:
        raise SystemExit('Newlines are forbidden in installation paths')
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'
project = json.loads((Path(root) / '.asa/installation.json').read_text())['project']
if not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', project):
    raise SystemExit('Invalid project')
name = 'asa-lab-update-' + project
units = Path('/etc/systemd/system')
(units / (name + '.service')).write_text(
    '[Unit]\nDescription=ASA Lab maintenance window check\nAfter=docker.service network-online.target\n'
    '[Service]\nType=oneshot\nUser=' + user + '\nWorkingDirectory=' + quote(root) + '\n'
    'ExecStart=' + quote(python) + ' ' + quote(str(Path(root) / 'tools/maintenance_runner.py')) + '\n'
    'TimeoutStartSec=infinity\nUMask=0077\n')
(units / (name + '.timer')).write_text(
    '[Unit]\nDescription=ASA Lab weekly maintenance\n[Timer]\n'
    'OnCalendar=Sun *-*-* 00,01:00/15:00 UTC\nPersistent=false\n'
    'AccuracySec=30s\n[Install]\nWantedBy=timers.target\n')
print('Installed timer ' + name + '.timer')
PY
project=$("$python" -c 'import json,sys; print(json.load(open(sys.argv[1]))["project"])' "$root/.asa/installation.json")
systemctl daemon-reload
systemctl enable --now "asa-lab-update-$project.timer"
