#!/usr/bin/env python3
"""Bounded real Ubuntu/1Panel VM acceptance; never a live-host deployment tool.

The host orchestrator requires a standard GitHub-hosted Ubuntu runner. Guest
actions require a root-owned cloud-init marker and QEMU/KVM virtualization.
Only evidence.json is public. Disks, SSH keys, CI token, installer output,
onboarding, browser fixtures and private CLI logs are never artifacts.
"""

import argparse
import base64
import datetime as dt
import hashlib
import hmac
import importlib.util
import io
import ipaddress
import json
import math
import os
from pathlib import Path
import platform
import re
import secrets
import selectors
import shlex
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import uuid


GIB = 1024**3
MIN_FREE = 24 * GIB
RESERVE = 3 * GIB
GUEST_MEMORY_MIB = 10240
GUEST_CPUS = 3
BOOTSTRAP_TCG_SECONDS = 1200
TOTAL_SECONDS = 175 * 60
FAULT_FILE_LIMIT = 8 * 1024**2
FAULT_OBJECT_BYTES = 64 * 1024**2
FAULT_WINDOW_SECONDS = 180
FAULT_QUIESCENCE_SECONDS = 600
FAULT_RECOVERY_SECONDS = 650  # Product recovery: start 90 + ready 300 + writers 90, plus preflight.
FAULT_PHASE_SECONDS = 1800
FAULT_TOTAL_SECONDS = 75 * 60
CLOUD_FAULT_SECONDS = 40 * 60
CLOUD_CLEANUP_SECONDS = 180
CLOUD_SYNC_SECONDS = 720
CLOUD_BACKUP_SECONDS = 1200
CLOUD_ROOT = Path("/srv/asa-cloud-storage")
CLOUD_PROJECT = "asa-cloud-storage"
CLOUD_CONTAINER = CLOUD_PROJECT + "-rclone-1"
CLOUD_IMAGE = "rclone/rclone@sha256:2687085f718d3c628f7fdfb77c52a1d344332aed543110bb88088f2c70d43eb5"
# The pinned linux/amd64 OCI config identifies rclone v1.75.2, source be8d6044.
CLOUD_IMAGE_ID = "sha256:7ab08c1ee84502fb76ec95b3dc759aa46a9074cce2967d540e0ab50d8c844af4"
CLOUD_IMAGE_MANIFEST_ID = "sha256:5a25abdcf2f2f093a03e1e6a13caddeb5fae3cd07ae6c699768e6f1917a5d3ce"
CLOUD_IMAGE_MANIFEST_BYTES = 1920
CLOUD_SOURCE_SHA256 = "c6e30c3d1fa8aaa57e14c89b22c5677af5f5c5e132881925f2197949d7797d08"
CLOUD_INSPECT = ('{"id":{{json .Id}},"name":{{json .Name}},"created":{{json .Created}},'
    '"image":{{json .Config.Image}},"imageId":{{json .Image}},"user":{{json .Config.User}},'
    '"imageManifest":{{json (index . "ImageManifestDescriptor")}},'
    '"labels":{{json .Config.Labels}},"mounts":{{json .Mounts}},"ports":{{json .HostConfig.PortBindings}},'
    '"readonly":{{json .HostConfig.ReadonlyRootfs}},"state":{{json .State.Status}},'
    '"privileged":{{json .HostConfig.Privileged}},"capAdd":{{json .HostConfig.CapAdd}},"capDrop":{{json .HostConfig.CapDrop}},'
    '"running":{{json .State.Running}},"paused":{{json .State.Paused}},"restarting":{{json .State.Restarting}},'
    '"oomKilled":{{json .State.OOMKilled}},"pid":{{json .State.Pid}},"started":{{json .State.StartedAt}},'
    '"restarts":{{json .RestartCount}},"execIds":{{json .ExecIDs}},"networks":{{json .NetworkSettings.Networks}}}')
CLOUD_NETWORK_INSPECT = ('{"id":{{json .Id}},"name":{{json .Name}},"created":{{json .Created}},'
    '"driver":{{json .Driver}},"scope":{{json .Scope}},"labels":{{json .Labels}},'
    '"containers":{{json .Containers}}}')
CLOUD_EVENTS = ('{"type":{{json .Type}},"action":{{json .Action}},"id":{{json .Actor.ID}},'
    '"execId":{{json (index .Actor.Attributes "execID")}},'
    '"exitCode":{{json (index .Actor.Attributes "exitCode")}},"timeNs":{{json .TimeNano}}}')
REPOSITORY = "spikeal8-maker/asa-lab"
GUEST_HOME = Path("/opt/asa-realhost")
GUEST_PRIVATE = Path("/var/lib/asa-realhost")
INSTALL_ROOT = Path("/srv/asa-lab")
ORIGIN = "http://127.0.0.1:4610"
TABLES = ("accounts", "classrooms", "classroom_student_seats", "courses", "projects")
STATES = {"PASS", "FAIL", "BLOCKED", "NOT_RUN", "PENDING", "OK", "WARNING", "UNAVAILABLE",
          "UNVERIFIED", "ACCEPTED", "NO_CHANGE", "FAILED", "NOT_CONFIGURED", "BLOCKED_PLAN", "PLANNED", "RECORDED", "CONFIGURED", "READY", "INTERRUPTED"}
CODE = re.compile(r"[A-Z][A-Z0-9_]{0,79}\Z")
HEX40 = re.compile(r"[a-f0-9]{40}\Z")
HEX64 = re.compile(r"[a-f0-9]{64}\Z")
UUID = re.compile(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\Z")
DIAGNOSTIC_LIMIT = 64 * 1024
DIAGNOSTIC_STATES = {"FRESH", "UNKNOWN", "PARTIAL", "AMBIGUOUS", "INTERRUPTED", "LEGACY", "STOPPED", "MANAGED"}
DIAGNOSTIC_ERRORS = {"FileNotFoundError", "PermissionError", "ValueError", "TypeError", "KeyError", "ImportError",
                     "ModuleNotFoundError", "JSONDecodeError", "OSError", "TimeoutExpired", "UnicodeDecodeError",
                     "SetupBlocked", "Blocked", "Failure", "KeyboardInterrupt", "OtherError"}
DIAGNOSTIC_REASONS = {"OPERATION_INTENT", "DOCKER_UNKNOWN", "BLOCKED_OWNER", "CONFIG_MISSING", "CONFIG_PERMISSIONS",
    "CONFIG_READ", "CONFIG_SCHEMA", "OWNER_MISMATCH", "OWNER_PRIVATE", "OWNER_WRITABLE", "OPERATOR_REQUIRED",
    "UNATTRIBUTED_ASA", "TARGET_REQUIRED", "PROJECT_DRIFT", "ROOT_DRIFT", "KNOWN_INSTALLATION", "ORPHANED_INSTALLATION",
    "EXISTING_ASA_RESOURCES", "EMPTY_TARGET", "ENV_MISSING", "SHARED_DATA_VOLUME", "DATA_IDENTITY_CHANGED",
    "BIND_BACKEND_UNSUPPORTED", "KNOWN_OPERATION", "UNKNOWN_INTERRUPTION", "ADOPTION_REQUIRED", "EXISTING_STOPPED",
    "CONSISTENT_INSTALLATION", "IDENTITY_UNVERIFIED", "DIAGNOSTIC_TIMEOUT", "DIAGNOSTIC_OUTPUT_LIMIT",
    "DIAGNOSTIC_TRUST", "DIAGNOSTIC_OWNER", "DIAGNOSTIC_JSON", "DIAGNOSTIC_UID", "DIAGNOSTIC_PLATFORM",
    "DIAGNOSTIC_PROCESS_OWNERSHIP", "DIAGNOSTIC_PROCESS_CLEANUP", "UNRECOGNIZED_REASON"}
DIAGNOSTIC_PATHS = {"opt": "/opt", "bundleParent": "/opt/asa-setup", "bundle": ".", "tools": "tools",
    "setup": "tools/asa_setup.py", "launcher": "tools/asa_setup_launcher.py", "deployment": "tools/deployment",
    "package": "tools/deployment/__init__.py", "discovery": "tools/deployment/setup_discovery.py",
    "configuration": "tools/deployment/setup_config.py", "contracts": "tools/deployment/contracts.py"}
COMMAND_DIAGNOSTIC_MODES = {"install": "install", "update apply": "update", "backup create": "backup", "cloud sync": "retry-cloud"}
COMMAND_DIAGNOSTIC_STAGES = ("created", "bootstrap", "configured", "preflight", "acceptance_preflight", "release", "source",
    "handoff", "environment", "settings", "images", "space", "migration_plan", "backup_preflight", "backup", "switch",
    "owner_registration", "owner_grant", "browser", "first_backup_space", "first_backup", "backup_continuation",
    "backup_recovery", "recover_first_backup", "recovery", "start_existing", "cloud_delivery", "parent_receipt", "retention")
COMMAND_DIAGNOSTIC_REASONS = DIAGNOSTIC_REASONS | {"COMMAND", "COMMAND_TIMEOUT", "TOOL", "HOST_COMMAND", "BOOTSTRAP_ERROR",
    "OWNER_INPUT_REQUIRED", "REGISTRY", "NETWORK", "RELEASE_UNAVAILABLE", "RELEASE", "RELEASE_DIGEST_MISMATCH", "CI_UNAVAILABLE",
    "CI_BLOCKED", "SOURCE_REVISION", "ORIGIN", "DIRTY", "DEPENDENCIES", "CLOUD_UNAVAILABLE", "CLOUD_NOT_CONFIGURED",
    "CLOUD_TRANSFER_FAILED", "CLOUD_PREPARATION", "BACKUP_REQUIRED", "BACKUP_RESUME_SNAPSHOT_MISSING", "BACKUP_INCOMPLETE",
    "LOCKED", "OPERATION_PENDING", "HEALTH", "TECHNICAL_ACCEPTANCE", "BROWSER_ACCEPTANCE", "INTERRUPTED", "CLI_UNAVAILABLE",
    # Literal producers reached by commit_runtime/onboard_owner after technical
    # acceptance. A preserved receipt code does not identify an observed stack frame.
    "DATA_IDENTITY", "MAINTENANCE_IDENTITY", "OWNER_FRESH_ONLY", "OWNER_IDENTITY", "OWNER_PASSWORD", "OWNER_EXISTING_ACCOUNTS",
    "OWNER_HTTP_REDIRECT", "OWNER_RESPONSE", "OWNER_HTTP", "OWNER_BOT_CHALLENGE", "OWNER_API", "OWNER_ADMIN",
    "OWNER_ADMIN_IDENTITY", "OWNER_REGISTRATION_AMBIGUOUS", "OWNER_REGISTRATION_IDENTITY", "OWNER_PLAN", "OWNER_ACCESS",
    # setup_config private/installed/legacy state, and settings -> backup_directory.
    "PRIVATE_FILE", "PRIVATE_PERMISSIONS", "PRIVATE_FORMAT", "PRIVATE_DIRECTORY", "RELEASE_FILE", "RELEASE_PERMISSIONS",
    "LEGACY_STATE_PATH", "LEGACY_STATE_FORMAT", "LEGACY_STATE_FILE", "LEGACY_STATE_PERMISSIONS",
    "BACKUP_PATH", "BACKUP_DIRECTORY", "BACKUP_PERMISSIONS",
    # settings -> reload -> Installation: private environment/origin policy.
    "ENV", "PROXY_POLICY", "RESOURCE_CONFIG", "PROFILE", "PROJECT", "PUBLIC_ORIGINS_SNAPSHOT", "PUBLIC_ORIGINS_POLICY",
    "PUBLIC_ORIGINS_PERMISSIONS", "PUBLIC_ORIGINS_PATH", "PUBLIC_ORIGINS_CONTENT", "PUBLIC_ORIGINS_RECOVERY", "PUBLIC_ORIGINS_MISSING",
    # public_origins_recovery -> Store.pending and _owner_admin -> identity.
    "OPERATION_ID", "OPERATION_IDENTITY", "OPERATIONS_AMBIGUOUS", "DEPENDENT_IDENTITY", "DEPENDENT_BINDING",
    "DEPENDENT_PARENT_MISSING", "DEPENDENT_SOURCE", "DEPENDENT_PARENT_STATE", "DEPENDENTS_AMBIGUOUS",
    "IDENTITY_PROJECT", "IDENTITY_ENV", "IDENTITY_ROOT", "IDENTITY_FILES", "IDENTITY_DUPLICATE", "IDENTITY_MISSING",
    "IDENTITY_VOLUME", "DATABASE_ENGINE", "DATABASE_TARGET"}
COMMAND_DIAGNOSTIC_ERRORS = {"DIAGNOSTIC_PATH", "DIAGNOSTIC_PERMISSIONS", "DIAGNOSTIC_SIZE", "DIAGNOSTIC_CHANGED",
    "DIAGNOSTIC_BINDING", "DIAGNOSTIC_INVOCATION", "DIAGNOSTIC_LOG_BASELINE", "DIAGNOSTIC_JSON", "DIAGNOSTIC_TIMEOUT",
    "DIAGNOSTIC_INVENTORY", "DIAGNOSTIC_DOCKER_EXIT", "DIAGNOSTIC_OUTPUT_LIMIT", "DIAGNOSTIC_PLATFORM",
    "DIAGNOSTIC_PROCESS_OWNERSHIP", "DIAGNOSTIC_PROCESS_CLEANUP"}
COMMAND_DIAGNOSTIC_OUTCOMES = {"ACCEPTED", "WARNING", "BLOCKED", "ERROR", "INTERRUPTED", "PREPARATION_REQUIRED", "NO_CHANGE"}
# Closed producer vocabulary, not a pattern accepting arbitrary private strings.
# setup_result._report_rows/finalize; setup_acceptance.browser_acceptance and the
# pinned Ops browser's stage/_error_code; backup_workflow.run_backup/CloudTransport.
RECEIPT_ROWS = ("dependencies", "version", "data", "backup", "site", "diagnostics")
RECEIPT_ROW_STATUSES = {"UNVERIFIED", "OK", "ACCEPTED", "PRESERVED", "INITIALIZED", "RUNNING", "passed",
    "NO_CHANGE", "CHECKED", "OBSERVED", "READY", "NOT_REQUIRED", "FAILED", "INCOMPLETE", "WARNING", "warning",
    "NOT_RUN", "TECHNICAL_ONLY", "TECHNICAL_OK"}
RECEIPT_BROWSER_CHECKS = ("teacher_login", "student_login", "course_open", "existing_project_open",
    "scratch_save_reopen", "electronics_save_reopen")
RECEIPT_BROWSER_REASONS = {"BROWSER_USER_FLOW_FAILED", "BROWSER_RUNTIME_UNAVAILABLE", "BROWSER_ENVIRONMENT_FAILED",
    "BROWSER_TIMEOUT", "BROWSER_NOT_CONFIGURED", "BROWSER_COMPONENT_MISSING", "ACCEPTANCE_FAILED",
    "BROWSER_CONFIGURATION", "BROWSER_COMPONENT_PIN", "BROWSER_TIMEOUT_CONFIGURATION", "BROWSER_COMPONENT_PATH",
    "BROWSER_COMPONENT_FILE", "BROWSER_COMPONENT_OWNER", "BROWSER_COMPONENT_HASH", "BROWSER_PYTHON_PATH",
    "BROWSER_PYTHON_OWNER", "BROWSER_FIXTURE_PATH", "BROWSER_FIXTURE_PERMISSIONS", "BROWSER_CACHE_PATH",
    "BROWSER_CACHE_OWNER", "BROWSER_PLATFORM", "BROWSER_REPORT_SIZE", "BROWSER_REPORT_BINDING", "BROWSER_REPORT_EXIT",
    "BROWSER_REPORT_CHECKS"}
RECEIPT_BROWSER_STAGES = {"browser_launch", "release_provenance", "teacher_registration_or_login",
    "teacher_login_identity", "teacher_login_submit", "test_classroom", "student_login", "course_open",
    "blocks_project", "blocks_save", "electronics_project", "electronics_save"}
RECEIPT_BROWSER_ERRORS = {"SAVE_NOT_OBSERVED", "REOPEN_VALUE_MISMATCH", "REOPEN_DRAFT_MISMATCH", "RuntimeError",
    "SYNTHETIC_LOGIN_IDENTITY_MISMATCH"}
RECEIPT_BACKUP_ERRORS = {"AGE_ENVELOPE", "AGE_RECIPIENT", "AGE_NOT_CONFIGURED", "BACKUP", "BACKUP_ACTIVE_JOB",
    "BACKUP_BOOT_ID", "BACKUP_CIPHERTEXT_DRIFT", "BACKUP_CIPHERTEXT_MISSING", "BACKUP_CIPHERTEXT_UNKNOWN",
    "BACKUP_CLOUD_PROOF", "BACKUP_COMMAND_FAILED", "BACKUP_COMMAND_TIMEOUT", "BACKUP_CONFIGURATION", "BACKUP_DATA_IDENTITY",
    "BACKUP_ENCRYPTION_INCOMPLETE", "BACKUP_EXTERNAL_WRITERS", "BACKUP_FILE_CHANGED", "BACKUP_FILE_TYPE",
    "BACKUP_FREEZE_INTERRUPTED", "BACKUP_FREEZE_TIMEOUT", "BACKUP_HOLD_IDENTITY", "BACKUP_HOLD_MISSING", "BACKUP_IDENTITY",
    "BACKUP_INCOMPLETE", "BACKUP_LOCAL_DELETED", "BACKUP_MANIFEST_DRIFT", "BACKUP_MOUNTS", "BACKUP_PATH", "BACKUP_POLICY",
    "BACKUP_POLICY_CHANGED", "BACKUP_PRIVATE_DIRECTORY", "BACKUP_RECEIPT_IDENTITY", "BACKUP_RECIPIENT_IDENTITY",
    "BACKUP_RESUME_HEALTH", "BACKUP_RESUME_IDENTITY", "BACKUP_RESUME_MODE", "BACKUP_RESUME_SNAPSHOT_MISSING",
    "BACKUP_RESUME_TIMEOUT", "BACKUP_RESUME_WRITERS", "BACKUP_SERVICES", "BACKUP_SHARED_VOLUME", "BACKUP_SNAPSHOT_EXISTS",
    "BACKUP_SNAPSHOT_IDENTITY", "BACKUP_STORAGE", "BACKUP_TOOL", "BACKUP_UNKNOWN_WRITER", "BACKUP_WRITERS_RESUMED",
    "BACKUP_WRITER_IDENTITY", "BACKUP_WRITER_RACE", "MAINTENANCE", "CLOUD_CONFIGURATION", "CLOUD_NAMESPACE",
    "CLOUD_NOT_CONFIGURED", "CLOUD_READBACK_HASH", "CLOUD_REMOTE_LIST", "CLOUD_SPOOL_HASH", "CLOUD_SPOOL_IDENTITY",
    "CLOUD_TRANSPORT_IDENTITY", "CLOUD_TRANSPORT_PIN", "CLOUD_UNAVAILABLE", "CLOUD_TIMEOUT", "CLOUD_TRANSPORT_ERROR",
    "CLOUD_PROVIDER_GONE", "CLOUD_AUTHORIZATION", "CLOUD_TRANSFER_FAILED", "CLOUD_NOT_CONNECTED",
    "OSError", "ValueError", "FileNotFoundError", "PermissionError", "FileExistsError", "IsADirectoryError",
    "NotADirectoryError", "CalledProcessError", "TimeoutExpired"}
# Ubuntu 24.04 ships /var/log root:syslog 0775; using it as an ancestor would
# violate diagnostic_open's intentionally strict no-group-write trust contract.
OPERATOR_LOG_ROOT = Path("/var/lib/asa-lab-operator")
CLI_READ_SECONDS = 900
CLI_CONTROL_SECONDS = 60
CLI_IMAGES = ("api", "web", "scratch", "minio", "search")
CLI_HELPERS = ("realhost_cli_checks.py", "realhost_cli_runtime.py", "setup_bundle.py")
PUBLISHED_SECONDS = 900
PUBLISHED_HOME = Path("/opt/asa-realhost-published")
PUBLISHED_WORKFLOW = REPOSITORY + "/.github/workflows/setup-release.yml"
PUBLISHED_REF = "refs/heads/main"
GH_PIN = {"version": "2.101.0", "sourceRevision": "0cf1092493af067646fc5f3db9421c6a6ec9c938",
          "url": "https://github.com/cli/cli/releases/download/v2.101.0/gh_2.101.0_linux_amd64.tar.gz",
          "bytes": 15282175, "sha256": "9bca2d1c16825f109907a23307628a2f0698fbf99662b73a5cf0b020293072b8",
          "executableBytes": 41971872,
          "executableSha256": "ea857a3f0f7d4276cf5848b236542c5048e2eaa7bdd1b6ddec238f8793e74bff"}
CLI_RELEASE_PROGRAM = """import json, sys
sys.path.insert(0, sys.argv[1])
from deployment.release_readonly import resolve_release
pins = json.loads(sys.stdin.buffer.read(65536))
selected = {name: resolve_release(pins[name]["deploymentDigest"]) for name in ("previous", "current")}
selected["stable"] = resolve_release()
print(json.dumps(selected))
"""
SWITCH_SERVICES = ("postgres", "minio", "migration", "minio-init", "api", "search", "web", "scratch")
SWITCH_STATES = {"created", "running", "paused", "restarting", "removing", "exited", "dead"}
SWITCH_SQLSTATES = {"08001", "08006", "23502", "23503", "23505", "28000", "28P01", "3D000", "3F000",
    "42501", "42601", "42703", "42704", "42P01", "53100", "53200", "53300", "53400", "55P03", "57014", "XX000"}
SWITCH_API_PHASE_RULES = {"startup_failed": "API_STARTUP_FAILED", "nest_error": "API_NEST_ERROR"}
SWITCH_API_ERROR_CODES = {"database_query_timeout", "database_connection_timeout", "upstream_connection_failed", "internal_error"}
SWITCH_API_ERROR_CLASSES = {"Error", "ClassroomCodeSecretConfigError", "StudentCodeProtectionConfigError"}
SWITCH_SECONDS = 60
SWITCH_READ_STEPS = {"daemonBefore": "info", "beforeList": "ps", "beforeInspect": "inspect", "beforeRecheck": "ps",
    "containerLogs": "logs", "afterList": "ps", "afterInspect": "inspect", "afterRecheck": "ps", "daemonAfter": "info"}
SWITCH_READ_CATEGORIES = {"BUDGET_EXHAUSTED", "TIMEOUT", "OUTPUT_LIMIT", "NONZERO_EXIT", "UID_MISMATCH",
    "PROBE_FAILURE", "INVALID_RESULT", "PROCESS_OWNERSHIP", "PROCESS_CLEANUP"}
SWITCH_INSPECT = ('{"id":{{json .Id}},"name":{{json .Name}},"created":{{json .Created}},"image":{{json .Config.Image}},'
    '"imageId":{{json .Image}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
    '"service":{{json (index .Config.Labels "com.docker.compose.service")}},'
    '"root":{{json (index .Config.Labels "com.docker.compose.project.working_dir")}},'
    '"files":{{json (index .Config.Labels "com.docker.compose.project.config_files")}},'
    '"oneoff":{{json (index .Config.Labels "com.docker.compose.oneoff")}},'
    '"state":{{json .State.Status}},"running":{{json .State.Running}},"dead":{{json .State.Dead}},'
    '"oomKilled":{{json .State.OOMKilled}},"exitCode":{{json .State.ExitCode}},"restarts":{{json .RestartCount}},'
    '"started":{{json .State.StartedAt}},"finished":{{json .State.FinishedAt}},"error":{{json .State.Error}},'
    '"health":{{if eq (index .State "Health") nil}}"none"{{else}}{{json (index .State "Health").Status}}{{end}}}')


class Failure(RuntimeError):
    def __init__(self, code, *, status="FAIL"):
        super().__init__(code)
        self.code, self.status = code, status


def require(value, code, *, status="FAIL"):
    if not value:
        raise Failure(code, status=status)


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def hash_file(path):
    with Path(path).open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def write_json(path, value, *, mode=0o600):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + ".partial-" + uuid.uuid4().hex)
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(descriptor, "w", encoding="utf-8") as target:
        json.dump(value, target, ensure_ascii=True, indent=2, sort_keys=True)
        target.write("\n")
        target.flush()
        os.fsync(target.fileno())
    os.replace(temporary, path)


def pin_manifest(path):
    value = json.loads(Path(path).read_text())
    require(value.get("format") == "asa-realhost-pins-v1", "PINS_FORMAT")
    require(value.get("githubCli") == GH_PIN, "PINS_GITHUB_CLI")
    ubuntu, panel = value["ubuntu"], value["onePanel"]
    require(ubuntu["version"] == "24.04" and ubuntu["architecture"] == "amd64", "PINS_PLATFORM")
    require(HEX64.fullmatch(ubuntu["sha256"]) and HEX64.fullmatch(panel["sha256"])
            and HEX64.fullmatch(panel["installerSha256"]), "PINS_HASH")
    require(ubuntu["url"].startswith("https://cloud-images.ubuntu.com/releases/noble/release-")
            and all(url.startswith(("https://resource.1panel.pro/", "https://resource.fit2cloud.com/1panel/"))
                    for url in panel["urls"]), "PINS_SOURCE")
    require(len(panel["urls"]) in (1, 2) and type(panel["bytes"]) is int and 0 < panel["bytes"] < GIB,
            "PINS_SIZE")
    for name in ("previous", "current"):
        item = value[name]
        require(HEX40.fullmatch(item["revision"]) and re.fullmatch(r"sha256:[a-f0-9]{64}", item["deploymentDigest"])
                and type(item["schema"]) is int and item["publicationRunId"] > 0, "PINS_RELEASE")
    require(value["previous"]["revision"] != value["current"]["revision"]
            and value["previous"]["deploymentDigest"] != value["current"]["deploymentDigest"], "PINS_NO_UPDATE")
    return value


def cli_release_expectations(selections, pins):
    """Immutable OCI/CI inputs prepared before the VM, never learned from CLI output."""
    require(type(selections) is dict and set(selections) == {"previous", "current"}, "CLI_READ_RELEASE_PIN")
    result = {}
    for name in ("previous", "current"):
        selected, pin = selections[name], pins[name]
        require(type(selected) is dict and selected.get("ci") == "VERIFIED"
                and selected.get("deploymentDigest") == pin["deploymentDigest"]
                and selected.get("manifestDigest") == pin["amd64ManifestDigest"], "CLI_READ_RELEASE_PIN")
        release = selected.get("release")
        require(type(release) is dict and release.get("format") == "asa-deployment-v2"
                and release.get("repository") == REPOSITORY and release.get("platform") == "linux/amd64"
                and release.get("revision") == pin["revision"] and type(release.get("schema")) is int
                and release["schema"] == pin["schema"] and type(release.get("publicationRunId")) is int
                and release["publicationRunId"] == pin["publicationRunId"], "CLI_READ_RELEASE_PIN")
        images = release.get("images")
        require(type(images) is dict and set(images) == set(CLI_IMAGES), "CLI_READ_RELEASE_PIN")
        for service in CLI_IMAGES:
            require(type(images[service]) is str and re.fullmatch(
                re.escape("ghcr.io/" + REPOSITORY + "/" + service + "@sha256:") + r"[a-f0-9]{64}", images[service]),
                "CLI_READ_RELEASE_PIN")
        result[name] = {"revision": pin["revision"], "schema": pin["schema"],
                        "images": {service: images[service] for service in CLI_IMAGES},
                        "deploymentDigest": pin["deploymentDigest"], "manifestDigest": pin["amd64ManifestDigest"]}
    return result


def cli_helper_hashes(source, revision, commands):
    require(type(revision) is str and HEX40.fullmatch(revision), "CLI_READ_SOURCE")
    hashes = {}
    for name in CLI_HELPERS:
        relative = "tools/deployment/" + name
        _, committed = commands.run(["git", "show", revision + ":" + relative], cwd=source, timeout=30)
        digest = hashlib.sha256(committed).hexdigest()
        require(hash_file(Path(source) / relative) == digest, "CLI_READ_SOURCE")
        hashes[name] = digest
    return hashes


def cli_default_target_binding(value, revision):
    """The default channel expectation is separate from controlled update pins."""
    require(type(value) is dict and set(value) == {"revision", "schema", "images", "deploymentDigest", "manifestDigest",
            "ci", "publicationRunId", "selector"} and value["revision"] == revision
            and type(revision) is str and HEX40.fullmatch(revision)
            and value["ci"] == "VERIFIED" and value["selector"] == "stable-before-vm"
            and type(value["schema"]) is int and 0 <= value["schema"] <= 2**31 - 1
            and type(value["publicationRunId"]) is int and 0 < value["publicationRunId"] <= 2**63 - 1,
            "CLI_READ_DEFAULT_TARGET")
    require(all(type(value[key]) is str and re.fullmatch(r"sha256:[a-f0-9]{64}", value[key])
                for key in ("deploymentDigest", "manifestDigest")), "CLI_READ_DEFAULT_TARGET")
    require(type(value["images"]) is dict and set(value["images"]) == set(CLI_IMAGES)
            and all(type(value["images"][service]) is str and re.fullmatch(
                re.escape("ghcr.io/" + REPOSITORY + "/" + service + "@sha256:") + r"[a-f0-9]{64}", value["images"][service])
                for service in CLI_IMAGES), "CLI_READ_DEFAULT_TARGET")
    return value


def cli_default_target_expectation(selected, revision):
    """Freeze verified stable; published acquisition also pins its approved revision."""
    require(type(selected) is dict and selected.get("ci") == "VERIFIED", "CLI_READ_DEFAULT_TARGET")
    release = selected.get("release")
    require(type(release) is dict and release.get("format") == "asa-deployment-v2"
            and release.get("repository") == REPOSITORY and release.get("platform") == "linux/amd64", "CLI_READ_DEFAULT_TARGET")
    return cli_default_target_binding({key: release.get(key) for key in ("revision", "schema", "images", "publicationRunId")} | {
        "ci": selected["ci"], "deploymentDigest": selected.get("deploymentDigest"), "manifestDigest": selected.get("manifestDigest"),
        "selector": "stable-before-vm"}, release.get("revision") if revision is None else revision)


def host_environment(environment, revision, actual_revision, *, free, memory, cpus, os_release):
    require(environment.get("GITHUB_ACTIONS") == "true" and environment.get("RUNNER_ENVIRONMENT") == "github-hosted"
            and environment.get("RUNNER_OS") == "Linux" and environment.get("GITHUB_REPOSITORY") == REPOSITORY,
            "BLOCKED_DISPOSABLE_RUNNER_REQUIRED", status="BLOCKED")
    require(HEX40.fullmatch(revision) and revision == actual_revision, "SOURCE_REVISION")
    require(os_release.get("ID") == "ubuntu" and os_release.get("VERSION_ID") == "24.04"
            and platform.machine() == "x86_64", "BLOCKED_RUNNER_PLATFORM", status="BLOCKED")
    require(free >= MIN_FREE, "BLOCKED_HOST_FREE_DISK", status="BLOCKED")
    require(memory >= 13 * GIB and cpus >= GUEST_CPUS + 1, "BLOCKED_HOST_RAM_CPU", status="BLOCKED")


def acquisition_request(mode, approved, revision, actual_revision, environment):
    """The SHA input is an assertion about main, never a checkout instruction."""
    require(mode in ("candidate", "published") and type(approved) is str
            and type(revision) is str and HEX40.fullmatch(revision)
            and revision == actual_revision, "ACQUISITION_MODE_BINDING")
    if mode == "candidate":
        require(approved == "", "ACQUISITION_MODE_BINDING")
    else:
        require(HEX40.fullmatch(approved) and approved == revision
                and environment.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
                and environment.get("GITHUB_REF") == PUBLISHED_REF
                and environment.get("GITHUB_SHA") == environment.get("SOURCE_REVISION") == revision
                and environment.get("GITHUB_REPOSITORY") == REPOSITORY
                and environment.get("GITHUB_WORKFLOW_REF") == REPOSITORY + "/.github/workflows/setup-realhost.yml@" + PUBLISHED_REF,
                "ACQUISITION_MODE_BINDING")
    return {"mode": mode, "approvedRevision": approved, "sourceRevision": revision}


def initial_evidence(revision, mode="candidate"):
    return {"format": "asa-realhost-evidence-v1", "status": "NOT_RUN", "sourceRevision": revision,
            "startedAt": now(), "scope": "CLI in a disposable real Ubuntu 24.04 VM with actual 1Panel",
            "acquisitionMode": mode,
            "publishedSetupAcquisition": ({"status": "NOT_RUN", "reasonCode": "PUBLISHED_ACQUISITION_NOT_STARTED"}
                if mode == "published" else {"status": "BLOCKED", "reasonCode": "CANDIDATE_NOT_PUBLISHED_ATTESTED"}),
            "publicHTTPS": "NOT_RUN", "realYandexFromGuest": "NOT_RUN", "productionRestore": "NOT_RUN",
            "phases": [], "checks": {}, "cleanup": "NOT_RUN"}


class Commands:
    def __init__(self, *, guard=None):
        self.guard = guard or (lambda: None)

    def run(self, args, *, timeout=60, cwd=None, environment=None, source=None, allowed=(0,), own_group=True):
        require(type(own_group) is bool, "COMMAND_PROCESS_GROUP")
        # Temporary raw output remains private and is never forwarded to CI.
        with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
            started_ns = time.time_ns()
            process = subprocess.Popen([str(arg) for arg in args], cwd=cwd, env=environment,
                                       stdin=subprocess.PIPE if source is not None else subprocess.DEVNULL,
                                       stdout=stdout, stderr=stderr, start_new_session=own_group)
            if source is not None:
                process.stdin.write(source)
                process.stdin.close()
            deadline = time.monotonic() + timeout
            try:
                while process.poll() is None:
                    self.guard()
                    require(time.monotonic() < deadline, "COMMAND_TIMEOUT", status="BLOCKED")
                    time.sleep(0.5)
                stdout.seek(0)
                data = stdout.read(2 * 1024**2 + 1)
                require(len(data) <= 2 * 1024**2, "COMMAND_OUTPUT_LIMIT")
                require(process.returncode in allowed, "COMMAND_EXIT")
                self.last_invocation = {"pid": process.pid, "startedNs": started_ns, "finishedNs": time.time_ns()}
                return process.returncode, data
            finally:
                if process.poll() is None:
                    (os.killpg if own_group else os.kill)(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        (os.killpg if own_group else os.kill)(process.pid, signal.SIGKILL)
                        process.wait(timeout=5)


def verify_boot_change(before, after):
    require(isinstance(before, str) and isinstance(after, str) and UUID.fullmatch(before)
            and UUID.fullmatch(after) and before != after, "GUEST_DID_NOT_REBOOT")


def verify_acceleration(proof, acceleration):
    require(isinstance(proof, dict) and type(proof.get("enabled")) is bool
            and proof["enabled"] == (acceleration == "kvm"), "QMP_KVM_PROOF")


def prepare_kvm_access(commands):
    device = Path("/dev/kvm")
    try:
        before = device.lstat()
    except FileNotFoundError:
        return {"devicePresent": False, "currentUidAccessGranted": False}
    require(stat.S_ISCHR(before.st_mode), "BLOCKED_KVM_DEVICE_IDENTITY", status="BLOCKED")
    granted = not os.access(device, os.R_OK | os.W_OK)
    if granted:
        # HostRun.preflight has already rejected every non-GitHub-hosted host.
        # Grant only this job UID access to the existing character device.
        commands.run(["sudo", "setfacl", "-m", "u:" + str(os.getuid()) + ":rw", device], timeout=20)
    after = device.lstat()
    require((before.st_dev, before.st_ino, before.st_rdev) == (after.st_dev, after.st_ino, after.st_rdev)
            and stat.S_ISCHR(after.st_mode) and os.access(device, os.R_OK | os.W_OK), "BLOCKED_KVM_ACCESS", status="BLOCKED")
    return {"devicePresent": True, "currentUidAccessGranted": granted, "currentUidReadWrite": True}


class VM:
    def __init__(self, directory, commands):
        self.directory, self.commands = Path(directory), commands
        self.process = None
        self.serial = None
        self.acceleration = None
        self.qmp_path = self.directory / "qmp.sock"
        self.ssh_args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "-o", "ServerAliveInterval=15",
                         "-o", "ServerAliveCountMax=3", "-o", "StrictHostKeyChecking=accept-new",
                         "-o", "UserKnownHostsFile=" + str(self.directory / "known_hosts"),
                         "-i", str(self.directory / "ssh_key")]

    def query(self, execute):
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            connection.settimeout(5)
            connection.connect(str(self.qmp_path))
            stream = connection.makefile("rwb")
            greeting = json.loads(stream.readline(65536))
            require("QMP" in greeting, "QMP_GREETING")
            for number, command in enumerate(("qmp_capabilities", execute)):
                stream.write(json.dumps({"execute": command, "id": number}).encode() + b"\n")
                stream.flush()
                for _ in range(32):
                    response = json.loads(stream.readline(65536))
                    if response.get("id") == number:
                        require("return" in response, "QMP_COMMAND")
                        break
                else:
                    raise Failure("QMP_RESPONSE")
            return response["return"]

    def start(self):
        require(self.process is None or self.process.poll() is not None, "QEMU_ALREADY_RUNNING")
        choices = [self.acceleration] if self.acceleration else (["kvm", "tcg"] if os.access("/dev/kvm", os.R_OK | os.W_OK) else ["tcg"])
        for acceleration in choices:
            if self.qmp_path.exists():
                self.qmp_path.unlink()
            if self.serial is not None:
                self.serial.close()
            self.serial = (self.directory / "qemu-private.log").open("ab")
            args = ["qemu-system-x86_64", "-machine", "q35", "-accel", acceleration,
                    "-cpu", "host" if acceleration == "kvm" else "max", "-smp", str(GUEST_CPUS),
                    "-m", str(GUEST_MEMORY_MIB), "-display", "none", "-monitor", "none",
                    "-serial", "file:" + str(self.directory / "serial-private.log"),
                    "-qmp", "unix:" + str(self.qmp_path) + ",server=on,wait=off",
                    "-drive", "file=" + str(self.directory / "guest.qcow2") + ",if=virtio,format=qcow2,discard=unmap",
                    "-drive", "file=" + str(self.directory / "seed.img") + ",if=virtio,format=raw,readonly=on",
                    "-netdev", "user,id=net0,ipv6=off,hostfwd=tcp:127.0.0.1:2222-:22",
                    "-device", "virtio-net-pci,netdev=net0", "-rtc", "base=utc,clock=host"]
            self.process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=self.serial, stderr=self.serial)
            deadline = time.monotonic() + 20
            proof = None
            while time.monotonic() < deadline and self.process.poll() is None:
                self.commands.guard()
                if self.qmp_path.exists():
                    try:
                        proof = self.query("query-kvm")
                        break
                    except (OSError, ValueError):
                        pass
                time.sleep(0.2)
            if self.process.poll() is not None:
                self.serial.close()
                continue
            require(proof is not None, "BLOCKED_QMP_UNAVAILABLE", status="BLOCKED")
            verify_acceleration(proof, acceleration)
            self.acceleration = acceleration
            return {"requested": acceleration, "queryKvm": proof, "cpus": GUEST_CPUS, "memoryMiB": GUEST_MEMORY_MIB}
        raise Failure("BLOCKED_QEMU_START", status="BLOCKED")

    def ssh(self, command, *, timeout=60, allowed=(0,)):
        return self.commands.run(["ssh", *self.ssh_args, "-p", "2222", "asa-ci@127.0.0.1", command], timeout=timeout, allowed=allowed)

    def upload(self, path, destination):
        self.commands.run(["scp", *self.ssh_args, "-P", "2222", str(path), "asa-ci@127.0.0.1:" + destination], timeout=300)

    def wait_ssh(self, timeout):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            require(self.process.poll() is None, "BLOCKED_QEMU_EXIT", status="BLOCKED")
            code, data = self.ssh("cat /proc/sys/kernel/random/boot_id", timeout=12, allowed=(0, 255))
            if code == 0 and UUID.fullmatch(data.decode().strip()):
                return data.decode().strip()
            time.sleep(2)
        raise Failure("BLOCKED_SSH_BOOT_TIMEOUT", status="BLOCKED")

    def close(self):
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=10)
        if self.serial is not None:
            self.serial.close()


class HostRun:
    def __init__(self, args):
        self.args = args
        self.source = Path(__file__).resolve().parents[2]
        self.output = self.source / "test-results/setup-realhost/evidence.json"
        self.evidence = initial_evidence(args.revision, getattr(args, "acquisition_mode", "candidate"))
        self.deadline = time.monotonic() + TOTAL_SECONDS
        self.workspace = None
        self.vm = None
        self.commands = Commands(guard=self.guard)
        self.bootstrap_deadline = None

    def save(self):
        self.evidence["updatedAt"] = now()
        write_json(self.output, self.evidence)

    def guard(self):
        fault_deadline = getattr(self, "fault_deadline", None)
        require(fault_deadline is None or time.monotonic() < fault_deadline, "BLOCKED_FAULT_TOTAL_BUDGET", status="BLOCKED")
        require(time.monotonic() < self.deadline, "BLOCKED_TOTAL_BUDGET", status="BLOCKED")
        if self.bootstrap_deadline is not None:
            require(time.monotonic() < self.bootstrap_deadline, "BLOCKED_TCG_BUDGET", status="BLOCKED")
        if self.workspace is not None:
            free = shutil.disk_usage(self.workspace).free
            self.evidence["resources"]["minimumObservedFreeBytes"] = min(free, self.evidence["resources"]["minimumObservedFreeBytes"])
            if free <= RESERVE:
                if self.vm and self.vm.process and self.vm.process.poll() is None:
                    try:
                        self.vm.query("stop")
                    except (OSError, Failure, ValueError):
                        self.vm.process.terminate()
                raise Failure("BLOCKED_HOST_DISK_RESERVE", status="BLOCKED")

    def phase(self, name, action):
        record = {"name": name, "status": "PENDING", "startedAt": now()}
        self.evidence["phases"].append(record)
        self.save()
        print(json.dumps({"phase": name, "status": "PENDING"}), flush=True)
        try:
            result = action()
            record.update(status="PASS", evidence=result, finishedAt=now())
            return result
        except BaseException as error:
            record.update(status=getattr(error, "status", "FAIL"), reasonCode=safe_error(error), finishedAt=now())
            if hasattr(error, "evidence"):
                record["evidence"] = error.evidence
            raise
        finally:
            self.save()

    def preflight(self):
        _, raw = self.commands.run(["git", "rev-parse", "HEAD"], cwd=self.source)
        release = dict(line.split("=", 1) for line in Path("/etc/os-release").read_text().splitlines() if "=" in line)
        release = {key: value.strip('"') for key, value in release.items()}
        memory = int(re.search(r"^MemTotal:\s+(\d+) kB", Path("/proc/meminfo").read_text(), re.M)[1]) * 1024
        scratch = Path(os.environ.get("RUNNER_TEMP", tempfile.gettempdir()))
        free = shutil.disk_usage(scratch).free
        self.evidence["resources"] = {"initialFreeBytes": free, "minimumObservedFreeBytes": free,
                                      "requiredFreeBytes": MIN_FREE, "reserveBytes": RESERVE,
                                      "hostMemoryBytes": memory, "hostCpus": os.cpu_count(), "guestVirtualDiskGiB": 40}
        host_environment(os.environ, self.args.revision, raw.decode().strip(), free=free,
                         memory=memory, cpus=os.cpu_count() or 0, os_release=release)
        self.acquisition = acquisition_request(getattr(self.args, "acquisition_mode", "candidate"),
            getattr(self.args, "approved_setup_revision", ""), self.args.revision, raw.decode().strip(), os.environ)
        self.pins = pin_manifest(self.source / "tools/deployment/fixtures/setup-realhost-pins.json")
        return {"platform": "Ubuntu 24.04 amd64", "runner": "standard GitHub-hosted", "sourceRevision": self.args.revision}

    def download(self, url, destination, *, expected=None, limit=4 * GIB):
        request = urllib.request.Request(url, headers={"User-Agent": "asa-realhost-acceptance"})
        temporary = Path(str(destination) + ".partial")
        digest, size = hashlib.sha256(), 0
        try:
            with urllib.request.urlopen(request, timeout=45) as response, temporary.open("xb") as target:
                require(response.status == 200 and response.geturl().startswith("https://"), "DOWNLOAD_PROTOCOL")
                while chunk := response.read(1024**2):
                    self.guard()
                    size += len(chunk)
                    require(size <= limit, "DOWNLOAD_SIZE")
                    digest.update(chunk)
                    target.write(chunk)
                target.flush()
                os.fsync(target.fileno())
            require(expected is None or digest.hexdigest() == expected, "DOWNLOAD_SHA256")
            os.link(temporary, destination)
            return {"url": url, "sha256": digest.hexdigest(), "bytes": size}
        finally:
            temporary.unlink(missing_ok=True)

    def materials(self):
        work, ubuntu, panel = self.workspace, self.pins["ubuntu"], self.pins["onePanel"]
        self.download(ubuntu["checksumsUrl"], work / "SHA256SUMS", limit=1024**2)
        self.download(ubuntu["signatureUrl"], work / "SHA256SUMS.gpg", limit=65536)
        _, signature = self.commands.run(["gpgv", "--status-fd", "1", "--keyring", ubuntu["keyring"],
                                          work / "SHA256SUMS.gpg", work / "SHA256SUMS"])
        signatures = [line.split() for line in signature.decode().splitlines() if line.startswith("[GNUPG:] VALIDSIG ")]
        require(any(ubuntu["signingFingerprint"] in (line[2], line[-1]) for line in signatures), "UBUNTU_SIGNATURE")
        filename = ubuntu["url"].rsplit("/", 1)[1]
        entries = dict((line.split()[1].lstrip("*"), line.split()[0]) for line in (work / "SHA256SUMS").read_text().splitlines() if len(line.split()) == 2)
        require(entries.get(filename) == ubuntu["sha256"], "UBUNTU_MANIFEST_PIN")
        image = self.download(ubuntu["url"], work / "ubuntu.img", expected=ubuntu["sha256"])
        archive = None
        for url in panel["urls"]:
            try:
                archive = self.download(url, work / "onepanel.tar.gz", expected=panel["sha256"], limit=GIB)
                break
            except urllib.error.HTTPError as error:
                require(error.code in (403, 404, 429, 500, 502, 503), "ONEPANEL_DOWNLOAD_HTTP", status="BLOCKED")
        require(archive is not None and archive["bytes"] == panel["bytes"], "BLOCKED_ONEPANEL_DOWNLOAD", status="BLOCKED")
        bundle = work / "candidate.tar.gz"
        _, built = self.commands.run([sys.executable, "tools/deployment/setup_bundle.py", "build", "--revision", self.args.revision,
                                      "--output", bundle], cwd=self.source, timeout=300)
        proof = json.loads(built)
        require(proof["revision"] == self.args.revision and proof["sha256"] == hash_file(bundle) and proof["attested"] is False,
                "CANDIDATE_BUNDLE_PROOF")
        acquisition = dict(self.acquisition)
        gh = None
        if acquisition["mode"] == "published":
            gh = self.download(GH_PIN["url"], work / "github-cli.tar.gz", expected=GH_PIN["sha256"], limit=GH_PIN["bytes"])
            require(gh["bytes"] == GH_PIN["bytes"], "PUBLISHED_GH_SIZE")
            _, helper = self.commands.run(["git", "show", self.args.revision + ":tools/asa_setup_acquire.py"],
                                         cwd=self.source, timeout=30)
            require(helper and hash_file(self.source / "tools/asa_setup_acquire.py") == hashlib.sha256(helper).hexdigest(),
                    "PUBLISHED_HELPER_SOURCE")
            acquisition["helperSha256"] = hashlib.sha256(helper).hexdigest()
        self.commands.run(["age-keygen", "-o", work / "age-private-key"], timeout=30)
        _, recipient = self.commands.run(["age-keygen", "-y", work / "age-private-key"], timeout=30)
        recipient = recipient.decode().strip()
        require(re.fullmatch(r"age1[a-z0-9]{58}", recipient), "AGE_RECIPIENT")
        _, selected = self.commands.run([sys.executable, "-I", "-B", "-c", CLI_RELEASE_PROGRAM, self.source / "tools", acquisition["mode"]],
            source=json.dumps(self.pins).encode(), timeout=300)
        selected = json.loads(selected)
        require(type(selected) is dict and set(selected) == {"previous", "current", "stable"}, "CLI_READ_RELEASE_PIN")
        release_expectations = cli_release_expectations({name: selected[name] for name in ("previous", "current")}, self.pins)
        self.context = {"format": "asa-realhost-context-v1", "sourceRevision": self.args.revision,
                        "nonce": uuid.uuid4().hex, "bundleSha256": proof["sha256"], "ageRecipient": recipient,
                        "pins": self.pins, "helperSha256": hash_file(self.source / "tools/deployment/ci_setup_smoke.py"),
                        "cliHelperSha256": cli_helper_hashes(self.source, self.args.revision, self.commands),
                        "cliReleaseExpectations": release_expectations, "acquisition": acquisition}
        self.context["cliDefaultTargetExpectation"] = cli_default_target_expectation(selected["stable"],
            self.args.revision if acquisition["mode"] == "published" else None)
        write_json(work / "context.json", self.context)
        return {"ubuntu": image, "ubuntuSignature": "PASS", "onePanel": archive,
                "candidateBundle": {"sha256": proof["sha256"], "revision": self.args.revision, "attested": False,
                                    "sourceOracleOnly": acquisition["mode"] == "published"}, "githubCliArchive": gh,
                "defaultCliTarget": self.context.get("cliDefaultTargetExpectation"),
                "controlledUpdateTarget": release_expectations["current"]}

    def policy_contracts(self):
        _, raw = self.commands.run([sys.executable, "-B", "tools/deployment/test_ci_setup_realhost.py", "--evidence"],
                                   cwd=self.source, timeout=120)
        proof = json.loads(raw)
        require(proof.get("status") == "PASS" and proof.get("testsRun", 0) >= 8, "HARNESS_CONTRACT_TESTS")
        return {**proof, "testSourceSha256": hash_file(self.source / "tools/deployment/test_ci_setup_realhost.py"),
                "scope": "Synthetic manager fault/required-best-effort policy and host harness contracts; not real provider failure"}

    def disk_and_seed(self):
        work = self.workspace
        self.commands.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", work / "ssh_key"], timeout=30)
        self.commands.run(["qemu-img", "create", "-f", "qcow2", "-F", "qcow2", "-b", work / "ubuntu.img", work / "guest.qcow2", "40G"])
        metadata = {"instance-id": "asa-realhost-" + self.context["nonce"], "local-hostname": "asa-realhost"}
        marker = {"format": "asa-realhost-disposable-v1", "nonce": self.context["nonce"], "sourceRevision": self.args.revision}
        userdata = {"users": ["default", {"name": "asa-ci", "shell": "/bin/bash", "lock_passwd": True,
                    "sudo": "ALL=(ALL) NOPASSWD:ALL", "ssh_authorized_keys": [(work / "ssh_key.pub").read_text().strip()]}],
                    "ssh_pwauth": False, "disable_root": True, "package_update": False, "package_upgrade": False,
                    "write_files": [{"path": "/etc/asa-realhost-disposable", "owner": "root:root", "permissions": "0644",
                                     "content": json.dumps(marker)}]}
        (work / "user-data").write_text("#cloud-config\n" + json.dumps(userdata))
        (work / "meta-data").write_text(json.dumps(metadata))
        self.commands.run(["cloud-localds", work / "seed.img", work / "user-data", work / "meta-data"])
        device_access = prepare_kvm_access(self.commands)
        self.vm = VM(work, self.commands)
        proof = self.vm.start()
        proof["deviceAccess"] = device_access
        self.evidence["virtualization"] = proof
        if self.vm.acceleration == "tcg":
            self.bootstrap_deadline = time.monotonic() + BOOTSTRAP_TCG_SECONDS
        self.first_boot = self.vm.wait_ssh(600 if self.vm.acceleration == "kvm" else 900)
        self.vm.ssh("sudo cloud-init status --wait", timeout=180)
        return {**proof, "bootId": self.first_boot, "sshBind": "127.0.0.1:2222", "virtualDiskGiB": 40}

    def stage_guest(self):
        work = self.workspace
        published = guest_acquisition_mode(self.context) == "published"
        self.vm.ssh("mkdir -m 700 /home/asa-ci/realhost-input")
        files = {"runner.py": Path(__file__), "context.json": work / "context.json", "candidate.tar.gz": work / "candidate.tar.gz",
                 "onepanel.tar.gz": work / "onepanel.tar.gz", "setup_bundle.py": self.source / "tools/deployment/setup_bundle.py",
                 "ci_setup_smoke.py": self.source / "tools/deployment/ci_setup_smoke.py",
                 **{name: self.source / "tools/deployment" / name for name in CLI_HELPERS}}
        if published:
            files["github-cli.tar.gz"] = work / "github-cli.tar.gz"
        for name, path in files.items():
            self.vm.upload(path, "/home/asa-ci/realhost-input/" + name)
        token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
        require(bool(token), "BLOCKED_READ_TOKEN_REQUIRED", status="BLOCKED")
        token_path = work / "github-read-token"
        descriptor = os.open(token_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            stream.write(token)
        self.vm.upload(token_path, "/home/asa-ci/realhost-input/github-read-token")
        token_path.unlink()
        self.vm.ssh("sudo install -d -m 755 /opt/asa-realhost && sudo install -d -m 700 /var/lib/asa-realhost && "
                    "sudo install -m 644 /home/asa-ci/realhost-input/runner.py /home/asa-ci/realhost-input/context.json "
                    "/home/asa-ci/realhost-input/setup_bundle.py /home/asa-ci/realhost-input/ci_setup_smoke.py "
                    "/home/asa-ci/realhost-input/realhost_cli_checks.py /home/asa-ci/realhost-input/realhost_cli_runtime.py /opt/asa-realhost/ && "
                    "sudo install -m 600 /home/asa-ci/realhost-input/candidate.tar.gz /home/asa-ci/realhost-input/onepanel.tar.gz "
                    "/home/asa-ci/realhost-input/github-read-token /var/lib/asa-realhost/ && rm -f /home/asa-ci/realhost-input/github-read-token")
        if published:
            self.vm.ssh("sudo install -m 600 /home/asa-ci/realhost-input/github-cli.tar.gz /var/lib/asa-realhost/github-cli.tar.gz")
        return {"candidateStagedOnlyInsideGuest": not published, "sourceOracleOnly": published,
                "ephemeralTokenTransport": "private file; read permissions; no argv"}

    def guest(self, phase, *, timeout=1200, pending=False):
        code, data = self.vm.ssh("sudo /usr/bin/python3 -I -B /opt/asa-realhost/runner.py --guest-phase " + shlex.quote(phase),
                                 timeout=timeout, allowed=(0, 1, 2))
        try:
            result = json.loads(data)
        except (ValueError, UnicodeError):
            raise Failure("GUEST_REPORT_INVALID") from None
        require(result.get("format") == "asa-realhost-guest-v1" and result.get("phase") == phase, "GUEST_REPORT_BINDING")
        if code or result.get("status") not in ({"PASS", "PENDING"} if pending else {"PASS"}):
            reason = result.get("reasonCode", "GUEST_PHASE_FAILED")
            error = Failure(reason if isinstance(reason, str) and CODE.fullmatch(reason) else "GUEST_PHASE_FAILED",
                            status="BLOCKED" if result.get("status") == "BLOCKED" else "FAIL")
            error.evidence = result
            raise error
        return result

    def reboot(self):
        before = self.vm.wait_ssh(30)
        pid = self.vm.process.pid
        self.vm.ssh("sudo systemctl reboot", timeout=20, allowed=(0, 255))
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            after = self.vm.wait_ssh(90)
            if after != before:
                verify_boot_change(before, after)
                require(self.vm.process.poll() is None and self.vm.process.pid == pid, "REBOOT_QEMU_IDENTITY")
                observed = self.guest("post-reboot", timeout=600)
                return {"beforeBootId": before, "afterBootId": after, "sameQemuProcess": True, "observation": observed}
            time.sleep(2)
        raise Failure("GUEST_DID_NOT_REBOOT")

    def missed_timer(self):
        setup = self.guest("schedule", timeout=300)
        due = setup["dueEpoch"]
        require(type(due) is int and 30 < due - time.time() < 360, "TIMER_OFFLINE_WINDOW")
        before = self.vm.wait_ssh(30)
        disk = (self.workspace / "guest.qcow2").stat()
        self.vm.ssh("sudo systemctl poweroff", timeout=20, allowed=(0, 255))
        deadline = time.monotonic() + 120
        while self.vm.process.poll() is None and time.monotonic() < deadline:
            self.guard()
            time.sleep(1)
        require(self.vm.process.poll() is not None, "GUEST_DID_NOT_POWER_OFF")
        stopped_at = time.time()
        require(stopped_at < due, "TIMER_NOT_OFFLINE_BEFORE_DUE")
        while time.time() < due + 70:
            self.guard()
            time.sleep(1)
        require((self.workspace / "guest.qcow2").stat().st_ino == disk.st_ino, "TIMER_DISK_REPLACED")
        self.vm.start()
        after = self.vm.wait_ssh(600)
        verify_boot_change(before, after)
        deadline = time.monotonic() + 1200
        while time.monotonic() < deadline:
            recovered = self.guest("timer-probe", timeout=90, pending=True)
            if recovered["status"] == "PASS":
                retries = self.guest("timer-retry", timeout=600)
                return {"beforeBootId": before, "afterBootId": after, "poweredOffAtEpoch": stopped_at,
                        "dueEpoch": due, "sameVirtualDisk": True, "clockChanged": False,
                        "fixtureSchedulePreparation": setup, "persistentRecovery": recovered, "boundedRetry": retries}
            time.sleep(10)
        raise Failure("PERSISTENT_TIMER_NOT_RECOVERED")

    def fault_guest(self, phase):
        self.guard()
        require(shutil.disk_usage(self.workspace).free >= 6 * GIB, "BLOCKED_FAULT_HOST_DISK", status="BLOCKED")
        return self.guest(phase, timeout=FAULT_PHASE_SECONDS + 30)

    def cloud_fault(self):
        self.guard()
        require(shutil.disk_usage(self.workspace).free >= 6 * GIB, "BLOCKED_FAULT_HOST_DISK", status="BLOCKED")
        require(time.monotonic() + CLOUD_FAULT_SECONDS + 30 < min(self.deadline, self.fault_deadline),
                "BLOCKED_CLOUD_FAULT_ADMISSION", status="BLOCKED")
        return self.guest("cloud-fault", timeout=CLOUD_FAULT_SECONDS + 30)

    def published_acquisition(self):
        """Keep this independent PASS even when a later installation fails."""
        try:
            result = self.guest("published-acquire", timeout=PUBLISHED_SECONDS + 30)
            proof = result.get("publishedSetupAcquisition")
            require(isinstance(proof, dict) and proof.get("status") == "PASS"
                    and proof.get("sourceRevision") == self.args.revision
                    and proof.get("manualCandidateStage") is False, "PUBLISHED_GUEST_PROOF")
            self.evidence["publishedSetupAcquisition"] = proof
            return result
        except BaseException as error:
            proof = getattr(error, "evidence", {}).get("publishedSetupAcquisition", {})
            self.evidence["publishedSetupAcquisition"] = proof if isinstance(proof, dict) and proof.get("status") in ("FAIL", "BLOCKED") else {
                "status": getattr(error, "status", "FAIL"), "reasonCode": "PUBLISHED_GUEST_PROOF"}
            raise


    def run(self):
        try:
            self.phase("runner_preflight", self.preflight)
            if self.args.preflight_only:
                self.evidence.update(status="NOT_RUN", reasonCode="DEPENDENCIES_NOT_PREPARED")
                return 0
            with tempfile.TemporaryDirectory(prefix="asa-realhost-", dir=os.environ["RUNNER_TEMP"]) as directory:
                self.workspace = Path(directory)
                try:
                    self.phase("synthetic_cloud_policy_contracts", self.policy_contracts)
                    self.phase("verified_materials", self.materials)
                    self.phase("qemu_real_guest", self.disk_and_seed)
                    self.phase("guest_candidate_stage", self.stage_guest)
                    self.phase("official_1panel_bootstrap", lambda: self.guest("bootstrap", timeout=1800))
                    self.bootstrap_deadline = None
                    if getattr(self.args, "acquisition_mode", "candidate") == "published":
                        self.phase("published_setup_acquisition", self.published_acquisition)
                    self.phase("public_asa_install", lambda: self.guest("install", timeout=3000))
                    self.phase("independent_control_fixture", lambda: self.guest("seed", timeout=900))
                    self.phase("installed_cli_read_acceptance", lambda: self.guest("cli-read", timeout=1200))
                    self.phase("published_runtime_update", lambda: self.guest("update", timeout=2400))
                    self.fault_deadline = min(self.deadline, time.monotonic() + FAULT_TOTAL_SECONDS)
                    try:
                        self.phase("public_cloud_connection_policies", self.cloud_fault)
                        self.phase("public_backup_and_retry", lambda: self.guest("backup", timeout=1200))
                        self.phase("public_release_connection_failure", lambda: self.guest("network-fault", timeout=900))
                        self.phase("public_partial_backup_failure", lambda: self.fault_guest("partial-fault"))
                        self.phase("public_backup_interrupt_recovery", lambda: self.fault_guest("interrupt-fault"))
                    finally:
                        self.fault_deadline = None
                    self.phase("real_guest_reboot", self.reboot)
                    self.phase("real_persistent_timer", self.missed_timer)
                    self.phase("final_control_browser", lambda: self.guest("final", timeout=900))
                    self.evidence["checks"].update(cleanUbuntuActual1Panel="PASS", publicCliLifecycle="PASS",
                                                   publishedRuntimeUpdate="PASS", realGuestReboot="PASS", persistentTimer="PASS",
                                                   publicPartialBackupFailure="PASS", publicBackupInterruption="PASS",
                                                   publicReleaseConnectionFailure="PASS", installedCliReadAcceptance="PASS",
                                                   publicCloudConnectionPolicies="PASS")
                    self.evidence["status"] = "PASS"
                finally:
                    if self.vm:
                        self.vm.close()
            self.workspace = None
            self.evidence["cleanup"] = "PASS"
            return 0
        except BaseException as error:
            self.evidence.update(status=getattr(error, "status", "FAIL"), reasonCode=safe_error(error))
            return 130 if isinstance(error, KeyboardInterrupt) else 2 if self.evidence["status"] == "BLOCKED" else 1
        finally:
            self.evidence["finishedAt"] = now()
            self.save()
            print(json.dumps({"status": self.evidence["status"], "reasonCode": self.evidence.get("reasonCode"),
                              "sourceRevision": self.args.revision}), flush=True)


def safe_error(error):
    value = getattr(error, "code", "INTERRUPTED" if isinstance(error, KeyboardInterrupt) else "HARNESS_EXCEPTION")
    return value if isinstance(value, str) and CODE.fullmatch(value) else "HARNESS_EXCEPTION"


# Guest phases are below. They never run unless the exact disposable VM marker
# is present; this is also checked before importing any candidate module.

CLI_ACTIONS = []


def guest_guard(*, control_deadline=None):
    marker = Path("/etc/asa-realhost-disposable")
    metadata = marker.lstat()
    require(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == 0 and not metadata.st_mode & 0o022,
            "DISPOSABLE_GUEST_MARKER")
    context = json.loads((GUEST_HOME / "context.json").read_text())
    identity = json.loads(marker.read_text())
    require(identity == {"format": "asa-realhost-disposable-v1", "nonce": context["nonce"],
                         "sourceRevision": context["sourceRevision"]}, "DISPOSABLE_GUEST_IDENTITY")
    require(HEX40.fullmatch(context["sourceRevision"]) and Path("/proc/1/comm").read_text().strip() == "systemd",
            "REAL_GUEST_SYSTEMD")
    if control_deadline is None:
        # This fixed probe can run inside an already owned fault session.
        _, observed = Commands().run(["systemd-detect-virt", "--vm"], own_group=False)
    else:
        require(type(control_deadline) in (int, float) and math.isfinite(control_deadline)
                and 0 < control_deadline - time.monotonic() <= CLI_CONTROL_SECONDS, "CLI_CONTROL_DEADLINE")
        observed = cli_control_command(["systemd-detect-virt", "--vm"], deadline=control_deadline,
                                       environment=dict(os.environ))
    require(observed.decode().strip() in ("kvm", "qemu"), "REAL_GUEST_VIRTUALIZATION")
    release = dict(line.split("=", 1) for line in Path("/etc/os-release").read_text().splitlines() if "=" in line)
    require(release.get("ID", "").strip('"') == "ubuntu" and release.get("VERSION_ID", "").strip('"') == "24.04"
            and platform.machine() == "x86_64", "REAL_GUEST_PLATFORM")
    return context


def guest_environment():
    result = {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "HOME": "/root",
              "USER": "root", "LOGNAME": "root", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8",
              "DEBIAN_FRONTEND": "noninteractive", "PYTHONDONTWRITEBYTECODE": "1", "NX_SKIP_NX_CACHE": "true"}
    token = GUEST_PRIVATE / "github-read-token"
    if os.geteuid() == 0 and token.exists():
        info = token.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o600,
                "CI_TOKEN_FILE")
        result["GH_TOKEN"] = token.read_text()
    return result


def root_json(name):
    return json.loads((GUEST_PRIVATE / name).read_text())


def public_cli(words, *, options=(), allowed=(0,), timeout=1200):
    command = ["/usr/local/bin/asa", *words, "--root", str(INSTALL_ROOT), "--json", "--no-color", *options]
    baseline = command_log_baseline(words)
    commands = Commands()
    code, raw = commands.run(command, timeout=timeout, environment=guest_environment(), allowed=(0, 1, 2, 130))
    return public_cli_result(words, code, raw, allowed=allowed,
                             invocation={**commands.last_invocation, "setupLogsBefore": baseline})


def public_cli_result(words, code, raw, *, allowed=(0,), invocation=None):
    try:
        result = json.loads(raw)
    except (ValueError, UnicodeError):
        raise Failure("PUBLIC_CLI_JSON") from None
    require(isinstance(result, dict) and result.get("format") == "asa-cli-result-v1" and result.get("exitCode") == code, "PUBLIC_CLI_RESULT")
    supplied = result.get("reasonCodes") if isinstance(result.get("reasonCodes"), list) else []
    reasons = [item if item in COMMAND_DIAGNOSTIC_REASONS else "UNRECOGNIZED_REASON"
               for item in [result.get("reasonCode"), *supplied[:8]] if isinstance(item, str)]
    status = result.get("status")
    record = {"command": "asa " + " ".join(words), "exitCode": code,
              "status": status if isinstance(status, str) and status in STATES else "UNVERIFIED", "reasonCodes": reasons}
    if isinstance(result.get("operation"), dict) and isinstance(result["operation"].get("outcome"), str) and result["operation"]["outcome"] in COMMAND_DIAGNOSTIC_OUTCOMES:
        record["operationOutcome"] = result["operation"]["outcome"]
    CLI_ACTIONS.append(record)
    if code not in allowed:
        error = Failure(reasons[-1] if reasons else "PUBLIC_CLI_FAILED")
        if words == ["status"] or words == ("status",):
            try:
                record["readCommandDiagnostic"] = public_status_failure_projection(words, code, raw, invocation)
            except BaseException as failure:
                reason = failure.code if type(failure) is Failure else None
                record["readCommandDiagnostic"] = {
                    "format": "asa-public-status-diagnostic-v1", "status": "UNAVAILABLE", "source": "UNVERIFIED",
                    "reasonCode": reason if type(reason) is str and reason in {
                        "READ_DIAGNOSTIC_SIZE", "READ_DIAGNOSTIC_JSON", "READ_DIAGNOSTIC_BINDING",
                        "READ_DIAGNOSTIC_INVOCATION"} else "READ_DIAGNOSTIC_UNAVAILABLE"}
        else:
            try:
                error.command_failure_diagnostic = command_failure_diagnostic(words, code, result, invocation)
            except BaseException as failure:
                error.command_failure_diagnostic = command_diagnostic_error(failure)
            if error.command_failure_diagnostic.get("binding") == "VERIFIED":
                record.update({key: error.command_failure_diagnostic[key] for key in ("operationId", "installationId")})
        raise error
    return result


def public_status_failure_projection(words, code, raw, invocation):
    """Project only this failed public stdout; no manager receipt or new I/O."""
    require(type(words) in (list, tuple) and tuple(words) == ("status",)
            and type(code) is int and code == 1, "READ_DIAGNOSTIC_BINDING")
    require(type(raw) in (bytes, str) and len(raw) <= DIAGNOSTIC_LIMIT, "READ_DIAGNOSTIC_SIZE")
    try:
        encoded = raw.encode("utf-8") if type(raw) is str else raw
        require(len(encoded) <= DIAGNOSTIC_LIMIT, "READ_DIAGNOSTIC_SIZE")

        def unique_object(pairs):
            result = {}
            for key, value in pairs:
                require(key not in result, "READ_DIAGNOSTIC_JSON")
                result[key] = value
            return result

        def nonfinite(_value):
            raise Failure("READ_DIAGNOSTIC_JSON")

        public = json.loads(encoded.decode("utf-8"), object_pairs_hook=unique_object, parse_constant=nonfinite)
    except (ValueError, UnicodeError, RecursionError):
        raise Failure("READ_DIAGNOSTIC_JSON") from None
    require(type(public) is dict and public.get("format") == "asa-cli-result-v1"
            and public.get("command") == "status" and type(public.get("exitCode")) is int
            and public["exitCode"] == code and type(public.get("status")) is str
            and public["status"] in {"UNAVAILABLE", "FAILED"}, "READ_DIAGNOSTIC_BINDING")
    # Commands.run supplies these together with this exact stdout/return code.
    # Their shape is checked, but no independent manager/installation binding is
    # asserted and no process IDs, timestamps or command paths are exported.
    require(type(invocation) is dict and type(invocation.get("pid")) is int
            and 0 < invocation["pid"] <= 2**31 - 1
            and all(type(invocation.get(key)) is int for key in ("startedNs", "finishedNs"))
            and 0 < invocation["startedNs"] <= invocation["finishedNs"] < 2**63,
            "READ_DIAGNOSTIC_INVOCATION")

    def field(record, key, *, allowed=None, kind=str):
        if key not in record:
            return {"state": "MISSING"}
        value = record[key]
        if value is None:
            return {"state": "NULL"}
        valid = type(value) is kind
        if valid and kind is int:
            valid = 0 <= value <= 99_999_999
        if valid and allowed is not None:
            valid = value in allowed
        return {"state": "OBSERVED", "value": value} if valid else {"state": "UNRECOGNIZED"}

    def component(record, key, states, reasons):
        if key not in record:
            return None, {"state": "MISSING"}
        if record[key] is None:
            return None, {"state": "NULL"}
        if type(record[key]) is not dict:
            return None, {"state": "UNRECOGNIZED"}
        source = record[key]
        return source, {"state": "OBSERVED", "status": field(source, "status", allowed=states),
                        "reason": receipt_reason(source, "reasonCode", reasons)}

    services, service_result = component(public, "services", {"OK", "FAILED", "UNAVAILABLE"},
        {"INSTALLATION_IDENTITY", "NO_CONTAINERS", "OUTPUT_LIMIT", "PROBE_FAILED",
         "TOOL_OR_ACCESS", "DOCKER_IDENTITY"})
    if services is not None:
        for name in ("docker", "compose"):
            _, service_result[name] = component(services, name, {"OK", "UNAVAILABLE"}, {"TOOL_OR_ACCESS"})
        if "containers" not in services:
            service_result["containers"] = {"state": "MISSING"}
        elif services["containers"] is None:
            service_result["containers"] = {"state": "NULL"}
        elif type(services["containers"]) is not list:
            service_result["containers"] = {"state": "UNRECOGNIZED"}
        elif len(services["containers"]) > 64:
            service_result["containers"] = {"state": "LIMIT_EXCEEDED"}
        else:
            rows = []
            for item in services["containers"]:
                if type(item) is not dict:
                    rows.append({"state": "UNRECOGNIZED"})
                    continue
                rows.append({"state": "OBSERVED",
                    "service": field(item, "service", allowed={"api", "web", "postgres", "minio",
                        "scratch", "search", "migration", "minio-init"}),
                    "running": field(item, "running", kind=bool),
                    "health": field(item, "health", allowed={"starting", "healthy", "unhealthy"})})
            service_result["containers"] = {"state": "OBSERVED", "items": rows}
    database, database_result = component(public, "database", {"OK", "UNAVAILABLE"},
        {"POSTGRES_UNAVAILABLE", "POSTGRES_QUERY_UNAVAILABLE"})
    if database is not None:
        database_result["schema"] = field(database, "schema", kind=int)
    site, site_result = component(public, "site", {"OK", "FAILED", "UNAVAILABLE"},
        {"ENTRY_ORIGIN_UNAVAILABLE"})
    if site is not None:
        site_result["reportedSchema"] = field(site, "reportedSchema", kind=int)
        _, site_result["editorEndpoint"] = component(site, "editorEndpoint", {"OK", "UNAVAILABLE"}, set())
    return {"format": "asa-public-status-diagnostic-v1", "status": "OBSERVED",
            "source": "CAPTURED_PUBLIC_STDOUT", "command": "status", "publicExitCode": code,
            "publicStatus": public["status"], "topReason": receipt_reason(public, "reasonCode", set()),
            "services": service_result, "database": database_result, "site": site_result}


def candidate_bundle(context):
    return Path("/opt/asa-setup") / context["sourceRevision"]


def cli_trusted_bytes(path, *, mode=0o644, maximum=2 * 1024**2):
    """Read exact root-owned bytes through protected, non-symlink ancestors."""
    path = Path(path)
    require(path.is_absolute() and ".." not in path.parts, "CLI_READ_TRUST")
    descriptor = None
    try:
        descriptor = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        root_info = os.fstat(descriptor)
        require(root_info.st_uid == 0 and not root_info.st_mode & 0o022, "CLI_READ_TRUST")
        for index, part in enumerate(path.parts[1:]):
            directory = index < len(path.parts) - 2
            child = os.open(part, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK |
                            (os.O_DIRECTORY if directory else 0), dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
            info = os.fstat(descriptor)
            require(info.st_uid == 0 and not info.st_mode & 0o022, "CLI_READ_TRUST")
            require(stat.S_ISDIR(info.st_mode) if directory else
                    stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == mode,
                    "CLI_READ_TRUST")
        before = os.fstat(descriptor)
        require(0 < before.st_size <= maximum, "CLI_READ_TRUST")
        chunks, remaining = [], before.st_size
        while remaining:
            chunk = os.read(descriptor, min(65536, remaining))
            require(chunk, "CLI_READ_TRUST")
            chunks.append(chunk)
            remaining -= len(chunk)
        after = os.fstat(descriptor)
        # Reading may update atime; identity, permissions and all write metadata
        # must remain stable, without treating our own access as a mutation.
        require((before.st_mode, before.st_uid, before.st_gid, before.st_nlink) ==
                (after.st_mode, after.st_uid, after.st_gid, after.st_nlink)
                and diagnostic_metadata(before) == diagnostic_metadata(after), "CLI_READ_TRUST")
        return b"".join(chunks)
    except OSError:
        raise Failure("CLI_READ_TRUST") from None
    finally:
        if descriptor is not None:
            os.close(descriptor)


def cli_trusted_module(name, context):
    require(name in CLI_HELPERS and type(context.get("cliHelperSha256")) is dict
            and set(context["cliHelperSha256"]) == set(CLI_HELPERS), "CLI_READ_TRUST")
    expected = context["cliHelperSha256"][name]
    require(type(expected) is str and HEX64.fullmatch(expected), "CLI_READ_TRUST")
    path = GUEST_HOME / name
    raw = cli_trusted_bytes(path)
    require(hashlib.sha256(raw).hexdigest() == expected, "CLI_READ_TRUST")
    module_name = "asa_realhost_trusted_" + path.stem
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module  # dataclasses under -I need the real module identity.
    try:
        exec(compile(raw, str(path), "exec"), module.__dict__)
    except BaseException:
        sys.modules.pop(module_name, None)
        raise
    return module


def cli_candidate_binding(context, verifier, *, prepared=False):
    """Bind registration to the original checked archive, not a self-declared manifest."""
    require(type(context.get("sourceRevision")) is str and HEX40.fullmatch(context["sourceRevision"])
            and type(context.get("bundleSha256")) is str and HEX64.fullmatch(context["bundleSha256"]),
            "CLI_READ_BUNDLE")
    raw = cli_trusted_bytes(GUEST_PRIVATE / "candidate.tar.gz", mode=0o600, maximum=verifier.MAX_PACKAGE_BYTES)
    try:
        manifest, files = verifier.inspect_archive(raw, revision=context["sourceRevision"], sha256=context["bundleSha256"])
    except ValueError:
        raise Failure("CLI_READ_BUNDLE") from None
    bundle = candidate_bundle(context)
    actual_files, actual_dirs = set(), set()
    for parent, directories, names in os.walk(bundle, followlinks=False):
        for name in directories + names:
            path = Path(parent) / name
            info = path.lstat()
            require(not stat.S_ISLNK(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022, "CLI_READ_BUNDLE")
            relative = path.relative_to(bundle).as_posix()
            (actual_dirs if stat.S_ISDIR(info.st_mode) else actual_files).add(relative)
            require(len(actual_files) <= 2049 and len(actual_dirs) <= 8192, "CLI_READ_BUNDLE")
    expected_files = set(files) | {"setup-bundle.json"}
    expected_dirs = {parent.as_posix() for name in expected_files for parent in Path(name).parents if parent != Path(".")}
    require(actual_files == expected_files and actual_dirs == expected_dirs, "CLI_READ_BUNDLE")
    require(json.loads(cli_trusted_bytes(bundle / "setup-bundle.json")) == manifest, "CLI_READ_BUNDLE")
    for name, expected in files.items():
        require(cli_trusted_bytes(bundle / name, mode=0o755 if name.endswith(".sh") else 0o644,
                                  maximum=verifier.MAX_FILE_BYTES) == expected, "CLI_READ_BUNDLE")
    for name in CLI_HELPERS:
        require(hashlib.sha256(files["tools/deployment/" + name]).hexdigest() == context["cliHelperSha256"][name],
                "CLI_READ_BUNDLE")
    require(type(prepared) is bool, "CLI_READ_REGISTRATION")
    registry = json.loads(cli_trusted_bytes("/etc/asa-lab/commands.json"))
    registrations = [] if prepared else [
        {"root": str(INSTALL_ROOT), "project": "asa-lab-dev", "profile": "production", "bundle": str(bundle)}]
    require(registry == {"format": "asa-command-v1", "preparedBundle": str(bundle), "installations": registrations},
        "CLI_READ_REGISTRATION")
    expected_wrapper = (
        "#!/bin/sh\n# ASA Lab verified setup CLI; use the official pinned bundle only.\n"
        "PATH=/usr/sbin:/usr/bin:/sbin:/bin; export PATH\n"
        "unset PYTHONPATH PYTHONHOME LD_PRELOAD LD_LIBRARY_PATH ENV BASH_ENV\n"
        "exec /usr/bin/python3 -I -B " + shlex.quote(str(bundle / "tools/asa_cli.py")) + ' "$@"\n'
    ).encode()
    require(cli_trusted_bytes("/usr/local/bin/asa", mode=0o755, maximum=65536) == expected_wrapper, "CLI_READ_REGISTRATION")
    return {"status": "VERIFIED", "sourceRevision": context["sourceRevision"],
            "bundleSha256": context["bundleSha256"], "wrapperSha256": hashlib.sha256(expected_wrapper).hexdigest()}


def cli_context_inputs(owner):
    def private(relative):
        raw, _, _ = diagnostic_read(INSTALL_ROOT / relative, INSTALL_ROOT, owner["uid"])
        value = json.loads(raw)
        require(type(value) is dict, "CLI_READ_CONTEXT")
        return value
    receipt = private(".asa/setup-last-successful.json")
    operation = receipt.get("operationId")
    require(type(operation) is str and re.fullmatch(r"[a-f0-9]{32}", operation), "CLI_READ_CONTEXT")
    binding = private(".asa/setup-backups/operation-" + operation + ".json")
    snapshot = binding.get("snapshotId")
    require(type(snapshot) is str and re.fullmatch(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8,32}", snapshot), "CLI_READ_CONTEXT")
    directory = INSTALL_ROOT / ".asa/setup-backups"
    snapshots = []
    for index, path in enumerate(directory.iterdir()):
        require(index < 512, "CLI_READ_CONTEXT")
        if re.fullmatch(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8,32}\.json", path.name):
            snapshots.append(path.stem)
    require(snapshots == [snapshot], "CLI_READ_CONTEXT")
    return {"input": json.loads(cli_trusted_bytes(GUEST_PRIVATE / "install-input.json", mode=0o600)),
            "config": private(".asa/setup.json"), "installed": private(".asa/installed-release.json"),
            "receipt": receipt, "attempt": private(".asa/setup-last-attempt.json"),
            "journal": private(".asa/setup-operations/" + operation + ".json"), "binding": binding,
            "backup": private(".asa/setup-backups/" + snapshot + ".json"),
            "backupAttempt": private(".asa/setup-backups/last-attempt.json"),
            "backupSuccess": private(".asa/setup-backups/last-local-success.json")}


def cli_fixture_context(checks, context, owner, inputs, filesystem_paths):
    """No value here originates from a command checked by the CLI suite."""
    required = {"input", "config", "installed", "receipt", "attempt", "journal", "binding",
                "backup", "backupAttempt", "backupSuccess"}
    require(type(inputs) is dict and set(inputs) == required and all(type(value) is dict for value in inputs.values()),
            "CLI_READ_CONTEXT")
    require(type(filesystem_paths) is dict and set(filesystem_paths) == {"application", "backups", "docker", "postgres", "minio"}
            and all(type(path) is str and re.fullmatch(r"/[A-Za-z0-9_./-]+", path)
                    and not any(part in ("", ".", "..") for part in path.split("/")[1:]) for path in filesystem_paths.values())
            and filesystem_paths["application"] == str(INSTALL_ROOT)
            and filesystem_paths["backups"] == str(INSTALL_ROOT / "backups"), "CLI_READ_STORAGE")
    config, supplied, receipt, journal = (inputs[name] for name in ("config", "input", "receipt", "journal"))
    previous, target = context["cliReleaseExpectations"]["previous"], context["cliReleaseExpectations"]["current"]
    for name, release in (("previous", previous), ("current", target)):
        pin = context["pins"][name]
        require(release["revision"] == pin["revision"] and type(release["schema"]) is int and release["schema"] == pin["schema"]
                and release["deploymentDigest"] == pin["deploymentDigest"] and release["manifestDigest"] == pin["amd64ManifestDigest"],
                "CLI_READ_RELEASE_PIN")
        require(type(release.get("images")) is dict and set(release["images"]) == set(CLI_IMAGES)
                and all(type(release["images"][service]) is str and re.fullmatch(
                    re.escape("ghcr.io/" + REPOSITORY + "/" + service + "@sha256:") + r"[a-f0-9]{64}",
                    release["images"][service]) for service in CLI_IMAGES), "CLI_READ_RELEASE_PIN")
    mode = guest_acquisition_mode(context)
    target = context.get("cliDefaultTargetExpectation")
    require(type(target) is dict, "CLI_READ_DEFAULT_TARGET")
    target = cli_default_target_binding(target, context["sourceRevision"] if mode == "published" else target.get("revision"))
    identity, operation, backup = supplied.get("installationId"), receipt.get("operationId"), inputs["backup"]
    require(type(identity) is str and re.fullmatch(r"[a-f0-9]{32}", identity)
            and type(operation) is str and re.fullmatch(r"[a-f0-9]{32}", operation), "CLI_READ_CONTEXT")
    ports = {"web": 4610, "api": 4611, "blocks": 4613}
    schedule = {"enabled": False, "time": "03:00", "timezone": "UTC", "maxAgeHours": 26}
    for document in (supplied, config):
        require(document.get("root") == str(INSTALL_ROOT) and document.get("project") == "asa-lab-dev"
                and document.get("profile") == "production" and document.get("entryOrigin") == ORIGIN
                and document.get("installationId") == identity and type(document.get("operatorUid")) is int
                and document["operatorUid"] == owner["uid"] > 0 and document.get("ports") == ports
                and document.get("backupDirectory") == str(INSTALL_ROOT / "backups"), "CLI_READ_CONTEXT")
        policy = document.get("backup", {})
        require(policy.get("policy") == "best-effort" and policy.get("cloud", {}).get("enabled") is False
                and policy.get("ageRecipient") == context["ageRecipient"] and policy.get("schedule") == schedule,
                "CLI_READ_CONTEXT")
    require(config.get("automaticUpdates", False) is False and inputs["attempt"] == receipt
            and journal.get("result") == receipt and journal.get("state") == "TERMINAL"
            and journal.get("root") == str(INSTALL_ROOT) and journal.get("project") == "asa-lab-dev"
            and journal.get("requestedDeploymentDigest") == previous["deploymentDigest"], "CLI_READ_CONTEXT")
    for document in (receipt, journal):
        require(document.get("operationId") == operation and document.get("installationId") == identity
                and document.get("mode") == "install", "CLI_READ_CONTEXT")
    require_application(receipt, context["pins"]["previous"])
    require(receipt.get("outcome") == "WARNING" and receipt.get("reasonCode") in (None, "NONE"), "CLI_READ_CONTEXT")
    for release in (inputs["installed"], journal.get("release", {})):
        require(all(release.get(key) == previous[key] for key in ("revision", "schema", "images")), "CLI_READ_RELEASE_PIN")
    require(all(journal.get("stages", {}).get(stage, {}).get("status") == "done"
                for stage in ("release", "switch", "browser", "first_backup")), "CLI_READ_CONTEXT")
    snapshot = backup.get("snapshotId")
    require(type(snapshot) is str and re.fullmatch(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8,32}", snapshot)
            and inputs["binding"].get("snapshotId") == snapshot and inputs["binding"].get("operationId") == operation
            and inputs["binding"].get("installationId") == identity
            and backup.get("operationId") == operation and backup.get("installationId") == identity
            and receipt.get("backup", {}).get("snapshotId") == snapshot, "CLI_READ_CONTEXT")
    require(backup.get("local", {}).get("status") == backup.get("encryption", {}).get("status") == "OK"
            and backup.get("cloud", {}).get("status") == "NOT_CONFIGURED" and backup.get("outcome") == "WARNING"
            and inputs["backupAttempt"].get("snapshotId") == inputs["backupSuccess"].get("snapshotId") == snapshot
            and inputs["backupAttempt"].get("operationId") == operation
            and inputs["backupSuccess"].get("at") == backup.get("snapshotAt"), "CLI_READ_CONTEXT")
    require(type(backup.get("snapshotAt")) is str and len(backup["snapshotAt"]) <= 40, "CLI_READ_CONTEXT")
    stamp = dt.datetime.fromisoformat(backup["snapshotAt"].replace("Z", "+00:00"))
    require(stamp.tzinfo is not None and stamp.utcoffset() == dt.timedelta(0), "CLI_READ_CONTEXT")
    expected = checks.FixtureContext(root=str(INSTALL_ROOT), project="asa-lab-dev", origin=ORIGIN,
        installed=checks.ReleasePin(previous["revision"], previous["schema"], previous["images"]),
        target=checks.ReleasePin(target["revision"], target["schema"], target["images"]),
        deployment_digest=target["deploymentDigest"], manifest_digest=target["manifestDigest"],
        filesystem_paths=filesystem_paths, ports=ports, schedule=schedule, snapshot_ids=(snapshot,),
        last_attempt=snapshot, last_local_success=snapshot, accepted_operation_id=operation, restore_snapshot_id=snapshot)
    return expected, stamp.isoformat()


def cli_control_command(arguments, *, deadline, environment, cwd=None, source=None, owner=None):
    """A bounded child in its owner's existing session; raw streams stay private."""
    require(source is None or type(source) is bytes and len(source) <= 65536, "CLI_CONTROL_INPUT")
    require(owner is None or type(owner) is dict and type(owner.get("uid")) is int and owner["uid"] > 0
            and type(owner.get("gid")) is int and owner["gid"] > 0 and owner.get("name") == "asa-setup",
            "CLI_CONTROL_OWNER")
    credentials = {} if owner is None else {"user": owner["uid"], "group": owner["gid"],
        "extra_groups": os.getgrouplist(owner["name"], owner["gid"])}
    require(time.monotonic() < deadline, "CLI_CONTROL_TIMEOUT")
    with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors, tempfile.TemporaryFile() as incoming:
        if source is not None:
            incoming.write(source)
            incoming.seek(0)
        process = subprocess.Popen([str(item) for item in arguments], cwd=cwd, env=environment,
            stdin=incoming if source is not None else subprocess.DEVNULL, stdout=output, stderr=errors, **credentials)
        try:
            while process.poll() is None:
                require(time.monotonic() < deadline, "CLI_CONTROL_TIMEOUT")
                require(os.fstat(output.fileno()).st_size + os.fstat(errors.fileno()).st_size <= 2 * 1024**2,
                        "CLI_CONTROL_OUTPUT")
                time.sleep(0.02)
            require(time.monotonic() < deadline, "CLI_CONTROL_TIMEOUT")
            require(os.fstat(output.fileno()).st_size + os.fstat(errors.fileno()).st_size <= 2 * 1024**2,
                    "CLI_CONTROL_OUTPUT")
            require(process.returncode == 0, "CLI_CONTROL_COMMAND")
            output.seek(0)
            return output.read(2 * 1024**2)
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=1)


def cli_storage_observation(config, images, uid, *, deadline, environment, daemon_identity, owner=None):
    """Independent Docker identities and paths, without consuming CLI observations."""
    require(type(uid) is int and uid > 0, "CLI_CONTROL_OWNER")
    require(os.geteuid() == uid if owner is None else type(owner) is dict
            and type(owner.get("uid")) is int and owner["uid"] == uid, "CLI_CONTROL_OWNER")
    def read(args):
        # Docker may execute plugin metadata from operator HOME even for info.
        return cli_control_command(["docker", *args], deadline=min(deadline, time.monotonic() + 8),
                                   environment=environment, cwd="/", owner=owner)
    daemon = json.loads(read(["info", "--format", '{"id":{{json .ID}},"root":{{json .DockerRootDir}}}']))
    require(type(daemon) is dict and type(daemon.get("id")) is str and type(daemon.get("root")) is str
            and Path(daemon["root"]).is_absolute(), "CLI_READ_STORAGE")
    require(type(daemon_identity) is str and HEX64.fullmatch(daemon_identity)
            and hashlib.sha256(daemon["id"].encode()).hexdigest() == daemon_identity,
            "CLI_READ_STORAGE")
    selected, paths = {}, {"application": str(INSTALL_ROOT), "backups": str(INSTALL_ROOT / "backups"), "docker": daemon["root"]}
    files = ",".join(switch_expected_files(config, uid))
    for service, destination in (("postgres", "/var/lib/postgresql/data"), ("minio", "/data")):
        ids = read(["ps", "-aq", "--no-trunc", "--filter", "label=com.docker.compose.project=" + config["project"],
                    "--filter", "label=com.docker.compose.service=" + service]).decode("ascii").split()
        require(len(ids) == 1 and HEX64.fullmatch(ids[0]), "CLI_READ_STORAGE")
        pattern = ('{"id":{{json .Id}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
            '"service":{{json (index .Config.Labels "com.docker.compose.service")}},'
            '"root":{{json (index .Config.Labels "com.docker.compose.project.working_dir")}},'
            '"files":{{json (index .Config.Labels "com.docker.compose.project.config_files")}},'
            '"oneoff":{{json (index .Config.Labels "com.docker.compose.oneoff")}},'
            '"image":{{json .Config.Image}},"mounts":{{json .Mounts}}}')
        record = json.loads(read(["inspect", "--format", pattern, ids[0]]))
        require(record.get("id") == ids[0] and record.get("project") == config["project"] == "asa-lab-dev"
                and record.get("service") == service and record.get("root") == str(INSTALL_ROOT)
                and record.get("files") == files and record.get("oneoff") in ("False", "false")
                and record.get("image") == ("postgres:17.7-bookworm" if service == "postgres" else images["minio"]),
                "CLI_READ_STORAGE")
        mounts = [row for row in record.get("mounts", []) if type(row) is dict and row.get("Destination") == destination]
        require(len(mounts) == 1 and mounts[0].get("Type") == "volume" and type(mounts[0].get("Source")) is str
                and Path(mounts[0]["Source"]).is_absolute() and ".." not in Path(mounts[0]["Source"]).parts,
                "CLI_READ_STORAGE")
        paths[service], selected[service] = mounts[0]["Source"], ids[0]
    return paths, selected


def cli_rows_projection(raw, identities):
    values = json.loads(raw)
    require(type(values) is dict and set(values) == {*TABLES, "project_drafts"}, "CLI_CONTROL_ROWS")
    rows = {}
    for table in (*TABLES, "project_drafts"):
        entries = values[table]
        ids = identities["projects" if table == "project_drafts" else table]
        key = "project_id" if table == "project_drafts" else "id"
        require(type(entries) is list and len(entries) == len(ids)
                and all(type(item) is dict and type(item.get(key)) is str for item in entries)
                and [item[key] for item in entries] == sorted(ids), "CLI_CONTROL_ROWS")
        rows[table] = {"rows": len(entries), "sha256": canonical_hash(entries)}
    return rows


def cli_s3_read(install, helpers, context, *, deadline):
    """Read one existing object; the labelled temporary client is outside the FS window."""
    nonce = uuid.uuid4().hex
    name = "asa-realhost-cli-read-" + nonce
    environment = {**install.process_env, "DOCKER_HOST": "unix:///var/run/docker.sock"}
    def read(args, *, cleanup=False):
        limit = deadline if cleanup else deadline - 8
        return cli_control_command(args, deadline=min(limit, time.monotonic() + (3 if cleanup else 12)),
                                   environment=environment, cwd=INSTALL_ROOT)
    def ids(cleanup=False):
        raw = read(["docker", "ps", "-aq", "--no-trunc", "--filter", "name=^/" + name + "$"], cleanup=cleanup)
        values = raw.decode("ascii").split()
        require(len(values) <= 1 and all(HEX64.fullmatch(value) for value in values), "CLI_CONTROL_CLEANUP")
        return values
    require(not ids(), "CLI_CONTROL_CLEANUP")
    attempted, failure = False, None
    try:
        attempted = True
        prefix = 'mc alias set local http://minio:9000 "$ASA_OBJECT_STORAGE_ACCESS_KEY" "$ASA_OBJECT_STORAGE_SECRET_KEY" >/dev/null; '
        command = prefix + 'mc cat "local/$ASA_OBJECT_STORAGE_BUCKET/' + helpers.OBJECT_NAME + '"'
        raw = read([*install.compose_args, "run", "--rm", "--no-deps", "--name", name,
                    "--label", "asa.realhost.control-read=" + nonce, "--entrypoint", "/bin/sh", "minio-init", "-eu", "-c", command])
        require(raw == helpers.OBJECT_CONTENT.encode(), "CLI_CONTROL_OBJECT")
        return raw
    except BaseException as error:
        failure = error
        raise
    finally:
        if attempted:
            try:
                remaining = ids(cleanup=True)
                if remaining:
                    pattern = ('{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Config.Image}},'
                        '"nonce":{{json (index .Config.Labels "asa.realhost.control-read")}},'
                        '"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
                        '"root":{{json (index .Config.Labels "com.docker.compose.project.working_dir")}}}')
                    record = json.loads(read(["docker", "inspect", "--format", pattern, remaining[0]], cleanup=True))
                    require(record == {"id": remaining[0], "name": "/" + name,
                        "image": context["cliReleaseExpectations"]["previous"]["images"]["minio"],
                        "nonce": nonce, "project": "asa-lab-dev", "root": str(INSTALL_ROOT)}, "CLI_CONTROL_CLEANUP")
                    read(["docker", "rm", "-f", remaining[0]], cleanup=True)
                    require(not ids(cleanup=True), "CLI_CONTROL_CLEANUP")
            except BaseException:
                if failure is None:
                    raise
                failure.owned_cleanup_failed = True


def owner_cli_control(context, deadline):
    require(os.geteuid() != 0 and type(deadline) in (int, float) and math.isfinite(deadline)
            and 0 < deadline - time.monotonic() <= CLI_CONTROL_SECONDS, "CLI_CONTROL_DEADLINE")
    config_module, _, _, installation, helpers = product_modules(context)
    config = config_module.load_config(INSTALL_ROOT, os.geteuid())
    install = installation(INSTALL_ROOT, config["profile"])  # Files only; no wait_ready or browser.
    prepared = json.loads(cli_trusted_bytes(GUEST_HOME / "cli-control-context.json"))
    require(prepared.get("format") == "asa-realhost-cli-control-v1" and prepared.get("sourceRevision") == context["sourceRevision"]
            and type(prepared.get("operatorUid")) is int and prepared["operatorUid"] == os.geteuid(), "CLI_CONTROL_OWNER")
    saved = config_module.private_json(INSTALL_ROOT / ".asa/realhost-control-proof.json")
    identities = saved.get("ids")
    require(type(identities) is dict and set(identities) == set(TABLES), "CLI_CONTROL_IDS")
    for table in TABLES:
        ids = identities[table]
        require(type(ids) is list and 0 < len(ids) <= 100 and len(set(ids)) == len(ids)
                and all(type(value) is str and UUID.fullmatch(value) for value in ids), "CLI_CONTROL_IDS")
    environment = {**install.process_env, "DOCKER_HOST": "unix:///var/run/docker.sock"}
    _, containers = cli_storage_observation(config, context["cliReleaseExpectations"]["previous"]["images"], os.geteuid(),
        deadline=deadline - 10, environment=environment, daemon_identity=prepared.get("daemonIdentitySha256"))
    expressions = []
    for table in (*TABLES, "project_drafts"):
        key = "project_id" if table == "project_drafts" else "id"
        ids = identities["projects" if table == "project_drafts" else table]
        where = ",".join("'" + value + "'" for value in sorted(ids))
        expressions.append("'" + table + "',(SELECT COALESCE(json_agg(to_jsonb(t) ORDER BY t." + key
            + "::text),'[]'::json) FROM public." + table + " t WHERE t." + key + "::text IN (" + where + "))")
    statement = ("SELECT json_build_object(" + ",".join(expressions) + ");\n").encode()
    milliseconds = max(1, min(15000, int((deadline - time.monotonic() - 10) * 1000)))
    raw = cli_control_command(["docker", "exec", "-i", "-e",
        "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=" + str(milliseconds),
        containers["postgres"], "psql", "-XAtq", "-v", "ON_ERROR_STOP=1", "-U", install.env["POSTGRES_USER"],
        "-d", install.env["POSTGRES_DB"]], source=statement, environment=environment, deadline=deadline - 10)
    rows = cli_rows_projection(raw, identities)
    require(rows == saved.get("fingerprint", {}).get("rows"), "CLI_CONTROL_ROWS_CHANGED")
    content = cli_s3_read(install, helpers, context, deadline=deadline)
    digest = hashlib.sha256(content).hexdigest()
    require(digest == saved["fingerprint"].get("authenticatedS3Sha256"), "CLI_CONTROL_OBJECT_CHANGED")
    require(time.monotonic() < deadline, "CLI_CONTROL_TIMEOUT")
    return {"operatorUid": os.geteuid(), "control": {"databaseSha256": canonical_hash(rows),
        "databaseRows": sum(row["rows"] for row in rows.values()), "objectsSha256": digest,
        "objectCount": 1, "objectBytes": len(content)}}


def cli_control_snapshot(owner, phase, deadline):
    remaining = deadline - time.monotonic()
    require(phase in ("before", "after") and 20 < remaining <= CLI_CONTROL_SECONDS, "CLI_CONTROL_DEADLINE")
    environment = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "HOME": owner["home"], "USER": owner["name"],
                   "LOGNAME": owner["name"], "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "PYTHONDONTWRITEBYTECODE": "1"}
    command = ["/usr/bin/python3", "-I", "-B", GUEST_HOME / "runner.py",
               "--guest-phase", "owner-cli-control", "--control-deadline", repr(deadline - 16)]
    # The existing process guard holds the leader unreaped and checks all
    # descendants. Reserve its complete cleanup budget inside the 60 s limit.
    with OwnedFaultProcess(command, environment=environment, deadline=deadline - 12, owner=owner) as child:
        code, raw = child.wait(max(0.1, deadline - time.monotonic() - 12))
    require(time.monotonic() < deadline and code == 0, "CLI_CONTROL_CALLBACK")
    value = json.loads(raw)
    require(type(value) is dict and set(value) == {"format", "phase", "status", "operatorUid", "control", "cliActions"}
            and value["format"] == "asa-realhost-guest-v1" and value["phase"] == "owner-cli-control"
            and value["status"] == "PASS" and type(value["operatorUid"]) is int
            and value["operatorUid"] == owner["uid"] and value["cliActions"] == [], "CLI_CONTROL_CALLBACK")
    proof = value["control"]
    require(type(proof) is dict and set(proof) == {"databaseSha256", "databaseRows", "objectsSha256", "objectCount", "objectBytes"},
            "CLI_CONTROL_CALLBACK")
    for name in ("databaseSha256", "objectsSha256"):
        require(type(proof[name]) is str and HEX64.fullmatch(proof[name]), "CLI_CONTROL_CALLBACK")
    for name in ("databaseRows", "objectCount", "objectBytes"):
        require(type(proof[name]) is int and 0 <= proof[name] <= 2**63 - 1, "CLI_CONTROL_CALLBACK")
    return {name: proof[name] for name in ("databaseSha256", "databaseRows", "objectsSha256", "objectCount", "objectBytes")}


def installed_cli_read_guest(context):
    require(os.geteuid() == 0, "GUEST_ROOT_REQUIRED")
    require(json.loads(cli_trusted_bytes(GUEST_HOME / "context.json")) == context, "CLI_READ_TRUST")
    verifier = cli_trusted_module("setup_bundle.py", context)
    binding = cli_candidate_binding(context, verifier)
    checks = cli_trusted_module("realhost_cli_checks.py", context)
    runtime = cli_trusted_module("realhost_cli_runtime.py", context)
    owner, environment = diagnostic_owner(context)
    inputs = cli_context_inputs(owner)
    daemon_identity = root_json("host-baseline.json")["daemonIdentitySha256"]
    paths, _ = cli_storage_observation(inputs["config"], context["cliReleaseExpectations"]["previous"]["images"], owner["uid"],
        deadline=time.monotonic() + 60, environment={**environment, "DOCKER_HOST": "unix:///var/run/docker.sock"},
        daemon_identity=daemon_identity, owner=owner)
    expected, snapshot_at = cli_fixture_context(checks, context, owner, inputs, paths)
    expectations = runtime.RuntimeExpectations(owner["uid"], snapshot_at)
    prepared_path = GUEST_HOME / "cli-control-context.json"
    require(not prepared_path.exists() and not prepared_path.is_symlink(), "CLI_CONTROL_ALREADY_PREPARED")
    write_json(prepared_path, {"format": "asa-realhost-cli-control-v1", "sourceRevision": context["sourceRevision"],
        "operatorUid": owner["uid"], "daemonIdentitySha256": daemon_identity}, mode=0o644)
    token = guest_environment().get("GH_TOKEN")
    try:
        evidence = runtime.run_cli_suite(expected, expectations, checker=checks.check_read_result,
            control_snapshot=lambda phase, deadline: cli_control_snapshot(owner, phase, deadline),
            tokens={"GH_TOKEN": token} if token else None, timeout=CLI_READ_SECONDS)
    except runtime.CLIRuntimeError as error:
        return {"status": "FAIL", "reasonCode": error.code, "cliReadBinding": binding, "cliReadEvidence": error.evidence}
    require(len(evidence.get("cases", [])) == 29 and set(evidence.get("bare", {})) == {"pipe", "pty"}, "CLI_READ_CASE_COUNT")
    return {"status": "PASS", "cliReadBinding": binding, "cliReadEvidence": evidence,
            "publicProcessCases": 31, "controlScope": "INDEPENDENT_SEEDED_ROWS_AND_ONE_AUTHENTICATED_S3_OBJECT"}


def command_diagnostic_error(error):
    code = getattr(error, "code", None)
    result = {"status": "UNAVAILABLE", "binding": "UNVERIFIED", "observation": "AFTER_PUBLIC_FAILURE",
            "observedAt": now(), "reasonCode": code if isinstance(code, str) and code in COMMAND_DIAGNOSTIC_ERRORS
            else "DIAGNOSTIC_UNAVAILABLE", "errorClass": diagnostic_error(error)}
    observed = switch_command_projection(getattr(error, "docker_observation", None))
    if observed:
        result["failedObservation"] = observed
    return result


def diagnostic_open(path, base, uid, *, directory=False):
    """Pin every component with openat; read only ordinary owner-private files."""
    path, base = Path(path), Path(base)
    require(path.is_absolute() and base.is_absolute() and base != Path("/") and ".." not in path.parts
            and ".." not in base.parts and path.is_relative_to(base), "DIAGNOSTIC_PATH")
    descriptor = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        current = Path("/")
        for index, part in enumerate(path.parts[1:]):
            current /= part
            is_directory = index < len(path.parts) - 2 or directory
            flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | (os.O_DIRECTORY if is_directory else 0)
            child = os.open(part, flags, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
            info = os.fstat(descriptor)
            inside = current.is_relative_to(base)
            if is_directory:
                # Sticky /tmp is needed by native unit fixtures, never by guest paths.
                sticky_ancestor = not inside and info.st_uid == 0 and bool(info.st_mode & stat.S_ISVTX)
                require(stat.S_ISDIR(info.st_mode) and info.st_uid == (uid if inside else 0)
                        and (not info.st_mode & 0o022 or sticky_ancestor)
                        and (not inside or current == base == INSTALL_ROOT or not info.st_mode & 0o077), "DIAGNOSTIC_PERMISSIONS")
            else:
                require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == uid
                        and stat.S_IMODE(info.st_mode) == 0o600, "DIAGNOSTIC_PERMISSIONS")
        result, descriptor = descriptor, None
        return result
    finally:
        if descriptor is not None:
            os.close(descriptor)


def diagnostic_metadata(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def diagnostic_read(path, base, uid, *, maximum=2 * 1024**2, offset=0, tail=None, identity=None):
    descriptor = diagnostic_open(path, base, uid)
    try:
        before = os.fstat(descriptor)
        require(type(offset) is int and 0 <= offset <= before.st_size <= maximum, "DIAGNOSTIC_SIZE")
        require(identity is None or diagnostic_metadata(before)[:2] == identity[:2], "DIAGNOSTIC_CHANGED")
        start = max(offset, before.st_size - tail) if tail is not None else offset
        partial_line = start > offset or (offset > 0 and os.pread(descriptor, 1, offset - 1) != b"\n")
        os.lseek(descriptor, start, os.SEEK_SET)
        remaining, chunks = before.st_size - start, []
        while remaining:
            chunk = os.read(descriptor, min(65536, remaining))
            require(chunk, "DIAGNOSTIC_CHANGED")
            chunks.append(chunk)
            remaining -= len(chunk)
        require(diagnostic_metadata(before) == diagnostic_metadata(os.fstat(descriptor)), "DIAGNOSTIC_CHANGED")
        raw = b"".join(chunks)
        if partial_line:
            raw = raw.partition(b"\n")[2]  # Never classify a partial first line.
        return raw, before, start > offset
    finally:
        os.close(descriptor)


def command_log_baseline(words):
    """Metadata only before the public call; a failed observation cannot block it."""
    if " ".join(words) not in COMMAND_DIAGNOSTIC_MODES:
        return {"status": "NOT_REQUIRED"}
    try:
        owner, _ = diagnostic_owner(guest_guard())
        folder = INSTALL_ROOT / ".asa/setup-logs"
        try:
            descriptor = diagnostic_open(folder, INSTALL_ROOT, owner["uid"], directory=True)
        except FileNotFoundError:
            return {"status": "OBSERVED", "entries": {}}
        try:
            entries, deadline = {}, time.monotonic() + 5
            with os.scandir(descriptor) as iterator:
                for count, entry in enumerate(iterator):
                    require(count < 512 and time.monotonic() < deadline, "DIAGNOSTIC_SIZE")
                    if re.fullmatch(r"[a-f0-9]{32}\.log", entry.name):
                        info = entry.stat(follow_symlinks=False)
                        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == owner["uid"]
                                and stat.S_IMODE(info.st_mode) == 0o600, "DIAGNOSTIC_PERMISSIONS")
                        entries[entry.name] = diagnostic_metadata(info)
            return {"status": "OBSERVED", "entries": entries}
        finally:
            os.close(descriptor)
    except BaseException as error:
        return command_diagnostic_error(error)


def receipt_choice(value, allowed):
    return value if type(value) is str and value in allowed else "UNAVAILABLE" if value is None else "UNRECOGNIZED"


def receipt_reason(record, key, allowed):
    """Preserve presence/type, never the unrecognized private value."""
    if not isinstance(record, dict) or key not in record:
        return {"state": "MISSING"}
    value = record[key]
    if value is None:
        return {"state": "NULL"}
    if type(value) is not str:
        return {"state": "UNRECOGNIZED", "type": "NON_STRING"}
    if value not in allowed:
        return {"state": "UNRECOGNIZED", "type": "STRING"}
    return {"state": "RECOGNIZED", "code": value}


def receipt_browser_projection(config, journal, receipt, pins, selected):
    """Project only this operation's stage evidence; no new runtime observation."""
    site = receipt.get("site") if isinstance(receipt.get("site"), dict) else {}
    browser, technical = site.get("browser"), site.get("technical")
    stages = journal.get("stages") if isinstance(journal.get("stages"), dict) else {}
    stage = stages.get("browser")
    unavailable = {"binding": "UNAVAILABLE"}
    if not isinstance(browser, dict) or not isinstance(technical, dict) or not isinstance(stage, dict):
        return unavailable
    instance = browser.get("instanceId")
    if not (browser.get("format") == technical.get("format") == "asa-setup-acceptance-v1"
            and browser.get("kind") == "browser" and technical.get("kind") == "technical"
            and browser.get("operationId") == technical.get("operationId") == receipt["operationId"]
            and browser.get("installationId") == receipt["installationId"]
            and type(instance) is str and re.fullmatch(r"[a-f0-9]{32}", instance)
            and technical.get("instanceId") == technical.get("installationId") == instance
            and technical.get("status") == "passed" and selected.get("status") == "CONFIRMED"
            and technical.get("revision") == selected["revision"]
            and type(technical.get("schema")) is int and technical["schema"] == selected["schema"]
            and stage.get("status") == "done" and isinstance(stage.get("evidence"), dict)
            and canonical_hash(stage["evidence"]) == canonical_hash(browser)):
        return unavailable
    runtime_keys = ("revision", "entryOrigin", "invocationId", "componentSha256", "componentRevision")
    status = receipt_choice(browser.get("status"), {"passed", "failed", "incomplete", "environment_failed"})
    checks = browser.get("checks") if isinstance(browser.get("checks"), dict) else {}
    projected_checks = {key: receipt_choice(checks.get(key), {"passed", "failed", "not_run"}) for key in RECEIPT_BROWSER_CHECKS}
    provenance = "NOT_RECORDED"
    if any(key in browser for key in runtime_keys):
        pin, configured = pins.get("browser"), config.get("browser")
        if not (isinstance(pin, dict) and isinstance(configured, dict)
                and all(key in browser for key in runtime_keys)
                and type(pin.get("componentSha256")) is str and re.fullmatch(r"[a-f0-9]{64}", pin["componentSha256"])
                and type(pin.get("opsRevision")) is str and re.fullmatch(r"[a-f0-9]{40}", pin["opsRevision"])
                and browser.get("revision") == selected["revision"]
                and type(config.get("entryOrigin")) is str and browser.get("entryOrigin") == config["entryOrigin"] == technical.get("entryOrigin")
                and type(browser.get("invocationId")) is str and re.fullmatch(r"[a-f0-9]{32}", browser["invocationId"])
                and browser.get("componentSha256") == configured.get("componentSha256") == pin.get("componentSha256")
                and browser.get("componentRevision") == pin.get("opsRevision")):
            return unavailable
        provenance = "PINNED_INVOCATION"
    if status in ("passed", "failed"):
        if provenance != "PINNED_INVOCATION" or set(checks) != set(RECEIPT_BROWSER_CHECKS) or any(value not in ("passed", "failed") for value in projected_checks.values()):
            return unavailable
        if ((status == "passed") != all(value == "passed" for value in projected_checks.values())
                or status == "passed" and (browser.get("error") is not None or browser.get("reasonCode") is not None)):
            return unavailable
    elif any(value in ("passed", "failed") for value in projected_checks.values()):
        return unavailable
    error = browser.get("error")
    error_projection = {"state": "MISSING" if "error" not in browser else "NULL" if error is None else "UNRECOGNIZED"}
    if isinstance(error, dict):
        error_projection = {"stage": receipt_choice(error.get("stage"), RECEIPT_BROWSER_STAGES),
                            "code": receipt_reason(error, "code", RECEIPT_BROWSER_ERRORS)}
        code = error.get("code")
        if type(code) is str and re.fullmatch(r"API_STATUS_[1-5][0-9]{2}", code):
            error_projection["code"] = {"state": "RECOGNIZED", "code": "API_STATUS", "httpStatus": int(code[-3:])}
    return {"binding": "VERIFIED_PARENT_OPERATION", "runtimeProvenance": provenance, "status": status,
            "reason": receipt_reason(browser, "reasonCode", RECEIPT_BROWSER_REASONS),
            "checks": projected_checks, "error": error_projection}


def receipt_backup_projection(journal, receipt):
    """Parent evidence or an explicitly named first-backup child; never adopt IDs."""
    backup = receipt.get("backup")
    stages = journal.get("stages") if isinstance(journal.get("stages"), dict) else {}
    mode = receipt["mode"]
    stage = stages.get("first_backup" if mode == "install" else "backup")
    unavailable = {"binding": "UNAVAILABLE"}
    if mode not in ("install", "update", "backup") or not isinstance(backup, dict) or not isinstance(stage, dict):
        return unavailable
    expected_id, binding = receipt["operationId"], "VERIFIED_PARENT_OPERATION"
    if mode == "install" and "backupOperationId" in stage:
        child = stage["backupOperationId"]
        if type(child) is not str or not re.fullmatch(r"[a-f0-9]{32}", child):
            return unavailable
        expected_id = child
        if child != receipt["operationId"]:
            binding = "DECLARED_FIRST_BACKUP_CHILD"
    evidence, policy = stage.get("evidence"), journal.get("backupPolicy")
    snapshot = backup.get("snapshotId")
    if not (backup.get("format") == "asa-backup-operation-v1" and backup.get("operationId") == expected_id
            and backup.get("installationId") == receipt["installationId"]
            and type(snapshot) is str and re.fullmatch(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}", snapshot)
            and ("snapshotId" not in stage or stage["snapshotId"] == snapshot)
            and stage.get("status") == "done" and isinstance(evidence, dict) and isinstance(policy, dict)
            and backup.get("policy") == policy.get("policy")):
        return unavailable
    # finalize adds row/schedule/restore summaries and may normalize a missing
    # local snapshot. All remaining already-read stage/receipt bytes must agree.
    expected = {key: value for key, value in evidence.items() if key not in ("status", "restore", "schedule")}
    actual = {key: value for key, value in backup.items() if key not in ("status", "restore", "schedule")}
    local = expected.get("local")
    if isinstance(local, dict) and local.get("error") == "BACKUP_RESUME_SNAPSHOT_MISSING":
        never_started = (local.get("executionStatus") == "NOT_RUN" and not local.get("previouslyVerified")
                         and not expected.get("snapshotAt") and not any(local.get(key) for key in ("verifiedAt", "manifestSha256")))
        expected["local"] = {**local, "status": "NOT_RUN" if never_started else "FAILED"}
    if canonical_hash(actual) != canonical_hash(expected):
        return unavailable
    result = {"binding": binding, "policy": receipt_choice(backup.get("policy"), {"best-effort", "required"}),
              "outcome": receipt_choice(backup.get("outcome"), {"PENDING", "ACCEPTED", "WARNING", "BLOCKED", "ERROR"})}
    for name, allowed in (("local", {"PENDING", "OK", "FAILED", "NOT_RUN"}),
                          ("encryption", {"PENDING", "NOT_CONFIGURED", "PREPARED", "OK", "FAILED"}),
                          ("cloud", {"PENDING", "NOT_CONFIGURED", "OK", "FAILED"})):
        component = backup.get(name) if isinstance(backup.get(name), dict) else {}
        result[name] = {"status": receipt_choice(component.get("status"), allowed),
                       "error": receipt_reason(component, "error", RECEIPT_BACKUP_ERRORS),
                       "reason": receipt_reason(component, "reasonCode", RECEIPT_BACKUP_ERRORS)}
    errors = backup.get("errors")
    result["errors"] = ({"state": "OBSERVED", "codes": [receipt_reason(item, "code", RECEIPT_BACKUP_ERRORS)
                        if isinstance(item, dict) else {"state": "UNRECOGNIZED", "type": "NON_OBJECT"}
                        for item in errors[:16]], "truncated": len(errors) > 16}
                        if isinstance(errors, list) else {"state": "UNAVAILABLE" if errors is None else "UNRECOGNIZED"})
    return result


def command_operation_projection(public, config, journal, receipt, pins, *, mode, code, uid):
    """Closed schema after IDs, mode and the complete current receipt agree."""
    require(type(uid) is int and uid > 0 and mode in COMMAND_DIAGNOSTIC_MODES.values()
            and type(code) is int and code in (0, 1, 2, 130), "DIAGNOSTIC_BINDING")
    require(all(isinstance(item, dict) for item in (public, config, journal, receipt)), "DIAGNOSTIC_BINDING")
    operation = public.get("operation")
    require(isinstance(operation, dict), "DIAGNOSTIC_BINDING")
    ids = {key: operation.get(key) for key in ("operationId", "installationId")}
    require(all(isinstance(value, str) and re.fullmatch(r"[a-f0-9]{32}", value) for value in ids.values()), "DIAGNOSTIC_BINDING")
    require(config.get("format") == "asa-setup-config-v1" and config.get("root") == str(INSTALL_ROOT)
            and type(config.get("operatorUid")) is int and config["operatorUid"] == uid
            and config.get("installationId") == ids["installationId"], "DIAGNOSTIC_BINDING")
    require(journal.get("format") == "asa-setup-operation-v1" and journal.get("root") == str(INSTALL_ROOT)
            and receipt.get("format") == "asa-setup-result-v1"
            and all(journal.get(key) == value == receipt.get(key) for key, value in ids.items())
            and journal.get("mode") == receipt.get("mode") == mode
            and type(receipt.get("exitCode")) is int and -128 <= receipt["exitCode"] <= 255
            and type(public.get("managerExitCode")) is int and receipt["exitCode"] == public["managerExitCode"]
            and public.get("exitCode") == code and operation.get("outcome") == receipt.get("outcome")
            and operation.get("reasonCode") == receipt.get("reasonCode")
            and isinstance(journal.get("result"), dict) and canonical_hash(journal["result"]) == canonical_hash(receipt),
            "DIAGNOSTIC_BINDING")
    def choice(value, allowed, fallback):
        return value if isinstance(value, str) and value in allowed else fallback
    projected = {"status": "OBSERVED", "binding": "VERIFIED", "observation": "AFTER_PUBLIC_FAILURE", "observedAt": now(),
        **ids, "mode": mode, "publicExitCode": code, "managerExitCode": receipt["exitCode"],
        "journalPhase": choice(journal.get("phase"), COMMAND_DIAGNOSTIC_STAGES, "UNRECOGNIZED_STAGE"),
        "receiptStage": choice(receipt.get("stage"), COMMAND_DIAGNOSTIC_STAGES, "UNRECOGNIZED_STAGE"),
        "journalState": choice(journal.get("state"), {"RUNNING", "TERMINAL", "VERIFY_ONLY", "RECOVERY_REQUIRED"}, "UNVERIFIED"),
        "reasonCode": choice(receipt.get("reasonCode"), COMMAND_DIAGNOSTIC_REASONS, "UNRECOGNIZED_REASON"),
        "outcome": choice(receipt.get("outcome"), COMMAND_DIAGNOSTIC_OUTCOMES, "UNVERIFIED"), "stages": {},
        "selectedRelease": {"status": "NOT_CONFIRMED"}, "acceptance": {}}
    stages = journal.get("stages") if isinstance(journal.get("stages"), dict) else {}
    for name in COMMAND_DIAGNOSTIC_STAGES:
        if isinstance(stages.get(name), dict):
            projected["stages"][name] = choice(stages[name].get("status"), {"intent", "done", "failed"}, "UNRECOGNIZED_STATUS")
    projected["unrecognizedStageCount"] = sum(key not in COMMAND_DIAGNOSTIC_STAGES for key in stages)
    selected = journal.get("release") if isinstance(journal.get("release"), dict) else {}
    for name in ("previous", "current"):
        pin = pins[name]
        if (projected["stages"].get("release") == "done" and stages["release"].get("revision") == pin["revision"]
                and selected.get("revision") == pin["revision"] and type(selected.get("schema")) is int
                and selected["schema"] == pin["schema"]):
            projected["selectedRelease"] = {"status": "CONFIRMED", "pin": name, "revision": pin["revision"], "schema": pin["schema"]}
            if journal.get("requestedDeploymentDigest") == pin["deploymentDigest"]:
                projected["selectedRelease"]["deploymentDigest"] = pin["deploymentDigest"]
    for key in ("applicationAccepted", "dataProtectionConfirmed", "actionExecuted", "executionCompleted"):
        if type(receipt.get(key)) is bool:
            projected["acceptance"][key] = receipt[key]
    site = receipt.get("site") if isinstance(receipt.get("site"), dict) else {}
    for name in ("technical", "browser", "owner"):
        if isinstance(site.get(name), dict):
            projected["acceptance"][name + "Completed"] = site[name].get("status") == ("READY" if name == "owner" else "passed")
    backup = receipt.get("backup") if isinstance(receipt.get("backup"), dict) else {}
    local = backup.get("local") if isinstance(backup.get("local"), dict) else {}
    projected["acceptance"]["firstBackupCompleted"] = projected["stages"].get("first_backup") == "done" and local.get("status") == "OK"
    projected["receiptDetails"] = {
        "topReason": receipt_reason(receipt, "reasonCode", COMMAND_DIAGNOSTIC_REASONS),
        "rows": {name: receipt_choice(receipt[name].get("status") if isinstance(receipt.get(name), dict) else None,
                                      RECEIPT_ROW_STATUSES) for name in RECEIPT_ROWS},
        "browser": receipt_browser_projection(config, journal, receipt, pins, projected["selectedRelease"]),
        "backup": receipt_backup_projection(journal, receipt)}
    return projected


def command_log_classification(raw, phase):
    """Recognize fixed producer forms; never return matched text or infer codes."""
    rules, exits, http = set(), set(), set()
    for line in raw.decode("utf-8", errors="replace").splitlines():
        if len(line) > 8192:
            continue
        if phase in ("release", "images"):
            if line.startswith("Cannot connect to the Docker daemon at ") and line.endswith(". Is the docker daemon running?"):
                rules.add("DOCKER_DAEMON_UNAVAILABLE")
            if line.startswith("permission denied while trying to connect to the Docker daemon socket at "):
                rules.add("DOCKER_DAEMON_PERMISSION")
            if line.startswith("Error response from daemon: "):
                detail = line[len("Error response from daemon: "):]
                if detail.startswith(("unauthorized:", "denied:", "pull access denied for ")):
                    rules.add("REGISTRY_ACCESS_DENIED")
                if detail.startswith(('Head "https://ghcr.io/', 'Get "https://ghcr.io/')) and detail.endswith((": unauthorized", ": denied")):
                    rules.add("REGISTRY_ACCESS_DENIED")
                if detail.startswith(("manifest unknown", "manifest for ")) and "manifest unknown" in detail:
                    rules.add("REGISTRY_MANIFEST_UNAVAILABLE")
                if '"https://ghcr.io/' in detail:
                    if "dial tcp: lookup ghcr.io" in detail:
                        rules.add("REGISTRY_DNS_FAILURE")
                    if "tls: failed to verify certificate:" in detail or "x509: certificate" in detail:
                        rules.add("REGISTRY_TLS_FAILURE")
                    match = re.search(r": (400|401|403|404|405|408|409|413|429|500|502|503|504) [A-Za-z ]+\Z", detail)
                    if match and detail.startswith(("unexpected status from ", "received unexpected HTTP status:")):
                        rules.add("REGISTRY_HTTP_FAILURE")
                        http.add(int(match.group(1)))
        for tool, verb, stages, rule in (("docker", "pull", ("release", "images"), "DOCKER_PULL_EXIT"),
                ("git", "fetch", ("source",), "SOURCE_FETCH_EXIT"),
                ("docker", "compose", ("images", "switch", "preflight"), "COMPOSE_EXIT")):
            match = re.fullmatch(re.escape(tool + " " + verb) + r" failed \(exit (-?[0-9]{1,3})\)\.", line)
            if match and phase in stages and -128 <= int(match.group(1)) <= 255:
                rules.add(rule)
                exits.add(int(match.group(1)))
    native = compose_error_projection(raw) if phase == "switch" else None
    return {"status": "OBSERVED" if rules or native and native["ruleIds"] else "NO_MATCH", "ruleIds": sorted(rules),
            "exitCodes": sorted(exits), "httpStatusCodes": sorted(http),
            **({"nativeCompose": native, "scope": "PUBLIC_INVOCATION_MULTI_STAGE",
                "causalProof": False} if phase == "switch" else {})}


def daemon_error_rules(detail):
    rules = set()
    if "port is already allocated" in detail or "bind: address already in use" in detail:
        rules.add("DAEMON_PORT_BIND_FAILURE")
    for phrase, rule in (("failed to create task for container", "DAEMON_CONTAINER_TASK_FAILURE"),
            ("failed to set up container networking", "DAEMON_CONTAINER_NETWORK_FAILURE"),
            ("invalid mount config", "DAEMON_MOUNT_CONFIGURATION")):
        if phrase in detail:
            rules.add(rule)
    return rules


def compose_error_projection(raw):
    """Native Compose/daemon forms are observations, never inferred switch causes."""
    rules, services = set(), {}
    for original in raw.decode("utf-8", "replace").splitlines():
        if len(original) > 8192:
            continue
        line = re.sub(r"\x1b\[[0-9;]*m", "", original).strip()
        match = re.fullmatch(r'service "([a-z-]+)" didn\x27t complete successfully: exit ([0-9]{1,3})', line)
        if match and match[1] in SWITCH_SERVICES and 1 <= int(match[2]) <= 255:
            rules.add("COMPOSE_SERVICE_EXIT")
            services[match[1]] = int(match[2])
        if re.fullmatch(r"dependency failed to start: container [A-Za-z0-9_.-]{1,200} is unhealthy", line):
            rules.add("COMPOSE_DEPENDENCY_UNHEALTHY")
        if line.startswith("Error response from daemon: "):
            rules.update(daemon_error_rules(line[len("Error response from daemon: "):]))
    return {"status": "OBSERVED" if rules else "NO_MATCH", "ruleIds": sorted(rules), "serviceExitCodes": services}


def timestamp_ns(value):
    require(isinstance(value, str), "DIAGNOSTIC_INVENTORY")
    match = re.fullmatch(r"([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(?:\.([0-9]{1,9}))?Z", value)
    require(match, "DIAGNOSTIC_INVENTORY")
    moment = dt.datetime.strptime(match[1], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=dt.timezone.utc)
    epoch = dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)
    return (moment - epoch).days * 86400 * 10**9 + (moment - epoch).seconds * 10**9 + int((match[2] or "").ljust(9, "0"))


def switch_node_error_projection(block):
    """One complete Node object; fields before its opening frame are not properties."""
    rules, codes = set(), set()
    if not block or not block[0].startswith(("error: ", "Error: ")):
        return rules, codes
    openings = [index for index, line in enumerate(block) if line.startswith("    at ") and line.endswith(" {")]
    if len(openings) != 1 or block[-1:] != ["}"]:
        return rules, codes
    opening = openings[0]
    prefix, properties = block[:opening + 1], block[opening + 1:-1]
    role = any(re.fullmatch(r"\s+at (?:async )?file:///app/docker/provision-runtime-role\.mjs:[0-9]+:[0-9]+(?: \{)?", line) for line in prefix)
    protocol = any(re.fullmatch(r"\s+at Parser\.parseErrorMessage \(/app/node_modules/(?:\.pnpm/pg-protocol@[0-9.]+/node_modules/)?pg-protocol/dist/parser\.js:[0-9]+:[0-9]+\)(?: \{)?", line) for line in prefix)
    if not (role or protocol) or any(re.match(r"\s+(?:code|severity)\s*:", line) for line in prefix):
        return rules, codes
    # Only Node's flat, one-line scalar properties are supported. Quoted braces
    # are data; nested indentation, containers and continuation lines are not.
    scalar = (r"(?:'(?:[^'\\\r\n]|\\[^\r\n])*'|"
              r'"(?:[^"\\\r\n]|\\[^\r\n])*"|'
              r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null|undefined)")
    for index, line in enumerate(properties):
        separator = "," if index + 1 < len(properties) else ",?"
        if not re.fullmatch(r"  [A-Za-z_$][A-Za-z0-9_$]*: " + scalar + separator, line):
            return rules, codes
    code_lines = [line for line in properties if re.match(r"\s+code\s*:", line)]
    severity_lines = [line for line in properties if re.match(r"\s+severity\s*:", line)]
    if len(code_lines) != 1 or len(severity_lines) > 1:
        return rules, codes
    code = re.fullmatch(r"\s+code: '([A-Z0-9]{5}|ECONNREFUSED)',?", code_lines[0])
    severity = re.fullmatch(r"\s+severity: '(ERROR|FATAL)',?", severity_lines[0]) if severity_lines else None
    if not code or severity_lines and not severity or code[1] != "ECONNREFUSED" and not severity:
        return rules, codes
    if role:
        rules.add("RUNTIME_ROLE_PROVISION_FAILURE")
    if code[1] == "ECONNREFUSED":
        rules.add("DATABASE_CONNECTION_REFUSED")
    else:
        rules.add("POSTGRES_SERVER_ERROR")
        if code[1] in SWITCH_SQLSTATES:
            codes.add(code[1])
    return rules, codes


def switch_api_lifecycle_projection(line, invocation):
    """Recognize the closed stderr lifecycle shape published by both pinned APIs."""
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError
            result[key] = value
        return result
    try:
        event = json.loads(line, object_pairs_hook=unique_object)
        if (type(event) is not dict or set(event) != {"kind", "level", "time", "phase", "errorCode", "errorClass"}
                or not all(type(value) is str for value in event.values())
                or event["kind"] != "api_lifecycle" or event["level"] != "error"
                or event["phase"] not in SWITCH_API_PHASE_RULES or event["errorCode"] not in SWITCH_API_ERROR_CODES
                or event["errorClass"] not in SWITCH_API_ERROR_CLASSES
                or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z", event["time"])
                or not invocation["startedNs"] <= timestamp_ns(event["time"]) <= invocation["finishedNs"]):
            return None
    except (ValueError, TypeError, RecursionError, Failure):
        return None
    return event["phase"], event["errorCode"], event["errorClass"]


def switch_log_projection(streams, service, invocation):
    """Parse each timestamped stream separately; never splice error-object fragments."""
    rules, sqlstates, api_lifecycle = set(), set(), set()
    require(service in SWITCH_SERVICES and sum(len(item) for item in streams) <= DIAGNOSTIC_LIMIT, "DIAGNOSTIC_OUTPUT_LIMIT")
    for stream_index, raw in enumerate(streams):
        lines = []
        for line in raw.decode("utf-8", "replace").splitlines():
            stamp, separator, content = line.partition(" ")
            try:
                within = invocation["startedNs"] <= timestamp_ns(stamp) <= invocation["finishedNs"]
            except (Failure, ValueError):
                within = False
            # A dropped or unframed line breaks the object, rather than joining
            # the valid fragments on either side into invented complete evidence.
            lines.append(content if len(line) <= 8192 and separator and within else None)
        for index, line in enumerate(lines):
            if line is None:
                continue
            if service == "api" and stream_index == 1:
                event = switch_api_lifecycle_projection(line, invocation)
                if event is not None:
                    rules.add(SWITCH_API_PHASE_RULES[event[0]])
                    api_lifecycle.add(event)
            if service == "migration":
                if line.startswith("db:migrate FAIL: "):
                    rules.add("MIGRATION_RUNNER_FAILURE")
                    message = line[len("db:migrate FAIL: "):]
                    for prefix, rule in (("password authentication failed for user ", "DATABASE_AUTHENTICATION_FAILURE"),
                            ("permission denied for ", "DATABASE_PRIVILEGE_FAILURE"),
                            ("connect ECONNREFUSED ", "DATABASE_CONNECTION_REFUSED")):
                        if message.startswith(prefix):
                            rules.add(rule)
                if line == "BLOCKED: MIGRATION_DATABASE_URL and MIGRATION_EXPECT_DATABASE are required; DATABASE_URL is never an implicit migration target.":
                    rules.add("MIGRATION_REQUIRED_INPUT_MISSING")
                if line.startswith("BLOCKED: migration URL targets ") or line.startswith("BLOCKED: set MIGRATION_CONFIRM exactly to "):
                    rules.add("MIGRATION_TARGET_ATTESTATION_FAILED")
                if line == "MIGRATION_DATABASE_URL and ASA_APP_DB_PASSWORD are required":
                    rules.add("RUNTIME_ROLE_REQUIRED_INPUT_MISSING")
                if line.startswith(("error: ", "Error: ")):
                    block = []
                    for item in lines[index:index + 48]:
                        if item is None or block and item.startswith(("error: ", "Error: ")):
                            break
                        block.append(item)
                        if item == "}":
                            break
                    observed_rules, observed_codes = switch_node_error_projection(block)
                    rules.update(observed_rules)
                    sqlstates.update(observed_codes)
            if service in ("minio", "minio-init") and line.startswith(("mc: <ERROR> ", "ERROR ", "Error: ")):
                if "Access Denied" in line or "Access denied" in line:
                    rules.add("OBJECT_STORAGE_ACCESS_DENIED")
                if "permission denied" in line or "Permission denied" in line:
                    rules.add("OBJECT_STORAGE_FILESYSTEM_PERMISSION")
                if "read-only file system" in line:
                    rules.add("OBJECT_STORAGE_READ_ONLY_FILESYSTEM")
    result = {"status": "OBSERVED" if rules else "NO_MATCH", "ruleIds": sorted(rules), "sqlstates": sorted(sqlstates),
            "readBytes": sum(len(item) for item in streams), "scope": "BOUND_CONTAINER_INVOCATION_LOG", "causalProof": False}
    if api_lifecycle:
        result["apiLifecycle"] = [{"phase": phase, "errorCode": code, "errorClass": error_class}
                                  for phase, code, error_class in sorted(api_lifecycle)]
    return result


def command_log_projection(path, base, uid, *, phase, offset=0, identity=None):
    raw, _, truncated = diagnostic_read(path, base, uid, maximum=64 * 1024**2, offset=offset,
                                        tail=128 * 1024, identity=identity)
    return {**command_log_classification(raw, phase), "readBytes": len(raw), "truncated": truncated}


def switch_expected_files(config, uid):
    require(config.get("profile") == "production", "DIAGNOSTIC_BINDING")
    files = ["compose.yaml", "compose.production.yaml"]
    for relative in (".asa/docker-networks.yaml", "compose.frp.yaml", ".asa/public-origins.yaml"):
        path = INSTALL_ROOT / relative
        try:
            info = path.lstat()
        except FileNotFoundError:
            continue
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == uid
                and not info.st_mode & 0o022, "DIAGNOSTIC_PERMISSIONS")
        if relative == ".asa/public-origins.yaml":
            raw, _, truncated = diagnostic_read(path, INSTALL_ROOT, uid, maximum=256)
            content = b'{"services":{"api":{"environment":{"ASA_PUBLIC_WEB_ORIGINS":""}}}}\n'
            require(not truncated and raw in (content, content.replace(b"\n", b"\r\n")), "DIAGNOSTIC_BINDING")
        files.append(relative)
    return [str(INSTALL_ROOT / name) for name in files]


def switch_image_references(config, journal):
    project = config.get("project")
    require(isinstance(project, str) and re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,127}", project)
            and journal.get("project") == project, "DIAGNOSTIC_BINDING")
    images = journal.get("release", {}).get("images")
    require(isinstance(images, dict) and set(images) == {"api", "web", "scratch", "minio", "search"}, "DIAGNOSTIC_BINDING")
    for name, ref in images.items():
        require(isinstance(ref, str) and re.fullmatch(re.escape("ghcr.io/" + REPOSITORY + "/" + name + "@sha256:")
                                                     + r"[a-f0-9]{64}", ref), "DIAGNOSTIC_BINDING")
    # Both pinned published compose.yaml revisions use this same PostgreSQL
    # reference; PostgreSQL is not a member of the ASA release image manifest.
    return {**images, "migration": images["api"], "minio-init": images["minio"], "postgres": "postgres:17.7-bookworm"}


def switch_bind_records(records, ids, config, files, images, invocation):
    require(isinstance(records, list) and len(records) == len(ids) <= len(SWITCH_SERVICES)
            and all(isinstance(row, dict) for row in records), "DIAGNOSTIC_INVENTORY")
    require({row.get("id") for row in records} == set(ids), "DIAGNOSTIC_INVENTORY")
    selected = {}
    for row in records:
        service = row.get("service")
        require(isinstance(service, str) and service in SWITCH_SERVICES and service not in selected
                and row.get("project") == config["project"] and row.get("root") == str(INSTALL_ROOT)
                and row.get("files") == ",".join(files) and row.get("oneoff") in ("False", "false")
                and row.get("image") == images[service], "DIAGNOSTIC_BINDING")
        require(isinstance(row.get("name"), str) and re.fullmatch(r"/[A-Za-z0-9_.-]{1,200}", row["name"])
                and isinstance(row.get("imageId"), str) and re.fullmatch(r"sha256:[a-f0-9]{64}", row["imageId"]), "DIAGNOSTIC_BINDING")
        require(invocation["startedNs"] <= timestamp_ns(row.get("created")) <= invocation["finishedNs"], "DIAGNOSTIC_BINDING")
        require(isinstance(row.get("state"), str) and row["state"] in SWITCH_STATES
                and row.get("health") in ("none", "starting", "healthy", "unhealthy")
                and all(type(row.get(key)) is bool for key in ("running", "dead", "oomKilled"))
                and type(row.get("exitCode")) is int and 0 <= row["exitCode"] <= 255
                and type(row.get("restarts")) is int and 0 <= row["restarts"] <= 1_000_000
                and isinstance(row.get("error"), str) and len(row["error"]) <= 8192, "DIAGNOSTIC_INVENTORY")
        timestamp_ns(row.get("started"))
        timestamp_ns(row.get("finished"))
        selected[service] = row
    return selected


def switch_identity(records):
    keys = ("id", "name", "created", "image", "imageId", "project", "service", "root", "files", "oneoff")
    return {name: {key: row[key] for key in keys} for name, row in records.items()}


def switch_state_projection(row, invocation):
    value = {key: row[key] for key in ("state", "running", "dead", "oomKilled", "health", "restarts")}
    value.update(containerExitCode=row["exitCode"], processExited=row["state"] in ("exited", "dead", "restarting"),
        startedDuringInvocation=invocation["startedNs"] <= timestamp_ns(row["started"]) <= invocation["finishedNs"],
        finishedDuringInvocation=invocation["startedNs"] <= timestamp_ns(row["finished"]) <= invocation["finishedNs"])
    rules = daemon_error_rules(row["error"])
    value["daemonError"] = {"status": "OBSERVED" if rules else "NO_MATCH", "ruleIds": sorted(rules)}
    return value


def switch_command_projection(value):
    if not isinstance(value, dict) or not isinstance(value.get("step"), str):
        return {}
    step = value["step"]
    if (step not in SWITCH_READ_STEPS or value.get("verb") != SWITCH_READ_STEPS[step]
            or not isinstance(value.get("category"), str) or value["category"] not in SWITCH_READ_CATEGORIES
            or type(value.get("attempted")) is not bool):
        return {}
    result = {key: value[key] for key in ("step", "verb", "category", "attempted")}
    code = value.get("exitCode")
    result["exitCode"] = code if type(code) is int and -128 <= code <= 255 else "UNAVAILABLE"
    cleanup = value.get("cleanupReasonCode")
    if isinstance(cleanup, str) and cleanup in ("DIAGNOSTIC_PROCESS_OWNERSHIP", "DIAGNOSTIC_PROCESS_CLEANUP"):
        result["cleanupReasonCode"] = cleanup
    return result


def switch_command_failure(step, category, proof=None, *, reason="DIAGNOSTIC_DOCKER_EXIT", attempted=True):
    proof = proof if isinstance(proof, dict) else {}
    error = Failure(reason)
    error.docker_observation = switch_command_projection({"step": step, "verb": SWITCH_READ_STEPS.get(step),
        "category": category, "attempted": attempted, "exitCode": proof.get("exitCode"),
        "cleanupReasonCode": proof.get("cleanupReasonCode")})
    return error


def switch_failure_observation(owner, environment, config, journal, invocation):
    """Bounded read-only local Docker observation; no readiness prerequisite."""
    deadline = time.monotonic() + SWITCH_SECONDS
    require(type(owner.get("uid")) is int and owner["uid"] > 0, "DIAGNOSTIC_UID")
    files, images = switch_expected_files(config, owner["uid"]), switch_image_references(config, journal)
    expected_daemon = root_json("host-baseline.json")["daemonIdentitySha256"]
    require(isinstance(expected_daemon, str) and HEX64.fullmatch(expected_daemon), "DIAGNOSTIC_BINDING")
    child_env = {key: environment[key] for key in ("PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "PYTHONDONTWRITEBYTECODE") if key in environment}
    child_env["DOCKER_HOST"] = "unix:///var/run/docker.sock"
    def read(step, args, *, logs=False):
        require(SWITCH_READ_STEPS.get(step) == args[0], "DIAGNOSTIC_BINDING")
        remaining = deadline - time.monotonic()
        if remaining <= 5:
            raise switch_command_failure(step, "BUDGET_EXHAUSTED", reason="DIAGNOSTIC_TIMEOUT", attempted=False)
        try:
            proof, raw = diagnostic_command(["docker", *args], timeout=min(8, remaining - 5),
                environment=child_env, owner=owner, return_streams=logs)
        except BaseException:
            raise switch_command_failure(step, "PROBE_FAILURE") from None
        if not isinstance(proof, dict):
            raise switch_command_failure(step, "INVALID_RESULT")
        if time.monotonic() >= deadline:
            raise switch_command_failure(step, "TIMEOUT", proof, reason="DIAGNOSTIC_TIMEOUT")
        categories = {"DIAGNOSTIC_TIMEOUT": "TIMEOUT", "DIAGNOSTIC_OUTPUT_LIMIT": "OUTPUT_LIMIT",
            "DIAGNOSTIC_PROCESS_OWNERSHIP": "PROCESS_OWNERSHIP", "DIAGNOSTIC_PROCESS_CLEANUP": "PROCESS_CLEANUP"}
        reason = proof.get("reasonCode")
        if isinstance(reason, str) and reason in categories:
            raise switch_command_failure(step, categories[reason], proof, reason=reason)
        if reason:
            raise switch_command_failure(step, "PROBE_FAILURE", proof)
        if type(proof.get("exitCode")) is not int:
            raise switch_command_failure(step, "INVALID_RESULT", proof)
        if proof["exitCode"] != 0:
            raise switch_command_failure(step, "NONZERO_EXIT", proof)
        if proof.get("actualUid", owner["uid"]) != owner["uid"]:
            raise switch_command_failure(step, "UID_MISMATCH", proof)
        if not (isinstance(raw, tuple) and len(raw) == 2 and all(isinstance(item, bytes) for item in raw) if logs else isinstance(raw, bytes)):
            raise switch_command_failure(step, "INVALID_RESULT", proof)
        if (sum(map(len, raw)) if logs else len(raw)) > DIAGNOSTIC_LIMIT:
            raise switch_command_failure(step, "OUTPUT_LIMIT", proof, reason="DIAGNOSTIC_OUTPUT_LIMIT")
        return raw
    def daemon(step):
        require(hashlib.sha256(read(step, ["info", "--format", "{{.ID}}"]).strip()).hexdigest() == expected_daemon, "DIAGNOSTIC_CHANGED")
    def list_ids(step):
        ids = read(step, ["ps", "-aq", "--no-trunc", "--filter", "label=com.docker.compose.project=" + config["project"]]).decode("ascii").split()
        require(len(ids) <= len(SWITCH_SERVICES) and len(set(ids)) == len(ids)
                and all(HEX64.fullmatch(item) for item in ids), "DIAGNOSTIC_INVENTORY")
        return ids
    def inventory(point):
        ids = list_ids(point + "List")
        records = [json.loads(line) for line in read(point + "Inspect", ["inspect", "--format", SWITCH_INSPECT, *ids]).splitlines()] if ids else []
        result = switch_bind_records(records, ids, config, files, images, invocation)
        require(set(list_ids(point + "Recheck")) == set(ids), "DIAGNOSTIC_CHANGED")
        return result
    daemon("daemonBefore")
    before = inventory("before")
    logs, candidates = {}, []
    for service in SWITCH_SERVICES:
        row = before.get(service)
        if row and (row["health"] == "unhealthy" or row["oomKilled"] or row["error"] or row["restarts"] > 0 or
                    row["state"] in ("exited", "dead", "restarting") and row["exitCode"] != 0):
            candidates.append(service)
    def seconds(value):
        return str(value // 10**9) + "." + str(value % 10**9).zfill(9)
    for service in candidates[:4]:
        try:
            raw = read("containerLogs", ["logs", "--timestamps", "--tail", "200", "--since", seconds(invocation["startedNs"]),
                        "--until", seconds(invocation["finishedNs"]), before[service]["id"]], logs=True)
            logs[service] = switch_log_projection(raw, service, invocation)
        except BaseException as error:
            logs[service] = command_diagnostic_error(error)
    after = inventory("after")
    daemon("daemonAfter")
    require(switch_identity(before) == switch_identity(after), "DIAGNOSTIC_CHANGED")
    require(time.monotonic() < deadline, "DIAGNOSTIC_TIMEOUT")
    services = {}
    for service in SWITCH_SERVICES:
        if service not in before:
            services[service] = {"presence": "NOT_PRESENT"}
            continue
        first, last = switch_state_projection(before[service], invocation), switch_state_projection(after[service], invocation)
        services[service] = {"presence": "PRESENT", "before": first, "after": last, "stateChanged": first != last,
            "imageBinding": "PINNED_COMPOSE_REFERENCE" if service == "postgres" else "PINNED_RELEASE_DIGEST"}
        if service in logs:
            services[service]["log"] = logs[service]
    return {"status": "OBSERVED", "observation": "AFTER_PUBLIC_FAILURE", "observedAt": now(), "completeInventory": True,
        "immutableIdentityRechecked": True, "daemonIdentityMatchedBaseline": True, "scope": "OWNED_INSTALL_SWITCH_CONTAINERS",
        "identitySha256": canonical_hash(switch_identity(before)), "services": services,
        "logSamples": len(logs), "eligibleLogsNotSampled": max(0, len(candidates) - 4), "composeExitCode": "UNAVAILABLE",
        "causalProof": False}


def cli_metadata_projection(info, label):
    require(label in ("var", "varLib", "logDirectory", "logFile")
            and all(type(value) is int and 0 <= value <= 2**32 - 1
                    for value in (info.st_uid, info.st_gid, info.st_nlink, info.st_mode)), "DIAGNOSTIC_PATH")
    directory = label != "logFile"
    kind = "directory" if stat.S_ISDIR(info.st_mode) else "regular" if stat.S_ISREG(info.st_mode) else "symlink" if stat.S_ISLNK(info.st_mode) else "other"
    failures = []
    if kind != ("directory" if directory else "regular"):
        failures.append("EXPECTED_DIRECTORY" if directory else "EXPECTED_REGULAR")
    if info.st_uid != 0:
        failures.append("EXPECTED_ROOT_OWNER")
    if directory and info.st_mode & 0o022:
        failures.append("ANCESTOR_WRITABLE")
    if label == "logDirectory" and info.st_mode & 0o077:
        failures.append("LOG_DIRECTORY_NOT_PRIVATE")
    if not directory and (stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1):
        failures.append("LOG_FILE_MODE_OR_LINKS")
    return {"kind": kind, "uid": info.st_uid, "gid": info.st_gid, "mode": format(stat.S_IMODE(info.st_mode), "04o"),
            "links": info.st_nlink, "failedCheckIds": failures}


def cli_log_path_metadata(public, words, invocation):
    """O_PATH metadata only; a rejected component is never opened for reading."""
    path = cli_log_path(public, words, invocation)
    descriptor = os.open("/", os.O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW)
    result = {"status": "OBSERVED", "contentRead": False, "paths": {}}
    try:
        for label, part in (("var", "var"), ("varLib", "lib"), ("logDirectory", "asa-lab-operator"), ("logFile", path.name)):
            child = os.open(part, os.O_PATH | os.O_NOFOLLOW, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
            result["paths"][label] = cli_metadata_projection(os.fstat(descriptor), label)
            if result["paths"][label]["failedCheckIds"]:
                result["firstRejectedLabel"] = label
                break
        return result
    finally:
        os.close(descriptor)


def cli_log_path(public, words, invocation):
    require(isinstance(invocation, dict) and all(type(invocation.get(key)) is int for key in ("pid", "startedNs", "finishedNs"))
            and 0 < invocation["pid"] and 0 < invocation["startedNs"] <= invocation["finishedNs"], "DIAGNOSTIC_INVOCATION")
    value = public.get("logPath")
    require(isinstance(value, str) and len(value) < 256, "DIAGNOSTIC_INVOCATION")
    path = Path(value)
    pattern = re.escape("-".join(words)) + r"-([0-9]{8}T[0-9]{6}Z)-" + str(invocation["pid"]) + r"\.log"
    match = re.fullmatch(pattern, path.name)
    require(path.parent == OPERATOR_LOG_ROOT and match, "DIAGNOSTIC_INVOCATION")
    timestamp = int(dt.datetime.strptime(match.group(1), "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc).timestamp())
    require(invocation["startedNs"] // 10**9 <= timestamp <= invocation["finishedNs"] // 10**9, "DIAGNOSTIC_INVOCATION")
    return path


def command_failure_diagnostic(words, code, public, invocation):
    """Read fixed existing state after failure; never replay the failing command."""
    action = " ".join(words)
    require(action in COMMAND_DIAGNOSTIC_MODES, "DIAGNOSTIC_BINDING")
    context = guest_guard()
    owner, environment = diagnostic_owner(context)
    deadline = time.monotonic() + 30
    # The receipt is a new observation from this invocation, not a stale pointer.
    require(isinstance(invocation, dict) and all(type(invocation.get(key)) is int for key in ("startedNs", "finishedNs"))
            and 0 < invocation["startedNs"] <= invocation["finishedNs"], "DIAGNOSTIC_INVOCATION")
    operation = public.get("operation")
    require(isinstance(operation, dict) and isinstance(operation.get("operationId"), str)
            and re.fullmatch(r"[a-f0-9]{32}", operation["operationId"]), "DIAGNOSTIC_BINDING")
    values = []
    for relative in (".asa/setup.json", ".asa/setup-operations/" + operation["operationId"] + ".json", ".asa/setup-last-attempt.json"):
        require(time.monotonic() < deadline, "DIAGNOSTIC_TIMEOUT")
        raw, info, _ = diagnostic_read(INSTALL_ROOT / relative, INSTALL_ROOT, owner["uid"],
                                       maximum=256 * 1024 if relative == ".asa/setup.json" else 2 * 1024**2)
        if relative == ".asa/setup-last-attempt.json":
            require(invocation["startedNs"] <= info.st_mtime_ns <= invocation["finishedNs"],
                    "DIAGNOSTIC_INVOCATION")
        try:
            values.append(json.loads(raw))
        except (ValueError, UnicodeError):
            raise Failure("DIAGNOSTIC_JSON") from None
    result = command_operation_projection(public, *values, context["pins"],
        mode=COMMAND_DIAGNOSTIC_MODES[action], code=code, uid=owner["uid"])
    result["logs"] = {}
    for source in ("cli", "setup"):
        try:
            require(time.monotonic() < deadline, "DIAGNOSTIC_TIMEOUT")
            if source == "cli":
                path = cli_log_path(public, words, invocation)
                raw, info, truncated = diagnostic_read(path, OPERATOR_LOG_ROOT, 0, maximum=34 * 1024**2, tail=128 * 1024)
                require(all(invocation["startedNs"] <= timestamp <= invocation["finishedNs"]
                            for timestamp in (info.st_ctime_ns, info.st_mtime_ns)), "DIAGNOSTIC_INVOCATION")
                observed = {**command_log_classification(raw, result["journalPhase"]), "readBytes": len(raw), "truncated": truncated}
            else:
                baseline = invocation.get("setupLogsBefore", {}) if isinstance(invocation, dict) else {}
                require(baseline.get("status") == "OBSERVED" and isinstance(baseline.get("entries"), dict), "DIAGNOSTIC_LOG_BASELINE")
                name = result["operationId"] + ".log"
                before = baseline["entries"].get(name)
                observed = command_log_projection(INSTALL_ROOT / ".asa/setup-logs" / name, INSTALL_ROOT, owner["uid"],
                    phase=result["journalPhase"], offset=before[2] if before else 0, identity=before)
            result["logs"][source] = observed
        except BaseException as error:
            result["logs"][source] = command_diagnostic_error(error)
            if source == "cli" and getattr(error, "code", None) == "DIAGNOSTIC_PERMISSIONS":
                try:
                    result["logs"][source]["pathMetadata"] = cli_log_path_metadata(public, words, invocation)
                except BaseException as metadata_error:
                    result["logs"][source]["pathMetadata"] = command_diagnostic_error(metadata_error)
    if (result["binding"] == "VERIFIED" and result["mode"] == "install" and result["reasonCode"] == "COMMAND"
            and result["journalPhase"] == result["receiptStage"] == "switch" and result["stages"].get("switch") == "intent"
            and result["selectedRelease"]["status"] == "CONFIRMED"):
        try:
            result["switchObservation"] = switch_failure_observation(owner, environment, values[0], values[1], invocation)
        except BaseException as error:
            result["switchObservation"] = command_diagnostic_error(error)
    return result


def diagnostic_error(error):
    name = type(error).__name__
    return name if name in DIAGNOSTIC_ERRORS else "OtherError"


def diagnostic_unreaped(process, own_group):
    """Keep the directly owned leader waitable until the last cleanup signal."""
    require(type(process.pid) is int and process.pid > 0 and process.returncode is None,
            "DIAGNOSTIC_PROCESS_OWNERSHIP")
    try:
        observed = os.waitid(os.P_PID, process.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
        require(observed is None or observed.si_pid == process.pid, "DIAGNOSTIC_PROCESS_OWNERSHIP")
        if own_group:
            require(os.getpgid(process.pid) == os.getsid(process.pid) == process.pid,
                    "DIAGNOSTIC_PROCESS_OWNERSHIP")
        return observed
    except (OSError, ChildProcessError):
        raise Failure("DIAGNOSTIC_PROCESS_OWNERSHIP") from None


def diagnostic_command(args, *, timeout, environment, owner=None, own_group=True, return_streams=False):
    """Bound both streams; retain the owned leader until group cleanup finishes."""
    options = {} if owner is None else {"user": owner["uid"], "group": owner["gid"],
        "extra_groups": os.getgrouplist(owner["name"], owner["gid"])}
    result, output, errors = {}, bytearray(), bytearray()
    process = None
    ownership_lost = False
    def observe():
        nonlocal ownership_lost
        require(not ownership_lost, "DIAGNOSTIC_PROCESS_OWNERSHIP")
        try:
            return diagnostic_unreaped(process, own_group)
        except BaseException:
            ownership_lost = True  # Never reacquire authority over a possibly reused PID.
            raise
    def cleanup_error(error):
        reason = getattr(error, "code", None)
        reason = reason if reason == "DIAGNOSTIC_PROCESS_OWNERSHIP" else "DIAGNOSTIC_PROCESS_CLEANUP"
        result["cleanupReasonCode"] = reason
        result.setdefault("reasonCode", reason)
        result.setdefault("errorClass", diagnostic_error(error))
    try:
        require(sys.platform == "linux" and hasattr(os, "waitid") and hasattr(os, "WNOWAIT"),
                "DIAGNOSTIC_PLATFORM")
        process = subprocess.Popen([str(item) for item in args], cwd="/", env=environment,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=own_group,
            umask=0o077, **options)
        observe()
        try:
            uid_line = next(line for line in Path(f"/proc/{process.pid}/status").read_text().splitlines() if line.startswith("Uid:"))
            result["actualUid"] = int(uid_line.split()[2])
        except (OSError, StopIteration, ValueError):
            pass  # An already-exited process has no observable /proc identity.
        deadline = time.monotonic() + timeout
        with selectors.DefaultSelector() as selector:
            for stream, target in ((process.stdout, output), (process.stderr, errors)):
                os.set_blocking(stream.fileno(), False)
                selector.register(stream, selectors.EVENT_READ, target)
            while selector.get_map() or observe() is None:
                require(time.monotonic() < deadline, "DIAGNOSTIC_TIMEOUT")
                for key, _ in selector.select(min(0.1, max(0, deadline - time.monotonic()))):
                    data = os.read(key.fd, 4096)
                    if not data:
                        selector.unregister(key.fileobj)
                        continue
                    require(len(output) + len(errors) + len(data) <= DIAGNOSTIC_LIMIT, "DIAGNOSTIC_OUTPUT_LIMIT")
                    key.data.extend(data)
        # Preserve only a known Python exception class, never a traceback line.
        for line in errors.decode("utf-8", "replace").splitlines():
            name = line.partition(":")[0]
            if name in DIAGNOSTIC_ERRORS:
                result["errorClass"] = name
    except BaseException as error:
        reason = getattr(error, "code", None)
        result.update(errorClass=diagnostic_error(error),
            reasonCode=reason if isinstance(reason, str) and reason in DIAGNOSTIC_REASONS else "UNRECOGNIZED_REASON")
    finally:
        if process is not None:
            # WNOWAIT reserves the leader's PID/session even after its exit.
            # Nested probes share the caller's group and may signal only their PID.
            try:
                observe()
                try:
                    (os.killpg if own_group else os.kill)(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                deadline = time.monotonic() + 1
                while observe() is None and time.monotonic() < deadline:
                    time.sleep(0.01)
                observe()
                try:
                    (os.killpg if own_group else os.kill)(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                # No process-group signal is permitted after this first reap.
                result["exitCode"] = process.wait(timeout=2)
            except BaseException as error:
                cleanup_error(error)
            finally:
                for stream in (process.stdout, process.stderr):
                    try:
                        stream.close()
                    except OSError as error:
                        cleanup_error(error)
    return result, (bytes(output), bytes(errors)) if return_streams else bytes(output)


def diagnostic_command_projection(value):
    value = value if isinstance(value, dict) else {}
    result = {}
    for key, low, high in (("exitCode", -128, 255), ("actualUid", 1, 2**32 - 2)):
        if type(value.get(key)) is int and low <= value[key] <= high:
            result[key] = value[key]
    for key, allowed in (("reasonCode", DIAGNOSTIC_REASONS), ("errorClass", DIAGNOSTIC_ERRORS),
                         ("cleanupReasonCode", {"DIAGNOSTIC_PROCESS_OWNERSHIP", "DIAGNOSTIC_PROCESS_CLEANUP"}),
                         ("state", DIAGNOSTIC_STATES), ("status", {"OK", "ERROR", "BLOCKED", "UNAVAILABLE"})):
        if isinstance(value.get(key), str):
            if value[key] in allowed:
                result[key] = value[key]
            elif key == "reasonCode":
                result[key] = "UNRECOGNIZED_REASON"
            elif key == "errorClass":
                result[key] = "OtherError"
    return result


def diagnostic_json(raw, command):
    result = dict(command)
    try:
        value = json.loads(raw)
        require(isinstance(value, dict), "DIAGNOSTIC_JSON")
        for key in ("reasonCode", "state", "status"):
            if key in value and not (key == "reasonCode" and "reasonCode" in command):
                result[key] = value[key]
        if isinstance(value.get("reasonCode"), str) and value["reasonCode"] in DIAGNOSTIC_ERRORS:
            result["errorClass"] = value["reasonCode"]
        if value.get("outcome") in ("ERROR", "BLOCKED"):
            result["status"] = value["outcome"]
    except (ValueError, UnicodeError, Failure):
        result.setdefault("reasonCode", "DIAGNOSTIC_JSON")
    if "reasonCode" in command:
        result["status"] = "UNAVAILABLE"
    return diagnostic_command_projection(result)


def post_failure_projection(value):
    """Closed schema: arbitrary nested child data and even uppercase secrets drop."""
    value = value if isinstance(value, dict) else {}
    result = {"observation": "AFTER_PUBLIC_FAILURE", "status": "OBSERVED" if value.get("status") == "OBSERVED" else "UNAVAILABLE"}
    if isinstance(value.get("observedAt"), str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?\+00:00", value["observedAt"]):
        result["observedAt"] = value["observedAt"]
    for key in ("bundleVerified", "operatorVerified"):
        result[key] = value.get(key) is True
    for key in ("intentCheck", "ownerObservation", "inventoryObservation", "probeError"):
        if key in value:
            result[key] = diagnostic_command_projection(value[key])
    paths = value.get("paths") if isinstance(value.get("paths"), dict) else {}
    result["paths"] = {}
    for label in DIAGNOSTIC_PATHS:
        item = paths.get(label)
        if not isinstance(item, dict):
            continue
        entry = {key: item[key] for key in ("rootOwned", "readable", "traversable", "directory", "regular") if type(item.get(key)) is bool}
        if isinstance(item.get("mode"), str) and re.fullmatch(r"[0-7]{4}", item["mode"]):
            entry["mode"] = item["mode"]
        if "errorClass" in item:
            entry.update(diagnostic_command_projection({"errorClass": item["errorClass"]}))
        result["paths"][label] = entry
    if isinstance(value.get("docker"), dict):
        result["docker"] = {key: diagnostic_command_projection(value["docker"].get(key)) for key in ("client", "daemon", "compose")}
    if isinstance(value.get("inventory"), dict):
        inventory = value["inventory"]
        result["inventory"] = {"complete": inventory.get("complete") is True,
            "state": inventory.get("state") if isinstance(inventory.get("state"), str) and inventory["state"] in DIAGNOSTIC_STATES else "UNKNOWN",
            "reasonCodes": [code if isinstance(code, str) and code in DIAGNOSTIC_REASONS else "UNRECOGNIZED_REASON"
                            for code in inventory.get("reasonCodes", [])[:8]] if isinstance(inventory.get("reasonCodes"), list) else []}
    return result


def diagnostic_owner(context):
    """Revalidate protected candidate and the existing receipt; never bootstrap."""
    import pwd
    bundle = candidate_bundle(context)
    launcher_path = bundle / "tools/asa_setup_launcher.py"
    for path in [*reversed(launcher_path.parents), launcher_path]:
        info = path.lstat()
        require(not stat.S_ISLNK(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022
                and (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode) and info.st_nlink == 1), "DIAGNOSTIC_TRUST")
    spec = importlib.util.spec_from_file_location("asa_realhost_diagnostic_launcher", launcher_path)
    launcher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(launcher)
    launcher.verify_bundle(bundle)
    receipt_path = launcher.checked_path(Path("/var/lib/asa-setup/operator.json"), missing=False)
    require(receipt_path.stat().st_uid == 0, "DIAGNOSTIC_OWNER")
    receipt = launcher.read_private_json(receipt_path, required=True)
    account = pwd.getpwnam("asa-setup")
    owner = launcher.validate_owner(INSTALL_ROOT, operator_uid=account.pw_uid)
    require(owner["uid"] != 0 and owner["gid"] != 0 and owner["name"] == "asa-setup"
            and owner["home"] == "/var/lib/asa-setup/operator"
            and receipt.get("format") == "asa-operator-bootstrap-v1"
            and receipt.get("marker") == account.pw_gecos and account.pw_shell == "/usr/sbin/nologin"
            and all(receipt.get(key) == owner[key] for key in ("uid", "gid", "name", "home", "root")), "DIAGNOSTIC_OWNER")
    home = launcher.checked_path(Path(owner["home"]), missing=False).stat()
    require(stat.S_ISDIR(home.st_mode) and home.st_uid == owner["uid"] and home.st_gid == owner["gid"]
            and not home.st_mode & 0o077, "DIAGNOSTIC_OWNER")
    return owner, launcher.operator_environment(owner)


def owner_diagnostic(context, *, inventory=False):
    """Actual unprivileged reads only; no setup/manager monkeypatch or target writes."""
    require(os.geteuid() != 0, "DIAGNOSTIC_UID")
    bundle = candidate_bundle(context)
    result = {"actualUid": os.geteuid(), "paths": {}}
    for label, relative in DIAGNOSTIC_PATHS.items():
        path = bundle / relative
        try:
            info = path.lstat()
            entry = {"mode": format(stat.S_IMODE(info.st_mode), "04o"), "rootOwned": info.st_uid == 0,
                     "directory": stat.S_ISDIR(info.st_mode), "regular": stat.S_ISREG(info.st_mode),
                     "readable": os.access(path, os.R_OK)}
            if stat.S_ISDIR(info.st_mode):
                entry["traversable"] = os.access(path, os.X_OK)
            result["paths"][label] = entry
        except OSError as error:
            result["paths"][label] = {"errorClass": diagnostic_error(error)}
    if inventory:
        result["docker"] = {}
        for name, args in (("client", ["docker", "--version"]), ("daemon", ["docker", "info", "--format", "{{.ID}}"]),
                           ("compose", ["docker", "compose", "version", "--short"])):
            # Native inventory below has its own 30s command bound. These small
            # availability probes have bounded streams; their output is dropped.
            command, _ = diagnostic_command(args, timeout=8, environment=os.environ, own_group=False)
            result["docker"][name] = diagnostic_command_projection(command)
        sys.path.insert(0, str(bundle / "tools"))
        from deployment import setup_discovery
        observed = setup_discovery.docker_inventory()
        discovery = setup_discovery.classify_installation(INSTALL_ROOT, observed)
        result["inventory"] = {"complete": observed.get("complete") is True, "state": discovery.get("state"),
            "reasonCodes": [item.get("code") for item in discovery.get("reasons", []) if isinstance(item, dict)]}
    return result


def post_failure_diagnostic(context):
    result = {"observedAt": now(), "status": "UNAVAILABLE"}
    try:
        owner, environment = diagnostic_owner(context)
        result.update(bundleVerified=True, operatorVerified=True)
        command, raw = diagnostic_command(["/usr/bin/python3", "-I", "-B", candidate_bundle(context) / "tools/asa_setup.py",
            "intent-check", "--intent", "install", "--root", INSTALL_ROOT, "--json"], timeout=45, environment=environment, owner=owner)
        result["intentCheck"] = diagnostic_json(raw, command)
        generic = result["intentCheck"].get("reasonCode") in ("OPERATION_INTENT", "DOCKER_UNKNOWN", "UNRECOGNIZED_REASON", "DIAGNOSTIC_JSON")
        command, raw = diagnostic_command(["/usr/bin/python3", "-I", "-B", GUEST_HOME / "runner.py", "--guest-phase", "owner-diagnostic-paths"],
            timeout=10, environment=environment, owner=owner)
        result["ownerObservation"] = diagnostic_json(raw, command)
        value = json.loads(raw)
        require(command.get("exitCode") == 0 and isinstance(value, dict) and value.get("format") == "asa-realhost-guest-v1",
                "DIAGNOSTIC_JSON")
        require(type(value.get("actualUid")) is int and value["actualUid"] == owner["uid"] != 0, "DIAGNOSTIC_UID")
        result["ownerObservation"]["actualUid"] = value["actualUid"]
        result["paths"] = value.get("paths", {})
        result["status"] = "OBSERVED"
        if generic:
            command, raw = diagnostic_command(["/usr/bin/python3", "-I", "-B", GUEST_HOME / "runner.py", "--guest-phase", "owner-diagnostic-inventory"],
                timeout=65, environment=environment, owner=owner)
            result["inventoryObservation"] = diagnostic_json(raw, command)
            value = json.loads(raw)
            require(command.get("exitCode") == 0 and isinstance(value, dict) and value.get("format") == "asa-realhost-guest-v1",
                    "DIAGNOSTIC_JSON")
            require(type(value.get("actualUid")) is int and value["actualUid"] == owner["uid"] != 0, "DIAGNOSTIC_UID")
            result.update({key: value[key] for key in ("docker", "inventory") if key in value})
    except BaseException as error:
        result["probeError"] = {"errorClass": diagnostic_error(error), "reasonCode": getattr(error, "code", "UNRECOGNIZED_REASON")}
    return post_failure_projection(result)


def first_install_attempt(context, options):
    try:
        first = public_cli(["install"], options=options, allowed=(2,), timeout=1800)
        reason = [first.get("reasonCode"), *first.get("reasonCodes", [])]
        require("OWNER_INPUT_REQUIRED" in reason and not (INSTALL_ROOT / ".env").exists()
                and not list((INSTALL_ROOT / ".asa/setup-operations").glob("*.json")), "FRESH_ONBOARDING_BOUNDARY")
    except BaseException as error:
        # This later observation cannot explain away or overwrite the first failure.
        try:
            error.post_failure_diagnostic = post_failure_diagnostic(context)
        except BaseException as diagnostic_failure:
            error.post_failure_diagnostic = post_failure_projection({"observedAt": now(), "probeError": {
                "errorClass": diagnostic_error(diagnostic_failure)}})
        raise


def product_modules(context):
    bundle = candidate_bundle(context)
    require(bundle.is_dir() and bundle.stat().st_uid == 0 and not bundle.stat().st_mode & 0o022,
            "CANDIDATE_BUNDLE_OWNER")
    sys.path.insert(0, str(bundle / "tools"))
    from deployment import setup_config, setup_acceptance, backup_schedule
    from deployment.system import Installation
    require(setup_acceptance.OPS_REVISION == context["pins"]["browser"]["opsRevision"]
            and setup_acceptance.BROWSER_SHA256 == context["pins"]["browser"]["componentSha256"]
            and setup_acceptance.FIXTURE_SHA256 == context["pins"]["browser"]["fixtureSha256"], "BROWSER_PIN_DRIFT")
    helper = GUEST_HOME / "ci_setup_smoke.py"
    require(hash_file(helper) == context["helperSha256"], "FINGERPRINT_HELPER_HASH")
    spec = importlib.util.spec_from_file_location("asa_realhost_fingerprint_helper", helper)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return setup_config, setup_acceptance, backup_schedule, Installation, module


def owner_call(phase, *, timeout=900):
    import pwd
    account = pwd.getpwnam("asa-setup")
    environment = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "HOME": account.pw_dir, "USER": account.pw_name,
                   "LOGNAME": account.pw_name, "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "PYTHONDONTWRITEBYTECODE": "1"}
    code, raw = Commands().run(["runuser", "-u", account.pw_name, "--", "/usr/bin/python3", "-I", "-B",
                                GUEST_HOME / "runner.py", "--guest-phase", phase],
                               environment=environment, timeout=timeout, allowed=(0, 1, 2))
    try:
        result = json.loads(raw)
    except (ValueError, UnicodeError):
        raise Failure("OWNER_REPORT_INVALID") from None
    require(type(code) is int and code in (0, 1, 2) and isinstance(result, dict) and result.get("format") == "asa-realhost-guest-v1"
            and result.get("phase") == phase, "OWNER_REPORT_INVALID")
    if code or result.get("status") != "PASS":
        reason = result.get("reasonCode")
        # Only current owner-phase blockers may cross the subprocess boundary.
        blocked = (type(code) is int and code == 2 and result.get("status") == "BLOCKED"
                   and reason in ("BLOCKED_FAULT_GUEST_DISK", "COMMAND_TIMEOUT"))
        error = Failure(reason if isinstance(reason, str) and CODE.fullmatch(reason) else "OWNER_PHASE_FAILED",
                        status="BLOCKED" if blocked else "FAIL")
        browser_phase = {"owner-seed": ("CONTROL_BROWSER_BEFORE", "BEFORE"),
                         "owner-final": ("CONTROL_BROWSER_AFTER", "AFTER")}.get(phase)
        if browser_phase and code == 1 and result.get("status") == "FAIL" and reason == browser_phase[0]:
            try:
                error.control_browser_diagnostic = control_browser_evidence(result.get("controlBrowserDiagnostic"), browser_phase[1])
            except BaseException:
                error.control_browser_diagnostic = {"format": "asa-realhost-control-browser-v1", "phase": browser_phase[1], "binding": "UNAVAILABLE"}
        if phase == "owner-observe" and code == 1 and result.get("status") == "FAIL" and reason == "CONTROL_DATA_CHANGED":
            try:
                error.control_comparison = control_comparison_evidence(result.get("controlComparison"))
            except BaseException:
                pass  # A diagnostic cannot replace the original owner failure.
        raise error
    return result


def panel_and_docker_identity():
    commands = Commands()
    services = {}
    for name in ("1panel-core", "1panel-agent", "docker"):
        _, active = commands.run(["systemctl", "is-active", name + ".service"])
        require(active.strip() == b"active", "HOST_SERVICE_INACTIVE")
        _, fragment = commands.run(["systemctl", "show", name + ".service", "-p", "FragmentPath", "--value"])
        services[name] = {"active": True, "unitSha256": hash_file(fragment.decode().strip())}
    for name in ("1panel-core", "1panel-agent"):
        services[name]["binarySha256"] = hash_file(Path("/usr/local/bin") / name)
    _, daemon = commands.run(["docker", "info", "--format", "{{.ID}}"])
    _, version = commands.run(["docker", "version", "--format", "{{.Server.Version}}"])
    require(re.fullmatch(rb"[0-9]+\.[0-9]+\.[0-9]+(?:[-+a-zA-Z0-9.]*)\s*", version), "DOCKER_VERSION")
    _, packages = commands.run(["dpkg-query", "-W", "-f", "${Package}=${Version}\n", "docker-ce", "docker-ce-cli",
                                "containerd.io", "docker-compose-plugin", "docker-buildx-plugin"], allowed=(0, 1))
    settings = Path("/etc/docker/daemon.json")
    return {"services": services, "daemonIdentitySha256": hashlib.sha256(daemon.strip()).hexdigest(),
            "dockerVersion": version.decode().strip(), "dockerPackagesSha256": hashlib.sha256(packages).hexdigest(),
            "daemonJsonSha256": hash_file(settings) if settings.exists() else None}


def published_context(context):
    request = context.get("acquisition")
    require(type(request) is dict and set(request) == {"mode", "approvedRevision", "sourceRevision", "helperSha256"}
            and request["mode"] == "published" and type(context.get("sourceRevision")) is str
            and HEX40.fullmatch(context["sourceRevision"])
            and request["approvedRevision"] == request["sourceRevision"] == context["sourceRevision"]
            and type(request["helperSha256"]) is str and HEX64.fullmatch(request["helperSha256"])
            and context.get("pins", {}).get("githubCli") == GH_PIN, "PUBLISHED_CONTEXT")
    return request


def guest_acquisition_mode(context):
    request = context.get("acquisition", {})
    require(type(request) is dict and request.get("mode") in ("candidate", "published"), "ACQUISITION_MODE_BINDING")
    if request["mode"] == "published":
        published_context(context)
    else:
        require(set(request) == {"mode", "approvedRevision", "sourceRevision"}
                and request["approvedRevision"] == "" and type(context.get("sourceRevision")) is str
                and HEX40.fullmatch(context["sourceRevision"])
                and request["sourceRevision"] == context["sourceRevision"], "ACQUISITION_MODE_BINDING")
    return request["mode"]


def published_administrator(context):
    """Only the real cloud-init administrator of this already bound guest."""
    import pwd
    published_context(context)
    require(os.geteuid() == 0 and type(context.get("nonce")) is str
            and re.fullmatch(r"[a-f0-9]{32}", context["nonce"]), "PUBLISHED_ADMINISTRATOR")
    try:
        account = pwd.getpwnam("asa-ci")
        groups = sorted(set(os.getgrouplist("asa-ci", account.pw_gid)))
    except (KeyError, OSError):
        raise Failure("PUBLISHED_ADMINISTRATOR") from None
    require(account.pw_name == "asa-ci" and type(account.pw_uid) is int and account.pw_uid > 0
            and type(account.pw_gid) is int and account.pw_gid > 0
            and account.pw_dir == "/home/asa-ci" and account.pw_shell == "/bin/bash"
            and groups and all(type(value) is int and value > 0 for value in groups)
            and account.pw_gid in groups, "PUBLISHED_ADMINISTRATOR")
    home = Path(account.pw_dir)
    for path in (home, *home.parents):
        info = path.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == (account.pw_uid if path == home else 0)
                and not info.st_mode & 0o022, "PUBLISHED_ADMINISTRATOR")
    return {"name": "asa-ci", "uid": account.pw_uid, "gid": account.pw_gid,
            "home": account.pw_dir, "groups": groups, "nonce": context["nonce"]}


def published_credentials(owner, *, deadline):
    require(type(deadline) in (int, float) and math.isfinite(deadline)
            and 0 < deadline - time.monotonic() <= PUBLISHED_SECONDS, "PUBLISHED_ADMINISTRATOR_BUDGET")
    actual = published_administrator(guest_guard(control_deadline=min(deadline, time.monotonic() + CLI_CONTROL_SECONDS)))
    require(type(owner) is dict and type(owner.get("uid")) is int and owner["uid"] > 0
            and type(owner.get("gid")) is int and owner["gid"] > 0 and type(owner.get("groups")) is list
            and all(type(value) is int and value > 0 for value in owner["groups"])
            and owner == actual, "PUBLISHED_ADMINISTRATOR")
    return {"user": actual["uid"], "group": actual["gid"], "extra_groups": actual["groups"]}


def published_directory(path, *, mode=0o755):
    path = Path(path)
    for parent in (path.parent, *path.parent.parents):
        info = parent.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
                "PUBLISHED_PROTECTED_PATH")
    require(not os.path.lexists(path), "PUBLISHED_PATH_EXISTS")
    path.mkdir(mode=mode)
    path.chmod(mode)


def published_snapshot(directory, name, raw, *, mode=0o444):
    """Only bytes are copied into a new protected file; no privileged user path exec."""
    require(type(name) is str and re.fullmatch(r"[a-zA-Z0-9_.-]{1,100}", name)
            and type(raw) is bytes and 0 < len(raw) <= 64 * 1024**2 and mode in (0o444, 0o555),
            "PUBLISHED_SNAPSHOT")
    directory = Path(directory)
    for path in (directory, *directory.parents):
        info = path.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
                "PUBLISHED_PROTECTED_PATH")
    descriptor = os.open(directory / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
        os.fchmod(stream.fileno(), mode)
    path = directory / name
    require(cli_trusted_bytes(path, mode=mode, maximum=64 * 1024**2) == raw, "PUBLISHED_SNAPSHOT")
    return path


def published_gh_binary(raw, pin):
    """Read only the expected regular ELF after checking this immutable archive."""
    require(type(raw) is bytes and len(raw) == pin["bytes"]
            and hashlib.sha256(raw).hexdigest() == pin["sha256"], "PUBLISHED_GH_ARCHIVE")
    prefix = "gh_2.101.0_linux_amd64/"
    seen, total, executable = set(), 0, None
    try:
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as archive:
            for member in archive:
                name = member.name
                require(member.isfile() and not member.pax_headers and name.startswith(prefix)
                        and "\\" not in name and name not in seen
                        and all(part not in ("", ".", "..") for part in name.split("/"))
                        and 0 <= member.size <= 64 * 1024**2, "PUBLISHED_GH_MEMBER")
                seen.add(name)
                total += member.size
                require(len(seen) <= 512 and total <= 64 * 1024**2, "PUBLISHED_GH_MEMBER")
                if name == prefix + "bin/gh":
                    require(member.size == pin["executableBytes"], "PUBLISHED_GH_ELF")
                    executable = archive.extractfile(member).read(member.size + 1)
    except (tarfile.TarError, OSError, EOFError):
        raise Failure("PUBLISHED_GH_MEMBER") from None
    require(type(executable) is bytes and len(executable) == pin["executableBytes"]
            and executable.startswith(b"\x7fELF\x02\x01\x01")
            and executable[18:20] == b"\x3e\x00"
            and hashlib.sha256(executable).hexdigest() == pin["executableSha256"], "PUBLISHED_GH_ELF")
    return executable


def published_environment(owner, gh):
    token, _, _ = diagnostic_read(GUEST_PRIVATE / "github-read-token", GUEST_PRIVATE, 0, maximum=16384)
    require(token and b"\x00" not in token and b"\r" not in token and b"\n" not in token, "PUBLISHED_TOKEN_FILE")
    try:
        token = token.decode("ascii")
    except UnicodeError:
        raise Failure("PUBLISHED_TOKEN_FILE") from None
    return {"PATH": str(Path(gh).parent) + ":/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "HOME": owner["home"], "USER": "asa-ci", "LOGNAME": "asa-ci", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8",
            "GH_TOKEN": token, "GH_HOST": "github.com", "GH_PROMPT_DISABLED": "1", "GH_NO_UPDATE_NOTIFIER": "1",
            "GH_NO_EXTENSION_UPDATE_NOTIFIER": "1", "GH_PAGER": "cat", "NO_COLOR": "1", "PYTHONDONTWRITEBYTECODE": "1"}


def published_verify_command(gh, path, revision):
    require(type(revision) is str and HEX40.fullmatch(revision), "PUBLISHED_CONTEXT")
    return [str(gh), "attestation", "verify", str(path), "--repo", REPOSITORY,
            "--signer-workflow", PUBLISHED_WORKFLOW, "--source-ref", PUBLISHED_REF,
            "--source-digest", revision, "--deny-self-hosted-runners"]


def published_helper_bytes(context, download, owner):
    asset = "asa-setup-acquire-" + context["sourceRevision"] + ".py"
    raw, info, _ = diagnostic_read(Path(download) / asset, download, owner["uid"], maximum=1024**2)
    require(info.st_gid == owner["gid"] and raw
            and hashlib.sha256(raw).hexdigest() == context["acquisition"]["helperSha256"], "PUBLISHED_HELPER_SOURCE")
    return raw


def published_no_installation():
    require(not os.path.lexists(INSTALL_ROOT) and not os.path.lexists("/var/lib/asa-setup/operator.json"),
            "PUBLISHED_INSTALLATION_APPEARED")


def published_archive(context, verifier):
    """Observe the helper's actual root snapshot, never stage the source oracle."""
    base = candidate_bundle(context).parent
    entries = []
    for entry in base.iterdir():
        require(len(entries) < 2, "PUBLISHED_ACQUIRED_PATHS")
        entries.append(entry)
    require(len(entries) == 2 and candidate_bundle(context) in entries, "PUBLISHED_ACQUIRED_PATHS")
    incoming = [path for path in entries if re.fullmatch(r"acquire-[a-z0-9_]{8}", path.name)]
    require(len(incoming) == 1, "PUBLISHED_ACQUIRED_PATHS")
    path = incoming[0] / ("asa-setup-" + context["sourceRevision"] + ".tar.gz")
    members = incoming[0].iterdir()
    require(next(members, None) == path and next(members, None) is None, "PUBLISHED_ACQUIRED_PATHS")
    raw = cli_trusted_bytes(path, mode=0o444, maximum=verifier.MAX_PACKAGE_BYTES)
    digest = hashlib.sha256(raw).hexdigest()
    manifest, files = verifier.inspect_archive(raw, revision=context["sourceRevision"], sha256=digest)
    oracle = cli_trusted_bytes(GUEST_PRIVATE / "candidate.tar.gz", mode=0o600, maximum=verifier.MAX_PACKAGE_BYTES)
    expected_manifest, expected_files = verifier.inspect_archive(oracle, revision=context["sourceRevision"], sha256=context["bundleSha256"])
    require(manifest == expected_manifest and files == expected_files
            and hashlib.sha256(files["tools/asa_setup_acquire.py"]).hexdigest() == context["acquisition"]["helperSha256"],
            "PUBLISHED_SOURCE_MISMATCH")
    return {"sha256": digest, "bytes": len(raw), "manifestSha256": canonical_hash(manifest),
            "files": len(files), "sourceOracleFilesMatch": True, "protectedHelperSnapshotObserved": True}


class PublishedAcquisition:
    def __init__(self, context):
        self.context, self.request = context, published_context(context)
        self.owner = published_administrator(context)
        self.deadline = time.monotonic() + PUBLISHED_SECONDS
        self.report = {"status": "PENDING", "sourceRevision": context["sourceRevision"], "repository": REPOSITORY,
                       "signerWorkflow": PUBLISHED_WORKFLOW, "sourceRef": PUBLISHED_REF,
                       "manualCandidateStage": False, "steps": {}, "completedProcessGroups": 0,
                       "allOwnedProcessesExited": True}
        self.environment = None

    def remaining(self, maximum):
        remaining = self.deadline - time.monotonic()
        require(remaining > 0, "BLOCKED_PUBLISHED_ACQUISITION_BUDGET", status="BLOCKED")
        return min(maximum, remaining)

    def command(self, step, arguments, *, timeout=180, network=False):
        require(step in {"gh-version", "gh-flags", "sudo-access", "helper-download", "helper-attestation", "helper-execution", "public-help"},
                "PUBLISHED_STEP")
        self.report["steps"][step] = "PENDING"
        environment = dict(self.environment)
        if not network:
            environment.pop("GH_TOKEN", None)
        budget = self.remaining(timeout)
        child = None
        self.report["allOwnedProcessesExited"] = False
        try:
            with OwnedFaultProcess(arguments, environment=environment, deadline=time.monotonic() + budget,
                                   owner=self.owner, administrator=True) as child:
                code, raw = child.wait(budget)
                require(child.closed, "PUBLISHED_PROCESS_QUIESCENCE")
        finally:
            self.report["allOwnedProcessesExited"] = child is not None and child.closed is True
        require(type(code) is int and code == 0, "PUBLISHED_CHILD_EXIT")
        require(len(raw) <= 65536, "PUBLISHED_CHILD_OUTPUT")
        self.report["completedProcessGroups"] += 1
        self.report["steps"][step] = "PASS"
        return raw

    def run(self):
        context = self.context
        published_no_installation()
        require(not any(os.path.lexists(path) for path in ("/opt/asa-setup", "/usr/local/bin/asa", "/etc/asa-lab/commands.json")),
                "PUBLISHED_GUEST_NOT_CLEAN")
        self.report["steps"]["clean-guest"] = "PASS"
        published_directory(PUBLISHED_HOME)
        gh_directory = PUBLISHED_HOME / "github-cli"
        published_directory(gh_directory)
        raw = cli_trusted_bytes(GUEST_PRIVATE / "github-cli.tar.gz", mode=0o600, maximum=GH_PIN["bytes"])
        archive = published_snapshot(gh_directory, "gh_2.101.0_linux_amd64.tar.gz", raw)
        protected = cli_trusted_bytes(archive, mode=0o444, maximum=GH_PIN["bytes"])
        executable = published_gh_binary(protected, GH_PIN)
        gh = published_snapshot(gh_directory, "gh", executable, mode=0o555)
        gh_directory.chmod(0o555)
        self.environment = published_environment(self.owner, gh)
        version = self.command("gh-version", [gh, "--version"], timeout=30)
        require(version.startswith(b"gh version 2.101.0 "), "PUBLISHED_GH_VERSION")
        flags = self.command("gh-flags", [gh, "attestation", "verify", "--help"], timeout=30)
        require(all(re.search(rb"(?<!\S)" + flag + rb"(?:\s|[=,])", flags) for flag in (
            b"--signer-workflow", b"--source-ref", b"--source-digest", b"--deny-self-hosted-runners")), "PUBLISHED_GH_FLAGS")
        self.report["githubCli"] = {"version": GH_PIN["version"], "sourceRevision": GH_PIN["sourceRevision"],
                                   "archiveSha256": GH_PIN["sha256"], "executableSha256": GH_PIN["executableSha256"], "requiredFlags": True}
        self.command("sudo-access", ["/usr/bin/sudo", "-n", "-v"], timeout=30)
        download = PUBLISHED_HOME / "download"
        published_directory(download, mode=0o700)
        os.chown(download, self.owner["uid"], self.owner["gid"])
        asset = "asa-setup-acquire-" + context["sourceRevision"] + ".py"
        self.command("helper-download", [gh, "release", "download", "setup-" + context["sourceRevision"],
            "--repo", REPOSITORY, "--pattern", asset, "--dir", download], network=True)
        raw = published_helper_bytes(context, download, self.owner)
        helper_directory = PUBLISHED_HOME / "verified-helper"
        published_directory(helper_directory)
        helper = published_snapshot(helper_directory, asset, raw)
        helper_directory.chmod(0o555)
        helper_identity = diagnostic_metadata(helper.stat())
        self.command("helper-attestation", published_verify_command(gh, helper, context["sourceRevision"]), network=True)
        require(cli_trusted_bytes(helper, mode=0o444, maximum=1024**2) == raw
                and diagnostic_metadata(helper.stat()) == helper_identity, "PUBLISHED_HELPER_CHANGED")
        self.report["helper"] = {"asset": asset, "sha256": self.request["helperSha256"],
                                 "actualUid": self.owner["uid"], "attestationVerified": True, "protectedSnapshot": True}
        self.command("helper-execution", ["/usr/bin/python3", "-I", "-B", helper, "--revision", context["sourceRevision"]],
                     timeout=600, network=True)
        require(cli_trusted_bytes(helper, mode=0o444, maximum=1024**2) == raw
                and diagnostic_metadata(helper.stat()) == helper_identity, "PUBLISHED_HELPER_CHANGED")
        published_no_installation()
        verifier = cli_trusted_module("setup_bundle.py", context)
        self.remaining(30)
        self.report["archive"] = published_archive(context, verifier)
        self.report["registration"] = cli_candidate_binding(context, verifier, prepared=True)
        self.report["steps"]["independent-package-verification"] = "PASS"
        raw = self.command("public-help", ["/usr/local/bin/asa", "help", "--json", "--no-color"], timeout=30)
        value = json.loads(raw.decode("utf-8"))
        require(type(value) is dict and value.get("format") == "asa-cli-result-v1" and value.get("command") == "help"
                and value.get("status") == "OK" and type(value.get("exitCode")) is int and value["exitCode"] == 0
                and type(value.get("help")) is dict and b"\x1b" not in raw, "PUBLISHED_PUBLIC_HELP")
        published_no_installation()
        self.remaining(1)
        self.report.update(status="PASS", beforeInstall=True, publicHelp={"status": "OK", "exitCode": 0,
                           "cwd": "/", "utf8": True, "noColor": True}, allOwnedProcessesExited=True)
        return self.report


def published_acquire_guest(context):
    require(os.geteuid() == 0, "GUEST_ROOT_REQUIRED")
    run = PublishedAcquisition(context)
    try:
        return {"publishedSetupAcquisition": run.run()}
    except BaseException as error:
        run.report.update(status=getattr(error, "status", "FAIL"), reasonCode=safe_error(error))
        if getattr(error, "owned_cleanup_failed", False):
            run.report["allOwnedProcessesExited"] = False
        error.acquisition_evidence = run.report
        raise


def prepare_guest_cli(context, commands):
    if guest_acquisition_mode(context) == "published":
        published_no_installation()
        return {"candidateStage": "NOT_RUN", "publishedAcquisition": "REQUIRED_NEXT_PHASE"}
    bundle = candidate_bundle(context)
    bundle.parent.mkdir(mode=0o755, exist_ok=True)
    commands.run(["/usr/bin/python3", "-I", "-B", GUEST_HOME / "setup_bundle.py", "stage",
                  "--archive", GUEST_PRIVATE / "candidate.tar.gz", "--destination", bundle,
                  "--revision", context["sourceRevision"], "--sha256", context["bundleSha256"]], timeout=60)
    _, raw = commands.run(["/usr/bin/python3", "-I", "-B", bundle / "tools/asa_cli.py", "prepare", "--bundle", bundle, "--json"])
    require(json.loads(raw).get("status") == "OK" and Path("/usr/local/bin/asa").is_file(), "PUBLIC_CLI_PREPARATION")
    public_cli(["help"], timeout=30)
    return {"candidateStage": "manual trusted stage inside disposable guest only", "publishedAcquisition": "BLOCKED"}


def bootstrap_guest(context):
    guest_acquisition_mode(context)
    require(os.geteuid() == 0 and not Path("/usr/local/bin/1panel-core").exists()
            and not INSTALL_ROOT.exists(), "GUEST_NOT_CLEAN")
    commands, panel = Commands(), context["pins"]["onePanel"]
    archive = GUEST_PRIVATE / "onepanel.tar.gz"
    require(hash_file(archive) == panel["sha256"] and archive.stat().st_size == panel["bytes"], "ONEPANEL_ARCHIVE_PIN")
    extracted = GUEST_PRIVATE / "onepanel-package"
    extracted.mkdir(mode=0o700)
    with tarfile.open(archive, "r:gz") as source:
        require(sum(item.size for item in source.getmembers()) < GIB, "ONEPANEL_ARCHIVE_SIZE")
        source.extractall(extracted, filter="data")
    installers = [path for path in extracted.rglob("install.sh") if path.is_file()]
    require(len(installers) == 1 and hash_file(installers[0]) == panel["installerSha256"], "ONEPANEL_INSTALLER_PIN")
    commands.run(["apt-get", "update"], environment=guest_environment(), timeout=300)
    commands.run(["apt-get", "install", "-y", "--no-install-recommends", "ca-certificates", "curl", "wget", "tar"],
                 environment=guest_environment(), timeout=300)
    environment = guest_environment()
    environment.update(PANEL_PASSWORD=secrets.token_hex(8) + "A!", PANEL_EDITION="intl")
    # The genuine installer prints initial credentials. Commands captures all
    # stdout/stderr in a private temporary file and never returns it publicly.
    commands.run(["bash", installers[0], "--non-interactive", "--lang", "en", "--install-dir", "/opt",
                  "--port", "19192", "--entrance", "asarealhost", "--username", "asaacceptance",
                  "--install-docker", "y", "--docker-mode", "online", "--configure-accelerator", "n",
                  "--replace-daemon-json", "n"], cwd=installers[0].parent, environment=environment, timeout=1500)
    for name in ("1panel-core", "1panel-agent"):
        packaged = [path for path in extracted.rglob(name) if path.is_file()]
        require(len(packaged) == 1 and hash_file(packaged[0]) == hash_file(Path("/usr/local/bin") / name), "ONEPANEL_INSTALLED_BYTES")
    deadline = time.monotonic() + 120
    synchronized = False
    while time.monotonic() < deadline:
        _, clock = commands.run(["timedatectl", "show", "-p", "NTPSynchronized", "--value"])
        if clock.strip() == b"yes":
            synchronized = True
            break
        time.sleep(2)
    require(synchronized, "BLOCKED_GUEST_TIME_SYNC", status="BLOCKED")
    baseline = panel_and_docker_identity()
    write_json(GUEST_PRIVATE / "host-baseline.json", baseline)
    return {"onePanelVersion": panel["version"], "officialInstallerSha256": panel["installerSha256"],
            "actualInstalledBytesVerified": True, "systemdPid1": True, "ntpSynchronized": True,
            "hostBaseline": baseline, **prepare_guest_cli(context, commands)}


def last_setup_receipt():
    path = INSTALL_ROOT / ".asa/setup-last-attempt.json"
    require(path.is_file() and not path.is_symlink(), "SETUP_RECEIPT_MISSING")
    value = json.loads(path.read_text())
    require(value.get("format") == "asa-setup-result-v1", "SETUP_RECEIPT_FORMAT")
    return value


def receipt_projection(value):
    output = {}
    for field, pattern in (("operationId", r"[a-f0-9]{32}"), ("installationId", r"[a-f0-9]{32}")):
        require(isinstance(value.get(field), str) and re.fullmatch(pattern, value[field]), "SETUP_RECEIPT_BINDING")
        output[field] = value[field]
    for field in ("outcome", "mode", "reasonCode"):
        observed = value.get(field)
        if isinstance(observed, str) and (observed in STATES or CODE.fullmatch(observed) or observed in ("install", "update", "backup", "retry-cloud")):
            output[field] = observed
    output["applicationAccepted"] = value.get("applicationAccepted") is True
    output["dataProtectionConfirmed"] = value.get("dataProtectionConfirmed") is True
    output["technicalStatus"] = value.get("site", {}).get("technical", {}).get("status") == "passed"
    output["browserStatus"] = value.get("site", {}).get("browser", {}).get("status") == "passed"
    return output


def require_application(value, pin):
    require(value.get("exitCode") == 0 and value.get("applicationAccepted") is True
            and value.get("site", {}).get("technical", {}).get("status") == "passed"
            and value.get("site", {}).get("browser", {}).get("status") == "passed"
            and value.get("version", {}).get("selected") == pin["revision"], "APPLICATION_ACCEPTANCE")
    require(value.get("site", {}).get("url") == ORIGIN, "APPLICATION_ORIGIN")


def public_observation(pin):
    version = public_cli(["version"], timeout=120)
    status = public_cli(["status"], timeout=120)
    services = public_cli(["services"], timeout=120)
    require(version.get("application", {}).get("revision") == status.get("installed", {}).get("revision") == pin["revision"]
            and version.get("database", {}).get("schema") == status.get("database", {}).get("schema") == pin["schema"],
            "PUBLIC_VERSION_SCHEMA")
    require(status.get("status") == services.get("status") == "OK", "PUBLIC_LIVE_STATE")
    return {"revision": pin["revision"], "schema": pin["schema"], "status": "OK", "services": "OK"}


def install_guest(context):
    import pwd
    require(not INSTALL_ROOT.exists(), "INSTALL_TARGET_EXISTS")
    identity = uuid.uuid4().hex
    config = {"format": "asa-setup-config-v1", "installationId": identity, "root": str(INSTALL_ROOT),
              "operatorUid": None, "profile": "production", "entryOrigin": ORIGIN, "project": "asa-lab-dev",
              "backupDirectory": str(INSTALL_ROOT / "backups"), "browser": {},
              "onboardingFile": "/var/lib/asa-setup/operator/onboarding.json",
              "ports": {"web": 4610, "api": 4611, "blocks": 4613},
              "backup": {"policy": "best-effort", "ageRecipient": context["ageRecipient"], "cloud": {"enabled": False},
                         "maxWriteFreezeSeconds": 900, "retention": {"localKeep": None, "remoteKeep": None},
                         "schedule": {"enabled": False, "time": "03:00", "timezone": "UTC", "maxAgeHours": 26}}}
    supplied = GUEST_PRIVATE / "install-input.json"
    write_json(supplied, config)
    options = ["--config-file", str(supplied), "--deployment-digest", context["pins"]["previous"]["deploymentDigest"], "--non-interactive"]
    first_install_attempt(context, options)
    operator = json.loads(Path("/var/lib/asa-setup/operator.json").read_text())
    account = pwd.getpwnam("asa-setup")
    require(operator["uid"] == account.pw_uid != 0 and operator["root"] == str(INSTALL_ROOT)
            and operator["home"] == account.pw_dir == "/var/lib/asa-setup/operator", "FRESH_OPERATOR_RECEIPT")
    onboarding = Path(config["onboardingFile"])
    require(not onboarding.exists(), "ONBOARDING_ALREADY_EXISTS")
    write_json(onboarding, {"format": "asa-owner-onboarding-v1", "installationId": identity, "status": "NEW",
                           "email": "asa-realhost-" + identity[:12] + "@example.invalid", "username": "realhost_" + identity[:12],
                           "displayName": "ASA synthetic acceptance", "birthDate": "1980-01-01", "country": "RU",
                           "password": secrets.token_hex(24)})
    os.chown(onboarding, account.pw_uid, account.pw_gid)
    runtime = Path(account.pw_dir) / ".local/share/asa-setup/playwright-1.56.0"
    require((runtime / "asa-runtime.json").is_file(), "OPERATOR_BROWSER_BOOTSTRAP")
    config["operatorUid"] = account.pw_uid
    config["browser"] = {"componentPath": str(candidate_bundle(context) / "tools/deployment/ops/asa_ops/browser_acceptance.py"),
                         "componentSha256": context["pins"]["browser"]["componentSha256"],
                         "pythonPath": str(runtime / "bin/python"), "browsersPath": str(runtime / "browsers"),
                         "fixturePath": str(INSTALL_ROOT / ".asa/acceptance/fixture.json"), "timeoutSeconds": 600}
    write_json(supplied, config)
    public_cli(["install"], options=options, timeout=2400)
    value = last_setup_receipt()
    require_application(value, context["pins"]["previous"])
    first_backup = snapshot_proof(value["operationId"])
    require(value.get("backup", {}).get("snapshotId") == first_backup["snapshotId"], "FIRST_BACKUP_RECEIPT")
    public_cli(["backup", "verify"], options=["--snapshot-id", first_backup["snapshotId"]], timeout=180)
    require(json.loads(onboarding.read_text()).get("status") == "READY", "OWNER_ONBOARDING_NOT_READY")
    require(panel_and_docker_identity() == root_json("host-baseline.json"), "ONEPANEL_DOCKER_CHANGED")
    observation = public_observation(context["pins"]["previous"])
    for words in (["doctor"], ["disk", "usage"], ["disk", "health"],
                  ["backup", "status"], ["cloud", "status"], ["config", "show"]):
        public_cli(words, allowed=(0, 1, 2), timeout=120)
    return {"runtime": context["pins"]["previous"], "firstBootstrapBlock": "OWNER_INPUT_REQUIRED",
            "defaultOperatorCreatedByPublicInstall": True, "externalPrivateOnboardingFixture": True,
            "sameInstallationIdRetried": True, "receipt": receipt_projection(value),
            "firstBackup": first_backup, "onePanelAndDockerPreserved": True,
            "publicObservation": observation, "publicHTTPS": "NOT_RUN"}


def require_empty_public_origins(install):
    """Inspect resolved Compose and the bound API privately; export no environment."""
    require(install.env.get("ASA_SETUP_PUBLIC_ORIGINS") == "empty-overlay-v1"
            and install.env.get("ASA_PUBLIC_WEB_ORIGINS") == "", "PUBLIC_ORIGINS_POLICY")
    resolved = json.loads(install.compose("config", "--format", "json", capture=True, timeout=30))
    environment = resolved.get("services", {}).get("api", {}).get("environment", {})
    require(isinstance(environment, dict) and environment.get("ASA_PUBLIC_WEB_ORIGINS") == "", "PUBLIC_ORIGINS_RESOLVED")
    records = install.identity()
    actual = install.container_environment(records["api"])
    require(actual.get("ASA_PUBLIC_WEB_ORIGINS") == "", "PUBLIC_ORIGINS_CONTAINER")
    return {"status": "PASS", "additionalPublicOrigins": 0}


def owner_installation(context):
    require(os.geteuid() != 0, "FIXTURE_MUST_BE_UNPRIVILEGED")
    config_module, acceptance, schedule, installation, helpers = product_modules(context)
    config = config_module.load_config(INSTALL_ROOT, os.geteuid())
    install = installation(INSTALL_ROOT, config["profile"])
    release = config_module.read_installed_release(INSTALL_ROOT)
    install.wait_ready(release["revision"], release["schema"])
    require(install.env.get("ASA_UPDATE_ENTRY_ORIGIN") == install.env.get("ASA_BLOCKS_PARENT_ORIGIN")
            == install.env.get("ASA_BLOCKS_RUNTIME_ORIGIN") == ORIGIN, "SAME_ORIGIN")
    require_empty_public_origins(install)
    return config_module, acceptance, schedule, install, helpers, config, release


def control_rows(install, helpers, identities=None):
    records = install.identity()
    postgres = records["postgres"]["id"]
    values, found = {}, {}
    for table in TABLES:
        where = ""
        if identities is not None:
            ids = identities[table]
            require(ids and all(isinstance(value, str) and UUID.fullmatch(value) for value in ids), "CONTROL_IDS")
            where = " WHERE t.id::text IN (" + ",".join("'" + value + "'" for value in ids) + ")"
        raw = helpers.sql_container(postgres, install.env["POSTGRES_USER"], install.env["POSTGRES_DB"],
                                    "SELECT COALESCE(json_agg(to_jsonb(t) ORDER BY t.id::text), '[]'::json) FROM public." + table + " t" + where)
        rows = json.loads(raw)
        found[table] = sorted(row["id"] for row in rows)
        values[table] = {"rows": len(rows), "sha256": canonical_hash(rows)}
        if identities is not None:
            require(found[table] == sorted(identities[table]), "CONTROL_ROW_MISSING")
    return values, found


def s3_command(install, helpers, *, create=False):
    prefix = 'mc alias set local http://minio:9000 "$ASA_OBJECT_STORAGE_ACCESS_KEY" "$ASA_OBJECT_STORAGE_SECRET_KEY" >/dev/null; '
    suffix = ("printf %s " + shlex.quote(helpers.OBJECT_CONTENT) + ' | mc pipe "local/$ASA_OBJECT_STORAGE_BUCKET/' + helpers.OBJECT_NAME + '"') if create else ('mc cat "local/$ASA_OBJECT_STORAGE_BUCKET/' + helpers.OBJECT_NAME + '"')
    return install.compose("run", "--rm", "--no-deps", "--entrypoint", "/bin/sh", "minio-init", "-eu", "-c",
                           prefix + suffix, capture=True, timeout=90)


def control_runtime_role_credential(verifier, password):
    """Only the generated native fixture credential may ignore SCRAM salt churn."""
    require(type(password) is str and re.fullmatch(r"[a-f0-9]{48}", password), "CONTROL_ROLE_CREDENTIAL")
    require(type(verifier) is str and len(verifier) == 133, "CONTROL_ROLE_CREDENTIAL")
    match = re.fullmatch(r"SCRAM-SHA-256\$4096:([A-Za-z0-9+/]{22}==)\$([A-Za-z0-9+/]{43}=):([A-Za-z0-9+/]{43}=)", verifier)
    require(match is not None, "CONTROL_ROLE_CREDENTIAL")
    values = []
    for encoded, size in zip(match.groups(), (16, 32, 32)):
        try:
            decoded = base64.b64decode(encoded, validate=True)
        except ValueError:
            raise Failure("CONTROL_ROLE_CREDENTIAL") from None
        require(len(decoded) == size and base64.b64encode(decoded).decode("ascii") == encoded, "CONTROL_ROLE_CREDENTIAL")
        values.append(decoded)
    salt, stored_key, server_key = values
    secret = password.encode("ascii")
    salted = hashlib.pbkdf2_hmac("sha256", secret, salt, 4096, dklen=32)
    client_key = hmac.new(salted, b"Client Key", hashlib.sha256).digest()
    stored_matches = hmac.compare_digest(hashlib.sha256(client_key).digest(), stored_key)
    server_matches = hmac.compare_digest(hmac.new(salted, b"Server Key", hashlib.sha256).digest(), server_key)
    require(stored_matches and server_matches, "CONTROL_ROLE_CREDENTIAL")
    # This identity is hashed with the full role row, never emitted separately.
    return {"format": "asa-native-runtime-role-credential-v1", "algorithm": "SCRAM-SHA-256", "iterations": 4096,
            "saltBytes": 16, "storedKeyBytes": 32, "serverKeyBytes": 32,
            "credentialIdentity": hmac.new(secret, b"asa-native-runtime-app-role-v1", hashlib.sha256).hexdigest()}


def control_role_fingerprint(install, helpers, postgres):
    """Keep every role attribute exact except the verified app-role salt bytes."""
    statement = """SELECT json_agg(t ORDER BY rolname) FROM (
      SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,
             rolreplication,rolbypassrls,rolconnlimit,rolpassword,rolvaliduntil
      FROM pg_authid WHERE rolname !~ '^pg_' AND rolname <> 'asa_ci_restore_admin'
    ) t"""
    raw = helpers.sql_container(postgres, install.env["POSTGRES_USER"], install.env["POSTGRES_DB"], statement)
    require(type(raw) is str and len(raw) <= 64 * 1024, "CONTROL_ROLE_ROWS")
    try:
        require(len(raw.encode("utf-8")) <= 64 * 1024, "CONTROL_ROLE_ROWS")
    except UnicodeError:
        raise Failure("CONTROL_ROLE_ROWS") from None

    def unique_object(pairs):
        value = {}
        for key, item in pairs:
            require(key not in value, "CONTROL_ROLE_ROWS")
            value[key] = item
        return value

    def nonfinite(value):
        raise Failure("CONTROL_ROLE_ROWS")

    try:
        rows = json.loads(raw, object_pairs_hook=unique_object, parse_constant=nonfinite)
    except (ValueError, RecursionError):
        raise Failure("CONTROL_ROLE_ROWS") from None
    require(type(rows) is list and 1 <= len(rows) <= 128, "CONTROL_ROLE_ROWS")
    flags = ("rolsuper", "rolinherit", "rolcreaterole", "rolcreatedb", "rolcanlogin", "rolreplication", "rolbypassrls")
    fields = set(flags) | {"rolname", "rolconnlimit", "rolpassword", "rolvaliduntil"}
    names = []
    for row in rows:
        require(type(row) is dict and set(row) == fields and type(row["rolname"]) is str
                and 1 <= len(row["rolname"]) <= 63 and all(type(row[key]) is bool for key in flags)
                and type(row["rolconnlimit"]) is int and -1 <= row["rolconnlimit"] <= 2**31 - 1
                and (row["rolpassword"] is None or type(row["rolpassword"]) is str and len(row["rolpassword"]) <= 1024)
                and (row["rolvaliduntil"] is None or type(row["rolvaliduntil"]) is str and len(row["rolvaliduntil"]) <= 128),
                "CONTROL_ROLE_ROWS")
        names.append(row["rolname"])
    require(names.count("asalab_app") == 1 and len(names) == len(set(names)), "CONTROL_ROLE_ROWS")
    normalized = []
    for row in rows:
        value = dict(row)
        if row["rolname"] == "asalab_app":
            value["rolpassword"] = control_runtime_role_credential(row["rolpassword"], install.env.get("ASA_APP_DB_PASSWORD"))
        normalized.append(value)
    return hashlib.sha256(json.dumps(normalized, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def control_comparison_projection(before, after):
    """Describe only the already-collected comparison; never expose row values."""
    components = ("rolesSha256", "aclRlsSha256", "privateEnvironmentSha256", "storageIdentitySha256", "authenticatedS3Sha256")
    tables = (*TABLES, "project_drafts")

    def shape(value):
        return (type(value) is dict and set(value) == {"rows", *components}
                and type(value["rows"]) is dict and set(value["rows"]) == set(tables))

    def digest(value):
        return type(value) is str and re.fullmatch(r"[a-f0-9]{64}", value) is not None

    def row(value):
        return (type(value) is dict and set(value) == {"rows", "sha256"}
                and type(value["rows"]) is int and 0 <= value["rows"] <= 2**63 - 1 and digest(value["sha256"]))

    available = shape(before) and shape(after)
    result = {"format": "asa-realhost-control-comparison-v1", "phase": "owner-observe",
              "shape": "SAME" if available else "UNAVAILABLE", "components": {}, "tables": {}}
    for key in components:
        known = available and digest(before[key]) and digest(after[key])
        result["components"][key] = ("SAME" if before[key] == after[key] else "CHANGED") if known else "UNAVAILABLE"
    for key in tables:
        known = available and row(before["rows"][key]) and row(after["rows"][key])
        result["tables"][key] = ("SAME" if before["rows"][key] == after["rows"][key] else "CHANGED") if known else "UNAVAILABLE"
    return result


def control_comparison_evidence(value):
    """Revalidate the small owner-process diagnostic at each failure boundary."""
    empty = control_comparison_projection(None, None)
    require(type(value) is dict and set(value) == set(empty) and type(value["format"]) is str and value["format"] == empty["format"]
            and type(value["phase"]) is str and value["phase"] == "owner-observe" and type(value["shape"]) is str
            and value["shape"] in ("SAME", "UNAVAILABLE"), "CONTROL_COMPARISON_INVALID")
    output = {"format": empty["format"], "phase": "owner-observe", "shape": value["shape"]}
    for group in ("components", "tables"):
        require(type(value[group]) is dict and set(value[group]) == set(empty[group]), "CONTROL_COMPARISON_INVALID")
        output[group] = {}
        for key in empty[group]:
            state = value[group][key]
            require(type(state) is str and state in ("SAME", "CHANGED", "UNAVAILABLE"), "CONTROL_COMPARISON_INVALID")
            output[group][key] = state
    return output


def control_fingerprint(install, helpers, acceptance, identities):
    rows, _ = control_rows(install, helpers, identities)
    records = install.identity()
    postgres = records["postgres"]["id"]
    environment = {key: value for key, value in install.env.items() if key not in ("ASA_BUILD_REVISION", "ASA_EXPECTED_SCHEMA_VERSION")
                   and not (key.startswith("ASA_") and key.endswith("_IMAGE"))}
    privileges = helpers.sql_container(postgres, install.env["POSTGRES_USER"], install.env["POSTGRES_DB"], helpers.PRIVILEGES_SQL)
    project_ids = identities["projects"]
    require(all(UUID.fullmatch(value) for value in project_ids), "CONTROL_PROJECT_IDS")
    drafts = json.loads(helpers.sql_container(postgres, install.env["POSTGRES_USER"], install.env["POSTGRES_DB"],
        "SELECT COALESCE(json_agg(to_jsonb(t) ORDER BY t.project_id::text), '[]'::json) FROM public.project_drafts t WHERE t.project_id::text IN ("
        + ",".join("'" + value + "'" for value in project_ids) + ")"))
    require(len(drafts) == len(project_ids), "CONTROL_DRAFT_MISSING")
    rows["project_drafts"] = {"rows": len(drafts), "sha256": canonical_hash(drafts)}
    actual_object = s3_command(install, helpers)
    require(actual_object == helpers.OBJECT_CONTENT, "AUTHENTICATED_S3_CONTENT")
    return {"rows": rows, "rolesSha256": control_role_fingerprint(install, helpers, postgres),
            "aclRlsSha256": canonical_hash(json.loads(privileges)), "privateEnvironmentSha256": canonical_hash(environment),
            "storageIdentitySha256": canonical_hash(acceptance.storage_identity(records)),
            "authenticatedS3Sha256": hashlib.sha256(actual_object.encode()).hexdigest()}


def control_browser_evidence(value, phase):
    """Rebuild the closed diagnostic at each process boundary; never relay raw data."""
    phase = phase if type(phase) is str and phase in ("BEFORE", "AFTER") else "UNAVAILABLE"
    unavailable = {"format": "asa-realhost-control-browser-v1", "phase": phase, "binding": "UNAVAILABLE"}
    try:
        require(type(value) is dict and phase != "UNAVAILABLE", "CONTROL_BROWSER_DIAGNOSTIC")
        if value == unavailable:
            return unavailable
        require(set(value) == {"format", "phase", "binding", "fixtureArgument", "target", "runtimeProvenance",
                               "status", "reason", "checks", "error"}
                and value["format"] == unavailable["format"] and value["phase"] == phase
                and value["binding"] == "DIRECT_INVOCATION" and value["fixtureArgument"] == "REALHOST_CONTROL"
                and value["target"] == ("PREVIOUS_RUNTIME" if phase == "BEFORE" else "CURRENT_RUNTIME"),
                "CONTROL_BROWSER_DIAGNOSTIC")
        status, provenance, checks = value["status"], value["runtimeProvenance"], value["checks"]
        require(type(status) is str and status in ("failed", "incomplete", "environment_failed")
                and type(provenance) is str and provenance in ("PINNED_INVOCATION", "NOT_RECORDED")
                and type(checks) is dict and set(checks) == set(RECEIPT_BROWSER_CHECKS)
                and all(type(item) is str and item in ("passed", "failed", "not_run") for item in checks.values()),
                "CONTROL_BROWSER_DIAGNOSTIC")
        require((status == "failed" and provenance == "PINNED_INVOCATION"
                 and all(item in ("passed", "failed") for item in checks.values()) and "failed" in checks.values())
                or (status != "failed" and all(item == "not_run" for item in checks.values())), "CONTROL_BROWSER_DIAGNOSTIC")

        def reason(record, allowed, *, http=False):
            require(type(record) is dict and type(record.get("state")) is str, "CONTROL_BROWSER_DIAGNOSTIC")
            state = record["state"]
            if state in ("MISSING", "NULL") and set(record) == {"state"}:
                return {"state": state}
            if state == "UNRECOGNIZED" and set(record) == {"state", "type"} and record["type"] in ("STRING", "NON_STRING"):
                return {"state": state, "type": record["type"]}
            if state == "RECOGNIZED" and set(record) == {"state", "code"} and type(record["code"]) is str and record["code"] in allowed:
                return {"state": state, "code": record["code"]}
            if (http and state == "RECOGNIZED" and set(record) == {"state", "code", "httpStatus"}
                    and record["code"] == "API_STATUS" and type(record["httpStatus"]) is int and 100 <= record["httpStatus"] <= 599):
                return {"state": state, "code": "API_STATUS", "httpStatus": record["httpStatus"]}
            raise Failure("CONTROL_BROWSER_DIAGNOSTIC")

        error = value["error"]
        require(type(error) is dict, "CONTROL_BROWSER_DIAGNOSTIC")
        if set(error) == {"state"} and type(error["state"]) is str and error["state"] in ("MISSING", "NULL", "UNRECOGNIZED"):
            projected_error = {"state": error["state"]}
        else:
            require(set(error) == {"stage", "code"} and type(error["stage"]) is str
                    and error["stage"] in RECEIPT_BROWSER_STAGES | {"UNAVAILABLE", "UNRECOGNIZED"}, "CONTROL_BROWSER_DIAGNOSTIC")
            projected_error = {"stage": error["stage"], "code": reason(error["code"], RECEIPT_BROWSER_ERRORS, http=True)}
        return {"format": unavailable["format"], "phase": phase, "binding": "DIRECT_INVOCATION",
                "fixtureArgument": "REALHOST_CONTROL", "target": "PREVIOUS_RUNTIME" if phase == "BEFORE" else "CURRENT_RUNTIME",
                "runtimeProvenance": provenance, "status": status,
                "reason": reason(value["reason"], RECEIPT_BROWSER_REASONS),
                "checks": {key: checks[key] for key in RECEIPT_BROWSER_CHECKS}, "error": projected_error}
    except BaseException:
        return unavailable


def control_browser_projection(report, *, phase, operation_id, instance_id, browser, release, context):
    """Bind an existing return value to direct call arguments, not a manager receipt."""
    unavailable = control_browser_evidence(None, phase)
    try:
        pin = context["pins"]["browser"]
        target = context["pins"]["previous" if phase == "BEFORE" else "current"]
        require(phase in ("BEFORE", "AFTER") and type(operation_id) is str and re.fullmatch(r"[a-f0-9]{32}", operation_id)
                and type(instance_id) is str and re.fullmatch(r"[a-f0-9]{32}", instance_id)
                and type(browser) is dict and browser.get("fixturePath") == str(INSTALL_ROOT / ".asa/acceptance/realhost-control.json")
                and type(pin.get("componentSha256")) is str and re.fullmatch(r"[a-f0-9]{64}", pin["componentSha256"])
                and browser.get("componentSha256") == pin["componentSha256"]
                and type(pin.get("opsRevision")) is str and re.fullmatch(r"[a-f0-9]{40}", pin["opsRevision"])
                and type(release.get("revision")) is str and re.fullmatch(r"[a-f0-9]{40}", release["revision"])
                and release["revision"] == target["revision"] and type(release.get("schema")) is int
                and type(target.get("schema")) is int and release["schema"] == target["schema"], "CONTROL_BROWSER_DIAGNOSTIC")
        require(type(report) is dict and report.get("format") == "asa-setup-acceptance-v1" and report.get("kind") == "browser"
                and report.get("operationId") == operation_id and report.get("instanceId") == instance_id
                and report.get("installationId") == instance_id, "CONTROL_BROWSER_DIAGNOSTIC")
        runtime = ("revision", "entryOrigin", "invocationId", "componentSha256", "componentRevision")
        provenance = "NOT_RECORDED"
        if any(key in report for key in runtime):
            require(all(key in report for key in runtime) and report["revision"] == release["revision"]
                    and report["entryOrigin"] == ORIGIN and type(report["invocationId"]) is str
                    and re.fullmatch(r"[a-f0-9]{32}", report["invocationId"])
                    and report["componentSha256"] == pin["componentSha256"]
                    and report["componentRevision"] == pin["opsRevision"], "CONTROL_BROWSER_DIAGNOSTIC")
            provenance = "PINNED_INVOCATION"
        checks = report.get("checks")
        require(type(checks) is dict and set(checks) == set(RECEIPT_BROWSER_CHECKS), "CONTROL_BROWSER_DIAGNOSTIC")
        error = report.get("error")
        projected_error = {"state": "MISSING" if "error" not in report else "NULL" if error is None else "UNRECOGNIZED"}
        if type(error) is dict:
            projected_error = {"stage": receipt_choice(error.get("stage"), RECEIPT_BROWSER_STAGES),
                               "code": receipt_reason(error, "code", RECEIPT_BROWSER_ERRORS)}
            code = error.get("code")
            if type(code) is str and re.fullmatch(r"API_STATUS_[1-5][0-9]{2}", code):
                projected_error["code"] = {"state": "RECOGNIZED", "code": "API_STATUS", "httpStatus": int(code[-3:])}
        return control_browser_evidence({"format": unavailable["format"], "phase": phase, "binding": "DIRECT_INVOCATION",
            "fixtureArgument": "REALHOST_CONTROL", "target": "PREVIOUS_RUNTIME" if phase == "BEFORE" else "CURRENT_RUNTIME",
            "runtimeProvenance": provenance, "status": receipt_choice(report.get("status"), {"failed", "incomplete", "environment_failed"}),
            "reason": receipt_reason(report, "reasonCode", RECEIPT_BROWSER_REASONS),
            "checks": {key: receipt_choice(checks[key], {"passed", "failed", "not_run"}) for key in RECEIPT_BROWSER_CHECKS},
            "error": projected_error}, phase)
    except BaseException:
        return unavailable


def owner_seed(context):
    config_module, acceptance, _, install, helpers, config, release = owner_installation(context)
    _, before_ids = control_rows(install, helpers)
    browser = {**config["browser"], "fixturePath": str(INSTALL_ROOT / ".asa/acceptance/realhost-control.json")}
    operation_id = uuid.uuid4().hex
    report = acceptance.browser_acceptance(install, release, operation_id, browser)
    try:
        require(report["status"] == "passed", "CONTROL_BROWSER_BEFORE")
    except Failure as error:
        try:
            error.control_browser_diagnostic = control_browser_evidence(control_browser_projection(report, phase="BEFORE",
                operation_id=operation_id, instance_id=install.settings.get("instanceId"), browser=browser, release=release, context=context), "BEFORE")
        except BaseException:
            error.control_browser_diagnostic = {"format": "asa-realhost-control-browser-v1", "phase": "BEFORE", "binding": "UNAVAILABLE"}
        raise
    _, after_ids = control_rows(install, helpers)
    identities = {table: sorted(set(after_ids[table]) - set(before_ids[table])) for table in TABLES}
    require(all(identities[table] for table in TABLES) and len(identities["projects"]) >= 2, "CONTROL_COHORT_INCOMPLETE")
    s3_command(install, helpers, create=True)
    proof = control_fingerprint(install, helpers, acceptance, identities)
    config_module.save_private(INSTALL_ROOT / ".asa/realhost-control-proof.json", {"ids": identities, "fingerprint": proof, "browser": browser})
    return {"controlFingerprint": proof, "browser": browser_projection(report), "independentCohort": True}


def browser_projection(report):
    required = ("teacher_login", "student_login", "course_open", "existing_project_open", "scratch_save_reopen", "electronics_save_reopen")
    return {"status": "PASS" if report.get("status") == "passed" else "FAIL",
            "checks": {name: report.get("checks", {}).get(name) == "passed" for name in required},
            "componentSha256": report.get("componentSha256"), "componentRevision": report.get("componentRevision")}


def owner_observe(context, *, browser=False):
    config_module, acceptance, _, install, helpers, config, release = owner_installation(context)
    saved = config_module.private_json(INSTALL_ROOT / ".asa/realhost-control-proof.json")
    current = control_fingerprint(install, helpers, acceptance, saved["ids"])
    try:
        require(current == saved["fingerprint"], "CONTROL_DATA_CHANGED")
    except Failure as error:
        try:
            error.control_comparison = control_comparison_projection(saved["fingerprint"], current)
        except BaseException:
            pass  # Preserve the original comparison failure even if projection fails.
        raise
    output = {"preserved": True, "runtimeRevision": release["revision"], "schema": release["schema"], "fingerprint": current}
    if browser:
        operation_id = uuid.uuid4().hex
        report = acceptance.browser_acceptance(install, release, operation_id, saved["browser"])
        try:
            require(report["status"] == "passed", "CONTROL_BROWSER_AFTER")
        except Failure as error:
            try:
                error.control_browser_diagnostic = control_browser_evidence(control_browser_projection(report, phase="AFTER",
                    operation_id=operation_id, instance_id=install.settings.get("instanceId"), browser=saved["browser"], release=release, context=context), "AFTER")
            except BaseException:
                error.control_browser_diagnostic = {"format": "asa-realhost-control-browser-v1", "phase": "AFTER", "binding": "UNAVAILABLE"}
            raise
        output["browser"] = browser_projection(report)
    return output


def manifest_count():
    return len(list((INSTALL_ROOT / "backups").glob("*/manifest.json")))


def update_guest(context):
    options = ["--deployment-digest", context["pins"]["current"]["deploymentDigest"]]
    for action in ("check", "plan"):
        public_cli(["update", action], options=options, timeout=300)
    public_cli(["update", "apply"], options=[*options, "--non-interactive"], timeout=1800)
    value = last_setup_receipt()
    require_application(value, context["pins"]["current"])
    require(value["version"].get("previous") == context["pins"]["previous"]["revision"], "UPDATE_PREVIOUS_RUNTIME")
    control = owner_call("owner-observe", timeout=360)
    before_count = manifest_count()
    public_cli(["update", "apply"], options=[*options, "--operation-id", value["operationId"], "--non-interactive"], timeout=600)
    require(last_setup_receipt()["operationId"] == value["operationId"] and manifest_count() == before_count, "UPDATE_RETRY_DUPLICATE")
    public_cli(["update", "apply"], options=[*options, "--non-interactive"], timeout=600)
    no_change = last_setup_receipt()
    require(no_change.get("outcome") == "NO_CHANGE" and manifest_count() == before_count, "UPDATE_NO_CHANGE")
    require(panel_and_docker_identity() == root_json("host-baseline.json"), "ONEPANEL_DOCKER_CHANGED")
    observation = public_observation(context["pins"]["current"])
    return {"from": context["pins"]["previous"], "to": context["pins"]["current"],
            "schemaMigrationExercised": context["pins"]["previous"]["schema"] != context["pins"]["current"]["schema"],
            "receipt": receipt_projection(value), "sameOperationRetry": True, "noChangeWithoutNewBackup": True,
            "control": control, "publicObservation": observation, "onePanelAndDockerPreserved": True}


def snapshot_proof(operation_id):
    require(re.fullmatch(r"[a-f0-9]{32}", operation_id), "BACKUP_OPERATION_ID")
    directory = INSTALL_ROOT / ".asa/setup-backups"
    binding = json.loads((directory / ("operation-" + operation_id + ".json")).read_text())
    snapshot = binding["snapshotId"]
    require(re.fullmatch(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8,32}", snapshot), "SNAPSHOT_ID")
    receipt = json.loads((directory / (snapshot + ".json")).read_text())
    require(receipt.get("operationId") == operation_id and receipt.get("snapshotId") == snapshot
            and receipt.get("local", {}).get("status") == receipt.get("encryption", {}).get("status") == "OK", "SNAPSHOT_NOT_COMPLETE")
    ciphertext = INSTALL_ROOT / "backups/encrypted" / ("asa-lab-" + snapshot + ".tar.age")
    require(ciphertext.is_file() and not ciphertext.is_symlink() and receipt["encryption"]["path"] == str(ciphertext)
            and ciphertext.stat().st_size == receipt["encryption"]["bytes"] and hash_file(ciphertext) == receipt["encryption"]["sha256"],
            "CIPHERTEXT_INTEGRITY")
    with ciphertext.open("rb") as stream:
        require(stream.read(40).startswith(b"age-encryption.org/v1\n"), "AGE_ENVELOPE")
    require(receipt["cloud"]["status"] == "NOT_CONFIGURED" and receipt["outcome"] == "WARNING", "CLOUD_STATUS_MISREPRESENTED")
    return {"snapshotId": snapshot, "operationId": operation_id, "bytes": ciphertext.stat().st_size,
            "sha256": hash_file(ciphertext), "local": "OK", "encryption": "OK", "cloud": "NOT_CONFIGURED", "outcome": "WARNING"}


def backup_guest(context):
    operation_id = uuid.uuid4().hex
    before = manifest_count()
    options = ["--operation-id", operation_id, "--non-interactive"]
    public_cli(["backup", "create"], options=options, timeout=900)
    proof = snapshot_proof(operation_id)
    require(manifest_count() == before + 1, "BACKUP_COUNT")
    public_cli(["backup", "verify"], options=["--snapshot-id", proof["snapshotId"]], timeout=180)
    public_cli(["backup", "create"], options=options, timeout=300)
    require(snapshot_proof(operation_id) == proof and manifest_count() == before + 1, "BACKUP_RETRY_DUPLICATE")
    public_cli(["cloud", "sync"], options=["--snapshot-id", proof["snapshotId"], "--non-interactive"], timeout=120)
    require(snapshot_proof(operation_id) == proof and manifest_count() == before + 1, "CLOUD_SYNC_REEXPORTED")
    return {"backup": proof, "sameOperationRetry": True, "cloudSyncKeptCiphertext": True,
            "cloudDelivery": "NOT_CONFIGURED", "realProviderConnectionFailure": "NOT_RUN"}


def proc_identity(pid):
    """Linux stat identity only; command lines and environments never enter evidence."""
    try:
        raw = Path(f"/proc/{pid}/stat").read_text()
        fields = raw[raw.rindex(")") + 2:].split()
        return {"pid": int(pid), "ppid": int(fields[1]), "pgid": int(fields[2]), "sid": int(fields[3]),
                "startTime": int(fields[19]), "state": fields[0]}
    except (OSError, ValueError, IndexError):
        return None


def same_process(left, right):
    return bool(left and right and all(left.get(key) == right.get(key) for key in ("pid", "pgid", "sid", "startTime")))


def native_proc_namespace():
    try:
        own = proc_identity(os.getpid())
        return bool(own and os.readlink("/proc/self") == str(os.getpid())
                    and own["pgid"] == os.getpgrp() and own["sid"] == os.getsid(0))
    except (OSError, AttributeError):
        return False


def file_fault_limits():
    import resource
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (FAULT_FILE_LIMIT, FAULT_FILE_LIMIT))


class OwnedFaultProcess:
    """Keep the session leader unreaped until descendants finish, preventing PGID reuse.

    No poll()/waitpid() is used while the group can still be signalled. Every
    signal revalidates its PID/starttime/PGID/SID anchor and current members.
    """
    def __init__(self, command, *, environment, file_limit=False, deadline=None, owner=None, administrator=False):
        require(native_proc_namespace(), "BLOCKED_FAULT_PROC_NAMESPACE", status="BLOCKED")
        require(type(administrator) is bool, "PUBLISHED_ADMINISTRATOR")
        if administrator:
            credentials = published_credentials(owner, deadline=deadline)
        else:
            require(owner is None or type(owner.get("uid")) is int and owner["uid"] > 0
                    and type(owner.get("gid")) is int and owner["gid"] > 0 and owner.get("name") == "asa-setup",
                    "CLI_CONTROL_OWNER")
            credentials = {} if owner is None else {"user": owner["uid"], "group": owner["gid"],
                "extra_groups": os.getgrouplist(owner["name"], owner["gid"])}
        self.stdout, self.stderr = tempfile.TemporaryFile(), tempfile.TemporaryFile()
        self.closed, self.stopped, self.history = False, False, {}
        self.deadline = deadline
        self.process = None
        try:
            self.process = subprocess.Popen([str(value) for value in command], cwd="/", env=environment,
                stdin=subprocess.DEVNULL, stdout=self.stdout, stderr=self.stderr, start_new_session=True, umask=0o077,
                preexec_fn=file_fault_limits if file_limit else None, **credentials)
            self.anchor = proc_identity(self.process.pid)
            require(self.anchor and self.anchor["pgid"] == self.anchor["sid"] == self.process.pid,
                    "BLOCKED_FAULT_PROCESS_IDENTITY", status="BLOCKED")
        except BaseException:
            # No group signal without identity proof. This unreaped Popen child
            # alone is ours; a failed VM phase destroys the disposable guest.
            if self.process is not None:
                try:
                    self.process.kill()
                    self.process.wait(timeout=3)
                except (OSError, subprocess.TimeoutExpired):
                    pass
            self.stdout.close()
            self.stderr.close()
            raise

    def members(self):
        if self.closed:
            return []
        require(same_process(self.anchor, proc_identity(self.process.pid)), "BLOCKED_FAULT_PROCESS_IDENTITY", status="BLOCKED")
        records = {}
        for path in Path("/proc").iterdir():
            if not path.name.isdigit():
                continue
            value = proc_identity(int(path.name))
            if value:
                records[value["pid"]] = value
        owned = {self.anchor["pid"]}
        owned.update(value["pid"] for value in self.history.values()
                     if records.get(value["pid"], {}).get("startTime") == value["startTime"])
        while True:
            expanded = owned | {value["pid"] for value in records.values() if value["ppid"] in owned}
            if expanded == owned:
                break
            owned = expanded
        members = []
        for value in records.values():
            if value["pid"] not in owned and value["sid"] != self.anchor["sid"]:
                continue
            require((value["pgid"], value["sid"]) == (self.anchor["pgid"], self.anchor["sid"]),
                    "BLOCKED_FAULT_PROCESS_ESCAPED_GROUP", status="BLOCKED")
            require(value["startTime"] >= self.anchor["startTime"], "BLOCKED_FAULT_PROCESS_IDENTITY", status="BLOCKED")
            self.history[(value["pid"], value["startTime"])] = value
            require(len(self.history) <= 4096, "BLOCKED_FAULT_PROCESS_BUDGET", status="BLOCKED")
            if value["state"] not in ("Z", "X"):
                members.append(value)
        return members

    def signal(self, number):
        # Empty/closed groups are never signalled, even if a numeric PGID reappears.
        if not self.members():
            return False
        require(same_process(self.anchor, proc_identity(self.process.pid)), "BLOCKED_FAULT_PROCESS_IDENTITY", status="BLOCKED")
        os.killpg(self.anchor["pgid"], number)
        if number == signal.SIGSTOP:
            self.stopped = True
        elif number == signal.SIGCONT:
            self.stopped = False
        return True

    def guard(self):
        require(self.deadline is None or time.monotonic() < self.deadline, "BLOCKED_FAULT_PHASE_BUDGET", status="BLOCKED")
        require(sum(os.fstat(stream.fileno()).st_size for stream in (self.stdout, self.stderr)) <= 2 * 1024**2,
                "BLOCKED_FAULT_OUTPUT_LIMIT", status="BLOCKED")

    def wait(self, timeout, *, check_budget=True):
        deadline = time.monotonic() + timeout
        empty_since = None
        while True:
            live = self.members()
            if not live:
                if empty_since is not None and time.monotonic() - empty_since >= 0.1:
                    break
                empty_since = empty_since or time.monotonic()
            else:
                empty_since = None
            if check_budget:
                self.guard()
            require(time.monotonic() < deadline, "BLOCKED_FAULT_QUIESCENCE_BUDGET", status="BLOCKED")
            time.sleep(0.1)
        self.closed = True  # No further group signalling is allowed after wait reaps the anchor.
        code = self.process.wait(timeout=3)
        self.stdout.seek(0)
        raw = self.stdout.read(2 * 1024**2 + 1)
        require(len(raw) <= 2 * 1024**2, "BLOCKED_FAULT_OUTPUT_LIMIT", status="BLOCKED")
        return code, raw

    def close(self):
        try:
            if not self.closed:
                self.signal(signal.SIGCONT)
                self.signal(signal.SIGTERM)
                deadline = time.monotonic() + 3
                while self.members() and time.monotonic() < deadline:
                    time.sleep(0.05)
                self.signal(signal.SIGKILL)
                self.deadline = None
                self.wait(5, check_budget=False)
        finally:
            self.stdout.close()
            self.stderr.close()

    def proof(self):
        identities = [{key: value[key] for key in ("pid", "startTime", "pgid", "sid")}
                      for _, value in sorted(self.history.items())]
        return {"leader": {key: self.anchor[key] for key in ("pid", "startTime", "pgid", "sid")},
                "observedProcessCount": len(self.history), "processIdentitiesSha256": canonical_hash(
                    sorted((value["pid"], value["startTime"], value["pgid"], value["sid"]) for value in self.history.values())),
                "processIdentities": identities[:128], "identityListTruncated": len(identities) > 128,
                "allOwnedProcessesExited": self.closed}

    def __enter__(self):
        return self

    def __exit__(self, error_type, error, traceback):
        try:
            self.close()
        except BaseException:
            if error is None:
                raise
            error.owned_cleanup_failed = True
        return False


def cloud_dummy_configuration(nonce):
    require(isinstance(nonce, str) and re.fullmatch(r"[a-f0-9]{32}", nonce), "CLOUD_FAULT_NONCE")
    # Pinned yandex.NewFs requires refresh_token and upgrades non-OAuth types.
    # Neither value is a provider credential. No token or token hash is evidence.
    token = {"access_token": "ASA_REALHOST_DUMMY_ACCESS_" + nonce,
             "refresh_token": "ASA_REALHOST_DUMMY_REFRESH_" + nonce,
             "token_type": "OAuth", "expiry": "2099-01-01T00:00:00Z"}
    return ("[yandex]\ntype = yandex\ntoken = " + json.dumps(token, sort_keys=True) + "\n").encode()


def cloud_timestamp_ns(value):
    """Docker network Created uses time.Now(), not an obligatory UTC suffix."""
    require(isinstance(value, str), "CLOUD_FAULT_TIMESTAMP")
    match = re.fullmatch(r"([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(?:\.([0-9]{1,9}))?(Z|[+-][0-9]{2}:[0-9]{2})", value)
    require(match is not None, "CLOUD_FAULT_TIMESTAMP")
    try:
        moment = dt.datetime.fromisoformat(match[1] + match[3]).astimezone(dt.timezone.utc)
    except ValueError:
        raise Failure("CLOUD_FAULT_TIMESTAMP") from None
    delta = moment - dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)
    return delta.days * 86400 * 10**9 + delta.seconds * 10**9 + int((match[2] or "").ljust(9, "0"))


def cloud_image_identity(record):
    # The pinned OCI index binds this exact linux/amd64 manifest and its config.
    # Moby 70efc0e31da3a115fc87574d1b786fa2b867c346 containerd.GetImage uses
    # the index target as ImageID; the classic store uses the config digest.
    descriptor = record.get("imageManifest")
    image_id = record.get("imageId")
    expected = {"digest": CLOUD_IMAGE_MANIFEST_ID, "mediaType": "application/vnd.oci.image.manifest.v1+json",
                "size": CLOUD_IMAGE_MANIFEST_BYTES, "platform": {"architecture": "amd64", "os": "linux"}}
    if image_id == CLOUD_IMAGE_ID:
        require(descriptor is None, "CLOUD_FAULT_CONTAINER_IDENTITY")
    else:
        require(image_id == CLOUD_IMAGE.split("@", 1)[1] and type(descriptor) is dict
                and set(descriptor) == set(expected) and type(descriptor.get("size")) is int
                and type(descriptor.get("platform")) is dict and descriptor == expected,
                "CLOUD_FAULT_CONTAINER_IDENTITY")
    return {"imageId": image_id, "imageManifest": expected if descriptor is not None else None}


def cloud_container_identity_observation(record):
    """Describe only fixed predicates from this failed inspect; never adopt it."""
    if type(record) is not dict:
        return {"format": "asa-realhost-cloud-identity-v1", "status": "UNAVAILABLE"}

    def state(typed, matches):
        return "UNAVAILABLE" if not typed else "SAME" if matches else "DIFFERENT"

    labels, mounts = record.get("labels"), record.get("mounts")
    expected_labels = {"asa.owner": CLOUD_PROJECT, "com.docker.compose.project": CLOUD_PROJECT,
        "com.docker.compose.service": "rclone", "com.docker.compose.project.working_dir": str(CLOUD_ROOT),
        "com.docker.compose.project.config_files": str(CLOUD_ROOT / "compose.json")}
    labels_typed = type(labels) is dict and all(type(labels.get(key)) is str for key in expected_labels)
    labels_typed = labels_typed and type(labels.get("com.docker.compose.oneoff")) is str
    mounts_typed = type(mounts) is list and all(type(item) is dict
        and all(type(item.get(key)) is str for key in ("Type", "Source", "Destination"))
        and type(item.get("RW")) is bool for item in mounts)
    descriptor, image_id = record.get("imageManifest"), record.get("imageId")
    descriptor_typed = type(descriptor) is dict and set(descriptor) == {"digest", "mediaType", "size", "platform"}
    descriptor_typed = descriptor_typed and all(type(descriptor.get(key)) is str for key in ("digest", "mediaType"))
    descriptor_typed = descriptor_typed and type(descriptor.get("size")) is int and type(descriptor.get("platform")) is dict
    descriptor_typed = descriptor_typed and set(descriptor["platform"]) == {"architecture", "os"}
    descriptor_typed = descriptor_typed and all(type(value) is str for value in descriptor["platform"].values())
    image_typed = type(image_id) is str and (descriptor_typed or descriptor is None
        and image_id != CLOUD_IMAGE.split("@", 1)[1])
    try:
        cloud_image_identity(record)
        image_matches = True
    except Failure:
        image_matches = False
    security_typed = type(record.get("user")) is str and all(type(record.get(key)) is bool
        for key in ("readonly", "privileged")) and (record.get("ports") is None or type(record.get("ports")) is dict)
    security_typed = security_typed and (record.get("capAdd") is None or type(record.get("capAdd")) is list
        and all(type(value) is str for value in record["capAdd"])) and type(record.get("capDrop")) is list
    security_typed = security_typed and all(type(value) is str for value in record["capDrop"])
    state_typed = all(type(record.get(key)) is bool for key in ("paused", "restarting", "oomKilled"))
    state_typed = state_typed and type(record.get("restarts")) is int
    predicates = {
        "id": state(type(record.get("id")) is str and type(record.get("name")) is str,
                    isinstance(record.get("id"), str) and bool(HEX64.fullmatch(record["id"]))
                    and record.get("name") == "/" + CLOUD_CONTAINER),
        "labels": state(labels_typed, labels_typed and all(labels[key] == value for key, value in expected_labels.items())
                        and labels["com.docker.compose.oneoff"] in ("False", "false")),
        "mounts": state(mounts_typed, mounts_typed and len(mounts) == 2
                        and all(item["Type"] == "bind" and item["RW"] is True for item in mounts)
                        and {(item["Source"], item["Destination"]) for item in mounts}
                        == {(str(CLOUD_ROOT / "config"), "/config/rclone"), (str(CLOUD_ROOT / "data"), "/data")}),
        "imageReference": state(type(record.get("image")) is str, record.get("image") == CLOUD_IMAGE),
        "imageIdentity": state(image_typed, image_matches),
        "security": state(security_typed, record.get("user") == "1000:1000" and record.get("readonly") is True
                          and record.get("ports") in ({}, None) and record.get("privileged") is False
                          and record.get("capAdd") in (None, []) and record.get("capDrop") == ["ALL"]),
        "state": state(state_typed, record.get("paused") is False and record.get("restarting") is False
                       and record.get("oomKilled") is False and type(record.get("restarts")) is int and record["restarts"] == 0),
    }
    return {"format": "asa-realhost-cloud-identity-v1", "status": "OBSERVED", "predicates": predicates}


def cloud_container_identity(record, earliest_ns):
    require(isinstance(record, dict) and isinstance(record.get("id"), str) and HEX64.fullmatch(record["id"]),
            "CLOUD_FAULT_CONTAINER_IDENTITY")
    labels, mounts = record.get("labels"), record.get("mounts")
    expected_labels = {"asa.owner": CLOUD_PROJECT, "com.docker.compose.project": CLOUD_PROJECT,
                      "com.docker.compose.service": "rclone",
                      "com.docker.compose.project.working_dir": str(CLOUD_ROOT),
                      "com.docker.compose.project.config_files": str(CLOUD_ROOT / "compose.json")}
    require(isinstance(labels, dict) and all(labels.get(key) == value for key, value in expected_labels.items())
            and labels.get("com.docker.compose.oneoff") in ("False", "false"),
            "CLOUD_FAULT_CONTAINER_IDENTITY")
    require(isinstance(mounts, list) and len(mounts) == 2
            and all(isinstance(item, dict) and item.get("Type") == "bind" and item.get("RW") is True for item in mounts)
            and {(item.get("Source"), item.get("Destination")) for item in mounts}
            == {(str(CLOUD_ROOT / "config"), "/config/rclone"), (str(CLOUD_ROOT / "data"), "/data")},
            "CLOUD_FAULT_CONTAINER_IDENTITY")
    image_identity = cloud_image_identity(record)
    require(record.get("name") == "/" + CLOUD_CONTAINER and record.get("image") == CLOUD_IMAGE
            and record.get("user") == "1000:1000"
            and record.get("readonly") is True and record.get("ports") in ({}, None)
            and record.get("privileged") is False and record.get("capAdd") in (None, [])
            and record.get("capDrop") == ["ALL"]
            and record.get("paused") is False and record.get("restarting") is False
            and record.get("oomKilled") is False and type(record.get("restarts")) is int and record["restarts"] == 0,
            "CLOUD_FAULT_CONTAINER_IDENTITY")
    require(type(earliest_ns) is int and earliest_ns <= cloud_timestamp_ns(record.get("created")) <= time.time_ns()
            and cloud_timestamp_ns(record.get("started")) >= cloud_timestamp_ns(record["created"]), "CLOUD_FAULT_CONTAINER_FRESHNESS")
    require(isinstance(record.get("networks"), dict) and (record.get("execIds") is None
            or isinstance(record.get("execIds"), list) and len(record["execIds"]) <= 128
            and all(isinstance(item, str) and HEX64.fullmatch(item) for item in record["execIds"])
            and len(set(record["execIds"])) == len(record["execIds"])),
            "CLOUD_FAULT_EXEC_IDENTITY")
    return {"id": record["id"], "created": record["created"], "started": record["started"],
            "image": CLOUD_IMAGE, **image_identity, "labels": expected_labels,
            "mounts": sorted([item["Source"], item["Destination"]] for item in mounts),
            "user": "1000:1000", "readonly": True, "publicPorts": False}


def cloud_network_identity(record, earliest_ns):
    require(isinstance(record, dict) and isinstance(record.get("id"), str) and HEX64.fullmatch(record["id"])
            and record.get("name") == CLOUD_PROJECT + "_default"
            and record.get("driver") == "bridge" and record.get("scope") == "local"
            and isinstance(record.get("labels"), dict)
            and record["labels"].get("com.docker.compose.project") == CLOUD_PROJECT
            and record["labels"].get("com.docker.compose.network") == "default"
            and isinstance(record.get("containers"), dict), "CLOUD_FAULT_NETWORK_IDENTITY")
    require(earliest_ns <= cloud_timestamp_ns(record.get("created")) <= time.time_ns(), "CLOUD_FAULT_NETWORK_FRESHNESS")
    return {key: record[key] for key in ("id", "name", "created", "driver", "scope")}


def cloud_namespace_projection(interfaces, routes4, routes6, inode, guest_inode):
    require(type(inode) is int and inode > 0 and type(guest_inode) is int and guest_inode > 0
            and inode != guest_inode, "CLOUD_FAULT_NAMESPACE")
    require(isinstance(interfaces, list) and len(interfaces) == 1 and isinstance(interfaces[0], dict)
            and interfaces[0].get("ifname") == "lo" and isinstance(interfaces[0].get("addr_info"), list),
            "CLOUD_FAULT_NAMESPACE")
    for address in interfaces[0]["addr_info"]:
        require(isinstance(address, dict) and address.get("family") in ("inet", "inet6")
                and isinstance(address.get("local"), str), "CLOUD_FAULT_NAMESPACE")
        try:
            valid = ipaddress.ip_address(address["local"]).is_loopback
        except ValueError:
            valid = False
        require(valid, "CLOUD_FAULT_NAMESPACE")
    for version, routes in ((4, routes4), (6, routes6)):
        require(isinstance(routes, list) and len(routes) <= 32, "CLOUD_FAULT_NAMESPACE")
        for route in routes:
            require(isinstance(route, dict) and route.get("dev") in (None, "lo")
                    and not any(key in route for key in ("gateway", "via", "nexthops")), "CLOUD_FAULT_NAMESPACE")
            if route.get("type") in ("unreachable", "blackhole", "prohibit"):
                continue
            try:
                destination = ipaddress.ip_network(route.get("dst", ""), strict=False)
                valid = destination.version == version and destination.is_loopback
            except (ValueError, TypeError):
                valid = False
            require(valid and route.get("dev") == "lo" and route.get("type", "unicast") in ("local", "unicast", "broadcast"),
                    "CLOUD_FAULT_NAMESPACE")
    return {"namespaceInode": inode, "differentFromGuest": True, "loopbackOnly": True,
            "externalIPv4Routes": 0, "externalIPv6Routes": 0}


def cloud_exec_projection(rows, container_id, installation_id, started_ns, finished_ns):
    """Exact pinned producer commands, complete daemon lifecycle; no raw attributes."""
    require(isinstance(rows, list) and len(rows) <= 256 and isinstance(container_id, str)
            and HEX64.fullmatch(container_id) and isinstance(installation_id, str)
            and re.fullmatch(r"[a-f0-9]{32}", installation_id), "BLOCKED_CLOUD_EXEC_EVIDENCE", status="BLOCKED")
    base = "/data/asa-" + installation_id
    commands = {
        "rclone --config /config/rclone/rclone.conf --contimeout 20s --timeout 60s --max-duration 595s --retries 2 mkdir yandex:Server-Backups/asa-" + installation_id: "mkdir",
        "rclone rc --url http://127.0.0.1:5572 core/version": "health",
        'sh -eu -c umask 077; for d do if [ -e "$d" ]; then test -d "$d" && test ! -L "$d"; else mkdir "$d"; fi; done asa-cloud-spool '
        + base + " " + base + "/outgoing " + base + "/incoming": "spool",
    }
    executions = {}
    previous_ns = started_ns
    for row in rows:
        require(isinstance(row, dict) and row.get("type") == "container" and row.get("id") == container_id
                and type(row.get("timeNs")) is int and previous_ns <= row["timeNs"] <= finished_ns,
                "BLOCKED_CLOUD_EXEC_EVIDENCE", status="BLOCKED")
        previous_ns = row["timeNs"]
        action = row.get("action")
        require(isinstance(action, str), "BLOCKED_CLOUD_EXEC_EVIDENCE", status="BLOCKED")
        if not action.startswith(("exec_create: ", "exec_start: ")) and action != "exec_die":
            require(action in ("health_status: healthy", "health_status: unhealthy"),
                    "BLOCKED_CLOUD_EXEC_EVIDENCE", status="BLOCKED")
            continue
        identity = row.get("execId")
        require(isinstance(identity, str) and HEX64.fullmatch(identity), "BLOCKED_CLOUD_EXEC_EVIDENCE", status="BLOCKED")
        if action.startswith("exec_create: "):
            command = action[len("exec_create: "):]
            require(identity not in executions and command in commands, "BLOCKED_CLOUD_EXEC_EVIDENCE", status="BLOCKED")
            executions[identity] = {"command": command, "kind": commands[command], "state": "created"}
        elif action.startswith("exec_start: "):
            require(identity in executions and executions[identity]["state"] == "created"
                    and executions[identity]["command"] == action[len("exec_start: "):],
                    "BLOCKED_CLOUD_EXEC_EVIDENCE", status="BLOCKED")
            executions[identity]["state"] = "started"
        else:
            require(identity in executions and executions[identity]["state"] == "started"
                    and isinstance(row.get("exitCode"), str) and re.fullmatch(r"[0-9]{1,3}", row["exitCode"])
                    and 0 <= int(row["exitCode"]) <= 255, "BLOCKED_CLOUD_EXEC_EVIDENCE", status="BLOCKED")
            executions[identity].update(state="exited", exitCode=int(row["exitCode"]))
    require(executions and all(item["state"] == "exited" for item in executions.values()),
            "BLOCKED_CLOUD_EXEC_EVIDENCE", status="BLOCKED")
    mkdir = [(identity, item) for identity, item in executions.items() if item["kind"] == "mkdir"]
    require(len(mkdir) == 1 and mkdir[0][1]["exitCode"] in (1, 5)
            and all(item["exitCode"] == 0 for item in executions.values() if item["kind"] != "mkdir")
            and any(item["kind"] == "spool" for item in executions.values()),
            "BLOCKED_CLOUD_EXEC_NOT_NETWORK_FAILURE", status="BLOCKED")
    return {"status": "OBSERVED", "command": "PINNED_RCLONE_MKDIR", "execId": mkdir[0][0],
            "exitCode": mkdir[0][1]["exitCode"], "completeCreateStartDie": True, "naturalCompletion": True,
            "healthExecutions": sum(item["kind"] == "health" for item in executions.values()),
            "classification": "TRANSPORT_FAILURE_UNDER_PROVEN_NO_EGRESS", "specificErrno": "UNAVAILABLE"}


def cloud_result_projection(public, receipt, journal):
    """Unknown or malformed fields never become a policy PASS or opaque evidence."""
    public = public if isinstance(public, dict) else {}
    receipt = receipt if isinstance(receipt, dict) else {}
    journal = journal if isinstance(journal, dict) else {}
    operation = public.get("operation") if isinstance(public.get("operation"), dict) else {}
    saved = journal.get("result") if isinstance(journal.get("result"), dict) else {}
    result = {}
    for name, value in (("publicStatus", public.get("status")), ("setupOutcome", saved.get("outcome")),
                        ("receiptOutcome", receipt.get("outcome")), ("journalState", journal.get("state"))):
        result[name] = value if isinstance(value, str) and value in {
            "OK", "FAILED", "BLOCKED", "WARNING", "ERROR", "TERMINAL", "RUNNING", "RECOVERY_REQUIRED", "INTERRUPTED"
        } else "UNVERIFIED"
    result["publicExitCode"] = public.get("exitCode") if type(public.get("exitCode")) is int and public["exitCode"] in (0, 1, 2, 130) else None
    for name, value in (("operationId", operation.get("operationId")), ("installationId", operation.get("installationId")),
                        ("sourceOperationId", receipt.get("operationId"))):
        result[name] = value if isinstance(value, str) and re.fullmatch(r"[a-f0-9]{32}", value) else None
    for part in ("local", "encryption", "cloud"):
        item = receipt.get(part) if isinstance(receipt.get(part), dict) else {}
        result[part] = item.get("status") if isinstance(item.get("status"), str) and item["status"] in {
            "OK", "FAILED", "NOT_CONFIGURED", "PENDING", "UNKNOWN", "UNAVAILABLE"
        } else "UNVERIFIED"
    cloud = receipt.get("cloud") if isinstance(receipt.get("cloud"), dict) else {}
    result["cloudReasonCode"] = cloud.get("error") if cloud.get("error") in (
        "CLOUD_TRANSFER_FAILED", "CLOUD_AUTHORIZATION", "CLOUD_PROVIDER_GONE", "CLOUD_TIMEOUT",
        "CLOUD_UNAVAILABLE", "CLOUD_NOT_CONNECTED", "CLOUD_TRANSPORT_ERROR"
    ) else "UNRECOGNIZED_REASON"
    result["dataProtectionConfirmed"] = operation.get("dataProtectionConfirmed") if type(operation.get("dataProtectionConfirmed")) is bool else None
    result["receiptProtectionConfirmed"] = receipt.get("protectionConfirmed") if type(receipt.get("protectionConfirmed")) is bool else None
    result["snapshotId"] = receipt.get("snapshotId") if isinstance(receipt.get("snapshotId"), str) and re.fullmatch(
        r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8,32}", receipt["snapshotId"]) else None
    return result


def cloud_require_result(value, policy, operation_id, installation_id, source_operation_id, journal, receipt, public):
    expected = ("OK", 0, "WARNING", "WARNING") if policy == "best-effort" else ("FAILED", 1, "ERROR", "BLOCKED")
    require(policy in ("best-effort", "required") and
            tuple(value.get(key) for key in ("publicStatus", "publicExitCode", "setupOutcome", "receiptOutcome")) == expected
            and value.get("operationId") == operation_id and value.get("installationId") == installation_id
            and value.get("sourceOperationId") == source_operation_id
            and value.get("local") == value.get("encryption") == "OK" and value.get("cloud") == "FAILED"
            and value.get("cloudReasonCode") == "CLOUD_TRANSFER_FAILED"
            and value.get("dataProtectionConfirmed") is False and value.get("receiptProtectionConfirmed") is False
            and value.get("journalState") == "TERMINAL" and receipt.get("policy") == policy
            and journal.get("operationId") == operation_id and journal.get("installationId") == installation_id
            and journal.get("snapshotId") == value["snapshotId"] and journal.get("root") == str(INSTALL_ROOT)
            and journal.get("mode") == ("retry-cloud" if policy == "best-effort" else "backup")
            and public.get("operation", {}).get("outcome") == expected[2]
            and journal.get("result", {}).get("dataProtectionConfirmed") is False,
            "CLOUD_FAULT_POLICY_RESULT")


def cloud_fixture_paths():
    return INSTALL_ROOT / ".asa/realhost-cloud-fixture.json", Path("/var/lib/asa-setup/operator/realhost-cloud-dummy.conf")


def cloud_changed_configuration(original, context, policy):
    value = json.loads(json.dumps(original))
    value["backup"]["policy"] = policy
    value["backup"]["cloud"] = {**value["backup"]["cloud"], "enabled": True,
        "project": "asa-" + value["installationId"],
        "transportPath": str(candidate_bundle(context) / "tools/deployment/ops/cloud_storage.py"),
        "transportSha256": CLOUD_SOURCE_SHA256}
    return value


def cloud_config_bytes(value):
    return (json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2) + "\n").encode()


def cloud_source_dummy_binding(info, raw, context, state):
    """Private lifetime proof; never publish dummy bytes or their hash as evidence."""
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
            and (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (state["uid"], state["gid"], 0o600)
            and info.st_size == len(raw) and raw == cloud_dummy_configuration(context["nonce"]),
            "CLOUD_FAULT_DUMMY_IDENTITY")
    return {"format": "asa-realhost-cloud-source-dummy-v1", "nonce": context["nonce"],
            "installationId": state["installationId"], "sourceOperationId": state["sourceOperationId"],
            "dev": info.st_dev, "ino": info.st_ino, "uid": info.st_uid, "gid": info.st_gid,
            "mode": stat.S_IMODE(info.st_mode), "nlink": info.st_nlink, "bytes": info.st_size,
            "mtimeNs": info.st_mtime_ns, "ctimeNs": info.st_ctime_ns, "sha256": hashlib.sha256(raw).hexdigest()}


def cloud_create_source_dummy(path, base, context, state):
    """Capture the creation FD, not a pathname reopened after publication."""
    raw = cloud_dummy_configuration(context["nonce"])
    directory = diagnostic_open(path.parent, base, state["uid"], directory=True)
    try:
        descriptor = os.open(path.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=directory)
        with os.fdopen(descriptor, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
            binding = cloud_source_dummy_binding(os.fstat(stream.fileno()), raw, context, state)
        os.fsync(directory)
        return binding
    finally:
        os.close(directory)


def cloud_restore_source_dummy(path, base, context, state):
    saved = state.get("sourceDummy")
    if saved == {"status": "ABSENT"}:
        require(not os.path.lexists(path), "CLOUD_FAULT_DUMMY_IDENTITY")
        return
    require(isinstance(saved, dict) and set(saved) == {"status", "binding"}
            and saved["status"] == "CREATED" and isinstance(saved["binding"], dict),
            "CLOUD_FAULT_DUMMY_IDENTITY")
    raw, info, _ = diagnostic_read(path, base, state["uid"], maximum=4096)
    observed = cloud_source_dummy_binding(info, raw, context, state)
    require(saved["binding"] == observed and set(saved["binding"]) == set(observed)
            and all(type(saved["binding"][key]) is type(value) for key, value in observed.items()),
            "CLOUD_FAULT_DUMMY_IDENTITY")
    cloud_unlink_private(path, base, state["uid"], info, raw)


def owner_cloud_fixture(context, action):
    """Fixture configuration only, under the product lock; never relabel a receipt."""
    import pwd
    config_module, _, _, install, _, config, release = owner_installation(context)
    from deployment.system import operation_lock
    from deployment.setup_operation import Store
    from deployment.backup import managed_writers
    from deployment.backup_workflow import verify_receipt
    account = pwd.getpwuid(os.geteuid())
    require(account.pw_name == "asa-setup" and account.pw_dir == "/var/lib/asa-setup/operator"
            and os.geteuid() != 0 and os.getegid() == account.pw_gid, "CLOUD_FAULT_OWNER")
    require(release["revision"] == context["pins"]["current"]["revision"]
            and release["schema"] == context["pins"]["current"]["schema"], "CLOUD_FAULT_RUNTIME")
    state_path, dummy_path = cloud_fixture_paths()
    setup_path = INSTALL_ROOT / ".asa/setup.json"
    with operation_lock(INSTALL_ROOT):
        require(Store(INSTALL_ROOT, config["installationId"]).pending() is None
                and not os.path.lexists(INSTALL_ROOT / ".asa/maintenance.json"), "CLOUD_FAULT_PENDING")
        raw, metadata, _ = diagnostic_read(setup_path, INSTALL_ROOT, os.geteuid(), maximum=1024**2)
        require(metadata.st_gid == os.getegid() and stat.S_IMODE(metadata.st_mode) == 0o600,
                "CLOUD_FAULT_CONFIGURATION_IDENTITY")
        records = install.identity()
        writers = managed_writers(install, records, json.loads(install.compose("config", "--format", "json", capture=True)))
        require(set(records) == {"postgres", "minio", "api", "web", "scratch", "search"}
                and all(isinstance(record.get("id"), str) and HEX64.fullmatch(record["id"]) for record in records.values()),
                "CLOUD_FAULT_APPLICATION_IDENTITY")
        pointer = config_module.private_json(INSTALL_ROOT / ".asa/setup-backups/last-local-success.json")
        current = verify_receipt(install, snapshot_id=pointer.get("snapshotId"), installation_id=config["installationId"])
        require(current.get("local", {}).get("status") == current.get("encryption", {}).get("status") == "OK",
                "CLOUD_FAULT_SOURCE_BACKUP")
        control = owner_observe(context)
        if action == "baseline":
            require(not os.path.lexists(state_path) and not os.path.lexists(dummy_path), "CLOUD_FAULT_FIXTURE_EXISTS")
            require(config["backup"]["policy"] == "best-effort" and config["backup"]["cloud"].get("enabled") is False
                    and set(config["backup"]["cloud"]) <= {"enabled", "transportPath", "transportSha256", "project"}
                    and config["backup"]["retention"] == {"localKeep": None, "remoteKeep": None}
                    and config["backup"]["schedule"]["enabled"] is False
                    and config["backup"]["ageRecipient"] == context["ageRecipient"]
                    and current["policy"] == "best-effort" and current["cloud"]["status"] == "NOT_CONFIGURED",
                    "CLOUD_FAULT_INITIAL_CONFIGURATION")
            state = {"format": "asa-realhost-cloud-fixture-v1", "nonce": context["nonce"],
                     "installationId": config["installationId"], "originalText": raw.decode("utf-8"),
                     "uid": metadata.st_uid, "gid": metadata.st_gid, "mode": stat.S_IMODE(metadata.st_mode),
                     "writers": writers, "control": control, "pointer": pointer,
                     "snapshotId": current["snapshotId"], "sourceOperationId": current["operationId"],
                     "completeSnapshots": manifest_count(), "sourceDummy": {"status": "ABSENT"}}
            config_module.save_private(state_path, state)
            return {"installationId": config["installationId"], "snapshotId": current["snapshotId"],
                    "sourceOperationId": current["operationId"], "completeSnapshots": state["completeSnapshots"],
                    "configurationSha256": hashlib.sha256(raw).hexdigest(), "configUid": metadata.st_uid,
                    "configGid": metadata.st_gid, "configMode": stat.S_IMODE(metadata.st_mode),
                    "writerIdentitySha256": canonical_hash(writers), "controlFingerprintSha256": canonical_hash(control),
                    "appIds": {name: record["id"] for name, record in records.items()}, "noPendingOperation": True}
        state = config_module.private_json(state_path)
        require(state.get("format") == "asa-realhost-cloud-fixture-v1" and state.get("nonce") == context["nonce"]
                and state.get("installationId") == config["installationId"]
                and (state.get("uid"), state.get("gid"), state.get("mode")) == (metadata.st_uid, metadata.st_gid, 0o600)
                and isinstance(state.get("originalText"), str), "CLOUD_FAULT_FIXTURE_IDENTITY")
        original = config_module.validate_config(json.loads(state["originalText"]), INSTALL_ROOT, os.geteuid())
        original_raw = state["originalText"].encode()
        best = config_module.validate_config(cloud_changed_configuration(original, context, "best-effort"), INSTALL_ROOT, os.geteuid())
        required = config_module.validate_config(cloud_changed_configuration(original, context, "required"), INSTALL_ROOT, os.geteuid())
        require(raw in (original_raw, cloud_config_bytes(best), cloud_config_bytes(required))
                and writers == state["writers"] and control == state["control"], "CLOUD_FAULT_CONFIGURATION_CHANGED")
        source = verify_receipt(install, snapshot_id=state["snapshotId"], installation_id=config["installationId"])
        require(source["operationId"] == state["sourceOperationId"], "CLOUD_FAULT_SOURCE_BACKUP")
        source_removed = None
        if action == "best-effort":
            require(raw == original_raw and not os.path.lexists(dummy_path)
                    and state.get("sourceDummy") == {"status": "ABSENT"}, "CLOUD_FAULT_FIXTURE_ORDER")
            # An interrupted creation without a persisted FD proof stays unowned.
            state["sourceDummy"] = {"status": "CREATING"}
            config_module.save_private(state_path, state)
            binding = cloud_create_source_dummy(dummy_path, Path(account.pw_dir), context, state)
            state["sourceDummy"] = {"status": "CREATED", "binding": binding}
            config_module.save_private(state_path, state)
            config_module.save_private(setup_path, best)
        elif action == "required":
            require(raw == cloud_config_bytes(best), "CLOUD_FAULT_FIXTURE_ORDER")
            config_module.save_private(setup_path, required)
        elif action == "restore":
            try:
                cloud_restore_source_dummy(dummy_path, Path(account.pw_dir), context, state)
                source_removed = True
            except (Failure, OSError, ValueError, TypeError, KeyError):
                source_removed = False
            # Source cleanup failure must not leave a fault policy configured.
            config_module.validate_config(original, INSTALL_ROOT, os.geteuid())
            config_module.atomic_bytes(setup_path, original_raw, mode=state["mode"])
            actual, info, _ = diagnostic_read(setup_path, INSTALL_ROOT, os.geteuid(), maximum=1024**2)
            require(actual == original_raw and (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode))
                    == (state["uid"], state["gid"], state["mode"]), "CLOUD_FAULT_CONFIGURATION_RESTORE")
        elif action != "observe":
            raise Failure("CLOUD_FAULT_FIXTURE_ACTION")
        result = {"noPendingOperation": True, "originalWritersReady": True, "controlDataPreserved": True,
                "writerIdentitySha256": canonical_hash(writers), "controlFingerprintSha256": canonical_hash(control),
                "configurationRestored": action == "restore", "fixtureOnlyPolicySetter": True,
                "publicConfigSetterClaimed": False}
        if action == "restore":
            result["sourceDummyRemoved"] = source_removed
            if not source_removed:
                result.update(status="BLOCKED", reasonCode="BLOCKED_CLOUD_FAULT_SOURCE_DUMMY")
        return result


def cloud_unlink_private(path, base, uid, expected_info, expected):
    raw, info, _ = diagnostic_read(path, base, uid, maximum=4096)
    require(diagnostic_metadata(info) == diagnostic_metadata(expected_info) and raw == expected, "CLOUD_FAULT_DUMMY_IDENTITY")
    directory = diagnostic_open(Path(path).parent, base, uid, directory=True)
    try:
        current = os.stat(Path(path).name, dir_fd=directory, follow_symlinks=False)
        require(diagnostic_metadata(current) == diagnostic_metadata(info), "CLOUD_FAULT_DUMMY_IDENTITY")
        os.unlink(Path(path).name, dir_fd=directory)
        os.fsync(directory)
    finally:
        os.close(directory)


def cloud_prepare_guest(context, *, credential=False):
    require(os.geteuid() == 0, "CLOUD_FAULT_OWNER")
    require(os.environ.get("DOCKER_HOST") == "unix:///var/run/docker.sock"
            and os.environ.get("DOCKER_CONFIG") == str(GUEST_PRIVATE / "cloud-docker-config")
            and os.environ.get("HOME") == "/root", "CLOUD_FAULT_PREPARATION_CONTEXT")
    owner, _ = diagnostic_owner(context)
    source = candidate_bundle(context) / "tools/asa_setup_launcher.py"
    spec = importlib.util.spec_from_file_location("asa_realhost_cloud_launcher", source)
    launcher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(launcher)
    require(launcher.CLOUD_SOURCE_SHA256 == CLOUD_SOURCE_SHA256, "CLOUD_FAULT_SOURCE_PIN")
    environment = {key: value for key, value in guest_environment().items() if key not in ("GH_TOKEN", "GITHUB_TOKEN")}
    environment.update(DOCKER_HOST="unix:///var/run/docker.sock", DOCKER_CONFIG=str(GUEST_PRIVATE / "cloud-docker-config"))
    def read(args):
        report, raw = diagnostic_command(["docker", *args], timeout=12, environment=environment, own_group=False)
        require(report.get("exitCode") == 0 and not report.get("reasonCode") and not report.get("cleanupReasonCode"),
                "BLOCKED_CLOUD_FAULT_COMMAND", status="BLOCKED")
        return raw
    if credential:
        raw, _, _ = diagnostic_read(GUEST_PRIVATE / "cloud-isolation.json", GUEST_PRIVATE, 0, maximum=16384)
        saved = json.loads(raw)
        require(saved.get("format") == "asa-realhost-cloud-isolation-v1" and saved.get("nonce") == context["nonce"]
                and saved.get("sourceRevision") == context["sourceRevision"]
                and type(saved.get("observedNs")) is int and 0 <= time.time_ns() - saved["observedNs"] < 30 * 10**9,
                "CLOUD_FAULT_ISOLATION_BINDING")
        record = json.loads(read(["inspect", "--format", CLOUD_INSPECT, saved["container"]["id"]]))
        require(cloud_container_identity(record, saved["earliestNs"]) == saved["container"]
                and record["networks"] == {} and record.get("running") is True
                and record.get("pid") == saved["process"]["pid"]
                and same_process(saved["process"], proc_identity(record["pid"]))
                and Path(f"/proc/{record['pid']}/ns/net").stat().st_ino == saved["namespaceInode"]
                and saved["namespaceInode"] != network_namespace_inode(), "CLOUD_FAULT_ISOLATION_BINDING")
    else:
        require(not os.path.lexists(CLOUD_ROOT), "CLOUD_FAULT_EXISTING_RESOURCE")
        for args in (["ps", "-aq", "--no-trunc", "--filter", "label=com.docker.compose.project=" + CLOUD_PROJECT],
                     ["ps", "-aq", "--no-trunc", "--filter", "name=^" + CLOUD_CONTAINER + "$"],
                     ["network", "ls", "-q", "--no-trunc", "--filter", "label=com.docker.compose.project=" + CLOUD_PROJECT],
                     ["network", "ls", "-q", "--no-trunc", "--filter", "name=^" + CLOUD_PROJECT + "_default$"]):
            require(not read(args).strip(), "CLOUD_FAULT_EXISTING_RESOURCE")
    result = launcher.prepare_cloud_transport(candidate_bundle(context), owner=owner,
        credential_file=cloud_fixture_paths()[1] if credential else None)
    require(result.get("format") == "asa-cloud-preparation-v1" and result.get("project") == CLOUD_PROJECT
            and result.get("image") == CLOUD_IMAGE and result.get("reused") is credential
            and result.get("tokenConfigured") is credential and result.get("deliveryVerified") is False,
            "CLOUD_FAULT_PREPARATION")
    return {"reused": credential, "dummyImported": credential, "deliveryVerified": False, "transportSha256": CLOUD_SOURCE_SHA256}


class CloudFaultProcess(OwnedFaultProcess):
    def guard(self):
        super().guard()
        require(shutil.disk_usage(INSTALL_ROOT).free > RESERVE, "BLOCKED_CLOUD_FAULT_DISK_RESERVE", status="BLOCKED")


class CloudFault:
    """Own only a freshly absent, pinned transport in this nonce-bound VM."""
    def __init__(self, context, owner):
        require(os.geteuid() == 0 and isinstance(owner, dict) and type(owner.get("uid")) is int and owner["uid"] > 0
                and type(owner.get("gid")) is int and owner["gid"] > 0 and owner.get("name") == "asa-setup"
                and owner.get("root") == str(INSTALL_ROOT) and owner.get("home") == "/var/lib/asa-setup/operator",
                "CLOUD_FAULT_OWNER")
        self.context, self.owner = context, owner
        self.deadline = time.monotonic() + CLOUD_FAULT_SECONDS
        self.work_deadline = self.deadline - CLOUD_CLEANUP_SECONDS
        self.earliest_ns = time.time_ns()
        self.binding = self.network_binding = self.init_process = self.dummy_info = self.empty_info = None
        self.active_child = None
        self.fixture_started = self.preparation_started = self.dummy_imported = False
        self.environment = {key: value for key, value in guest_environment().items() if key not in ("GH_TOKEN", "GITHUB_TOKEN")}
        self.docker_config = GUEST_PRIVATE / "cloud-docker-config"
        require(not os.path.lexists(self.docker_config), "CLOUD_FAULT_FIXTURE_EXISTS")
        self.docker_config.mkdir(mode=0o700)
        self.environment.update(DOCKER_HOST="unix:///var/run/docker.sock", DOCKER_CONFIG=str(self.docker_config))
        self.evidence = {"credentialKind": "DUMMY_ONLY", "realProviderAuthentication": "NOT_RUN",
            "realYandexUploadReadback": "NOT_RUN", "specificProviderError": "UNAVAILABLE",
            "transportSha256": CLOUD_SOURCE_SHA256, "image": CLOUD_IMAGE, "imageId": CLOUD_IMAGE_ID,
            "opsRevision": context["pins"]["browser"]["opsRevision"], "phaseBudgetSeconds": CLOUD_FAULT_SECONDS,
            "cleanupReserveSeconds": CLOUD_CLEANUP_SECONDS, "cases": {}, "cleanup": {"status": "NOT_RUN"}}

    def remaining(self, maximum, *, cleanup=False):
        remaining = (self.deadline if cleanup else self.work_deadline) - time.monotonic()
        require(remaining > 0, "BLOCKED_CLOUD_FAULT_BUDGET", status="BLOCKED")
        if not cleanup:
            require(shutil.disk_usage(INSTALL_ROOT).free > RESERVE, "BLOCKED_CLOUD_FAULT_DISK_RESERVE", status="BLOCKED")
        return min(maximum, remaining)

    def command(self, args, *, timeout=15, cleanup=False):
        report, raw = diagnostic_command(args, timeout=self.remaining(timeout, cleanup=cleanup), environment=self.environment)
        require(report.get("exitCode") == 0 and not report.get("reasonCode") and not report.get("cleanupReasonCode"),
                "BLOCKED_CLOUD_FAULT_COMMAND", status="BLOCKED")
        return raw

    def docker(self, *args, timeout=15, cleanup=False):
        return self.command(["docker", *args], timeout=timeout, cleanup=cleanup)

    def child(self, phase, *, operator=False, timeout=360, cleanup=False):
        environment = self.environment
        if operator:
            environment = {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                "HOME": self.owner["home"], "USER": self.owner["name"], "LOGNAME": self.owner["name"],
                "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "PYTHONDONTWRITEBYTECODE": "1",
                "DOCKER_HOST": "unix:///var/run/docker.sock"}
        budget = self.remaining(timeout, cleanup=cleanup)
        process_class = OwnedFaultProcess if cleanup else CloudFaultProcess
        with process_class(["/usr/bin/python3", "-I", "-B", GUEST_HOME / "runner.py", "--guest-phase", phase],
                environment=environment, deadline=time.monotonic() + budget,
                owner=self.owner if operator else None) as child:
            self.active_child = child
            code, raw = child.wait(budget)
        try:
            result = json.loads(raw)
        except (ValueError, UnicodeError):
            raise Failure("CLOUD_FAULT_CHILD_REPORT") from None
        require(isinstance(result, dict) and result.get("format") == "asa-realhost-guest-v1"
                and result.get("phase") == phase, "CLOUD_FAULT_CHILD_REPORT")
        if type(code) is not int or code != 0 or result.get("status") != "PASS":
            source_blocked = (phase == "owner-cloud-restore" and operator and cleanup
                              and type(code) is int and code == 2 and result.get("status") == "BLOCKED"
                              and result.get("reasonCode") == "BLOCKED_CLOUD_FAULT_SOURCE_DUMMY"
                              and result.get("sourceDummyRemoved") is False
                              and all(result.get(key) is True for key in
                                      ("configurationRestored", "controlDataPreserved", "originalWritersReady")))
            blocked = (type(code) is int and code == 2 and result.get("status") == "BLOCKED"
                       and result.get("reasonCode") in ("BLOCKED_CLOUD_FAULT_COMMAND", "BLOCKED_CLOUD_FAULT_BUDGET",
                                                        "BLOCKED_CLOUD_FAULT_DISK_RESERVE"))
            error = Failure("BLOCKED_CLOUD_FAULT_CHILD" if blocked or source_blocked else "CLOUD_FAULT_CHILD_FAILED",
                            status="BLOCKED" if blocked or source_blocked else "FAIL")
            if source_blocked:
                error.source_dummy_cleanup = {"sourceDummyRemoved": False, "configurationRestored": True,
                                              "controlDataPreserved": True, "originalWritersReady": True}
            raise error
        return result

    def daemon(self, *, cleanup=False):
        raw = self.docker("info", "--format", "{{.ID}}", cleanup=cleanup).strip()
        require(raw and hashlib.sha256(raw).hexdigest() == root_json("host-baseline.json")["daemonIdentitySha256"],
                "CLOUD_FAULT_DAEMON_IDENTITY")
        return hashlib.sha256(raw).hexdigest()

    def identifiers(self, kind, field, value, *, cleanup=False):
        args = ["network", "ls"] if kind == "network" else ["ps", "-a"]
        raw = self.docker(*args, "-q", "--no-trunc", "--filter", field + "=" + value, cleanup=cleanup)
        values = raw.decode("ascii").split()
        require(len(values) <= 8 and len(set(values)) == len(values)
                and all(HEX64.fullmatch(value) for value in values), "CLOUD_FAULT_INVENTORY")
        return values

    def absent(self):
        require(not os.path.lexists(CLOUD_ROOT), "CLOUD_FAULT_EXISTING_RESOURCE")
        parent = os.open(CLOUD_ROOT.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            info = os.fstat(parent)
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
                    "CLOUD_FAULT_PARENT")
        finally:
            os.close(parent)
        for kind, name in (("container", CLOUD_CONTAINER), ("network", CLOUD_PROJECT + "_default")):
            require(not self.identifiers(kind, "label", "com.docker.compose.project=" + CLOUD_PROJECT)
                    and not self.identifiers(kind, "name", "^" + re.escape(name) + "$"), "CLOUD_FAULT_EXISTING_RESOURCE")
        self.evidence["initialResources"] = "ABSENT"

    def bind(self):
        ids = self.identifiers("container", "label", "com.docker.compose.project=" + CLOUD_PROJECT)
        networks = self.identifiers("network", "label", "com.docker.compose.project=" + CLOUD_PROJECT)
        require(len(ids) == len(networks) == 1, "CLOUD_FAULT_INVENTORY")
        record = json.loads(self.docker("inspect", "--format", CLOUD_INSPECT, ids[0]))
        network = json.loads(self.docker("network", "inspect", "--format", CLOUD_NETWORK_INSPECT, networks[0]))
        try:
            identity = cloud_container_identity(record, self.earliest_ns)
        except Failure as error:
            if error.code == "CLOUD_FAULT_CONTAINER_IDENTITY":
                try:
                    self.evidence["containerIdentityCheck"] = cloud_container_identity_observation(record)
                except BaseException:
                    self.evidence["containerIdentityCheck"] = {"format": "asa-realhost-cloud-identity-v1", "status": "UNAVAILABLE"}
            raise
        network_identity = cloud_network_identity(network, self.earliest_ns)
        require(identity["id"] == ids[0] and network_identity["id"] == networks[0]
                and record.get("running") is True and record.get("state") == "running"
                and type(record.get("pid")) is int and record["pid"] > 0
                and set(record["networks"]) == {network_identity["name"]}
                and record["networks"][network_identity["name"]].get("NetworkID") == networks[0]
                and set(network["containers"]) == {ids[0]}, "CLOUD_FAULT_NETWORK_IDENTITY")
        self.binding, self.network_binding = identity, network_identity
        self.init_process = proc_identity(record["pid"])
        require(self.init_process and self.init_process["state"] not in ("Z", "X"), "CLOUD_FAULT_PROCESS_IDENTITY")
        empty, info, _ = diagnostic_read(CLOUD_ROOT / "config/rclone.conf", CLOUD_ROOT / "config", 1000, maximum=4096)
        require(empty == b"" and info.st_gid == 1000, "CLOUD_FAULT_INITIAL_CREDENTIALS")
        self.empty_info = info
        self.evidence["container"] = {key: identity[key] for key in ("id", "image", "imageId", "created", "started", "user", "readonly", "publicPorts")}
        self.evidence["container"].update(mountsVerified=True, labelsVerified=True, freshNonceBoundVM=True)
        self.evidence["networkBefore"] = {"id": network_identity["id"], "attachedOnlyOwnedContainer": True}

    def container(self, *, stopped=False, cleanup=False):
        require(self.binding is not None, "CLOUD_FAULT_UNBOUND_RESOURCE")
        record = json.loads(self.docker("inspect", "--format", CLOUD_INSPECT, self.binding["id"], cleanup=cleanup))
        require(cloud_container_identity(record, self.earliest_ns) == self.binding, "CLOUD_FAULT_CONTAINER_CHANGED")
        require(record.get("networks") == {}, "CLOUD_FAULT_EGRESS_REAPPEARED")
        if stopped:
            require(record.get("running") is False and record.get("state") == "exited" and record.get("pid") == 0
                    and record.get("execIds") in ([], None), "CLOUD_FAULT_CONTAINER_NOT_QUIESCENT")
            actual = proc_identity(self.init_process["pid"])
            require(not same_process(self.init_process, actual) or actual["state"] in ("Z", "X"), "CLOUD_FAULT_PROCESS_REMAINS")
        else:
            require(record.get("running") is True and record.get("state") == "running"
                    and record.get("pid") == self.init_process["pid"]
                    and same_process(self.init_process, proc_identity(record["pid"])), "CLOUD_FAULT_PROCESS_IDENTITY")
        return record

    def network(self, *, empty, cleanup=False):
        require(self.network_binding is not None, "CLOUD_FAULT_UNBOUND_RESOURCE")
        record = json.loads(self.docker("network", "inspect", "--format", CLOUD_NETWORK_INSPECT,
                                       self.network_binding["id"], cleanup=cleanup))
        require(cloud_network_identity(record, self.earliest_ns) == self.network_binding
                and set(record["containers"]) == (set() if empty else {self.binding["id"]}), "CLOUD_FAULT_NETWORK_CHANGED")
        return record

    def isolate(self):
        # No credentials have been imported, and the original network has only this container.
        self.network(empty=False)
        record = json.loads(self.docker("inspect", "--format", CLOUD_INSPECT, self.binding["id"]))
        require(cloud_container_identity(record, self.earliest_ns) == self.binding
                and set(record["networks"]) == {self.network_binding["name"]}
                and record["networks"][self.network_binding["name"]].get("NetworkID") == self.network_binding["id"],
                "CLOUD_FAULT_NETWORK_CHANGED")
        self.docker("network", "disconnect", self.network_binding["id"], self.binding["id"])
        self.network(empty=True)
        self.evidence["isolatedNetwork"] = self.namespace()

    def namespace(self):
        record = self.container()
        pid = record["pid"]
        inode = Path(f"/proc/{pid}/ns/net").stat().st_ino
        prefix = ["nsenter", "--target", str(pid), "--net", "--", "ip", "-j"]
        interfaces = json.loads(self.command([*prefix, "address", "show"]))
        routes4 = json.loads(self.command([*prefix, "-4", "route", "show", "table", "all"]))
        routes6 = json.loads(self.command([*prefix, "-6", "route", "show", "table", "all"]))
        self.container()
        require(Path(f"/proc/{pid}/ns/net").stat().st_ino == inode, "CLOUD_FAULT_NAMESPACE")
        return cloud_namespace_projection(interfaces, routes4, routes6, inode, network_namespace_inode())

    def credentials(self):
        raw, info, _ = diagnostic_read(CLOUD_ROOT / "config/rclone.conf", CLOUD_ROOT / "config", 1000, maximum=4096)
        require(info.st_gid == 1000 and raw == cloud_dummy_configuration(self.context["nonce"])
                and (self.dummy_info is None or diagnostic_metadata(info) == diagnostic_metadata(self.dummy_info)),
                "CLOUD_FAULT_DUMMY_IDENTITY")
        self.dummy_info = info

    def quiescent(self):
        deadline = time.monotonic() + self.remaining(45)
        stable = False
        while time.monotonic() < deadline:
            record = self.container()
            if record.get("execIds") in ([], None):
                if stable:
                    return
                stable = True
            else:
                stable = False
            time.sleep(0.1)
        raise Failure("BLOCKED_CLOUD_FAULT_EXEC_QUIESCENCE", status="BLOCKED")

    def app_networks(self, ids, *, cleanup=False):
        require(isinstance(ids, dict) and set(ids) == {"postgres", "minio", "api", "web", "scratch", "search"}
                and all(isinstance(value, str) and HEX64.fullmatch(value) for value in ids.values()),
                "CLOUD_FAULT_APPLICATION_IDENTITY")
        pattern = '{"id":{{json .Id}},"networks":{{json .NetworkSettings.Networks}}}'
        rows = [json.loads(line) for line in self.docker("inspect", "--format", pattern, *sorted(ids.values()), cleanup=cleanup).splitlines()]
        require(len(rows) == len(ids) and {row.get("id") for row in rows} == set(ids.values()), "CLOUD_FAULT_APPLICATION_IDENTITY")
        result = {}
        for row in rows:
            networks = row.get("networks")
            require(isinstance(networks, dict) and 1 <= len(networks) <= 4
                    and all(isinstance(value, dict) and isinstance(value.get("NetworkID"), str)
                            and HEX64.fullmatch(value["NetworkID"]) for value in networks.values()),
                    "CLOUD_FAULT_APPLICATION_NETWORK")
            result[row["id"]] = sorted(value["NetworkID"] for value in networks.values())
        return canonical_hash(result)

    def read(self, path):
        raw, _, _ = diagnostic_read(path, INSTALL_ROOT, self.owner["uid"], maximum=2 * 1024**2)
        value = json.loads(raw)
        require(isinstance(value, dict), "CLOUD_FAULT_PRIVATE_FORMAT")
        return value

    def file_proof(self, path, *, maximum):
        directory = diagnostic_open(Path(path).parent, INSTALL_ROOT, self.owner["uid"], directory=True)
        try:
            descriptor = os.open(Path(path).name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        finally:
            os.close(directory)
        with os.fdopen(descriptor, "rb") as stream:
            before = os.fstat(stream.fileno())
            require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_uid == self.owner["uid"]
                    and not before.st_mode & 0o022 and 0 < before.st_size <= maximum, "CLOUD_FAULT_FILE_IDENTITY")
            digest = hashlib.sha256()
            prefix = stream.read(40)
            digest.update(prefix)
            while block := stream.read(1024**2):
                self.remaining(1)
                digest.update(block)
            require(diagnostic_metadata(before) == diagnostic_metadata(os.fstat(stream.fileno())), "CLOUD_FAULT_FILE_CHANGED")
        return {"sha256": digest.hexdigest(), "bytes": before.st_size}, prefix

    def inventory(self):
        folder = INSTALL_ROOT / "backups"
        descriptor = diagnostic_open(folder, INSTALL_ROOT, self.owner["uid"], directory=True)
        try:
            entries = sorted(os.listdir(descriptor))
        finally:
            os.close(descriptor)
        require(len(entries) <= 128 and "encrypted" in entries and all(name == "encrypted" or re.fullmatch(
            r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8,32}", name) for name in entries), "CLOUD_FAULT_BACKUP_INVENTORY")
        manifests = {name: self.file_proof(folder / name / "manifest.json", maximum=2 * 1024**2)[0]
                     for name in entries if name != "encrypted"}
        descriptor = diagnostic_open(folder / "encrypted", INSTALL_ROOT, self.owner["uid"], directory=True)
        try:
            encrypted = sorted(os.listdir(descriptor))
        finally:
            os.close(descriptor)
        require(len(encrypted) <= 129 and ".staging" in encrypted and all(name == ".staging" or re.fullmatch(
            r"asa-lab-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8,32}\.tar\.age", name) for name in encrypted),
            "CLOUD_FAULT_BACKUP_INVENTORY")
        descriptor = diagnostic_open(folder / "encrypted/.staging", INSTALL_ROOT, self.owner["uid"], directory=True)
        try:
            require(not os.listdir(descriptor), "CLOUD_FAULT_ENCRYPTION_INCOMPLETE")
        finally:
            os.close(descriptor)
        return {"manifests": manifests, "ciphertextEntries": [name for name in encrypted if name != ".staging"]}

    def snapshot(self, snapshot_id, installation_id):
        require(isinstance(snapshot_id, str) and re.fullmatch(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8,32}", snapshot_id),
                "CLOUD_FAULT_SNAPSHOT_IDENTITY")
        receipt = self.read(INSTALL_ROOT / ".asa/setup-backups" / (snapshot_id + ".json"))
        local, encrypted = receipt.get("local", {}), receipt.get("encryption", {})
        require(receipt.get("format") == "asa-backup-operation-v1" and receipt.get("installationId") == installation_id
                and receipt.get("snapshotId") == snapshot_id and isinstance(receipt.get("operationId"), str)
                and re.fullmatch(r"[a-f0-9]{32}", receipt["operationId"])
                and isinstance(local, dict) and isinstance(encrypted, dict)
                and local.get("status") == encrypted.get("status") == "OK", "CLOUD_FAULT_SNAPSHOT_IDENTITY")
        folder = INSTALL_ROOT / "backups" / snapshot_id
        ciphertext = INSTALL_ROOT / "backups/encrypted" / ("asa-lab-" + snapshot_id + ".tar.age")
        require(local.get("path") == str(folder) and encrypted.get("path") == str(ciphertext), "CLOUD_FAULT_SNAPSHOT_IDENTITY")
        manifest, _ = self.file_proof(folder / "manifest.json", maximum=2 * 1024**2)
        proof, prefix = self.file_proof(ciphertext, maximum=2 * GIB)
        require(manifest["sha256"] == local.get("manifestSha256") == encrypted.get("manifestSha256")
                and proof["sha256"] == encrypted.get("sha256") and proof["bytes"] == encrypted.get("bytes")
                and prefix.startswith(b"age-encryption.org/v1\n"), "CLOUD_FAULT_CIPHERTEXT")
        return receipt, {"snapshotId": snapshot_id, "sourceOperationId": receipt["operationId"],
                         "manifestSha256": manifest["sha256"], "ciphertextSha256": proof["sha256"], "ciphertextBytes": proof["bytes"]}

    def observe(self, baseline):
        value = self.child("owner-cloud-observe", operator=True)
        require(value.get("noPendingOperation") is True and value.get("originalWritersReady") is True
                and value.get("controlDataPreserved") is True
                and value.get("writerIdentitySha256") == baseline["writerIdentitySha256"]
                and value.get("controlFingerprintSha256") == baseline["controlFingerprintSha256"]
                and lock_released(), "CLOUD_FAULT_CONTROL_CHANGED")
        self.credentials()
        self.namespace()
        require(self.app_networks(baseline["appIds"]) == self.app_network_identity, "CLOUD_FAULT_APPLICATION_NETWORK")
        self.daemon()
        return {"controlDataPreserved": True, "originalWritersReady": True, "lockReleased": True, "noPendingOperation": True}

    def case(self, policy, baseline, original_proof):
        operation_id = uuid.uuid4().hex
        require(not os.path.lexists(INSTALL_ROOT / ".asa/setup-operations" / (operation_id + ".json"))
                and not os.path.lexists(INSTALL_ROOT / ".asa/setup-backups" / ("operation-" + operation_id + ".json")),
                "CLOUD_FAULT_OPERATION_EXISTS")
        words = ["cloud", "sync"] if policy == "best-effort" else ["backup", "create"]
        options = ["--operation-id", operation_id, "--non-interactive"]
        if policy == "best-effort":
            options += ["--snapshot-id", baseline["snapshotId"]]
        before = self.inventory()
        pointer = self.read(INSTALL_ROOT / ".asa/setup-backups/last-local-success.json")
        self.quiescent()
        self.credentials()
        self.namespace()
        record = {"status": "PENDING", "operationId": operation_id}
        self.evidence["cases"][policy] = record
        started_ns = time.time_ns()
        budget = self.remaining(CLOUD_SYNC_SECONDS if policy == "best-effort" else CLOUD_BACKUP_SECONDS)
        command = ["/usr/local/bin/asa", *words, "--root", INSTALL_ROOT, "--json", "--no-color", *options]
        with CloudFaultProcess(command, environment=guest_environment(), deadline=time.monotonic() + budget) as child:
            self.active_child = child
            code, raw = child.wait(budget)
            record["process"] = child.proof()
        record["observedPublicExitCode"] = code if type(code) is int and -128 <= code <= 255 else None
        public = public_cli_result(words, code, raw, allowed=(0, 1, 2, 130))
        record["result"] = cloud_result_projection(public, {}, {})
        journal = self.read(INSTALL_ROOT / ".asa/setup-operations" / (operation_id + ".json"))
        snapshot_id = baseline["snapshotId"] if policy == "best-effort" else journal.get("snapshotId")
        receipt, proof = self.snapshot(snapshot_id, baseline["installationId"])
        record["result"] = cloud_result_projection(public, receipt, journal)
        cloud_require_result(record["result"], policy, operation_id, baseline["installationId"],
                             baseline["sourceOperationId"] if policy == "best-effort" else operation_id, journal, receipt, public)
        require(public.get("command") == " ".join(words), "CLOUD_FAULT_PUBLIC_COMMAND")
        self.quiescent()
        finished_ns = time.time_ns()
        stamp = lambda value: str(value // 10**9) + "." + str(value % 10**9).zfill(9)
        events = self.docker("events", "--since", stamp(started_ns), "--until", stamp(finished_ns),
            "--filter", "type=container", "--filter", "container=" + self.binding["id"], "--format", CLOUD_EVENTS, timeout=20)
        rows = [json.loads(line) for line in events.splitlines()]
        record["transport"] = cloud_exec_projection(rows, self.binding["id"], baseline["installationId"], started_ns, finished_ns)
        record["snapshot"] = proof
        after = self.inventory()
        if policy == "best-effort":
            require(before == after and proof == original_proof
                    and self.read(INSTALL_ROOT / ".asa/setup-backups/last-local-success.json") == pointer,
                    "CLOUD_FAULT_SYNC_REEXPORTED")
        else:
            require(snapshot_id not in before["manifests"]
                    and after["manifests"] == {**before["manifests"], snapshot_id: after["manifests"].get(snapshot_id)}
                    and len(after["manifests"]) == len(before["manifests"]) + 1
                    and after["ciphertextEntries"] == sorted([*before["ciphertextEntries"], "asa-lab-" + snapshot_id + ".tar.age"])
                    and self.read(INSTALL_ROOT / ".asa/setup-backups/last-local-success.json")
                    == {"snapshotId": snapshot_id, "at": receipt["snapshotAt"]}, "CLOUD_FAULT_REQUIRED_BACKUP")
        require(self.snapshot(baseline["snapshotId"], baseline["installationId"])[1] == original_proof
                and not os.path.lexists(INSTALL_ROOT / ".asa/setup-backups/last-cloud-success.json"),
                "CLOUD_FAULT_OLD_BACKUP_CHANGED")
        record.update(controls=self.observe(baseline), completeSnapshotsBefore=len(before["manifests"]),
                      completeSnapshotsAfter=len(after["manifests"]), completeSnapshotDelta=0 if policy == "best-effort" else 1,
                      noExportOnSync=policy == "best-effort", status="PASS")

    def cleanup(self, baseline):
        proof = self.evidence["cleanup"] = {"status": "PENDING", "egressRestored": False}
        if self.binding is None:
            require(not self.preparation_started, "CLOUD_FAULT_UNBOUND_CLEANUP")
        else:
            record = json.loads(self.docker("inspect", "--format", CLOUD_INSPECT, self.binding["id"], cleanup=True))
            require(cloud_container_identity(record, self.earliest_ns) == self.binding, "CLOUD_FAULT_CONTAINER_CHANGED")
            if record["networks"]:
                require(not self.dummy_imported and set(record["networks"]) == {self.network_binding["name"]}
                        and record["networks"][self.network_binding["name"]].get("NetworkID") == self.network_binding["id"],
                        "CLOUD_FAULT_EGRESS_REAPPEARED")
                self.network(empty=False, cleanup=True)
                self.docker("network", "disconnect", self.network_binding["id"], self.binding["id"], cleanup=True)
            self.network(empty=True, cleanup=True)
            self.docker("stop", "--time", "10", self.binding["id"], timeout=30, cleanup=True)
            self.container(stopped=True, cleanup=True)
            proof.update(ownedContainerStopped=True, containerExecsQuiescent=True)
        require(self.active_child is None or self.active_child.closed, "CLOUD_FAULT_HOST_PROCESS_REMAINS")
        proof["hostProcessesQuiescent"] = True
        if self.binding is not None:
            path = CLOUD_ROOT / "config/rclone.conf"
            raw, info, _ = diagnostic_read(path, CLOUD_ROOT / "config", 1000, maximum=4096)
            require(raw in (b"", cloud_dummy_configuration(self.context["nonce"]))
                    and (raw != b"" or self.empty_info is not None
                         and diagnostic_metadata(info) == diagnostic_metadata(self.empty_info))
                    and (self.dummy_info is None or diagnostic_metadata(info) == diagnostic_metadata(self.dummy_info)),
                    "CLOUD_FAULT_DUMMY_IDENTITY")
            cloud_unlink_private(path, CLOUD_ROOT / "config", 1000, info, raw)
            proof["containerDummyRemoved"] = True
        if self.fixture_started:
            source_error = None
            try:
                result = self.child("owner-cloud-restore", operator=True, timeout=120, cleanup=True)
            except Failure as error:
                result = getattr(error, "source_dummy_cleanup", None)
                if result is None:
                    raise
                source_error = error
            require(result.get("configurationRestored") is True and result.get("controlDataPreserved") is True
                    and result.get("originalWritersReady") is True,
                    "CLOUD_FAULT_CONFIGURATION_RESTORE")
            raw, info, _ = diagnostic_read(INSTALL_ROOT / ".asa/setup.json", INSTALL_ROOT, self.owner["uid"], maximum=1024**2)
            require(hashlib.sha256(raw).hexdigest() == baseline["configurationSha256"]
                    and (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode))
                    == (baseline["configUid"], baseline["configGid"], baseline["configMode"]),
                    "CLOUD_FAULT_CONFIGURATION_RESTORE")
            proof.update(sourceDummyRemoved=False, exactConfigurationBytesOwnerModeRestored=True, controlDataPreserved=True)
            if source_error is not None:
                raise source_error
            require(result.get("sourceDummyRemoved") is True and not os.path.lexists(cloud_fixture_paths()[1]),
                    "CLOUD_FAULT_DUMMY_IDENTITY")
            proof["sourceDummyRemoved"] = True
        if self.binding is not None:
            self.container(stopped=True, cleanup=True)
            self.docker("rm", self.binding["id"], cleanup=True)
            proof["ownedContainerRemoved"] = True
            self.network(empty=True, cleanup=True)
            self.docker("network", "rm", self.network_binding["id"], cleanup=True)
            proof["ownedNetworkRemoved"] = True
            require(not self.identifiers("container", "label", "com.docker.compose.project=" + CLOUD_PROJECT, cleanup=True)
                    and not self.identifiers("network", "label", "com.docker.compose.project=" + CLOUD_PROJECT, cleanup=True),
                    "CLOUD_FAULT_RESOURCE_REMAINS")
        if baseline:
            require(self.app_networks(baseline["appIds"], cleanup=True) == self.app_network_identity,
                    "CLOUD_FAULT_APPLICATION_NETWORK")
        self.daemon(cleanup=True)
        proof.update(status="PASS", appNetworksAndDaemonPreserved=True,
                     privateEmptySpoolRetainedUntilVmDestruction=self.binding is not None)


def cloud_fault_guest(context):
    require(os.geteuid() == 0 and guest_guard() == context, "CLOUD_FAULT_GUEST_IDENTITY")
    require(shutil.disk_usage(INSTALL_ROOT).free >= 6 * GIB, "BLOCKED_FAULT_GUEST_DISK", status="BLOCKED")
    owner, _ = diagnostic_owner(context)
    run = CloudFault(context, owner)
    baseline, primary = None, None
    try:
        run.daemon()
        run.absent()
        baseline = run.child("owner-cloud-baseline", operator=True)
        run.fixture_started = True
        require(isinstance(baseline.get("installationId"), str) and re.fullmatch(r"[a-f0-9]{32}", baseline["installationId"])
                and baseline.get("configUid") == owner["uid"] and baseline.get("configGid") == owner["gid"]
                and baseline.get("configMode") == 0o600 and baseline.get("noPendingOperation") is True
                and all(isinstance(baseline.get(key), str) and HEX64.fullmatch(baseline[key]) for key in
                        ("configurationSha256", "writerIdentitySha256", "controlFingerprintSha256")),
                "CLOUD_FAULT_BASELINE")
        run.app_network_identity = run.app_networks(baseline["appIds"])
        require(not os.path.lexists(INSTALL_ROOT / ".asa/setup-backups/last-cloud-success.json"), "CLOUD_FAULT_PREVIOUS_CLOUD")
        _, original = run.snapshot(baseline["snapshotId"], baseline["installationId"])
        run.evidence["sourceSnapshot"] = original
        run.evidence["fixture"] = {"installationId": baseline["installationId"], "configurationBytesOwnerModeSaved": True,
            "fixtureOnlyPolicySetter": True, "publicConfigSetterClaimed": False, "retentionDeletionEnabled": False}
        run.preparation_started = True
        run.child("cloud-prepare-empty", timeout=300)
        run.bind()
        run.isolate()
        run.child("owner-cloud-best-effort", operator=True)
        isolation = run.namespace()
        write_json(GUEST_PRIVATE / "cloud-isolation.json", {"format": "asa-realhost-cloud-isolation-v1",
            "nonce": context["nonce"], "sourceRevision": context["sourceRevision"], "observedNs": time.time_ns(),
            "earliestNs": run.earliest_ns, "container": run.binding, "process": run.init_process,
            "namespaceInode": isolation["namespaceInode"]})
        run.dummy_imported = True  # Import may fail after its atomic replacement; cleanup still owns the dummy.
        run.child("cloud-prepare-dummy", timeout=60)
        run.credentials()
        run.namespace()
        version = run.docker("exec", "--user", "1000:1000", run.binding["id"], "rclone", "version")
        remotes = run.docker("exec", "--user", "1000:1000", run.binding["id"], "rclone",
                             "--config", "/config/rclone/rclone.conf", "listremotes")
        require(version.splitlines()[:1] == [b"rclone v1.75.2"] and remotes.strip() == b"yandex:", "CLOUD_FAULT_RCLONE_CONFIGURATION")
        run.credentials()
        run.evidence["configurationCheck"] = {"rcloneVersion": "1.75.2", "remoteName": "yandex",
            "singleDummyOAuthWithRefreshToken": True, "futureExpiry": True, "rcloneConfigReadSucceeded": True}
        run.case("best-effort", baseline, original)
        run.child("owner-cloud-required", operator=True)
        run.case("required", baseline, original)
    except BaseException as error:
        primary = error
    try:
        run.cleanup(baseline)
    except BaseException as error:
        run.evidence["cleanup"].update(status="BLOCKED", reasonCode="OWNED_CLOUD_CLEANUP_UNPROVEN")
        if primary is None:
            primary = Failure("BLOCKED_CLOUD_FAULT_CLEANUP", status="BLOCKED")
        primary.owned_cleanup_failed = True
    if primary is not None:
        primary.fault_evidence = run.evidence
        raise primary
    return {"cloudFault": run.evidence, "followingPositiveBackup": "REQUIRED_NEXT_PHASE",
            "realProviderAuthentication": "NOT_RUN", "realYandexUploadReadback": "NOT_RUN"}


class ExportWatcher:
    """inotify wakes observation after partial/objects creation; it does not alter export."""
    def __init__(self, root):
        import ctypes
        self.libc = ctypes.CDLL(None, use_errno=True)
        self.libc.inotify_init1.argtypes = [ctypes.c_int]
        self.libc.inotify_add_watch.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_uint32]
        self.fd = self.libc.inotify_init1(os.O_NONBLOCK | os.O_CLOEXEC)
        require(self.fd >= 0, "BLOCKED_FAULT_WATCHER", status="BLOCKED")
        self.paths = set()
        try:
            self.watch(root)
        except BaseException:
            os.close(self.fd)
            raise

    def watch(self, path):
        if path in self.paths:
            return
        require(path.is_dir() and not path.is_symlink(), "BLOCKED_FAULT_WATCHER", status="BLOCKED")
        require(self.libc.inotify_add_watch(self.fd, os.fsencode(path), 0x100 | 0x80) >= 0,
                "BLOCKED_FAULT_WATCHER", status="BLOCKED")
        self.paths.add(path)

    def wait(self):
        import struct
        with selectors.DefaultSelector() as selector:
            selector.register(self.fd, selectors.EVENT_READ)
            if not selector.select(0.02):
                return
        raw = os.read(self.fd, 65536)
        offset = 0
        while offset + 16 <= len(raw):
            _, mask, _, size = struct.unpack_from("iIII", raw, offset)
            require(not mask & 0x4000, "BLOCKED_FAULT_WATCHER_OVERFLOW", status="BLOCKED")
            offset += 16 + size

    def close(self):
        os.close(self.fd)


def fault_key(context):
    require(re.fullmatch(r"[a-f0-9]{32}", context["nonce"]), "FAULT_FIXTURE_IDENTITY")
    return "asa-realhost-fault-" + context["nonce"] + ".bin"


def owner_fault_fixture(context, *, remove=False):
    config_module, _, _, install, _, config, _ = owner_installation(context)
    from deployment.backup import managed_writers
    path = INSTALL_ROOT / ".asa/realhost-fault-fixture.json"
    key = fault_key(context)
    prefix = 'mc alias set local http://minio:9000 "$ASA_OBJECT_STORAGE_ACCESS_KEY" "$ASA_OBJECT_STORAGE_SECRET_KEY" >/dev/null; '
    target = '"local/$ASA_OBJECT_STORAGE_BUCKET/' + key + '"'
    command = ("run", "--rm", "--no-deps", "--entrypoint", "/bin/sh", "minio-init", "-eu", "-c")
    if remove:
        saved = config_module.private_json(path)
        require(saved.get("key") == key and saved.get("installationId") == config["installationId"], "FAULT_FIXTURE_IDENTITY")
        # owner_installation has proved application readiness before this exact authenticated deletion.
        install.compose(*command, prefix + "mc rm " + target, capture=True, timeout=90)
        saved["removed"] = True
        config_module.save_private(path, saved)
        return {"exactSyntheticObjectRemoved": True, "applicationReadyBeforeRemoval": True}
    require(not path.exists(), "FAULT_FIXTURE_EXISTS")
    available = shutil.disk_usage(INSTALL_ROOT).free
    require(available >= 6 * GIB, "BLOCKED_FAULT_GUEST_DISK", status="BLOCKED")
    with tempfile.TemporaryFile() as payload:
        digest = hashlib.sha256()
        for _ in range(FAULT_OBJECT_BYTES // (1024**2)):
            chunk = os.urandom(1024**2)
            payload.write(chunk)
            digest.update(chunk)
        payload.seek(0)
        install.compose(*command, prefix + "mc pipe " + target, input_file=payload, capture=True, timeout=120)
    with tempfile.TemporaryFile() as readback:
        install.compose(*command, prefix + "mc cat " + target, output=readback, timeout=120)
        require(readback.tell() == FAULT_OBJECT_BYTES, "FAULT_OBJECT_READBACK_BYTES")
        readback.seek(0)
        require(hashlib.file_digest(readback, "sha256").hexdigest() == digest.hexdigest(), "FAULT_OBJECT_READBACK_SHA256")
    records = install.identity()
    writers = managed_writers(install, records, json.loads(install.compose("config", "--format", "json", capture=True)))
    mounts = [item for item in records["minio"]["mounts"] if item.get("Destination") == "/data" and item.get("Type") == "volume"]
    require(len(mounts) == 1 and re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,200}", mounts[0].get("Name", "")), "FAULT_OBJECT_VOLUME")
    bucket = install.env["ASA_OBJECT_STORAGE_BUCKET"]
    require(re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", bucket), "FAULT_OBJECT_BUCKET")
    saved = {"key": key, "installationId": config["installationId"], "sha256": digest.hexdigest(), "bytes": FAULT_OBJECT_BYTES,
             "writers": writers, "minioContainer": records["minio"]["id"], "volume": mounts[0]["Name"], "bucket": bucket}
    config_module.save_private(path, saved)
    return {"authenticatedObjectBytes": FAULT_OBJECT_BYTES, "authenticatedReadbackSha256": digest.hexdigest(),
            "writerIdentitySha256": canonical_hash(writers), "fixtureUploaderExitedBeforeBackup": True,
            "guestFreeBytesBeforeFixture": available}


def fault_fixture():
    return json.loads((INSTALL_ROOT / ".asa/realhost-fault-fixture.json").read_text())


def plain_tree(path, *, content=False):
    """Bounded regular files only, without exposing filenames or their contents."""
    require(path.is_dir() and not path.is_symlink(), "FAULT_PARTIAL_PATH")
    entries, total = {}, 0
    for parent, directories, files in os.walk(path, followlinks=False):
        for name in directories + files:
            item = Path(parent) / name
            info = item.lstat()
            require(not stat.S_ISLNK(info.st_mode) and (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)), "FAULT_PARTIAL_PATH")
            if name in files:
                total += info.st_size
                require(len(entries) < 20000 and total <= 2 * GIB, "BLOCKED_FAULT_PARTIAL_BUDGET", status="BLOCKED")
                entries[item.relative_to(path).as_posix()] = {"bytes": info.st_size, "mtimeNs": info.st_mtime_ns,
                    **({"sha256": hash_file(item)} if content else {})}
    return entries


def fault_binding(operation_id, *, required=True):
    require(re.fullmatch(r"[a-f0-9]{32}", operation_id), "FAULT_OPERATION_ID")
    path = INSTALL_ROOT / ".asa/setup-backups" / ("operation-" + operation_id + ".json")
    if not path.exists() and not required:
        return None
    value = json.loads(path.read_text())
    require(value.get("operationId") == operation_id and value.get("installationId") == fault_fixture()["installationId"]
            and re.fullmatch(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8,32}", value.get("snapshotId", "")), "FAULT_SNAPSHOT_BINDING")
    return value["snapshotId"]


def partial_proof(operation_id, *, content=False):
    snapshot = fault_binding(operation_id)
    partial = INSTALL_ROOT / "backups" / (snapshot + ".incomplete")
    files = plain_tree(partial, content=content)
    objects = [value["bytes"] for name, value in files.items() if name.startswith("objects/")]
    fixture = fault_fixture()
    prefix = "objects/" + fixture["bucket"] + "/" + fixture["key"] + "/"
    parts = [value["bytes"] for name, value in files.items() if name.startswith(prefix)
             and re.fullmatch(r"part\.[1-9][0-9]*", Path(name).name)]
    final = INSTALL_ROOT / "backups" / snapshot
    ciphertext = INSTALL_ROOT / "backups/encrypted" / ("asa-lab-" + snapshot + ".tar.age")
    return {"operationId": operation_id, "snapshotId": snapshot, "files": len(files), "bytes": sum(item["bytes"] for item in files.values()),
            "databaseBytes": files.get("database.dump", {}).get("bytes", 0), "globalsBytes": files.get("globals.sql", {}).get("bytes", 0),
            "objectBytes": sum(objects), "largestObjectFileBytes": max(objects, default=0),
            "syntheticPartBytes": max(parts, default=0), "treeSha256": canonical_hash(files),
            "objectsDirectory": (partial / "objects").is_dir(), "manifestPresent": (partial / "manifest.json").exists(),
            "finalPresent": final.exists(), "ciphertextPresent": ciphertext.exists()}


def require_incomplete(proof):
    require(proof["databaseBytes"] > 0 and proof["globalsBytes"] > 0 and proof["objectsDirectory"]
            and not any(proof[key] for key in ("manifestPresent", "finalPresent", "ciphertextPresent")), "FAULT_NOT_PARTIAL")


def lock_released():
    import fcntl
    path = INSTALL_ROOT / ".asa/operation.lock"
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, "FAULT_LOCK_IDENTITY")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        actual = os.fstat(descriptor)
        require((actual.st_dev, actual.st_ino) == (info.st_dev, info.st_ino), "FAULT_LOCK_IDENTITY")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except BlockingIOError:
            return False
    finally:
        os.close(descriptor)


def stable_partial(operation_id):
    require(lock_released(), "BLOCKED_FAULT_LOCK_STILL_HELD", status="BLOCKED")
    first = partial_proof(operation_id, content=True)
    time.sleep(1)
    second = partial_proof(operation_id, content=True)
    require(first == second, "BLOCKED_FAULT_PARTIAL_NOT_STABLE", status="BLOCKED")
    require_incomplete(second)
    return {**second, "stableAfterQuiescence": True, "operationLockReleased": True}


def fault_receipt(operation_id):
    snapshot = fault_binding(operation_id)
    receipt = json.loads((INSTALL_ROOT / ".asa/setup-backups" / (snapshot + ".json")).read_text())
    journal = json.loads((INSTALL_ROOT / ".asa/setup-operations" / (operation_id + ".json")).read_text())
    require(receipt.get("snapshotId") == snapshot and receipt.get("operationId") == operation_id
            and journal.get("operationId") == operation_id and journal.get("snapshotId") == snapshot, "FAULT_RECEIPT_IDENTITY")
    require(receipt.get("local", {}).get("status") != "OK" and receipt.get("outcome") not in ("ACCEPTED", "WARNING")
            and journal.get("result", {}).get("dataProtectionConfirmed") is not True, "FAULT_FALSE_BACKUP_SUCCESS")
    return fault_receipt_projection(receipt, journal)


def fault_receipt_projection(receipt, journal):
    receipt = receipt if isinstance(receipt, dict) else {}
    journal = journal if isinstance(journal, dict) else {}
    local = receipt.get("local") if isinstance(receipt.get("local"), dict) else {}
    allowed = {"PENDING", "RUNNING", "UNKNOWN", "FAILED", "BLOCKED", "ERROR", "INTERRUPTED", "RECOVERY_REQUIRED", "TERMINAL", "NOT_RUN"}
    result = {"journalState": journal.get("state") if isinstance(journal.get("state"), str) and journal["state"] in allowed else "UNVERIFIED",
              "outcome": receipt.get("outcome") if isinstance(receipt.get("outcome"), str) and receipt["outcome"] in allowed else "UNVERIFIED"}
    for key in ("status", "executionStatus"):
        value = local.get(key)
        result["local" + key[0].upper() + key[1:]] = value if isinstance(value, str) and value in allowed else "UNVERIFIED"
    reason = local.get("error")
    if reason in ("COMMAND", "COMMAND_TIMEOUT", "BACKUP_RESUME_SNAPSHOT_MISSING", "BACKUP_INCOMPLETE", "OSError", "FileNotFoundError"):
        result["localReasonCode"] = reason
    return result


def owner_fault_observe(context):
    _, _, _, install, _, _, _ = owner_installation(context)
    from deployment.backup import managed_writers
    actual = managed_writers(install, install.identity(), json.loads(install.compose("config", "--format", "json", capture=True)))
    require(actual == fault_fixture()["writers"], "FAULT_WRITERS_CHANGED")
    require(not (INSTALL_ROOT / ".asa/maintenance.json").exists(), "FAULT_WRITERS_NOT_RESUMED")
    return {"exactOriginalWritersRestored": True, "writerIdentitySha256": canonical_hash(actual),
            "control": owner_observe(context)}


def fault_public_command(operation_id):
    require(re.fullmatch(r"[a-f0-9]{32}", operation_id), "FAULT_OPERATION_ID")
    return ["/usr/local/bin/asa", "backup", "create", "--root", INSTALL_ROOT, "--json", "--no-color",
            "--operation-id", operation_id, "--non-interactive"]


def completed_fault_command(operation_id, *, deadline, timeout, allowed):
    with OwnedFaultProcess(fault_public_command(operation_id), environment=guest_environment(), deadline=deadline) as child:
        code, raw = child.wait(timeout)
        value = public_cli_result(["backup", "create"], code, raw, allowed=allowed)
        return value, child.proof()


def fault_baseline():
    value = root_json("fault-baseline.json")
    pointer = INSTALL_ROOT / ".asa/setup-backups/last-local-success.json"
    require(hash_file(pointer) == value["lastLocalSuccessSha256"] and manifest_count() == value["completeSnapshots"],
            "FAULT_CHANGED_LAST_SUCCESS")
    return value


def fault_size_gate(database_bytes, globals_bytes, source_part_bytes):
    require(type(source_part_bytes) is int and source_part_bytes > FAULT_FILE_LIMIT,
            "BLOCKED_FAULT_OBJECT_PART_TOO_SMALL", status="BLOCKED")
    require(all(type(size) is int and 0 < size < FAULT_FILE_LIMIT for size in (database_bytes, globals_bytes)),
            "BLOCKED_FAULT_DATABASE_TOO_LARGE", status="BLOCKED")


def prepare_backup_fault(context):
    uploaded = owner_call("owner-fault-prepare", timeout=360)
    fixture = fault_fixture()
    _, raw = Commands().run(["docker", "volume", "inspect", "--format", "{{.Mountpoint}}", fixture["volume"]], timeout=30)
    mount = Path(raw.decode().strip())
    source = mount / fixture["bucket"] / fixture["key"]
    require(mount.is_absolute() and source.is_relative_to(mount)
            and not any(path.is_symlink() for path in [source, *source.parents]), "FAULT_OBJECT_VOLUME")
    parts = [entry["bytes"] for name, entry in plain_tree(source).items() if re.fullmatch(r"part\.[1-9][0-9]*", Path(name).name)]
    require(parts and max(parts) > FAULT_FILE_LIMIT, "BLOCKED_FAULT_OBJECT_PART_TOO_SMALL", status="BLOCKED")
    pointer = INSTALL_ROOT / ".asa/setup-backups/last-local-success.json"
    previous = json.loads(pointer.read_text())
    require(re.fullmatch(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8,32}", previous.get("snapshotId", "")), "FAULT_BASELINE_BACKUP")
    saved = json.loads((pointer.parent / (previous["snapshotId"] + ".json")).read_text())
    proof = snapshot_proof(saved["operationId"])
    full = INSTALL_ROOT / "backups" / proof["snapshotId"]
    sizes = {name: (full / name).stat().st_size for name in ("database.dump", "globals.sql")}
    fault_size_gate(sizes["database.dump"], sizes["globals.sql"], max(parts))
    baseline = {"lastLocalSuccessSha256": hash_file(pointer), "completeSnapshots": manifest_count(), "previousBackup": proof,
                "databaseBytes": sizes["database.dump"], "globalsBytes": sizes["globals.sql"],
                "sourceMinioPartBytes": max(parts), "fileSizeLimitBytes": FAULT_FILE_LIMIT,
                "guestFreeBytesBeforeFixture": uploaded["guestFreeBytesBeforeFixture"],
                "authenticatedObjectBytes": uploaded["authenticatedObjectBytes"],
                "authenticatedReadbackSha256": uploaded["authenticatedReadbackSha256"]}
    write_json(GUEST_PRIVATE / "fault-baseline.json", baseline)
    return baseline


def recover_partial(context, operation_id, before, deadline):
    held_before = (INSTALL_ROOT / ".asa/maintenance.json").exists()
    try:
        value, processes = completed_fault_command(operation_id, deadline=deadline,
            timeout=FAULT_RECOVERY_SECONDS, allowed=(2,))
    except Failure as error:
        if error.code in ("BLOCKED_FAULT_PHASE_BUDGET", "BLOCKED_FAULT_QUIESCENCE_BUDGET"):
            raise Failure("BLOCKED_FAULT_RECOVERY_BUDGET", status="BLOCKED") from None
        raise
    receipt = fault_receipt(operation_id)
    require(value.get("status") == "BLOCKED" and receipt.get("outcome") == "BLOCKED"
            and receipt.get("localReasonCode") == "BACKUP_RESUME_SNAPSHOT_MISSING", "FAULT_RECOVERY_CONTRACT")
    after = stable_partial(operation_id)
    require(after == before, "FAULT_RECOVERY_REEXPORTED")
    fault_baseline()
    observation = owner_call("owner-fault-observe", timeout=360)
    return {"publicExitCode": 2, "receipt": receipt, "sameSnapshotAndPartialBytes": True,
            "holdRemainedBeforeSameIdCommand": held_before,
            "allOwnedProcessesExited": processes["allOwnedProcessesExited"],
            "exactOriginalWritersRestored": observation["exactOriginalWritersRestored"],
            "control": observation["control"], "lastLocalSuccessPreserved": True}


def partial_fault_guest(context):
    deadline = time.monotonic() + FAULT_PHASE_SECONDS
    evidence = {"injection": "PER_CHILD_RLIMIT_FSIZE", "realYandexFault": "NOT_RUN"}
    try:
        evidence["baseline"] = prepare_backup_fault(context)
        operation_id = uuid.uuid4().hex
        evidence["operationId"] = operation_id
        with OwnedFaultProcess(fault_public_command(operation_id), environment=guest_environment(), file_limit=True, deadline=deadline) as child:
            code, raw = child.wait(FAULT_WINDOW_SECONDS + FAULT_QUIESCENCE_SECONDS)
            public_cli_result(["backup", "create"], code, raw, allowed=(2,))
            evidence["processes"] = child.proof()
        partial = stable_partial(operation_id)
        require(partial["syntheticPartBytes"] == FAULT_FILE_LIMIT and partial["objectBytes"] > 0
                and 0 < partial["databaseBytes"] < FAULT_FILE_LIMIT and 0 < partial["globalsBytes"] < FAULT_FILE_LIMIT,
                "BLOCKED_FAULT_SIZE_LIMIT_NOT_REACHED", status="BLOCKED")
        receipt = fault_receipt(operation_id)
        require(receipt["localStatus"] == "FAILED" and receipt["outcome"] == "BLOCKED", "FAULT_PARTIAL_RECEIPT")
        evidence.update(publicExitCode=code, partial=partial, receipt=receipt, observedObjectFileLimitReached=True)
        fault_baseline()
        evidence["sameIdRecovery"] = recover_partial(context, operation_id, partial, deadline)
        write_json(GUEST_PRIVATE / "fault-partial-proof.json", partial)
        return evidence
    except BaseException as error:
        error.fault_evidence = evidence
        raise


def export_window(proof, source_part_bytes):
    return (proof.get("databaseBytes", 0) > 0 and proof.get("globalsBytes", 0) > 0 and proof.get("objectsDirectory") is True
            and 0 <= proof.get("syntheticPartBytes", 0) < source_part_bytes
            and not any(proof.get(key) for key in ("manifestPresent", "finalPresent", "ciphertextPresent")))


def actual_copy_process(child, operation_id):
    snapshot = fault_binding(operation_id)
    source = fault_fixture()["minioContainer"] + ":/data/."
    target = str(INSTALL_ROOT / "backups" / (snapshot + ".incomplete") / "objects")
    for identity in child.members():
        try:
            raw = Path(f"/proc/{identity['pid']}/cmdline").read_bytes()
            if len(raw) > 8192 or not same_process(identity, proc_identity(identity["pid"])):
                continue
            args = raw.rstrip(b"\0").decode().split("\0")
            if len(args) == 4 and Path(args[0]).name == "docker" and args[1:] == ["cp", source, target]:
                return True
        except (OSError, UnicodeError):
            continue
    return False


def interrupt_at_export(child, operation_id):
    deadline = time.monotonic() + FAULT_WINDOW_SECONDS
    source_part_bytes = root_json("fault-baseline.json")["sourceMinioPartBytes"]
    watcher = ExportWatcher(INSTALL_ROOT / "backups")
    try:
        while child.members():
            child.guard()
            require(time.monotonic() < deadline, "BLOCKED_FAULT_WINDOW_BUDGET", status="BLOCKED")
            snapshot = fault_binding(operation_id, required=False)
            partial = INSTALL_ROOT / "backups" / (snapshot + ".incomplete") if snapshot else None
            if partial and partial.is_dir():
                watcher.watch(partial)
                try:
                    proof = partial_proof(operation_id)
                except FileNotFoundError:
                    raise Failure("BLOCKED_FAULT_WINDOW_MISSED", status="BLOCKED") from None
                if export_window(proof, source_part_bytes):
                    stopped_at = time.monotonic()
                    require(child.signal(signal.SIGSTOP), "BLOCKED_FAULT_WINDOW_MISSED", status="BLOCKED")
                    injection = None
                    try:
                        while any(value["state"] not in ("T", "t") for value in child.members()):
                            require(time.monotonic() - stopped_at < 3, "BLOCKED_FAULT_STOP_BUDGET", status="BLOCKED")
                            time.sleep(0.01)
                        frozen = partial_proof(operation_id)
                        require(export_window(frozen, source_part_bytes), "BLOCKED_FAULT_WINDOW_MISSED", status="BLOCKED")
                        hold = json.loads((INSTALL_ROOT / ".asa/maintenance.json").read_text())
                        require(hold.get("operationId") == operation_id and hold.get("snapshotId") == snapshot
                                and hold.get("phase") == "backup", "FAULT_HOLD_IDENTITY")
                        copy_seen = actual_copy_process(child, operation_id)
                        require(time.monotonic() - stopped_at < 3, "BLOCKED_FAULT_STOP_BUDGET", status="BLOCKED")
                        require(child.signal(signal.SIGINT), "BLOCKED_FAULT_WINDOW_MISSED", status="BLOCKED")
                        injection = {"signal": "SIGINT", "precededByOwnedSIGSTOP": True, "window": "AFTER_DUMPS_BEFORE_OBJECTS_COMPLETE",
                                "actualDockerCopyObserved": copy_seen, "objectBytesAtSignal": frozen["objectBytes"],
                                "interruptedDuringCopy": copy_seen and frozen["objectBytes"] > 0,
                                "databaseBytesAtSignal": frozen["databaseBytes"], "globalsBytesAtSignal": frozen["globalsBytes"]}
                    finally:
                        child.signal(signal.SIGCONT)
                    stopped_for = time.monotonic() - stopped_at
                    require(stopped_for < 3, "BLOCKED_FAULT_STOP_BUDGET", status="BLOCKED")
                    injection["stoppedMilliseconds"] = round(stopped_for * 1000)
                    return injection
            watcher.wait()
        raise Failure("BLOCKED_FAULT_WINDOW_MISSED", status="BLOCKED")
    finally:
        watcher.close()


def interrupt_fault_guest(context):
    deadline = time.monotonic() + FAULT_PHASE_SECONDS
    evidence = {"injection": "OWNED_PUBLIC_PROCESS_GROUP_SIGINT", "realYandexFault": "NOT_RUN"}
    try:
        require(shutil.disk_usage(INSTALL_ROOT).free >= 6 * GIB, "BLOCKED_FAULT_GUEST_DISK", status="BLOCKED")
        fault_baseline()
        previous_partial = root_json("fault-partial-proof.json")
        operation_id = uuid.uuid4().hex
        evidence["operationId"] = operation_id
        with OwnedFaultProcess(fault_public_command(operation_id), environment=guest_environment(), deadline=deadline) as child:
            evidence["observedInjection"] = interrupt_at_export(child, operation_id)
            code, raw = child.wait(FAULT_QUIESCENCE_SECONDS)
            public_cli_result(["backup", "create"], code, raw, allowed=(130,))
            evidence["processes"] = child.proof()
        evidence["publicExitCode"] = code
        evidence["receiptAfterQuiescence"] = fault_receipt(operation_id)
        partial = stable_partial(operation_id)
        evidence["partial"] = partial
        fault_baseline()
        evidence["sameIdRecovery"] = recover_partial(context, operation_id, partial, deadline)
        new_operation = uuid.uuid4().hex
        require(new_operation not in (operation_id, previous_partial["operationId"]), "FAULT_NEW_OPERATION_ID")
        value, processes = completed_fault_command(new_operation, deadline=deadline, timeout=900, allowed=(0,))
        proof = snapshot_proof(new_operation)
        require(proof["snapshotId"] not in (partial["snapshotId"], previous_partial["snapshotId"]), "FAULT_NEW_SNAPSHOT_ID")
        public_cli(["backup", "verify"], options=["--snapshot-id", proof["snapshotId"]], timeout=180)
        pointer = json.loads((INSTALL_ROOT / ".asa/setup-backups/last-local-success.json").read_text())
        require(pointer.get("snapshotId") == proof["snapshotId"] and manifest_count() == root_json("fault-baseline.json")["completeSnapshots"] + 1,
                "FAULT_NEW_SUCCESS_POINTER")
        require(stable_partial(operation_id) == partial and stable_partial(previous_partial["operationId"]) == previous_partial,
                "FAULT_PARTIAL_NOT_PRESERVED")
        evidence.update(newSuccessfulBackup=proof, newOperationDistinct=True, lastLocalSuccessAdvanced=True,
                        bothIncompleteSnapshotsPreserved=True, newBackupProcesses=processes)
        evidence["fixtureCleanup"] = owner_call("owner-fault-remove", timeout=360)
        evidence["finalControl"] = owner_call("owner-fault-observe", timeout=360)
        require(panel_and_docker_identity() == root_json("host-baseline.json"), "ONEPANEL_DOCKER_CHANGED")
        return evidence
    except BaseException as error:
        error.fault_evidence = evidence
        raise


def network_namespace_inode():
    return Path("/proc/self/ns/net").stat().st_ino


def network_fault_child(context):
    original = root_json("fault-network-namespace.json")["namespaceInode"]
    current = network_namespace_inode()
    require(current != original and all(name == "lo" for _, name in socket.if_nameindex()), "FAULT_NETWORK_NAMESPACE")
    result = public_cli(["update", "check"], allowed=(2,), timeout=150)
    reasons = [result.get("reasonCode"), *result.get("reasonCodes", [])]
    require(result.get("status") == "BLOCKED" and "RELEASE_UNAVAILABLE" in reasons, "FAULT_RELEASE_CONNECTION_RESULT")
    return {"childNamespaceInode": current, "parentNamespaceInode": original, "separateNetworkNamespace": True,
            "publicCommand": "asa update check", "publicExitCode": 2, "reasonCode": "RELEASE_UNAVAILABLE",
            "scope": "PUBLIC_RELEASE_LOOKUP", "realYandexFault": "NOT_RUN"}


def network_fault_guest(context):
    original = network_namespace_inode()
    before = owner_call("owner-observe", timeout=360)
    write_json(GUEST_PRIVATE / "fault-network-namespace.json", {"namespaceInode": original})
    code, raw = Commands().run(["unshare", "--net", "--", "/usr/bin/python3", "-I", "-B", GUEST_HOME / "runner.py",
                               "--guest-phase", "network-fault-child"], environment=guest_environment(), timeout=180, allowed=(0, 1, 2))
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeError):
        raise Failure("BLOCKED_FAULT_NETWORK_NAMESPACE", status="BLOCKED") from None
    require(code == 0 and value.get("status") == "PASS" and value.get("phase") == "network-fault-child", "FAULT_NETWORK_CHILD")
    require(network_namespace_inode() == original, "FAULT_PARENT_NAMESPACE_CHANGED")
    require(owner_call("owner-observe", timeout=360) == before, "FAULT_NETWORK_CHANGED_DATA")
    return {"connectionFailure": {key: value[key] for key in ("childNamespaceInode", "parentNamespaceInode", "separateNetworkNamespace",
            "publicCommand", "publicExitCode", "reasonCode", "scope", "realYandexFault")}, "parentNamespaceUnchanged": True, "controlPreserved": True}


def owner_schedule_fixture(context):
    config_module, _, schedule, install, _, config, _ = owner_installation(context)
    require(config["backup"]["schedule"]["enabled"] is False, "FIXTURE_TIMER_MUST_BE_DISABLED")
    before = {**config, "backup": {key: value for key, value in config["backup"].items() if key != "schedule"}}
    due = int(math.ceil((time.time() + 240) / 60) * 60)
    calendar = dt.datetime.fromtimestamp(due, dt.timezone.utc)
    config["backup"]["schedule"] = {"enabled": False, "time": calendar.strftime("%H:%M"), "timezone": "UTC", "maxAgeHours": 26}
    validated = config_module.validate_config(config, INSTALL_ROOT, os.geteuid())
    after = {**validated, "backup": {key: value for key, value in validated["backup"].items() if key != "schedule"}}
    require(before == after, "FIXTURE_CHANGED_APPLICATION_CONFIGURATION")
    config_module.save_private(INSTALL_ROOT / ".asa/setup.json", validated)
    operation = schedule.scheduled_operation_id(config["installationId"], config["backup"]["schedule"], calendar + dt.timedelta(seconds=1))
    return {"dueEpoch": due, "time": calendar.strftime("%H:%M"), "timezone": "UTC", "unit": schedule.unit_name(config["installationId"]),
            "operationId": operation, "fixtureOnlyTimeSelection": True, "publicCliTimeSetterClaimed": False, "clockChanged": False}


def timer_properties(unit):
    commands = Commands()
    _, data = commands.run(["systemctl", "show", unit + ".timer", "-p", "ActiveState", "-p", "UnitFileState", "-p", "Persistent"])
    properties = dict(line.split("=", 1) for line in data.decode().splitlines() if "=" in line)
    timer = Path("/etc/systemd/system") / (unit + ".timer")
    service = Path("/etc/systemd/system") / (unit + ".service")
    require("Persistent=true" in timer.read_text() and "Restart=on-failure" in service.read_text()
            and "RestartSec=300" in service.read_text() and "StartLimitBurst=3" in service.read_text(), "TIMER_NATIVE_CONTRACT")
    return {"active": properties.get("ActiveState") == "active", "enabled": properties.get("UnitFileState") == "enabled",
            "persistent": properties.get("Persistent") == "yes", "timerSha256": hash_file(timer), "serviceSha256": hash_file(service)}


def schedule_guest(context):
    settings = json.loads((INSTALL_ROOT / ".asa/installation.json").read_text())
    automatic = settings.get("automaticUpdates")
    public_cli(["backup", "schedule", "disable"], timeout=180)
    fixture = owner_call("owner-schedule-fixture", timeout=300)
    unit = fixture["unit"]
    public_cli(["backup", "schedule", "enable"], timeout=180)
    enabled = timer_properties(unit)
    require(enabled["active"] and enabled["enabled"] and enabled["persistent"], "TIMER_ENABLE")
    public_cli(["backup", "schedule", "disable"], timeout=180)
    disabled = timer_properties(unit)
    require(not disabled["active"] and not disabled["enabled"], "TIMER_DISABLE")
    public_cli(["backup", "schedule", "enable"], timeout=180)
    again = timer_properties(unit)
    require(again == enabled, "TIMER_ENABLE_DUPLICATE")
    require(len(list(Path("/etc/systemd/system").glob(unit + ".*"))) == 2, "TIMER_UNIT_DUPLICATE")
    require(json.loads((INSTALL_ROOT / ".asa/installation.json").read_text()).get("automaticUpdates") == automatic, "TIMER_CHANGED_AUTO_UPDATE")
    require(fixture["dueEpoch"] - time.time() > 30, "BLOCKED_TIMER_PREPARATION_WINDOW", status="BLOCKED")
    state = {**fixture, "manifestCountBefore": manifest_count(), "unitProperties": enabled}
    attempts = INSTALL_ROOT / ".asa/setup-schedule-attempts" / fixture["operationId"]
    require(not list(attempts.glob("*.json"))
            and not (INSTALL_ROOT / ".asa/setup-operations" / (fixture["operationId"] + ".json")).exists(),
            "TIMER_TRIGGERED_DURING_PREPARATION")
    write_json(GUEST_PRIVATE / "timer.json", state)
    public_cli(["backup", "schedule"], timeout=60)
    return {**fixture, "enableDisableEnable": "PASS", "unitProperties": enabled, "automaticUpdatesUnchanged": True,
            "scheduledAttemptsBeforePoweroff": 0}


def service_observation(unit):
    _, data = Commands().run(["systemctl", "show", unit + ".service", "-p", "Result", "-p", "ActiveState",
                              "-p", "SubState", "-p", "ExecMainStatus", "-p", "NRestarts", "-p", "StartLimitBurst"])
    fields = dict(line.split("=", 1) for line in data.decode().splitlines() if "=" in line)
    require(all(re.fullmatch(r"[0-9]+", fields.get(key, "")) for key in ("ExecMainStatus", "NRestarts", "StartLimitBurst")),
            "SYSTEMD_SERVICE_REPORT")
    return {"result": fields.get("Result") if fields.get("Result") in ("success", "exit-code", "start-limit-hit", "exec-condition", "timeout", "signal") else "unknown",
            "autoRestartPending": fields.get("ActiveState") == "activating" and fields.get("SubState") == "auto-restart",
            "active": fields.get("ActiveState") == "active", "completed": fields.get("ActiveState") == "inactive" and fields.get("SubState") == "dead",
            "execMainStatus": int(fields["ExecMainStatus"]),
            "nRestarts": int(fields["NRestarts"]), "startLimitBurst": int(fields["StartLimitBurst"])}


def observe_failed_restart(state, *, source):
    observed = service_observation(state["unit"])
    if observed["result"] == "exit-code" and observed["execMainStatus"] not in (0, 130) and observed["autoRestartPending"]:
        proof = {"source": source, "failed": observed, "observedAt": now()}
        target = GUEST_PRIVATE / "timer-error.json"
        if not target.exists():
            write_json(target, proof)
    return observed


def automatic_retry_proved(failed, completed):
    return (failed.get("result") == "exit-code" and failed.get("execMainStatus") not in (0, 130, None)
            and failed.get("autoRestartPending") is True and completed.get("completed") is True
            and type(failed.get("nRestarts")) is int and type(completed.get("nRestarts")) is int
            and completed["nRestarts"] > failed["nRestarts"] and completed.get("result") == "success"
            and completed.get("execMainStatus") == 0)


def timer_probe(context):
    state = root_json("timer.json")
    operation = state["operationId"]
    observed = observe_failed_restart(state, source="boot-time manager failure")
    journal = INSTALL_ROOT / ".asa/setup-operations" / (operation + ".json")
    if not journal.exists():
        return {"status": "PENDING", "reasonCode": "SCHEDULED_OPERATION_NOT_STARTED", "systemd": observed}
    saved = json.loads(journal.read_text())
    if saved.get("state") != "TERMINAL" or saved.get("result", {}).get("exitCode") != 0:
        return {"status": "PENDING", "reasonCode": "SCHEDULED_OPERATION_NOT_COMPLETE", "systemd": observed}
    proof = snapshot_proof(operation)
    require(manifest_count() == state["manifestCountBefore"] + 1, "MISSED_TIMER_DUPLICATE")
    public_cli(["backup", "verify"], options=["--snapshot-id", proof["snapshotId"]], timeout=120)
    return {"backup": proof, "persistentTimerRecoveredMissedSlot": True, "systemd": observed,
            "attemptsInDailySlot": len(list((INSTALL_ROOT / ".asa/setup-schedule-attempts" / operation).glob("*.json")))}


def hold_guest_operation_lock(context):
    import select
    product_modules(context)
    from deployment.system import operation_lock
    with operation_lock(INSTALL_ROOT):
        print(json.dumps({"fixture": "operation-lock-held", "nonce": context["nonce"]}), flush=True)
        ready, _, _ = select.select([sys.stdin], [], [], 120)
        require(ready and sys.stdin.readline(32).strip() == "release", "LOCK_FIXTURE_TIMEOUT")
    return {"heldCanonicalOperationLock": True, "released": True}


def inject_timer_lock_fault(context, state):
    import pwd
    import select
    account = pwd.getpwnam("asa-setup")
    environment = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "HOME": account.pw_dir, "USER": account.pw_name,
                   "LOGNAME": account.pw_name, "LANG": "C.UTF-8", "PYTHONDONTWRITEBYTECODE": "1"}
    with tempfile.TemporaryFile() as private_errors:
        holder = subprocess.Popen(["runuser", "-u", account.pw_name, "--", "/usr/bin/python3", "-I", "-B",
                                   GUEST_HOME / "runner.py", "--guest-phase", "owner-hold-lock"],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=private_errors, env=environment, start_new_session=True)
        try:
            readable, _, _ = select.select([holder.stdout], [], [], 30)
            require(readable, "LOCK_FIXTURE_NOT_READY")
            proof = json.loads(holder.stdout.readline(65536))
            require(proof == {"fixture": "operation-lock-held", "nonce": context["nonce"]}, "LOCK_FIXTURE_BINDING")
            code, _ = Commands().run(["systemctl", "start", state["unit"] + ".service"], timeout=60, allowed=(0, 1))
            failed = observe_failed_restart(state, source="bounded canonical operation-lock fixture")
            require(code == 1 and failed["result"] == "exit-code" and failed["execMainStatus"] not in (0, 130)
                    and failed["autoRestartPending"], "SYSTEMD_ERROR_NOT_OBSERVED")
            holder.stdin.write(b"release\n")
            holder.stdin.flush()
            holder.stdin.close()
            require(holder.wait(timeout=15) == 0, "LOCK_FIXTURE_RELEASE")
            return failed
        finally:
            if holder.poll() is None:
                os.killpg(holder.pid, signal.SIGTERM)
                try:
                    holder.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(holder.pid, signal.SIGKILL)
                    holder.wait(timeout=5)
            holder.stdout.close()
            if not holder.stdin.closed:
                holder.stdin.close()


def timer_retry(context):
    state = root_json("timer.json")
    unit, operation = state["unit"], state["operationId"]
    attempts = INSTALL_ROOT / ".asa/setup-schedule-attempts" / operation
    before = snapshot_proof(operation)
    count = manifest_count()
    commands = Commands()
    number = len(list(attempts.glob("*.json")))
    require(number in (1, 2, 3), "TIMER_ATTEMPT_COUNT")
    if number == 1:
        failed = inject_timer_lock_fault(context, state)
        require(len(list(attempts.glob("*.json"))) == 2, "SYSTEMD_ERROR_ATTEMPT_COUNT")
    else:
        require((GUEST_PRIVATE / "timer-error.json").exists(), "BLOCKED_TIMER_SLOT_BUDGET", status="BLOCKED")
        failed = root_json("timer-error.json")["failed"]
    # Do not start the retry manually or shorten RestartSec. The real unchanged
    # service waits its production 300 seconds and retries itself.
    deadline = time.monotonic() + 540
    recovered = None
    while time.monotonic() < deadline:
        observed = service_observation(unit)
        if automatic_retry_proved(failed, observed):
            try:
                actual = snapshot_proof(operation)
            except (Failure, OSError, ValueError):
                actual = None
            if actual == before:
                recovered = observed
                break
        time.sleep(2)
    require(recovered is not None, "SYSTEMD_AUTOMATIC_RETRY_NOT_CONFIRMED")
    for _ in range(3):
        number = len(list(attempts.glob("*.json")))
        if number == 3:
            break
        require(number in (1, 2), "TIMER_ATTEMPT_COUNT")
        commands.run(["systemctl", "start", unit + ".service"], timeout=300)
    require(len(list(attempts.glob("*.json"))) == 3 and snapshot_proof(operation) == before and manifest_count() == count,
            "TIMER_RETRY_CHANGED_SNAPSHOT")
    code, _ = commands.run(["systemctl", "start", unit + ".service"], timeout=120, allowed=(0, 1))
    _, data = commands.run(["systemctl", "show", unit + ".service", "-p", "Result", "-p", "ExecCondition", "-p", "StartLimitBurst"])
    properties = dict(line.split("=", 1) for line in data.decode().splitlines() if "=" in line)
    budget_blocked = properties.get("Result") in ("start-limit-hit", "exec-condition") or "status=2" in properties.get("ExecCondition", "")
    require(budget_blocked and properties.get("StartLimitBurst") == "3" and len(list(attempts.glob("*.json"))) == 3
            and snapshot_proof(operation) == before and manifest_count() == count, "TIMER_RETRY_NOT_BOUNDED")
    public_cli(["backup", "schedule", "disable"], timeout=180)
    require(not timer_properties(unit)["enabled"], "TIMER_FINAL_DISABLE")
    return {"sameSnapshot": before, "attemptsInDailySlot": 3, "fourthStartRefusedOrSkipped": True,
            "realFailure": root_json("timer-error.json"), "automaticRetry": recovered, "restartSecUnchanged": 300,
            "fourthStartExitCode": code, "budgetResult": properties.get("Result") if properties.get("Result") in ("start-limit-hit", "exec-condition") else "exec-condition",
            "publicDisableCompleted": True}


def guest_phase(phase, context):
    if phase.startswith("owner-"):
        require(os.geteuid() != 0, "FIXTURE_MUST_BE_UNPRIVILEGED")
        if phase == "owner-seed":
            return owner_seed(context)
        if phase in ("owner-observe", "owner-final"):
            return owner_observe(context, browser=phase == "owner-final")
        if phase == "owner-schedule-fixture":
            return owner_schedule_fixture(context)
        if phase == "owner-hold-lock":
            return hold_guest_operation_lock(context)
        if phase in ("owner-diagnostic-paths", "owner-diagnostic-inventory"):
            return owner_diagnostic(context, inventory=phase == "owner-diagnostic-inventory")
        if phase in ("owner-fault-prepare", "owner-fault-remove"):
            return owner_fault_fixture(context, remove=phase == "owner-fault-remove")
        if phase == "owner-fault-observe":
            return owner_fault_observe(context)
        if phase in ("owner-cloud-baseline", "owner-cloud-best-effort", "owner-cloud-required",
                     "owner-cloud-observe", "owner-cloud-restore"):
            return owner_cloud_fixture(context, phase[len("owner-cloud-"):])
        raise Failure("UNKNOWN_OWNER_PHASE")
    require(os.geteuid() == 0, "GUEST_ROOT_REQUIRED")
    actions = {"bootstrap": bootstrap_guest, "published-acquire": published_acquire_guest,
               "install": install_guest, "cli-read": installed_cli_read_guest,
               "update": update_guest, "backup": backup_guest,
               "schedule": schedule_guest, "timer-probe": timer_probe, "timer-retry": timer_retry,
               "partial-fault": partial_fault_guest, "interrupt-fault": interrupt_fault_guest,
               "cloud-fault": cloud_fault_guest,
               "network-fault": network_fault_guest, "network-fault-child": network_fault_child}
    if phase in ("cloud-prepare-empty", "cloud-prepare-dummy"):
        return cloud_prepare_guest(context, credential=phase == "cloud-prepare-dummy")
    if phase in actions:
        return actions[phase](context)
    if phase == "seed":
        return {"control": owner_call("owner-seed", timeout=900)}
    if phase in ("post-reboot", "final"):
        proof = owner_call("owner-final" if phase == "final" else "owner-observe", timeout=900)
        require(panel_and_docker_identity() == root_json("host-baseline.json"), "ONEPANEL_DOCKER_CHANGED")
        observation = public_observation(context["pins"]["current"])
        for words in (["history"], ["logs", "backup"]):
            public_cli(words, allowed=(0, 1, 2), timeout=120)
        return {"control": proof, "publicObservation": observation, "onePanelAndDockerPreserved": True,
                "bootId": Path("/proc/sys/kernel/random/boot_id").read_text().strip()}
    raise Failure("UNKNOWN_GUEST_PHASE")


def guest_main(phase, *, control_deadline=None):
    result = {"format": "asa-realhost-guest-v1", "phase": phase, "status": "FAIL"}
    try:
        if phase == "owner-cli-control":
            require(type(control_deadline) in (int, float) and math.isfinite(control_deadline)
                    and 0 < control_deadline - time.monotonic() <= CLI_CONTROL_SECONDS, "CLI_CONTROL_DEADLINE")
            context = guest_guard(control_deadline=control_deadline)
            proof = owner_cli_control(context, control_deadline)
        else:
            require(control_deadline is None, "CLI_CONTROL_DEADLINE")
            context = guest_guard()
            proof = guest_phase(phase, context)
        require(isinstance(proof, dict) and proof.get("status", "PASS") in ("PASS", "PENDING", "FAIL", "BLOCKED"), "GUEST_PHASE_STATUS")
        result.update(proof, status=proof.get("status", "PASS"))
        return_code = 0 if result["status"] in ("PASS", "PENDING") else 2 if result["status"] == "BLOCKED" else 1
    except BaseException as error:
        result.update(status=getattr(error, "status", "FAIL"), reasonCode=safe_error(error))
        if phase in ("owner-observe", "update") and result["status"] == "FAIL" and result["reasonCode"] == "CONTROL_DATA_CHANGED":
            try:
                result["controlComparison"] = control_comparison_evidence(getattr(error, "control_comparison", None))
            except BaseException:
                pass
        browser_phase = {"owner-seed": ("CONTROL_BROWSER_BEFORE", "BEFORE"), "seed": ("CONTROL_BROWSER_BEFORE", "BEFORE"),
                         "owner-final": ("CONTROL_BROWSER_AFTER", "AFTER"), "final": ("CONTROL_BROWSER_AFTER", "AFTER")}.get(phase)
        if browser_phase and result["status"] == "FAIL" and result["reasonCode"] == browser_phase[0]:
            try:
                result["controlBrowserDiagnostic"] = control_browser_evidence(getattr(error, "control_browser_diagnostic", None), browser_phase[1])
            except BaseException:
                result["controlBrowserDiagnostic"] = {"format": "asa-realhost-control-browser-v1", "phase": browser_phase[1], "binding": "UNAVAILABLE"}
        if hasattr(error, "post_failure_diagnostic"):
            result["postFailureDiagnostic"] = post_failure_projection(error.post_failure_diagnostic)
        if hasattr(error, "command_failure_diagnostic"):
            result["commandFailureDiagnostic"] = error.command_failure_diagnostic
        if hasattr(error, "fault_evidence"):
            result["faultEvidence"] = error.fault_evidence
            result["ownedCleanupFailed"] = getattr(error, "owned_cleanup_failed", False) is True
        if hasattr(error, "acquisition_evidence"):
            result["publishedSetupAcquisition"] = error.acquisition_evidence
        return_code = 2 if result["status"] == "BLOCKED" else 1
    result["cliActions"] = CLI_ACTIONS
    print(json.dumps(result, sort_keys=True))
    return return_code


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision")
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--acquisition-mode", choices=("candidate", "published"), default="candidate")
    parser.add_argument("--approved-setup-revision", default="")
    parser.add_argument("--check-acquisition-mode", action="store_true")
    parser.add_argument("--guest-phase", choices=("bootstrap", "published-acquire", "install", "seed", "cli-read", "owner-cli-control", "update", "backup", "post-reboot", "schedule",
                        "timer-probe", "timer-retry", "final", "owner-seed", "owner-observe", "owner-final", "owner-schedule-fixture", "owner-hold-lock",
                        "owner-diagnostic-paths", "owner-diagnostic-inventory", "owner-fault-prepare", "owner-fault-remove", "owner-fault-observe",
                        "cloud-fault", "cloud-prepare-empty", "cloud-prepare-dummy", "owner-cloud-baseline", "owner-cloud-best-effort",
                        "owner-cloud-required", "owner-cloud-observe", "owner-cloud-restore",
                        "partial-fault", "interrupt-fault", "network-fault", "network-fault-child"), help=argparse.SUPPRESS)
    parser.add_argument("--control-deadline", type=float, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.guest_phase:
        return guest_main(args.guest_phase, control_deadline=args.control_deadline)
    if not args.revision or not HEX40.fullmatch(args.revision):
        parser.error("--revision must be the exact checked-out source SHA")
    if args.check_acquisition_mode:
        try:
            _, raw = Commands().run(["git", "rev-parse", "HEAD"], cwd=Path(__file__).resolve().parents[2])
            proof = acquisition_request(args.acquisition_mode, args.approved_setup_revision, args.revision, raw.decode().strip(), os.environ)
        except (Failure, ValueError, OSError):
            print(json.dumps({"status": "FAIL", "reasonCode": "ACQUISITION_MODE_BINDING"}))
            return 1
        print(json.dumps({"status": "PASS", **proof}))
        return 0
    return HostRun(args).run()


if __name__ == "__main__":
    raise SystemExit(main())
