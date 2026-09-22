"""CI-only assembly of the immutable release manifest from registry digests."""

import json
import os
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment.contracts import REGISTRY, REPOSITORY, SERVICES, atomic_json, validate_release
from deployment.system import run

revision = os.environ["ASA_BUILD_REVISION"]
images = {}
for service in SERVICES:
    ref = f"{REGISTRY}/{service}:{revision}"
    inspected = json.loads(run(["docker", "buildx", "imagetools", "inspect", ref, "--format", "{{json .Manifest}}"], capture=True))
    images[service] = f"{REGISTRY}/{service}@{inspected['digest']}"
schema = max(int(re.match(r"(\d+)_", p.name)[1]) for p in Path("migrations").glob("*.sql") if re.match(r"(\d+)_", p.name))
manifest = {"format": "asa-deployment-v1", "repository": REPOSITORY, "revision": revision,
            "schema": schema, "platform": "linux/amd64", "publicationRunId": int(os.environ["GITHUB_RUN_ID"]), "images": images}
atomic_json(Path(".asa/release/release.json"), validate_release(manifest))
