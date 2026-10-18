#!/usr/bin/env python3
"""No-network tests of the human/agent ASA setup interface."""
from __future__ import annotations
from contextlib import redirect_stdout, redirect_stderr
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("asa_setup", HERE / "asa-setup.py")
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)
FACTS = {"platform": "linux", "hostname": "school-host", "operator": "admins",
         "ssh_client": "192.168.1.100", "docker_present": True,
         "gui_available": False, "whiptail_present": False}


def answers(**changes):
    data = {"schema_version": 1, "action": "install",
            "profile": "production", "root": "/srv/asa-lab",
            "admin_cidr": "192.168.1.100/32",
            "data_mode": "empty", "fresh_empty_confirmed": True}
    data.update(changes)
    return data


class SetupPlanningTests(unittest.TestCase):
    def test_schema_keys_match_runtime_validator(self):
        schema=json.loads((HERE/"asa-setup-answers.schema.json").read_text(encoding="utf-8"))
        self.assertEqual(set(schema["properties"]), setup.KEYS)
        self.assertEqual(schema["additionalProperties"],False)
        self.assertEqual(schema["properties"]["schema_version"]["const"],1)

    def test_noninteractive_bot_lists_missing_decisions(self):
        plan = setup.build_plan({"schema_version": 1, "action": "install"},
                                facts=FACTS, files=False)
        self.assertFalse(plan["ready"])
        self.assertIn("admin_cidr", str(plan["required_input"]))
        self.assertIn("data_mode", str(plan["required_input"]))
        self.assertTrue(plan["needs_windows_ca_trust"])

    def test_production_install_passes_arguments_without_shell(self):
        plan = setup.build_plan(answers(), facts=FACTS, files=False)
        self.assertTrue(plan["ready"])
        command = plan["command"]
        for flag in ("--fresh-empty", "--school-lan-https", "--admin-cidr"):
            self.assertIn(flag, command)
        self.assertNotIn("--ack-production-http-preview", command)
        self.assertEqual(command[command.index("--root")+1], "/srv/asa-lab")

    def test_safe_restore_prepares_exact_flags(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, "manifest.json").write_text("{}")
            data = answers(root=str(Path(d)/"new-school"), data_mode="restore",
                           fresh_empty_confirmed=False,
                           restore_backup=d, restore_snapshot="20261017T231505Z-65b68074",
                           min_active_students=300, min_seats=400)
            plan = setup.build_plan(data, facts=FACTS)
            self.assertTrue(plan["ready"])
            self.assertTrue(plan["will_modify_live_data"])
            command = plan["command"]
            self.assertIn("--require-restore", command)
            self.assertIn("--restore-backup", command)
            self.assertNotIn("--fresh-empty", command)
            self.assertEqual(command[command.index("--target-hostname")+1],
                             "school-host")

    def test_incomplete_backup_never_qualifies_for_restore(self):
        with tempfile.TemporaryDirectory() as d:
            data = answers(root=str(Path(d)/"new-school"), data_mode="restore",
                           fresh_empty_confirmed=False,
                           restore_backup=d, restore_snapshot="approved")
            plan = setup.build_plan(data, facts=FACTS)
            self.assertFalse(plan["ready"])
            self.assertIn("manifest.json", str(plan["required_input"]))

    def test_encrypted_archive_needs_external_identity(self):
        with tempfile.TemporaryDirectory() as d:
            archive = Path(d)/"asa-lab-20261017T231505Z-65b68074.tar.age"
            archive.write_bytes(b"not-actually-encrypted-for-unit-test")
            data = answers(data_mode="encrypted", fresh_empty_confirmed=False,
                           encrypted_archive=str(archive))
            with mock.patch.dict(setup.os.environ, {}, clear=True):
                plan = setup.build_plan(data, facts=FACTS, files=False)
            self.assertFalse(plan["ready"])
            self.assertIn("ASA_AGE_IDENTITY_FILE", str(plan["required_input"]))
            self.assertNotIn("--fresh-empty", plan["command"])
            self.assertIn("--restore-backup", plan["command"])
            self.assertEqual(plan["command"][plan["command"].index("--restore-snapshot")+1],
                             "20261017T231505Z-65b68074")

    def test_encrypted_archive_never_leaks_private_identity_in_plan(self):
        with tempfile.TemporaryDirectory() as d:
            archive = Path(d)/"asa-lab-20261017T231505Z-65b68074.tar.age"
            archive.write_bytes(b"sample")
            private = Path(d)/"secret.age"
            private.write_bytes(b"private-identity-never-printed")
            data = answers(data_mode="encrypted", fresh_empty_confirmed=False,
                           encrypted_archive=str(archive))
            with mock.patch.dict(setup.os.environ, {"ASA_AGE_IDENTITY_FILE":str(private)}):
                plan = setup.build_plan(data, facts=FACTS, files=False)
            self.assertTrue(plan["ready"])
            output = json.dumps(plan)
            self.assertNotIn(str(private), output)
            self.assertNotIn("private-identity-never-printed", output)
            self.assertEqual(plan["preparation"]["archive"], str(archive))

    def test_encrypted_archive_cannot_replace_installed_database(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)/"school"
            (root/".asa").mkdir(parents=True)
            (root/".asa"/"installed-release.json").write_text("{}")
            data=answers(root=str(root), data_mode="encrypted",
                         fresh_empty_confirmed=False)
            with self.assertRaises(setup.SetupBlocked):
                setup.build_plan(data, facts=FACTS)

    def test_archive_snapshot_mismatch_blocks(self):
        data=answers(data_mode="encrypted",fresh_empty_confirmed=False,
                     encrypted_archive="/srv/asa-lab-20261017T231505Z-65b68074.tar.age",
                     restore_snapshot="wrong")
        with self.assertRaisesRegex(setup.SetupBlocked,"differs"):
            setup.build_plan(data, facts=FACTS, files=False)

    def test_live_installed_database_cannot_be_replaced(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)/"school"
            (root/".asa").mkdir(parents=True)
            (root/".asa"/"installed-release.json").write_text("{}")
            data = answers(root=str(root), data_mode="restore",
                           fresh_empty_confirmed=False,
                           restore_backup="/srv/restore/a",
                           restore_snapshot="approved")
            with self.assertRaisesRegex(setup.SetupBlocked, "never automatically"):
                setup.build_plan(data, facts=FACTS)

    def test_existing_install_is_idempotent(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)/"school"
            (root/".asa").mkdir(parents=True)
            (root/".asa"/"installed-release.json").write_text("{}")
            plan = setup.build_plan(answers(root=str(root)), facts=FACTS)
            self.assertTrue(plan["ready"])
            self.assertFalse(plan["will_modify_live_data"])

    def test_no_unsafe_root(self):
        for root in ("/", "/etc", "/tmp", "/srv", "/home"):
            with self.subTest(root=root), self.assertRaises(setup.SetupBlocked):
                setup.build_plan(answers(root=root), facts=FACTS, files=False)

    def test_no_unknown_or_secret_field(self):
        for key in ("password", "oauth_token", "rclone_secret", "unsafe"):
            with self.subTest(key=key), self.assertRaises(setup.SetupBlocked):
                setup.build_plan(answers(**{key:"value"}), facts=FACTS, files=False)

    def test_no_admin_cidr_wildcard(self):
        for cidr in ("0.0.0.0/0", "10.0.0.0/8", "8.8.0.0/16", "abc"):
            with self.subTest(cidr=cidr), self.assertRaises(setup.SetupBlocked):
                setup.build_plan(answers(admin_cidr=cidr), facts=FACTS, files=False)

    def test_separate_vpn_and_physical_interface(self):
        plan = setup.build_plan(answers(school_lan_interface="eno1",
                                        school_lan_follow_interface=True),
                                facts=FACTS, files=False)
        self.assertTrue(plan["ready"])
        self.assertEqual(plan["command"][-3:],
                         ["--school-lan-interface", "eno1", "--school-lan-follow-interface"])

    def test_preview_does_not_disable_security(self):
        plan = setup.build_plan(answers(), facts=FACTS, files=False)
        self.assertNotIn("--lan-preview-ip", plan["command"])
        self.assertNotIn("--ack-production-http-preview", plan["command"])

    def test_school_lan_action_does_not_install_1panel(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)/"school"
            (root/".asa").mkdir(parents=True)
            (root/".asa"/"installed-release.json").write_text("{}")
            plan = setup.build_plan({"schema_version": 1, "action": "school-lan",
                                     "root":str(root)}, facts=FACTS)
            self.assertTrue(plan["ready"])
            self.assertNotIn("--panel-port", plan["command"])
            self.assertIn("school-lan", plan["command"])

    def test_school_lan_needs_existing_release(self):
        with tempfile.TemporaryDirectory() as d:
            plan = setup.build_plan({"schema_version":1, "action":"school-lan",
                                     "root":str(Path(d)/"new-school")}, facts=FACTS)
            self.assertFalse(plan["ready"])

    def test_windows_cannot_run_linux_bootstrap(self):
        plan = setup.build_plan(answers(),
                                facts={**FACTS, "platform":"win32"}, files=False)
        self.assertFalse(plan["ready"])
        self.assertIn("Ubuntu", str(plan["required_input"]))

    def test_no_secrets_in_plan(self):
        plan = setup.build_plan(answers(), facts=FACTS, files=False)
        text = json.dumps(plan)
        self.assertNotIn("password", text.lower())
        self.assertNotIn("token", text.lower())


class SetupExecutionTests(unittest.TestCase):
    def test_missing_approval_prevents_all_writes(self):
        with tempfile.TemporaryDirectory() as d:
            source=Path(d)/"answers.json"
            source.write_text(json.dumps(answers()))
            stdout, stderr = io.StringIO(), io.StringIO()
            with mock.patch.object(setup, "host_facts", return_value=FACTS), \
                 mock.patch.object(setup.subprocess, "run") as run, \
                 redirect_stdout(stdout), redirect_stderr(stderr):
                self.assertEqual(setup.main(["execute", "--answers", str(source)]), 2)
                run.assert_not_called()
                self.assertIn("requires --approve", stderr.getvalue())

    def test_plan_is_read_only_and_returns_actionable_json(self):
        with tempfile.TemporaryDirectory() as d:
            source=Path(d)/"answers.json"
            source.write_text('{"schema_version":1,"action":"install"}')
            stdout=io.StringIO()
            with mock.patch.object(setup, "host_facts", return_value=FACTS), \
                 mock.patch.object(setup.subprocess, "run") as run, \
                 redirect_stdout(stdout):
                self.assertEqual(setup.main(["plan", "--answers", str(source)]), 0)
                run.assert_not_called()
            self.assertFalse(json.loads(stdout.getvalue())["ready"])

    def test_execute_passes_only_approved_argv(self):
        with tempfile.TemporaryDirectory() as d:
            source=Path(d)/"answers.json"
            source.write_text(json.dumps(answers(root=str(Path(d)/"new-school"))))
            with mock.patch.object(setup, "host_facts", return_value=FACTS), \
                 mock.patch.object(setup.os, "geteuid", return_value=0), \
                 mock.patch.object(setup.subprocess, "run", return_value=
                                   mock.Mock(returncode=0)) as run, \
                 redirect_stdout(io.StringIO()):
                self.assertEqual(setup.main(["execute","--answers",str(source),
                                              "--approve"]),0)
                run.assert_called_once()
                command = run.call_args.args[0]
                self.assertIn("--fresh-empty", command)
                self.assertNotIn("shell", run.call_args.kwargs)

    def test_does_not_run_without_required_choices(self):
        with tempfile.TemporaryDirectory() as d:
            source=Path(d)/"answers.json"
            source.write_text('{"schema_version":1,"action":"install"}')
            with mock.patch.object(setup, "host_facts", return_value=FACTS), \
                 mock.patch.object(setup.subprocess, "run") as run, \
                 redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                self.assertEqual(setup.main(["execute","--answers",str(source),
                                              "--approve"]),2)
                run.assert_not_called()

    def test_bad_age_archive_never_starts_installer(self):
        with tempfile.TemporaryDirectory() as d:
            archive = Path(d)/"asa-lab-20261017T231505Z-65b68074.tar.age"
            archive.write_bytes(b"bad-source")
            private = Path(d)/"age-identity.txt"
            private.write_text("not-a-real-key")
            data = answers(data_mode="encrypted", fresh_empty_confirmed=False,
                           encrypted_archive=str(archive))
            with mock.patch.dict(setup.os.environ, {"ASA_AGE_IDENTITY_FILE":str(private)}):
                plan = setup.build_plan(data, facts=FACTS, files=False)
                with mock.patch.object(setup.os, "geteuid", return_value=0), \
                     mock.patch.object(setup.shutil, "which", return_value="/usr/bin/age"), \
                     mock.patch.object(setup.subprocess, "run",
                                       return_value=mock.Mock(returncode=2)) as run:
                    with self.assertRaisesRegex(setup.SetupBlocked, "not started"):
                        setup.execute(plan)
                    self.assertEqual(run.call_count, 1)
                    command = run.call_args.args[0]
                    self.assertIn("prepare-age-backup.py", " ".join(command))
                    self.assertNotIn("install-ubuntu-1panel.py", " ".join(command))

    def test_verified_age_archive_then_bootstrap_in_order(self):
        with tempfile.TemporaryDirectory() as d:
            archive = Path(d)/"asa-lab-20261017T231505Z-65b68074.tar.age"
            archive.write_bytes(b"sample")
            private = Path(d)/"identity.age"
            private.write_text("not-a-real-identity")
            config = answers(data_mode="encrypted", fresh_empty_confirmed=False,
                             encrypted_archive=str(archive))
            with mock.patch.dict(setup.os.environ, {"ASA_AGE_IDENTITY_FILE":str(private)}):
                plan=setup.build_plan(config, facts=FACTS, files=False)
                with mock.patch.object(setup.os, "geteuid", return_value=0), \
                     mock.patch.object(setup.shutil,"which",return_value="/usr/bin/age"), \
                     mock.patch.object(setup.subprocess,"run",return_value=
                                       mock.Mock(returncode=0)) as run:
                    self.assertEqual(setup.execute(plan),0)
                    self.assertEqual(run.call_count,2)
                    self.assertIn("prepare-age-backup.py"," ".join(run.call_args_list[0].args[0]))
                    self.assertIn("install-ubuntu-1panel.py"," ".join(run.call_args_list[1].args[0]))
                    self.assertNotIn(str(private)," ".join(run.call_args_list[1].args[0]))

    def test_invalid_json_never_executes(self):
        with tempfile.TemporaryDirectory() as d:
            source=Path(d)/"answers.json"
            source.write_text("{")
            with mock.patch.object(setup.subprocess, "run") as run, \
                 redirect_stderr(io.StringIO()):
                self.assertEqual(setup.main(["execute","--answers",str(source),
                                              "--approve"]),2)
                run.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
