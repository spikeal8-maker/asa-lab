"""Discovery risk regressions; no Docker/host/data mutations are performed."""

import copy
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment.setup_discovery import classify_installation, data_identity, docker_inventory


def fixture(root, project="custom-school"):
    containers = []
    volumes = []
    for index, (service, target, volume_name) in enumerate((("postgres", "/var/lib/postgresql/data", "postgres-data"),
                                                           ("minio", "/data", "objects"), ("api", None, None)), 1):
        mounts = []
        if volume_name:
            name = project + "_" + volume_name
            source = "/var/lib/docker/volumes/" + name + "/_data"
            volumes.append({"name": name, "driver": "local", "createdAt": "2026-10-29T00:00:00Z",
                            "mountpoint": source, "labels": {"project": project, "volume": volume_name}})
            mounts = [{"Type": "volume", "Name": name, "Source": source, "Destination": target, "RW": True}]
        containers.append({"id": str(index) * 64, "name": project + "-" + service + "-1",
                           "image": "postgres:17.7-bookworm" if service == "postgres" else "ghcr.io/spikeal8-maker/asa-lab/" + service + "@sha256:" + "a" * 64,
                           "imageId": "sha256:" + str(index) * 64, "running": True,
                           "labels": {"project": project, "service": service, "root": str(root),
                                      "files": str(root / "compose.yaml"), "source": None}, "mounts": mounts})
    return {"format": "asa-docker-inventory-v1", "complete": True, "observedAt": "2026-10-29T00:01:00Z",
            "fingerprint": "a" * 64, "daemon": {"id": "daemon-one", "os": "linux", "architecture": "x86_64", "root": "/var/lib/docker"},
            "containers": containers, "volumes": volumes, "images": []}


def private_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_text(json.dumps(value), encoding="utf-8")
    if os.name == "posix":
        path.chmod(0o600)


class DiscoveryClassificationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.inventory = fixture(self.root)
        (self.root / ".env").write_text("COMPOSE_PROJECT_NAME=custom-school\n", encoding="utf-8")
        (self.root / ".env").chmod(0o600)
        private_json(self.root / ".asa/installation.json", {"format": "asa-installation-v1", "instanceId": "installation-one",
                                                           "project": "custom-school", "profile": "production"})
        self.identity = data_identity(self.root, "custom-school", self.inventory, self.inventory["containers"])

    def managed(self, inventory=None, **kwargs):
        return classify_installation(self.root, inventory or self.inventory, saved_identity=self.identity, **kwargs)

    def test_custom_project_is_discovered_by_image_and_root(self):
        result = classify_installation(None, self.inventory, saved_identity=self.identity)
        self.assertEqual(result["state"], "MANAGED")
        self.assertEqual(result["project"], "custom-school")
        self.assertEqual(result["root"], str(self.root))

    def test_existing_legacy_needs_adoption_without_saved_volume_identity(self):
        self.assertEqual(classify_installation(self.root, self.inventory)["state"], "LEGACY")

    def test_stopped_containers_remain_existing_installation(self):
        inventory = copy.deepcopy(self.inventory)
        for item in inventory["containers"]:
            item["running"] = False
        self.assertEqual(self.managed(inventory)["state"], "STOPPED")

    def test_missing_database_volume_blocks_instead_of_fresh(self):
        inventory = copy.deepcopy(self.inventory)
        inventory["volumes"] = inventory["volumes"][1:]
        self.assertEqual(self.managed(inventory)["state"], "PARTIAL")

    def test_recreated_same_name_volume_is_rejected_by_created_at(self):
        inventory = copy.deepcopy(self.inventory)
        inventory["volumes"][0]["createdAt"] = "2026-10-29T00:02:00Z"
        result = self.managed(inventory)
        self.assertEqual(result["state"], "PARTIAL")
        self.assertEqual(result["reasons"][0]["code"], "DATA_IDENTITY_CHANGED")

    def test_different_docker_daemon_cannot_reuse_resource_names(self):
        inventory = copy.deepcopy(self.inventory)
        inventory["daemon"]["id"] = "daemon-two"
        self.assertEqual(self.managed(inventory)["reasons"][0]["code"], "DATA_IDENTITY_CHANGED")

    def test_orphan_volumes_are_not_new_installation(self):
        inventory = copy.deepcopy(self.inventory)
        inventory["containers"] = []
        result = self.managed(inventory)
        self.assertEqual(result["state"], "PARTIAL")
        self.assertEqual(len(result["orphanVolumes"]), 2)

    def test_only_backup_manifest_remains_blocks_fresh_install(self):
        (self.root / ".env").unlink()
        (self.root / ".asa/installation.json").unlink()
        (self.root / ".asa").rmdir()
        snapshot = self.root / "backups" / "20261029T000000Z-1234abcd"
        snapshot.mkdir(parents=True)
        (snapshot / "manifest.json").write_text('{"format":"asa-backup-v1"}', encoding="utf-8")
        inventory = copy.deepcopy(self.inventory)
        inventory["containers"] = []
        inventory["volumes"] = []
        classified = classify_installation(self.root, inventory)
        self.assertEqual(classified["state"], "PARTIAL")
        self.assertEqual(classified["reasons"][0]["code"], "ORPHANED_INSTALLATION")
        self.assertEqual(classified["backupRemnants"], str(self.root / "backups"))

    def test_unknown_docker_failure_is_not_empty(self):
        self.assertEqual(self.managed({"complete": False})["state"], "UNKNOWN")

    def test_missing_env_does_not_reinitialize_existing_containers(self):
        (self.root / ".env").unlink()
        self.assertEqual(self.managed()["reasons"][0]["code"], "ENV_MISSING")

    def test_multiple_installations_require_explicit_root(self):
        inventory = copy.deepcopy(self.inventory)
        second = fixture(self.root / "other", "other-school")
        inventory["containers"] += second["containers"]
        inventory["volumes"] += second["volumes"]
        self.assertEqual(classify_installation(None, inventory)["state"], "AMBIGUOUS")
        self.assertEqual(self.managed(inventory)["state"], "MANAGED")

    def test_project_root_conflict_is_blocked(self):
        inventory = copy.deepcopy(self.inventory)
        inventory["containers"][0]["labels"]["root"] = "/another/installation"
        self.assertEqual(self.managed(inventory)["reasons"][0]["code"], "ROOT_DRIFT")

    def test_duplicate_postgres_is_partial(self):
        inventory = copy.deepcopy(self.inventory)
        inventory["containers"].append(copy.deepcopy(inventory["containers"][0]))
        self.assertEqual(self.managed(inventory)["state"], "PARTIAL")

    def test_known_operation_is_distinct_from_unknown_marker(self):
        (self.root / ".asa/maintenance.json").write_text("{}", encoding="utf-8")
        self.assertEqual(self.managed()["state"], "PARTIAL")
        result = self.managed(pending_operation={"operationId": "operation-one", "installationId": "installation-one",
                                                 "root": str(self.root), "project": "custom-school", "mode": "update"})
        self.assertEqual(result["state"], "INTERRUPTED")
        self.assertEqual(result["operationId"], "operation-one")

    def test_other_installation_operation_cannot_authorize_resume(self):
        result = self.managed(pending_operation={"operationId": "operation-one", "installationId": "another"})
        self.assertEqual(result["state"], "PARTIAL")

    def test_known_partial_first_install_keeps_operation_identity(self):
        inventory = copy.deepcopy(self.inventory)
        inventory["containers"] = []
        result = self.managed(inventory, pending_operation={"operationId": "initial", "installationId": "installation-one",
                                                          "root": str(self.root), "project": "custom-school", "mode": "install"})
        self.assertEqual(result["state"], "INTERRUPTED")

    def test_new_empty_target_requires_complete_absence(self):
        root = self.root / "new"
        inventory = copy.deepcopy(self.inventory)
        inventory["containers"], inventory["volumes"] = [], []
        self.assertEqual(classify_installation(root, inventory)["state"], "FRESH")
        inventory["volumes"] = [{"name": "asa-lab-dev_objects", "labels": {}}]
        self.assertEqual(classify_installation(root, inventory)["state"], "PARTIAL")

    def test_custom_project_orphan_signature_blocks_after_all_metadata_and_containers_are_lost(self):
        inventory = copy.deepcopy(self.inventory)
        inventory["containers"] = []
        inventory["volumes"] = [
            {"name": "school-prod_" + name, "labels": {"project": "school-prod", "volume": name}}
            for name in ("postgres-data", "blocks-object-data", "application-logs")]
        result = classify_installation(self.root / "missing-checkout", inventory)
        self.assertEqual(result["state"], "PARTIAL")
        self.assertEqual(result["reasons"][0]["code"], "EXISTING_ASA_RESOURCES")
        self.assertEqual(set(result["orphanVolumes"]), {row["name"] for row in inventory["volumes"]})
        # Removing Compose labels must not turn the correlated canonical pair
        # into proof of an empty host.
        for row in inventory["volumes"]:
            row["labels"] = {}
        self.assertEqual(classify_installation(self.root / "missing-checkout", inventory)["state"], "PARTIAL")

    def test_unrelated_generic_postgres_volume_does_not_claim_an_asa_installation(self):
        inventory = copy.deepcopy(self.inventory)
        inventory["containers"] = []
        inventory["volumes"] = [{"name": "other-app_postgres-data",
                                 "labels": {"project": "other-app", "volume": "postgres-data"}}]
        self.assertEqual(classify_installation(self.root / "new-target", inventory)["state"], "FRESH")

    def test_distinctive_orphan_object_store_blocks_even_when_postgres_volume_is_missing(self):
        inventory = copy.deepcopy(self.inventory)
        inventory["containers"] = []
        inventory["volumes"] = [{"name": "private-custom-name",
                                 "labels": {"project": "school-prod", "volume": "blocks-object-data"}}]
        self.assertEqual(classify_installation(self.root / "new-target", inventory)["state"], "PARTIAL")

    def test_interrupted_first_lock_without_resources_or_config_can_remain_empty(self):
        root = self.root / "new-target"
        state = root / ".asa"
        state.mkdir(parents=True, mode=0o700)
        lock = state / "operation.lock"
        lock.write_bytes(b"0")
        lock.chmod(0o600)
        (state / "setup-operations").mkdir(mode=0o700)
        inventory = copy.deepcopy(self.inventory)
        inventory["containers"], inventory["volumes"] = [], []
        result = classify_installation(root, inventory)
        self.assertEqual(result["state"], "FRESH")
        self.assertTrue(result["emptyBootstrapState"])
        (state / "unknown.json").write_text("{}")
        self.assertEqual(classify_installation(root, inventory)["state"], "PARTIAL")

    def test_lock_only_state_cannot_hide_existing_orphan_data_or_foreign_project(self):
        root = self.root / "new-target"
        state = root / ".asa"
        state.mkdir(parents=True, mode=0o700)
        lock = state / "operation.lock"
        lock.write_bytes(b"0")
        lock.chmod(0o600)
        # An explicit project is checked again after obtaining the lock.
        result = classify_installation(root, self.inventory, project="custom-school")
        self.assertEqual(result["state"], "PARTIAL")
        self.assertEqual(result["reasons"][0]["code"], "ROOT_DRIFT")
        inventory = copy.deepcopy(self.inventory)
        inventory["containers"] = []
        result = classify_installation(root, inventory, project="custom-school")
        self.assertEqual(result["state"], "PARTIAL")

    def test_data_identity_and_inventory_are_not_mutated(self):
        before = copy.deepcopy(self.inventory)
        self.assertEqual(self.managed()["state"], "MANAGED")
        self.assertEqual(self.inventory, before)

    def test_no_change_is_never_guessed_from_metadata(self):
        result = self.managed()
        self.assertNotEqual(result["state"], "NO_CHANGE")

    def test_asa_container_without_project_cannot_make_host_look_empty(self):
        inventory = copy.deepcopy(self.inventory)
        inventory["containers"][2]["labels"]["project"] = None
        result = classify_installation(self.root / "new", inventory)
        self.assertEqual(result["state"], "PARTIAL")
        self.assertEqual(result["reasons"][0]["code"], "UNATTRIBUTED_ASA")

    def test_foreign_container_sharing_database_volume_blocks(self):
        inventory = copy.deepcopy(self.inventory)
        foreign = copy.deepcopy(inventory["containers"][0])
        foreign["id"] = "f" * 64
        foreign["labels"] = {"project": "foreign-project", "service": "postgres", "root": "/foreign", "source": None}
        inventory["containers"].append(foreign)
        self.assertEqual(self.managed(inventory)["reasons"][0]["code"], "SHARED_DATA_VOLUME")

    @unittest.skipUnless(os.name == "posix", "Linux path contract")
    def test_symlink_private_configuration_is_rejected(self):
        (self.root / ".env").rename(self.root / "private.env")
        (self.root / ".env").symlink_to(self.root / "private.env")
        self.assertEqual(self.managed()["state"], "PARTIAL")


class InventoryExecutionTests(unittest.TestCase):
    def empty_runner(self, args):
        if args[1] == "info":
            return json.dumps({"id": "daemon", "os": "linux", "architecture": "x86_64", "root": "/var/lib/docker"})
        if args[1:3] == ["compose", "version"]:
            return "2.39.4"
        return ""

    def test_truly_empty_daemon_is_complete_with_fingerprint(self):
        result = docker_inventory(self.empty_runner)
        self.assertTrue(result["complete"])
        self.assertEqual(len(result["fingerprint"]), 64)
        self.assertEqual(result["containers"], [])

    def test_docker_unavailable_does_not_return_empty_complete_inventory(self):
        def fail(args):
            raise OSError("socket unavailable")
        result = docker_inventory(fail)
        self.assertFalse(result["complete"])
        self.assertEqual(result["error"]["code"], "DOCKER_UNKNOWN")

    def test_missing_compose_is_unknown_before_any_change(self):
        def runner(args):
            if args[1:3] == ["compose", "version"]:
                raise ValueError("plugin absent")
            return self.empty_runner(args)
        self.assertFalse(docker_inventory(runner)["complete"])

    def test_racing_volume_creation_invalidates_empty_observation(self):
        calls = 0
        def runner(args):
            nonlocal calls
            if args[1:3] == ["volume", "ls"]:
                calls += 1
                return "" if calls == 1 else "asa-lab-dev_objects"
            return self.empty_runner(args)
        self.assertFalse(docker_inventory(runner)["complete"])

    def test_inspect_must_return_exactly_requested_resources(self):
        def runner(args):
            if args[1] == "ps":
                return "a" * 64
            return self.empty_runner(args)
        self.assertFalse(docker_inventory(runner)["complete"])

    def test_no_commands_mount_volumes_or_read_private_env(self):
        calls = []
        def runner(args):
            calls.append(args)
            return self.empty_runner(args)
        docker_inventory(runner)
        text = json.dumps(calls)
        self.assertNotIn(".Config.Env", text)
        self.assertFalse(any(args[1] in ("run", "create", "start", "stop", "rm") for args in calls))


if __name__ == "__main__":
    unittest.main()
