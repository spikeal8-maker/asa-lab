"""Bind the full N30 experiment to official releases through the canonical verifier.

This bridge never installs an application, creates a database, or changes an
existing stack. Its only Docker mutations are canonical immutable image pulls
and the verifier's short-lived, non-executed release-manifest container.
"""

import hashlib
import json
import os
from pathlib import Path
import platform
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

from deployment.contracts import Blocked, atomic_json, require  # noqa: E402
from deployment.releases import (  # noqa: E402
    assert_ci,
    assert_general_ci,
    discover_release,
    fetch_images,
    validate_deployment_digest,
)
from deployment.system import run  # noqa: E402

BASELINE = {
    "deploymentDigest": "sha256:598604051f862c65e5b7d2198c4fb4c21f10229a5f6bb1c2311a6b868d1fe035",
    "revision": "98d7fbb42ae9e53113cb45ada4b4301334de9c27",
    "schema": 304,
}
AFTER = {
    "deploymentDigest": "sha256:6cfed43761aff188c8d73b553fcbc48b3da9e2a5c78c33d0e6d1af16df26940a",
    "revision": "8358997da3919f431e1f41456f7eabcbef685e0b",
    "schema": 304,
}
SCENARIO_SHA256 = "c1a0ea8ba9cbbadfe4cb18d7b4250073bbe1f8ca4edfb72bb3dbc712baf605b6"
POSTGRES = "public.ecr.aws/docker/library/postgres@sha256:e9243ab06e47223dedeb3c129fa9ece8d37f506bdc6ee943afb9335f98bb4854"
SERVICES = ("api", "web", "scratch", "minio", "search")


def dispatch_identity(env):
    expected = {
        "GITHUB_ACTIONS": "true",
        "GITHUB_REPOSITORY": "spikeal8-maker/asa-lab",
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_WORKFLOW_REF": "spikeal8-maker/asa-lab/.github/workflows/classroom-official-n30.yml@refs/heads/main",
        "RUNNER_ENVIRONMENT": "github-hosted",
        "RUNNER_OS": "Linux",
    }
    harness = env.get("ASA_SCALE_HARNESS_SHA", "")
    require(all(env.get(key) == value for key, value in expected.items())
            and re.fullmatch(r"[a-f0-9]{40}", harness)
            and env.get("GITHUB_SHA") == env.get("GITHUB_WORKFLOW_SHA") == harness
            and re.fullmatch(r"[1-9][0-9]*", env.get("GITHUB_RUN_ID", ""))
            and re.fullmatch(r"[1-9][0-9]*", env.get("GITHUB_RUN_ATTEMPT", ""))
            and re.fullmatch(r"[a-f0-9]{32}", env.get("ASA_SCALE_RUN_TOKEN", ""))
            and not env.get("DOCKER_HOST") and not env.get("DOCKER_CONTEXT")
            and bool(env.get("GH_TOKEN")),
            "N30_EVENT", "Official N30 requires an authenticated canonical main dispatch on hosted Linux.")
    return {"harnessSha": harness, "runId": env["GITHUB_RUN_ID"],
            "attempt": int(env["GITHUB_RUN_ATTEMPT"]), "runToken": env["ASA_SCALE_RUN_TOKEN"]}


def after_selector(env):
    digest = validate_deployment_digest(env.get("ASA_SCALE_AFTER_DEPLOYMENT_DIGEST"))
    revision, schema = env.get("ASA_SCALE_AFTER_REVISION", ""), env.get("ASA_SCALE_AFTER_SCHEMA", "")
    require(re.fullmatch(r"[a-f0-9]{40}", revision) and re.fullmatch(r"[1-9][0-9]*", schema)
            and len(schema) <= 9 and digest != BASELINE["deploymentDigest"] and revision != BASELINE["revision"],
            "N30_SELECTOR", "After requires a distinct exact official digest, revision and schema.")
    selected = {"deploymentDigest": digest, "revision": revision, "schema": int(schema)}
    require(not (revision == AFTER["revision"] or digest == AFTER["deploymentDigest"]) or selected == AFTER,
            "N30_SELECTOR", "The declared 835 release must match its complete pinned identity.")
    return selected


def qualify_manifest(manifest, selected):
    # discover_release has already run validate_release; require the complete
    # five-image publication and the operator's exact SHA/schema selection too.
    require(manifest.get("format") == "asa-deployment-v2" and set(manifest.get("images", {})) == set(SERVICES)
            and manifest.get("revision") == selected["revision"] and manifest.get("schema") == selected["schema"],
            "N30_RELEASE", "Discovered release differs from the exact selected SHA, schema or complete image set.")
    assert_ci(manifest)
    return {"deploymentDigest": selected["deploymentDigest"], "manifest": manifest, "ci": "PASS"}


def attest_image(service, reference, revision=None):
    rows = json.loads(run(["docker", "image", "inspect", reference], capture=True))
    require(isinstance(rows, list) and len(rows) == 1, "N30_IMAGE", "Ambiguous image inspection.")
    image = rows[0]
    label = image.get("Config", {}).get("Labels") or {}
    actual_revision = label.get("org.opencontainers.image.revision", "")
    require(re.fullmatch(r"sha256:[a-f0-9]{64}", image.get("Id", ""))
            and image.get("Os") == "linux" and image.get("Architecture") == "amd64"
            and reference in image.get("RepoDigests", [])
            and (revision is None or actual_revision == revision),
            "N30_IMAGE", "Pulled image digest, platform or baked revision differs from its official manifest.")
    return {"service": service, "reference": reference, "id": image["Id"],
            "platform": "linux/amd64", "revision": actual_revision}


def prepare(env, root=ROOT):
    identity = dispatch_identity(env)
    selected_after = after_selector(env)
    require(platform.system() == "Linux" and not re.search(r"DESKTOP-R0HSMSA|D2-R2", platform.node(), re.I),
            "N30_HOST", "Only the isolated hosted Linux runner is supported.")
    require(run(["git", "rev-parse", "HEAD"], cwd=root, capture=True) == identity["harnessSha"]
            and not run(["git", "status", "--porcelain", "--untracked-files=no"], cwd=root, capture=True),
            "N30_HARNESS", "The exact harness checkout must be clean; runtime and harness SHAs are independent.")
    context = json.loads(run(["docker", "context", "inspect", "default"], capture=True))
    require(isinstance(context, list) and len(context) == 1 and context[0].get("Name") == "default"
            and context[0].get("Endpoints", {}).get("docker", {}).get("Host") == "unix:///var/run/docker.sock",
            "N30_DOCKER", "Only the hosted runner's default local Docker socket is allowed.")
    scenario_hash = hashlib.sha256((root / "e2e/classroom-scale.spec.ts").read_bytes()).hexdigest()
    require(scenario_hash == SCENARIO_SHA256, "N30_SCENARIO", "The original full N30 browser workload changed.")
    destination = root / "reports/classroom-official-n30" / f"{identity['runId']}-{identity['attempt']}" / "releases.json"
    require(not destination.exists(), "N30_REUSE", "A release proof already exists for this run; no automatic reuse.")

    # No runtime pulls or workload start until General for the harness and both
    # full official publication/General contracts have actually succeeded.
    assert_general_ci(identity["harnessSha"])
    records = {}
    for variant, selected in (("baseline", BASELINE), ("after", selected_after)):
        records[variant] = qualify_manifest(discover_release(selected["deploymentDigest"]), selected)
    for record in records.values():
        manifest = record["manifest"]
        fetch_images(manifest)
        record["images"] = [attest_image(service, manifest["images"][service],
                                        None if service == "minio" else manifest["revision"])
                            for service in SERVICES]
    run(["docker", "pull", "--platform", "linux/amd64", POSTGRES])
    proof = {"format": "asa-official-n30-releases-v1", **identity,
             "harnessGeneralCi": "PASS", "scenarioSha256": scenario_hash,
             "postgres": attest_image("postgres", POSTGRES), **records}
    atomic_json(destination, proof)
    print("N30_RELEASES_VERIFIED exact harness and both official releases", flush=True)
    return proof


if __name__ == "__main__":
    try:
        require(sys.argv[1:] == ["prepare"], "N30_COMMAND", "Use prepare only in the official N30 dispatch.")
        prepare(os.environ)
    except Blocked as error:
        # Canonical Blocked messages contain no credentials or arbitrary stderr.
        print(f"N30_BLOCKED {error.code}: {error}", file=sys.stderr)
        sys.exit(2)
