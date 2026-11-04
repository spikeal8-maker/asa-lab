"""Portable semantic tests with synthetic public JSON, without a product import."""
import copy
from dataclasses import replace
import json
import os
import socket
import subprocess
import unittest
from unittest import mock

from deployment.realhost_cli_checks import (
    CLIReadCheckError, ERROR_CODES, FixtureContext, ReleasePin, check_read_result,
)


STAMP = "2026-11-04T12:00:00+00:00"
SNAPSHOT = "20261104T120000Z-a1b2c3d4"
OTHER_SNAPSHOT = "20261104T130000Z-b1c2d3e4"
SECRET = "PRIVATE_FIXTURE_PASSWORD_9a7c_DO_NOT_EMIT"
SERVICES = ("api", "web", "scratch", "minio", "search")


def pin(revision, digest):
    return ReleasePin(revision * 40, 304, {
        service: "ghcr.io/spikeal8-maker/asa-lab/" + service + "@sha256:" + digest * 64
        for service in SERVICES
    })


def fixture():
    return FixtureContext(
        root="/srv/asa-lab", project="asa-lab-dev", origin="http://127.0.0.1:8080",
        installed=pin("a", "1"), target=pin("b", "2"),
        deployment_digest="sha256:" + "c" * 64, manifest_digest="sha256:" + "d" * 64,
        filesystem_paths={"application": "/srv/asa-lab", "backups": "/srv/asa-lab/backups",
                          "docker": "/var/lib/docker", "postgres": "/var/lib/docker/volumes/asa-lab-dev_postgres-data/_data",
                          "minio": "/var/lib/docker/volumes/asa-lab-dev_blocks-object-data/_data"},
        ports={"web": 8080, "api": 8081, "blocks": 8082},
        schedule={"enabled": False, "time": "03:00", "timezone": "UTC", "maxAgeHours": 26},
        snapshot_ids=(SNAPSHOT,), last_attempt=SNAPSHOT, last_local_success=SNAPSHOT,
        accepted_operation_id="e" * 32,
    )


def envelope(command, value, code=0):
    return {**copy.deepcopy(value), "format": "asa-cli-result-v1", "command": command, "exitCode": code}


def missing(reason):
    return {"status": "UNAVAILABLE", "reasonCode": reason}


def release(context, target=False):
    selected = context.target if target else context.installed
    result = {"revision": selected.revision, "schema": selected.schema, "images": copy.deepcopy(selected.images)}
    if target:
        result.update(deploymentDigest=context.deployment_digest, manifestDigest=context.manifest_digest, ci="VERIFIED")
    else:
        result["status"] = "RECORDED"
    return result


def database():
    return {"status": "OK", "schema": 304, "bytes": 1000000}


def schedule(context):
    enabled = context.schedule["enabled"]
    return {"status": "OK", "configured": copy.deepcopy(context.schedule), "installed": enabled,
            "active": True if enabled else None, "enabled": True if enabled else None,
            "nextRun": "Thu 2026-11-05 03:00:00 UTC" if enabled else None, "lastRun": None}


def cloud_receipt():
    return {"status": "NOT_CONFIGURED", "verifiedAt": None, "evidenceScope": "RECORDED_DELIVERY", "deleted": False}


def backup_item(context, snapshot=SNAPSHOT):
    return {"status": "RECORDED", "snapshotId": snapshot, "snapshotAt": STAMP, "ageHours": 0.1,
            "local": {"status": "OK", "deleted": False, "bytes": 123456, "present": True,
                      "evidenceScope": "RECORDED_VERIFICATION"},
            "encryption": {"status": "OK" if context.encryption_enabled else "NOT_CONFIGURED",
                           "bytes": 123567 if context.encryption_enabled else None},
            "cloud": cloud_receipt()}


def backups(context, listing=False):
    result = {"status": "RECORDED", "lastAttempt": backup_item(context, context.last_attempt),
              "lastLocalSuccess": backup_item(context, context.last_local_success),
              "lastCloudSuccess": missing("BACKUP_EVIDENCE_MISSING")}
    if listing:
        result.update(items=[backup_item(context, name) for name in context.snapshot_ids], limit=100, truncated=False)
    else:
        result["schedule"] = schedule(context)
    return result


def cloud():
    return {"status": "UNAVAILABLE", "configured": False, "policy": "best-effort",
            "transport": missing("CLOUD_NOT_CONFIGURED"), "remote": missing("NO_READ_ONLY_PROVIDER_PROBE"),
            "lastDelivery": missing("BACKUP_EVIDENCE_MISSING"), "note": "Remote bytes were not observed."}


def disk(context):
    return {"status": "OK", "filesystems": {
        name: {"status": "OK", "path": path, "totalBytes": 20 * 1024 ** 3,
               "freeBytes": 10 * 1024 ** 3, "usedBytes": 9 * 1024 ** 3,
               "totalInodes": 1000000, "freeInodes": 500000}
        for name, path in context.filesystem_paths.items()
    }, "database": database(), "physicalHealth": missing("USE_DISK_HEALTH")}


def disk_health():
    return {"status": "UNAVAILABLE", "devices": [{"device": "/dev/vda", "status": "UNAVAILABLE"}], "reasonCode": None}


def history_row(context):
    return {"operationId": context.accepted_operation_id, "mode": context.accepted_mode,
            "startedAt": STAMP, "updatedAt": "2026-11-04T12:05:00+00:00",
            "state": "TERMINAL", "outcome": "WARNING", "reasonCode": "NONE"}


def history(context):
    return {"status": "OK", "items": [history_row(context)], "truncated": False}


def logs(context):
    row = history_row(context)
    row["events"] = [{"at": STAMP, "stage": stage, "status": "done"}
                     for stage in ("preflight", "release", "source", "switch", "browser", "first_backup")]
    return {"status": "OK", "scope": "SANITIZED_OPERATION_EVENTS", "items": [row]}


def services():
    return {"status": "OK", "docker": {"status": "OK", "version": "29.9.3"},
            "compose": {"status": "OK", "version": "2.40.3"}, "reasonCode": None,
            "containers": [{"service": name, "running": True, "health": "healthy"}
                           for name in ("api", "web", "postgres", "minio", "scratch", "search")]
                           + [{"service": "minio-init", "running": False, "health": None}]}


def status(context, doctor=False):
    result = {"status": "OK", "observedAt": STAMP, "root": context.root,
              "installed": release(context), "services": services(), "database": database(),
              "site": {"status": "OK", "origin": context.origin, "https": "UNAVAILABLE",
                       "revision": context.installed.revision, "reportedSchema": 304,
                       "editorEndpoint": {"status": "OK"},
                       "browserAcceptance": {"status": "NOT_RUN", "reasonCode": "READ_ONLY",
                           "historical": {"status": "RECORDED", "at": STAMP, "applicationAccepted": True,
                                          "operationId": context.accepted_operation_id}}},
              "backup": backups(context), "updates": {"status": "UNAVAILABLE", "checkedAt": None, "reasonCode": "USE_UPDATE_CHECK"},
              "history": history(context), "access": "OBSERVED"}
    if doctor:
        result.update(host={"status": "OK", "os": "Linux", "distribution": "ubuntu", "version": "24.04",
                            "architecture": "x86_64", "cpuCount": 4, "memoryBytes": 8 * 1024 ** 3, "supportedSetupHost": True},
                      disk=disk(context), diskHealth=disk_health(), cloud=cloud(),
                      optionalUnavailableChecks=["diskHealth", "cloud", "cloud.transport", "cloud.remote"])
    return result


def update(context):
    size, entries = 1004096, 34
    return {"status": "PLANNED", "checkedAt": STAMP, "current": release(context), "currentDatabase": database(),
            "target": release(context, target=True), "available": context.target.revision != context.installed.revision,
            "migrations": {"status": "SCHEMA_RANGE_ONLY", "fromSchema": 304, "toSchema": context.target.schema,
                           "exactList": None, "reasonCode": "EXACT_PLAN_REQUIRES_VERIFIED_MIGRATION_RUNTIME"},
            "requiredSpaceBytes": None, "estimatedDowntimeSeconds": None,
            "backupSpaceEstimate": {"status": "MEASURED_BACKUP_BUDGET", "scope": "LOCAL_SNAPSHOT_TAR_CIPHERTEXT_READBACK_RESERVE",
                "observedSnapshotBytes": size, "imageBytes": None, "path": context.filesystem_paths["backups"],
                "freeBytes": 10 * 1024 ** 3, "requiredBytes": int(size * 4 * 1.1) + 2 * 1024 ** 3,
                "freeInodes": 500000, "requiredInodes": max(1024, (entries * 11 + 9) // 10 + 128),
                "snapshotEntries": entries, "sufficient": True},
            "spaceReasonCode": "NEW_IMAGE_UNPACKED_BYTES_UNKNOWN", "downtimeReasonCode": "NO_MEASURED_DURATION",
            "disk": disk(context), "backup": backups(context), "cloud": cloud(), "blockers": [],
            "applyRechecksUnderLock": True, "apply": "sudo asa update apply --deployment-digest " + context.deployment_digest}


def config(context):
    return {"status": "OK", "configFormat": "asa-setup-config-v1", "root": context.root,
            "project": context.project, "profile": context.profile, "ports": copy.deepcopy(context.ports),
            "backupPolicy": context.backup_policy, "cloudEnabled": context.cloud_enabled,
            "automaticUpdates": context.automatic_updates, "schedule": copy.deepcopy(context.schedule), "secrets": "OMITTED"}


def help_document(topic="update"):
    all_names = (
        "version", "status", "doctor", "disk", "disk usage", "disk health", "services", "services status",
        "update", "update check", "update plan", "update apply", "update history", "install",
        "backup status", "backup list", "backup create", "backup verify", "backup schedule",
        "backup schedule enable", "backup schedule disable", "cloud status", "cloud sync", "restore plan",
        "history", "logs", "logs update", "logs backup", "config show",
    )
    names = [name for name in all_names if not topic or name == topic or name.startswith(topic + " ")]
    write_names = {"update", "update apply", "install", "backup create", "backup schedule enable", "backup schedule disable", "cloud sync"}
    return {"status": "OK", "help": {
        "title": "Справка ASA", "syntax": "asa " + (topic + " " if topic else "[КОМАНДА] ") + "[ПАРАМЕТРЫ]",
        "commands": [{"command": "asa " + name, "purpose": "Описание команды",
                      "changesData": name in write_names,
                      "privileges": "root через sudo; Ubuntu setup" if name in write_names else "Чтение; ограниченные права дают UNAVAILABLE"}
                     for name in names],
        "parameters": {key: "Описание параметра" for key in (
            "--help", "--json", "--no-color", "--root ПУТЬ", "--snapshot-id ID", "--operation-id ID",
            "--deployment-digest sha256:HEX", "--config-file ПУТЬ", "--non-interactive")},
        "examples": ["asa help update", "asa status --json", "asa disk health", "asa update plan", "sudo asa update", "sudo asa install --root /srv/asa-lab"],
        "exitCodes": {"0": "Успешно", "1": "Недоступно", "2": "Заблокировано", "130": "Прервано"},
        "notes": ["Без сети", "Оценки неизвестны", "Без TTY", "Windows"],
    }}


def examples(context):
    values = {
        "version": ({"status": "OK", "cli": {"version": "1.0.0"}, "application": release(context), "database": database()}, 0),
        "status": (status(context), 0), "doctor": (status(context, doctor=True), 0),
        "disk": (disk(context), 0), "disk usage": (disk(context), 0), "disk health": (disk_health(), 1),
        "services": (services(), 0), "services status": (services(), 0),
        "backup status": (backups(context), 0), "backup list": (backups(context, listing=True), 0),
        "backup verify": ({"status": "OK", "snapshotId": context.last_local_success, "local": "VERIFIED", "files": 4,
                           "bytes": 123456, "restore": "UNVERIFIED", "cloud": cloud_receipt()}, 0),
        "backup schedule": (schedule(context), 0), "cloud status": (cloud(), 1), "config show": (config(context), 0),
        "history": (history(context), 0), "update history": (history(context), 0),
        "logs": (logs(context), 0), "logs update": (logs(context), 0),
        "logs backup": ({"status": "UNAVAILABLE", "scope": "SANITIZED_OPERATION_EVENTS", "items": []}, 1),
        "restore plan": ({"status": "BLOCKED_PLAN", "reasonCode": "P1_R3A_REQUIRED", "applyAllowed": False,
                          "snapshotId": context.restore_snapshot_id, "backup": backups(context),
                          "restore": missing("NOT_RESTORED"), "nextAction": "Требуется отдельное разрешение."}, 2),
    }
    for command in ("update check", "update plan"):
        values[command] = (update(context), 0)
    return {command: (envelope(command, document, code), code) for command, (document, code) in values.items()}


def at(document, path):
    value = document
    for key in path:
        value = value[key]
    return value


class ReadEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.context = fixture()
        self.examples = examples(self.context)

    def check(self, command, document=None, code=None, context=None):
        original, default_code = self.examples[command]
        return check_read_result(command, original if document is None else document,
                                 returncode=default_code if code is None else code,
                                 expected=self.context if context is None else context)

    def rejected(self, command, path, value, code=None):
        document = copy.deepcopy(self.examples[command][0])
        at(document, path[:-1])[path[-1]] = value
        with self.assertRaises(CLIReadCheckError) as raised:
            self.check(command, document)
        self.assertIn(raised.exception.code, ERROR_CODES)
        if code is not None:
            self.assertEqual(raised.exception.code, code)
        self.assertEqual(str(raised.exception), raised.exception.code)
        self.assertNotIn(SECRET, str(raised.exception))

    def test_every_installed_read_form_has_closed_envelope_and_is_pure(self):
        before, context_before = copy.deepcopy(self.examples), copy.deepcopy(self.context)
        with mock.patch("builtins.open", side_effect=AssertionError("file I/O")), \
                mock.patch.object(os, "open", side_effect=AssertionError("file I/O")), \
                mock.patch.object(os, "stat", side_effect=AssertionError("metadata I/O")), \
                mock.patch.object(subprocess, "Popen", side_effect=AssertionError("process I/O")), \
                mock.patch.object(socket, "socket", side_effect=AssertionError("network I/O")):
            for command, (document, code) in self.examples.items():
                with self.subTest(command=command):
                    result = self.check(command)
                    self.assertEqual(result["format"], "asa-cli-result-v1")
                    self.assertEqual(result["command"], command)
                    self.assertEqual(result["exitCode"], code)
                    self.assertEqual(result["status"], document["status"])
        self.assertEqual(self.examples, before)
        self.assertEqual(self.context, context_before)

    def test_status_disk_update_projections_keep_actual_typed_examples(self):
        current, volumes, plan = self.check("status"), self.check("disk"), self.check("update plan")
        self.assertEqual(current["database"], database())
        self.assertEqual(current["installed"]["revision"], self.context.installed.revision)
        self.assertEqual(current["site"]["browserAcceptance"]["status"], "NOT_RUN")
        self.assertEqual(current["site"]["https"], "UNAVAILABLE")
        self.assertEqual(volumes["filesystems"]["postgres"]["freeBytes"], 10 * 1024 ** 3)
        self.assertEqual(volumes["physicalHealth"], missing("USE_DISK_HEALTH"))
        self.assertEqual(plan["target"]["deploymentDigest"], self.context.deployment_digest)
        self.assertEqual(plan["target"]["manifestDigest"], self.context.manifest_digest)
        self.assertEqual(plan["migrations"]["fromSchema"], 304)
        self.assertIsNone(plan["migrations"]["exactList"])
        self.assertIsNone(plan["requiredSpaceBytes"])
        self.assertIsNone(plan["estimatedDowntimeSeconds"])
        self.assertNotIn("apply", plan)
        self.assertNotIn("note", plan["cloud"])

    def test_envelope_checks_real_exit_not_json_claim(self):
        for command in self.examples:
            for key, value in (("format", "asa-setup-config-v1"), ("command", "install"), ("exitCode", True)):
                with self.subTest(command=command, key=key):
                    self.rejected(command, (key,), value, "CLI_ENVELOPE")
            with self.assertRaises(CLIReadCheckError) as raised:
                self.check(command, code=130)
            self.assertEqual(raised.exception.code, "CLI_ENVELOPE")
        with self.assertRaises(CLIReadCheckError):
            self.check("status", code=False)
        wrong = copy.deepcopy(self.examples["cloud status"][0])
        wrong["exitCode"] = 0
        with self.assertRaises(CLIReadCheckError):
            self.check("cloud status", wrong, code=0)

    def test_unknown_and_missing_root_fields_are_rejected_for_every_form(self):
        for command, (original, _) in self.examples.items():
            with self.subTest(command=command, mutation="unknown"):
                self.rejected(command, (SECRET,), SECRET, "FIELD_SET")
            for key in original:
                with self.subTest(command=command, missing=key):
                    document = copy.deepcopy(original)
                    del document[key]
                    with self.assertRaises(CLIReadCheckError):
                        self.check(command, document)

    def test_nested_unknown_keys_and_secrets_never_escape(self):
        cases = (("status", ("installed", "images")), ("status", ("site", "browserAcceptance", "historical")),
                 ("doctor", ("cloud", "transport")), ("disk", ("filesystems", "docker")),
                 ("backup status", ("lastLocalSuccess", "local")), ("config show", ("ports",)),
                 ("logs", ("items", 0, "events", 0)), ("update plan", ("target",)),
                 ("update plan", ("backupSpaceEstimate",)))
        for command, path in cases:
            with self.subTest(command=command, path=path):
                self.rejected(command, (*path, SECRET), {"password": SECRET}, "FIELD_SET")
        for command, path in (("cloud status", ("note",)), ("update plan", ("apply",)),
                              ("restore plan", ("nextAction",))):
            document = copy.deepcopy(self.examples[command][0])
            at(document, path[:-1])[path[-1]] = SECRET
            self.assertNotIn(SECRET, json.dumps(self.check(command, document)))

    def test_bool_is_not_a_number_and_numeric_bounds_are_enforced(self):
        cases = (("status", ("database", "schema")), ("status", ("database", "bytes")),
                 ("doctor", ("host", "cpuCount")), ("doctor", ("host", "memoryBytes")),
                 ("disk", ("filesystems", "backups", "freeBytes")), ("disk", ("filesystems", "docker", "freeInodes")),
                 ("config show", ("ports", "web")), ("config show", ("schedule", "maxAgeHours")),
                 ("backup status", ("lastAttempt", "ageHours")), ("backup verify", ("files",)),
                 ("update plan", ("backupSpaceEstimate", "requiredBytes")),
                 ("update plan", ("backupSpaceEstimate", "snapshotEntries")))
        for command, path in cases:
            for value in (True, "304", -1, float("nan")):
                with self.subTest(command=command, path=path, value=value):
                    self.rejected(command, path, value)
        self.rejected("backup status", ("lastAttempt", "ageHours"), 10 ** 1000)
        self.rejected("disk", ("filesystems", "application", "totalBytes"), 2 ** 63)
        self.rejected("backup verify", ("files",), 10001)

    def test_required_nested_failures_cannot_hide_under_ok(self):
        cases = (("services", "status"), ("database", "status"), ("site", "status"),
                 ("host", "status"), ("disk", "status"), ("diskHealth", "status"),
                 ("cloud", "transport", "status"), ("backup", "lastLocalSuccess", "local", "status"))
        for path in cases:
            for state in ("FAILED", "WARNING"):
                with self.subTest(path=path, state=state):
                    self.rejected("doctor", path, state)
        self.rejected("doctor", ("host", "supportedSetupHost"), False)
        self.rejected("doctor", ("disk", "filesystems", "postgres", "status"), "UNAVAILABLE")
        self.rejected("doctor", ("diskHealth", "devices", 0, "status"), "FAILED")
        self.rejected("doctor", ("diskHealth", "devices", 0, "status"), "WARNING")
        self.rejected("status", ("access",), "LIMITED")

    def test_service_identity_requires_all_six_active_services(self):
        self.rejected("services", ("containers",), [{"service": "api", "running": True, "health": "healthy"}])
        self.rejected("services", ("containers", 0, "running"), 1)
        self.rejected("services", ("containers", 0, "health"), "unhealthy")
        self.rejected("services", ("containers", 1, "service"), "api", "INSTALLATION_IDENTITY")
        self.rejected("services", ("docker", "status"), "UNAVAILABLE")
        self.rejected("services", ("containers", 0, "service"), SECRET)

    def test_physical_unavailable_stays_unavailable_and_is_not_failed(self):
        states = (disk_health(), {"status": "UNAVAILABLE", "devices": [], "reasonCode": "NO_PHYSICAL_SENSOR"},
                  missing("SMART_UNAVAILABLE"))
        for raw in states:
            with self.subTest(raw=raw):
                result = self.check("disk health", envelope("disk health", raw, 1))
                self.assertEqual(result["status"], "UNAVAILABLE")
                self.assertEqual(result["exitCode"], 1)
        observed = {"status": "OK", "devices": [{"device": "/dev/nvme0n1", "status": "OK"}], "reasonCode": None}
        result = self.check("disk health", envelope("disk health", observed), code=0)
        self.assertEqual(result["devices"], observed["devices"])
        doctor = copy.deepcopy(self.examples["doctor"][0])
        doctor["diskHealth"] = observed
        doctor["optionalUnavailableChecks"].remove("diskHealth")
        self.assertNotIn("diskHealth", self.check("doctor", doctor)["optionalUnavailableChecks"])
        self.rejected("disk health", ("status",), "OK")
        self.rejected("doctor", ("optionalUnavailableChecks",), ["cloud"])

    def test_cloud_and_restore_expected_limitations_are_preserved(self):
        result = self.check("cloud status")
        self.assertEqual(result["status"], "UNAVAILABLE")
        self.assertEqual(result["exitCode"], 1)
        self.assertEqual(result["remote"], missing("NO_READ_ONLY_PROVIDER_PROBE"))
        plan = self.check("restore plan")
        self.assertEqual((plan["status"], plan["exitCode"], plan["reasonCode"]), ("BLOCKED_PLAN", 2, "P1_R3A_REQUIRED"))
        self.assertEqual(plan["restore"], missing("NOT_RESTORED"))
        self.assertFalse(plan["applyAllowed"])
        self.rejected("cloud status", ("configured",), True)
        self.rejected("restore plan", ("applyAllowed",), True)
        self.rejected("restore plan", ("restore", "status"), "OK")
        context = replace(self.context, restore_snapshot_id=SNAPSHOT)
        document = copy.deepcopy(self.examples["restore plan"][0])
        document["snapshotId"] = SNAPSHOT
        self.assertEqual(self.check("restore plan", document, context=context)["snapshotId"], SNAPSHOT)

    def test_release_schema_images_and_both_target_digests_are_bound(self):
        for command in ("update check", "update plan"):
            for path, value, code in (
                (("target", "revision"), "f" * 40, "RELEASE_PIN_MISMATCH"),
                (("target", "schema"), 305, "SCHEMA_MISMATCH"),
                (("currentDatabase", "schema"), 303, "SCHEMA_MISMATCH"),
                (("target", "deploymentDigest"), "sha256:" + "f" * 64, "RELEASE_PIN_MISMATCH"),
                (("target", "manifestDigest"), "sha256:" + "f" * 64, "RELEASE_PIN_MISMATCH"),
                (("target", "images", "api"), "ghcr.io/spikeal8-maker/asa-lab/api@sha256:" + "f" * 64, "RELEASE_PIN_MISMATCH"),
                (("migrations", "toSchema"), True, "SCHEMA_MISMATCH"),
            ):
                with self.subTest(command=command, path=path):
                    self.rejected(command, path, value, code)
        self.rejected("status", ("site", "revision"), "f" * 40, "RELEASE_PIN_MISMATCH")
        self.rejected("status", ("installed", "schema"), 305, "SCHEMA_MISMATCH")
        self.rejected("update plan", ("target", "ci"), "UNVERIFIED")
        self.rejected("update plan", ("available",), False)
        self.rejected("update plan", ("applyRechecksUnderLock",), False)

    def test_drift_needs_an_explicit_new_approved_context(self):
        changed = replace(self.context, target=pin("f", "9"), deployment_digest="sha256:" + "8" * 64,
                          manifest_digest="sha256:" + "7" * 64)
        document = envelope("update check", update(changed))
        with self.assertRaises(CLIReadCheckError) as raised:
            self.check("update check", document)
        self.assertEqual(raised.exception.code, "RELEASE_PIN_MISMATCH")
        self.assertEqual(self.check("update check", document, context=changed)["target"]["revision"], "f" * 40)
        unchanged = replace(self.context, target=self.context.installed)
        document = envelope("update check", update(unchanged))
        self.assertFalse(self.check("update check", document, context=unchanged)["available"])

    def test_only_consistent_measured_backup_budget_is_accepted(self):
        for key, value in (("requiredBytes", 1), ("observedSnapshotBytes", 1), ("requiredInodes", 1025),
                           ("freeBytes", 1), ("freeInodes", 1), ("imageBytes", 0), ("sufficient", False),
                           ("snapshotEntries", None), ("status", "MEASURED")):
            with self.subTest(key=key):
                self.rejected("update plan", ("backupSpaceEstimate", key), value)
        for field in ("requiredSpaceBytes", "estimatedDowntimeSeconds"):
            for value in (0, False, 60, 1024 ** 3):
                self.rejected("update plan", (field,), value, "MEASUREMENT_INCONSISTENT")
        self.rejected("disk", ("filesystems", "backups", "freeBytes"), 19 * 1024 ** 3, "MEASUREMENT_INCONSISTENT")
        self.rejected("update plan", ("migrations", "exactList"), [])

    def test_unknown_space_is_retained_without_a_fabricated_number(self):
        for reason in ("STORAGE_MEASUREMENT_UNAVAILABLE", "SPACE_MEASUREMENT_UNAVAILABLE"):
            document = copy.deepcopy(self.examples["update plan"][0])
            document["backupSpaceEstimate"] = missing(reason)
            result = self.check("update plan", document)
            self.assertEqual(result["backupSpaceEstimate"], missing(reason))
            self.assertIsNone(result["requiredSpaceBytes"])
        document = copy.deepcopy(self.examples["update plan"][0])
        document["backupSpaceEstimate"] = missing(SECRET)
        with self.assertRaises(CLIReadCheckError) as raised:
            self.check("update plan", document)
        self.assertEqual(raised.exception.code, "UNRECOGNIZED_REASON")
        self.rejected("update plan", ("blockers",), ["BACKUP_SPACE"])
        self.rejected("update plan", ("blockers",), [SECRET], "UNRECOGNIZED_REASON")

    def test_unrecognized_reason_codes_are_not_sanitized_by_uppercase_regex(self):
        for command, path in (("cloud status", ("transport", "reasonCode")),
                              ("disk", ("physicalHealth", "reasonCode")),
                              ("restore plan", ("reasonCode",)), ("history", ("items", 0, "reasonCode")),
                              ("update plan", ("spaceReasonCode",)), ("status", ("updates", "reasonCode"))):
            with self.subTest(command=command):
                self.rejected(command, path, SECRET, "UNRECOGNIZED_REASON")

    def test_config_is_a_projection_with_separate_format_and_exact_fixture_fields(self):
        result = self.check("config show")
        self.assertEqual(result["format"], "asa-cli-result-v1")
        self.assertEqual(result["configFormat"], "asa-setup-config-v1")
        self.assertEqual(result["secrets"], "OMITTED")
        self.rejected("config show", ("project",), "other-installation", "INSTALLATION_IDENTITY")
        self.rejected("config show", ("root",), "/srv/other", "INSTALLATION_IDENTITY")
        self.rejected("config show", ("secrets",), SECRET)
        self.rejected("config show", ("automaticUpdates",), True, "INSTALLATION_IDENTITY")
        with self.assertRaises(CLIReadCheckError):
            self.check("config show", envelope("config show", missing("SETUP_CONFIGURATION"), 1), code=1)

    def test_snapshot_identity_and_local_verification_are_mandatory(self):
        self.rejected("backup verify", ("snapshotId",), OTHER_SNAPSHOT, "SNAPSHOT_MISMATCH")
        self.rejected("backup verify", ("restore",), "VERIFIED")
        self.rejected("backup status", ("lastLocalSuccess", "snapshotId"), OTHER_SNAPSHOT, "SNAPSHOT_MISMATCH")
        self.rejected("backup status", ("lastLocalSuccess", "local", "present"), False)
        self.rejected("backup status", ("lastLocalSuccess", "local", "deleted"), True)
        self.rejected("backup status", ("lastAttempt", "encryption", "status"), "FAILED")
        self.rejected("backup list", ("items",), [])
        self.rejected("backup list", ("truncated",), True)
        self.rejected("backup list", ("items", 0, "local", "bytes"), 123457, "SNAPSHOT_MISMATCH")

    def test_last_attempt_and_local_success_stay_separate(self):
        context = replace(self.context, snapshot_ids=(SNAPSHOT, OTHER_SNAPSHOT), last_attempt=OTHER_SNAPSHOT)
        document = envelope("backup list", backups(context, listing=True))
        result = self.check("backup list", document, context=context)
        self.assertEqual(result["lastAttempt"]["snapshotId"], OTHER_SNAPSHOT)
        self.assertEqual(result["lastLocalSuccess"]["snapshotId"], SNAPSHOT)
        self.assertEqual(result["lastCloudSuccess"], missing("BACKUP_EVIDENCE_MISSING"))
        no_encryption = replace(self.context, encryption_enabled=False)
        document = envelope("backup status", backups(no_encryption))
        self.assertEqual(self.check("backup status", document, context=no_encryption)["lastLocalSuccess"]["encryption"],
                         {"status": "NOT_CONFIGURED", "bytes": None})

    def test_age_rounding_between_reads_does_not_change_snapshot_identity(self):
        document = copy.deepcopy(self.examples["backup list"][0])
        document["lastLocalSuccess"]["ageHours"] = 0.11
        document["items"][0]["ageHours"] = 0.12
        result = self.check("backup list", document)
        self.assertEqual(result["lastAttempt"]["ageHours"], 0.1)
        self.assertEqual(result["lastLocalSuccess"]["ageHours"], 0.11)
        self.assertEqual(result["items"][0]["ageHours"], 0.12)

    def test_history_is_bound_to_accepted_operation_not_any_terminal_row(self):
        self.rejected("history", ("items", 0, "operationId"), "f" * 32, "OPERATION_MISMATCH")
        self.rejected("history", ("items", 0, "outcome"), "ERROR", "OPERATION_MISMATCH")
        self.rejected("history", ("items", 0, "state"), "RUNNING")
        self.rejected("history", ("truncated",), True)
        document = copy.deepcopy(self.examples["history"][0])
        previous = history_row(self.context)
        previous.update(operationId="f" * 32, outcome="BLOCKED", reasonCode="COMMAND")
        document["items"].append(previous)
        result = self.check("history", document)
        self.assertEqual(result["acceptedOperation"]["operationId"], self.context.accepted_operation_id)
        self.assertEqual(result["acceptedOperation"]["outcome"], "WARNING")
        self.assertEqual(result["historicalFailures"], 1)

    def test_logs_require_recorded_completion_without_forwarding_raw_strings(self):
        result = self.check("logs")
        self.assertEqual(result["scope"], "SANITIZED_OPERATION_EVENTS")
        self.assertIn("first_backup", result["acceptedOperation"]["completedStages"])
        self.rejected("logs", ("items", 0, "events", 5, "status"), "intent", "OPERATION_MISMATCH")
        self.rejected("logs", ("items", 0, "events", 0, "stage"), "secret_api_key")
        self.rejected("logs", ("items", 0, "events", 0, "phase"), "secret_phase")
        self.rejected("logs", ("scope",), "RAW_STDERR")
        self.rejected("logs", ("items", 0, "events"), [{"at": STAMP}] * 101)

    def test_last_failed_log_stage_cannot_hide_behind_earlier_done(self):
        document = copy.deepcopy(self.examples["logs"][0])
        document["items"][0]["events"].append({"at": STAMP, "stage": "first_backup", "status": "failed"})
        with self.assertRaises(CLIReadCheckError) as raised:
            self.check("logs", document)
        self.assertEqual(raised.exception.code, "OPERATION_MISMATCH")

    def test_failed_log_event_without_stage_is_rejected(self):
        for command in ("logs", "logs update"):
            with self.subTest(command=command):
                events = copy.deepcopy(self.examples[command][0]["items"][0]["events"])
                events.append({"at": STAMP, "status": "failed"})
                self.rejected(command, ("items", 0, "events"), events, "FIELD_SET")

    def test_failed_log_phase_without_stage_is_rejected(self):
        for command in ("logs", "logs update"):
            with self.subTest(command=command):
                events = copy.deepcopy(self.examples[command][0]["items"][0]["events"])
                events.append({"at": STAMP, "phase": "first_backup", "status": "failed"})
                self.rejected(command, ("items", 0, "events"), events, "FIELD_SET")

    def test_informational_log_events_without_status_preserve_completion(self):
        information = [{"at": STAMP}, {"at": STAMP, "phase": "created"},
                       {"at": STAMP, "phase": "bootstrap"}, {"at": STAMP, "stage": "first_backup"}]
        for command in ("logs", "logs update"):
            with self.subTest(command=command):
                baseline = self.check(command)
                document = copy.deepcopy(self.examples[command][0])
                document["items"][0]["events"].extend(copy.deepcopy(information))
                before = copy.deepcopy(document)
                result = self.check(command, document)
                self.assertEqual(result["status"], "OK")
                self.assertEqual(result["acceptedOperation"]["events"],
                                 baseline["acceptedOperation"]["events"] + len(information))
                self.assertEqual(result["acceptedOperation"]["completedStages"],
                                 baseline["acceptedOperation"]["completedStages"])
                self.assertEqual(document, before)

    def test_update_history_and_logs_enforce_mode_filter_and_update_backup_stage(self):
        for command in ("update history", "logs update"):
            document = copy.deepcopy(self.examples[command][0])
            row = history_row(self.context)
            row.update(operationId="f" * 32, mode="backup")
            if command == "logs update":
                row["events"] = []
            document["items"].append(row)
            with self.assertRaises(CLIReadCheckError) as raised:
                self.check(command, document)
            self.assertEqual(raised.exception.code, "OPERATION_MISMATCH")
        context = replace(self.context, accepted_mode="update")
        document = envelope("logs update", logs(context))
        document["items"][0]["events"][-1]["stage"] = "backup"
        result = self.check("logs update", document, context=context)
        self.assertIn("backup", result["acceptedOperation"]["completedStages"])
        self.assertNotIn("first_backup", result["acceptedOperation"]["completedStages"])

    def test_context_is_explicit_and_invalid_context_never_becomes_evidence(self):
        contexts = (replace(self.context, cloud_enabled=True), replace(self.context, backup_policy="required"),
                    replace(self.context, installed=replace(self.context.installed, schema=True)),
                    replace(self.context, snapshot_ids=()), replace(self.context, root="/srv/../other"),
                    replace(self.context, deployment_digest=SECRET), replace(self.context, restore_snapshot_id=OTHER_SNAPSHOT))
        for context in contexts:
            with self.subTest(context_field_difference=True):
                with self.assertRaises(CLIReadCheckError) as raised:
                    self.check("status", context=context)
                self.assertEqual(str(raised.exception), "INVALID_CONTEXT")
        with self.assertRaises(CLIReadCheckError):
            check_read_result("status", self.examples["status"][0], returncode=0)

    def test_returned_mutable_objects_do_not_alias_inputs(self):
        original = copy.deepcopy(self.examples["update plan"][0])
        context_before = copy.deepcopy(self.context)
        result = self.check("update plan")
        result["target"]["images"]["api"] = SECRET
        result["backup"]["schedule"]["configured"]["enabled"] = True
        result["disk"]["filesystems"]["application"]["path"] = SECRET
        self.assertEqual(self.examples["update plan"][0], original)
        self.assertEqual(self.context, context_before)

    def test_timestamps_and_array_limits_are_checked(self):
        for stamp in (None, STAMP[:-6], "not-a-date", SECRET):
            self.rejected("status", ("observedAt",), stamp)
        self.rejected("history", ("items", 0, "updatedAt"), "2025-01-01T00:00:00+00:00", "OPERATION_MISMATCH")
        self.rejected("services", ("containers",), [services()["containers"][0]] * 65)
        self.rejected("disk health", ("devices",), [{"device": "/dev/vda", "status": "UNAVAILABLE"}] * 33)

    def test_writes_unknown_commands_and_error_messages_are_closed(self):
        for command in ("install", "update", "update apply", "cloud sync", "restore apply", SECRET, None):
            with self.assertRaises(CLIReadCheckError) as raised:
                check_read_result(command, {}, returncode=0, expected=self.context)
            self.assertEqual(raised.exception.code, "UNSUPPORTED_COMMAND")
        self.assertEqual(str(CLIReadCheckError(SECRET)), "FIELD_TYPE")
        self.assertEqual(str(CLIReadCheckError({"password": SECRET})), "FIELD_TYPE")


class HelpEvidenceTests(unittest.TestCase):
    def check(self, document, topic="update"):
        return check_read_result("help", envelope("help", document), returncode=0, help_topic=topic)

    def test_help_metadata_has_exact_commands_and_write_classification(self):
        for topic in ("", "update", "backup", "status", "backup verify"):
            with self.subTest(topic=topic):
                result = self.check(help_document(topic), topic=topic)
                self.assertEqual(result["format"], "asa-cli-result-v1")
                self.assertEqual(result["exitCodes"], [0, 1, 2, 130])
                self.assertEqual(result["topic"], topic)
                self.assertNotIn("purpose", result["commands"][0])
        update_help = self.check(help_document())
        self.assertEqual([item["command"] for item in update_help["commands"] if item["changesData"]], ["asa update", "asa update apply"])

    def test_missing_update_command_or_false_mutation_metadata_fails(self):
        for mutation in ("missing", "duplicate", "false_write", "unknown", "missing_parameter", "wrong_exit"):
            document = help_document()
            if mutation == "missing":
                document["help"]["commands"].pop(1)
            elif mutation == "duplicate":
                document["help"]["commands"][1] = document["help"]["commands"][0]
            elif mutation == "false_write":
                document["help"]["commands"][0]["changesData"] = False
            elif mutation == "unknown":
                document["help"]["commands"][0]["command"] = "asa " + SECRET
            elif mutation == "missing_parameter":
                del document["help"]["parameters"]["--json"]
            else:
                document["help"]["exitCodes"]["9"] = SECRET
            with self.subTest(mutation=mutation), self.assertRaises(CLIReadCheckError):
                self.check(document)

    def test_help_prose_is_omitted_and_unknown_fields_are_not_forwarded(self):
        document = help_document()
        document["help"]["title"] = SECRET
        document["help"]["commands"][0]["purpose"] = SECRET
        document["help"]["parameters"]["--help"] = SECRET
        document["help"]["notes"][0] = SECRET
        self.assertNotIn(SECRET, json.dumps(self.check(document)))
        document["help"]["commands"][0]["password"] = SECRET
        with self.assertRaises(CLIReadCheckError) as raised:
            self.check(document)
        self.assertEqual(raised.exception.code, "FIELD_SET")


if __name__ == "__main__":
    unittest.main()
