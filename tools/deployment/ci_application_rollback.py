"""Native disposable proof using official images and the unmodified manager CLI.

Linux CI and an explicitly selected Windows Docker Desktop test host use this
same Python driver. No production root is accepted and no guard is patched.
"""

import argparse
import copy
import datetime as dt
import http.cookiejar
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asa_manager as manager
from deployment import application_rollback as ar
from deployment.collector import prepare as prepare_collector
from deployment.contracts import Blocked, require
from deployment.fresh_install import fresh_options, assert_clean_install_destination
from deployment.paths import plain_paths
from deployment.releases import (apply_release_environment, assert_ci, assert_general_ci,
                                 discover_release, fetch_images, validate_deployment_digest,
                                 validate_resolved_images)
from deployment.system import Installation, run

PRODUCT_DEPLOYMENT = "sha256:87acd65905c3cb64c1052ea046926932b1a5e9f42dc52d8b36c05db9f449da68"
FIXTURE_PROJECT_PREFIX = "asa-lab-p0-return-"


def new_fixture_project():
    return FIXTURE_PROJECT_PREFIX + uuid.uuid4().hex[:12]


def cleanup_fixture(root, project, nonce, own_env_hash):
    """Remove only this run's fresh synthetic stack after every ownership check."""
    current = Installation(root, "dev")
    require(current.project == project and
            re.fullmatch(re.escape(FIXTURE_PROJECT_PREFIX) + r"[a-f0-9]{12}", project) and
            ar._read(current.state / "qualification-fixture.json") == {"nonce": nonce, "root": str(root), "project": project}
            and own_env_hash == ar.file_digest(root / ".env"), "FIXTURE_CLEANUP", "Disposable ownership drift; fixture retained.")
    ar._clean(root)
    current.identity(existing=False)
    current.compose("down", "--volumes", "--remove-orphans")


def protect_new_fixture_root(root):
    """Only the caller's freshly created empty/synthetic directory, never --root."""
    root = Path(root)
    plain_paths(root, ())
    require(root.is_dir() and not (root / ".asa").exists() and not (root / ".env").exists(),
            "FIXTURE_PRIVATE_ROOT", "Private fixture preparation must precede every state or secret file.")
    if os.name != "nt":
        os.chmod(root, 0o700)
        return
    script = r"""
$ErrorActionPreference = 'Stop'
$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
$inherit = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
foreach ($sid in @($current.Value, 'S-1-5-18', 'S-1-5-32-544')) {
  $identity = New-Object System.Security.Principal.SecurityIdentifier($sid)
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', $inherit, 'None', 'Allow')
  $acl.AddAccessRule($rule)
}
# Persist only the modified DACL. Set-Acl can request SACL privileges even
# for this new fixture; the existing owner, group and audit state must remain.
$directory = New-Object System.IO.DirectoryInfo($env:ASA_RETURN_FIXTURE_PATH)
$directory.SetAccessControl($acl)
"""
    run(["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
        env={**os.environ, "ASA_RETURN_FIXTURE_PATH": str(root)}, capture=True)
    ar.attest_access([(root, True)])


def native_path_proof():
    with tempfile.TemporaryDirectory(prefix="ASA native путь возврата ") as temporary:
        protect_new_fixture_root(Path(temporary))
        path = Path(temporary) / "private state" / "journal.json"
        ar._write(path, {"phase": "prepared"})
        ar._write(path, {"phase": "rollback_source"})
        script = "import json,pathlib,sys; p=pathlib.Path(sys.argv[1]); print(json.dumps({'path':str(p),'value':json.loads(p.read_text())}))"
        variants = [path]
        if os.name == "nt":
            variants.append(Path("\\\\?\\" + str(path)))
        for variant in variants:
            ar.attest_access([(variant.parent, True), (variant, True)])
            observed = json.loads(run([sys.executable, "-c", script, str(variant)], capture=True))
            require(observed == {"path": str(variant), "value": {"phase": "rollback_source"}},
                    "NATIVE_PATH", "Native argument or atomic journal replacement failed.")
        result = {"host": sys.platform, "python": sys.version.split()[0], "pathWithSpaces": True,
                  "unicodePath": True, "windowsExtendedPath": os.name == "nt", "atomicReplace": True,
                  "childArgumentRoundtrip": True, "privateStateAttested": True, "dockerRun": False}
        print("NATIVE_PATH_PROOF " + json.dumps(result, sort_keys=True))
        return result


def ports():
    for attempt in range(30):
        sockets = []
        try:
            for port in (0, None, 0):
                stream = socket.socket()
                sockets.append(stream)
                stream.bind(("127.0.0.1", sockets[0].getsockname()[1] + 1 if port is None else port))
            return sockets[0].getsockname()[1], sockets[2].getsockname()[1]
        except OSError:
            pass
        finally:
            for stream in sockets:
                stream.close()
    raise Blocked("FIXTURE_PORTS", "Could not allocate independent loopback ports.", "Free resources on the selected test host.")


def previous_manifest():
    # Bootstrap resolves the old official full-SHA tag once to a repo digest;
    # the manifest must still match the hard-coded accepted image set and CI.
    reference = ar.REGISTRY + "/deployment:" + ar.PREVIOUS
    run(["docker", "pull", reference])
    values = json.loads(run(["docker", "image", "inspect", "--format", "{{json .RepoDigests}}", reference], capture=True))
    choices = [value for value in values if re.fullmatch(re.escape(ar.REGISTRY + "/deployment@sha256:") + r"[a-f0-9]{64}", value)]
    require(len(choices) == 1, "FIXTURE_RELEASE", "Cannot identify the old official deployment digest.")
    digest = choices[0].split("@", 1)[1]
    previous = discover_release(digest)
    require(previous["revision"] == ar.PREVIOUS, "FIXTURE_RELEASE", "Old deployment tag does not identify the declared previous release.")
    ar._pinned_images(previous, ar.PREVIOUS_IMAGES)
    assert_ci(previous)
    return previous, digest


class Client:
    def __init__(self, install):
        self.origin = install.env["ASA_UPDATE_ENTRY_ORIGIN"]
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.call("POST", "/api/auth/login", {"workspace": install.env["ASA_SEED_WORKSPACE"],
                  "email": install.env["ASA_SEED_TEACHER_EMAIL"], "password": install.env["ASA_SEED_TEACHER_PASSWORD"]})

    def call(self, method, path, body=None):
        request = urllib.request.Request(self.origin + path, method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "Origin": self.origin, "Sec-Fetch-Site": "same-origin",
                     "Idempotency-Key": str(uuid.uuid4())})
        with self.opener.open(request, timeout=30) as response:
            require(response.status in (200, 201), "FIXTURE_API", "Synthetic API request failed.")
            return json.load(response)

    def write(self, label, value):
        created = self.call("POST", "/api/projects", {"module": "electronics", "scope": "personal", "title": "Synthetic P0 " + label})
        identity = created["project"]["id"]
        opened = self.call("GET", "/api/projects/" + identity)
        document = {"schemaVersion": 4, "components": [{"id": "r0", "kind": "resistor", "electricalModelId": "resistor",
                    "electricalModelVersion": 1, "modelProfileId": "legacy-resistor", "modelProfileVersion": 1,
                    "name": "R0", "position": {"x": 100, "y": 100}, "value": value, "rotation": 0}],
                    "connections": [], "viewport": {"x": value, "y": 0, "zoom": 1},
                    "simulation": {"running": False, "maxIterations": 24}}
        saved = self.call("PUT", f"/api/projects/{identity}/draft", {"document": document,
                          "baseRevision": opened["draft"]["revision"], "mutationId": str(uuid.uuid4())})
        expected = {"id": identity, "revision": saved["draft"]["revision"], "documentSha256": ar.digest(document)}
        self.read(expected)
        return expected

    def read(self, expected):
        reopened = self.call("GET", "/api/projects/" + expected["id"])
        require(reopened["draft"]["revision"] == expected["revision"] and
                ar.digest(reopened["draft"]["document"]) == expected["documentSha256"],
                "FIXTURE_READBACK", "Acknowledged synthetic project content or revision was lost.")
        return dict(expected)


def object_io(install, key, value=None):
    prefix = 'mc alias set local http://minio:9000 "$ASA_OBJECT_STORAGE_ACCESS_KEY" "$ASA_OBJECT_STORAGE_SECRET_KEY" >/dev/null; '
    script = (prefix + 'mc cat "local/$ASA_OBJECT_STORAGE_BUCKET/$ASA_QUALIFICATION_KEY"' if value is None else
              prefix + 'printf "%s" "$ASA_QUALIFICATION_VALUE" | mc pipe "local/$ASA_OBJECT_STORAGE_BUCKET/$ASA_QUALIFICATION_KEY" >/dev/null')
    arguments = ["run", "--rm", "--no-deps", "--pull", "never", "--entrypoint", "/bin/sh",
                 "-e", "ASA_QUALIFICATION_KEY=" + key]
    if value is not None:
        arguments += ["-e", "ASA_QUALIFICATION_VALUE=" + value]
    result = install.compose(*arguments, "minio-init", "-eu", "-c", script, capture=True)
    return result if value is None else object_io(install, key)


def terminate_owned_process(process):
    if process.poll() is not None:
        return
    if os.name == "nt":
        run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture=True)
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.wait(timeout=30)


def cli(tool_root, root, action, log, *, selected_digest=None, interruption=None, expected_revision=None):
    command = [sys.executable, str(tool_root / "tools/asa_manager.py"), action, "--root", str(root), "--profile", "dev"]
    if action in ("check", "update"):
        command += ["--deployment-digest", selected_digest, "--require-application-rollback"]
    original = ar._read(root / ".asa" / ar.JOURNAL, optional=True)
    original_id = original["id"] if original else None
    for retry in range(2):
        with log.open("ab") as output:
            options = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" else {"start_new_session": True}
            process = subprocess.Popen(command, cwd=tool_root, stdout=output, stderr=subprocess.STDOUT, **options)
            deadline = time.monotonic() + 1800
            evidence = None
            try:
                while process.poll() is None:
                    require(time.monotonic() < deadline, "FIXTURE_TIMEOUT", "Native manager command exceeded thirty minutes.")
                    if interruption:
                        journal = ar._read(root / ".asa" / ar.JOURNAL, optional=True)
                        if journal and journal["phase"] == interruption and (action == "rollback" or journal["id"] != original_id):
                            install = Installation(root, "dev")
                            records = install.identity()
                            expected = journal["eligibility"]["previous" if action == "rollback" else "selected"]
                            if records.get("api", {}).get("image") == expected["images"]["api"] and records.get("api", {}).get("running"):
                                evidence = {"phase": interruption, "operationId": journal["id"], "source": install.git("rev-parse", "HEAD"),
                                            "apiImage": records["api"]["image"], "postgresContainer": records["postgres"]["id"]}
                                require(evidence["source"] == expected_revision, "FIXTURE_INTERRUPTION", "Source transition was not observed before interruption.")
                                if ar.load_journal(install)["phase"] != interruption:
                                    continue
                                terminate_owned_process(process)
                                require(process.returncode != 0 and ar.load_journal(install)["phase"] == interruption,
                                        "FIXTURE_INTERRUPTION", "The manager did not stop at the observed durable partial switch.")
                                return evidence
                    time.sleep(0.05)
            finally:
                # Timeout/observer failure must not leave a live manager racing
                # the fixture's scoped cleanup or its next recovery command.
                terminate_owned_process(process)
        if process.returncode == 0:
            require(interruption is None, "FIXTURE_INTERRUPTION", "The requested actual partial switch was not observed; no interruption proof is claimed.")
            return None
        if retry == 0 and "BLOCKED RETRY_NEW_MANAGER:" in log.read_text(encoding="utf-8", errors="replace"):
            continue
        raise Blocked("FIXTURE_MANAGER", "Native manager command failed; its private synthetic log is retained.", "Inspect the qualification output; do not apply to production.")
    raise Blocked("FIXTURE_MANAGER", "Source continuation exceeded its bounded retry.", "Inspect the selected source.")


def qualify(arguments):
    tool_root = Path(__file__).resolve().parents[2]
    root = arguments.work_directory
    require(root is not None and root.is_absolute() and not root.exists(), "FIXTURE_ROOT",
            "Choose an absolute, absent disposable work directory; existing installations are refused.")
    plain_paths(root, ())
    require(root.parent.is_dir() and not root.is_relative_to(tool_root) and not tool_root.is_relative_to(root),
            "FIXTURE_ROOT", "The disposable installation and pinned tools must be physically separate.")
    output = arguments.output
    require(output is not None and output.is_absolute() and not output.is_relative_to(root) and not output.is_relative_to(tool_root),
            "FIXTURE_OUTPUT", "Keep qualification evidence outside both Git checkouts.")
    plain_paths(output, ())
    output.mkdir(parents=True, exist_ok=True)
    validate_deployment_digest(arguments.selected_deployment_digest)
    ar._clean(tool_root)
    tool_revision = run(["git", "rev-parse", "HEAD"], cwd=tool_root, capture=True)
    run(["git", "merge-base", "--is-ancestor", tool_revision, "origin/main"], cwd=tool_root, capture=True)
    assert_general_ci(tool_revision)
    previous, previous_digest = previous_manifest()
    selected = discover_release(arguments.selected_deployment_digest)
    assert_ci(selected)
    fetch_images(previous)
    fetch_images(selected)
    project, nonce = new_fixture_project(), uuid.uuid4().hex
    report = {"format": "asa-application-return-qualification-v1", "startedAt": ar.stamp(), "host": sys.platform,
              "python": sys.version.split()[0], "toolingRevision": tool_revision, "profile": "dev", "project": project,
              "previousDeploymentDigest": previous_digest, "selectedDeploymentDigest": arguments.selected_deployment_digest,
              "previousRelease": previous, "selectedRelease": selected, "status": "in_progress", "readbacks": [], "interruptions": []}
    install, own_env_hash = None, None
    try:
        run(["git", "clone", "--no-hardlinks", "--no-checkout", str(tool_root), str(root)])
        run(["git", "remote", "set-url", "origin", f"https://github.com/{ar.REPOSITORY}.git"], cwd=root)
        run(["git", "fetch", "origin", "refs/heads/main:refs/remotes/origin/main"], cwd=root)
        run(["git", "switch", "--detach", ar.PREVIOUS], cwd=root)
        protect_new_fixture_root(root)
        web, blocks = ports()
        spec = fresh_options(project, web, blocks)
        assert_clean_install_destination(root, spec)
        manager.first_environment(root, "dev", project=project, web_port=web, blocks_port=blocks)
        install = Installation(root, "dev")
        prepare_collector(install)
        install = Installation(root, "dev")
        manager.save_settings(install, False)
        ar._write(install.state / "installed-release.json", previous)
        ar._write(install.state / "qualification-fixture.json", {"nonce": nonce, "root": str(root), "project": project})
        install = Installation(root, "dev")
        own_env_hash = ar.file_digest(root / ".env")
        ar.validate_pair(install, previous, selected)
        apply_release_environment(install, previous)
        validate_resolved_images(install, previous)
        # Existing portable CI fixture bootstrap, with the canonical first-env
        # helper and real prebuilt images. This fresh, empty database is the
        # only stage that performs migrations/seeding. Return never does so.
        install.compose("up", "-d", "--no-build")
        install.wait_ready(previous["revision"], previous["schema"])
        initial_pg = install.identity()["postgres"]["id"]
        client = Client(install)
        projects = [client.write("before", 1101)]
        objects = {f"qualification/{nonce}/before.txt": "synthetic-before-" + nonce}
        for key, value in objects.items():
            require(object_io(install, key, value) == value, "FIXTURE_OBJECT", "Initial S3 write did not read back.")

        def readback(stage):
            current = Installation(root, "dev")
            active_client = Client(current)
            observed_projects = [active_client.read(item) for item in projects]
            observed_objects = {}
            for key, value in objects.items():
                actual = object_io(current, key)
                require(actual == value, "FIXTURE_OBJECT", "A committed S3 object did not survive application return.")
                observed_objects[key] = ar.digest(actual)
            require(current.identity()["postgres"]["id"] == initial_pg, "FIXTURE_DATABASE", "The original PostgreSQL container was replaced.")
            report["readbacks"].append({"stage": stage, "runtime": current.readiness(), "projects": observed_projects, "objects": observed_objects})

        readback("before_update")
        cli(tool_root, root, "check", output / "preflight.log", selected_digest=arguments.selected_deployment_digest)
        cli(tool_root, root, "update", output / "update.log", selected_digest=arguments.selected_deployment_digest)
        install = Installation(root, "dev")
        projects.append(Client(install).write("after-update", 2202))
        key, value = f"qualification/{nonce}/new.txt", "synthetic-new-write-" + nonce
        objects[key] = value
        require(object_io(install, key, value) == value, "FIXTURE_OBJECT", "Selected runtime S3 write did not read back.")
        readback("selected_new_writes")
        journal = ar.load_journal(install)
        report["firstOperation"] = copy.deepcopy(journal)
        manager.restore_check(install, Path(journal["eligibility"]["backup"]["path"]), "asalab_return_" + nonce[:12] + "_test")
        report["isolatedRestore"] = "pass_new_test_database"
        cli(tool_root, root, "rollback-plan", output / "rollback-plan.log")
        cli(tool_root, root, "rollback", output / "rollback.log")
        readback("old_runtime_reads_new_writes")

        # A real killed forward process leaves mixed images without Web. No
        # product failure hook, test environment bypass or patched guard exists.
        evidence = cli(tool_root, root, "update", output / "interrupted-update.log",
                       selected_digest=arguments.selected_deployment_digest,
                       interruption="forward_api", expected_revision=selected["revision"])
        report["interruptions"].append(evidence)
        # Return itself is then killed after old source and API were observed;
        # repeating the identical external CLI must recover its durable state.
        evidence = cli(tool_root, root, "rollback", output / "interrupted-rollback.log",
                       interruption="rollback_api", expected_revision=previous["revision"])
        report["interruptions"].append(evidence)
        cli(tool_root, root, "rollback", output / "resumed-rollback.log")
        readback("after_both_process_interruptions")
        final = Installation(root, "dev")
        require(final.settings["automaticUpdates"] is False and ar.file_digest(root / ".env") == own_env_hash,
                "FIXTURE_CONFIG", "Automatic update or private environment changed.")
        report["finalOperation"] = ar.load_journal(final)
        report["postgresContainerPreserved"] = True
        report["privateEnvironmentPreserved"] = True
        report["automaticUpdates"] = False
        report["status"] = "pass"
    except BaseException as failure:
        report["status"] = "failed"
        report["failureCode"] = getattr(failure, "code", type(failure).__name__)
        raise
    finally:
        report["finishedAt"] = ar.stamp()
        ar._write(output / "qualification.json", report)
        if install is not None and not arguments.keep_fixture:
            # Delete only this newly allocated synthetic project's containers
            # and volumes. All ownership checks run before the scoped teardown.
            cleanup_fixture(root, project, nonce, own_env_hash)
            report["cleanup"] = "owned_synthetic_project_only"
            ar._write(output / "qualification.json", report)
    print("APPLICATION_RETURN_NATIVE_PASS " + json.dumps({"host": sys.platform, "toolingRevision": tool_revision,
        "selectedDeploymentDigest": arguments.selected_deployment_digest, "report": str(output / "qualification.json")}, sort_keys=True))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path-proof", action="store_true", help="Native file/argument proof only; no Docker, Git or network")
    parser.add_argument("--work-directory", type=Path, help="Absolute absent disposable installation directory")
    parser.add_argument("--output", type=Path, help="Absolute evidence directory outside both checkouts")
    parser.add_argument("--selected-deployment-digest", default=PRODUCT_DEPLOYMENT)
    parser.add_argument("--keep-fixture", action="store_true", help="Retain this newly allocated synthetic stack for operator inspection")
    arguments = parser.parse_args(argv)
    if arguments.path_proof:
        native_path_proof()
        return 0
    qualify(arguments)
    return 0


if __name__ == "__main__":
    sys.exit(main())
