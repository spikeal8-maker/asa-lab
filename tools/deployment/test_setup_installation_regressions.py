"""Regression coverage for preserving installation identity during setup."""
import copy
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from deployment.contracts import Blocked
from deployment.setup_config import prepare_config, replace_legacy_manager_state
from deployment.setup_discovery import classify_installation
from deployment.test_setup_discovery import fixture


class SetupInstallationRegressionTests(unittest.TestCase):
    def configure(self, root, env=None, previous=None):
        def answer(prompt, default=None, **kwargs):
            if prompt.startswith("Публичный HTTPS"):
                return "https://asa.example.invalid"
            if prompt.startswith("Политика backup"):
                return "best-effort"
            if prompt.startswith(("Облачная копия", "Включить ежедневный")):
                return "no"
            return default

        install = SimpleNamespace(env=env or {}, settings={}, profile="production")
        with patch("deployment.setup_config._ask", side_effect=answer), patch(
            "deployment.setup_config.validate_config", side_effect=lambda value, *_args, **_kwargs: value
        ):
            return prepare_config(root, os.geteuid(), install=install, previous=previous,
                                  reconfigure=True, fresh=previous is None)

    def test_fresh_project_keeps_historical_default(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(self.configure(root)["project"], "asa-lab-dev")

    def test_existing_environment_project_has_priority(self):
        with tempfile.TemporaryDirectory() as root:
            configured = self.configure(root, {"COMPOSE_PROJECT_NAME": "existing-school"},
                                        {"project": "previous-school"})
            self.assertEqual(configured["project"], "existing-school")

    def test_reconfiguration_preserves_saved_project_when_env_omits_it(self):
        with tempfile.TemporaryDirectory() as root:
            configured = self.configure(root, previous={"project": "existing-school"})
            self.assertEqual(configured["project"], "existing-school")

    def empty_inventory(self, root):
        inventory = fixture(root)
        inventory["containers"] = []
        inventory["volumes"] = []
        return inventory

    def test_empty_env_is_an_installation_remnant(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = root / ".env"
            env.write_bytes(b"")
            result = classify_installation(root, self.empty_inventory(root))
            self.assertEqual(result["state"], "PARTIAL")
            self.assertEqual(result["reasons"][0]["code"], "ORPHANED_INSTALLATION")
            self.assertEqual(env.read_bytes(), b"")

    def test_comment_only_env_is_an_installation_remnant(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = root / ".env"
            content = b"# Retained settings from earlier installation\n"
            env.write_bytes(content)
            result = classify_installation(root, self.empty_inventory(root))
            self.assertEqual(result["state"], "PARTIAL")
            self.assertEqual(env.read_bytes(), content)

    def test_backup_remnants_and_orphan_volumes_survive_discovery(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            backups = root / "backups"
            backups.mkdir()
            manifest = backups / "manifest.json"
            manifest.write_bytes(b'{"retained":true}\n')
            inventory = fixture(root)
            inventory["containers"] = []
            before = copy.deepcopy(inventory)
            result = classify_installation(root, inventory, project="custom-school")
            self.assertEqual(result["state"], "PARTIAL")
            self.assertEqual(set(result["orphanVolumes"]), {v["name"] for v in inventory["volumes"]})
            self.assertEqual(inventory, before)
            self.assertEqual(manifest.read_bytes(), b'{"retained":true}\n')

    def network_record(self):
        return {"revision": "a" * 40, "files": {
            "compose.yaml": "services: {}\n",
            ".asa/docker-networks.yaml": "networks: {}\n",
        }}

    def test_runtime_snapshot_accepts_managed_network_overlay(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / ".asa"
            state.mkdir(mode=0o700)
            overlay = state / "docker-networks.yaml"
            overlay.write_bytes(b"networks: {}\n")
            record = self.network_record()
            replace_legacy_manager_state(root, "runtime-configuration.json", record)
            saved = state / "runtime-configuration.json"
            self.assertEqual(json.loads(saved.read_text()), record)
            self.assertEqual(saved.stat().st_mode & 0o777, 0o600)
            self.assertEqual(overlay.read_bytes(), b"networks: {}\n")

    def test_legacy_runtime_snapshot_with_network_overlay_is_adopted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / ".asa"
            state.mkdir(mode=0o700)
            saved = state / "runtime-configuration.json"
            record = self.network_record()
            saved.write_text(json.dumps(record))
            saved.chmod(0o644)
            updated = copy.deepcopy(record)
            updated["revision"] = "b" * 40
            replace_legacy_manager_state(root, "runtime-configuration.json", updated)
            self.assertEqual(json.loads(saved.read_text()), updated)
            self.assertEqual(saved.stat().st_mode & 0o777, 0o600)

    def test_unknown_runtime_overlay_is_rejected_without_replacing_record(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / ".asa"
            state.mkdir(mode=0o700)
            saved = state / "runtime-configuration.json"
            content = json.dumps({"revision": "a" * 40, "files": {"compose.yaml": "services: {}\n"}})
            saved.write_text(content)
            saved.chmod(0o600)
            invalid = self.network_record()
            invalid["files"][".asa/unmanaged.yaml"] = "services: {}\n"
            with self.assertRaises(Blocked) as caught:
                replace_legacy_manager_state(root, "runtime-configuration.json", invalid)
            self.assertEqual(caught.exception.code, "LEGACY_STATE_FORMAT")
            self.assertEqual(saved.read_text(), content)


if __name__ == "__main__":
    unittest.main()
