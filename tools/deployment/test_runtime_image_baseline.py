"""Offline guards for the reviewed runtime image refresh; no Docker/network."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
from runtime_image_baseline import BASELINE, runtime_defaults


class RuntimeImageBaselineTests(unittest.TestCase):
    def test_security_ci_builds_the_same_head_sha_it_labels_and_reports(self):
        workflow = (ROOT / '.github/workflows/runtime-image-security.yml').read_text()
        revision = '${{ github.event.pull_request.head.sha || github.sha }}'
        self.assertIn('ref: ' + revision, workflow)
        self.assertIn('REVISION: ' + revision, workflow)
        self.assertIn('runtime-security-${{ matrix.service }}-' + revision, workflow)

    def test_unused_runtime_packaging_tools_are_removed_but_worker_is_tested(self):
        source = (ROOT / 'Dockerfile.api').read_text()
        workspace, runtime = source.split('FROM ${NODE_IMAGE} AS runtime', 1)
        self.assertIn('corepack prepare pnpm@9.15.9', workspace)
        self.assertIn('rm -rf /usr/local/lib/node_modules/npm', runtime)
        self.assertIn('rm -f /usr/local/bin/npm /usr/local/bin/npx', runtime)
        self.assertIn('/opt/asa-document-python/bin/pip uninstall -y setuptools', runtime)
        self.assertLess(runtime.index('pip uninstall -y setuptools'), runtime.index('/tmp/asa-documents/tools/test_ai_document_reader.py &&'))
        workflow = (ROOT / '.github/workflows/runtime-image-security.yml').read_text()
        self.assertIn('! command -v npm && ! command -v npx', workflow)
        self.assertIn("importlib.util.find_spec('setuptools') is None", workflow)

    def test_docker_defaults_match_reviewed_immutable_images(self):
        defaults = runtime_defaults()
        for filename in ['Dockerfile.api', 'Dockerfile.web']:
            source = (ROOT / filename).read_text(encoding='utf-8')
            self.assertIn('ARG NODE_IMAGE=' + defaults['node'] + '\n', source)
        self.assertIn('ARG CADDY_IMAGE=' + defaults['caddy'] + '\n', (ROOT / 'Dockerfile.web').read_text())
        self.assertIn('ARG POSTGRES_IMAGE=' + defaults['postgres'] + '\n', (ROOT / 'infra/postgres/Dockerfile').read_text())
        self.assertIn('image: ${ASA_POSTGRES_IMAGE:-asa-lab-postgres:${ASA_IMAGE_TAG:-local}}', (ROOT / 'compose.yaml').read_text())

    def test_rebuilt_go_tools_use_pinned_sources_and_compiler(self):
        inputs = json.loads(BASELINE.read_text())['buildInputs']
        for path, tool in [('Dockerfile.web', 'caddy'), ('infra/postgres/Dockerfile', 'gosu')]:
            source = (ROOT / path).read_text()
            self.assertIn('FROM ' + inputs['goImage'] + ' AS security-' + tool, source)
            self.assertRegex(inputs['goImage'], r'^golang:1\.27\.3-bookworm@sha256:[a-f0-9]{64}$')
            self.assertIn('ADD --checksum=sha256:' + inputs[tool]['sha256'] + ' ' + inputs[tool]['url'], source)
            self.assertIn('GOTOOLCHAIN=local CGO_ENABLED=0', source)
            self.assertIn('go build -mod=readonly', source)
        web = (ROOT / 'Dockerfile.web').read_text()
        self.assertIn('github.com/go-jose/go-jose/v4@' + inputs['caddy']['goJose'], web)
        self.assertIn('golang.org/x/net@' + inputs['caddy']['xNet'], web)
        workflow = (ROOT / '.github/workflows/runtime-image-security.yml').read_text()
        self.assertIn('ci_postgres_security_smoke.py asa-security:postgres', workflow)
        self.assertIn('-f infra/postgres/Dockerfile', workflow)
        self.assertIn('branches: [main]', workflow)

    def test_mutable_or_major_upgrades_are_rejected(self):
        original = json.loads(BASELINE.read_text())
        for image, replacement in [('node', 'node:latest'), ('node', original['images']['node']['reference'].replace(':22.', ':24.')), ('postgres', original['images']['postgres']['reference'].replace(':17.', ':18.'))]:
            changed = deepcopy(original)
            changed['images'][image]['reference'] = replacement
            with self.assertRaises(ValueError):
                runtime_defaults(changed)

    def test_runtime_os_packages_are_updated_before_unprivileged_user(self):
        api = (ROOT / 'Dockerfile.api').read_text().split(' AS runtime\n', 1)[1]
        web = (ROOT / 'Dockerfile.web').read_text().split(' AS runtime\n', 1)[1]
        self.assertIn('apt-get upgrade -y', api)
        self.assertIn('apk upgrade --no-cache', web)
        self.assertLess(api.index('apt-get upgrade -y'), api.index('USER node'))
        self.assertLess(web.index('apk upgrade --no-cache'), web.index('USER 65534:65534'))
        self.assertIn('ASA_SECURITY_PATCHSET=2026-11-02', api)
        self.assertIn('ASA_SECURITY_PATCHSET=2026-11-02', web)


if __name__ == '__main__':
    unittest.main()
