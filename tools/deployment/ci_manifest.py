"""CI-only assembly of the immutable release manifest from registry digests."""

import json
import os
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment.contracts import REGISTRY, REPOSITORY, atomic_json, validate_release
from deployment.system import run
from deployment.release_channel import publication_channel

revision = os.environ["ASA_BUILD_REVISION"]
images = {}
manifest_format, publication_services = publication_channel()
for service in publication_services:
    ref = f"{REGISTRY}/{service}:{revision}"
    inspected = json.loads(run(["docker", "buildx", "imagetools", "inspect", ref, "--format", "{{json .Manifest}}"], capture=True))
    images[service] = f"{REGISTRY}/{service}@{inspected['digest']}"
schema = max(int(re.match(r"(\d+)_", p.name)[1]) for p in Path("migrations").glob("*.sql") if re.match(r"(\d+)_", p.name))
manifest = {"format": manifest_format, "repository": REPOSITORY, "revision": revision,
            "schema": schema, "platform": "linux/amd64", "publicationRunId": int(os.environ["GITHUB_RUN_ID"]), "images": images}
atomic_json(Path(".asa/release/release.json"), validate_release(manifest))
