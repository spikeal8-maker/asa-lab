import copy
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asa_manager
from deployment import application_rollback as old, school_application_return as school
from deployment.contracts import Blocked


class SchoolApplicationReturnTests(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        root = Path(directory)
        self.install = SimpleNamespace(root=root, state=root / ".asa", project="asa-lab-school308-native-a",
                                       profile="dev", compose=Mock(), identity=Mock(),
                                       env={"ASA_UPDATE_ENTRY_ORIGIN": "http://127.0.0.1:14610",
                                            "ASA_OBJECT_STORAGE_ENDPOINT": "http://minio:9000"},
                                       files=["compose.yaml", "compose.dev.yaml"])
        self.install.settings = {"profile": "dev", "project": self.install.project,
                                 "instanceId": "fixture", "automaticUpdates": False}
        self.install.state.mkdir(mode=0o700)
        self.rows307 = [{"version": "0001", "checksum": "a" * 64},
                        {"version": "0307", "checksum": "b" * 64}]
        self.rows308 = [*self.rows307, school.MIGRATION_ROW]
        self.binding = {"history307": old.digest(self.rows307), "history308": old.digest(self.rows308)}
        self.journal = {"format": school.FORMAT, "id": "a" * 32, "phase": "prepared",
                        "payload": {"priorReceiptSha256": old.digest(None)}, "payloadSha256": "b" * 64,
                        "migrationId": None, "returnedSide": None}

    def test_exact_history_only(self):
        self.assertEqual(school._history_side(self.rows307, self.binding), "original")
        self.assertEqual(school._history_side(self.rows308, self.binding), "fallback")
        altered = [{**self.rows307[0], "checksum": "c" * 64}, *self.rows308[1:]]
        wrong_tail = [*self.rows307, {**school.MIGRATION_ROW, "checksum": "c" * 64}]
        for rows in (altered, wrong_tail, self.rows308[1:],
                     [*self.rows308, {"version": "0309", "checksum": "c" * 64}]):
            with self.subTest(rows=rows), self.assertRaisesRegex(Blocked, "neither exact"):
                school._history_side(rows, self.binding)

    def test_dev_fixture_is_explicit_and_production_refused_before_docker(self):
        with patch.object(school.sys, "platform", "linux"), patch.object(school.shared, "attest_private_state"), \
                patch.object(school.shared, "attest_access"):
            school.require_fixture(self.install)
            self.install.settings["profile"] = self.install.profile = "production"
            with self.assertRaises(Blocked) as error:
                asa_manager.update(self.install, deployment_digest=school.FORWARD_DIGEST,
                                   require_application_rollback=True)
            self.assertEqual(error.exception.code, "SCHOOL_RETURN_QUALIFICATION_ONLY")
            self.install.compose.assert_not_called()
            self.install.settings["profile"] = self.install.profile = "dev"
            self.install.settings["project"] = self.install.project = "asa-lab-school"
            with self.assertRaisesRegex(Blocked, "named Linux native fixture"):
                school.require_fixture(self.install)

    def test_old_update_and_acknowledge_refuse_the_active_new_format(self):
        old._write(self.install.state / old.JOURNAL, self.journal)
        self.assertTrue(school.active(self.install))
        for guard in (school.guard, old.guard_update, old.guard_acknowledge):
            with self.subTest(guard=guard), self.assertRaises(Blocked):
                guard(self.install)
        old._write(self.install.state / old.JOURNAL, {"format": old.FORMAT})
        self.assertFalse(school.active(self.install))

    def test_crash_before_marker_is_recoverable_but_missing_or_foreign_later_marker_is_not(self):
        expected = school._markers(self.install, self.journal)
        self.assertEqual(expected["applicationRollback"], school._link(self.journal))
        self.journal["phase"] = "migrating"
        with self.assertRaisesRegex(Blocked, "does not own"):
            school._markers(self.install, self.journal)
        old._write(self.install.state / school.MARKER, {"phase": "backup"})
        with self.assertRaisesRegex(Blocked, "does not own"):
            school._markers(self.install, self.journal)
        old._write(self.install.state / school.MARKER, expected)
        self.assertEqual(school._markers(self.install, self.journal), expected)
        old._write(self.install.state / "release-selection.json", {})
        with self.assertRaisesRegex(Blocked, "does not own"):
            school._markers(self.install, self.journal)

    def test_migration_seal_never_forces_a_running_or_stopped_container(self):
        state = {"Id": "1" * 64, "State": {"Status": "running"}}
        with patch.object(school, "_migration_container", return_value=state), patch.object(school, "run") as run:
            with self.assertRaises(Blocked) as error:
                school._seal_migration(self.install, self.journal)
            self.assertEqual(error.exception.code, "SCHOOL_RETURN_MIGRATION_ACTIVE")
            run.assert_not_called()
            state["State"]["Status"] = "exited"
            school._seal_migration(self.install, self.journal, check=True)
            run.assert_not_called()
            school._seal_migration(self.install, self.journal)
            run.assert_called_once_with(["docker", "rm", state["Id"]], capture=True)

    def test_owned_one_shot_attests_command_environment_and_docker_identity(self):
        cid = "1" * 64
        image = "sha256:" + "2" * 64
        reference = "ghcr.io/spikeal8-maker/asa-lab/api@sha256:" + "3" * 64
        network = self.install.project + "_database"
        env = {"MIGRATION_DATABASE_URL": "postgresql://migrate@postgres/fixture",
               "MIGRATION_EXPECT_DATABASE": "fixture", "MIGRATION_CONFIRM": "APPLY:fixture"}
        config = {"services": {"migration": {"environment": env, "user": "node"}, "postgres": {"environment": {}}},
                  "networks": {"database": {"name": network}}}
        self.journal["payload"].update(manifests={"forward": {"images": {"api": reference}}},
                                       images={"forward": {"api": image}})
        original = {"Id": cid, "Image": image, "Path": "node", "Args": school.MIGRATION_ARGV[1:],
                    "Config": {"Image": reference, "User": "node", "Env": [f"{key}={value}" for key, value in env.items()],
                               "Labels": {school.LABEL: self.journal["id"],
                                          "com.docker.compose.project": self.install.project,
                                          "com.docker.compose.project.working_dir": str(self.install.root),
                                          "com.docker.compose.service": "migration"}},
                    "HostConfig": {"RestartPolicy": {"Name": "no"}, "ReadonlyRootfs": True, "Privileged": False},
                    "Mounts": [], "NetworkSettings": {"Networks": {network: {}}}}
        with patch.object(school, "_as_release", return_value=self.install), \
                patch.object(school, "_model", return_value=(config, "")), \
                patch.object(school, "attest_database_targets"), patch.object(school, "run") as run:
            run.side_effect = [cid, json.dumps([original])]
            self.assertEqual(school._migration_container(self.install, self.journal), original)
            for alter in (
                lambda row: row.update(Args=["tools/migrate.mjs", "--plan"]),
                lambda row: row.update(Image="sha256:" + "4" * 64),
                lambda row: row["Config"]["Env"].remove("MIGRATION_CONFIRM=APPLY:fixture"),
                lambda row: row["Config"].update(User="root"),
                lambda row: row["HostConfig"].update(Privileged=True),
                lambda row: row["HostConfig"]["RestartPolicy"].update(Name="always"),
                lambda row: row["NetworkSettings"]["Networks"].update(foreign={}),
                lambda row: row["Mounts"].append({"Type": "volume"}),
                lambda row: row["Config"]["Labels"].update({"com.docker.compose.project": "foreign"}),
            ):
                record = copy.deepcopy(original)
                alter(record)
                run.side_effect = [cid, json.dumps([record])]
                with self.assertRaisesRegex(Blocked, "does not match"):
                    school._migration_container(self.install, self.journal)

    def test_apply_cannot_start_before_owned_container_is_attested_and_journaled(self):
        cid = "1" * 64
        created = {"Id": cid, "State": {"Status": "created"}}
        done = {"Id": cid, "State": {"Status": "exited", "ExitCode": 0}}
        self.journal["payload"]["manifests"] = {"forward": {}}
        self.journal["payloadSha256"] = old.digest(self.journal["payload"])
        phases = []

        def command(argv, *, capture):
            self.assertEqual(argv, ["docker", "start", "-a", cid])
            saved = old._read(self.install.state / old.JOURNAL)
            phases.append(saved["phase"])
            self.assertEqual(saved["migrationId"], cid)

        with patch.object(school, "_as_release", return_value=self.install), \
                patch.object(school, "_assert_binding", side_effect=[("original", {}), ("fallback", {})]), \
                patch.object(school, "_migration_container", side_effect=[created, done]), \
                patch.object(school, "_seal_migration") as seal, patch.object(school, "run", side_effect=command):
            school._migrate(self.install, self.journal)
        self.assertEqual(phases, ["migrating"])
        options = self.install.compose.call_args.args
        self.assertEqual(options[2:], ("up", "--no-start", "--no-deps", "--no-build", "--pull", "never",
                                       "--force-recreate", "migration"))
        overlay = json.loads(Path(options[1]).read_text(encoding="utf-8"))
        self.assertEqual(overlay["services"]["migration"]["entrypoint"], school.MIGRATION_ARGV)
        seal.assert_called_once_with(self.install, self.journal)

    def test_return_selects_observed_ledger_only_after_seal(self):
        manifests = {side: {"revision": spec[0], "schema": spec[1]} for side, spec in school.RELEASES.items()}
        journal = copy.deepcopy(self.journal)
        journal.update(phase="migrating", payload={"initialCheckout": manifests["original"]["revision"],
                       "manifests": manifests, "tooling": {}, "images": {},
                       "backup": {"path": "verified"}, "createdAt": "stamp"})
        with patch.object(school, "require_fixture"), patch.object(school, "_load", return_value=journal), \
                patch.object(school, "_markers", return_value={}), \
                patch.object(school, "_sources", return_value=(manifests["original"]["revision"], set())), \
                patch.object(school.shared, "tool_identity", return_value={}), \
                patch.object(school, "_attest_images", return_value={}), \
                patch.object(school, "_backup_binding", return_value=journal["payload"]["backup"]), \
                patch.object(school, "_seal_migration") as seal, patch.object(school, "_stop_writers") as stop, \
                patch.object(school.shared, "_read", return_value=manifests["original"]), \
                patch.object(school, "_assert_binding", side_effect=[("original", {}), ("fallback", {})]), \
                patch.object(school, "_switch") as switch:
            school.rollback(self.install)
        self.assertEqual([call.kwargs for call in seal.call_args_list], [{"check": True}, {}])
        stop.assert_called_once_with(self.install)
        switch.assert_called_once_with(self.install, journal, "fallback")
        self.assertEqual(old._read(self.install.state / old.JOURNAL)["phase"], "returned")
        self.assertFalse((self.install.state / school.MARKER).exists())


if __name__ == "__main__":
    unittest.main()
