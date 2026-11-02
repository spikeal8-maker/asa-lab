"""Current reviewed production image pins, separate from historical CI transport receipts."""
import argparse
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / 'infra/security-runtime-images.json'


def runtime_defaults(document=None):
    value = document if document is not None else json.loads(BASELINE.read_text(encoding='utf-8'))
    if value.get('format') != 'asa-security-runtime-images-v1' or set(value.get('images', {})) != {'node', 'caddy', 'postgres'}:
        raise ValueError('Invalid security runtime image baseline')
    patterns = {'node': r'node:22\.[0-9]+\.[0-9]+-bookworm-slim',
                'caddy': r'caddy:2\.[0-9]+\.[0-9]+-alpine',
                'postgres': r'postgres:17\.[0-9]+-bookworm'}
    result = {}
    for name, pattern in patterns.items():
        image = value['images'][name]
        reference = image.get('reference', '')
        if not re.fullmatch(pattern + r'@sha256:[a-f0-9]{64}', reference):
            raise ValueError('Expected immutable supported-major official image: ' + name)
        if not re.fullmatch(r'sha256:[a-f0-9]{64}', image.get('linuxAmd64Manifest', '')):
            raise ValueError('Missing primary-registry amd64 manifest: ' + name)
        result[name] = reference
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--image', choices=['node', 'caddy', 'postgres'])
    args = p.parse_args()
    values = runtime_defaults()
    print(values[args.image] if args.image else json.dumps(values))
