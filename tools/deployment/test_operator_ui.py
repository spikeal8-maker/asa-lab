"""Synthetic, side-effect-free regression checks for the manual updater console."""

import io
from contextlib import redirect_stdout
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asa_manager
from deployment.contracts import Blocked
from deployment.operator_ui import FIELDS, OperatorView, safe_text


class PretendTty(io.StringIO):
    encoding = "utf-8"

    def isatty(self):
        return True


def release():
    return {"revision": "b" * 40, "schema": 279, "images": {}}


class OperatorRendererTests(unittest.TestCase):
    def test_non_tty_has_ascii_markers_and_no_terminal_escapes(self):
        buffer = io.StringIO()
        report = OperatorView(stream=buffer, environ={"TERM": "xterm"})
        report.begin("РУЧНОЕ ОБНОВЛЕНИЕ")
        report.stage(1, "Проверка")
        report.set("environment", "OK", "identity verified")
        report.highlight_version({"revision": "a" * 40, "schema": 278}, release(), same=False)
        report.finish("AVAILABLE", message="Выполните update")
        output = buffer.getvalue()
        self.assertNotIn("\033", output)
        self.assertIn("[!]", output)
        self.assertIn("Доступно обновление", output)
        self.assertIn("Установка не запускалась".lower(), output.lower())
        self.assertEqual(output.count("Окружение и доступ:"), 1)
        self.assertEqual(sum(1 for _, label in FIELDS if label in output), len(FIELDS))

    def test_interactive_colors_and_no_color_optout(self):
        buffer = PretendTty()
        report = OperatorView(stream=buffer, environ={"TERM": "xterm"})
        report.begin("ОБНОВЛЕНИЕ")
        report.set("http", "OK", "ready")
        report.finish("UPDATED")
        output = buffer.getvalue()
        self.assertIn("\033[32m", output)
        self.assertIn("✓", output)
        plain = PretendTty()
        OperatorView(stream=plain, environ={"TERM": "xterm", "NO_COLOR": ""}).finish(
            "NO_CHANGE"
        )
        self.assertNotIn("\033", plain.getvalue())
        legacy = PretendTty()
        OperatorView(stream=legacy, environ={"TERM": "dumb"}).finish("NO_CHANGE")
        self.assertNotIn("\033", legacy.getvalue())

    def test_same_release_and_skipped_activities_are_not_claimed_as_run(self):
        buffer = io.StringIO()
        report = OperatorView(stream=buffer, environ={})
        report.begin("ПРОВЕРКА")
        report.highlight_version(release(), release(), same=True)
        report.finish("NO_CHANGE")
        output = buffer.getvalue()
        self.assertIn("Обновлений нет", output)
        self.assertIn("Локальная резервная копия: не выполнялось", output)
        self.assertIn("Вход и работа пользователя: не выполнялось", output)
        self.assertNotIn("ОБНОВЛЕНО", output)

    def test_failure_has_safe_action_but_never_claims_rollback(self):
        buffer = io.StringIO()
        report = OperatorView(stream=buffer, environ={})
        report.begin("РУЧНОЕ ОБНОВЛЕНИЕ")
        report.set("deployment", "INFO", "Переключение")
        report.blocked("COMMAND", "Проверьте maintenance.json и старые контейнеры")
        output = buffer.getvalue()
        self.assertIn("ОСТАНОВЛЕНО", output)
        self.assertIn("Состояние после сбоя не подтверждено", output)
        self.assertIn("COMMAND", output)
        self.assertNotIn("Откат успешно выполнен", output)

    def test_untrusted_text_does_not_emit_control_sequences(self):
        self.assertEqual(safe_text("bad\033[31m\r\n next"), "bad [31m   next")
        with self.assertRaises(ValueError):
            OperatorView(stream=io.StringIO()).set("foreign", "OK", "bad")
        with self.assertRaises(ValueError):
            OperatorView(stream=io.StringIO()).set("http", "PASSED", "bad")

    def test_presentation_does_not_call_external_tools(self):
        with (
            patch("subprocess.run") as process,
            patch("os.system") as shell,
            patch("socket.create_connection") as network,
        ):
            report = OperatorView(stream=io.StringIO(), environ={})
            report.begin("ПРОВЕРКА")
            report.highlight_version(None, release(), same=False)
            report.set("backup", "SKIP", "Без резервной копии")
            report.finish("AVAILABLE")
            process.assert_not_called()
            shell.assert_not_called()
            network.assert_not_called()


class ManagerProgressTests(unittest.TestCase):
    def test_check_available_stops_before_image_fetch_or_database_work(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = root / ".asa"
            state.mkdir()
            install = Mock(root=root, state=state, settings={}, profile="production")
            install.readiness.return_value = {"revision": "b" * 40, "schema": 279}
            install.env = {"ASA_UPDATE_ENTRY_ORIGIN": "http://127.0.0.1:4610"}
            output = io.StringIO()
            with (
                patch.object(asa_manager, "doctor"),
                patch.object(asa_manager, "clean_checkout"),
                patch.object(asa_manager, "backup_directory"),
                patch.object(asa_manager, "attest_editor_env"),
                patch.object(asa_manager, "discover_release", return_value=release()),
                patch.object(asa_manager, "assert_ci"),
                patch.object(asa_manager, "fetch_images") as images,
                patch.object(asa_manager, "export_backup") as backup,
            ):
                with redirect_stdout(output):
                    asa_manager.update(install, check=True, reporter=OperatorView(stream=output))
            self.assertIn("AVAILABLE revision=", output.getvalue())
            self.assertIn("ОБНОВЛЕНИЕ ДОСТУПНО", output.getvalue())
            self.assertIn("установка не запускалась", output.getvalue().lower())
            images.assert_not_called()
            backup.assert_not_called()
            install.compose.assert_not_called()

    def test_nochange_never_starts_backup_or_container_switch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = root / ".asa"
            state.mkdir()
            # Simulate the same manifest identity without exposing any credentials.
            expected = release()
            import json
            (state / "installed-release.json").write_text(json.dumps(expected))
            install = Mock(root=root, state=state, settings={}, profile="production")
            install.readiness.return_value = {"revision": "b" * 40, "schema": 279}
            install.identity.return_value = {}
            install.env = {"ASA_UPDATE_ENTRY_ORIGIN": "http://127.0.0.1:4610"}
            output = io.StringIO()
            with (
                patch.object(asa_manager, "doctor"),
                patch.object(asa_manager, "clean_checkout"),
                patch.object(asa_manager, "backup_directory"),
                patch.object(asa_manager, "attest_editor_env"),
                patch.object(asa_manager, "discover_release", return_value=expected),
                patch.object(asa_manager, "assert_ci"),
                patch.object(asa_manager, "verify_embedded_entry_http"),
                patch.object(asa_manager, "prepare_collector", return_value={"readerGroupChanged": False}),
                patch.object(asa_manager, "Installation", return_value=install),
                patch.object(asa_manager, "reconcile_collector"),
                patch.object(asa_manager, "fetch_images") as images,
                patch.object(asa_manager, "export_backup") as backup,
            ):
                with redirect_stdout(output):
                    asa_manager.update(install, reporter=OperatorView(stream=output))
            self.assertIn("NO_CHANGE the verified release", output.getvalue())
            self.assertIn("ОБНОВЛЕНИЙ НЕТ", output.getvalue())
            self.assertIn("Контейнеры не перезапускались", output.getvalue())
            images.assert_not_called()
            backup.assert_not_called()
            install.compose.assert_not_called()

    def test_blocked_main_keeps_original_machine_error_and_exit_two(self):
        from contextlib import redirect_stdout, redirect_stderr
        out, err = io.StringIO(), io.StringIO()
        with (
            patch.object(
                asa_manager,
                "Installation",
                side_effect=Blocked("LOCKED", "Operation already running", "Wait, do not retry"),
            ),
            redirect_stdout(out),
            redirect_stderr(err),
        ):
            code = asa_manager.main(["update", "--root", "/synthetic-only"])
        self.assertEqual(code, 2)
        self.assertIn("BLOCKED LOCKED", err.getvalue())
        self.assertIn("SAFE_ACTION: Wait, do not retry", err.getvalue())
        self.assertIn("ОСТАНОВЛЕНО", out.getvalue())


if __name__ == "__main__":
    unittest.main()
