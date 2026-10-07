#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
collector_user=${SUDO_USER:-$(id -un)}
python_bin=$(command -v python3)
[ -f "$root/.asa/installation.json" ] || { echo 'Use the canonical ASA installation.' >&2; exit 1; }
mkdir -p "$root/.asa/diagnostics/store"
mkdir -p "$root/.asa/diagnostics/private"
chown "$collector_user" "$root/.asa/diagnostics" "$root/.asa/diagnostics/private"
chmod 700 "$root/.asa/diagnostics/private"
chown "$collector_user":1000 "$root/.asa/diagnostics/store"
chmod 2750 "$root/.asa/diagnostics/store"
cat > /etc/systemd/system/asa-log-collector.service <<EOF
[Unit]
Description=ASA Lab diagnostic collector
After=docker.service
[Service]
User=$collector_user
WorkingDirectory="$root"
ExecStart="$python_bin" "$root/tools/collect_logs.py" --root "$root"
Restart=always
RestartSec=20
NoNewPrivileges=true
UMask=0077
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now asa-log-collector.service
