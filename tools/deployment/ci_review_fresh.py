"""Disposable GitHub runner: real old review data -> fresh published release.

The old source-mounted fixture uses official bd804 product bytes on real schema
261. It does not impersonate the owner's D2R2 source revision. Only exact
fixture identity and this workflow's self-review boundary are substituted.
"""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from asa_manager import first_environment
from deployment.backup import restore_check
from deployment.contracts import Blocked, file_hash, require, validate_release, verify_backup
from deployment.releases import apply_release_environment, fetch_images
from deployment.review_transition import (ReviewInstallation, apply_plan, create_plan,
                                          database_names, pinned_release, table_counts)
from deployment.system import Installation, run


OLD_REVISION = "bd80426472edc25f3a184a29eb1a28216600c4cd"
TARGET_REVISION = "0027b5c1e75d151ebde1c2df734d87eb795b25e3"
ENTRY = "http://127.0.0.1:4610"
PROJECT = "asa-lab-dev"  # One project, on a disposable GitHub runner only.


def git(root, *args):
    return run(["git", *args], cwd=root, env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"}, capture=True)


def exact_old_release():
    reference = "ghcr.io/spikeal8-maker/asa-lab/deployment:" + OLD_REVISION
    run(["docker", "pull", reference])
    container = run(["docker", "create", "--network", "none", reference, "/not-executed"], capture=True)
    try:
        with tempfile.TemporaryDirectory(prefix="asa-old-release-") as folder:
            file = Path(folder) / "release.json"
            run(["docker", "cp", f"{container}:/release.json", str(file)], capture=True)
            release = validate_release(json.loads(file.read_text(encoding="utf-8")))
            require(release["revision"] == OLD_REVISION, "CI_RELEASE", "Old published artifact differs.")
            return release
    finally:
        run(["docker", "rm", container], capture=True)


def copy_old_inputs(root, release):
    for service, copies in (("api", (("/app/dist/.", root / "apps/api/src"),
                                    ("/app/node_modules/@asa-lab/contracts/dist/.", root / "packages/contracts/dist"))),
                            ("web", (("/srv/.", root / "apps/web/src"),))):
        container = run(["docker", "create", "--network", "none", "--entrypoint", "/not-executed",
                         release["images"][service]], capture=True)
        try:
            for source, target in copies:
                target.mkdir(parents=True, exist_ok=True)
                run(["docker", "cp", f"{container}:{source}", str(target)], capture=True)
        finally:
            run(["docker", "rm", container], capture=True)


def overlay_text(image):
    binds = {"api": ["./apps/api/src:/workspace/apps/api/src:ro",
                     "./packages/contracts/dist:/workspace/packages/contracts/dist:ro",
                     "./.asa/local-review:/workspace/.asa/local-review:ro"],
             "web": ["./apps/web/src:/workspace/apps/web/src:ro",
                     "./.asa/local-review:/workspace/.asa/local-review:ro"]}
    checks = {"api": ["CMD", "node", "-e", "fetch('http://127.0.0.1:4611/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"],
              "web": ["CMD", "node", "-e", "fetch('http://127.0.0.1:8080/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]}
    entries = {"api": ["/bin/sh", "/workspace/.asa/local-review/api-watch.sh"],
               "web": ["node", "/workspace/node_modules/vite/bin/vite.js", "--config",
                       "/workspace/.asa/local-review/vite.config.mts"]}
    environments = {"api": {"ASA_BUILD_REVISION": OLD_REVISION,
                            "NODE_EXTRA_CA_CERTS": "/workspace/docker/certs/russian-trusted-root-ca.pem",
                            "ASA_COMFYUI_BASE_URL": "http://host.docker.internal:8188",
                            "TSC_WATCHFILE": "FixedPollingInterval", "TSC_WATCHDIRECTORY": "DynamicPriorityPolling"},
                    "web": {"VITE_ASA_BUILD_REVISION": OLD_REVISION,
                            "VITE_ASA_BLOCKS_RUNTIME_ORIGIN": ENTRY}}
    lines = ["services:"]
    for name in ("api", "web"):
        values = {"image": image, "working_dir": "/workspace", "user": "0:0",
                  "read_only": False, "entrypoint": entries[name],
                  "environment": environments[name], "volumes": binds[name],
                  "healthcheck": {"test": checks[name], "start_period": "45s" if name == "api" else "30s",
                                  "interval": "10s", "timeout": "5s", "retries": 12}}
        lines += [f"  {name}:", "    build: !reset null"]
        lines += [f"    {key}: {json.dumps(value, ensure_ascii=True)}" for key, value in values.items()]
    return "\n".join(lines) + "\n"


def wait_old(install):
    deadline = time.monotonic() + 180
    while True:
        try:
            return install.readiness(OLD_REVISION, 261)
        except (Blocked, OSError, ValueError):
            require(time.monotonic() < deadline, "CI_OLD", "Old source-mounted fixture did not become ready.")
            time.sleep(2)


def bootstrap_old(install, source, release):
    install.compose("up", "-d", "--no-build", "--wait", "--wait-timeout", "120",
                    "postgres", "minio", "search", "scratch", capture=True)
    variables = {**install.process_env, "ASA_LEGACY_DISPOSABLE_FIXTURE": "true",
                 "LOCALAPPDATA": "/tmp/asa-review-fresh-seed"}
    bootstrap = source / "tools/deployment/fixtures/review_fresh/bootstrap261.mjs"
    command = ["docker", "run", "--rm", "--network", PROJECT + "_database", "--read-only",
               "--user", "node", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
               "--tmpfs", "/tmp", "--mount",
               f"type=bind,source={bootstrap},target=/tmp/bootstrap261.mjs,readonly"]
    for key in ("MIGRATION_DATABASE_URL", "MIGRATION_EXPECT_DATABASE", "MIGRATION_CONFIRM",
                "ASA_APP_DB_PASSWORD", "ASA_SEED_WORKSPACE", "ASA_SEED_TEACHER_EMAIL",
                "ASA_SEED_TEACHER_PASSWORD", "ASA_LEGACY_DISPOSABLE_FIXTURE", "LOCALAPPDATA"):
        command += ["--env", key]
    command += ["--entrypoint", "node", release["images"]["api"], "/tmp/bootstrap261.mjs"]
    run(command, env=variables, capture=True)
    install.compose("up", "-d", "--no-build", "minio-init", capture=True)
    install.compose("create", "--no-build", "migration", capture=True)
    install.compose("up", "-d", "--no-build", "--no-deps", "api", "web", capture=True)
    wait_old(install)
    install.compose("run", "--rm", "--no-deps", "--entrypoint", "/bin/sh", "minio-init",
                    "-eu", "-c", 'mc alias set local http://minio:9000 "$ASA_OBJECT_STORAGE_ACCESS_KEY" '
                    '"$ASA_OBJECT_STORAGE_SECRET_KEY" >/dev/null; '
                    'printf "review-fresh-old-object" | mc pipe "local/$ASA_OBJECT_STORAGE_BUCKET/old.txt" >/dev/null',
                    capture=True)


def run_fixture():
    require(os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("RUNNER_TEMP"),
            "CI_ONLY", "Real transition fixture only runs in an isolated GitHub runner.")
    source = Path(__file__).resolve().parents[2]
    old_release = exact_old_release()
    target_release = pinned_release()
    require(target_release["revision"] == TARGET_REVISION, "CI_RELEASE",
            "The selected stable release moved; do not silently test another SHA.")
    fetch_images(old_release)
    fetch_images(target_release)
    with tempfile.TemporaryDirectory(prefix="asa-review-fresh-ci-") as folder:
        private = Path(folder)
        root = private / "installation"
        git(source, "clone", "--no-hardlinks", str(source), str(root))
        git(root, "remote", "set-url", "origin", "https://github.com/spikeal8-maker/asa-lab.git")
        git(root, "config", "user.name", "ASA disposable CI")
        git(root, "config", "user.email", "asa-disposable-ci@example.invalid")
        git(root, "switch", "-c", "review-ci-fixture", OLD_REVISION)
        first_environment(root, "dev")
        env = root / ".env"
        env.write_text(env.read_text() + f"ASA_EXPECTED_SCHEMA_VERSION=261\nASA_BUILD_REVISION={OLD_REVISION}\n"
                       + "".join(f"ASA_{name.upper()}_IMAGE={ref}\n" for name, ref in old_release["images"].items()))
        review = root / ".asa/local-review"
        review.mkdir(parents=True)
        (root / ".asa/diagnostics/store").mkdir(parents=True)
        copy_old_inputs(root, old_release)
        fixture = source / "tools/deployment/fixtures/review_fresh"
        for name in ("api-watch.sh", "vite.config.mts"):
            shutil.copyfile(fixture / name, review / name)
        image = f"{PROJECT}-workspace:ai-review-{OLD_REVISION[:8]}"
        overlay = review / "compose.review.yaml"
        overlay.write_text(overlay_text(image))
        (root / "apps/api/src/review-fresh-untracked.txt").write_text("old untracked fixture\n")
        tracked = root / "apps/api/src/build-metadata.ts"
        tracked.write_bytes(tracked.read_bytes() + b"\n// old tracked fixture\n")
        run(["docker", "build", "--build-arg", "API_IMAGE=" + old_release["images"]["api"],
             "--build-arg", "WEB_IMAGE=" + old_release["images"]["web"],
             "--tag", image, str(fixture)])
        with patch("deployment.review_transition.APPROVED_OLD_REVISION", OLD_REVISION), \
             patch("deployment.review_transition.APPROVED_REVIEW_IMAGE", image), \
             patch("deployment.review_transition.APPROVED_OVERLAY_SHA256", file_hash(overlay)), \
             patch("deployment.review_transition.verify_manager_review", return_value="ci-self-boundary"):
            old = ReviewInstallation(root)
            bootstrap_old(old, source, old_release)
            old_names = database_names(old)
            old_counts = table_counts(old, old.env["POSTGRES_DB"])
            plan_path = private / "plan.json"
            create_plan(root, release_sha=TARGET_REVISION, old_revision=OLD_REVISION,
                        overlay_sha256=file_hash(overlay), database="asalab_fresh_ci",
                        bucket="asa-blocks-fresh-ci", output=plan_path)
            original_overlay = overlay.read_bytes()
            overlay.write_bytes(original_overlay + b"\n# unreviewed drift\n")
            try:
                try:
                    apply_plan(root, plan_path=plan_path, output=private / "blocked-overlay",
                               review_url="https://github.com/spikeal8-maker/asa-lab/pull/1#pullrequestreview-1")
                except Blocked as error:
                    require(error.code == "REVIEW_OVERLAY", "CI_NEGATIVE", "Overlay drift was not rejected precisely.")
                else:
                    raise Blocked("CI_NEGATIVE", "Changed overlay was accepted.")
            finally:
                overlay.write_bytes(original_overlay)
            require(not (root / ".asa/review-fresh-operation.json").exists(), "CI_NEGATIVE",
                    "Rejected drift began maintenance.")
            apply_plan(root, plan_path=plan_path, output=private / "evidence",
                       review_url="https://github.com/spikeal8-maker/asa-lab/pull/1#pullrequestreview-1")
            target = Installation(root, "dev")
            apply_release_environment(target, target_release)
            require(target.readiness(TARGET_REVISION, target_release["schema"])["revision"] == TARGET_REVISION,
                    "CI_TARGET", "Fresh target is not ready at the selected revision.")
            require(set(old_names).issubset(database_names(target))
                    and table_counts(target, "asalab") == old_counts,
                    "CI_OLD", "Old database was not retained.")
            require(table_counts(target, "asalab_fresh_ci") != old_counts,
                    "CI_FRESH", "Fresh namespace reused the old data.")
            evidence = private / "evidence"
            backups = list((evidence / "full-old-data").iterdir())
            require(len(backups) == 1, "CI_BACKUP", "One full old backup was expected.")
            verify_backup(backups[0])
            restore_check(target, backups[0], "asalab_preserved_test")
            target.compose("run", "--rm", "--no-deps", "--entrypoint", "/bin/sh", "minio-init",
                           "-eu", "-c", 'mc alias set local http://minio:9000 "$ASA_OBJECT_STORAGE_ACCESS_KEY" '
                           '"$ASA_OBJECT_STORAGE_SECRET_KEY" >/dev/null; '
                           'test "$(mc cat local/asa-blocks/old.txt)" = review-fresh-old-object', capture=True)
            require(git(root, "branch", "--show-current") == "" and git(root, "rev-parse", "HEAD") == TARGET_REVISION,
                    "CI_CHECKOUT", "Operational checkout is not detached at the selected release.")
            print("REVIEW_FRESH_CI PASS real old schema 261, old database/object retained, fresh release, restore-check")


if __name__ == "__main__":
    run_fixture()
