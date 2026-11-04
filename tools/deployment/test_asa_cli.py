"""Public entrypoint regressions, using isolated filesystem/process fixtures.

Root-only trust tests use the real effective UID. Observation subprocesses
model an ordinary user when the sandbox cannot drop UID; they do not claim
1Panel, sudo, Windows or real-host acceptance.
"""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asa_cli
from deployment.test_release_readonly import RELEASE

SOURCE = Path(asa_cli.__file__).resolve()
TOOLS = SOURCE.parent
SELECTION = {"release": RELEASE, "deploymentDigest": "sha256:" + "c" * 64,
             "manifestDigest": "sha256:" + "d" * 64, "checkedAt": "2026-11-04T00:00:00+00:00", "ci": "VERIFIED"}
OBSERVATION_DRIVER = r'''
import json, os, runpy, sys
source, selection = sys.argv[1:3]
sys.path.insert(0, str(__import__("pathlib").Path(source).parent))
# Some CI sandboxes are UID 0 with no CAP_SETUID/SETGID. This models only the
# ordinary user's process lookup boundary, not permission-denial evidence.
if hasattr(os, "geteuid") and os.geteuid() == 0:
    os.geteuid = lambda: 12345
from deployment import release_readonly
release_readonly.resolve_release = lambda digest=None: json.loads(selection)
sys.argv = [source, *sys.argv[3:]]
runpy.run_path(source, run_name="__main__")
'''


class PublicCLIProcessTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.root = self.base / "installation"
        state = self.root / ".asa"
        state.mkdir(parents=True)
        self.bin = self.base / "bin"
        self.bin.mkdir()
        self.cwd = self.base / "elsewhere"
        self.cwd.mkdir()
        (state / "installed-release.json").write_text(json.dumps(RELEASE))
        (state / "installation.json").write_text(json.dumps({"project": "asa-fixture", "profile": "production", "automaticUpdates": False}))
        (state / "setup.json").write_text(json.dumps({
            "format": "asa-setup-config-v1", "root": str(self.root), "project": "asa-fixture", "profile": "production",
            "installationId": "d" * 32, "backup": {"policy": "best-effort", "cloud": {"enabled": False},
            "schedule": {"enabled": False, "timezone": "Etc/UTC"}}, "password": "SECRET_SENTINEL", "token": "SECRET_SENTINEL"}))
        (self.root / ".env").write_text("SECRET=SECRET_SENTINEL\n")
        self.registry = self.base / "registry.json"
        self.registry.write_text(json.dumps({"format": asa_cli.FORMAT, "installations": [
            {"root": str(self.root), "project": "asa-fixture", "profile": "production", "bundle": "/opt/asa-setup/" + "a" * 40}]}))
        rows = [{"id": format(index, "064x"), "service": service, "project": "asa-fixture", "workingDir": str(self.root),
                 "image": RELEASE["images"].get(service, "postgres:16"), "running": True, "health": "healthy", "mounts": []}
                for index, service in enumerate(("api", "web", "postgres", "minio", "scratch", "search"), 1)]
        fake = "#!" + sys.executable + "\nimport json,sys\nfrom pathlib import Path\n"
        fake += "rows = " + repr(rows) + "\nargs=sys.argv[1:]\n"
        fake += (
            "if args[:1]==['ps']: print('\\n'.join(x['id'] for x in rows))\n"
            "elif args[:1]==['inspect']: print('\\n'.join(json.dumps(x) for x in rows))\n"
            "elif args[:1]==['exec'] and 'psql' in args[-1]: print('SET\\n0304|1024')\n"
            "elif args[:1]==['exec'] and 'du' in args: print('16 /data')\n"
            "elif args[:1]==['exec'] and 'find /data' in args[-1]: print('5')\n"
            "elif args[:1]==['version']: print('27.0.0')\n"
            "elif args[:2]==['compose','version']: print('2.39.0')\n"
            "elif args[:1]==['info']: print(" + repr(str(self.base)) + ")\n"
            "else:\n Path(" + repr(str(self.base / "FORBIDDEN_DOCKER_MUTATION")) + ").write_text('forbidden')\n raise SystemExit(90)\n"
        )
        (self.bin / "docker").write_text(fake)
        (self.bin / "docker").chmod(0o755)

    def invoke(self, *args, observation=False, timeout=20):
        command = [sys.executable, "-I", "-B"]
        command += ["-c", OBSERVATION_DRIVER, str(SOURCE), json.dumps(SELECTION)] if observation else [str(SOURCE)]
        command += list(args)
        env = dict(os.environ, PATH=str(self.bin), NO_COLOR="1", PYTHONPATH=str(self.cwd),
                   PYTHONHOME="ignored-by-isolated-python", HOME=str(self.cwd))
        return subprocess.run(command, cwd=self.cwd, env=env, stdin=subprocess.DEVNULL,
                              capture_output=True, text=True, timeout=timeout)

    def tree(self):
        return {str(p.relative_to(self.base)): (p.stat().st_size, p.stat().st_mtime_ns,
                hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None) for p in self.base.rglob("*")}

    def test_all_required_offline_help_forms_in_real_public_process(self):
        for arguments in (("help",), ("--help",), ("help", "update"), ("update", "--help"), ("backup", "--help")):
            with self.subTest(arguments=arguments):
                process = self.invoke(*arguments)
                self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
                for text in ("Синтаксис", "Параметры", "Права", "Данные", "Примеры", "Коды результата"):
                    self.assertIn(text, process.stdout)
                self.assertNotIn("\x1b", process.stdout)
                self.assertEqual(process.stderr, "")
                process = self.invoke(*arguments, "--json", "--no-color")
                value = json.loads(process.stdout)
                self.assertEqual(value["command"], "help")
                self.assertEqual(process.returncode, value["exitCode"])
        self.assertFalse((self.base / "FORBIDDEN_DOCKER_MUTATION").exists())

    @unittest.skipUnless(os.name == "posix", "POSIX isolated executable fixture")
    def test_every_required_read_command_uses_public_entry_and_no_files_change(self):
        commands = [
            ("version",), ("status",), ("doctor",), ("disk",), ("disk", "usage"), ("disk", "health"),
            ("services",), ("services", "status"), ("update",), ("update", "check"), ("update", "plan"),
            ("backup", "status"), ("backup", "list"), ("backup", "verify"), ("backup", "schedule"),
            ("cloud", "status"), ("restore", "plan"), ("history",), ("update", "history"),
            ("logs",), ("logs", "update"), ("logs", "backup"), ("config", "show"), (),
        ]
        before = self.tree()
        for arguments in commands:
            with self.subTest(command=arguments):
                process = self.invoke(*arguments, "--root", str(self.root), "--registry", str(self.registry),
                                      "--json", "--no-color", observation=True)
                value = json.loads(process.stdout)
                self.assertEqual(process.returncode, value["exitCode"])
                self.assertIn(process.returncode, (0, 1, 2))
                self.assertNotEqual(value.get("reasonCode"), "USAGE")
                self.assertNotIn("SECRET_SENTINEL", process.stdout + process.stderr)
                self.assertNotIn("\x1b", process.stdout)
                self.assertEqual(process.stderr, "")
        self.assertEqual(self.tree(), before)
        self.assertFalse((self.root / ".asa/operation.lock").exists())
        self.assertFalse((self.root / "backups").exists())
        self.assertFalse((self.root / ".asa/setup-backups").exists())

    def test_errors_never_echo_supplied_secret_or_raw_exception(self):
        for arguments in (("not-a-command-SECRET_SENTINEL",), ("status", "--token", "SECRET_SENTINEL"),
                          ("update", "apply", "--deployment-digest", "SECRET_SENTINEL"),
                          ("restore", "apply")):
            process = self.invoke(*arguments, "--json")
            self.assertEqual(process.returncode, 2)
            self.assertNotIn("SECRET_SENTINEL", process.stdout + process.stderr)
            self.assertNotIn("Traceback", process.stdout + process.stderr)
            self.assertEqual(json.loads(process.stdout)["status"], "BLOCKED")

    @unittest.skipUnless(os.name == "posix", "POSIX observation fixture")
    def test_bare_no_tty_is_compact_and_does_not_wait_for_input(self):
        process = self.invoke("--root", str(self.root), "--registry", str(self.registry), observation=True)
        self.assertIn("PostgreSQL сейчас: 304", process.stdout)
        self.assertIn("Справка: asa help", process.stdout)
        self.assertLessEqual(len(process.stdout.splitlines()), 10)
        self.assertNotIn("Выбор:", process.stdout)
        self.assertNotIn("SECRET_SENTINEL", process.stdout + process.stderr)

    @unittest.skipUnless(os.name == "posix", "real pseudo-terminal")
    def test_bare_tty_menu_and_sigint_use_real_public_process(self):
        import pty
        import select
        import signal
        import time
        for interrupt in (False, True):
            try:
                master, slave = pty.openpty()
            except OSError:
                self.skipTest("This runner has no pseudo-terminal")
            process = None
            try:
                command = [sys.executable, "-I", "-B", "-c", OBSERVATION_DRIVER, str(SOURCE), json.dumps(SELECTION),
                           "--root", str(self.root), "--registry", str(self.registry), "--no-color"]
                process = subprocess.Popen(command, cwd=self.cwd, env=dict(os.environ, PATH=str(self.bin), NO_COLOR="1"),
                                           stdin=slave, stdout=slave, stderr=slave)
                os.close(slave)
                slave = None
                output = bytearray()
                deadline = time.monotonic() + 10
                while "Выбор:".encode() not in output and time.monotonic() < deadline:
                    if select.select([master], [], [], .2)[0]:
                        output.extend(os.read(master, 8192))
                self.assertIn("Меню:".encode(), output)
                self.assertLessEqual(len(output.splitlines()), 12)
                if interrupt:
                    process.send_signal(signal.SIGINT)
                else:
                    os.write(master, b"\n")
                self.assertEqual(process.wait(timeout=5), 130 if interrupt else 1)
                self.assertNotIn(b"\x1b", output)
            finally:
                if process is not None and process.poll() is None:
                    process.kill()
                    process.wait(timeout=3)
                os.close(master)
                if slave is not None:
                    os.close(slave)

    @unittest.skipUnless(os.name == "posix", "POSIX privileged entry")
    def test_custom_registry_cannot_dispatch_root_mutation(self):
        for arguments in (("update", "apply"), ("install",), ("backup", "create"),
                          ("backup", "schedule", "enable"), ("cloud", "sync")):
            process = self.invoke(*arguments, "--registry", str(self.registry), "--json")
            self.assertEqual(process.returncode, 2)
            self.assertIn("--registry", json.loads(process.stdout)["message"])
        self.assertFalse((self.base / "FORBIDDEN_DOCKER_MUTATION").exists())

    @unittest.skipUnless(os.name == "posix" and os.geteuid() == 0, "real root boundary")
    def test_untrusted_source_does_not_import_hostile_cwd_or_pythonpath(self):
        marker = self.base / "HOSTILE_EXECUTED"
        payload = "from pathlib import Path\nPath(" + repr(str(marker)) + ").write_text('unsafe')\n"
        (self.cwd / "asa_setup_launcher.py").write_text(payload)
        (self.cwd / "sitecustomize.py").write_text(payload)
        (self.cwd / "deployment").mkdir()
        (self.cwd / "deployment/__init__.py").write_text(payload)
        process = self.invoke("status", "--root", str(self.root), "--registry", str(self.registry), "--json")
        self.assertEqual(process.returncode, 2)
        self.assertFalse(marker.exists())

    def test_register_does_not_accept_nested_shell_path(self):
        for path in ("/opt/asa-setup/$(touch SECRET_SENTINEL)/" + "a" * 40,
                     "/opt/asa-setup/nested/" + "a" * 40, str(self.base / ("a" * 40))):
            with self.assertRaises(asa_cli.CLIError):
                asa_cli.verified_bundle(Path(path))


class DelegationContracts(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.options = asa_cli.command_parser().parse_args([])
        self.record = {"root": str(self.root), "project": "asa-fixture", "profile": "production", "bundle": "/opt/asa-setup/" + "a" * 40}

    @unittest.skipUnless(os.name == "posix", "Linux setup adapter")
    def test_explicit_writes_delegate_exact_intent_digest_and_existing_operations(self):
        cases = {"install": ("auto", "install"), "update apply": ("auto", "update"),
                 "backup create": ("backup", None), "cloud sync": ("retry-cloud", None),
                 "backup schedule enable": ("schedule", None), "backup schedule disable": ("schedule", None)}
        self.options.deployment_digest = "sha256:" + "b" * 64
        self.options.snapshot_id = "20261104T010101Z-12345678"
        with patch.object(asa_cli.os, "geteuid", return_value=0), \
             patch.object(asa_cli, "verified_bundle", return_value={}), \
             patch.object(asa_cli, "installation_record", return_value=self.record), \
             patch.object(asa_cli, "run_reduced", return_value=0) as run:
            for action, (command, intent) in cases.items():
                asa_cli.run_linux(action, self.record, self.options)
                args = run.call_args.args[0]
                self.assertEqual(args[:3], ["/usr/bin/python3", "-I", "-B"])
                self.assertEqual(args[4], command)
                if intent:
                    self.assertEqual(args[args.index("--intent") + 1], intent)
                    self.assertEqual(args[args.index("--deployment-digest") + 1], self.options.deployment_digest)
                else:
                    self.assertNotIn("--intent", args)
                if action.startswith("backup schedule"):
                    self.assertEqual(args[args.index("--schedule-enabled") + 1], "true" if action.endswith("enable") else "false")
                if action == "cloud sync":
                    self.assertNotIn("backup", args)
                    self.assertEqual(args[args.index("--snapshot-id") + 1], self.options.snapshot_id)

    def test_installed_identity_and_registry_selection_are_preserved(self):
        state = self.root / ".asa"
        state.mkdir()
        (state / "installed-release.json").write_text(json.dumps(RELEASE))
        (state / "installation.json").write_text(json.dumps({"project": "asa-fixture", "profile": "production"}))
        record = asa_cli.installation_record(self.root)
        self.assertEqual(record["project"], "asa-fixture")
        doc = {"format": asa_cli.FORMAT, "installations": [record], "preparedBundle": self.record["bundle"]}
        self.assertEqual(asa_cli.upsert_registry(doc, record), doc)
        with self.assertRaises(asa_cli.CLIError):
            asa_cli.upsert_registry(doc, {**record, "project": "foreign"})
        other = {**record, "root": str(self.root / "other")}
        with self.assertRaises(asa_cli.CLIError):
            asa_cli.choose_root({**doc, "installations": [record, other]}, None)

    @unittest.skipUnless(os.name == "posix", "Linux preparation")
    def test_prepare_registers_before_install_and_keeps_existing_instance_identity(self):
        registry = self.root / "commands.json"
        executable = self.root / "asa"
        old = {**self.record, "bundle": "/opt/asa-setup/" + "1" * 40}
        registry.write_text(json.dumps({"format": asa_cli.FORMAT, "installations": [old]}))
        bundle = Path("/opt/asa-setup/" + "2" * 40)
        with patch.object(asa_cli.os, "geteuid", return_value=0), \
             patch.object(asa_cli, "verified_bundle", return_value={}), \
             patch.object(asa_cli, "protected_path", side_effect=lambda path, **kwargs: path), \
             patch.object(asa_cli, "installation_record", side_effect=AssertionError("No installation yet")):
            self.assertEqual(asa_cli.register_linux(None, bundle, registry=registry, executable=executable), str(executable))
        value = json.loads(registry.read_text())
        self.assertEqual(value["installations"], [old])
        self.assertEqual(value["preparedBundle"], str(bundle))
        self.assertIn("-I -B", executable.read_text())
        self.assertEqual(asa_cli.registry_entry(value, self.options, install=True)["bundle"], str(bundle))
        self.assertEqual(asa_cli.registry_entry(value, self.options)["bundle"], str(bundle))
        self.assertFalse((self.root / ".asa").exists())

    def test_manager_failure_is_bounded_sanitized_and_not_retried(self):
        process = SimpleNamespace(stdout=io.StringIO("BLOCKED COMMAND: SOURCE_CHANGED\npassword=SECRET_SENTINEL\n"),
                                  wait=lambda: 77)
        output = io.StringIO()
        with patch.object(asa_cli.subprocess, "Popen", return_value=process) as run, \
             patch.object(asa_cli, "log_directory", return_value=self.root / "logs"), \
             patch.object(asa_cli, "require_secure_log_directory", return_value=None), \
             contextlib.redirect_stdout(output):
            code = asa_cli.run_reduced(["manager"], "update apply", as_json=True)
        value = json.loads(output.getvalue())
        self.assertEqual(code, 1)
        self.assertEqual(value["managerExitCode"], 77)
        self.assertEqual(value["reasonCodes"], ["SOURCE_CHANGED"])
        self.assertNotIn("SECRET_SENTINEL", output.getvalue())
        self.assertIn("SECRET_SENTINEL", next((self.root / "logs").glob("*.log")).read_text())
        self.assertEqual(run.call_count, 1)

    def test_json_child_result_and_optional_ci_token_have_separate_boundaries(self):
        result = {"format": "asa-setup-result-v1", "reasonCode": "OWNER_INPUT_REQUIRED", "outcome": "BLOCKED",
                  "operationId": "a" * 32, "password": "SECRET_SENTINEL", "nextAction": "SECRET_SENTINEL",
                  "version": {"selected": "b" * 40, "secret": "SECRET_SENTINEL"}}
        process = SimpleNamespace(stdout=io.StringIO(json.dumps(result) + "\n"), wait=lambda: 2)
        with patch.object(asa_cli.subprocess, "Popen", return_value=process) as run, \
             patch.object(asa_cli, "log_directory", return_value=self.root / "logs"), \
             patch.object(asa_cli, "require_secure_log_directory", return_value=None), \
             patch.dict(os.environ, {"GH_TOKEN": "PRIVATE_API_TOKEN", "LD_PRELOAD": "UNTRUSTED_PRELOAD"}), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(asa_cli.run_reduced(["manager"], "install", as_json=True), 2)
        value = json.loads(output.getvalue())
        self.assertEqual(value["reasonCode"], "OWNER_INPUT_REQUIRED")
        self.assertEqual(value["operation"]["version"], {"selected": "b" * 40})
        self.assertNotIn("SECRET_SENTINEL", output.getvalue())
        self.assertNotIn("PRIVATE_API_TOKEN", output.getvalue())
        if os.name == "posix":
            self.assertEqual(run.call_args.kwargs["env"]["GH_TOKEN"], "PRIVATE_API_TOKEN")
            self.assertNotIn("LD_PRELOAD", run.call_args.kwargs["env"])

    @unittest.skipUnless(os.name == "posix", "Linux trust model")
    def test_executable_hardlink_and_writable_file_are_rejected(self):
        path = self.root / "asa"
        path.write_text("trusted marker")
        path.chmod(0o777)
        with self.assertRaises(asa_cli.CLIError):
            asa_cli.protected_path(path)
        path.chmod(0o755)
        os.link(path, self.root / "alias")
        with self.assertRaises(asa_cli.CLIError):
            asa_cli.protected_path(path)


class DeliveryIntegrationContracts(unittest.TestCase):
    def test_bundle_requires_both_readers(self):
        from deployment.setup_bundle import REQUIRED
        self.assertTrue({"tools/asa_cli.py", "tools/deployment/cli_observe.py", "tools/deployment/release_readonly.py"} <= REQUIRED)

    def test_existing_windows_registration_contract_remains(self):
        root = TOOLS.parent
        self.assertIn("'asa_cli.py'", (root / "tools/asa-bootstrap.ps1").read_text())
        self.assertIn("register --root $TargetRoot", (root / "tools/asa-setup.ps1").read_text())
        self.assertIn("if(-not $Apply)", (root / "tools/asa-setup.ps1").read_text())


if __name__ == "__main__":
    unittest.main()
