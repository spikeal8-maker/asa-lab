"""Read-only Docker/LAN overlap diagnostic; never changes networks or routes."""

import argparse
import ipaddress
import json
import subprocess


def collisions(networks, targets):
    targets = [ipaddress.ip_network(value, strict=False) for value in targets]
    found = []
    for network in networks:
        for config in network.get('IPAM', {}).get('Config') or []:
            if not config.get('Subnet'):
                continue
            subnet = ipaddress.ip_network(config['Subnet'], strict=False)
            for target in targets:
                if subnet.version == target.version and subnet.overlaps(target):
                    found.append({'network': network['Name'], 'subnet': str(subnet),
                                  'target': str(target)})
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', action='append', required=True,
                        help='LAN/VPN subnet or provider IP; repeat for each destination')
    args = parser.parse_args()
    ids = subprocess.check_output(['docker', 'network', 'ls', '-q'], text=True).split()
    networks = json.loads(subprocess.check_output(
        ['docker', 'network', 'inspect', *ids], text=True)) if ids else []
    found = collisions(networks, args.target)
    print(json.dumps({'status': 'BLOCKED' if found else 'NO_OVERLAP',
                      'collisions': found}, indent=2))
    return 2 if found else 0


if __name__ == '__main__':
    raise SystemExit(main())
