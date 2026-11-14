#!/usr/bin/env python3
"""Configure and reconcile an installation-owned offline school HTTPS entry.

No DNS/VPN, router, PostgreSQL volume, password, or source-code reconfiguration.
The selected physical interface is persisted once; --follow-interface explicitly
allows DHCP subnet changes on that same interface. A new interface is NEVER
trusted automatically. Commands do not download anything during reconciliation.
"""
from __future__ import annotations
import argparse
from dataclasses import asdict, dataclass
import datetime as dt
import hashlib
import importlib.util
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
import zipfile

PREFIX = Path('/opt/asa-lan-https')
CONFIG = PREFIX / 'network.json'
STATE = PREFIX / 'state.json'
UNIT_DIR = Path('/etc/systemd/system')
TIMER = 'asa-lab-network-reconcile.timer'
SERVICE = 'asa-lab-network-reconcile.service'
RFC1918 = tuple(ipaddress.IPv4Network(v) for v in
                ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'))
REJECT_PREFIXES = ('lo', 'docker', 'br-', 'veth', 'tailscale', 'tun', 'tap', 'wg')

class Refused(RuntimeError):
    pass

def need(ok, message):
    if not ok:
        raise Refused(message)

@dataclass(frozen=True)
class Endpoint:
    interface: str
    address: str
    cidr: str
    port: int = 4610

    @property
    def origin(self):
        return f'https://{self.address}:{self.port}'


def select_endpoint(records, physical, interface='auto', previous=None):
    """Pure discovery: only unique, UP, physical RFC1918 IPv4 interfaces."""
    need(interface == 'auto' or re.fullmatch(r'[A-Za-z0-9_.-]{1,15}', interface),
         'Invalid physical interface name')
    matches = []
    for record in records:
        name = record.get('ifname', '')
        if (name not in physical or name.startswith(REJECT_PREFIXES)
                or 'UP' not in record.get('flags', [])
                or record.get('operstate') not in ('UP', 'UNKNOWN')):
            continue
        if interface != 'auto' and name != interface:
            continue
        for item in record.get('addr_info', []):
            if (item.get('family') != 'inet' or item.get('scope') != 'global'
                    or item.get('tentative') or item.get('deprecated')
                    or item.get('preferred_life_time', 1) == 0):
                continue
            try:
                address = ipaddress.IPv4Address(item['local'])
                prefix = int(item['prefixlen'])
                network = ipaddress.IPv4Network(f'{address}/{prefix}', strict=False)
            except (ValueError, TypeError, KeyError):
                continue
            if not (16 <= prefix <= 30 and
                    any(address in r and network.subnet_of(r) for r in RFC1918)):
                continue
            if address in (network.network_address, network.broadcast_address):
                continue
            matches.append(Endpoint(name, str(address), str(network)))
    matches = list(dict.fromkeys(matches))
    if previous:
        same = [m for m in matches if m.address == previous and m.interface == interface]
        if len(same) == 1:
            return same[0]
    need(len(matches) == 1,
         'No unambiguous physical LAN address: select --interface explicitly; no network was changed')
    return matches[0]


def discover(interface='auto', previous=None):
    data = json.loads(call('ip', '-j', '-4', 'address', 'show'))
    physical = {p.name for p in Path('/sys/class/net').iterdir() if (p/'device').exists()}
    return select_endpoint(data, physical, interface, previous)


def call(*argv, check=True):
    result = subprocess.run([str(v) for v in argv], text=True, capture_output=True,
                            timeout=120, env=dict(os.environ, LC_ALL='C'))
    need(not check or result.returncode == 0,
         f'{argv[0]} failed ({result.returncode}); inspect service log')
    return result.stdout.strip()


def load_helper(name, filename):
    candidates = [Path(__file__).resolve().parent/filename, PREFIX/filename]
    source = next((p for p in candidates if p.is_file() and not p.is_symlink()), None)
    need(source is not None, f'Missing bundled helper: {filename}; use the same GitHub revision')
    spec = importlib.util.spec_from_file_location(name, source)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def save_json(path, value):
    need(not path.is_symlink(), 'Unsafe state path')
    temp = path.with_name(path.name+'.pending')
    need(not temp.exists(), 'An interrupted configuration write requires inspection')
    with temp.open('x', encoding='utf-8') as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    temp.replace(path)


def assert_transition(policy, endpoint):
    need(endpoint.interface == policy['interface'], 'Do not automatically trust a new interface')
    if not policy['follow_interface']:
        need(endpoint.cidr == policy['approved_cidr'],
             'Subnet changed without --follow-interface approval; select the new LAN explicitly')


def firewall(endpoint, remove=False):
    args = ['ufw']
    if remove:
        args += ['--force', 'delete']
    args += ['allow', 'in', 'on', endpoint.interface, 'from', endpoint.cidr,
             'to', endpoint.address, 'port', str(endpoint.port), 'proto', 'tcp']
    if not remove:
        args += ['comment', 'ASA school HTTPS on selected physical LAN']
    call(*args)


def verify_data_unchanged(before, after):
    """Compare actual identities of data containers, including volume names."""
    for service in ('postgres', 'minio'):
        a, b = before[service], after[service]
        need(a['id'] == b['id'] and a['mounts'] == b['mounts'],
             f'{service} container or persistent data identity unexpectedly changed')


def reconcile(policy, helper, endpoint):
    root = Path(policy['root'])
    sys.path.insert(0, str(root/'tools'))
    from deployment.system import Installation, operation_lock
    from deployment.contracts import read_env
    from deployment.releases import validate_resolved_images
    assert_transition(policy, endpoint)
    with operation_lock(root):
        state = json.loads(STATE.read_text())
        need(state.get('phase') == 'READY' and state.get('root') == str(root),
             'Unfinished ingress transaction; do not retry blindly')
        inst = Installation(root, 'production')
        baseline = inst.identity()
        release = json.loads((inst.state/'installed-release.json').read_text())
        validate_resolved_images(inst, release)
        if state['origin'] == endpoint.origin:
            # No recurring container restarts, downloads or certificate rotation.
            print('LAN_ADDRESS_UNCHANGED', endpoint.origin, flush=True)
            return False
        old = Endpoint(policy['interface'], state['origin'].split('://')[1].split(':')[0],
                       policy['current_cidr'])
        need(helper.cert_digest(helper.ROOT_CERT) == state['ca_sha256'],
             'School CA changed unexpectedly; refusing automatic trust change')
        stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        archive = PREFIX/'network-transitions'/stamp
        archive.mkdir(mode=0o700, parents=True)
        shutil.copy2(root/'.env', archive/'before.env')
        (archive/'before.env').chmod(0o600)
        shutil.copy2(PREFIX/'Caddyfile', archive/'before.Caddyfile')
        original = read_env(root/'.env')
        original_protected = {k:v for k,v in original.items() if k not in helper.PUBLIC_KEYS}
        state['phase'] = 'NETWORK_SWITCHING'
        save_json(STATE, state)
        new_rule = False
        env_switched = False
        try:
            firewall(endpoint)
            new_rule = True
            call('systemctl', 'stop', helper.SERVICE)
            (PREFIX/'Caddyfile').write_text(helper.caddy_config(endpoint.address, endpoint.port))
            helper.update_public_env(root/'.env', endpoint.origin)
            env_switched = True
            updated = read_env(root/'.env')
            need({k:v for k,v in updated.items() if k not in helper.PUBLIC_KEYS} == original_protected,
                 'Only deployment origins may change; passwords and database config must remain unchanged')
            call('systemctl', 'start', helper.SERVICE)
            after = Installation(root, 'production')
            after.identity()
            validate_resolved_images(after, release)
            after.compose('up', '-d', '--no-deps', '--no-build', '--pull', 'never',
                          'api', 'scratch', 'web')
            deadline = time.monotonic()+180
            while True:
                try:
                    helper.verify(after, release, endpoint.origin)
                    break
                except (OSError, ValueError, helper.Refused):
                    if time.monotonic() >= deadline:
                        raise
                    time.sleep(3)
            verify_data_unchanged(baseline, after.identity())
            need(helper.cert_digest(helper.ROOT_CERT) == state['ca_sha256'],
                 'IP change must not rotate the school CA')
            # Remove only the exact former ingress rule, never SSH/VPN/other entries.
            firewall(old, remove=True)
            state.update(phase='READY', origin=endpoint.origin)
            save_json(STATE, state)
            policy.update(current_address=endpoint.address, current_cidr=endpoint.cidr,
                          updated_at=dt.datetime.now(dt.timezone.utc).isoformat())
            save_json(CONFIG, policy)
            print('LAN_ADDRESS_RECONCILED', endpoint.origin,
                  'DATABASE_VOLUMES_AND_CA_PRESERVED', flush=True)
            return True
        except BaseException:
            call('systemctl', 'stop', helper.SERVICE, check=False)
            shutil.copy2(archive/'before.Caddyfile', PREFIX/'Caddyfile')
            if env_switched:
                source = archive/'before.env'
                shutil.copy2(source, root/'.env')
                stat = source.stat()
                os.chown(root/'.env', stat.st_uid, stat.st_gid)
                reverted = Installation(root, 'production')
                reverted.compose('up', '-d', '--no-deps', '--no-build', '--pull', 'never',
                                 'api', 'scratch', 'web')
            call('systemctl', 'start', helper.SERVICE, check=False)
            if new_rule:
                firewall(endpoint, remove=True)
            state['phase'] = 'NETWORK_ROLLBACK_REVIEW'
            save_json(STATE, state)
            raise


def timer_units():
    service = f'''[Unit]
Description=Reconcile selected school LAN address without Internet
After=network-online.target docker.service
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 {PREFIX}/school-lan.py reconcile
TimeoutStartSec=600
UMask=0077
'''
    timer = '''[Unit]
Description=Watch the approved school LAN interface for DHCP changes
[Timer]
OnBootSec=45s
OnUnitInactiveSec=30s
AccuracySec=5s
[Install]
WantedBy=timers.target
'''
    return service, timer


def install_timer():
    for name, content in zip((SERVICE,TIMER), timer_units()):
        p = UNIT_DIR/name
        need(not p.exists() or p.read_text() == content,
             'Do not overwrite an unrelated network watcher unit')
        p.write_text(content)
        p.chmod(0o644)
    call('systemctl','daemon-reload')
    call('systemctl','enable','--now',TIMER)


def export_client_kit(root, helper, endpoint):
    """Public CA + clickable Windows setup; never any password or private key."""
    script = PREFIX/'trust-school-server.ps1'
    need(script.is_file(), 'Bundled Windows client setup script missing')
    cert = ssl.PEM_cert_to_DER_cert(helper.ROOT_CERT.read_text(encoding='ascii'))
    fingerprint = hashlib.sha256(cert).hexdigest()
    manifest = dict(schema=1, origin=endpoint.origin, ca_sha256=fingerprint,
                    entry_path='/#/home', requires_operator_distribution=True)
    destination = root/'.asa/school-client-setup.zip'
    staged = destination.with_suffix('.zip.pending')
    need(not staged.exists(), 'An interrupted client-kit write exists')
    with zipfile.ZipFile(staged,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('asa-school-root.cer',cert)
        z.writestr('school-server.json',json.dumps(manifest,indent=2)+'\n')
        z.writestr('trust-school-server.ps1',script.read_text(encoding='utf-8-sig'))
        z.writestr('Start-ASALab.cmd','@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0trust-school-server.ps1" -BundlePath "%~dp0."\r\npause\r\n')
        z.writestr('README.txt',
            'ASA Lab: local school client setup.\n'
            'Receive this ZIP from your school administrator through a trusted channel.\n'
            'Extract ALL files and open Start-ASALab.cmd. No SSH or server password needed.\n'
            'Setup asks before trusting the PUBLIC school CA for the current Windows user.\n'
            'This does not alter DNS, VPN, firewall, or system-wide trust.\n'
            'Compare the displayed SHA256 with your administrator.\n'
            'The same CA continues to work after a server IP change; only the URL changes.\n'
            'Do not distribute private server keys. Domain-managed PCs can receive the\n'
            'included public certificate through the school management policy.\n'
            f'CA SHA256: {fingerprint}\nCurrent address: {endpoint.origin}/#/home\n')
    staged.chmod(0o600)
    stat = root.stat()
    os.chown(staged, stat.st_uid, stat.st_gid)
    staged.replace(destination)
    print('CLIENT_KIT',str(destination),'PUBLIC_CA_SHA256',fingerprint,flush=True)


def configure(args):
    need(args.root is not None, '--root is required for initial network selection')
    root = args.root.resolve()
    need(root.is_dir() and not root.is_symlink(), 'Existing canonical ASA directory required')
    # Reuse the previously approved physical interface; an added VPN/NIC must
    # not force another manual choice or silently become the school entry.
    previous = json.loads(CONFIG.read_text()) if CONFIG.exists() else None
    selected_interface = (previous['interface'] if previous and args.interface == 'auto'
                          else args.interface)
    endpoint = discover(selected_interface, previous['current_address'] if previous else None)
    helper = load_helper('asa_https','lan-https-entry.py')
    helper.validate_lan(endpoint.address, endpoint.cidr, endpoint.interface, endpoint.port)
    policy = dict(schema=1, root=str(root), interface=endpoint.interface,
                  approved_cidr=endpoint.cidr, follow_interface=args.follow_interface,
                  current_address=endpoint.address, current_cidr=endpoint.cidr)
    if CONFIG.exists():
        previous = json.loads(CONFIG.read_text())
        need(previous['root'] == str(root) and previous['interface'] == endpoint.interface,
             'Another installation/interface already owns the network watcher')
        need(not args.follow_interface or previous['follow_interface'],
             'Cannot widen an existing DHCP follow policy without an explicit migration')
        # No flag on a routine repeat means keep the persisted approval.
        policy = previous
    if not STATE.exists():
        preview = load_helper('asa_preview','lan-preview-ubuntu.py')
        preview.install(root,endpoint.address,endpoint.cidr,endpoint.interface,True)
        helper.run(argparse.Namespace(action='apply',root=root,hostname=socket.gethostname(),
                                      ip=endpoint.address,cidr=endpoint.cidr,
                                      interface=endpoint.interface,port=4610))
    else:
        current = json.loads(STATE.read_text())
        need(current.get('root') == str(root), 'Wrong installed HTTPS root')
        if not CONFIG.exists():
            need(current.get('origin') == endpoint.origin and current.get('phase') == 'READY',
                 'Existing HTTPS entry differs; inspect before adopting it')
    PREFIX.mkdir(mode=0o755,exist_ok=True)
    here = Path(__file__).resolve().parent
    for filename in ('school-lan.py','lan-https-entry.py','lan-preview-ubuntu.py','trust-school-server.ps1'):
        src = here/filename
        need(src.is_file() and not src.is_symlink(), f'Missing same-revision file: {filename}')
        dest = PREFIX/filename
        if src.resolve() != dest.resolve():
            shutil.copyfile(src,dest)
            dest.chmod(0o644)
    if not CONFIG.exists():
        save_json(CONFIG,policy)
    reconcile(policy,helper,endpoint)
    # Full one-time validation; the idle timer does not query user data or restart services.
    sys.path.insert(0,str(root/'tools'))
    from deployment.system import Installation
    inst=Installation(root,'production')
    release=json.loads((inst.state/'installed-release.json').read_text())
    helper.verify(inst,release,endpoint.origin)
    export_client_kit(root,helper,endpoint)
    install_timer()
    print('SCHOOL_LAN_READY',endpoint.origin,'OFFLINE_RECONCILE_ENABLED',flush=True)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('action',choices=('configure','reconcile','status'))
    p.add_argument('--root',type=Path)
    p.add_argument('--interface',default='auto')
    p.add_argument('--follow-interface',action='store_true',
                   help='Approve automatic RFC1918 subnet changes on the selected physical interface')
    args=p.parse_args()
    try:
        need(sys.platform=='linux' and os.geteuid()==0,'Run on Ubuntu as root')
        if args.action=='configure':
            configure(args)
        else:
            need(CONFIG.is_file(),'No persisted school LAN configuration')
            policy=json.loads(CONFIG.read_text())
            endpoint=discover(policy['interface'],policy['current_address'])
            assert_transition(policy,endpoint)
            if args.action=='status':
                print(json.dumps(dict(endpoint=asdict(endpoint),origin=endpoint.origin,
                                      follow_interface=policy['follow_interface']),indent=2))
            else:
                helper=load_helper('asa_https','lan-https-entry.py')
                changed=reconcile(policy,helper,endpoint)
                if changed:
                    export_client_kit(Path(policy['root']),helper,endpoint)
        return 0
    except Exception as exc:
        print('SCHOOL_LAN_BLOCKED',type(exc).__name__,str(exc),file=sys.stderr)
        return 2

if __name__=='__main__':
    raise SystemExit(main())
