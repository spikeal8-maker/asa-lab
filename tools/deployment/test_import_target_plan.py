"""WIN-04B1: target-specific non-destructive transfer planning tests."""
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asa_manager
from deployment.contracts import Blocked
from deployment.import_target_plan import plan_transfer
from deployment.target_git import CRITICAL_FILES, attest_target_checkout


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
            patch("deployment.import_target_plan.attest_target_checkout",
                  return_value={
                      "officialOriginVerified": True,
                      "officialCommitVerified": True,
                      "verifiedCommit": "a" * 40,
                      "cleanWorkingTreeVerified": True,
                      "criticalFilesVerified": len(CRITICAL_FILES),
                  }) as trust,
            patch("deployment.import_target_plan.run", return_value="") as docker_read,
        ):
            result = plan_transfer(
                self.archive, target or self.target, profile=profile,
                project=project, web_port=web_port, blocks_port=blocks_port,
            )
        verify.assert_called_once_with(self.archive)
        isolated.assert_called_once()
        # Windows runners may hand tempfile an 8.3 short path (RUNNER~1),
        # whereas the security guard canonicalizes the same target via resolve().
        trust.assert_called_once_with(self.target.resolve())
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
            patch("deployment.import_target_plan.attest_target_checkout",
                  return_value={
                      "officialOriginVerified": True,
                      "officialCommitVerified": True,
                      "verifiedCommit": "a" * 40,
                      "cleanWorkingTreeVerified": True,
                      "criticalFilesVerified": len(CRITICAL_FILES),
                  }),
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
                    patch("deployment.import_target_plan.attest_target_checkout",
                          return_value={
                              "officialOriginVerified": True,
                              "officialCommitVerified": True,
                              "verifiedCommit": "a" * 40,
                              "cleanWorkingTreeVerified": True,
                              "criticalFilesVerified": len(CRITICAL_FILES),
                          }),
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


class OfficialCheckoutTests(unittest.TestCase):
    """Disposable synthetic Git repos: no real checkout or remote is mutated."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory(prefix="asa-target-git-")
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "checkout"
        self.root.mkdir()
        subprocess.run(["git", "init", "--quiet", str(self.root)],
                       check=True, capture_output=True)
        subprocess.run(["git", "-C", str(self.root), "remote", "add", "origin",
                        "https://github.com/spikeal8-maker/asa-lab.git"],
                       check=True, capture_output=True)
        for name in CRITICAL_FILES:
            file = self.root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text("# Synthetic source\n", encoding="utf8")
        # Explicitly stage synthetic source even if another host test has
        # installed a global Git excludesfile or ignore rule.
        subprocess.run(["git", "-C", str(self.root), "add", "-f", "."],
                       check=True, capture_output=True)
        tracked = set(subprocess.check_output(
            ["git", "-C", str(self.root), "ls-files"], text=True).splitlines())
        self.assertTrue(set(CRITICAL_FILES) <= tracked,
                        "Disposable Git fixture must track every critical path")
        subprocess.run(
            ["git", "-C", str(self.root), "-c", "user.email=synthetic@example.test",
             "-c", "user.name=Synthetic Test", "commit", "--quiet",
             "-m", "Synthetic disposable checkout"],
            check=True, capture_output=True)
        self.synthetic_sha = subprocess.check_output(
            ["git", "-C", str(self.root), "rev-parse", "HEAD"],
            text=True).strip()

    def invoke(self, official=None):
        if official is None:
            official = self.synthetic_sha
        with patch("deployment.target_git._official_main_sha", return_value=official):
            return attest_target_checkout(self.root)

    def test_clean_synthetic_git_fixture_is_verified_only_under_mocked_api(self):
        report = self.invoke()
        self.assertEqual(report["status"], "OFFICIAL_CHECKOUT_VERIFIED")
        self.assertEqual(report["verifiedCommit"], self.synthetic_sha)
        self.assertEqual(report["criticalFilesVerified"], len(CRITICAL_FILES))
        self.assertFalse(report["writesPerformed"])

    def test_foreign_origin_is_blocked_even_if_commit_sha_claims_valid(self):
        subprocess.run(["git", "-C", str(self.root), "remote", "set-url",
                        "origin", "https://github.com/foreign/asa-lab.git"],
                       check=True)
        with self.assertRaises(Blocked) as error:
            self.invoke()
        self.assertEqual(error.exception.code, "IMPORT_TARGET_GIT_ORIGIN")

    def test_fake_local_repo_with_official_looking_remote_is_blocked(self):
        # An arbitrary git init + remote add cannot manufacture current main.
        with self.assertRaises(Blocked) as error:
            self.invoke(official="f" * 40)
        self.assertEqual(error.exception.code, "IMPORT_TARGET_SOURCE_SHA")

    def test_fabricated_dot_git_directory_is_not_a_repository(self):
        target = self.root.parent / "faked-git"
        target.mkdir()
        (target / ".git").mkdir()
        with self.assertRaises(Blocked) as error:
            with patch("deployment.target_git._official_main_sha",
                       return_value=self.synthetic_sha):
                attest_target_checkout(target)
        self.assertEqual(error.exception.code, "IMPORT_TARGET_GIT")

    def test_modified_tracked_source_is_blocked(self):
        (self.root / "tools" / "asa_manager.py").write_text(
            "# maliciously changed without committing\n", encoding="utf8")
        with self.assertRaises(Blocked) as error:
            self.invoke()
        self.assertEqual(error.exception.code, "IMPORT_TARGET_DIRTY")

    def test_staged_change_is_blocked(self):
        file = self.root / "compose.yaml"
        file.write_text("services:\n  web: {}\n", encoding="utf8")
        subprocess.run(["git", "-C", str(self.root), "add", "compose.yaml"],
                       check=True)
        with self.assertRaises(Blocked) as error:
            self.invoke()
        self.assertEqual(error.exception.code, "IMPORT_TARGET_DIRTY")

    def test_untracked_payload_is_blocked(self):
        (self.root / "injected.ps1").write_text("Write-Host malicious", encoding="utf8")
        with self.assertRaises(Blocked) as error:
            self.invoke()
        self.assertEqual(error.exception.code, "IMPORT_TARGET_DIRTY")

    def test_assume_unchanged_cannot_hide_modified_script(self):
        file = self.root / "tools" / "asa_manager.py"
        subprocess.run(["git", "-C", str(self.root), "update-index",
                        "--assume-unchanged", "tools/asa_manager.py"],
                       check=True)
        file.write_text("# injected manager even though index claims unchanged\n",
                        encoding="utf8")
        with self.assertRaises(Blocked) as error:
            self.invoke()
        self.assertEqual(error.exception.code, "IMPORT_TARGET_SOURCE_CONTENT")

    def test_skip_worktree_cannot_hide_modified_script(self):
        file = self.root / "tools" / "deployment" / "contracts.py"
        subprocess.run(["git", "-C", str(self.root), "update-index",
                        "--skip-worktree", "tools/deployment/contracts.py"],
                       check=True)
        file.write_text("# modified even when skip-worktree is enabled\n",
                        encoding="utf8")
        with self.assertRaises(Blocked) as error:
            self.invoke()
        self.assertEqual(error.exception.code, "IMPORT_TARGET_SOURCE_CONTENT")

    def test_source_hashes_do_not_invoke_git_clean_filters(self):
        from deployment import target_git
        original_git = target_git._git

        def checked_git(*args):
            self.assertNotIn("hash-object", args)
            return original_git(*args)

        with patch("deployment.target_git._git", side_effect=checked_git):
            report = self.invoke()
        self.assertEqual(report["criticalFilesVerified"], len(CRITICAL_FILES))

    def test_local_git_url_rewrite_cannot_redirect_official_origin(self):
        subprocess.run(
            ["git", "-C", str(self.root), "config", "--local",
             "url.https://evil.example/fork/.insteadOf",
             "https://github.com/spikeal8-maker/asa-lab.git"],
            check=True)
        with self.assertRaises(Blocked) as error:
            self.invoke()
        self.assertEqual(error.exception.code, "IMPORT_TARGET_GIT_ORIGIN")

    def test_independent_github_unavailable_fails_closed(self):
        with patch("deployment.target_git._official_main_sha",
                   side_effect=Blocked("IMPORT_TARGET_OFFICIAL_UNAVAILABLE",
                                       "Mock network outage",
                                       "No local SHA fallback")):
            with self.assertRaises(Blocked) as error:
                attest_target_checkout(self.root)
        self.assertEqual(error.exception.code,
                         "IMPORT_TARGET_OFFICIAL_UNAVAILABLE")


if __name__ == "__main__":
    unittest.main()
