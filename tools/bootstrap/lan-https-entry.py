#!/usr/bin/env python3
"""Upgrade the selected ASA LAN entry to HTTPS without touching persistent data.

The local CA is installation-owned. Distribute only root.crt to authorized
clients through an authenticated channel and explicitly trust it there.
Never disable certificate verification, CSRF, bot checks or Secure cookies.
"""
from __future__ import annotations
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import socket
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request

SERVICE = 'asa-lab-lan-https.service'
PREFIX = Path('/opt/asa-lan-https')
DATA = Path('/var/lib/asa-lan-https')
ROOT_CERT = DATA / 'caddy/pki/authorities/local/root.crt'
OLD_SOCKET = 'asa-lab-lan-4610.socket'
OLD_SERVICE = 'asa-lab-lan-4610.service'
PUBLIC_KEYS = ('ASA_PUBLIC_WEB_ORIGINS', 'ASA_BLOCKS_PARENT_ORIGIN',
               'ASA_BLOCKS_RUNTIME_ORIGIN', 'ASA_UPDATE_ENTRY_ORIGIN')

class Refused(RuntimeError):
    pass

def need(ok, message):
    if not ok:
        raise Refused(message)

def call(*args, env=None, check=True):
    p = subprocess.run([str(a) for a in args], text=True, capture_output=True,
                       env=env, timeout=120)
    if check and p.returncode:
        raise Refused(f'{args[0]} failed ({p.returncode}): {p.stderr[-450:]}')
    return p.stdout.strip()

def validate_lan(ip, cidr, interface, port):
    addr = ipaddress.IPv4Address(ip)
    net = ipaddress.IPv4Network(cidr, strict=True)
    ranges = [ipaddress.IPv4Network(n) for n in
              ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')]
    need(any(addr in r and net.subnet_of(r) for r in ranges), 'RFC1918 LAN required')
    need(net.prefixlen >= 16 and addr in net, 'LAN subnet must be no broader than /16')
    need(bool(re.fullmatch(r'[a-zA-Z0-9_.-]{1,15}', interface)), 'Invalid interface')
    need(not interface.startswith(('lo', 'docker', 'br-', 'veth', 'tail', 'tun', 'wg')),
         'Select the physical LAN interface')
    need(port == 4610, 'Preserve the explicitly selected ASA Web port 4610')
    return f'https://{addr}:{port}'

def caddy_config(ip, port):
    return f'''{{
    admin off
    auto_https disable_redirects
    skip_install_trust
    servers {{
        protocols h1 h2
        listener_wrappers {{
            http_redirect
            tls
        }}
    }}
}}
https://{ip}:{port} {{
    bind {ip}
    tls internal
    reverse_proxy 127.0.0.1:4610
}}
'''

def service_config():
    return f'''[Unit]
Description=ASA Lab local HTTPS entry, no VPN or public ingress
Wants=network-online.target
After=network-online.target docker.service
[Service]
ExecStart={PREFIX}/caddy run --config {PREFIX}/Caddyfile --adapter caddyfile
DynamicUser=yes
StateDirectory=asa-lan-https
StateDirectoryMode=0700
Environment=XDG_DATA_HOME={DATA}
Environment=XDG_CONFIG_HOME={DATA}
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=
Restart=on-failure
RestartSec=3s
[Install]
WantedBy=multi-user.target
'''

def save_json(path, data):
    temporary = path.with_suffix('.new')
    need(not temporary.is_symlink(), 'Unsafe checkpoint path')
    temporary.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
    temporary.chmod(0o600)
    temporary.replace(path)

def update_public_env(path, origin):
    lines = path.read_text(encoding='utf-8').splitlines(keepends=True)
    seen = set()
    result = []
    for line in lines:
        key = line.partition('=')[0]
        if key in PUBLIC_KEYS:
            need(key not in seen, 'Duplicate origin configuration')
            seen.add(key)
            result.append(f'{key}={origin}\n')
        else:
            result.append(line)
    for key in PUBLIC_KEYS:
        if key not in seen:
            result.append(f'{key}={origin}\n')
    out = path.with_name('.env.https-pending')
    need(not out.exists(), 'An incomplete configuration switch exists')
    stat = path.stat()
    with out.open('x', encoding='utf-8') as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(''.join(result))
    os.chown(out, stat.st_uid, stat.st_gid)
    out.replace(path)

def cert_digest(path):
    der = ssl.PEM_cert_to_DER_cert(path.read_text(encoding='ascii'))
    return hashlib.sha256(der).hexdigest()

def request(origin, path, context, method='GET', headers=None, body=None):
    req = urllib.request.Request(origin + path, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, context=context, timeout=8) as response:
            return response.status, response.read().decode('utf-8')
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode('utf-8')

def verify(inst, release, origin):
    need(ROOT_CERT.is_file(), 'Local CA certificate has not been generated')
    context = ssl.create_default_context(cafile=str(ROOT_CERT))
    inst.wait_ready(release['revision'], release['schema'])
    status, body = request(origin, '/health/ready', context)
    info = json.loads(body)
    need(status == 200 and info.get('status') == 'ready', 'HTTPS backend not ready')
    need(info['deployment']['revision'] == release['revision'], 'Wrong deployed release')
    _, runtime = request(origin, '/runtime-config.js', context)
    _, editor = request(origin, '/internal/blocks/', context)
    need(origin in runtime and f'content="{origin}"' in editor,
         'Portal/editor origins are not aligned')
    status, body = request(origin, '/api/auth/login', context, method='POST',
                           headers={'Origin': origin, 'Sec-Fetch-Site': 'same-origin',
                                    'Content-Type': 'application/json'}, body=b'{}')
    need(status == 403 and json.loads(body)['error']['code'] == 'bot_check_required',
         'Login does not reach its legitimate bot check through HTTPS')
    status, body = request(origin, '/api/auth/login', context, method='POST',
                           headers={'Origin': 'https://untrusted.example.invalid',
                                    'Sec-Fetch-Site': 'cross-site',
                                    'Content-Type': 'application/json'}, body=b'{}')
    need(status == 403 and json.loads(body)['error']['code'] == 'origin_forbidden',
         'Untrusted browser origin must remain blocked')
    print('LOCAL_HTTPS_LOGIN_ORIGIN_PASS', origin, flush=True)
    print('CLIENT_CA_SHA256', cert_digest(ROOT_CERT), flush=True)
    print('CLIENT_CA_PATH', ROOT_CERT, flush=True)

def run(args):
    origin = validate_lan(args.ip, args.cidr, args.interface, args.port)
    need(sys.platform == 'linux' and os.geteuid() == 0, 'Run on Ubuntu with sudo')
    need(socket.gethostname() == args.hostname, 'Target hostname differs')
    need(args.hostname != 'leticia', 'Protected unrelated server')
    root = args.root.resolve()
    need((root / '.asa/installation.json').is_file(), 'Use the existing ASA installation')
    sys.path.insert(0, str(root / 'tools'))
    from deployment.system import Installation, operation_lock
    from deployment.releases import validate_resolved_images
    from deployment.contracts import read_env
    inst = Installation(root, 'production')
    identity = inst.identity()
    release = json.loads((inst.state / 'installed-release.json').read_text())
    validate_resolved_images(inst, release)
    need(inst.settings.get('profile') == 'production', 'Production installation required')
    need(inst.env.get('ASA_WEB_PORT', '4610') == '4610', 'Wrong local backend port')
    addresses = call('ip', '-4', '-o', 'addr', 'show', 'dev', args.interface)
    need(any(line.split()[3].split('/')[0] == args.ip for line in addresses.splitlines()),
         'Selected IP does not belong to the physical interface')
    state_file = PREFIX / 'state.json'
    if args.action == 'verify':
        need(state_file.is_file(), 'No HTTPS deployment checkpoint')
        state = json.loads(state_file.read_text())
        need(state.get('origin') == origin and state.get('root') == str(root),
             'Selected HTTPS identity differs from checkpoint')
        verify(inst, release, origin)
        return
    if state_file.exists():
        state = json.loads(state_file.read_text())
        need(state.get('phase') == 'READY' and state.get('origin') == origin,
             'Existing HTTPS operation needs manual inspection, not blind retry')
        verify(inst, release, origin)
        return
    old_socket_file = Path('/etc/systemd/system') / OLD_SOCKET
    old_service_file = Path('/etc/systemd/system') / OLD_SERVICE
    need(old_socket_file.is_file() and old_service_file.is_file(),
         'The existing managed LAN preview must be identified first')
    need(f'ListenStream={args.ip}:4610' in old_socket_file.read_text()
         and 'systemd-socket-proxyd 127.0.0.1:4610' in old_service_file.read_text(),
         'Refusing to replace an unrelated LAN listener')
    firewall = call('ufw', 'status', 'verbose', env=dict(os.environ, LC_ALL='C'))
    need('Status: active' in firewall and 'deny (incoming)' in firewall,
         'UFW must deny inbound connections by default')
    need(f'{args.ip} 4610/tcp on {args.interface}' in firewall and args.cidr in firewall,
         'LAN-specific Web firewall rule is missing; do not widen access automatically')
    need(not PREFIX.exists() and not (Path('/etc/systemd/system')/SERVICE).exists(),
         'Existing unmanaged HTTPS files detected')
    modules = call('docker', 'exec', f'{inst.project}-web-1', 'caddy', 'list-modules')
    need('caddy.listeners.http_redirect' in modules and 'tls.issuance.internal' in modules,
         'Pinned Web image lacks required Caddy modules')
    print('LOCAL_HTTPS_PREFLIGHT_PASS', origin, 'DATABASE_UNCHANGED', flush=True)
    if args.action == 'plan':
        return
    with operation_lock(root):
        PREFIX.mkdir(mode=0o700)
        backup = PREFIX / 'original.env'
        shutil.copy2(root/'.env', backup)
        backup.chmod(0o600)
        original = read_env(root/'.env')
        baseline = {k: v for k, v in original.items() if k not in PUBLIC_KEYS}
        call('docker', 'cp', f'{inst.project}-web-1:/usr/bin/caddy', PREFIX/'caddy')
        (PREFIX/'caddy').chmod(0o755)
        # Executable/config are public, while rollback env and state stay private.
        PREFIX.chmod(0o755)
        (PREFIX/'Caddyfile').write_text(caddy_config(args.ip,args.port),encoding='utf-8')
        (PREFIX/'Caddyfile').chmod(0o644)
        call(PREFIX/'caddy', 'adapt', '--config', PREFIX/'Caddyfile', '--adapter', 'caddyfile')
        unit = Path('/etc/systemd/system')/SERVICE
        unit.write_text(service_config(),encoding='utf-8'); unit.chmod(0o644)
        state = dict(schema=1, phase='PREPARED', origin=origin, root=str(root),
                     revision=release['revision'], backend='http://127.0.0.1:4610',
                     caddy_sha256=hashlib.sha256((PREFIX/'caddy').read_bytes()).hexdigest())
        save_json(state_file,state)
        switched_env = False
        try:
            call('systemctl','daemon-reload')
            call('systemctl','disable','--now',OLD_SOCKET)
            call('systemctl','stop',OLD_SERVICE,check=False)
            call('systemctl','enable','--now',SERVICE)
            for _ in range(30):
                if ROOT_CERT.is_file():
                    break
                time.sleep(1)
            need(ROOT_CERT.is_file(),'HTTPS service did not generate its local CA')
            update_public_env(root/'.env',origin)
            switched_env = True
            changed = read_env(root/'.env')
            need({k:v for k,v in changed.items() if k not in PUBLIC_KEYS} == baseline,
                 'Unexpected private setting changed')
            after = Installation(root,'production')
            after.identity(); validate_resolved_images(after,release)
            state['phase']='SWITCHING_WEB_API_SCRATCH'; save_json(state_file,state)
            after.compose('up','-d','--no-deps','--no-build','api','scratch','web')
            verify(after,release,origin)
            state.update(phase='READY',ca_sha256=cert_digest(ROOT_CERT))
            save_json(state_file,state)
            print('LOCAL_HTTPS_INSTALLED_PRESERVING_RESTORED_DATA',flush=True)
        except BaseException:
            print('LOCAL_HTTPS_FAILED_REVERTING_INGRESS_ONLY',flush=True)
            call('systemctl','disable','--now',SERVICE,check=False)
            if switched_env:
                shutil.copy2(backup,root/'.env')
                original_stat=backup.stat()
                os.chown(root/'.env',original_stat.st_uid,original_stat.st_gid)
                reverted=Installation(root,'production')
                reverted.compose('up','-d','--no-deps','--no-build','api','scratch','web')
                reverted.wait_ready(release['revision'],release['schema'])
            call('systemctl','enable','--now',OLD_SOCKET)
            state['phase']='ROLLED_BACK';save_json(state_file,state)
            raise

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('action',choices=('plan','apply','verify'))
    p.add_argument('--root',type=Path,required=True)
    p.add_argument('--hostname',required=True)
    p.add_argument('--ip',required=True)
    p.add_argument('--cidr',required=True)
    p.add_argument('--interface',required=True)
    p.add_argument('--port',type=int,default=4610)
    a=p.parse_args()
    try:
        run(a);return 0
    except Exception as exc:
        print('LOCAL_HTTPS_BLOCKED',type(exc).__name__,str(exc),file=sys.stderr)
        return 2
if __name__=='__main__':
    raise SystemExit(main())
