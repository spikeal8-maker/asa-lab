"""Recovery contracts run on private temporary files and a simulated Docker API.

Real PG/MinIO transition evidence belongs to the isolated delivery CI fixture.
"""

import copy
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment import legacy_backup as recovery
from deployment.contracts import Blocked, file_hash


IMAGE_LAYER = b"synthetic image layer"
IMAGE_CONFIG = json.dumps({"rootfs": {"type": "layers", "diff_ids": ["sha256:" + hashlib.sha256(IMAGE_LAYER).hexdigest()]}, "config": {}}, separators=(",", ":")).encode()
IMAGE = "sha256:" + hashlib.sha256(IMAGE_CONFIG).hexdigest()


def saved_image(path, *, config=IMAGE_CONFIG, omit_layer=False, layer=IMAGE_LAYER):
    values = {"manifest.json": json.dumps([{"Config": "config.json", "Layers": ["layer.tar"]}]).encode(),
              "config.json": config}
    if not omit_layer:
        values["layer.tar"] = layer
    with tarfile.open(path, "w") as archive:
        for name, content in values.items():
            info = tarfile.TarInfo(name)
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content))


class Fixture:
    def __init__(self, directory):
        self.root = Path(directory) / "installation"
        self.root.mkdir(mode=0o700)
        self.state = self.root / ".asa"
        self.state.mkdir(mode=0o700)
        self.output = Path(directory) / "private-backups"
        self.output.mkdir(mode=0o700)
        self.project, self.profile = "asa-lab-dev", "dev"
        self.env = {"POSTGRES_DB": "asalab", "POSTGRES_USER": "asalab_admin"}
        self.files = ["compose.yaml", "compose.dev.yaml", ".asa/local-review/compose.review.yaml"]
        inputs = {".env": b"COMPOSE_PROJECT_NAME=asa-lab-dev\r\nASA_OBJECT_STORAGE_ACCESS_KEY=private-access\r\nASA_OBJECT_STORAGE_SECRET_KEY=private-secret\r\n",
                  "compose.yaml": b"name: test\r\nservices: {}\r\n",
                  "compose.dev.yaml": b"services: {}\n",
                  ".asa/local-review/compose.review.yaml": b"# real WIP bytes\r\nservices: {}\r\n",
                  "apps/api/src/changed.ts": b"export const answer = 42;\r\n",
                  "packages/contracts/dist/a.js": b"module.exports = 42;\n"}
        for relative, content in inputs.items():
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        self.records = {name: {"id": format(index + 1, "064x"), "image": "old-" + name,
                              "imageId": IMAGE, "running": name not in {"migration", "minio-init"}, "mounts": []}
                        for index, name in enumerate(sorted(recovery.SERVICES))}
        self.snapshot = {"root": str(self.root), "project": self.project, "profile": self.profile, "files": self.files,
                         "entryOrigin": "http://127.0.0.1:4610", "containers": copy.deepcopy(self.records),
                         "inputs": {relative: {"bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}
                                    for relative, content in inputs.items()},
                         "runtime": {"kind": "legacy-review", "api": {"revision": "a" * 40, "schema": 261},
                                     "web": {"revision": None, "status": "unverified", "reason": "html"}},
                         "git": {"head": "b" * 40, "branch": "review", "indexHash": "c" * 64, "status": " M sample"}}
        self.commands, self.validations = [], []
        self.schema, self.database_exists = 261, False

    def identity(self):
        return self.records

    def revalidate(self, snapshot=None, *, allow_stopped=False):
        self.validations.append(allow_stopped)
        recovery._check_inputs(self.root, self.snapshot["inputs"])

    def legacy_readiness(self, origin):
        return copy.deepcopy(self.snapshot["runtime"])

    def compose(self, *args, **kwargs):
        self.commands.append(("compose", *args))
        if kwargs.get("input_data", "").startswith("SELECT 1 FROM pg_database"):
            return "1" if self.database_exists else ""
        if "CHECK_SQL=" in " ".join(args):
            return "[]"
        return ""

    def database(self, install, command, **kwargs):
        self.commands.append(("database", command))
        if "max(version" in command:
            return str(self.schema)
        if kwargs.get("output"):
            kwargs["output"].write(b"PGDMP\x00\xff\r\n" if "pg_dump " in command else b"-- globals without passwords\n")
        return ""

    def docker(self, args, **kwargs):
        args = [str(value) for value in args]
        self.commands.append(tuple(args))
        if args[:2] in (["docker", "stop"], ["docker", "start"]):
            for record in self.records.values():
                if record["id"] in args[2:]:
                    record["running"] = args[1] == "start"
            return "\n".join(args[2:])
        if args[:3] == ["docker", "inspect", "--format"]:
            return "\n".join(f"{record['id']} {str(record['running']).lower()}" for record in self.records.values() if record["id"] in args[4:])
        if args[:2] == ["docker", "inspect"]:
            return json.dumps([{"Id": record["id"], "Image": record["imageId"], "Config": {"Env": ["PRIVATE=kept-private"]}}
                               for record in self.records.values() if record["id"] in args[2:]])
        if args[:3] == ["docker", "image", "save"]:
            saved_image(args[4])
            return ""
        if args[:2] == ["docker", "export"]:
            with tarfile.open(args[3], "w") as archive:
                content = b"unmounted compiled runtime bytes"
                info = tarfile.TarInfo("workspace/compiled-output.js")
                info.size = len(content)
                archive.addfile(info, io.BytesIO(content))
            return ""
        if args[:2] == ["docker", "cp"]:
            target = Path(args[-1])
            (target / "manifest.json").write_bytes(b"legitimate object with reserved-looking filename")
            (target / "bucket").mkdir()
            (target / "bucket" / "media").write_bytes(b"stored media\x00\xff")
            return ""
        raise AssertionError("Unexpected Docker command: " + repr(args[:3]))


class LegacyBackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.install = Fixture(self.temp.name)
        self.stack = []
        for target, value in (("run", self.install.docker), ("db_command", self.install.database),
                              ("privileges", lambda *a, **k: []), ("upload_dump", lambda *a, **k: None),
                              ("_space_budget", lambda *a: {"requiredHostBytes": 1, "requiredDockerBytes": 1})):
            item = patch.object(recovery, target, side_effect=value)
            self.stack.append(item.start())
            self.addCleanup(item.stop)

    def export(self, **kwargs):
        return recovery.export_legacy_backup(self.install, self.install.snapshot, self.install.output,
                                             revalidate=self.install.revalidate, **kwargs)

    def test_full_copy_keeps_real_nested_configuration_binary_inputs_and_unknown_web(self):
        result = self.export()
        manifest, snapshot = recovery.verify_legacy_backup(result)
        self.assertEqual((result / "configuration/.asa/local-review/compose.review.yaml").read_bytes(),
                         (self.install.root / ".asa/local-review/compose.review.yaml").read_bytes())
        self.assertEqual((result / "private.env").read_bytes(), (self.install.root / ".env").read_bytes())
        self.assertEqual((result / "runtime-inputs/apps/api/src/changed.ts").read_bytes(),
                         (self.install.root / "apps/api/src/changed.ts").read_bytes())
        self.assertIsNone(manifest["runtime"]["web"]["revision"])
        self.assertEqual(manifest["runtime"]["revisionScope"], "api-only")
        self.assertFalse(manifest["legacy"]["restoreVerified"])
        self.assertIn("manifest.json", manifest["legacy"]["objectFiles"])
        self.assertEqual(snapshot, self.install.snapshot)
        self.assertEqual(set(manifest["legacy"]["runtimeFilesystems"]), {"api", "web"})
        self.assertFalse((self.install.state / "installed-release.json").exists())
        self.assertFalse((self.install.state / "maintenance.json").exists())
        stop = next(command for command in self.install.commands if command[:2] == ("docker", "stop"))
        start = next(command for command in self.install.commands if command[:2] == ("docker", "start"))
        expected = tuple(self.install.records[name]["id"] for name in recovery.WRITERS)
        self.assertEqual(stop[2:], expected)
        self.assertEqual(start[2:], expected)
        self.assertNotIn(self.install.records["postgres"]["id"], stop)
        self.assertNotIn(self.install.records["search"]["id"], stop)
        self.assertFalse(any("up" in command or "down" in command for command in self.install.commands))

    def test_leave_stopped_records_exact_resume_ids_for_guarded_switch(self):
        result = self.export(leave_stopped=True)
        receipt = json.loads((self.install.state / "maintenance.json").read_text())
        self.assertEqual(receipt["phase"], "legacy_backed_up")
        self.assertEqual(receipt["backup"], str(result))
        self.assertTrue(self.install.records["postgres"]["running"])
        self.assertFalse(any(self.install.records[name]["running"] for name in recovery.WRITERS))
        self.assertFalse(any(command[:2] == ("docker", "start") for command in self.install.commands))

    def test_copy_failure_keeps_incomplete_set_and_resumes_only_original_writers(self):
        with patch.object(recovery.shutil, "copyfile", side_effect=OSError("synthetic disk failure")), self.assertRaises(OSError):
            self.export()
        partials = list(self.install.output.glob("*.incomplete"))
        self.assertEqual(len(partials), 1)
        self.assertFalse((partials[0] / "manifest.json").exists())
        with self.assertRaises(Blocked) as failure:
            recovery.verify_legacy_backup(partials[0])
        self.assertEqual(failure.exception.code, "LEGACY_BACKUP_INCOMPLETE")
        receipt = json.loads((self.install.state / "maintenance.json").read_text())
        self.assertEqual(receipt["phase"], "legacy_backup_failed")
        self.assertEqual(receipt["resumeStatus"], "verified")
        self.assertTrue(all(self.install.records[name]["running"] for name in recovery.WRITERS))
        self.assertFalse(any("up" in command for command in self.install.commands))

    def test_insufficient_space_does_not_stop_or_create_maintenance(self):
        with patch.object(recovery, "_space_budget", side_effect=Blocked("LEGACY_BACKUP_SPACE", "full", "free space")), self.assertRaises(Blocked):
            self.export()
        self.assertFalse(any(command[:2] == ("docker", "stop") for command in self.install.commands))
        self.assertFalse((self.install.state / "maintenance.json").exists())

    def test_input_drift_refuses_before_stop(self):
        (self.install.root / "apps/api/src/changed.ts").write_bytes(b"new author work")
        with self.assertRaises(Blocked) as failure:
            self.export()
        self.assertEqual(failure.exception.code, "LEGACY_BACKUP_DRIFT")
        self.assertFalse(any(command[:2] == ("docker", "stop") for command in self.install.commands))

    def test_schema_drift_never_restarts_old_app_after_failed_copy(self):
        def change(*args):
            self.install.schema = 268
            raise OSError("synthetic failure")
        with patch.object(recovery.shutil, "copyfile", side_effect=change), self.assertRaises(OSError):
            self.export()
        receipt = json.loads((self.install.state / "maintenance.json").read_text())
        self.assertEqual(receipt["resumeStatus"], "needs_recovery")
        self.assertEqual(receipt["resumeFailureCode"], "LEGACY_BACKUP_SCHEMA")
        self.assertFalse(any(command[:2] == ("docker", "start") for command in self.install.commands))

    def test_image_validation_failure_cannot_publish_complete(self):
        with patch.object(recovery, "verify_image_archive", side_effect=Blocked("LEGACY_BACKUP_IMAGES", "invalid", "inspect")), self.assertRaises(Blocked):
            self.export()
        self.assertFalse(any(path.is_dir() and not path.name.endswith(".incomplete") for path in self.install.output.iterdir()))

    def test_writable_filesystem_export_failure_retains_old_runtime_and_incomplete_copy(self):
        def fail_export(args, **kwargs):
            if args[:2] == ["docker", "export"]:
                raise Blocked("COMMAND", "export failed", "inspect")
            return self.install.docker(args, **kwargs)
        with patch.object(recovery, "run", side_effect=fail_export), self.assertRaises(Blocked):
            self.export()
        self.assertTrue(all(self.install.records[name]["running"] for name in recovery.WRITERS))
        self.assertTrue(list(self.install.output.glob("*.incomplete")))
        self.assertFalse(list(self.install.output.glob("*/manifest.json")))

    def test_unsafe_output_and_input_paths_are_rejected(self):
        with self.assertRaises(Blocked):
            recovery.export_legacy_backup(self.install, self.install.snapshot, self.install.root / "backups", revalidate=self.install.revalidate)
        self.install.snapshot["inputs"]["../foreign-file"] = {"bytes": 0, "sha256": "a" * 64}
        with self.assertRaises(Blocked):
            self.export()
        self.assertFalse(self.install.commands)

    def test_foreign_service_and_running_migration_fail_before_mutation(self):
        self.install.snapshot["containers"]["migration"]["running"] = True
        with self.assertRaises(Blocked) as failure:
            self.export()
        self.assertEqual(failure.exception.code, "LEGACY_BACKUP_WRITER")
        self.assertFalse(self.install.commands)

    def test_saved_image_ids_layers_and_hashes_are_verified(self):
        path = self.install.output / "images.tar"
        saved_image(path)
        self.assertEqual(recovery.verify_image_archive(path, [IMAGE]), [IMAGE])
        saved_image(path, config=b"changed")
        with self.assertRaises(Blocked):
            recovery.verify_image_archive(path, [IMAGE])
        saved_image(path, omit_layer=True)
        with self.assertRaises(Blocked):
            recovery.verify_image_archive(path, [IMAGE])
        saved_image(path, layer=b"damaged actual layer")
        with self.assertRaises(Blocked):
            recovery.verify_image_archive(path, [IMAGE])

    def test_tampered_nested_configuration_or_object_is_rejected(self):
        backup = self.export()
        (backup / "configuration/.asa/local-review/compose.review.yaml").write_bytes(b"changed")
        with self.assertRaises(Blocked):
            recovery.verify_legacy_backup(backup)

    def test_restore_target_and_authorization_are_checked_before_any_restore(self):
        for database, authorization in (("asalab", True), ("already;DROP DATABASE asalab_test", True), ("safe_test", False), ("safe_test", 1)):
            with self.subTest(database=database, authorization=authorization), self.assertRaises(Blocked):
                recovery.verify_legacy_restore(self.install, self.install.output, database, object_sandbox=authorization)
        self.assertFalse(self.install.commands)

    def test_standard_restore_receipt_is_external_and_does_not_rewrite_complete_backup(self):
        backup = self.export()
        original = file_hash(backup / "manifest.json")
        def objects(backup, snapshot, manifest, temporary, receipt, persist):
            receipt["objectRecovery"] = {"status": "verified"}
            receipt["sandbox"] = {"cleanup": "verified"}
        with patch.object(recovery, "_restore_objects", side_effect=objects):
            result = recovery.verify_legacy_restore(self.install, backup, "legacy_recovery_test", object_sandbox=True)
        self.assertEqual(result["status"], "verified")
        self.assertEqual(result["databaseRecovery"], "verified_acl_rls")
        self.assertFalse(Path(result["receipt"]).is_relative_to(backup))
        self.assertEqual(file_hash(backup / "manifest.json"), original)
        calls = [command for command in self.install.commands if "pg_restore" in command]
        self.assertTrue(any("--single-transaction" in command and "legacy_recovery_test" in command for command in calls))
        self.assertFalse(any("dropdb" in command for command in self.install.commands))

    def test_existing_test_database_is_not_dropped_or_replaced(self):
        backup = self.export()
        self.install.database_exists = True
        with patch.object(recovery, "_restore_objects") as objects, self.assertRaises(Blocked) as failure:
            recovery.verify_legacy_restore(self.install, backup, "existing_test", object_sandbox=True)
        self.assertEqual(failure.exception.code, "RESTORE_EXISTS")
        objects.assert_not_called()
        self.assertFalse(any("dropdb" in command for command in self.install.commands))
        sidecar = next(self.install.output.glob("*.restore-*.json"))
        self.assertEqual(json.loads(sidecar.read_text())["status"], "failed")

    def test_restore_adapter_rejects_a_different_service_or_compose_action(self):
        adapter = recovery._RestoreInstallation(self.install, self.install.snapshot)
        for args in (("up", "-d"), ("exec", "-T", "api", "sh"), ("exec", "-T", "-e", "X=y", "web", "sh")):
            with self.subTest(args=args), self.assertRaises(Blocked):
                adapter.compose(*args)
        self.assertFalse(self.install.commands)

    def test_object_restore_uses_only_its_new_volume_exact_image_and_private_credentials(self):
        backup = self.export()
        manifest, snapshot = recovery.verify_legacy_backup(backup)
        calls, state, receipt = [], {}, {}
        cid = "f" * 64
        def docker(args, **kwargs):
            args = list(map(str, args))
            calls.append(args)
            if args[:3] == ["docker", "volume", "create"]:
                state["volume"] = args[-1]
                state["token"] = next(item.split("=", 1)[1] for item in args if item.startswith("asa.legacy.restore="))
                return state["volume"]
            labels = {"asa.legacy.restore": state.get("token"), "asa.operation": "legacy-restore-check"}
            if args[:3] == ["docker", "volume", "inspect"]:
                return json.dumps([{"Name": state["volume"], "Labels": labels}])
            if args[:2] == ["docker", "create"]:
                self.assertEqual(args[args.index("--network") + 1], "none")
                self.assertIn(IMAGE, args)
                self.assertNotIn("-p", args)
                self.assertNotIn("--publish", args)
                self.assertIn("MINIO_ROOT_PASSWORD=private-secret", Path(args[args.index("--env-file") + 1]).read_text())
                state["container"] = cid
                return cid
            if args[:2] == ["docker", "inspect"]:
                return json.dumps([{"Id": cid, "Name": "/" + state["volume"], "Image": IMAGE, "Config": {"Labels": labels}}])
            if args[:2] == ["docker", "cp"]:
                if args[2] == "-a":
                    with tarfile.open(fileobj=kwargs["input_file"]) as archive:
                        files = {item.name: item for item in archive if item.isfile()}
                        self.assertTrue(files)
                        self.assertTrue(all(item.uid == item.gid == 1000 for item in files.values()))
                else:
                    target = Path(args[-1])
                    for relative in manifest["legacy"]["objectFiles"]:
                        file = target / relative
                        file.parent.mkdir(parents=True, exist_ok=True)
                        file.write_bytes((backup / "objects" / relative).read_bytes())
                return ""
            if args[:2] == ["docker", "start"]:
                return cid
            if args[:3] == ["docker", "ps", "-aq"]:
                self.assertIn("--no-trunc", args)
                return state.get("container", "")
            if args[:4] == ["docker", "volume", "ls", "-q"]:
                return state.get("volume", "")
            if args[:3] == ["docker", "rm", "--force"]:
                self.assertEqual(args[-1], cid)
                state.pop("container")
                return cid
            if args[:3] == ["docker", "volume", "rm"]:
                return state.pop("volume")
            self.fail("Unexpected command " + repr(args[:3]))
        with tempfile.TemporaryDirectory(dir=self.install.output) as folder, patch.object(recovery, "run", side_effect=docker), \
                patch.object(recovery, "_minio_ready", return_value={"readable": True, "bucketCount": 1}):
            recovery._restore_objects(backup, snapshot, manifest, Path(folder), receipt, lambda: None)
        self.assertEqual(receipt["objectRecovery"]["status"], "verified")
        self.assertEqual(receipt["sandbox"]["cleanup"], "verified")
        self.assertFalse(any("private-secret" in arg or "private-access" in arg for command in calls for arg in command))
        self.assertFalse(any(self.install.records["minio"]["id"] in command for command in calls))

    def test_space_budget_measures_images_objects_database_and_docker_filesystem(self):
        def run_budget(free):
            responses = ["1024", "2048\n2048", "8\t/data", "Filesystem 1024-blocks Used Available Capacity Mounted\nvolume 1000000 1 999999 1% /data"]
            with patch.object(recovery, "run", side_effect=responses), patch.object(recovery, "db_command", return_value="1024"), \
                    patch.object(recovery.shutil, "disk_usage", return_value=SimpleNamespace(free=free)):
                # setUp mocks the top-level budget for export tests; call the
                # function retained before that patch here.
                return SPACE_BUDGET(self.install, self.install.records, self.install.snapshot["inputs"], self.install.output)
        with self.assertRaises(Blocked) as failure:
            run_budget(1)
        self.assertEqual(failure.exception.code, "LEGACY_BACKUP_SPACE")
        self.assertGreater(run_budget(10**12)["requiredHostBytes"], 256 * 1024**2)

    @unittest.skipIf(sys.platform == "win32", "POSIX fixture permission check")
    def test_public_backup_directory_is_rejected_without_permission_changes(self):
        self.install.output.chmod(0o755)
        with self.assertRaises(Blocked) as failure:
            self.export()
        self.assertEqual(failure.exception.code, "LEGACY_BACKUP_PERMISSIONS")
        self.assertEqual(self.install.output.stat().st_mode & 0o777, 0o755)
        self.assertFalse(self.install.commands)


class SandboxOwnershipTests(unittest.TestCase):
    def test_cleanup_refuses_other_volume_or_unexpected_container_before_deletion(self):
        replies = ["", "foreign-volume"]
        with patch.object(recovery, "run", side_effect=replies) as command, self.assertRaises(Blocked):
            recovery._cleanup_sandbox("asa-legacy-restore-own", "token", IMAGE)
        self.assertFalse(any("rm" in item.args[0] for item in command.call_args_list))

    def test_cleanup_recovers_lost_create_reply_by_exact_operation_labels(self):
        token, name, cid = "own-token", "asa-legacy-restore-own-token", "e" * 64
        labels = {"asa.legacy.restore": token, "asa.operation": "legacy-restore-check"}
        record = {"Id": cid, "Name": "/" + name, "Image": IMAGE, "Config": {"Labels": labels}}
        replies = [cid, name, json.dumps([record]), json.dumps([record]), json.dumps([{"Name": name, "Labels": labels}]), "", "", "", ""]
        with patch.object(recovery, "run", side_effect=replies) as command:
            recovery._cleanup_sandbox(name, token, IMAGE)
        calls = [item.args[0] for item in command.call_args_list]
        self.assertIn(["docker", "rm", "--force", cid], calls)
        self.assertIn(["docker", "volume", "rm", name], calls)
        self.assertTrue(all("--no-trunc" in values for values in calls if values[:3] == ["docker", "ps", "-aq"]))
        self.assertFalse(any("prune" in values or "down" in values for values in calls))

    def test_windows_acl_is_read_only_and_rejects_an_extra_principal(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            for allowed, passes in ((["S-1-5-21-100", "S-1-5-18", "S-1-5-32-544"], True), (["S-1-1-0"], False)):
                acl = {"owner": "S-1-5-21-100", "user": "S-1-5-21-100", "allow": allowed}
                with patch.object(recovery.os, "name", "nt"), patch.object(recovery, "_plain"), \
                        patch.object(recovery, "run", return_value=json.dumps(acl)) as command:
                    if passes:
                        recovery._check_private(path)
                    else:
                        with self.assertRaises(Blocked) as failure:
                            recovery._check_private(path)
                        self.assertEqual(failure.exception.code, "LEGACY_BACKUP_PERMISSIONS")
                self.assertIn("Get-Acl", command.call_args.args[0][-1])
                self.assertNotIn("Set-Acl", command.call_args.args[0][-1])


SPACE_BUDGET = recovery._space_budget


if __name__ == "__main__":
    unittest.main()
