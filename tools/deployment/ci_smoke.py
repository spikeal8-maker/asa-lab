"""Disposable Linux CI only: boot prebuilt images, export, restore and check login."""

import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import subprocess
import tarfile
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from asa_manager import first_environment
from deployment.backup import export_backup, restore_check
from deployment.contracts import require, verify_backup
from deployment.releases import apply_release_environment, validate_resolved_images
from deployment.system import Installation

require(os.environ.get("GITHUB_ACTIONS") == "true", "CI_ONLY", "This test is only allowed in an isolated GitHub runner.")
release = json.loads(Path(sys.argv[1]).read_text())
source = Path.cwd()
with tempfile.TemporaryDirectory(prefix="asa-delivery-") as directory:
    root = Path(directory)
    for file in ("compose.yaml", "compose.dev.yaml"):
        shutil.copyfile(source / file, root / file)
    first_environment(root, "dev")
    env = root / ".env"
    env.write_text(env.read_text().replace("COMPOSE_PROJECT_NAME=asa-lab-dev", "COMPOSE_PROJECT_NAME=asa-lab-ci-delivery"))
    install = Installation(root, "dev")
    apply_release_environment(install, release)
    validate_resolved_images(install, release)
    try:
        install.compose("up", "-d", "--no-build")
        install.wait_ready(release["revision"], release["schema"])
        # Real object-storage write through the S3 client, not a fake volume file.
        install.compose("run", "--rm", "--no-deps", "--entrypoint", "/bin/sh", "minio-init", "-eu", "-c",
                        'mc alias set local http://minio:9000 "$ASA_OBJECT_STORAGE_ACCESS_KEY" "$ASA_OBJECT_STORAGE_SECRET_KEY"; printf "synthetic-project-media" | mc pipe "local/$ASA_OBJECT_STORAGE_BUCKET/delivery-fixture.txt"')
        backup = export_backup(install)
        manifest = verify_backup(backup)
        require(any(name.startswith("objects/") for name in manifest["files"]), "SMOKE", "Object storage was not exported.")
        # Delete the synthetic object through S3, then recover it from the actual
        # exported bytes into the same disposable CI MinIO volume.
        mc_prefix = 'mc alias set local http://minio:9000 "$ASA_OBJECT_STORAGE_ACCESS_KEY" "$ASA_OBJECT_STORAGE_SECRET_KEY" >/dev/null; '
        install.compose("run", "--rm", "--no-deps", "--entrypoint", "/bin/sh", "minio-init", "-eu", "-c",
                        mc_prefix + 'mc rm "local/$ASA_OBJECT_STORAGE_BUCKET/delivery-fixture.txt"')
        install.compose("stop", "minio")
        archive = root / "restore-objects.tar"
        def owner(member):
            member.uid = member.gid = 1000
            member.uname = member.gname = ""
            return member
        with tarfile.open(archive, "w") as output:
            output.add(backup / "objects", arcname=".", filter=owner)
        records = install.identity()
        with archive.open("rb") as input_stream:
            result = subprocess.run(["docker", "cp", "-a", "-", f"{records['minio']['id']}:/data"], stdin=input_stream)
        require(result.returncode == 0, "SMOKE", "Object restore failed.")
        install.compose("start", "minio")
        install.compose("run", "--rm", "--no-deps", "--entrypoint", "/bin/sh", "minio-init", "-eu", "-c",
                        mc_prefix + 'mc ready local; test "$(mc cat "local/$ASA_OBJECT_STORAGE_BUCKET/delivery-fixture.txt")" = synthetic-project-media')
        restore_check(install, backup, "asalab_delivery_restore_test")
        # Point only this disposable CI API at the restored database. This verifies
        # auth under the application's real restricted database role, not the admin.
        install.process_env["APP_DATABASE_URL"] = install.env["APP_DATABASE_URL"].rsplit("/", 1)[0] + "/asalab_delivery_restore_test"
        install.compose("up", "-d", "--no-build", "--no-deps", "api")
        install.wait_ready(release["revision"], release["schema"])
        body = json.dumps({"workspace": install.env["ASA_SEED_WORKSPACE"], "email": install.env["ASA_SEED_TEACHER_EMAIL"], "password": install.env["ASA_SEED_TEACHER_PASSWORD"]}).encode()
        request = urllib.request.Request("http://127.0.0.1:4610/api/auth/login", data=body,
                                         headers={"Content-Type": "application/json", "Origin": "http://127.0.0.1:4610"})
        with urllib.request.urlopen(request, timeout=15) as response:
            require(response.status in (200, 201), "SMOKE", "Login against the restored database failed.")
        with urllib.request.urlopen("http://127.0.0.1:4610/runtime-config.js") as response:
            require(b"http://localhost:4613" in response.read(), "SMOKE", "Runtime origin configuration is missing.")
        with urllib.request.urlopen("http://localhost:4613/") as response:
            require(b'content="http://127.0.0.1:4610"' in response.read(), "SMOKE", "Scratch parent configuration is missing.")
        print("PORTABLE_SMOKE PASS: prebuilt boot, complete backup, ACL/RLS restore, restricted-role login, origins")
    finally:
        # Only this explicitly disposable CI project. No host/developer volumes.
        install.compose("down", "--volumes")
