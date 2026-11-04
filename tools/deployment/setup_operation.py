"""Durable pinned setup phases, with verification-only ambiguous switch recovery.

The caller holds operation_lock throughout. Journals contain observations and
intent, never credentials. A receipt is not permission to repeat a migration.
"""

import copy
from contextlib import contextmanager, redirect_stdout, redirect_stderr
import datetime as dt
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid

from . import backup_schedule, backup_workflow, setup_acceptance, setup_discovery, setup_host
from .backup import consume_backup_hold, db_command, recovery_configuration, resume_backup_writers
from .contracts import Blocked, DEFAULT_WINDOW, REPOSITORY, attest_editor_env, read_env, require, validate_release
from .paths import atomic_bytes, plain_paths
from .releases import apply_release_environment, assert_ci, discover_release, fetch_images, validate_deployment_digest, validate_resolved_images
from .setup_config import load_config, private_json, read_installed_release, replace_legacy_manager_state, save_installed_release, save_private, validate_config
from .setup_result import finalize, now, result
from .system import (Installation, PUBLIC_ORIGINS_CONTENT, PUBLIC_ORIGINS_FILE,
                     PUBLIC_ORIGINS_MARKER, PUBLIC_ORIGINS_MODE, public_origins_overlay,
                     public_origins_recovery, _origin_private_read, run)


OPERATION_ID = re.compile(r"[a-f0-9]{32}\Z")
ENVIRONMENT_FORMAT = "asa-setup-install-environment-v1"
TERMINAL = {"ACCEPTED", "WARNING", "NO_CHANGE", "CHECKED", "CONFIGURED", "STATUS", "PLANNED"}
ACTIVE_STATES = {"RUNNING", "VERIFY_ONLY", "RECOVERY_REQUIRED"}


def guard_intent(intent, discovery, pending=None):
    """Explicit public install/update cannot turn into the other operation."""
    if intent is None:
        return
    require(intent in ("install", "update"), "OPERATION_INTENT", "Неизвестное намерение операции.")
    require(not pending or pending.get("mode") == intent, "OPERATION_INTENT",
            "Незавершённая операция имеет другое назначение.")
    state = discovery.get("state")
    allowed = ("FRESH",) if intent == "install" else ("MANAGED", "LEGACY", "STOPPED")
    require(state in allowed or state == "INTERRUPTED" and pending is not None and pending.get("mode") == intent,
            "OPERATION_INTENT", "Фактическое состояние не допускает запрошенную установку или обновление.",
            "Проверьте asa status и журнал; install и update apply не заменяют друг друга.")


def bind_selection(journal, *, intent=None, deployment_digest=None):
    """Bind to the durable journal before preparation, discovery or handoff."""
    require(intent is None or intent == journal.get("mode"), "OPERATION_INTENT", "Назначение журнала отличается.")
    prior_intent = journal.get("requestedIntent")
    require(prior_intent is None or prior_intent == journal.get("mode") and intent in (None, prior_intent),
            "OPERATION_INTENT", "Сохранённое намерение операции изменилось.")
    if deployment_digest is not None:
        validate_deployment_digest(deployment_digest)
    prior_digest = journal.get("requestedDeploymentDigest")
    if prior_digest is not None:
        validate_deployment_digest(prior_digest)
        require(deployment_digest in (None, prior_digest), "RELEASE_SELECTOR_CHANGED", "Операция уже привязана к другому deployment digest.")
    # A pre-existing selected release with no pin cannot be relabelled as a
    # newly requested digest without resolving and verifying that identity.
    require(not deployment_digest or prior_digest or not journal.get("release"),
            "RELEASE_SELECTOR_CHANGED", "Для прежнего выбранного выпуска нет подтверждения этого digest.")
    if intent:
        journal["requestedIntent"] = intent
    if deployment_digest:
        journal["requestedDeploymentDigest"] = deployment_digest
    return journal.get("requestedDeploymentDigest")


class Store:
    def __init__(self, root, installation_id):
        self.root = Path(root)
        self.state = self.root / ".asa"
        self.installation_id = installation_id

    def path(self, operation_id):
        require(isinstance(operation_id, str) and OPERATION_ID.fullmatch(operation_id), "OPERATION_ID", "Некорректный ID операции.")
        return self.state / "setup-operations" / (operation_id + ".json")

    def create(self, mode, project, *, operation_id=None, bootstrap=None, dependent=None, selection=None):
        operation_id = operation_id or uuid.uuid4().hex
        require(not self.path(operation_id).exists(), "OPERATION_EXISTS", "Операция уже существует; нужен resume.")
        journal = {"format": "asa-setup-operation-v1", "operationId": operation_id,
                   "installationId": self.installation_id, "root": str(self.root), "project": project,
                   "mode": mode, "state": "RUNNING", "startedAt": now(), "updatedAt": now(),
                   "phase": "created", "stages": {}, "events": [], "handoffs": 0}
        if bootstrap:
            journal.update(bootstrapConfig=copy.deepcopy(bootstrap["config"]),
                           bootstrapInventory=inventory_digest(bootstrap["inventory"]), phase="bootstrap")
        if dependent:
            journal.update(copy.deepcopy(dependent))
        if selection:
            bind_selection(journal, **selection)
        self.save(journal)
        return journal

    def read(self, operation_id):
        journal = private_json(self.path(operation_id))
        require(journal.get("format") == "asa-setup-operation-v1" and journal.get("operationId") == operation_id
                and journal.get("installationId") == self.installation_id and journal.get("root") == str(self.root),
                "OPERATION_IDENTITY", "Журнал не принадлежит этой установке.")
        return journal

    def save(self, journal):
        journal["updatedAt"] = now()
        save_private(self.path(journal["operationId"]), journal)

    def validate_child(self, child, parent):
        binding = child.get("parentBinding", {})
        require(child.get("parentOperationId") == parent["operationId"] != child["operationId"]
                and parent.get("mode") in ("install", "update") and not parent.get("parentOperationId")
                and child.get("mode") in ("backup", "retry-cloud")
                and child.get("root") == parent.get("root") == str(self.root)
                and child.get("installationId") == parent.get("installationId") == self.installation_id
                and child.get("project") == parent.get("project")
                and binding.get("format") == "asa-setup-dependent-v1"
                and binding.get("parentOperationId") == parent["operationId"],
                "DEPENDENT_IDENTITY", "Зависимая операция не связана с этой установкой и родительским журналом.")
        release = validate_release(parent.get("release"))
        require(binding.get("revision") == release["revision"] and binding.get("schema") == release["schema"]
                and isinstance(child.get("snapshotId"), str) and backup_workflow.SNAPSHOT.fullmatch(child["snapshotId"])
                and child.get("backupPolicy") == parent.get("backupPolicy"),
                "DEPENDENT_BINDING", "Закреплённые версия, snapshot или политика зависимой операции изменились.")
        if child["mode"] == "backup":
            require(binding.get("kind") == "first-backup-replacement" and parent["mode"] == "install"
                    and parent.get("stages", {}).get("switch", {}).get("status") == "done"
                    and parent.get("stages", {}).get("first_backup")
                    and isinstance(binding.get("replacesSnapshotId"), str)
                    and backup_workflow.SNAPSHOT.fullmatch(binding["replacesSnapshotId"])
                    and child["snapshotId"] != binding["replacesSnapshotId"]
                    and child.get("backupRuntime") == {"revision": release["revision"], "schema": release["schema"]},
                    "DEPENDENT_BINDING", "Новая копия не привязана к принятому runtime и прежнему неполному снимку.")
        else:
            require(binding.get("kind") == "cloud-delivery"
                    and isinstance(binding.get("sourceOperationId"), str)
                    and OPERATION_ID.fullmatch(binding["sourceOperationId"]),
                    "DEPENDENT_BINDING", "Доставка не привязана к исходной операции резервирования.")
        return child

    def _catalog(self):
        directory = self.state / "setup-operations"
        if not directory.exists():
            return {}
        plain_paths(directory, ())
        records = {path.stem: self.read(path.stem) for path in directory.glob("*.json")}
        active_children = {}
        for journal in records.values():
            parent_id = journal.get("parentOperationId")
            if parent_id is None:
                require(not journal.get("parentBinding"), "DEPENDENT_IDENTITY", "Зависимая операция потеряла parent ID.")
                continue
            require(parent_id in records, "DEPENDENT_PARENT_MISSING", "Родительский журнал зависимой операции отсутствует.")
            parent = records[parent_id]
            self.validate_child(journal, parent)
            source = journal["parentBinding"].get("sourceOperationId")
            if source and source != parent_id:
                require(source in records and records[source].get("parentOperationId") == parent_id
                        and records[source].get("mode") == "backup"
                        and records[source].get("snapshotId") == journal["snapshotId"],
                        "DEPENDENT_SOURCE", "Доставка ссылается на чужой снимок или неизвестную дочернюю копию.")
                self.validate_child(records[source], parent)
            if journal["state"] in ACTIVE_STATES:
                require(parent["state"] in ACTIVE_STATES, "DEPENDENT_PARENT_STATE", "У зависимой операции нет незавершённого родителя.")
                active_children.setdefault(parent_id, []).append(journal)
        require(all(len(children) <= 1 for children in active_children.values()), "DEPENDENTS_AMBIGUOUS",
                "У родительской операции несколько незавершённых зависимых действий.")
        return records

    def children(self, parent, *, active=False):
        return [value for value in self._catalog().values() if value.get("parentOperationId") == parent["operationId"]
                and (not active or value["state"] in ACTIVE_STATES)]

    def create_child(self, parent, mode, *, snapshot_id, source_operation_id=None, replaces_snapshot_id=None):
        require(parent["state"] in ACTIVE_STATES and not self.children(parent, active=True), "DEPENDENT_PENDING",
                "Сначала завершите прежнее зависимое действие через resume с его operation ID.")
        release = validate_release(parent["release"])
        binding = {"format": "asa-setup-dependent-v1", "parentOperationId": parent["operationId"],
                   "kind": "first-backup-replacement" if mode == "backup" else "cloud-delivery",
                   "revision": release["revision"], "schema": release["schema"]}
        if mode == "backup":
            binding["replacesSnapshotId"] = replaces_snapshot_id
        else:
            binding["sourceOperationId"] = source_operation_id
        dependent = {"parentOperationId": parent["operationId"], "parentBinding": binding,
                     "snapshotId": snapshot_id, "backupPolicy": copy.deepcopy(parent["backupPolicy"])}
        if mode == "backup":
            dependent["backupRuntime"] = {"revision": release["revision"], "schema": release["schema"]}
        # The complete parent/snapshot binding is in the very first durable
        # child record; a kill before its first side effect cannot orphan it.
        child = {"operationId": uuid.uuid4().hex, "root": str(self.root), "installationId": self.installation_id,
                 "project": parent["project"], "mode": mode, **dependent}
        self.validate_child(child, parent)
        return self.create(mode, parent["project"], operation_id=child["operationId"], dependent=dependent)

    def backup_context(self, parent):
        operation_id = parent.get("stages", {}).get("first_backup", {}).get("backupOperationId")
        if not operation_id or operation_id == parent["operationId"]:
            return parent
        child = self.read(operation_id)
        self.validate_child(child, parent)
        require(child["mode"] == "backup", "DEPENDENT_BINDING", "Первый backup ссылается на другую команду.")
        return child

    def pending(self):
        candidates = [journal for journal in self._catalog().values()
                      if journal["state"] in ACTIVE_STATES and not journal.get("parentOperationId")]
        require(len(candidates) <= 1, "OPERATIONS_AMBIGUOUS", "Найдено несколько незавершённых операций.",
                "Сопоставьте operation IDs и исходное состояние; новый update не запускается.")
        return candidates[0] if candidates else None

    def event(self, journal, stage, status, **details):
        # Remember verified copies even if a continuation overwrites its stage
        # receipt. A later missing file must never look like an unstarted export.
        for evidence in (journal["stages"].get(stage, {}).get("evidence"), details.get("evidence")):
            if isinstance(evidence, dict) and evidence.get("local", {}).get("status") == "OK" and evidence.get("snapshotId"):
                verified = journal.setdefault("verifiedBackupSnapshots", [])
                if evidence["snapshotId"] not in verified:
                    verified.append(evidence["snapshotId"])
        journal["phase"] = stage
        journal["stages"][stage] = {"status": status, "at": now(), **details}
        journal["events"].append({"stage": stage, "status": status, "at": now()})
        self.save(journal)

    def finish(self, journal, outcome):
        receipt = outcome.get("backup", {})
        previous = journal.get("result", {}).get("backup", {})
        if receipt.get("local", {}).get("error") == "BACKUP_RESUME_SNAPSHOT_MISSING" and (
                receipt.get("snapshotId") in journal.get("verifiedBackupSnapshots", []) or
                previous.get("snapshotId") == receipt.get("snapshotId") and previous.get("local", {}).get("status") == "OK"):
            receipt["local"]["previouslyVerified"] = True
        finalize(outcome)
        outcome["stage"] = journal["phase"]
        journal["result"] = outcome
        switched = "switch" in journal["stages"]
        marker = self.state / "maintenance.json"
        hold_remains = False
        if marker.exists() and not switched:
            maintenance = private_json(marker)
            hold_remains = maintenance.get("operationId") == journal["operationId"]
        recovery_required = not switched and (hold_remains or outcome.get("recovery", {}).get("status") == "FAILED")
        journal["state"] = "RECOVERY_REQUIRED" if recovery_required else "TERMINAL" if outcome["outcome"] in TERMINAL or (outcome["outcome"] in ("BLOCKED", "ERROR") and not switched) else "VERIFY_ONLY" if switched else "RUNNING"
        self.save(journal)
        save_private(self.state / "setup-last-attempt.json", outcome)
        if outcome.get("applicationAccepted") and outcome["exitCode"] == 0:
            save_private(self.state / "setup-last-successful.json", outcome)
        return outcome


def inventory_key(inventory):
    """Ignore timestamps, compare resource identity during the initial lock gap."""
    return {key: inventory.get(key) for key in ("complete", "daemon", "containers", "volumes", "images")}


def inventory_digest(inventory):
    return hashlib.sha256(json.dumps(inventory_key(inventory), sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def configuration_digest(config):
    application = {key: config.get(key) for key in ("installationId", "root", "operatorUid", "profile", "entryOrigin", "project", "dataIdentity", "browser")}
    return hashlib.sha256(json.dumps(application, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def bootstrap_record(root, operator_uid):
    """Recover only a complete, owner-private initial intent, never a guess."""
    directory = Path(root) / ".asa/setup-operations"
    if not directory.exists():
        return None
    plain_paths(directory, ())
    candidates = []
    for path in directory.glob("*.json"):
        value = private_json(path, owner=operator_uid)
        if value.get("format") == "asa-setup-operation-v1" and value.get("mode") == "install" and value.get("state") == "RUNNING" and value.get("bootstrapConfig"):
            require(value.get("root") == str(root) and value.get("phase") == "bootstrap"
                    and value.get("operationId") == path.stem and OPERATION_ID.fullmatch(path.stem),
                    "BOOTSTRAP_IDENTITY", "Первичный журнал не относится к выбранному корню.")
            config = validate_config(value["bootstrapConfig"], root, operator_uid)
            require(config["installationId"] == value.get("installationId") and config["project"] == value.get("project"),
                    "BOOTSTRAP_IDENTITY", "Конфигурация и первичный журнал расходятся.")
            candidates.append(value)
    require(len(candidates) <= 1, "BOOTSTRAP_AMBIGUOUS", "Есть несколько первичных журналов без конфигурации.")
    return candidates[0] if candidates else None


def bootstrap_observation(root, inventory, journal):
    require(inventory.get("complete") is True and inventory_digest(inventory) == journal["bootstrapInventory"]
            and not (Path(root) / ".env").exists() and not (Path(root) / ".asa/setup.json").exists(),
            "BOOTSTRAP_CHANGED", "Состояние изменилось после первичного журнала до сохранения конфигурации.",
            "Сопоставьте Docker и приватный bootstrap-журнал; новая пустая база не создаётся.")
    return {"state": "INTERRUPTED", "root": str(root), "project": journal["project"],
            "installationId": journal["installationId"], "operationId": journal["operationId"], "dataIdentity": None,
            "reasons": [{"code": "KNOWN_BOOTSTRAP", "message": "Первичная настройка прервана до сохранения setup.json.",
                         "action": "Выполните resume с operation ID из первичного журнала."}]}


def _safe_status(error):
    return error.code if isinstance(error, Blocked) else type(error).__name__


def production_public_origins(entry, public, web_port):
    """Keep an explicit public list; canonical HTTP entry is never an extra origin."""
    from urllib.parse import urlsplit
    require(type(web_port) is int and 1024 <= web_port <= 65535 and web_port not in (3000, 3100, 5173),
            "PUBLIC_ORIGINS_ENTRY", "Invalid canonical Web port.")
    canonical = f"http://127.0.0.1:{web_port}"
    require(isinstance(entry, str) and (entry == canonical or entry.startswith("https://")),
            "PUBLIC_ORIGINS_ENTRY", "Production entry must be public HTTPS or the exact configured canonical Web origin.")
    require(isinstance(public, str), "PUBLIC_ORIGINS_POLICY", "Invalid private public-origin list.")

    def normalized(value):
        try:
            parsed = urlsplit(value)
            port = parsed.port
            host = parsed.hostname
            require(parsed.scheme == "https" and host and not parsed.username and not parsed.password
                    and parsed.path in ("", "/") and not parsed.query and not parsed.fragment
                    and "\\" not in value
                    and not any(character.isspace() or ord(character) < 32 for character in value)
                    and host not in ("localhost", "127.0.0.1", "::1")
                    and (port is None or 1 <= port <= 65535),
                    "PUBLIC_ORIGINS_POLICY", "Additional public origins must be exact non-loopback HTTPS origins.")
            return "https://" + ("[" + host + "]" if ":" in host else host) + (":" + str(port) if port not in (None, 443) else "")
        except ValueError as error:
            raise Blocked("PUBLIC_ORIGINS_POLICY", "Invalid additional public origin.",
                          "Correct the approved HTTPS origin configuration before starting the installation.") from error

    pieces = [value.strip() for value in public.split(",") if value.strip()]
    require((not public or pieces) and len(pieces) <= 8, "PUBLIC_ORIGINS_POLICY", "Invalid or excessive additional public origins.")
    origins = [normalized(value) for value in pieces]
    if entry != canonical and normalized(entry) not in origins:
        require(len(pieces) < 8, "PUBLIC_ORIGINS_POLICY", "The selected public entry exceeds the existing public-origin limit.")
        public = public + ("," if public else "") + entry
    return public


def setup_environment_bytes(config, values, public):
    """Use the same exact afterimage for journal validation and publication."""
    values = dict(values)
    ports = config.get("ports", {"web": 4610, "api": 4611, "blocks": 4613})
    values.update(COMPOSE_PROJECT_NAME=config["project"], ASA_UPDATE_ENTRY_ORIGIN=config["entryOrigin"],
                  ASA_BLOCKS_PARENT_ORIGIN=config["entryOrigin"], ASA_BLOCKS_RUNTIME_ORIGIN=config["entryOrigin"],
                  ASA_PUBLIC_WEB_ORIGINS=public, ASA_SEED_DEV="false",
                  ASA_WEB_PORT=str(ports["web"]), ASA_API_PORT=str(ports["api"]), ASA_BLOCKS_PORT=str(ports["blocks"]))
    if config["profile"] == "production" and not public:
        values[PUBLIC_ORIGINS_MARKER] = PUBLIC_ORIGINS_MODE
    return ("# Private installation settings; never upload unencrypted.\n" +
            "".join(f"{key}={value}\n" for key, value in values.items())).encode()


def environment_configuration_sha(config):
    return hashlib.sha256(json.dumps(config, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def fresh_install_progress(root, config, journal):
    """Validate the recorded preparation prefix; no runtime or data is adopted."""
    stages = journal["stages"]
    preparation = ("settings", "images", "space", "migration_plan", "backup_preflight")
    require(set(stages) <= {"configured", "preflight", "release", "source", "handoff", "environment", *preparation}
            and all(isinstance(record, dict) for record in stages.values())
            and all(stages.get(name, {}).get("status") == "done" for name in ("preflight", "release", "source", "environment"))
            and not any(name in journal for name in ("previousRuntime", "storageIdentity", "temporarilyStarted", "noChange",
                                                     "parentOperationId", "parentBinding", "backupRuntime"))
            and journal.get("backupPolicy") == config.get("backup"),
            "FRESH_CONTINUATION", "The journal is not a bound first-install preparation sequence.")
    release = validate_release(journal.get("release"))
    require(stages["release"].get("revision") == release["revision"]
            and isinstance(stages["source"].get("evidence"), dict)
            and stages["source"]["evidence"].get("revision") == release["revision"]
            and ("configured" not in stages or stages["configured"].get("status") == "done")
            and type(journal.get("handoffs")) is int and journal["handoffs"] in (0, 1)
            and ("handoff" not in stages and journal["handoffs"] == 0 or "handoff" in stages
                 and journal["handoffs"] == 1 and stages["handoff"].get("status") == "intent"
                 and stages["handoff"].get("revision") == release["revision"]),
            "FRESH_CONTINUATION", "The prepared source or handoff differs from the recorded release.")
    phase, interrupted = "environment", False
    for name in preparation:
        record = stages.get(name)
        if record is None:
            interrupted = True
            continue
        require(not interrupted and record.get("status") in ("intent", "done"),
                "FRESH_CONTINUATION", "The first-install preparation stages are incomplete or out of order.")
        phase = name
        interrupted = record["status"] == "intent"
    require(journal.get("phase") == phase, "FRESH_CONTINUATION", "The pending phase differs from the preparation journal.")
    backup = Path(config.get("backupDirectory", str(root / "backups")))
    require(backup.is_absolute(), "FRESH_CONTINUATION", "The first-install backup directory must be absolute.")
    plain_paths(backup, ())
    backup = backup.resolve()
    backup_info = backup.lstat() if backup.exists() else None
    require(backup_info is None or stat.S_ISDIR(backup_info.st_mode) and not any(backup.iterdir())
            and (os.name == "nt" or backup_info.st_uid == os.geteuid() and not backup_info.st_mode & 0o077),
            "FRESH_CONTINUATION", "First-install continuation requires an empty, private, operator-owned backup directory.")
    settings = root / ".asa/installation.json"
    status = stages.get("settings", {}).get("status")
    present = os.path.lexists(settings)
    require((status != "done" or present and backup_info is not None) and (not present or status in ("intent", "done")),
            "FRESH_CONTINUATION", "The saved settings do not match their preparation stage.")
    content = _origin_private_read(root, ".asa/installation.json") if present else None
    if content is not None:
        expected = {"format": "asa-installation-v1", "instanceId": config["installationId"], "profile": config["profile"],
                    "project": config["project"], "automaticUpdates": False, "window": DEFAULT_WINDOW,
                    "backupDirectory": str(backup)}
        require(json.dumps(json.loads(content), sort_keys=True, separators=(",", ":"))
                == json.dumps(expected, sort_keys=True, separators=(",", ":")) and backup_info is not None,
                "FRESH_CONTINUATION", "Only the exact settings of this first-install operation can be continued.")
    return {"settingsSha256": hashlib.sha256(content).hexdigest() if content is not None else None,
            "backupDirectory": str(backup), "backupIdentity":
            [backup_info.st_dev, backup_info.st_ino, backup_info.st_mode, backup_info.st_uid] if backup_info else None}


def installation_discovery(root, inventory, config=None, journal=None, *, install=None):
    """Recognise a bound fresh environment and its preparation, without writes."""
    config = config or {}
    observed = setup_discovery.classify_installation(root, inventory, project=config.get("project"),
        saved_identity=config.get("dataIdentity"), pending_operation=journal)
    reason = [item.get("code") for item in observed.get("reasons", [])]
    if not (config and journal and (observed.get("state") == "PARTIAL" and reason == ["PROJECT_DRIFT"]
                                   or observed.get("state") == "INTERRUPTED" and reason == ["KNOWN_INSTALLATION"])):
        return observed
    root = Path(root)
    install = install or Installation(root, config["profile"])
    if not (install.public_origins_pending or journal.get("installEnvironment") or journal.get("publicOriginsEnvironment")):
        return observed
    stages = journal.get("stages")
    require(isinstance(stages, dict) and isinstance(stages.get("environment"), dict),
            "PUBLIC_ORIGINS_RECOVERY", "The environment journal is not a valid stage record.")
    if "switch" in stages or not install.public_origins_pending and stages["environment"].get("status") not in ("intent", "done"):
        return observed
    continuation = stages["environment"].get("status") == "done"
    # first_environment's preimage can still name its default project. Never
    # interpret this private, journal-bound file as an existing runtime to adopt.
    current = read_env(root / ".env")
    configured = private_json(root / ".asa/setup.json")
    store = Store(root, config["installationId"])
    general = journal.get("installEnvironment")
    origin_binding = journal.get("publicOriginsEnvironment")
    binding = general if general is not None else origin_binding
    require(store.read(journal["operationId"]) == journal == store.pending()
            and journal.get("mode") == journal.get("requestedIntent") == "install"
            and journal.get("state") == "RUNNING" and (continuation or journal.get("phase") == "environment")
            and stages["environment"].get("status") in ("intent", "done")
            and "switch" not in journal.get("stages", {}) and journal.get("project") == config["project"]
            and not config.get("dataIdentity")
            and current.get("COMPOSE_PROJECT_NAME") in ("asa-lab-dev", config["project"])
            and current.get(PUBLIC_ORIGINS_MARKER) in (None, PUBLIC_ORIGINS_MODE)
            and (not continuation or current.get("COMPOSE_PROJECT_NAME") == config["project"])
            and all(configured.get(key) == config.get(key) for key in
                    ("installationId", "root", "operatorUid", "profile", "project", "entryOrigin", "ports", "dataIdentity"))
            and isinstance(binding, dict)
            and all(isinstance(binding.get(key), str) and re.fullmatch(r"[a-f0-9]{64}", binding[key])
                    for key in ("beforeSha256", "afterSha256")),
            "PUBLIC_ORIGINS_RECOVERY", "The environment stage is not bound to this pending installation.")
    if general is not None:
        require(set(general) == {"format", "beforeSha256", "afterSha256", "configurationSha256"}
                and general.get("format") == ENVIRONMENT_FORMAT and configured == config
                and general.get("configurationSha256") == environment_configuration_sha(config),
                "ENVIRONMENT_RECOVERY", "The saved environment proof does not match this installation's approved configuration.")
    else:
        require("installEnvironment" not in journal and set(binding) == {"format", "beforeSha256", "afterSha256"}
                and binding.get("format") == PUBLIC_ORIGINS_MODE,
                "ENVIRONMENT_RECOVERY", "An unknown legacy environment proof cannot authorize continuation.")
    ports = config.get("ports", {"web": 4610, "api": 4611, "blocks": 4613})
    public = (production_public_origins(config["entryOrigin"], current.get("ASA_PUBLIC_WEB_ORIGINS", ""), ports["web"])
              if config["profile"] == "production" else config["entryOrigin"])
    empty_policy = config["profile"] == "production" and not public
    require(hashlib.sha256(setup_environment_bytes(config, current, public)).hexdigest() == binding["afterSha256"],
            "PUBLIC_ORIGINS_RECOVERY", "The pending environment no longer matches its recorded target settings.")
    actual = hashlib.sha256(_origin_private_read(root, ".env")).hexdigest()
    require((os.name == "nt" or os.geteuid() == root.stat().st_uid)
            and actual in (binding["beforeSha256"], binding["afterSha256"])
            and (not continuation or actual == binding["afterSha256"]),
            "ENVIRONMENT_RECOVERY", "The private environment differs from its recorded before/after images.")
    overlay = public_origins_overlay(root)
    if empty_policy:
        require(overlay, "PUBLIC_ORIGINS_MISSING", "The pending environment requires its original private overlay.")
        require(origin_binding == {"format": PUBLIC_ORIGINS_MODE, "beforeSha256": binding["beforeSha256"],
                                   "afterSha256": binding["afterSha256"]}
                and (not continuation or current.get(PUBLIC_ORIGINS_MARKER) == PUBLIC_ORIGINS_MODE),
                "ENVIRONMENT_RECOVERY", "The empty-origin policy differs from the installation environment proof.")
        if current.get(PUBLIC_ORIGINS_MARKER) is None:
            public_origins_recovery(root, current, config["profile"])
    else:
        require(general is not None and origin_binding is None and not overlay and current.get(PUBLIC_ORIGINS_MARKER) is None,
                "ENVIRONMENT_RECOVERY", "The public entry policy contains an unexpected private overlay or lacks a fresh-install proof.")
    progress = fresh_install_progress(root, config, journal) if continuation else None
    for name in ("installed-release.json", "runtime-configuration.json", "maintenance.json",
                 "failed-switch.json", "atomic-active.json", "last-operation.json"):
        require(not os.path.lexists(root / ".asa" / name), "PUBLIC_ORIGINS_EXISTING", "Existing installation state prevents environment recovery.")
    require(continuation or not os.path.lexists(root / ".asa/installation.json"),
            "PUBLIC_ORIGINS_EXISTING", "Existing settings prevent environment preparation.")
    plain_paths(root, ("backups",))
    backups = root / "backups"
    require(not backups.exists() or backups.is_dir() and not any(backups.iterdir()),
            "PUBLIC_ORIGINS_EXISTING", "Existing backups prevent environment recovery.")
    projects = {config["project"], current["COMPOSE_PROJECT_NAME"]}
    require(inventory.get("complete") is True and isinstance(inventory.get("containers"), list)
            and isinstance(inventory.get("volumes"), list), "PUBLIC_ORIGINS_INVENTORY", "Environment recovery requires a complete resource inventory.")
    require(not any(record.get("labels", {}).get("project") in projects
                    or record.get("labels", {}).get("root") == str(root) for record in inventory["containers"])
            and not any(record.get("labels", {}).get("project") in projects
                        or any(record.get("name", "").startswith(project + "_") for project in projects)
                        for record in inventory["volumes"]),
            "PUBLIC_ORIGINS_EXISTING", "Existing containers or volumes prevent environment recovery.")
    identities = {}
    for path in (root / ".env", root / ".asa/setup.json", store.path(journal["operationId"]), root / PUBLIC_ORIGINS_FILE,
                 root / ".asa/installation.json"):
        info = path.lstat() if path.exists() else None
        identities[str(path.relative_to(root))] = [info.st_dev, info.st_ino, info.st_mode, info.st_uid] if info else None
    proof = {"journal": journal, "configuration": configured, "paths": identities,
             "image": "after" if actual == binding["afterSha256"] else "before", "preparation": progress}
    observed.update(state="INTERRUPTED", project=config["project"], installationId=config["installationId"],
                    operationId=journal["operationId"], environmentStage=hashlib.sha256(
                        json.dumps(proof, sort_keys=True, separators=(",", ":")).encode()).hexdigest(), reasons=[{
                        "code": "KNOWN_FRESH_INSTALL" if continuation else "KNOWN_ENVIRONMENT_STAGE",
                        "message": "Подтверждена незавершённая первичная установка до запуска контейнеров.",
                        "action": "Продолжите эту операцию через resume; существующие ключи сохраняются."}])
    return observed


class Runtime:
    """Real adapters; a small injectable boundary for failure-path tests."""
    def __init__(self, root, config, *, lock_fd=None, defer_report=False, json_output=False, intent=None, deployment_digest=None):
        self.root, self.config = Path(root), config
        self.install = Installation(root, config["profile"])
        self.lock_fd, self.defer_report, self.json_output = lock_fd, defer_report, json_output
        self.operation_id = None
        self._operation_journal = None
        self.intent, self.deployment_digest = intent, deployment_digest

    def reload(self):
        self.install = Installation(self.root, self.config["profile"])

    def progress(self, text):
        print(text, file=sys.stderr if self.json_output else sys.stdout, flush=True)

    @contextmanager
    def private_output(self):
        """Capture inherited subprocess output as well as Python diagnostics."""
        path = self.root / ".asa/setup-logs" / (self.operation_id + ".log") if getattr(self, "operation_id", None) else None
        if path:
            plain_paths(path, ())
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            stream = os.fdopen(descriptor, "w", encoding="utf-8")
        else:
            stream = tempfile.TemporaryFile(mode="w+", encoding="utf-8")
        with stream:
            old_out, old_err = os.dup(1), os.dup(2)
            try:
                sys.stdout.flush()
                sys.stderr.flush()
                os.dup2(stream.fileno(), 1)
                os.dup2(stream.fileno(), 2)
                with redirect_stdout(stream), redirect_stderr(stream):
                    yield
            finally:
                stream.flush()
                os.dup2(old_out, 1)
                os.dup2(old_err, 2)
                os.close(old_out)
                os.close(old_err)

    def preflight(self, *, fresh=False):
        platform = setup_host.check_platform()
        owner = setup_host.check_owner(self.root, self.config.get("backupDirectory"), self.config["operatorUid"])
        require(owner["uid"] == os.geteuid() != 0, "OPERATOR", "Рабочие операции выполняет подтверждённый непривилегированный владелец.")
        dependencies = setup_host.inspect_dependencies(cloud=bool(self.config["backup"].get("ageRecipient")))
        require(not dependencies.get("missing"), "DEPENDENCIES", "Не установлены необходимые зависимости.",
                "Повторите asa-setup.sh с подготовкой хоста; приложения и данные пока не переключены.")
        browser = self.config.get("browser", {})
        if browser.get("pythonPath"):
            require(Path(browser["pythonPath"]).is_file(), "DEPENDENCIES", "Runtime браузерной приёмки ещё не подготовлен.",
                    "Root supervisor подготовит закреплённый runtime и продолжит эту операцию.")
        system = setup_host.system_state()
        require(system.get("systemd") and system.get("onePanel") == "ACTIVE", "HOST_PROFILE", "Профиль Ubuntu 24.04 + действующий 1Panel не подтверждён.")
        require(system.get("timeSynchronized") is True, "TIME_UNVERIFIED", "Синхронизация времени не подтверждена.", "Восстановите синхронизацию системного времени перед проверкой выпуска.")
        setup_host.network_preflight(self.config["entryOrigin"])
        ports = self.config.get("ports", {"web": 4610, "api": 4611, "blocks": 4613})
        setup_host.check_ports(list(ports.values()), existing=not fresh)
        backup_workflow.validate_policy(self.config["backup"], self.config["installationId"])
        return {"status": "OK", "platform": platform, "operatorUid": owner["uid"], "system": system}

    def backup_preflight(self):
        if self.config["backup"].get("cloud", {}).get("enabled"):
            # Provider identity is proven before freezing writers. Constructor
            # creates only this installation's private transport staging dirs.
            try:
                backup_workflow.CloudTransport(self.config["backup"]["cloud"], self.config["installationId"])
            except Blocked as error:
                if backup_workflow.cloud_unavailable(error):
                    if self.config["backup"]["policy"] == "best-effort":
                        # Transport availability is optional; run_backup must still
                        # create/verify the local snapshot and record cloud failure.
                        return {"status": "WARNING", "reasonCode": "CLOUD_UNAVAILABLE"}
                    raise Blocked("CLOUD_PREPARATION", "Общий проверенный облачный транспорт пока не готов.",
                                  "Root supervisor проверит разрешённый transport; чужие контейнеры не заменяются.") from error
                raise
        return {"status": "OK"}

    def select(self):
        with self.private_output():
            release = discover_release(self.deployment_digest) if self.deployment_digest else discover_release()
        assert_ci(release)
        return release

    def guard(self, journal):
        self.deployment_digest = bind_selection(journal, intent=self.intent, deployment_digest=self.deployment_digest)
        if journal.get("requestedIntent") is not None:
            guard_intent(journal["requestedIntent"], self.discovery(journal), journal)
        self._operation_journal = journal

    def identity(self, *, existing=True):
        return self.install.identity(existing=existing)

    def discovery(self, journal=None):
        return installation_discovery(self.root, setup_discovery.docker_inventory(), self.config, journal, install=self.install)

    def current(self):
        return self.install.readiness()

    def stopped_start(self, journal, store):
        records = self.identity()
        required = {"postgres", "minio", "api", "web", "scratch"}
        require(required <= set(records), "STOPPED_RUNTIME_INCOMPLETE", "У остановленной установки отсутствуют прежние обязательные контейнеры.")
        ids = [record["id"] for record in records.values() if not record["running"]]
        installed = self.root / ".asa/installed-release.json"
        require(installed.exists(), "STOPPED_RELEASE_MISSING", "Для запуска остановленной установки нужна сохранённая точная версия.")
        release = read_installed_release(self.root)
        if journal.get("temporarilyStarted"):
            require(set(ids) <= set(journal["temporarilyStarted"]), "STOPPED_IDENTITY", "Исходный набор остановленных контейнеров изменился.")
        else:
            journal["temporarilyStarted"] = ids
        store.event(journal, "start_existing", "intent")
        if ids:
            run(["docker", "start", *ids], capture=True, timeout=90)
        self.install.wait_ready(release["revision"], release["schema"])
        store.event(journal, "start_existing", "done")

    def stopped_restore(self, journal):
        ids = journal.get("temporarilyStarted", [])
        if ids:
            actual = self.identity()
            require(set(ids) <= {item["id"] for item in actual.values()}, "STOPPED_IDENTITY", "Исходные контейнеры изменились.")
            run(["docker", "stop", "--time", "30", *ids], capture=True, timeout=120)
            states = run(["docker", "inspect", "--format", "{{.Id}} {{.State.Running}}", *ids], capture=True, timeout=30)
            observed = dict(line.split() for line in states.splitlines())
            require(set(observed) == set(ids) and all(value == "false" for value in observed.values()),
                    "STOPPED_RECOVERY", "Прежнее остановленное состояние не подтверждено.")
            return {"previousRuntimeVerified": False, "previousStateRestored": True, "previousState": "STOPPED"}

    def source(self, release, *, fresh=False, previous=None):
        root = self.root
        plain_paths(root, (".git", ".env", ".asa"))
        if not (root / ".git").exists():
            require(fresh, "GIT_MISSING", "У существующей установки отсутствует исходный checkout.")
            backups = root / "backups"
            plain_paths(backups, ())
            require(not backups.exists() or backups.is_dir() and not any(backups.iterdir()),
                    "TARGET_BACKUP_REMNANTS", "В новой цели обнаружены архивы прежней установки.",
                    "Разберите происхождение backup; не создавайте поверх него пустую базу.")
            unknown = [p for p in root.iterdir() if p.name not in (".asa", ".env", "asa-setup.sh", "backups")]
            require(not unknown, "TARGET_NOT_EMPTY", "В новом каталоге есть неизвестные файлы.")
            run(["git", "init", "--quiet", str(root)], capture=True)
            run(["git", "-C", str(root), "remote", "add", "origin", f"https://github.com/{REPOSITORY}.git"], capture=True)
        git = self.install.git
        require(git("remote", "get-url", "origin").removesuffix(".git") in
                (f"https://github.com/{REPOSITORY}", f"git@github.com:{REPOSITORY}"), "ORIGIN", "Не подтверждён официальный репозиторий.")
        # Fail closed on tracked changes; private ignored state is preserved.
        require(not git("diff", "--name-only") and not git("diff", "--cached", "--name-only"),
                "DIRTY", "В исходниках есть изменения; автоматическая перезапись запрещена.")
        git("fetch", "origin", "main:refs/remotes/origin/main")
        git("merge-base", "--is-ancestor", release["revision"], "origin/main")
        protected = git("ls-tree", "-r", "--name-only", release["revision"], "--", ".env", ".asa", "backups")
        require(not protected, "SOURCE_PRIVATE_PATH", "Выпуск пытается занять приватный путь установки.")
        if previous:
            git("merge-base", "--is-ancestor", previous["revision"], release["revision"])
            replace_legacy_manager_state(self.root, "runtime-configuration.json", recovery_configuration(self.install, previous))
        # A single downloaded entry script is not a target checkout. Do not
        # overwrite an untracked user file, including a bootstrap copy.
        untracked = git("ls-files", "--others", "--exclude-standard").splitlines()
        allowed = {".env"}
        untracked = [path for path in untracked if not path.startswith((".asa/", "backups/")) and path not in allowed]
        if fresh and untracked == ["asa-setup.sh"]:
            bootstrap = root / "asa-setup.sh"
            expected = Path(__file__).resolve().parents[2] / "asa-setup.sh"
            require(expected.exists() and bootstrap.read_bytes() == expected.read_bytes(), "DIRTY", "Непроверенный bootstrap в каталоге установки.")
            bootstrap.rename(self.install.state / "initial-bootstrap.sh")
            untracked = []
        require(not untracked, "DIRTY", "В checkout есть неизвестные неотслеживаемые файлы.")
        git("switch", "--detach", release["revision"])
        require(git("rev-parse", "HEAD") == release["revision"], "SOURCE_REVISION", "Checkout не совпадает с выпуском.")
        return {"revision": release["revision"]}

    def handoff(self, journal, store):
        target = self.root / "tools/asa_setup.py"
        current = Path(__file__).resolve().parents[1] / "asa_setup.py"
        if not target.exists() or target.resolve() == current.resolve() or journal.get("handoffs", 0):
            return
        source = self.install.git("show", journal["release"]["revision"] + ":tools/asa_setup.py")
        require(source.rstrip() == target.read_text(encoding="utf-8").rstrip(), "HANDOFF_SOURCE", "Целевой CLI изменён после проверки Git.")
        require("SETUP_PROTOCOL = 1" in source, "HANDOFF_PROTOCOL", "Выпуск требует несовместимый протокол setup.")
        # Protocol-1 targets understand mode/release and never reselect when
        # release is durable. Do not pass new argparse flags to an old target.
        bind_selection(journal, intent=self.intent, deployment_digest=self.deployment_digest)
        validate_release(journal.get("release"))
        require(self.lock_fd is not None, "HANDOFF_LOCK", "Для handoff нужен удерживаемый общий lock.")
        journal["handoffs"] += 1
        store.event(journal, "handoff", "intent", revision=journal["release"]["revision"])
        os.set_inheritable(self.lock_fd, True)
        argv = [sys.executable, "-I", "-B", "-X", "pycache_prefix=/dev/null/asa-setup", str(target), "resume", "--root", str(self.root),
                "--operation-id", journal["operationId"], "--lock-fd", str(self.lock_fd), "--non-interactive"]
        if self.defer_report:
            argv.append("--defer-report")
        if self.json_output:
            argv.append("--json")
        os.execv(sys.executable, argv)

    def verify_source(self, release):
        require(self.install.git("rev-parse", "HEAD") == release["revision"]
                and not self.install.git("diff", "--name-only") and not self.install.git("diff", "--cached", "--name-only")
                and not self.install.git("ls-files", "--others", "--exclude-standard"),
                "SOURCE_CHANGED", "Исходники изменились после выбора выпуска.",
                "Сохраните локальные изменения и подтвердите exact checkout; миграции автоматически не повторяются.")

    def environment(self):
        from asa_manager import first_environment
        path = self.root / ".env"
        plain_paths(self.root, (".env", PUBLIC_ORIGINS_FILE))
        ports = self.config.get("ports", {"web": 4610, "api": 4611, "blocks": 4613})
        existing = read_env(path) if path.exists() else {}
        public = (production_public_origins(self.config["entryOrigin"], existing.get("ASA_PUBLIC_WEB_ORIGINS", ""), ports["web"])
                  if self.config["profile"] == "production" else self.config["entryOrigin"])
        empty_policy = self.config["profile"] == "production" and not public
        overlay = public_origins_overlay(self.root)
        require(not overlay or empty_policy, "PUBLIC_ORIGINS_POLICY",
                "The installed empty-origin overlay cannot be changed to another entry policy during environment preparation.")
        journal = None
        require(not empty_policy or self.operation_id, "PUBLIC_ORIGINS_OPERATION", "The empty-origin policy requires a recorded fresh-install operation.")
        if self.operation_id:
            store = Store(self.root, self.config["installationId"])
            saved_journal = store.read(self.operation_id)
            journal = self._operation_journal if self._operation_journal is not None else saved_journal
            require(journal == saved_journal, "PUBLIC_ORIGINS_OPERATION", "The fresh-install journal changed before environment preparation.")
            self._operation_journal = journal
            require(journal.get("mode") == "install" and journal.get("project") == self.config["project"]
                    and journal.get("state") == "RUNNING"
                    and "switch" not in journal.get("stages", {})
                    and journal.get("stages", {}).get("environment", {}).get("status") == "intent"
                    and not self.config.get("dataIdentity")
                    and private_json(self.root / ".asa/setup.json") == self.config,
                    "PUBLIC_ORIGINS_OPERATION", "Environment preparation is not bound to a fresh installation and its private configuration.")
            if not overlay:
                require(not existing.get(PUBLIC_ORIGINS_MARKER), "PUBLIC_ORIGINS_MISSING", "The original public-origin overlay is missing.")
            for name in ("installation.json", "installed-release.json", "runtime-configuration.json", "maintenance.json",
                         "failed-switch.json", "atomic-active.json", "last-operation.json"):
                require(not os.path.lexists(self.root / ".asa" / name), "PUBLIC_ORIGINS_EXISTING", "Existing installation state prevents fresh environment preparation.")
            inventory = setup_discovery.docker_inventory()
            require(inventory.get("complete") is True and isinstance(inventory.get("containers"), list)
                    and isinstance(inventory.get("volumes"), list), "PUBLIC_ORIGINS_INVENTORY", "A complete resource inventory is required before preparing the environment.")
            project = self.config["project"]
            require(not any(record.get("labels", {}).get("project") == project
                            or record.get("labels", {}).get("root") == str(self.root)
                            for record in inventory["containers"])
                    and not any(record.get("labels", {}).get("project") == project
                                or record.get("name", "").startswith(project + "_")
                                for record in inventory["volumes"]),
                    "PUBLIC_ORIGINS_EXISTING", "Existing containers or volumes prevent fresh environment preparation.")
        if not path.exists():
            first_environment(self.root, self.config["profile"])
        values = read_env(path)
        require(all(values.get(key) for key in ("POSTGRES_PASSWORD", "ASA_APP_DB_PASSWORD", "MIGRATION_DATABASE_URL",
                "CLASSROOM_CODE_SECRET", "ASA_OBJECT_STORAGE_SECRET_KEY", "ASA_SEARCH_SECRET")),
                "ENV_INCOMPLETE", "Создание private .env было прервано; секреты автоматически не заменяются.")
        content = setup_environment_bytes(self.config, values, public)
        changed = False
        if journal is not None:
            general = {"format": ENVIRONMENT_FORMAT, "configurationSha256": environment_configuration_sha(self.config),
                       "beforeSha256": hashlib.sha256(_origin_private_read(self.root, ".env")).hexdigest(),
                       "afterSha256": hashlib.sha256(content).hexdigest()}
            previous_general = journal.get("installEnvironment")
            require(previous_general is None or isinstance(previous_general, dict) and set(previous_general) == set(general)
                    and all(previous_general.get(key) == general[key] for key in ("format", "configurationSha256", "afterSha256"))
                    and isinstance(previous_general.get("beforeSha256"), str) and re.fullmatch(r"[a-f0-9]{64}", previous_general["beforeSha256"])
                    and general["beforeSha256"] in (previous_general.get("beforeSha256"), previous_general.get("afterSha256")),
                    "ENVIRONMENT_RECOVERY", "The fresh-install environment or its approved configuration changed.")
        if empty_policy:
            binding = {"format": PUBLIC_ORIGINS_MODE, "beforeSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                       "afterSha256": hashlib.sha256(content).hexdigest()}
            previous = journal.get("publicOriginsEnvironment")
            require(previous is None and not overlay or isinstance(previous, dict)
                    and set(previous) == {"format", "beforeSha256", "afterSha256"}
                    and previous.get("format") == PUBLIC_ORIGINS_MODE
                    and previous.get("afterSha256") == binding["afterSha256"]
                    and binding["beforeSha256"] in (previous.get("beforeSha256"), previous.get("afterSha256")),
                    "PUBLIC_ORIGINS_RECOVERY", "The interrupted public-origin environment changed; private settings are preserved.")
            if previous is None:
                journal["publicOriginsEnvironment"] = binding
                changed = True
            elif previous_general is None:
                general["beforeSha256"] = previous["beforeSha256"]
        if journal is not None and previous_general is None:
            journal["installEnvironment"] = general
            changed = True
        if changed:
            store.save(journal)
        if empty_policy:
            if not overlay:
                require(not os.path.lexists(self.root / PUBLIC_ORIGINS_FILE), "PUBLIC_ORIGINS_PATH", "The overlay path appeared during preparation.")
                atomic_bytes(self.root / PUBLIC_ORIGINS_FILE, PUBLIC_ORIGINS_CONTENT.encode(), mode=0o600)
                if os.name != "nt":
                    descriptor = os.open(self.root / ".asa", os.O_RDONLY | os.O_DIRECTORY)
                    try:
                        os.fsync(descriptor)
                    finally:
                        os.close(descriptor)
        atomic_bytes(path, content, mode=0o600)
        if journal is not None and os.name != "nt":
            descriptor = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        self.reload()

    def settings(self):
        from asa_manager import backup_directory
        self.install.settings.update(instanceId=self.config["installationId"], backupDirectory=self.config.get("backupDirectory", str(self.root / "backups")))
        previous = self.install.settings
        backup = backup_directory(self.install, create=True)
        replace_legacy_manager_state(self.root, "installation.json", {**previous, "format": "asa-installation-v1",
            "profile": self.install.profile, "project": self.install.project,
            "automaticUpdates": previous.get("automaticUpdates", False), "window": previous.get("window", DEFAULT_WINDOW),
            "backupDirectory": str(backup)})
        self.reload()

    def images(self, release):
        with self.private_output():
            fetch_images(release)
        apply_release_environment(self.install, release)
        validate_resolved_images(self.install, release)

    def estimate(self, *, fresh=False):
        size = 0
        entries = 32
        if not fresh:
            value = db_command(self.install, 'psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_database_size(current_database())"', capture=True, timeout=60)
            require(value.isdigit(), "SPACE_ESTIMATE", "Размер базы не подтверждён.")
            objects = self.install.compose("exec", "-T", "minio", "du", "-sk", "/data", capture=True, timeout=60).split()[0]
            require(objects.isdigit(), "SPACE_ESTIMATE", "Размер объектного хранилища не подтверждён.")
            size = int(value) + int(objects) * 1024 + (self.root / ".env").stat().st_size
            count = self.install.compose("exec", "-T", "minio", "sh", "-eu", "-c",
                'set -o pipefail; find /data -xdev -print0 | tr -cd "\\000" | wc -c', capture=True, timeout=90).strip()
            require(count.isdigit() and int(count) >= 1, "SPACE_ESTIMATE", "Количество элементов объектного хранилища не подтверждено.")
            entries += int(count)
        return setup_host.disk_budget(self.config.get("backupDirectory", str(self.root / "backups")),
                                      snapshot_bytes=size, snapshot_entries=entries)

    def plan(self, release, *, fresh=False):
        apply_release_environment(self.install, release)
        validate_resolved_images(self.install, release)
        if fresh:
            # The database does not exist yet. Full plan requires its schema;
            # Compose's normal first migration is covered by switch intent.
            return {"status": "NEW_DATABASE", "schema": release["schema"]}
        output = self.install.compose("run", "--rm", "--no-deps", "--entrypoint", "node", "migration",
                                      "tools/migrate.mjs", "--plan", capture=True, timeout=120)
        # Only a digest/size is public; migration logs can contain DB details.
        return {"status": "OK", "sha256": hashlib.sha256(output.encode()).hexdigest()}

    def backup(self, journal, *, hold, snapshot_id=None):
        # The dump/recovery checks describe the actual old runtime, even
        # though planning/pulls have loaded target image pins in this process.
        actual = Installation(self.root, self.config["profile"])
        with self.private_output():
            return backup_workflow.run_backup(actual, operation_id=journal["operationId"],
                installation_id=self.config["installationId"], policy=journal.get("backupPolicy", self.config["backup"]),
                hold_writers=hold, snapshot_id=snapshot_id)

    def backup_receipt(self, journal, snapshot_id):
        receipt = backup_workflow.verify_receipt(self.install, snapshot_id=snapshot_id,
                                                 installation_id=self.config["installationId"])
        require(receipt.get("operationId") == journal["operationId"], "BACKUP_IDENTITY", "Receipt относится к другой операции.")
        return receipt

    def resume_saved_backup(self, journal, snapshot_id=None):
        """Complete a known saved snapshot; the backend cannot export again."""
        actual = Installation(self.root, self.config["profile"])
        with self.private_output():
            return backup_workflow.run_backup(actual, operation_id=journal["operationId"],
                installation_id=self.config["installationId"], policy=journal.get("backupPolicy", self.config["backup"]),
                hold_writers=False, snapshot_id=snapshot_id, allow_export=False)

    def known_backup_snapshot(self, journal):
        binding = private_json(self.install.state / "setup-backups" / ("operation-" + journal["operationId"] + ".json"))
        require(binding.get("operationId") == journal["operationId"]
                and binding.get("installationId") == self.config["installationId"]
                and isinstance(binding.get("snapshotId"), str) and backup_workflow.SNAPSHOT.fullmatch(binding["snapshotId"]),
                "BACKUP_IDENTITY", "Привязка снимка относится к другой операции.")
        return binding["snapshotId"]

    def recover_owned_backup(self, journal):
        """Rescue an exact known backup hold before any live-readiness probe."""
        marker = self.install.state / "maintenance.json"
        if not marker.exists():
            return None
        value = private_json(marker)
        expected = journal.get("backupRuntime")
        if not expected:
            # Compatibility with a known interrupted standalone operation
            # written before backupRuntime was pinned in its setup journal.
            require(journal.get("mode") == "backup" and journal.get("stages", {}).get("backup"),
                    "BACKUP_RECOVERY_RUNTIME", "В журнале нет исходного runtime резервирования.")
            release = read_installed_release(self.root)
            expected = {"revision": release["revision"], "schema": release["schema"]}
        snapshot = journal.get("snapshotId") or self.known_backup_snapshot(journal)
        require(value.get("format") == "asa-backup-hold-v1" and value.get("operationId") == journal["operationId"]
                and value.get("installationId") == self.config["installationId"]
                and value.get("canonicalRoot") == str(self.root) and value.get("composeProject") == self.config["project"]
                and value.get("snapshotId") == snapshot
                and value.get("runtime", {}).get("revision") == expected.get("revision")
                and value.get("runtime", {}).get("schema") == expected.get("schema"),
                "BACKUP_RECOVERY_IDENTITY", "Журнал остановки не совпадает с operation, snapshot и исходным runtime.")
        return resume_backup_writers(self.install, journal["operationId"])

    def incomplete_first_backup(self, journal, backup_journal):
        """A new child is allowed only when the original final is absent."""
        stage = backup_journal.get("stages", {}).get("first_backup", {})
        binding = self.install.state / "setup-backups" / ("operation-" + backup_journal["operationId"] + ".json")
        if not binding.exists():
            snapshot = stage.get("snapshotId")
            require(backup_journal["operationId"] == journal["operationId"] and stage.get("status") == "intent"
                    and isinstance(snapshot, str) and backup_workflow.SNAPSHOT.fullmatch(snapshot),
                    "FIRST_BACKUP_PIN_MISSING", "Нет закреплённого ID исходной первой копии.")
            final = Path(self.install.settings.get("backupDirectory") or self.root / "backups") / snapshot
            receipt = self.install.state / "setup-backups" / (snapshot + ".json")
            for path in (binding, final, final.with_name(snapshot + ".incomplete"), receipt, self.install.state / "maintenance.json"):
                plain_paths(path, ())
                require(not path.exists(), "FIRST_BACKUP_START_UNCERTAIN", "У исходной первой копии есть данные без полной привязки; новая копия заблокирована.")
            # The parent intent pinned an ID, but the backend never created
            # its binding/receipt/hold or archive. Preserve that original ID.
            return snapshot
        snapshot = backup_journal.get("snapshotId") or self.known_backup_snapshot(backup_journal)
        saved = self.backup_receipt(backup_journal, snapshot)
        final = Path(self.install.settings.get("backupDirectory") or self.root / "backups") / snapshot
        plain_paths(final, ())
        require(saved.get("local", {}).get("status") != "OK" and not final.exists(),
                "FIRST_BACKUP_ALREADY_SAVED", "Сохранённый снимок уже существует; новый export не требуется.",
                "Выполните resume --operation-id " + journal["operationId"] + " или retry-cloud --snapshot-id " + snapshot + ".")
        return snapshot

    def verified_child_backup(self, parent, child):
        saved = self.backup_receipt(child, child["snapshotId"])
        require(saved.get("local", {}).get("status") == "OK", "FIRST_BACKUP_INCOMPLETE", "Новая дочерняя копия ещё не сохранена полностью.")
        _, manifest = backup_workflow._verify_local(self.install, saved)
        release = parent["release"]
        require(manifest.get("runtime", {}).get("revision") == release["revision"]
                and manifest.get("runtime", {}).get("schema") == release["schema"]
                and manifest.get("operationId") == child["operationId"]
                and manifest.get("installationId") == self.config["installationId"]
                and manifest.get("snapshotId") == child["snapshotId"],
                "FIRST_BACKUP_RUNTIME", "Новая копия не принадлежит принятому runtime и дочерней операции.")
        return saved

    def consume_hold(self, journal):
        return consume_backup_hold(self.install, journal["operationId"])

    def rescue(self, journal):
        path = self.install.state / "maintenance.json"
        if path.exists():
            marker = private_json(path)
            if marker.get("format") == "asa-backup-hold-v1" and marker.get("operationId") == journal["operationId"]:
                resumed = resume_backup_writers(self.install, journal["operationId"])
                stopped = self.stopped_restore(journal)
                return stopped or resumed
        stopped = self.stopped_restore(journal)
        return stopped or {"previousRuntimeVerified": False}

    def recover_acceptance_backup(self, journal):
        marker = self.install.state / "maintenance.json"
        if not marker.exists():
            return
        value = private_json(marker)
        require(value.get("format") == "asa-backup-hold-v1" and value.get("operationId") == journal["operationId"]
                and value.get("installationId") == self.config["installationId"]
                and value.get("runtime", {}).get("revision") == journal["release"]["revision"]
                and value.get("runtime", {}).get("schema") == journal["release"]["schema"],
                "POST_ACCEPTANCE_BACKUP_IDENTITY", "Прерванный первый backup не связан с уже принятой версией.")
        recovered = resume_backup_writers(self.install, journal["operationId"])
        return {**recovered, "snapshotId": value.get("snapshotId"), "installationId": self.config["installationId"]}

    def switch(self, journal, hold=None):
        release = journal["release"]
        apply_release_environment(self.install, release)
        deadline = hold["deadlineMonotonic"] if hold else time.monotonic() + 600
        remaining = deadline - time.monotonic()
        require(remaining > 0, "BACKUP_FREEZE_TIMEOUT", "Истёк срок запрета записи; переключение не начато.")
        save_private(self.install.state / "maintenance.json", {"format": "asa-setup-switch-v1",
                     "operationId": journal["operationId"], "installationId": self.config["installationId"],
                     "canonicalRoot": str(self.root), "composeProject": self.config["project"],
                     "selectedRevision": release["revision"], "phase": "switch", "at": now(),
                     "deadlineEpoch": hold.get("deadlineEpoch") if hold else None,
                     "deadlineMonotonic": deadline, "bootId": hold.get("bootId") if hold else None})
        # Migration is a normal Compose dependency, executed at most once by
        # this invocation. Any timeout or interruption changes resume to observe.
        remaining = deadline - time.monotonic()
        require(remaining > 0, "BACKUP_FREEZE_TIMEOUT", "Истёк срок запрета записи до запуска Compose.")
        with self.private_output():
            self.install.compose("up", "-d", "--no-build", timeout=remaining)
        while time.monotonic() < deadline:
            try:
                self.install.readiness(release["revision"], release["schema"], deadline=deadline)
                require(time.monotonic() < deadline, "SWITCH_TIMEOUT", "Проверка готовности завершилась после срока запрета записи.")
                break
            except (Blocked, OSError, ValueError):
                time.sleep(min(3, max(0, deadline - time.monotonic())))
        else:
            raise Blocked("SWITCH_TIMEOUT", "Выпуск не стал готовым в пределах окна запрета записи.",
                          "Проверьте миграцию и runtime; автоматический rollback после изменения схемы запрещён.")
        return {"revision": release["revision"], "schema": release["schema"]}

    def technical(self, journal):
        return setup_acceptance.technical_acceptance(self.install, journal["release"], journal["operationId"],
                                                    expected_data=journal.get("storageIdentity"))

    def browser(self, journal):
        return setup_acceptance.browser_acceptance(self.install, journal["release"], journal["operationId"],
            self.config.get("browser"), installation_id=self.config["installationId"])

    def diagnostics(self, journal):
        return setup_acceptance.collector_observation(self.install, journal["operationId"])

    def commit_runtime(self, journal):
        save_installed_release(self.root, journal["release"])
        self.settings()
        discovery = self.discovery(journal)
        require(discovery.get("dataIdentity"), "DATA_IDENTITY", "После запуска не подтверждены исходные хранилища.")
        if self.config.get("dataIdentity"):
            require(self.config["dataIdentity"] == discovery["dataIdentity"], "DATA_IDENTITY_CHANGED", "Хранилища после запуска изменились.")
        self.config["dataIdentity"] = discovery["dataIdentity"]
        save_private(self.install.state / "setup.json", self.config)
        marker = self.install.state / "maintenance.json"
        if marker.exists():
            value = private_json(marker)
            require(value.get("format") == "asa-setup-switch-v1" and value.get("operationId") == journal["operationId"],
                    "MAINTENANCE_IDENTITY", "Маркер обслуживания принадлежит другой операции.")
            marker.unlink()

    def owner(self, journal, store):
        return onboard_owner(self.install, self.config, journal, store)


class Engine:
    def __init__(self, runtime, store):
        self.runtime, self.store = runtime, store

    def stage(self, journal, name, action, *, replay_safe=False):
        old = journal["stages"].get(name)
        if old and old["status"] == "done":
            return old.get("evidence")
        require(not old or replay_safe, "STAGE_AMBIGUOUS", "Стадия прервана до подтверждения результата: " + name,
                "Проверьте фактическое состояние; команда с побочным эффектом не повторяется автоматически.")
        self.store.event(journal, name, "intent")
        self.runtime.progress("Этап: " + name)
        evidence = action()
        self.store.event(journal, name, "done", evidence=evidence)
        return evidence

    def execute(self, journal, *, resume=False, acceptance_only=False):
        children = self.store.children(journal, active=True)
        require(not children, "DEPENDENT_PENDING", "Сначала завершите зависимое резервирование или доставку.",
                "Выполните resume --operation-id " + children[0]["operationId"] + "." if children else "")
        r, config = self.runtime, self.runtime.config
        if isinstance(r, Runtime):
            r.guard(journal)
            self.store.save(journal)
        r.operation_id = journal["operationId"]
        output = result(journal["operationId"], config["installationId"], journal["mode"],
                        site={"url": config["entryOrigin"], "status": "UNVERIFIED"})
        output["logPath"] = str(r.root / ".asa/setup-logs" / (journal["operationId"] + ".log"))
        old_result = journal.get("result", {})
        for field in ("dependencies", "version", "data", "backup", "site", "diagnostics"):
            if field in old_result:
                output[field] = copy.deepcopy(old_result[field])
        try:
            switched = "switch" in journal["stages"]
            observing_only = acceptance_only and not switched and (journal.get("noChange") is True or journal.get("result", {}).get("outcome") == "NO_CHANGE")
            if journal.get("state") == "RECOVERY_REQUIRED" and not switched:
                self.store.event(journal, "recovery", "intent")
                recovered = r.rescue(journal)
                self.store.event(journal, "recovery", "done", evidence=recovered)
                output.update(outcome="BLOCKED", exitCode=2, previousRuntime=recovered, reasonCode="RECOVERY_RESOLVED",
                              nextAction="Прежнее состояние восстановлено. Выполните auto для нового согласованного снимка и обновления.")
                return self.store.finish(journal, output)
            if switched or observing_only:
                # Neither migration nor compose up can be replayed after an
                # uncertain outcome. Exact runtime evidence is the only path.
                require(journal.get("release"), "RELEASE_MISSING", "Журнал переключения не содержит закреплённый выпуск.")
                if switched and journal["mode"] == "install" and journal["stages"].get("first_backup"):
                    # A returned ERROR can leave an owned hold even though
                    # the first-backup stage itself is durably "done".
                    self.store.event(journal, "recover_first_backup", "intent")
                    recovered = r.recover_acceptance_backup(journal)
                    self.store.event(journal, "recover_first_backup", "done", evidence=recovered)
                technical = r.technical(journal)
                output["site"].update(status="UNVERIFIED", technical=technical)
                require(technical["status"] == "passed", "SWITCH_UNVERIFIED", "После прерывания выбранный runtime не прошёл приёмку.",
                        "Проверьте миграцию, образы и логи. Нужен отдельный forward repair; автоматический rollback запрещён.")
                preflight = journal["stages"].get("preflight", {})
                if preflight.get("status") == "done" and isinstance(preflight.get("evidence"), dict):
                    output["dependencies"] = copy.deepcopy(preflight["evidence"])
                else:
                    # Older/crashed journals may have no final result. Recheck
                    # dependencies without replaying switch, migrations or export.
                    output["dependencies"] = self.stage(journal, "acceptance_preflight", r.preflight, replay_safe=True)
                if switched:
                    self.store.event(journal, "switch", "done", evidence={"verifiedAfterInterruption": True})
                    output.update(actionExecuted=True, executionCompleted=True)
                    r.commit_runtime(journal)
                else:
                    output.update(mode="acceptance", executionCompleted=True)
                    pointer = self.store.state / "setup-backups/last-local-success.json"
                    if pointer.exists():
                        saved = private_json(pointer)
                        output["backup"] = backup_workflow.verify_receipt(r.install, snapshot_id=saved["snapshotId"],
                            installation_id=config["installationId"])
                        output["backup"]["evidenceScope"] = "saved-snapshot-at-recorded-delivery-time"
                    else:
                        output["backup"] = {"status": "NOT_RUN", "policy": config["backup"]["policy"],
                                            "reasonCode": "BACKUP_EVIDENCE_MISSING"}
            else:
                require(not acceptance_only, "ACCEPTANCE_BEFORE_SWITCH", "Операция ещё не дошла до подтверждённого запуска.")
                fresh = journal["mode"] == "install"
                output["dependencies"] = self.stage(journal, "preflight", lambda: r.preflight(fresh=fresh), replay_safe=True)
                if not journal.get("release"):
                    self.store.event(journal, "release", "intent")
                    journal["release"] = validate_release(r.select())
                    self.store.event(journal, "release", "done", revision=journal["release"]["revision"])
                release = journal["release"]
                output["version"] = {"status": "SELECTED", "selected": release["revision"], "source": f"https://github.com/{REPOSITORY}",
                                     "publicationRunId": release["publicationRunId"]}
                if not fresh:
                    records = r.identity()
                    if not any(item["running"] for item in records.values()) or (journal.get("temporarilyStarted")
                            and any(not item["running"] for item in records.values())):
                        r.stopped_start(journal, self.store)
                    if not journal.get("previousRuntime"):
                        previous = r.current()
                        identity = setup_acceptance.storage_identity(records)
                        journal.update(previousRuntime=previous, storageIdentity=identity)
                        self.store.save(journal)
                    else:
                        require(journal.get("storageIdentity") == setup_acceptance.storage_identity(records),
                                "DATA_IDENTITY_CHANGED", "Хранилище изменилось после записи операции.")
                    output["version"]["previous"] = journal["previousRuntime"]["revision"]
                    if not resume and not journal.get("temporarilyStarted") and journal["previousRuntime"]["revision"] == release["revision"]:
                        technical = r.technical(journal)
                        output["site"].update(status="UNVERIFIED", technical=technical)
                        require(technical["status"] == "passed", "NO_CHANGE_UNVERIFIED", "Совпадение revision не подтверждено фактическими образами и схемой.")
                        r.stopped_restore(journal)
                        prior_path = self.store.state / "setup-last-successful.json"
                        prior = private_json(prior_path) if prior_path.exists() else {}
                        prior_browser = prior.get("site", {}).get("browser", {})
                        accepted_before = (prior.get("installationId") == config["installationId"]
                            and prior.get("configurationDigest") == configuration_digest(config)
                            and prior.get("version", {}).get("running") == release["revision"]
                            and prior.get("applicationAccepted") is True and prior_browser.get("status") == "passed"
                            and prior_browser.get("instanceId") == config["installationId"])
                        journal["noChange"] = True
                        output.update(outcome="NO_CHANGE", exitCode=0 if accepted_before else 2, actionExecuted=False,
                                      executionCompleted=True,
                                      nextAction="Можно работать. Пользовательская приёмка подтверждена ранее для этой конфигурации." if accepted_before else
                                      "Выполните acceptance --operation-id " + journal["operationId"] + "; пользовательская приёмка этой конфигурации ещё не подтверждена.")
                        if not accepted_before:
                            output["reasonCode"] = "ACCEPTANCE_PENDING"
                        output["version"].update(status="NO_CHANGE", running=release["revision"])
                        output["data"] = {"status": "PRESERVED", "identity": config.get("dataIdentity"), "source": "Сохранённые данные этой установки"}
                        output["site"].update(status="TECHNICAL_ONLY", technical=technical, browser={"status": "not_run", "reasonCode": "NO_CHANGE"})
                        if accepted_before:
                            output["site"]["browser"] = {"status": "historical_passed", "operationId": prior["operationId"], "acceptedAt": prior["observedAt"], "revision": release["revision"]}
                        output["backup"] = {"status": "NOT_RUN", "reasonCode": "NO_CHANGE", "restore": {"status": "UNVERIFIED"}}
                        output["diagnostics"] = r.diagnostics(journal)
                        return self.store.finish(journal, output)
                journal.setdefault("backupPolicy", copy.deepcopy(config["backup"]))
                self.store.save(journal)
                self.stage(journal, "source", lambda: r.source(release, fresh=fresh, previous=journal.get("previousRuntime")), replay_safe=True)
                r.verify_source(release)
                if isinstance(r, Runtime):
                    r.guard(journal)
                r.handoff(journal, self.store)
                if fresh:
                    self.stage(journal, "environment", r.environment, replay_safe=True)
                self.stage(journal, "settings", r.settings, replay_safe=True)
                self.stage(journal, "images", lambda: r.images(release), replay_safe=True)
                # Per-process environment must be reapplied even when a pull
                # stage was completed by an earlier executable.
                apply_release_environment(r.install, release)
                self.stage(journal, "space", lambda: r.estimate(fresh=fresh), replay_safe=True)
                self.stage(journal, "migration_plan", lambda: r.plan(release, fresh=fresh), replay_safe=True)
                self.stage(journal, "backup_preflight", r.backup_preflight, replay_safe=True)
                hold = None
                if not fresh:
                    receipt = self.stage(journal, "backup", lambda: r.backup(journal, hold=True), replay_safe=True)
                    output["backup"] = receipt
                    require(receipt["outcome"] in ("ACCEPTED", "WARNING"), "BACKUP_REQUIRED", "До переключения не подтверждена требуемая копия.",
                            "Проверьте backup receipt. Для доставки используйте retry-cloud с тем же snapshot ID; новая миграция не запускается.")
                    hold = r.consume_hold(journal)
                # Persist before replacing the backup hold. A crash anywhere
                # after this point is conservatively verification-only.
                self.store.event(journal, "switch", "intent")
                r.switch(journal, hold)
                self.store.event(journal, "switch", "done")
                output.update(actionExecuted=True, executionCompleted=True)
                technical = r.technical(journal)
                output["site"].update(status="UNVERIFIED", technical=technical)
                require(technical["status"] == "passed", "TECHNICAL_ACCEPTANCE", "Новая версия не прошла техническую приёмку.",
                        "Проверьте записанную операцию и выполните resume после исправления; откат схемы не выполняется.")
                r.commit_runtime(journal)
            output.update(actionExecuted=True)
            output["version"].update(status="RUNNING", selected=journal["release"]["revision"], running=journal["release"]["revision"])
            output["data"] = {"status": "PRESERVED" if journal["mode"] == "update" else "INITIALIZED", "identity": r.config.get("dataIdentity"),
                              "source": "Сохранённые данные этой установки" if journal["mode"] == "update" else "Новая пустая установка"}
            output["site"].update(technical=technical, status="TECHNICAL_OK")
            if journal["mode"] == "install":
                output["site"]["owner"] = r.owner(journal, self.store)
            # Browser interaction is an explicit acceptance phase. It never
            # runs on NO_CHANGE or a read-only status/check route.
            self.store.event(journal, "browser", "intent")
            output["site"]["browser"] = r.browser(journal)
            self.store.event(journal, "browser", "done", evidence=output["site"]["browser"])
            if journal["mode"] == "install":
                first_backup = journal["stages"].get("first_backup", {})
                backup_journal = self.store.backup_context(journal)
                if first_backup.get("status") == "done":
                    # Delivery may have been retried as an independent command.
                    # Refresh proof for the same snapshot, never create another
                    # export or accept a stale BLOCKED stage projection.
                    output["backup"] = r.backup_receipt(backup_journal, first_backup["evidence"]["snapshotId"])
                    if output["backup"].get("outcome") not in ("ACCEPTED", "WARNING"):
                        self.store.event(journal, "backup_continuation", "intent", snapshotId=output["backup"]["snapshotId"])
                        output["backup"] = r.resume_saved_backup(backup_journal, output["backup"]["snapshotId"])
                        self.store.event(journal, "backup_continuation", "done", evidence=output["backup"])
                    self.store.event(journal, "first_backup", "done", evidence=output["backup"],
                                     backupOperationId=backup_journal["operationId"])
                elif first_backup:
                    self.store.event(journal, "backup_continuation", "intent")
                    output["backup"] = r.resume_saved_backup(journal)
                    self.store.event(journal, "backup_continuation", "done", evidence=output["backup"])
                    self.store.event(journal, "first_backup", "done", evidence=output["backup"])
                else:
                    self.stage(journal, "first_backup_space", lambda: r.estimate(fresh=False), replay_safe=True)
                    snapshot = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
                    self.store.event(journal, "first_backup", "intent", snapshotId=snapshot)
                    output["backup"] = r.backup(journal, hold=False, snapshot_id=snapshot)
                    require(output["backup"].get("snapshotId") == snapshot, "BACKUP_IDENTITY", "Первая копия не совпадает с закреплённым snapshot ID.")
                    self.store.event(journal, "first_backup", "done", snapshotId=snapshot, evidence=output["backup"])
            elif output["backup"].get("status") == "UNVERIFIED" and journal["stages"].get("backup"):
                output["backup"] = journal["stages"]["backup"]["evidence"]
            output["backup"]["restore"] = {"status": "UNVERIFIED"}
            output["backup"]["schedule"] = backup_schedule.schedule_status(r.root, config["installationId"], config["backup"].get("schedule", {}))
            if journal["mode"] == "install" and config["backup"].get("schedule", {}).get("enabled"):
                output["postActions"] = [{"kind": "schedule"}]
            output["diagnostics"] = r.diagnostics(journal)
            output["configurationDigest"] = configuration_digest(r.config)
            output = finalize(output)
            if journal["mode"] == "install" and output["backup"].get("local", {}).get("error") in (
                    "BACKUP_RESUME_SNAPSHOT_MISSING", "BACKUP_INCOMPLETE"):
                output["nextAction"] = "Выполните backup --operation-id " + journal["operationId"] + "; новая зависимая копия сохранит прежний incomplete snapshot. Затем resume этой установки."
            return self.store.finish(journal, output)
        except KeyboardInterrupt:
            output.update(outcome="INTERRUPTED", exitCode=130, reasonCode="INTERRUPTED",
                          nextAction="Выполните resume с этим operation ID; после начатого переключения выполняется только проверка.")
        except (Blocked, OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
            output.update(outcome="BLOCKED" if isinstance(error, Blocked) else "ERROR", exitCode=2 if isinstance(error, Blocked) else 1,
                          reasonCode=_safe_status(error), nextAction=error.action if isinstance(error, Blocked) else
                          "Проверьте защищённый журнал операции и выполните status; приватные данные в вывод не включаются.")
            if isinstance(error, Blocked) and error.code == "BACKUP_RESUME_IDENTITY" and journal["mode"] == "install" and "switch" in journal["stages"]:
                output["nextAction"] = "Выполните backup --operation-id " + journal["operationId"] + "; проверка незапущенного исходного backup разрешит отдельную дочернюю копию."
            if isinstance(error, Blocked) and error.code in ("DEPENDENCIES", "CLOUD_TRANSPORT_IDENTITY", "CLOUD_CONFIGURATION", "CLOUD_PREPARATION") and "switch" not in journal["stages"]:
                output.update(outcome="PREPARATION_REQUIRED", preparation={"packages": True,
                    "cloud": bool(config["backup"].get("cloud", {}).get("enabled")), "browser": bool(config.get("browser"))},
                    nextAction="Root supervisor подготовит выбранные зависимости и продолжит тот же operation ID.")
        if "switch" not in journal["stages"]:
            try:
                output["previousRuntime"] = r.rescue(journal)
            except (Blocked, OSError, ValueError, subprocess.SubprocessError) as recovery:
                output.update(outcome="ERROR", exitCode=1, recovery={"status": "FAILED", "reasonCode": _safe_status(recovery)})
        else:
            output["automaticRollback"] = False
        return self.store.finish(journal, output)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        raise Blocked("OWNER_HTTP_REDIRECT", "Сайт изменил адрес приватного запроса owner.", "Проверьте единственный утверждённый HTTPS origin.")


def _owner_request(opener, origin, path, payload=None):
    request = urllib.request.Request(origin + path, data=json.dumps(payload).encode() if payload is not None else None,
                headers={"User-Agent": "ASA-Setup/1", "Content-Type": "application/json", "Origin": origin})
    try:
        with opener.open(request, timeout=30) as response:
            require(response.length is None or response.length < 65536, "OWNER_RESPONSE", "Слишком большой ответ регистрации.")
            return json.loads(response.read(65536))
    except (urllib.error.HTTPError, urllib.error.URLError, ValueError) as error:
        raise Blocked("OWNER_HTTP", "Штатная регистрация или вход owner не завершились.",
                      "Проверьте приватный onboarding.json и доступ к сайту; пароль не сбрасывается автоматически.") from error


def _bot_proof(opener, origin, action):
    payload = _owner_request(opener, origin, "/api/auth/bot-challenge?action=" + action)
    challenge = payload.get("challenge", {})
    require(challenge.get("action") == action and type(challenge.get("difficulty")) is int
            and 0 <= challenge["difficulty"] <= 20 and isinstance(challenge.get("salt"), str),
            "OWNER_BOT_CHALLENGE", "Не подтверждён штатный bot challenge.")
    threshold = 1 << (256 - challenge["difficulty"])
    for counter in range(2_000_001):
        digest = hashlib.sha256((challenge["salt"] + ":" + str(counter)).encode()).digest()
        if int.from_bytes(digest, "big") < threshold:
            return {**challenge, "counter": counter}
    raise Blocked("OWNER_BOT_CHALLENGE", "Стандартный challenge не решён в пределах бюджета.", "Повторите owner onboarding после проверки сайта.")


def _owner_admin(install, value, mode):
    records = install.identity()
    require(records.get("api", {}).get("running"), "OWNER_API", "API для управления owner не запущен.")
    source = (Path(__file__).resolve().parents[1] / "platform-admin.mjs").read_text(encoding="utf-8")
    source = source.removeprefix("#!/usr/bin/env node\n") + f'\nawait ownerAdminMain(["--stdin", "--{mode}"]);\n'
    payload = {"databaseUrl": install.env["MIGRATION_DATABASE_URL"], "email": value["email"],
               "accountId": value.get("accountId"), "expectedDatabase": install.env["POSTGRES_DB"],
               "reason": "Initial owner onboarding for " + value["installationId"], "operator": str(os.geteuid())}
    process = subprocess.run(["docker", "exec", "-i", "-w", "/app", records["api"]["id"], "node", "--input-type=module", "--eval", source],
            input=json.dumps(payload), capture_output=True, encoding="utf-8", timeout=90, check=False)
    require(process.returncode == 0, "OWNER_ADMIN", "Штатная проверка owner не завершилась.", "Проверьте owner-admin --plan; существующие учётные записи не заменяются.")
    answer = json.loads(process.stdout)
    require(answer.get("email", "").lower() == value["email"].lower(), "OWNER_ADMIN_IDENTITY", "Owner-admin вернул другую учётную запись.")
    if value.get("accountId"):
        require(answer.get("accountId") == value["accountId"], "OWNER_ADMIN_IDENTITY", "UUID owner отличается от подтверждённого.")
    return answer


def onboard_owner(install, config, journal, store):
    require(journal["mode"] == "install", "OWNER_FRESH_ONLY", "Первичный grant разрешён только в новой установке.")
    path = Path(config.get("onboardingFile", install.state / "onboarding.json"))
    value = private_json(path)
    require(value.get("format") == "asa-owner-onboarding-v1" and value.get("installationId") == config["installationId"],
            "OWNER_IDENTITY", "Приватная настройка owner не относится к этой установке.")
    if value.get("status") == "READY":
        _owner_admin(install, value, "verify")
        return {"status": "READY"}
    origin = config["entryOrigin"]
    opener = urllib.request.build_opener(_NoRedirect, urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    if not value.get("accountId"):
        require(isinstance(value.get("password"), str) and len(value["password"]) >= 10, "OWNER_PASSWORD", "В private onboarding отсутствует пароль нового owner.")
        if value.get("status") == "REGISTER_INTENT":
            require(value.get("initiallyEmpty") is True, "OWNER_REGISTRATION_AMBIGUOUS", "Нет доказательства новой базы перед регистрацией.")
            session = _owner_request(opener, origin, "/api/auth/login", {"email": value["email"], "password": value["password"],
                "botProof": _bot_proof(opener, origin, "login")})
        else:
            count = db_command(install, 'psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) FROM public.accounts"', capture=True, timeout=30)
            require(count == "0", "OWNER_EXISTING_ACCOUNTS", "Новая база уже содержит аккаунты; автоматический initial grant запрещён.",
                    "Зарегистрируйте/подтвердите owner через отдельный штатный owner-admin plan→grant.")
            value.update(status="REGISTER_INTENT", initiallyEmpty=True, operationId=journal["operationId"])
            save_private(path, value)
            store.event(journal, "owner_registration", "intent")
            payload = {key: value[key] for key in ("email", "password", "username", "displayName", "birthDate", "country")}
            payload["botProof"] = _bot_proof(opener, origin, "register")
            session = _owner_request(opener, origin, "/api/auth/register", payload)
        account = session.get("account", {})
        require(session.get("authenticated") is True and account.get("email", "").lower() == value["email"].lower()
                and re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", account.get("id", "")),
                "OWNER_REGISTRATION_IDENTITY", "Штатная регистрация не подтвердила точный новый аккаунт.")
        value.update(accountId=account["id"], status="REGISTERED")
        save_private(path, value)
        store.event(journal, "owner_registration", "done")
    plan = _owner_admin(install, value, "plan")
    require(plan["accountId"] == value["accountId"], "OWNER_PLAN", "UUID плана grant изменился.")
    value["status"] = "GRANT_INTENT"
    save_private(path, value)
    store.event(journal, "owner_grant", "intent")
    _owner_admin(install, value, "grant")
    verified = _owner_admin(install, value, "verify")
    require(verified.get("platformAdmin") is True, "OWNER_ACCESS", "Доступ владельца не подтверждён.")
    value["status"] = "READY"
    save_private(path, value)
    store.event(journal, "owner_grant", "done")
    return {"status": "READY"}
