"""WIN-04B1: target-specific non-destructive transfer planning tests."""
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asa_manager
from deployment.contracts import Blocked
from deployment.import_target_plan import plan_transfer


SOURCE_REVISION = "a" * 40
EVIDENCE = {
    "status": "ARCHIVE_VERIFIED_NO_IMPORT",
    "sourceRevision": SOURCE_REVISION,
    "sourceSchema": 286,
    "writesPerformed": False,
    "targetProvisioned": False,
    "publisherSignatureVerified": False,
}


class TargetPlanTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="asa-win04b-plan-")
        self.addCleanup(temp.cleanup)
        self.base = Path(temp.name)
        self.archive = self.base / "trusted-backup"
        self.archive.mkdir()
        (self.archive / "manifest.json").write_text(
            json.dumps({"project": "asa-lab-original-qa",
                        "profile": "production"}), encoding="utf8")
        self.target = self.base / "new-checkout"
        self.target.mkdir()
        (self.target / ".git").mkdir()

    def call(self, *, target=None, project="asa-lab-new-target", profile="production",
             web_port=28740, blocks_port=28743, evidence=None):
        if evidence is None:
            evidence = EVIDENCE
        with (
            patch("deployment.import_target_plan.validate_import_archive",
                  return_value=evidence) as verify,
            patch("deployment.import_target_plan.assert_clean_install_destination",
                  return_value=True) as isolated,
            patch("deployment.import_target_plan.run", return_value="") as docker_read,
        ):
            result = plan_transfer(
                self.archive, target or self.target, profile=profile,
                project=project, web_port=web_port, blocks_port=blocks_port,
            )
        verify.assert_called_once_with(self.archive)
        isolated.assert_called_once()
        self.assertEqual(docker_read.call_count, 2)
        self.assertEqual(docker_read.call_args_list[0].args[0],
                         ["docker", "ps", "-a", "--format", "{{.Names}}"])
        self.assertEqual(docker_read.call_args_list[1].args[0],
                         ["docker", "network", "ls", "--format", "{{.Name}}"])
        self.assertTrue(all(call.kwargs == {"capture": True}
                            for call in docker_read.call_args_list))
        return result

    def test_read_only_plan_is_explicitly_not_restored(self):
        result = self.call()
        self.assertEqual(result["status"], "TARGET_PREFLIGHT_ONLY")
        self.assertEqual(result["sourceRevision"], SOURCE_REVISION)
        self.assertEqual(result["targetProject"], "asa-lab-new-target")
        self.assertEqual(result["targetWebPort"], 28740)
        self.assertEqual(result["targetApiPort"], 28741)
        self.assertEqual(result["targetScratchPort"], 28743)
        self.assertFalse(result["targetReserved"])
        self.assertFalse(result["targetProvisioned"])
        self.assertFalse(result["secretsImported"])
        self.assertFalse(result["postgresRestored"])
        self.assertFalse(result["minioRestored"])
        self.assertFalse(result["writesPerformed"])
        self.assertTrue(result["operatorCutoverApprovalRequired"])
        self.assertFalse(result["publisherSignatureVerified"])
        self.assertNotIn(str(self.archive), json.dumps(result))

    def test_same_compose_project_is_blocked(self):
        with self.assertRaises(Blocked) as caught:
            self.call(project="asa-lab-original-qa")
        self.assertEqual(caught.exception.code, "IMPORT_TARGET_PROJECT")

    def test_source_inside_target_or_target_inside_archive_blocked(self):
        with self.assertRaises(Blocked) as caught:
            self.call(target=self.archive)
        self.assertEqual(caught.exception.code, "IMPORT_TARGET_OVERLAP")
        inside = self.archive / "nested-new-target"
        inside.mkdir()
        with self.assertRaises(Blocked) as caught:
            self.call(target=inside)
        self.assertEqual(caught.exception.code, "IMPORT_TARGET_OVERLAP")

    def test_dev_profile_import_to_production_is_blocked(self):
        (self.archive / "manifest.json").write_text(
            json.dumps({"project": "asa-lab-original-qa",
                        "profile": "dev"}), encoding="utf8")
        with self.assertRaises(Blocked) as caught:
            self.call(profile="production")
        self.assertEqual(caught.exception.code, "IMPORT_PROFILE_MISMATCH")

    def test_target_profile_must_be_explicit_and_privileged(self):
        for profile in ("dev", "base", None):
            with self.subTest(profile=profile):
                with self.assertRaises(Blocked) as caught:
                    self.call(profile=profile)
                self.assertEqual(caught.exception.code, "IMPORT_TARGET_PROFILE")

    def test_invalid_port_tuple_is_rejected(self):
        for web, blocks in ((28740, 28740), (28740, 28741), (65535, 28743)):
            with self.subTest(web=web, blocks=blocks):
                with self.assertRaises(Blocked) as caught:
                    self.call(web_port=web, blocks_port=blocks)
                self.assertEqual(caught.exception.code, "FRESH_PORT")

    def test_existing_project_or_volume_block_surfaces_unchanged(self):
        with (
            patch("deployment.import_target_plan.validate_import_archive",
                  return_value=EVIDENCE),
            patch("deployment.import_target_plan.assert_clean_install_destination",
                  side_effect=Blocked(
                      "FRESH_VOLUME_EXISTS",
                      "Foreign volume is present",
                      "Choose a new Compose project",
                  )),
        ):
            with self.assertRaises(Blocked) as caught:
                plan_transfer(
                    self.archive, self.target, profile="production",
                    project="asa-lab-new-target",
                    web_port=28740, blocks_port=28743,
                )
            self.assertEqual(caught.exception.code, "FRESH_VOLUME_EXISTS")

    def test_unlabeled_foreign_container_and_network_are_refused(self):
        for output, code, invocation in (
            ("asa-lab-new-target-web-1", "IMPORT_TARGET_CONTAINER_EXISTS", 0),
            ("asa-lab-new-target_application", "IMPORT_TARGET_NETWORK_EXISTS", 1),
        ):
            with self.subTest(output=output):
                responses = ["", ""]
                responses[invocation] = output
                with (
                    patch("deployment.import_target_plan.validate_import_archive",
                          return_value=EVIDENCE),
                    patch("deployment.import_target_plan.assert_clean_install_destination",
                          return_value=True),
                    patch("deployment.import_target_plan.run",
                          side_effect=responses),
                ):
                    with self.assertRaises(Blocked) as caught:
                        plan_transfer(
                            self.archive, self.target, profile="production",
                            project="asa-lab-new-target",
                            web_port=28740, blocks_port=28743,
                        )
                    self.assertEqual(caught.exception.code, code)

    def test_symlink_target_is_refused(self):
        link = self.base / "redirected-checkout"
        try:
            link.symlink_to(self.target, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest("Windows symlink privilege unavailable; host unchanged")
        with self.assertRaises(Blocked) as caught:
            self.call(target=link)
        self.assertEqual(caught.exception.code, "IMPORT_TARGET_REPARSE")

    def test_parent_traversal_target_is_rejected(self):
        path = self.base / "detour" / ".." / "new-checkout"
        with self.assertRaises(Blocked) as caught:
            self.call(target=path)
        self.assertEqual(caught.exception.code, "IMPORT_TARGET_PATH")

    def test_cli_requires_explicit_target_root(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with (
            patch.object(asa_manager, "Installation",
                  side_effect=AssertionError("unexpected target installer")),
            patch.object(asa_manager, "plan_transfer",
                  side_effect=AssertionError("plan must not be invoked")),
            patch("sys.stdout", stdout), patch("sys.stderr", stderr),
        ):
            code = asa_manager.main([
                "import-target-plan", "--backup", str(self.archive),
                "--profile", "production",
                "--install-project", "asa-lab-new-target",
                "--install-web-port", "28740",
                "--install-blocks-port", "28743",
            ])
        self.assertEqual(code, 2)
        self.assertIn("IMPORT_TARGET_ROOT_REQUIRED", stderr.getvalue())

    def test_cli_does_not_construct_installer_or_call_host_commands(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with (
            patch.object(asa_manager, "Installation",
                  side_effect=AssertionError("unexpected target installer")),
            patch.object(asa_manager, "run",
                  side_effect=AssertionError("unexpected host command")),
            patch.object(asa_manager, "plan_transfer",
                  return_value=self.call()) as planner,
            patch("sys.stdout", stdout), patch("sys.stderr", stderr),
        ):
            code = asa_manager.main([
                "import-target-plan", "--backup", str(self.archive),
                "--root", str(self.target), "--profile", "production",
                "--install-project", "asa-lab-new-target",
                "--install-web-port", "28740",
                "--install-blocks-port", "28743",
            ])
        self.assertEqual(code, 0, stderr.getvalue())
        self.assertIn("TARGET_PREFLIGHT_ONLY", stdout.getvalue())
        planner.assert_called_once()


if __name__ == "__main__":
    unittest.main()
