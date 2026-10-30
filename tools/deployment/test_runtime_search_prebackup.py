"""Temporary-file/HTTP/Docker-fake regressions; never touches an installation."""

import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asa_manager
from deployment import backup
from deployment.contracts import Blocked
from deployment.releases import apply_release_environment
from deployment.system import Installation

OLD = "a" * 40
NEW = "b" * 40
RELEASE = {"revision": NEW, "schema": 274, "images": {"search": "target-search-digest"}}


class Response(io.BytesIO):
    status = 200


class RuntimeSearchPrebackupTests(unittest.TestCase):
    def fixture(self, root, *, search=False):
        calls = []
        runtime = {"revision": OLD, "schema": 253, "search": search, "search_revision": OLD,
                   "search_healthy": True}

        class FakeInstallation(Installation):
            def __init__(self, selected_root, profile="dev"):
                self.root = Path(selected_root)
                self.state = self.root / ".asa"
                self.state.mkdir(exist_ok=True)
                self.profile = profile
                self.project = "asa-lab-fixture"
                self.files = []
                self.settings = {}
                self.env = {"ASA_OBJECT_STORAGE_ENDPOINT": "http://minio:9000",
                            "ASA_UPDATE_ENTRY_ORIGIN": "http://127.0.0.1:4610",
                            "ASA_BLOCKS_PARENT_ORIGIN": "http://127.0.0.1:4610",
                            "ASA_BLOCKS_RUNTIME_ORIGIN": "http://127.0.0.1:4610"}
                self.process_env = {"ASA_BUILD_REVISION": OLD}
                if search:
                    self.process_env["ASA_SEARCH_IMAGE"] = "installed-search-digest"

            def identity(self, **kwargs):
                records = {name: {"id": name, "image": "installed-" + name, "running": True}
                           for name in ("postgres", "minio", "web", "api", "scratch")}
                if runtime["search"]:
                    records["search"] = {"id": "search", "image": "installed-search", "running": True}
                return records

            def git(self, *args):
                calls.append(("git", *args))
                return RELEASE["revision"] if args == ("rev-parse", "HEAD") else ""

            def compose(self, *args, **kwargs):
                calls.append(args)
                if args[:3] == ("config", "--format", "json"):
                    return json.dumps({"services": {name: {} for name in self.identity()}})
                if args[:3] == ("exec", "-T", "scratch"):
                    return runtime["revision"]
                if args[:3] == ("exec", "-T", "search"):
                    if not runtime["search"]:
                        raise Blocked("COMMAND", "Search is not installed", "Keep the installed runtime")
                    if args[3] == "cat":
                        return runtime["search_revision"]
                    if not runtime["search_healthy"]:
                        raise Blocked("COMMAND", "Search health failed", "Inspect search health")
                return ""

        def urlopen(url, **kwargs):
            if url.endswith("health/ready"):
                body = {"status": "ready", "deployment": {"revision": runtime["revision"],
                        "synchronized": True, "schemaVersion": runtime["schema"],
                        "expectedSchemaVersion": runtime["schema"]}}
            elif url.endswith("build-metadata.json"):
                body = {"revision": runtime["revision"]}
            else:
                body = {}
            return Response(json.dumps(body).encode())

        return FakeInstallation, runtime, calls, urlopen

    def test_update_backup_and_its_finally_verify_only_installed_runtime(self):
        for search in (False, True):
            with self.subTest(installed_search=search), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                factory, runtime, calls, urlopen = self.fixture(root, search=search)
                selected = []

                def validated_target(install, release):
                    self.assertEqual(install.process_env["ASA_SEARCH_IMAGE"], RELEASE["images"]["search"])
                    selected.append(install)

                stubs = {
                    "doctor": lambda *a, **k: None,
                    "clean_checkout": lambda *a, **k: None,
                    "backup_directory": lambda *a, **k: root / "backups",
                    "attest_editor_env": lambda *a, **k: None,
                    "discover_release": lambda: RELEASE,
                    "assert_ci": lambda *a: None,
                    "fetch_images": lambda *a: None,
                    "selected_source": lambda *a, **k: None,
                    "prepare_collector": lambda *a: {"readerGroupChanged": False},
                    "validate_resolved_images": validated_target,
                    "check_resources": lambda *a: None,
                    "prepare_support_images": lambda *a, **k: None,
                    "Installation": factory,
                }
                # Exercise real export_backup and its real finally/wait_ready.
                # Fail at the first dump instead of exporting any application data.
                with contextlib.ExitStack() as stack:
                    for name, replacement in stubs.items():
                        stack.enter_context(patch.object(asa_manager, name, replacement))
                    stack.enter_context(patch("deployment.system.urllib.request.urlopen", urlopen))
                    stack.enter_context(patch.object(backup, "db_command", side_effect=Blocked("TEST_DUMP", "injected dump failure", "Test only")))
                    with self.assertRaises(Blocked) as problem:
                        asa_manager.update(factory(root))
                self.assertEqual(problem.exception.code, "TEST_DUMP")
                self.assertEqual(len(selected), 1)
                self.assertEqual(selected[0].process_env["ASA_SEARCH_IMAGE"], RELEASE["images"]["search"])
                self.assertIn(("start", "web", "api", "scratch", "minio"), calls)
                search_calls = [call for call in calls if call[:3] == ("exec", "-T", "search")]
                self.assertEqual(len(search_calls), 6 if search else 0)  # initial + backup + finally, revision and health
                self.assertFalse(any(call[:1] == ("up",) for call in calls))
                self.assertFalse((root / ".asa" / "maintenance.json").exists())

    def test_target_search_remains_mandatory_and_checks_revision_and_health(self):
        with tempfile.TemporaryDirectory() as directory:
            factory, runtime, calls, urlopen = self.fixture(Path(directory))
            install = factory(directory)
            apply_release_environment(install, RELEASE)
            runtime.update(revision=NEW, schema=274)
            with patch("deployment.system.urllib.request.urlopen", urlopen):
                with self.assertRaises(Blocked) as missing:
                    install.readiness(NEW, 274)
                self.assertEqual(missing.exception.code, "COMMAND")
                runtime["search"] = True
                with self.assertRaises(Blocked) as mismatch:
                    install.readiness(NEW, 274)
                self.assertEqual(mismatch.exception.code, "HEALTH")
                runtime.update(search_revision=NEW, search_healthy=False)
                with self.assertRaises(Blocked):
                    install.readiness(NEW, 274)
                runtime["search_healthy"] = True
                self.assertEqual(install.readiness(NEW, 274), {"revision": NEW, "schema": 274})

    def test_selected_source_uses_operational_root_and_keeps_canonical_history_guard(self):
        with tempfile.TemporaryDirectory() as directory:
            factory, runtime, calls, urlopen = self.fixture(Path(directory))
            install = factory(directory)
            # The manager module's location is separate from this operational root.
            self.assertNotEqual(Path(asa_manager.__file__).parent.parent, install.root)
            with patch.object(asa_manager, "clean_checkout") as clean:
                asa_manager.selected_source(install, RELEASE, existing=True)
            clean.assert_called_once_with(install)
            self.assertIn(("git", "fetch", "origin", "main:refs/remotes/origin/main"), calls)
            self.assertIn(("git", "merge-base", "--is-ancestor", NEW, "origin/main"), calls)
            self.assertFalse(any(call[:2] == ("git", "switch") for call in calls))


if __name__ == "__main__":
    unittest.main()
