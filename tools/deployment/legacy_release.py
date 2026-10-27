"""Read an explicitly selected official release without touching Docker or a checkout.

The ordinary stable-channel updater is unchanged. Legacy transition pins both
the deployment artifact and its product revision; moving main/stable cannot
silently select a different product while a plan is being reviewed.
"""

import hashlib
import io
import json
import os
import re
import tarfile
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from .contracts import Blocked, REGISTRY, REPOSITORY, require, validate_release
from .releases import assert_ci

ACCEPT = ','.join(('application/vnd.oci.image.index.v1+json',
                   'application/vnd.docker.distribution.manifest.list.v2+json',
                   'application/vnd.oci.image.manifest.v1+json',
                   'application/vnd.docker.distribution.manifest.v2+json'))
SHA = re.compile(r'[0-9a-f]{40}\Z')
DIGEST = re.compile(r'sha256:[0-9a-f]{64}\Z')


def digest(data):
    return 'sha256:' + hashlib.sha256(data).hexdigest()


def read_url(url, headers=None, limit=5_000_000):
    try:
        with urlopen(Request(url, headers=headers or {}), timeout=30) as response:
            data = response.read(limit + 1)
            require(len(data) <= limit, 'LEGACY_RELEASE', 'Oversized release response.')
            return data, dict(response.headers.items())
    except (OSError, ValueError) as error:
        raise Blocked('LEGACY_RELEASE_UNAVAILABLE', 'Cannot read the selected official release.',
                      'Keep the current installation and retry this read when the registry is available.') from error


def registry_token(service):
    raw, _ = read_url(f'https://ghcr.io/token?service=ghcr.io&scope=repository:{REPOSITORY}/{service}:pull')
    token = json.loads(raw).get('token')
    require(isinstance(token, str) and token, 'LEGACY_RELEASE', 'Registry pull authorization is unavailable.')
    return token


def registry_manifest(service, reference, token):
    require(service in ('deployment', 'api', 'web', 'scratch', 'minio', 'search'),
            'LEGACY_RELEASE', 'Unexpected image repository.')
    require(bool(SHA.fullmatch(reference) or DIGEST.fullmatch(reference)),
            'LEGACY_RELEASE', 'An exact revision or digest is required.')
    raw, headers = read_url(f'https://ghcr.io/v2/{REPOSITORY}/{service}/manifests/{reference}',
                            {'Authorization': 'Bearer ' + token, 'Accept': ACCEPT})
    actual = digest(raw)
    expected = reference if DIGEST.fullmatch(reference) else next(
        (value for key, value in headers.items() if key.lower() == 'docker-content-digest'), None)
    require(expected == actual, 'LEGACY_RELEASE_DIGEST', 'Deployment/image manifest digest differs.')
    return json.loads(raw), actual


def read_exact_release(revision, *, deployment_digest=None):
    """Return the ordinary validated manifest plus immutable registry evidence."""
    require(isinstance(revision, str) and SHA.fullmatch(revision),
            'LEGACY_RELEASE', 'Supply the explicitly approved full product SHA.')
    token = registry_token('deployment')
    index, index_digest = registry_manifest('deployment', deployment_digest or revision, token)
    manifest, platform_digest = index, index_digest
    if 'manifests' in index:
        platforms = [entry for entry in index['manifests']
                     if entry.get('platform', {}).get('os') == 'linux'
                     and entry.get('platform', {}).get('architecture') == 'amd64']
        require(len(platforms) == 1, 'LEGACY_RELEASE', 'Ambiguous deployment image platform.')
        manifest, platform_digest = registry_manifest('deployment', platforms[0]['digest'], token)
    layers = manifest.get('layers', [])
    require(len(layers) == 1 and 0 < layers[0].get('size', 0) <= 5_000_000,
            'LEGACY_RELEASE', 'Unexpected deployment image layout.')
    layer = layers[0]
    require(DIGEST.fullmatch(layer.get('digest', '')), 'LEGACY_RELEASE', 'Invalid deployment layer digest.')
    raw, _ = read_url(f"https://ghcr.io/v2/{REPOSITORY}/deployment/blobs/{layer['digest']}",
                      {'Authorization': 'Bearer ' + token})
    require(len(raw) == layer['size'] and digest(raw) == layer['digest'],
            'LEGACY_RELEASE_DIGEST', 'Deployment layer differs from its immutable manifest.')
    # Never extract an archive onto the host; only one small regular member is read.
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:*') as archive:
        members = [member for member in archive if member.name in ('release.json', './release.json')]
        require(len(members) == 1 and members[0].isfile() and 0 < members[0].size < 65536,
                'LEGACY_RELEASE', 'Deployment image must contain one bounded release.json.')
        release_bytes = archive.extractfile(members[0]).read(65536)
    release = validate_release(json.loads(release_bytes))
    require(release['revision'] == revision, 'LEGACY_RELEASE', 'The release does not match the requested product SHA.')
    assert_ci(release)
    # Check every pinned artifact exists and matches its digest before any downtime.
    for service, reference in release['images'].items():
        registry_manifest(service, reference.split('@', 1)[1], registry_token(service))
    return release, {'deploymentDigest': index_digest, 'platformDigest': platform_digest,
                     'layerDigest': layer['digest'], 'manifestSha256': hashlib.sha256(release_bytes).hexdigest()}


def github_json(path):
    require(isinstance(path, str) and path and not path.startswith('/')
            and not urlsplit(path).scheme and not urlsplit(path).netloc
            and not urlsplit(path).fragment and '\\' not in path and '%' not in path
            and all(segment not in ('.', '..') for segment in urlsplit(path).path.split('/')),
            'LEGACY_TOOL', 'Invalid repository evidence path.')
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'asa-legacy-transition'}
    token = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
    if token:
        headers['Authorization'] = 'Bearer ' + token
    raw, _ = read_url(f'https://api.github.com/repos/{REPOSITORY}/{path}', headers, limit=8_000_000)
    return json.loads(raw)


def verify_manager_evidence(revision, review_url):
    """An unpublished/unchecked tool cannot mutate the real installation.

    Independent agents may use a COMMENTED review to anchor an attributed report;
    its exact reviewed commit and explicit verdict are checked. This records the
    human/agent review decision; it does not infer owner acceptance or PR merge.
    """
    require(SHA.fullmatch(revision or ''), 'LEGACY_TOOL', 'The manager needs an exact published SHA.')
    parsed = urlsplit(review_url or '')
    match = re.fullmatch(rf'/{re.escape(REPOSITORY)}/pull/([1-9][0-9]*)', parsed.path)
    fragment = re.fullmatch(r'pullrequestreview-([1-9][0-9]*)', parsed.fragment)
    require(parsed.scheme == 'https' and parsed.netloc == 'github.com' and not parsed.query and match and fragment,
            'LEGACY_REVIEW', 'Supply the independent exact-SHA GitHub pull-request review URL.')
    review = github_json(f'pulls/{match[1]}/reviews/{fragment[1]}')
    body = review.get('body') or ''
    require(review.get('commit_id') == revision and review.get('state') in ('APPROVED', 'COMMENTED')
            and 'INDEPENDENT_REVIEW' in body and 'VERDICT: APPROVE' in body
            and f'REVIEWED_SHA: {revision}' in body,
            'LEGACY_REVIEW', 'The review does not approve this exact manager revision.')
    pull = github_json(f'pulls/{match[1]}')
    require(pull.get('head', {}).get('sha') == revision, 'LEGACY_TOOL', 'The reviewed PR head has changed.')
    runs = github_json(f'actions/runs?head_sha={revision}&per_page=100')['workflow_runs']
    evidence = {}
    for name, path in (('ASA Lab Governance and Code Gates', '.github/workflows/spec-validation.yml'),
                       ('ASA Portable Delivery Checks', '.github/workflows/portable-delivery.yml')):
        candidates = sorted((item for item in runs if item.get('head_sha') == revision and item.get('name') == name),
                            key=lambda item: (item.get('run_number', 0), item.get('run_attempt', 0)), reverse=True)
        require(candidates and candidates[0].get('status') == 'completed'
                and candidates[0].get('conclusion') == 'success',
                'LEGACY_TOOL_CI', f'Required manager workflow has not passed: {name}.')
        require(candidates[0].get('path') == path, 'LEGACY_TOOL_CI', 'Unexpected required workflow path.')
        evidence[name] = candidates[0]['id']
    return {'revision': revision, 'review': review_url, 'workflows': evidence}
