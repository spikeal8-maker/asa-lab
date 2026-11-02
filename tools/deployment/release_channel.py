"""Publication remains v2 until a separate accepted manager bridge activation."""
import json
from pathlib import Path
from .contracts import SERVICES, require

POLICY = Path(__file__).resolve().parents[2] / 'infra/deployment/release-channel.json'


def publication_channel(document=None):
    policy = document if document is not None else json.loads(POLICY.read_text(encoding='utf-8'))
    require(policy == {'format': 'asa-release-channel-v1', 'manifestFormat': 'asa-deployment-v2',
                       'v3Activation': 'blocked_until_installed_bridge_acceptance'},
            'MANAGER_BRIDGE', 'v3 publication requires a separately accepted installed-manager bridge.',
            'Publish and install the v2 bridge first; do not flip the channel or bypass validation.')
    return policy['manifestFormat'], SERVICES
