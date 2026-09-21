"""Select one verified release and fetch only immutable OCI images."""

import json
import os
from pathlib import Path
import tempfile
import urllib.request
import uuid

from .contracts import REGISTRY, REPOSITORY, SERVICES, Blocked, attest_database_targets, require, validate_release
from .system import run


def discover_release():
    reference = f"{REGISTRY}/deployment:stable"
    print("RELEASE fetching the published stable manifest", flush=True)
    run(["docker", "pull", reference])
    # Pin the local ID after pulling: a simultaneous pull cannot change selection.
    image_id = run(["docker", "image", "inspect", "--format", "{{.Id}}", reference], capture=True)
    container = run(["docker", "create", "--network", "none", "--label", "asa.operation=release-manifest",
                     image_id, "/not-executed"], capture=True)
    try:
        with tempfile.TemporaryDirectory(prefix="asa-release-") as temporary:
            file = Path(temporary) / "release.json"
            run(["docker", "cp", f"{container}:/release.json", str(file)], capture=True)
            require(file.stat().st_size < 65536, "RELEASE", "Release manifest is unexpectedly large.")
            return validate_release(json.loads(file.read_text(encoding="utf-8")))
    finally:
        run(["docker", "rm", container], capture=True)


def assert_ci(release):
    # Public repository requires no token. A supplied token remains in headers,
    # never command-line arguments, output, receipts or the manifest.
    revision = release["revision"]
    url = f"https://api.github.com/repos/{REPOSITORY}/actions/runs?head_sha={revision}&branch=main&per_page=100"
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "asa-deployment"}
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = "Bearer " + token
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as response:
            runs = json.load(response)["workflow_runs"]
        publication_url = f"https://api.github.com/repos/{REPOSITORY}/actions/runs/{release['publicationRunId']}"
        with urllib.request.urlopen(urllib.request.Request(publication_url, headers=headers), timeout=30) as response:
            publication = json.load(response)
    except (OSError, ValueError, KeyError) as exc:
        raise Blocked("CI_UNAVAILABLE", "Cannot verify GitHub CI for the selected release.", "Retry when GitHub is accessible; the current installation is unchanged.") from exc
    # GitHub's run metadata can use run-name instead of the workflow's static name.
    require(publication.get("name") in ("ASA Portable Release", f"Release {revision}")
            and publication.get("path") == ".github/workflows/portable-release.yml"
            and publication.get("display_title") == f"Release {revision}"
            and publication.get("head_branch") == "main"
            and publication.get("status") == "completed" and publication.get("conclusion") == "success",
            "CI_BLOCKED", "The exact publication workflow has not succeeded.", "Wait for its completion; do not bypass publication verification.")
    for name in ("ASA Lab Governance and Code Gates",):
        candidates = sorted((r for r in runs if r.get("name") == name and r.get("head_sha") == revision
                             and r.get("head_branch") == "main"),
                            key=lambda r: (r.get("run_number", 0), r.get("run_attempt", 0)), reverse=True)
        require(candidates and candidates[0].get("status") == "completed" and candidates[0].get("conclusion") == "success",
                "CI_BLOCKED", f"Required workflow is not successful for {revision}: {name}",
                "Resolve that exact workflow; do not bypass the gate or update to another SHA silently.")


def fetch_images(release):
    for service in SERVICES:
        reference = release["images"][service]
        print(f"IMAGE {service}: downloading missing layers", flush=True)
        run(["docker", "pull", "--platform", "linux/amd64", reference])
        revision = run(["docker", "image", "inspect", "--format", '{{index .Config.Labels "org.opencontainers.image.revision"}}', reference], capture=True)
        if service != "minio":
            require(revision == release["revision"], "IMAGE_REVISION", f"{service} image revision differs.")


def apply_release_environment(install, release):
    install.process_env.update({"ASA_BUILD_REVISION": release["revision"], "ASA_EXPECTED_SCHEMA_VERSION": str(release["schema"])})
    for service in SERVICES:
        install.process_env[f"ASA_{service.upper()}_IMAGE"] = release["images"][service]


def validate_resolved_images(install, release):
    config = json.loads(install.compose("config", "--format", "json", capture=True))
    attest_database_targets(config, config["services"]["postgres"]["environment"])
    for service in (*SERVICES, "migration"):
        expected = release["images"]["api" if service == "migration" else service]
        require(config["services"][service]["image"] == expected, "IMAGE_OVERRIDE", f"Compose overrides the pinned {service} image.",
                "Review the transport overlay; do not deploy mixed artifacts.")
    if install.profile in ("production", "staging"):
        require(str(config["services"]["migration"]["environment"].get("ASA_SEED_DEV")).lower() == "false",
                "SEED", "A real-data installation cannot run development seeding.")
    return config
