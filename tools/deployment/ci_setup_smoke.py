"""Disposable GitHub runner: real complete AGE backup and synthetic restore.

This is component/integration evidence. It is not a clean 1Panel installation,
a production archive rehearsal or a test of the user's Yandex account.
"""

import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import secrets
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from asa_manager import first_environment, save_settings
from deployment.backup import PRIVILEGES_SQL, consume_backup_hold, resume_backup_writers, restore_check
from deployment.backup_workflow import run_backup, now
from deployment.contracts import Blocked, file_hash, read_env, require, verify_backup
from deployment.paths import atomic_json
from deployment.releases import discover_release, assert_ci, fetch_images, apply_release_environment, validate_resolved_images
from deployment.setup_acceptance import BROWSER_SHA256, FIXTURE_SHA256, OPS_REVISION, browser_acceptance
from deployment.system import Installation, operation_lock, run


TABLES = ("accounts", "classrooms", "classroom_student_seats", "projects")
OBJECT_NAME = "asa-setup-synthetic-media.txt"
OBJECT_CONTENT = "asa-setup-synthetic-object-content-v1"


def source_file(repository, revision, path):
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "asa-setup-ci"}
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = "Bearer " + token
    url = f"https://api.github.com/repos/{repository}/contents/{path}?ref={revision}"
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as response:
        value = json.load(response)
    require(value.get("type") == "file" and value.get("encoding") == "base64" and value.get("size", 0) <= 1024**2,
            "CI_SOURCE", "Invalid pinned source artifact.")
    payload = base64.b64decode(value["content"], validate=False)
    blob = b"blob " + str(len(payload)).encode("ascii") + b"\0" + payload
    require(value.get("path") == path and hashlib.sha1(blob).hexdigest() == value.get("sha"),
            "CI_SOURCE_HASH", "Pinned source bytes do not match the Git blob identity.")
    return payload


def sql_container(container, user, database, statement):
    return run(["docker", "exec", "-i", container, "psql", "-XAt", "-v", "ON_ERROR_STOP=1",
                "-U", user, "-d", database], input_data=statement + ";\n", capture=True, timeout=120)


def database_fingerprints(container, user, database):
    values = {}
    for table in TABLES:
        # Material remains private in memory; evidence contains counts/hashes.
        raw = sql_container(container, user, database,
                            f"SELECT COALESCE(json_agg(to_jsonb(t) ORDER BY t.id::text), '[]'::json) FROM {table} t")
        data = json.loads(raw)
        canonical = json.dumps(data, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode()
        values[table] = {"rows": len(data), "sha256": hashlib.sha256(canonical).hexdigest()}
    require(values["accounts"]["rows"] > 0, "CI_CONTROL_DATA", "Synthetic control accounts are missing.")
    return values


def role_fingerprint(container, user, database):
    statement = """SELECT json_agg(t ORDER BY rolname) FROM (
      SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,
             rolreplication,rolbypassrls,rolconnlimit,rolpassword,rolvaliduntil
      FROM pg_authid WHERE rolname !~ '^pg_' AND rolname <> 'asa_ci_restore_admin'
    ) t"""
    data = json.loads(sql_container(container, user, database, statement))
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def wait_command(command, limit=120):
    deadline = time.monotonic() + limit
    while time.monotonic() < deadline:
        try:
            run(command, capture=True, timeout=10)
            return
        except Blocked:
            time.sleep(1)
    raise Blocked("CI_SERVICE_TIMEOUT", "Synthetic service did not become ready.", "Inspect the exact CI job.")


def decrypt_bundle(ciphertext, identity, directory):
    archive = directory / "decrypted.tar"
    run(["age", "--decrypt", "--identity", identity, "--output", archive, ciphertext], capture=True, timeout=120)
    archive.chmod(0o600)
    restored = directory / "decrypted"
    restored.mkdir(mode=0o700)
    total = 0
    with tarfile.open(archive) as bundle:
        for member in bundle:
            relative = PurePosixPath(member.name)
            require(member.isfile() and not relative.is_absolute() and ".." not in relative.parts
                    and "\\" not in member.name and str(relative) == member.name,
                    "CI_ARCHIVE_MEMBER", "Unsafe synthetic backup archive member.")
            total += member.size
            require(total <= 8 * 1024**3, "CI_ARCHIVE_SIZE", "Unexpected synthetic backup size.")
            target = restored.joinpath(*relative.parts)
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with bundle.extractfile(member) as source, target.open("xb") as output:
                os.chmod(target, 0o600)
                shutil.copyfileobj(source, output)
    directories = list(restored.iterdir())
    require(len(directories) == 1 and directories[0].is_dir(), "CI_ARCHIVE_LAYOUT", "Unexpected synthetic recovery layout.")
    verify_backup(directories[0])
    return directories[0]


def object_archive(objects, destination):
    def ownership(member):
        member.uid = member.gid = 1000
        member.uname = member.gname = ""
        return member
    with tarfile.open(destination, "w") as bundle:
        bundle.add(objects, arcname=".", filter=ownership)
    destination.chmod(0o600)


def copy_objects(container, archive):
    with archive.open("rb") as stream:
        run(["docker", "cp", "-a", "-", container + ":/data"], input_file=stream, capture=True, timeout=120)


def owned_remove(kind, name, owner_id):
    label = '{{index .Labels "asa.setup.synthetic"}}' if kind == "volume" else '{{index .Config.Labels "asa.setup.synthetic"}}'
    command = ["docker", "volume", "inspect"] if kind == "volume" else ["docker", "inspect"]
    observed = run([*command, "--format", label, name], capture=True, timeout=30)
    require(observed == owner_id, "CI_CLEANUP_IDENTITY", "Synthetic cleanup ownership differs.")
    run(["docker", "volume", "rm", name] if kind == "volume" else ["docker", "rm", "-f", name], capture=True, timeout=45)


def run_smoke(evidence):
    require(os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("RUNNER_OS") == "Linux",
            "CI_ONLY", "This destructive synthetic test is allowed only in a disposable Linux GitHub runner.")
    require(os.uname().machine == "x86_64", "CI_ARCH", "The supported synthetic profile is amd64.")
    source = Path.cwd()
    source_revision = run(["git", "rev-parse", "HEAD"], capture=True)
    evidence.update(sourceRevision=source_revision, platform="GitHub Actions Ubuntu 24.04 amd64",
                    productionRestore="UNVERIFIED", yandexDelivery="UNVERIFIED", clean1PanelInstall="NOT_RUN",
                    existingServerUpdate="NOT_RUN", checks={})
    release = discover_release()
    assert_ci(release)
    fetch_images(release)
    evidence.update(releaseRevision=release["revision"], schema=release["schema"], publicationRunId=release["publicationRunId"])
    owner_id = uuid.uuid4().hex
    project = "asa-setup-ci-" + owner_id[:12]
    evidence["syntheticProject"] = project
    created_containers, created_volumes = [], []
    install = None
    with tempfile.TemporaryDirectory(prefix="asa-setup-synthetic-") as directory:
        root = Path(directory)
        try:
            (root / ".asa").mkdir(mode=0o700)
            (root / ".asa/diagnostics/store").mkdir(parents=True, mode=0o700)
            for name in ("compose.yaml", "compose.dev.yaml",
                         "apps/web/public/assets/electronics/owner-catalog/manifest.json"):
                destination = root / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(source_file("spikeal8-maker/asa-lab", release["revision"], name))
            first_environment(root, "dev")
            env_path = root / ".env"
            env_path.write_text(env_path.read_text().replace("COMPOSE_PROJECT_NAME=asa-lab-dev", "COMPOSE_PROJECT_NAME=" + project))
            env_path.chmod(0o600)
            install = Installation(root, "dev")
            save_settings(install, enabled=False)
            install = Installation(root, "dev")
            apply_release_environment(install, release)
            validate_resolved_images(install, release)
            install.compose("up", "-d", "--no-build", timeout=300)
            install.wait_ready(release["revision"], release["schema"])
            evidence["checks"]["publishedRuntime"] = "PASS"
            browser_dir = root / "browser-component"
            browser_dir.mkdir(mode=0o700)
            for name, digest in (("browser_acceptance.py", BROWSER_SHA256), ("acceptance_fixture.py", FIXTURE_SHA256)):
                payload = source_file("spikeal8-maker/Server-setings", OPS_REVISION, "scripts/asa_ops/" + name)
                require(hashlib.sha256(payload).hexdigest() == digest, "CI_BROWSER_PIN", "Browser fixture pin differs.")
                (browser_dir / name).write_bytes(payload)
            browser = {"componentPath": str(browser_dir / "browser_acceptance.py"), "componentSha256": BROWSER_SHA256,
                       "pythonPath": os.environ["ASA_SETUP_CI_BROWSER_PYTHON"],
                       "fixturePath": str(root / ".asa/browser/fixture.json"), "timeoutSeconds": 600}
            browser_before = browser_acceptance(install, release, uuid.uuid4().hex, browser)
            evidence["browserBefore"] = browser_before
            require(browser_before["status"] == "passed", "CI_BROWSER_BEFORE", "Synthetic browser acceptance before backup did not pass.")

            prefix = 'mc alias set local http://minio:9000 "$ASA_OBJECT_STORAGE_ACCESS_KEY" "$ASA_OBJECT_STORAGE_SECRET_KEY" >/dev/null; '
            install.compose("run", "--rm", "--no-deps", "--entrypoint", "/bin/sh", "minio-init", "-eu", "-c",
                            prefix + f'printf %s {OBJECT_CONTENT} | mc pipe "local/$ASA_OBJECT_STORAGE_BUCKET/{OBJECT_NAME}"', capture=True, timeout=90)
            identity = root / "synthetic-age-identity.txt"
            run(["age-keygen", "--output", identity], capture=True, timeout=20)
            identity.chmod(0o600)
            recipient = run(["age-keygen", "-y", identity], capture=True, timeout=20)
            operation_id = uuid.uuid4().hex
            policy = {"policy": "best-effort", "ageRecipient": recipient, "cloud": {"enabled": False}, "maxWriteFreezeSeconds": 900}
            with operation_lock(root):
                result = run_backup(install, operation_id=operation_id, installation_id=install.settings["instanceId"],
                                    policy=policy, hold_writers=True)
                require(result["outcome"] == "WARNING" and result["local"]["status"] == result["encryption"]["status"] == "OK"
                        and result["cloud"]["status"] == "NOT_CONFIGURED", "CI_BACKUP", "Synthetic AGE backup was not verified.")
                records = install.identity()
                postgres = records["postgres"]["id"]
                before = database_fingerprints(postgres, install.env["POSTGRES_USER"], install.env["POSTGRES_DB"])
                roles_before = role_fingerprint(postgres, install.env["POSTGRES_USER"], install.env["POSTGRES_DB"])
                source_config_hash = file_hash(root / ".env")
                again = run_backup(install, operation_id=operation_id, installation_id=install.settings["instanceId"],
                                   policy=policy, hold_writers=True)
                require(again["snapshotId"] == result["snapshotId"] and again["encryption"]["sha256"] == result["encryption"]["sha256"],
                        "CI_BACKUP_RETRY", "Repeated operation created a different snapshot or ciphertext.")
                require(len(list((root / "backups").glob("*/manifest.json"))) == 1,
                        "CI_BACKUP_DUPLICATE", "Repeated operation created another complete snapshot.")
                consume_backup_hold(install, operation_id)
                resume_backup_writers(install, operation_id)
            evidence.update(operationId=operation_id, snapshotId=result["snapshotId"], snapshotAt=result["snapshotAt"],
                            controlFingerprints=before, ciphertextSha256=result["encryption"]["sha256"])
            evidence["checks"].update(completeLocalBackup="PASS", ageEncryption="PASS", retryNoDuplicate="PASS", writerResume="PASS")
            restored = decrypt_bundle(Path(result["encryption"]["path"]), identity, root)
            manifest = verify_backup(restored)
            require(file_hash(restored / "private.env") == source_config_hash and manifest.get("roleCredentialsIncluded") is True,
                    "CI_PRIVATE_CONFIGURATION", "Private configuration or role-secret backup is incomplete.")
            evidence["checks"].update(ageDecryption="PASS", privateConfigurationIdentity="PASS")

            # Fresh, network-isolated PostgreSQL and a new owned data volume.
            pg_name = project + "-restore-pg"
            pg_volume = pg_name + "-data"
            run(["docker", "volume", "create", "--label", "asa.setup.synthetic=" + owner_id, pg_volume], capture=True)
            created_volumes.append(pg_volume)
            pg_environment = root / "restore-postgres.env"
            pg_environment.write_text("POSTGRES_USER=asa_ci_restore_admin\nPOSTGRES_DB=postgres\nPOSTGRES_PASSWORD=" + secrets.token_hex(24) + "\n")
            pg_environment.chmod(0o600)
            pg_image = run(["docker", "inspect", "--format", "{{.Image}}", postgres], capture=True)
            run(["docker", "create", "--name", pg_name, "--network", "none", "--label", "asa.setup.synthetic=" + owner_id,
                 "--mount", "type=volume,source=" + pg_volume + ",target=/var/lib/postgresql/data", "--env-file", pg_environment, pg_image], capture=True)
            created_containers.append(pg_name)
            run(["docker", "start", pg_name], capture=True)
            wait_command(["docker", "exec", pg_name, "pg_isready", "-U", "asa_ci_restore_admin", "-d", "postgres"])
            with (restored / "globals.sql").open("rb") as stream:
                run(["docker", "exec", "-i", pg_name, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "asa_ci_restore_admin", "-d", "postgres"],
                    input_file=stream, capture=True, timeout=60)
            database = "asalab_setup_full_restore_test"
            run(["docker", "exec", pg_name, "createdb", "-U", "asa_ci_restore_admin", "--owner", install.env["POSTGRES_USER"], database], capture=True)
            with (restored / "database.dump").open("rb") as stream:
                run(["docker", "exec", "-i", pg_name, "sh", "-eu", "-c", "umask 077; cat > /tmp/setup.dump"], input_file=stream, capture=True, timeout=120)
            run(["docker", "exec", pg_name, "pg_restore", "--exit-on-error", "--single-transaction", "-U", "asa_ci_restore_admin",
                 "-d", database, "/tmp/setup.dump"], capture=True, timeout=180)
            require(database_fingerprints(pg_name, "asa_ci_restore_admin", database) == before,
                    "CI_ROW_FINGERPRINTS", "Restored synthetic rows differ from the frozen source.")
            require(role_fingerprint(pg_name, "asa_ci_restore_admin", database) == roles_before,
                    "CI_ROLE_IDENTITIES", "Restored roles, flags or password hashes differ.")
            require(json.loads(sql_container(pg_name, "asa_ci_restore_admin", database, PRIVILEGES_SQL)) == manifest["applicationPrivileges"],
                    "CI_ACL_RLS", "Restored application ACL/RLS differ.")
            evidence["checks"].update(freshPostgresRestore="PASS", roleAndPasswordIdentity="PASS", controlRowPreservation="PASS", aclRlsPreservation="PASS")

            # Fresh network-isolated MinIO, same credentials, restored actual objects.
            minio_name = project + "-restore-minio"
            minio_volume = minio_name + "-data"
            run(["docker", "volume", "create", "--label", "asa.setup.synthetic=" + owner_id, minio_volume], capture=True)
            created_volumes.append(minio_volume)
            private = read_env(restored / "private.env")
            minio_environment = root / "restore-minio.env"
            minio_environment.write_text("MINIO_ROOT_USER=" + private["ASA_OBJECT_STORAGE_ACCESS_KEY"] + "\nMINIO_ROOT_PASSWORD=" + private["ASA_OBJECT_STORAGE_SECRET_KEY"] + "\n")
            minio_environment.chmod(0o600)
            run(["docker", "create", "--name", minio_name, "--network", "none", "--label", "asa.setup.synthetic=" + owner_id,
                 "--user", "1000:1000", "--read-only", "--tmpfs", "/tmp:uid=1000,gid=1000,mode=0700,size=64m",
                 "--mount", "type=volume,source=" + minio_volume + ",target=/data", "--env-file", minio_environment,
                 release["images"]["minio"], "server", "/data"], capture=True)
            created_containers.append(minio_name)
            objects_archive = root / "restored-objects.tar"
            object_archive(restored / "objects", objects_archive)
            copy_objects(minio_name, objects_archive)
            run(["docker", "start", minio_name], capture=True)
            wait_command(["docker", "exec", minio_name, "curl", "-fsS", "http://127.0.0.1:9000/minio/health/live"])
            observed = run(["docker", "exec", minio_name, "sh", "-eu", "-c",
                            'export MC_CONFIG_DIR=/tmp/.mc; mc alias set local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; '
                            f'mc cat "local/{private["ASA_OBJECT_STORAGE_BUCKET"]}/{OBJECT_NAME}"'], capture=True, timeout=60)
            require(observed == OBJECT_CONTENT, "CI_OBJECT_RESTORE", "Restored object is unavailable through authenticated S3.")
            evidence["checks"]["freshMinioAuthenticatedS3Restore"] = "PASS"

            # Integrate the restored DB with the real restricted-role API. This
            # additional target is *_test in the disposable source cluster only.
            test_database = "asalab_setup_api_restore_test"
            restore_check(install, restored, test_database)
            install.compose("run", "--rm", "--no-deps", "--entrypoint", "/bin/sh", "minio-init", "-eu", "-c",
                            prefix + f'mc rm "local/$ASA_OBJECT_STORAGE_BUCKET/{OBJECT_NAME}"', capture=True, timeout=60)
            writers = [name for name in ("web", "api", "scratch", "search", "minio") if name in records]
            install.compose("stop", *writers, timeout=60)
            copy_objects(records["minio"]["id"], objects_archive)
            install.compose("start", *writers, timeout=60)
            install.wait_ready(release["revision"], release["schema"])
            install.compose("run", "--rm", "--no-deps", "--entrypoint", "/bin/sh", "minio-init", "-eu", "-c",
                            prefix + f'test "$(mc cat "local/$ASA_OBJECT_STORAGE_BUCKET/{OBJECT_NAME}")" = {OBJECT_CONTENT}', capture=True, timeout=60)
            install.process_env["APP_DATABASE_URL"] = install.env["APP_DATABASE_URL"].rsplit("/", 1)[0] + "/" + test_database
            install.compose("up", "-d", "--no-build", "--no-deps", "api", timeout=120)
            install.wait_ready(release["revision"], release["schema"])
            body = json.dumps({"workspace": install.env["ASA_SEED_WORKSPACE"], "email": install.env["ASA_SEED_TEACHER_EMAIL"],
                               "password": install.env["ASA_SEED_TEACHER_PASSWORD"]}).encode()
            request = urllib.request.Request("http://127.0.0.1:4610/api/auth/login", data=body,
                                             headers={"Content-Type": "application/json", "Origin": "http://127.0.0.1:4610"})
            with urllib.request.urlopen(request, timeout=15) as response:
                require(response.status in (200, 201), "CI_RESTORED_LOGIN", "Restricted-role API login failed against restored database.")
            browser_after = browser_acceptance(install, release, uuid.uuid4().hex, browser)
            evidence["browserAfter"] = browser_after
            require(browser_after["status"] == "passed", "CI_BROWSER_AFTER", "Synthetic restored browser journeys did not pass.")
            evidence["checks"].update(restoredApiLogin="PASS", restoredBrowserJourneys="PASS", restoredSourceObject="PASS")
            evidence["status"] = "PASS"
        finally:
            failures = []
            for name in reversed(created_containers):
                try:
                    owned_remove("container", name, owner_id)
                except (Blocked, OSError, ValueError) as exc:
                    failures.append(getattr(exc, "code", "CI_CLEANUP_FAILED"))
            for name in reversed(created_volumes):
                try:
                    owned_remove("volume", name, owner_id)
                except (Blocked, OSError, ValueError) as exc:
                    failures.append(getattr(exc, "code", "CI_CLEANUP_FAILED"))
            if install is not None:
                try:
                    # Root and project were freshly generated in this invocation.
                    require(install.project == project and install.root == root, "CI_CLEANUP_IDENTITY", "Cleanup target changed.")
                    install.compose("down", "--volumes", "--remove-orphans", timeout=120)
                except (Blocked, OSError, ValueError) as exc:
                    failures.append(getattr(exc, "code", "CI_CLEANUP_FAILED"))
            evidence["cleanup"] = {"status": "FAILED" if failures else "PASS", "errors": failures}
            if failures:
                evidence["status"] = "FAIL"


def main():
    evidence = {"format": "asa-setup-synthetic-evidence-v1", "startedAt": now(), "status": "FAIL",
                "scope": "disposable Docker full synthetic backup/restore; not 1Panel-host or real-cloud acceptance"}
    destination = Path.cwd() / "test-results/setup-synthetic/evidence.json"
    try:
        run_smoke(evidence)
    except BaseException as exc:
        # Neither provider stderr, generated credentials nor row contents leave
        # private temporary storage, even when a fixture or external service fails.
        evidence["errorCode"] = getattr(exc, "code", type(exc).__name__)
        evidence["status"] = "FAIL"
    finally:
        evidence["finishedAt"] = now()
        atomic_json(destination, evidence)
    print("ASA_SETUP_SYNTHETIC " + evidence["status"]
          + "; errorCode=" + evidence.get("errorCode", "NONE")
          + "; browserReason=" + evidence.get("browserBefore", {}).get("reasonCode", "NONE")
          + "; evidence=test-results/setup-synthetic/evidence.json")
    return 0 if evidence["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
