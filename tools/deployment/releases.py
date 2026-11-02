"""Select one verified release and fetch only immutable OCI images."""

import datetime as dt
import json
import os
from pathlib import Path
import re
import tempfile
import urllib.request
import uuid

from .contracts import REGISTRY, REPOSITORY, SERVICES, Blocked, attest_database_targets, attest_embedded_editor, require, validate_release
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


def _ci_get(path):
    # Public repository requires no token. A supplied token remains in headers,
    # never command-line arguments, output, receipts or the manifest.
    url = f"https://api.github.com/repos/{REPOSITORY}/actions/runs{path}"
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "asa-deployment"}
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = "Bearer " + token
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as response:
            result = json.load(response)
        require(isinstance(result, dict), "CI_UNAVAILABLE", "Malformed GitHub CI response.")
        return result
    except (OSError, ValueError, KeyError) as exc:
        raise Blocked("CI_UNAVAILABLE", "Cannot verify GitHub CI for the selected release.", "Retry when GitHub is accessible; the current installation is unchanged.") from exc


def _ci_pages(path, key):
    rows, total = [], None
    separator = "&" if "?" in path else "?"
    for page in range(1, 11):
        response = _ci_get(f"{path}{separator}per_page=100&page={page}")
        count, batch = response.get("total_count"), response.get(key)
        require(type(count) is int and 0 <= count <= 1000 and isinstance(batch, list)
                and len(batch) <= 100 and all(isinstance(row, dict) for row in batch),
                "CI_UNAVAILABLE", "Incomplete or oversized GitHub CI listing.")
        require(total is None or total == count, "CI_UNAVAILABLE", "GitHub CI listing changed during verification.")
        total = count
        rows.extend(batch)
        require(len(rows) <= total, "CI_UNAVAILABLE", "GitHub CI listing exceeds its declared count.")
        if len(rows) == total:
            identities = [row.get("id") for row in rows]
            require(all(type(identity) is int and identity > 0 for identity in identities)
                    and len(set(identities)) == len(identities), "CI_UNAVAILABLE", "Duplicate or malformed GitHub CI identity.")
            return rows
        require(len(batch) == 100, "CI_UNAVAILABLE", "Truncated GitHub CI listing.")
    raise Blocked("CI_UNAVAILABLE", "GitHub CI listing exceeds the verification bound.", "Retry with a complete supported listing.")


def _completed_run(run):
    require(type(run.get("id")) is int and run["id"] > 0
            and type(run.get("run_attempt")) is int and run["run_attempt"] > 0
            and isinstance(run.get("head_sha"), str) and re.fullmatch(r"[0-9a-f]{40}", run["head_sha"])
            and run.get("status") == "completed" and run.get("conclusion") == "success",
            "CI_BLOCKED", "The exact CI run and latest attempt must have succeeded.")


def _successful_jobs(run, required):
    _completed_run(run)
    jobs = _ci_pages(f"/{run['id']}/attempts/{run['run_attempt']}/jobs", "jobs")
    names = [job.get("name") for job in jobs]
    require(all(isinstance(name, str) for name in names) and len(set(names)) == len(names),
            "CI_BLOCKED", "Missing or duplicate CI job names.")
    required = set(required)
    if run["path"] == ".github/workflows/spec-validation.yml" and "ASA / required" in names:
        required.add("ASA / required")
    require(required <= set(names), "CI_BLOCKED", "Required CI jobs are missing from the latest attempt.")
    for job in jobs:
        require(type(job.get("run_id")) is int and job["run_id"] == run["id"] and type(job.get("run_attempt")) is int
                and job["run_attempt"] == run["run_attempt"] and job.get("head_sha") == run["head_sha"],
                "CI_BLOCKED", "CI jobs do not belong to the exact run, source and latest attempt.")
        if job["name"] not in required:
            continue
        try:
            start = dt.datetime.fromisoformat(job["started_at"].replace("Z", "+00:00"))
            end = dt.datetime.fromisoformat(job["completed_at"].replace("Z", "+00:00"))
            allocated = bool(start.tzinfo and end.tzinfo and end >= start)
        except (KeyError, TypeError, ValueError, AttributeError):
            allocated = False
        require(job.get("status") == "completed" and job.get("conclusion") == "success"
                and type(job.get("runner_id")) is int and job["runner_id"] > 0 and allocated,
                "CI_BLOCKED", "Required CI job did not actually complete successfully: " + job["name"],
                "Wait for full successful checks; skipped, cancelled and partial checks do not authorize a release.")
    current = _ci_get(f"/{run['id']}")
    fields = ("id", "path", "head_sha", "head_branch", "run_attempt", "status", "conclusion", "display_title")
    require(all(current.get(field) == run.get(field) for field in fields), "CI_BLOCKED", "CI changed while verifying its jobs.")


def _latest_general(revision):
    runs = _ci_pages(f"?head_sha={revision}&branch=main", "workflow_runs")
    candidates = [run for run in runs if run.get("name") == "ASA Lab Governance and Code Gates"
                  and run.get("head_sha") == revision and run.get("head_branch") == "main"]
    require(candidates and all(type(run.get("run_number")) is int and run["run_number"] > 0
                              and type(run.get("run_attempt")) is int and run["run_attempt"] > 0 for run in candidates),
            "CI_BLOCKED", "No complete General CI identity for the selected release.")
    require(len({run["run_number"] for run in candidates}) == len(candidates),
            "CI_BLOCKED", "Ambiguous General workflow run numbers.")
    latest = max(candidates, key=lambda run: (run["run_number"], run["run_attempt"]))
    require(latest.get("path") == ".github/workflows/spec-validation.yml" and latest.get("event") in ("push", "workflow_dispatch"),
            "CI_BLOCKED", "Required General CI must be the canonical main workflow.")
    _completed_run(latest)
    return latest


def assert_general_ci(revision):
    """Full General evidence, shared by publication and the updater; no runtime actions."""
    require(isinstance(revision, str) and re.fullmatch(r"[0-9a-f]{40}", revision), "CI_BLOCKED", "Invalid release source SHA.")
    latest = _latest_general(revision)
    # Four original jobs remain mandatory, including for legitimate older releases
    # predating ASA / required. A present aggregate is additionally mandatory.
    _successful_jobs(latest, ("Governance contracts", "Format lint types contracts build",
                              "PostgreSQL tests and RLS", "Access A real browser journeys"))
    current = _latest_general(revision)
    require((current["id"], current["run_attempt"]) == (latest["id"], latest["run_attempt"]),
            "CI_BLOCKED", "A newer General run or attempt requires fresh verification.")


def assert_ci(release):
    revision = release["revision"]
    publication_id = release["publicationRunId"]
    require(type(publication_id) is int and publication_id > 0, "CI_BLOCKED", "Invalid publication run identity.")
    publication = _ci_get(f"/{publication_id}")
    # GitHub's run metadata can use run-name instead of the workflow's static name.
    require(publication.get("name") in ("ASA Portable Release", f"Release {revision}")
            and publication.get("path") == ".github/workflows/portable-release.yml"
            and publication.get("display_title") == f"Release {revision}"
            and publication.get("id") == publication_id
            and publication.get("head_branch") == "main"
            and publication.get("event") in ("workflow_run", "workflow_dispatch")
            and publication.get("status") == "completed" and publication.get("conclusion") == "success",
            "CI_BLOCKED", "The exact publication workflow has not succeeded.", "Wait for its completion; do not bypass publication verification.")
    builds = {"api": "build (api, Dockerfile.api, runtime)", "web": "build (web, Dockerfile.web, runtime)",
              "scratch": "build (scratch, infra/scratch-editor/Dockerfile)",
              "minio": "build (minio, infra/minio/Dockerfile)", "search": "build (search, infra/search/Dockerfile)"}
    require(set(release["images"]) <= set(builds), "CI_BLOCKED", "Unknown release build requires an explicit CI contract.")
    # workflow_run head_sha identifies the workflow revision, not necessarily the
    # built release source. The immutable run ID and exact release title bind it.
    _successful_jobs(publication, ["gate", "contracts (ubuntu-latest)", "contracts (windows-latest)", "publish",
                                   *(builds[service] for service in release["images"])])
    assert_general_ci(revision)


def fetch_images(release):
    for service in release["images"]:
        reference = release["images"][service]
        print(f"IMAGE {service}: downloading missing layers", flush=True)
        run(["docker", "pull", "--platform", "linux/amd64", reference])
        revision = run(["docker", "image", "inspect", "--format", '{{index .Config.Labels "org.opencontainers.image.revision"}}', reference], capture=True)
        if service != "minio":
            require(revision == release["revision"], "IMAGE_REVISION", f"{service} image revision differs.")


def apply_release_environment(install, release):
    install.process_env.update({"ASA_BUILD_REVISION": release["revision"], "ASA_EXPECTED_SCHEMA_VERSION": str(release["schema"])})
    for service in release["images"]:
        install.process_env[f"ASA_{service.upper()}_IMAGE"] = release["images"][service]


def validate_resolved_images(install, release):
    config = json.loads(install.compose("config", "--format", "json", capture=True))
    attest_embedded_editor(config, install.env.get('ASA_UPDATE_ENTRY_ORIGIN'), install.profile)
    attest_database_targets(config, config["services"]["postgres"]["environment"])
    for service in (*release["images"], "migration"):
        expected = release["images"]["api" if service == "migration" else service]
        require(config["services"][service]["image"] == expected, "IMAGE_OVERRIDE", f"Compose overrides the pinned {service} image.",
                "Review the transport overlay; do not deploy mixed artifacts.")
    require(config["services"]["minio-init"]["image"] == release["images"]["minio"], "IMAGE_OVERRIDE",
            "Compose overrides the pinned minio-init image.", "Use the verified MinIO image for both server and bucket initialization.")
    if install.profile in ("production", "staging"):
        require(str(config["services"]["migration"]["environment"].get("ASA_SEED_DEV")).lower() == "false",
                "SEED", "A real-data installation cannot run development seeding.")
    return config
