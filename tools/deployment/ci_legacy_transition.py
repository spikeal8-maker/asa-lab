"""Disposable GitHub CI: real schema-261 review runtime -> official schema-268.

The source API/portal bytes deliberately come from the published bd804 artifacts;
this fixture never claims to execute D2R2's old 2d6394 source. It reproduces the
attested watcher/Vite/source-bind configuration with honest API revision bd804,
real PostgreSQL schema 261 and unverified Web metadata. Only the still-running
manager's external CI/review evidence boundary is replaced in this harness.
Product release, migration, backup, restore, identity and readiness are real.
"""

from contextlib import contextmanager
import http.cookiejar
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from unittest.mock import patch
import urllib.request
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from asa_manager import first_environment
from deployment import legacy
from deployment.contracts import Blocked, file_hash, read_env, require
from deployment.legacy_backup import verify_legacy_backup
from deployment.legacy_identity import LegacyInstallation, REVIEW_API_ENTRYPOINT, REVIEW_WEB_ENTRYPOINT, SOURCE_BINDS, review_healthcheck
from deployment.legacy_release import read_exact_release
from deployment.paths import atomic_json
from deployment.releases import apply_release_environment, fetch_images
from deployment.system import Installation, operation_lock, run


PRODUCT = "bd80426472edc25f3a184a29eb1a28216600c4cd"
PROJECT = "asa-lab-ci-legacy-809"
ENTRY = "http://127.0.0.1:4610"
REPOSITORY = "https://github.com/spikeal8-maker/asa-lab.git"


def phase(report, name):
    report["phase"] = name
    print("LEGACY_CI_STAGE " + name, flush=True)


def git(root, *args):
    return run(["git", *args], cwd=root, env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"}, capture=True)


def overlay_text(project, revision):
    lines = ["services:"]
    for name in ("api", "web"):
        environment = ({"ASA_BUILD_REVISION": revision,
                        "NODE_EXTRA_CA_CERTS": "/workspace/docker/certs/russian-trusted-root-ca.pem",
                        "ASA_COMFYUI_BASE_URL": "http://host.docker.internal:8188",
                        "TSC_WATCHFILE": "FixedPollingInterval", "TSC_WATCHDIRECTORY": "DynamicPriorityPolling"}
                       if name == "api" else {"VITE_ASA_BUILD_REVISION": revision, "VITE_ASA_BLOCKS_RUNTIME_ORIGIN": ENTRY})
        values = {"image": f"{project}-workspace:ai-review-{revision[:8]}", "working_dir": "/workspace", "user": "0:0", "read_only": False,
                  "entrypoint": REVIEW_API_ENTRYPOINT if name == "api" else REVIEW_WEB_ENTRYPOINT,
                  "environment": environment, "healthcheck": review_healthcheck(name),
                  "volumes": [f"./{relative}:{target}:ro" for (service, target), relative in SOURCE_BINDS.items() if service == name]}
        lines += [f"  {name}:", "    build: !reset null"]
        lines += [f"    {key}: {json.dumps(value, ensure_ascii=True)}" for key, value in values.items()]
    return "\n".join(lines) + "\n"


def copy_published_inputs(root, release):
    """Extract from stopped throwaway containers, not from a synthetic API."""
    for service, copies in (("api", (("/app/dist/.", root / "apps/api/src"),
                                     ("/app/node_modules/@asa-lab/contracts/dist/.", root / "packages/contracts/dist"))),
                            ("web", (("/srv/.", root / "apps/web/src"),))):
        container = run(["docker", "create", "--network", "none", "--label", "asa.operation=legacy-ci-inputs",
                         "--entrypoint", "/not-executed", release["images"][service]], capture=True)
        try:
            for source, target in copies:
                target.mkdir(parents=True, exist_ok=True)
                run(["docker", "cp", f"{container}:{source}", str(target)], capture=True)
        finally:
            run(["docker", "rm", container], capture=True)


def wait_old(install):
    deadline = time.monotonic() + 180
    while True:
        try:
            observed = install.legacy_readiness(ENTRY)
            require(observed["api"] == {"revision": PRODUCT, "schema": 261}
                    and observed["web"]["revision"] is None and observed["web"]["status"] == "unverified",
                    "CI_SOURCE", "The real legacy fixture does not expose the intended honest metadata.")
            return observed
        except (Blocked, OSError, ValueError):
            require(time.monotonic() < deadline, "CI_SOURCE", "The real legacy API/Vite fixture did not become ready.")
            time.sleep(2)


def bootstrap(root, source, release):
    install = LegacyInstallation(root, "dev")
    install.entry_origin = ENTRY
    install.compose("up", "-d", "--no-build", "--wait", "--wait-timeout", "120", "postgres", "minio", "search", "scratch", capture=True)
    variables = {**install.process_env, "ASA_LEGACY_DISPOSABLE_FIXTURE": "true", "LOCALAPPDATA": "/tmp/asa-legacy-seed"}
    command = ["docker", "run", "--rm", "--network", PROJECT + "_database", "--read-only", "--user", "node",
               "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--tmpfs", "/tmp",
               "--label", "asa.operation=legacy-ci-bootstrap", "--mount",
               "type=bind,source=" + str(source / "tools/deployment/fixtures/legacy/bootstrap261.mjs") + ",target=/tmp/bootstrap261.mjs,readonly"]
    for key in ("MIGRATION_DATABASE_URL", "MIGRATION_EXPECT_DATABASE", "MIGRATION_CONFIRM", "ASA_APP_DB_PASSWORD",
                "ASA_SEED_WORKSPACE", "ASA_SEED_TEACHER_EMAIL", "ASA_SEED_TEACHER_PASSWORD", "ASA_LEGACY_DISPOSABLE_FIXTURE", "LOCALAPPDATA"):
        command += ["--env", key]
    command += ["--entrypoint", "node", release["images"]["api"], "/tmp/bootstrap261.mjs"]
    run(command, env=variables, capture=True)
    install.compose("up", "-d", "--no-build", "minio-init", capture=True)
    # A historical completed migration container is identity evidence. Do not
    # run its present-day entrypoint and accidentally migrate the fixture to 268.
    install.compose("create", "--no-build", "migration", capture=True)
    install.compose("up", "-d", "--no-build", "--no-deps", "api", "web", capture=True)
    runtime = wait_old(install)
    # Standard S3 write through the shipped MinIO client. No raw volume fake.
    install.compose("run", "--rm", "--no-deps", "--entrypoint", "/bin/sh", "minio-init", "-eu", "-c",
                    'mc alias set local http://minio:9000 "$ASA_OBJECT_STORAGE_ACCESS_KEY" "$ASA_OBJECT_STORAGE_SECRET_KEY" >/dev/null; '
                    'printf "legacy-real-object-809" | mc pipe "local/$ASA_OBJECT_STORAGE_BUCKET/legacy-fixture.txt" >/dev/null', capture=True)
    return install, runtime


def preservation(install, directory):
    """Make the same independently verified private preservation format as D2R2."""
    directory.mkdir(mode=0o700)
    snapshot = install.snapshot(ENTRY)
    copies = []
    for relative, expected in snapshot["inputs"].items():
        target = directory / "source" / relative
        target.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        shutil.copyfile(install.root / relative, target)
        require(file_hash(target) == expected["sha256"], "CI_PRESERVATION", "A fixture preservation input changed.")
        copies.append({"source": str(install.root / relative), "sha256": expected["sha256"]})
    (directory / "metadata").mkdir(mode=0o700)
    index = Path(snapshot["git"]["indexPath"])
    shutil.copyfile(index, directory / "metadata/index")
    recovery = {"source_root": str(install.root), "source_head": snapshot["git"]["head"],
                "source_branch": snapshot["git"]["branch"], "index_sha256": file_hash(index)}
    for key, arguments in (("tracked_paths", ("diff", "--name-only", "-z", "HEAD")),
                           ("untracked_paths", ("ls-files", "--others", "--exclude-standard", "-z")),
                           ("staged_paths", ("diff", "--cached", "--name-only", "-z"))):
        recovery[key] = sorted(filter(None, install.git(*arguments).split("\0")))
    recovery["ignored_inventory"] = {
        relative: sorted(path.relative_to(install.root).as_posix()
                         for path in (install.root / relative).rglob("*") if path.is_file())
        for relative in (".asa/local-review", "packages/contracts/dist")}
    atomic_json(directory / "metadata/recovery.json", recovery)
    bundle = directory / "repository.bundle"
    git(install.root, "bundle", "create", str(bundle), "--all")
    git(install.root, "bundle", "verify", str(bundle))
    with tempfile.TemporaryDirectory(prefix="asa-legacy-bundle-proof-") as proof:
        run(["git", "clone", "--bare", str(bundle), proof], capture=True)
        run(["git", "--git-dir", proof, "fsck", "--full", "--strict"], capture=True)
    files = [{"path": path.relative_to(directory).as_posix(), "bytes": path.stat().st_size, "sha256": file_hash(path)}
             for path in sorted(directory.rglob("*")) if path.is_file()]
    atomic_json(directory / "MANIFEST.json", {"format": 1, "independent_git_fetch_fsck": True, "database_backup": False,
                                             "source_head": snapshot["git"]["head"], "source_branch": snapshot["git"]["branch"],
                                             "source_copies": copies, "files": files})
    legacy.verify_preservation(install, directory)
    return snapshot


@contextmanager
def neighbour(release):
    token = uuid.uuid4().hex
    name = "asa-legacy-ci-neighbour-" + token
    volume = name + "-data"
    container = None
    run(["docker", "volume", "create", "--label", "asa.legacy.ci=" + token, volume], capture=True)
    try:
        container = run(["docker", "run", "-d", "--name", name, "--network", "none", "--label", "asa.legacy.ci=" + token,
                         "--label", "com.docker.compose.project=asa-legacy-ci-neighbour", "--mount", f"type=volume,source={volume},target=/data",
                         "--entrypoint", "/bin/sh", release["images"]["minio"], "-eu", "-c",
                         'printf "neighbour-preserved-809" > /data/canary; while :; do sleep 60; done'], capture=True)
        yield container
    finally:
        if container:
            labels = json.loads(run(["docker", "inspect", "--format", "{{json .Config.Labels}}", container], capture=True))
            require(labels.get("asa.legacy.ci") == token, "CI_CLEANUP", "Neighbour fixture ownership changed.")
            run(["docker", "rm", "--force", container], capture=True)
        labels = json.loads(run(["docker", "volume", "inspect", "--format", "{{json .Labels}}", volume], capture=True))
        require(labels.get("asa.legacy.ci") == token, "CI_CLEANUP", "Neighbour volume ownership changed.")
        run(["docker", "volume", "rm", volume], capture=True)


def assert_refused(call, expected):
    try:
        call()
    except Blocked as error:
        require(error.code in expected, "CI_NEGATIVE", "A negative scenario failed at an unexpected boundary.")
        return error.code
    raise Blocked("CI_NEGATIVE", "An unsafe legacy scenario was accepted.", "Fix the transition guard before publishing the manager.")


def negative_checks(install, snapshot):
    before = snapshot["containers"]
    overlay = install.root / ".asa/local-review/compose.review.yaml"
    original = overlay.read_bytes()
    results = {}
    try:
        overlay.write_bytes(original.replace(b"working_dir: \"/workspace\"", b"working_dir: \"/unapproved\"", 1))
        results["unknown_override"] = assert_refused(install.configuration, {"LEGACY_OVERLAY"})
    finally:
        overlay.write_bytes(original)
    try:
        changed = original.replace(b"    volumes: [", b'    volumes: ["./apps/api/src:/unapproved-source:ro", ', 1)
        require(changed != original, "CI_NEGATIVE", "The bind-mount negative did not change the fixture overlay.")
        overlay.write_bytes(changed)
        results["unknown_bind_mount"] = assert_refused(install.configuration, {"LEGACY_OVERLAY"})
    finally:
        overlay.write_bytes(original)
    try:
        overlay.write_bytes(original + b"\nvolumes:\n  postgres-data:\n    name: asa-legacy-ci-foreign-not-created\n    external: true\n")
        results["foreign_named_volume"] = assert_refused(install.configuration, {"LEGACY_OVERLAY"})
    finally:
        overlay.write_bytes(original)
    # Config-only negatives above never create or recreate a service/volume.
    # This one stopped, foreign container proves actual shared storage is also
    # rejected. Its existing PostgreSQL volume is read-only and never copied to.
    postgres = before["postgres"]
    storage = [mount["Name"] for mount in postgres["mounts"]
               if mount.get("Type") == "volume" and mount.get("Destination") == "/var/lib/postgresql/data"]
    require(len(storage) == 1, "CI_NEGATIVE", "The source PostgreSQL volume is ambiguous.")
    token = uuid.uuid4().hex
    name = "asa-legacy-ci-shared-" + token
    container = run(["docker", "create", "--name", name, "--network", "none", "--read-only",
                     "--label", "asa.operation=legacy-ci-negative-shared-storage", "--label", "asa.legacy.ci=" + token,
                     "--mount", f"type=volume,source={storage[0]},target=/var/lib/postgresql/data,readonly,volume-nocopy",
                     "--entrypoint", "/not-executed", postgres["imageId"]], capture=True)
    try:
        actual = json.loads(run(["docker", "inspect", container], capture=True))[0]
        require(actual.get("Id") == container and actual.get("State", {}).get("Status") == "created"
                and actual.get("State", {}).get("Running") is False
                and actual.get("HostConfig", {}).get("NetworkMode") == "none"
                and not actual.get("HostConfig", {}).get("PortBindings")
                and any(mount.get("Type") == "volume" and mount.get("Name") == storage[0]
                        and mount.get("Destination") == "/var/lib/postgresql/data" and mount.get("RW") is False
                        for mount in actual.get("Mounts", [])),
                "CI_NEGATIVE", "The stopped shared-volume fixture does not have the intended isolation.")
        results["foreign_shared_storage"] = assert_refused(install.identity, {"LEGACY_SHARED_STORAGE"})
    finally:
        actual = json.loads(run(["docker", "inspect", container], capture=True))[0]
        labels = actual.get("Config", {}).get("Labels") or {}
        require(actual.get("Id") == container and actual.get("Name") == "/" + name
                and actual.get("State", {}).get("Running") is False
                and labels.get("asa.operation") == "legacy-ci-negative-shared-storage"
                and labels.get("asa.legacy.ci") == token,
                "CI_CLEANUP", "The stopped negative fixture ownership or state changed.")
        run(["docker", "rm", container], capture=True)
    source = install.root / "apps/api/src/asai-809-fixture-wip.txt"
    content = source.read_bytes()
    try:
        source.write_bytes(content + b"changed after plan\n")
        results["input_drift"] = assert_refused(lambda: install.revalidate(snapshot), {"LEGACY_DRIFT"})
    finally:
        source.write_bytes(content)
    writer = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"], cwd=install.root,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        results["active_author"] = assert_refused(install.assert_inactive, {"LEGACY_AUTHOR"})
    finally:
        writer.terminate()
        writer.wait(timeout=10)
    install.revalidate(snapshot)
    observed = install.identity()
    differences = {name: sorted(key for key in set(before[name]) | set(observed[name])
                                if before[name].get(key) != observed[name].get(key)) for name in before}
    differences = {name: fields for name, fields in differences.items() if fields}
    require(not differences, "CI_NEGATIVE", "A negative preflight changed source container fields: " + json.dumps(differences))
    require(not (install.state / "maintenance.json").exists(), "CI_NEGATIVE", "A negative preflight began maintenance.")
    return results


def session(install):
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    credentials = {"workspace": install.env["ASA_SEED_WORKSPACE"], "email": install.env["ASA_SEED_TEACHER_EMAIL"],
                   "password": install.env["ASA_SEED_TEACHER_PASSWORD"]}
    request = urllib.request.Request(ENTRY + "/api/auth/login", json.dumps(credentials).encode(),
                                     headers={"Content-Type": "application/json", "Origin": ENTRY})
    with opener.open(request, timeout=20) as response:
        value = json.load(response)
    require(value.get("authenticated") is True and value.get("user", {}).get("id"), "CI_LOGIN", "The normal fixture login failed.")
    return opener, value["user"]["id"]


def cleanup_project(root):
    ids = run(["docker", "ps", "-aq", "--no-trunc", "--filter", "label=com.docker.compose.project=" + PROJECT], capture=True).split()
    for container in ids:
        labels = json.loads(run(["docker", "inspect", "--format", "{{json .Config.Labels}}", container], capture=True))
        require(labels.get("com.docker.compose.project.working_dir") == str(root), "CI_CLEANUP", "Fixture cleanup encountered another root.")
    # This is disposable CI data, never an operator command or a live rollback.
    if ids:
        run(["docker", "rm", "--force", *ids], capture=True)
    volumes = run(["docker", "volume", "ls", "-q", "--filter", "label=com.docker.compose.project=" + PROJECT], capture=True).split()
    for volume in volumes:
        labels = json.loads(run(["docker", "volume", "inspect", "--format", "{{json .Labels}}", volume], capture=True))
        require(labels.get("com.docker.compose.project") == PROJECT, "CI_CLEANUP", "Fixture volume ownership changed.")
        run(["docker", "volume", "rm", volume], capture=True)
    networks = run(["docker", "network", "ls", "-q", "--filter", "label=com.docker.compose.project=" + PROJECT], capture=True).split()
    for network in networks:
        run(["docker", "network", "rm", network], capture=True)


def run_fixture(evidence):
    require(os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("RUNNER_TEMP"),
            "CI_ONLY", "This real transition fixture is only allowed in an isolated GitHub Actions runner.")
    source = Path(__file__).resolve().parents[2]
    fixture = source / "tools/deployment/fixtures/legacy"
    manager_sha = git(source, "rev-parse", "HEAD")
    report = {"format": "asa-legacy-transition-ci-v1", "manager": manager_sha, "product": PRODUCT,
              "sourceFixture": "published bd804 API bytes on real schema 261; genuine Vite and published portal assets; not D2R2 old source",
              "externalManagerApproval": "not evaluated inside its own running CI; independent exact-SHA review remains required",
              "installedD2R2Demo": "not_run", "ownerAcceptance": "pending", "status": "running"}
    evidence.parent.mkdir(parents=True, exist_ok=True)
    try:
        phase(report, "verify_official_product")
        release, registry = read_exact_release(PRODUCT)
        require(release["schema"] == 268, "CI_RELEASE", "The approved product schema changed.")
        fetch_images(release)
        report["registry"] = registry
        with tempfile.TemporaryDirectory(prefix="asa-legacy-real-") as temporary:
            private = Path(temporary)
            root = private / "installation"
            phase(report, "prepare_review_fixture")
            run(["git", "clone", "--no-hardlinks", str(source), str(root)], capture=True)
            git(root, "remote", "set-url", "origin", REPOSITORY)
            git(root, "config", "user.name", "ASA disposable CI")
            git(root, "config", "user.email", "asa-disposable-ci@example.invalid")
            git(root, "switch", "-c", "review-ci-809", PRODUCT)
            first_environment(root, "dev")
            env_path = root / ".env"
            initial = env_path.read_text().replace("COMPOSE_PROJECT_NAME=asa-lab-dev", "COMPOSE_PROJECT_NAME=" + PROJECT)
            initial += "ASA_EXPECTED_SCHEMA_VERSION=261\nASA_BUILD_REVISION=" + PRODUCT + "\n"
            initial += "".join(f"ASA_{name.upper()}_IMAGE={reference}\n" for name, reference in release["images"].items())
            env_path.write_text(initial)
            review = root / ".asa/local-review"
            review.mkdir(parents=True)
            diagnostics = root / ".asa/diagnostics/store"
            diagnostics.mkdir(parents=True)
            diagnostics.chmod(0o755)
            copy_published_inputs(root, release)
            for file in ("api-watch.sh", "vite.config.mts"):
                shutil.copyfile(fixture / file, review / file)
            (review / "compose.review.yaml").write_text(overlay_text(PROJECT, PRODUCT))
            (root / "apps/api/src/asai-809-fixture-wip.txt").write_bytes(b"private preserved fixture WIP\n")
            # Include a real tracked WIP edit; it must be stashed only after the
            # application backup and verified restore, never carried into bd804.
            tracked = root / "apps/api/src/build-metadata.ts"
            tracked.write_bytes(tracked.read_bytes() + b"\n// disposable legacy review WIP\n")
            workspace = f"{PROJECT}-workspace:ai-review-{PRODUCT[:8]}"
            run(["docker", "build", "--build-arg", "API_IMAGE=" + release["images"]["api"],
                 "--build-arg", "WEB_IMAGE=" + release["images"]["web"], "--tag", workspace, str(fixture)])
            try:
                with neighbour(release) as sentinel:
                    phase(report, "boot_real_schema_261")
                    install, old = bootstrap(root, source, release)
                    opener, account_id = session(install)
                    report["before"] = old
                    saved = private / "wip-preservation"
                    snapshot = preservation(install, saved)
                    report["negativeChecks"] = negative_checks(install, snapshot)
                    backup_output = private / "application-backups"
                    backup_output.mkdir(mode=0o700)
                    plan_path = private / "transition-plan.json"
                    # A workflow cannot require its own successful conclusion or
                    # reviewer sign-off before executing. This one external
                    # boundary is substituted HERE, never in the product manager.
                    def external_evidence(revision, review_url):
                        require(revision == manager_sha, "CI_MANAGER", "Unexpected manager source revision.")
                        return {"revision": revision, "review": review_url, "workflows": {"self_ci_boundary": "currently_running"}}
                    with patch.object(legacy, "verify_manager_evidence", side_effect=external_evidence):
                        phase(report, "plan_and_apply_real_transition")
                        plan = legacy.create_plan(root, revision=PRODUCT, output=plan_path, preservation=saved, entry_origin=ENTRY,
                                                  review_url="ci-external-review-boundary-not-yet-issued")
                        with operation_lock(root):
                            journal = legacy.apply_plan(root, plan_path, output=backup_output, database="asa_legacy_upgrade_809_test", object_sandbox=True)
                        phase(report, "verify_real_target_and_no_change_retry")
                        require(journal["phase"] == "accepted" and journal["restoredUpgrade"] == "pass", "CI_TRANSITION", "The real transition was not verified.")
                        selected = Installation(root, "dev")
                        apply_release_environment(selected, release)
                        report["after"] = selected.readiness(PRODUCT, 268)
                        records = selected.identity()
                        before_retry = {key: record["id"] for key, record in records.items()}
                        backups = sorted(path.name for path in backup_output.iterdir())
                        with operation_lock(root):
                            repeated = legacy.apply_plan(root, plan_path, output=backup_output, database="unused_repeat_809_test", object_sandbox=True)
                        require(repeated["phase"] == "accepted" and before_retry == {key: record["id"] for key, record in selected.identity().items()}
                                and backups == sorted(path.name for path in backup_output.iterdir()), "CI_RETRY", "A verified retry changed containers or created another backup.")
                    with opener.open(ENTRY + "/api/auth/me", timeout=20) as response:
                        current_user = json.load(response)
                    require(current_user.get("authenticated") is True and current_user.get("user", {}).get("id") == account_id,
                            "CI_LOGIN", "The existing authenticated session did not survive the update.")
                    require(read_env(root / ".env") == read_env(Path(journal["backup"]) / "private.env"),
                            "CI_KEYS", "Existing configuration or keys changed.")
                    selected.compose("run", "--rm", "--no-deps", "--entrypoint", "/bin/sh", "minio-init", "-eu", "-c",
                                     'mc alias set local http://minio:9000 "$ASA_OBJECT_STORAGE_ACCESS_KEY" "$ASA_OBJECT_STORAGE_SECRET_KEY" >/dev/null; '
                                     'test "$(mc cat "local/$ASA_OBJECT_STORAGE_BUCKET/legacy-fixture.txt")" = legacy-real-object-809', capture=True)
                    require(run(["docker", "exec", sentinel, "cat", "/data/canary"], capture=True) == "neighbour-preserved-809",
                            "CI_NEIGHBOUR", "The neighbouring fixture data changed.")
                    manifest, backup_snapshot = verify_legacy_backup(journal["backup"])
                    backup = Path(journal["backup"])
                    require((backup / "configuration/.asa/local-review/compose.review.yaml").read_bytes()
                            == (saved / "source/.asa/local-review/compose.review.yaml").read_bytes(), "CI_NESTED", "Nested overlay bytes were not recovered.")
                    for service, marker in (("api", b"api-review-compiled-state\n"), ("web", b"web-review-vite-state\n")):
                        with tarfile.open(backup / f"runtime-filesystems/{service}.tar") as archive:
                            candidates = [member for member in archive if member.name.removeprefix("./") == "workspace/review-writable-marker"]
                            require(len(candidates) == 1 and archive.extractfile(candidates[0]).read() == marker,
                                    "CI_WRITABLE", "An unmounted legacy runtime change was not preserved.")
                    require(backup_snapshot["runtime"]["web"]["revision"] is None and manifest["runtime"]["revisionScope"] == "api-only",
                            "CI_PROVENANCE", "The backup invented an old Web SHA.")
                    require(git(root, "rev-parse", "HEAD") == PRODUCT and not git(root, "status", "--porcelain"),
                            "CI_WIP", "WIP leaked into the installed product checkout.")
                    require(journal.get("preservedStash") and git(root, "rev-parse", "refs/stash") == journal["preservedStash"],
                            "CI_WIP", "The original work was not retained independently.")
                    report.update(status="success", phase="verified", backup={"manifestSha256": file_hash(backup / "manifest.json"),
                                  "files": len(manifest["files"]), "objectFiles": len(manifest["legacy"]["objectFiles"]),
                                  "oldWebRevision": None, "runtimeFilesystems": ["api", "web"], "nestedOverlay": "byte_exact"},
                                  restore={"database": "new_test_database", "upgrade261To268": "pass", "objects": "restored_and_readable"},
                                  loginSession="survived", keys="preserved", neighbour="unchanged", noChangeRetry="pass", wip="retained_outside_product")
            finally:
                cleanup_project(root)
    except BaseException as error:
        report.update(status="failed", failureCode=error.code if isinstance(error, Blocked) else type(error).__name__)
        raise
    finally:
        atomic_json(evidence, report)
    print("LEGACY_REAL_TRANSITION PASS: real PostgreSQL 261→268, MinIO restore, runtime/WIP preservation, exact official API/Web and normal session")


if __name__ == "__main__":
    destination = Path(os.environ.get("ASAI_LEGACY_EVIDENCE", "/tmp/asai-legacy-transition-evidence.json"))
    run_fixture(destination)
