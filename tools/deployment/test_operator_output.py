import contextlib
import io
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asa_manager as manager
from deployment import operator_output, system
from deployment.contracts import Blocked


PREVIOUS = {"revision": "a" * 40, "schema": 319}
CANDIDATE = {"revision": "b" * 40, "schema": 324}
DIGEST = "sha256:" + "c" * 64


class HumanOperatorTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.state = self.root / ".asa"
        self.state.mkdir()
        self.receipt = self.state / "last-operation.json"
        self.receipt.write_text(json.dumps({
            "status": "success", "selected": PREVIOUS, "at": "2026-11-12T01:40:07Z",
        }), encoding="utf-8")
        self.install = SimpleNamespace(
            root=self.root, state=self.state, profile="production", settings={"profile": "production"},
            env={}, readiness=Mock(return_value=PREVIOUS),
            git=Mock(return_value="Merge pull request #1197 from author/backup\x1fTechnical title\n\x1e"),
        )

    def plain(self, action):
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):
            rc = manager.main([action, "--root", str(self.root), "--profile", "production",
                               "--operator", "--human", "--deployment-digest", DIGEST])
        return rc, stream.getvalue()

    def test_check_reports_facts_and_suppresses_raw_process_messages(self):
        def doctor(*_args, **_kwargs):
            print("PRIVATE RAW DIAGNOSTIC")
            print("PRIVATE STDERR", file=sys.stderr)
            system.run(["docker", "version"])
            self.assertIn("Проверяю обновления", owner.getvalue())

        owner = io.StringIO()
        discover = Mock(return_value=CANDIDATE)
        private_stderr = io.StringIO()
        with (
            contextlib.redirect_stdout(owner),
            contextlib.redirect_stderr(private_stderr),
            patch.object(manager, "Installation", return_value=self.install),
            patch.object(manager.application_rollback, "attest_private_state"),
            patch.object(manager.application_rollback, "guard_update"),
            patch.object(manager, "doctor", side_effect=doctor),
            patch.object(manager, "clean_checkout"),
            patch.object(manager, "attest_editor_env"),
            patch.object(manager, "discover_release", discover),
            patch.object(manager.release_transport, "discover_release", discover),
            patch.object(manager, "assert_ci", return_value="2026-11-15T19:12:12Z"),
            patch.object(system.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as child,
        ):
            rc = manager.main(["check", "--root", str(self.root), "--profile", "production",
                               "--operator", "--human", "--deployment-digest", DIGEST])
        view = owner.getvalue()
        self.assertEqual(rc, 0, view)
        self.assertIn("Установлено 12.11.2026 в 04:40 МСК. Версия базы 319", view)
        self.assertIn("Выпуск от 15.11.2026 в 22:12 МСК. Версия базы 324", view)
        self.assertIn("Исправлена проверка крупных файлов MinIO", view)
        self.assertIn("Можно устанавливать. Запустите sudo asa update.", view)
        self.assertNotIn("PRIVATE", view)
        self.assertNotIn("AVAILABLE", view)
        self.assertEqual(private_stderr.getvalue(), "")
        self.assertEqual(child.call_args.kwargs["stdout"], subprocess.DEVNULL)
        self.assertEqual(child.call_args.kwargs["stderr"], subprocess.DEVNULL)

    def test_check_same_release_shows_install_date_without_requalifying_ci(self):
        (self.state / "installed-release.json").write_text(json.dumps(PREVIOUS), encoding="utf-8")
        discover = Mock(return_value=PREVIOUS)
        with (
            patch.object(manager, "Installation", return_value=self.install),
            patch.object(manager.application_rollback, "attest_private_state"),
            patch.object(manager.application_rollback, "guard_update"),
            patch.object(manager, "doctor"), patch.object(manager, "clean_checkout"),
            patch.object(manager, "attest_editor_env"),
            patch.object(manager, "discover_release", discover),
            patch.object(manager.release_transport, "discover_release", discover),
            patch.object(manager, "verify_running_release"), patch.object(manager, "assert_ci") as ci,
        ):
            rc, view = self.plain("check")
        self.assertEqual(rc, 0, view)
        self.assertIn("04:40 МСК", view)
        self.assertIn("Обновление не требуется", view)
        self.assertNotIn("Можно устанавливать", view)
        ci.assert_not_called()

    def test_backup_failure_reports_old_runtime_and_no_switch(self):
        def interrupted(install, _action, _digest, display):
            display.installed(install, PREVIOUS, CANDIDATE)
            display.stage("backup")
            raise Blocked("BACKUP_STORAGE_VERIFY", "PRIVATE PATH", "PRIVATE ACTION")

        with (
            patch.object(manager, "Installation", return_value=self.install),
            patch.object(manager.application_rollback, "attest_private_state"),
            patch.object(manager, "operation_lock", return_value=contextlib.nullcontext()),
            patch.object(manager, "run_operator", side_effect=interrupted),
        ):
            rc, view = self.plain("update")
        self.assertEqual(rc, 2)
        self.assertIn("Этап — создание резервной копии", view)
        self.assertIn("расхождение файлов копии и исходного хранилища", view)
        self.assertIn("Код для диагностики — BACKUP_STORAGE_VERIFY", view)
        self.assertIn("Локальная проверка подтвердила прежнюю версию", view)
        self.assertNotIn("--verbose", view)
        self.assertIn("до переключения сайта и применения изменений базы", view)
        self.assertNotIn("PRIVATE", view)
        self.assertNotIn("ASA Lab обновлён", view)

    def test_public_entry_failure_reports_only_local_readiness_and_repair_plan(self):
        self.install.env["ASA_UPDATE_ENTRY_ORIGIN"] = "https://fixture.invalid"
        self.install.compose, self.install.identity = Mock(), Mock(return_value={})
        self.install.wait_ready, self.install.receipt = Mock(), Mock()
        discover = Mock(return_value={**CANDIDATE, "images": {}})
        self.install.readiness.side_effect = [PREVIOUS, CANDIDATE]
        with (
            patch.object(manager, "Installation", return_value=self.install),
            patch.object(manager.application_rollback, "attest_private_state"),
            patch.object(manager.application_rollback, "guard_update"),
            patch.object(manager, "operation_lock", return_value=contextlib.nullcontext()),
            patch.object(manager, "doctor"), patch.object(manager, "clean_checkout"),
            patch.object(manager, "attest_editor_env"),
            patch.object(manager, "discover_release", discover),
            patch.object(manager.release_transport, "discover_release", discover),
            patch.object(manager, "assert_ci", return_value="2026-11-15T19:12:12Z"),
            patch.object(manager, "fetch_images"), patch.object(manager, "selected_source"),
            patch.object(manager, "prepare_collector", return_value={"readerGroupChanged": False}),
            patch.object(manager, "apply_release_environment"),
            patch.object(manager, "validate_resolved_images"), patch.object(manager, "check_resources"),
            patch.object(manager, "export_backup", return_value=self.root / "verified-backup"),
            patch.object(manager, "verify_embedded_entry_http", side_effect=Blocked(
                "EDITOR_ENTRY_HTTP", "HTTP 502 at PRIVATE URL; attempt 3/3.", "PRIVATE ACTION",
            )),
        ):
            rc, result = self.plain("update")
        self.assertEqual(rc, 2)
        self.assertIn("Проверенная резервная копия создана", result)
        self.assertIn("Этап — проверка адреса сайта", result)
        self.assertIn("вернул HTTP 502", result)
        self.assertIn("Локальная проверка подтвердила новую версию", result)
        self.assertNotIn("Сайт отвечает", result)
        self.assertNotIn("PRIVATE", result)
        self.assertIn("sudo asa repair-plan", result)
        self.assertNotIn("до переключения сайта", result)
        self.install.wait_ready.assert_called_once_with(CANDIDATE["revision"], CANDIDATE["schema"])
        self.assertTrue((self.state / "failed-switch.json").is_file())

    def test_disconnected_terminal_cannot_interrupt_a_switch(self):
        terminal = Mock()
        display = operator_output.OperatorOutput("update", terminal)
        terminal.write.side_effect = BrokenPipeError
        display.stage("switch")
        display.stage("health")
        self.assertEqual(display.phase, "health")

    def test_release_notes_include_direct_commits_without_bodies(self):
        self.install.git.return_value = "\nfix(classroom): Сохранение карточек\x1f\x1e\n"
        notes = operator_output.release_changes(self.install, PREVIOUS["revision"], CANDIDATE["revision"])
        self.assertEqual(notes, ["Сохранение карточек"])
        self.assertIn("contexts", self.install.git.call_args.args)
        self.assertIn("migrations", self.install.git.call_args.args)

    def test_stale_receipt_does_not_guess_install_date(self):
        self.assertIsNone(operator_output.installation_time(self.install, CANDIDATE))


if __name__ == "__main__":
    unittest.main()
