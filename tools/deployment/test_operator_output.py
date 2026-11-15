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
        self.assertIn("Резервная копия не прошла проверку", view)
        self.assertIn("Сайт отвечает на прежней версии", view)
        self.assertIn("до переключения сайта и применения изменений базы", view)
        self.assertNotIn("PRIVATE", view)
        self.assertNotIn("ASA Lab обновлён", view)

    def test_switch_failure_reports_confirmed_new_runtime_and_repair_plan(self):
        view = io.StringIO()
        display = operator_output.OperatorOutput("update", view)
        display.installed(self.install, PREVIOUS, CANDIDATE)
        display.saved()
        display.switch_started = True
        display.stage("health")
        self.install.readiness.return_value = CANDIDATE
        display.failed("HEALTH")
        result = view.getvalue()
        self.assertIn("Проверенная резервная копия создана", result)
        self.assertIn("Сайт отвечает на новой версии", result)
        self.assertIn("sudo asa repair-plan", result)
        self.assertNotIn("до переключения сайта", result)

    def test_disconnected_terminal_cannot_interrupt_a_switch(self):
        terminal = Mock()
        display = operator_output.OperatorOutput("update", terminal)
        terminal.write.side_effect = BrokenPipeError
        display.stage("switch")
        display.stage("health")
        self.assertEqual(display.phase, "health")

    def test_stale_receipt_does_not_guess_install_date(self):
        self.assertIsNone(operator_output.installation_time(self.install, CANDIDATE))


if __name__ == "__main__":
    unittest.main()
