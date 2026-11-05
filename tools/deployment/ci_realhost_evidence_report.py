"""Read only the two current-run ASA artifacts and print a closed diagnostic view.

This is an exporter, not an acceptance validator. Producer outcomes remain
reported observations. No product imports, network, subprocesses, guest reads,
raw logs, or caller-selected files are supported. Missing identity cannot bind
a previous retry attempt to the current run.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import PurePosixPath
import re
import stat
import sys

FORMAT = "asa-realhost-evidence-report-v1"
DIRECTORY = "asa-realhost-report"
FILES = {"native": ("evidence.json", 4 * 1024**2),
         "runner": ("runner-preparation.json", 64 * 1024)}
OUTPUT_LIMIT = 128 * 1024
MAX_NODES = 50000
MAX_DEPTH = 32
MAX_INTEGER = 2**63 - 1
SHA40 = re.compile(r"[a-f0-9]{40}\Z")
SHA64 = re.compile(r"[a-f0-9]{64}\Z")
ID32 = re.compile(r"[a-f0-9]{32}\Z")
UUID = re.compile(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\Z")
SNAPSHOT = re.compile(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8,32}\Z")
DIGEST = re.compile(r"sha256:[a-f0-9]{64}\Z")
MISSING = object()
ERRORS = frozenset({
    "REPORT_CONTEXT", "REPORT_PLATFORM", "INPUT_MISSING", "INPUT_PATH",
    "INPUT_PERMISSIONS", "INPUT_TYPE", "INPUT_LINK", "INPUT_SIZE", "INPUT_CHANGED",
    "INPUT_IO", "INPUT_LAYOUT", "JSON_INVALID", "JSON_DUPLICATE", "JSON_LIMIT",
    "SOURCE_BINDING", "ATTEMPT_BINDING", "IDENTITY_MISSING", "FIELD_MISSING",
    "FIELD_TYPE", "FIELD_BOUNDS", "FIELD_ENUM", "FIELD_SET", "CASE_BINDING",
    "RECEIPT_BINDING", "OUTPUT_LIMIT", "REPORT_ERROR",
})
NATIVE_STATES = ("PASS", "FAIL", "BLOCKED", "NOT_RUN", "PENDING")
CLI_STATES = ("OK", "RECORDED", "PLANNED", "UNAVAILABLE", "BLOCKED_PLAN")
PUBLIC_STATES = ("PASS", "FAIL", "BLOCKED", "NOT_RUN", "PENDING", "OK",
    "WARNING", "UNAVAILABLE", "UNVERIFIED", "ACCEPTED", "NO_CHANGE", "FAILED",
    "NOT_CONFIGURED", "BLOCKED_PLAN", "PLANNED", "RECORDED", "CONFIGURED",
    "READY", "INTERRUPTED")
CHECKS = ("cleanUbuntuActual1Panel", "publicCliLifecycle", "publishedRuntimeUpdate",
    "realGuestReboot", "persistentTimer", "publicPartialBackupFailure",
    "publicBackupInterruption", "publicReleaseConnectionFailure",
    "installedCliReadAcceptance", "publicCloudConnectionPolicies")
ACCEPTANCE_FLAGS = ("applicationAccepted", "dataProtectionConfirmed", "actionExecuted",
    "executionCompleted", "technicalCompleted", "browserCompleted", "ownerCompleted",
    "firstBackupCompleted")
FILESYSTEMS = ("application", "backups", "docker", "postgres", "minio")
SERVICES = ("api", "web", "postgres", "minio", "scratch", "search", "migration", "minio-init")
TABLES = ("accounts", "classrooms", "classroom_student_seats", "courses", "projects", "project_drafts")


PHASES = (
    "runner_preflight", "synthetic_cloud_policy_contracts", "verified_materials",
    "qemu_real_guest", "guest_candidate_stage", "official_1panel_bootstrap",
    "published_setup_acquisition", "public_asa_install", "independent_control_fixture",
    "installed_cli_read_acceptance", "published_runtime_update",
    "public_cloud_connection_policies", "public_backup_and_retry",
    "public_release_connection_failure", "public_partial_backup_failure",
    "public_backup_interrupt_recovery", "real_guest_reboot", "real_persistent_timer",
    "final_control_browser",
)

DIAGNOSTIC_REASONS = {"OPERATION_INTENT", "DOCKER_UNKNOWN", "BLOCKED_OWNER", "CONFIG_MISSING", "CONFIG_PERMISSIONS",
    "CONFIG_READ", "CONFIG_SCHEMA", "OWNER_MISMATCH", "OWNER_PRIVATE", "OWNER_WRITABLE", "OPERATOR_REQUIRED",
    "UNATTRIBUTED_ASA", "TARGET_REQUIRED", "PROJECT_DRIFT", "ROOT_DRIFT", "KNOWN_INSTALLATION", "ORPHANED_INSTALLATION",
    "EXISTING_ASA_RESOURCES", "EMPTY_TARGET", "ENV_MISSING", "SHARED_DATA_VOLUME", "DATA_IDENTITY_CHANGED",
    "BIND_BACKEND_UNSUPPORTED", "KNOWN_OPERATION", "UNKNOWN_INTERRUPTION", "ADOPTION_REQUIRED", "EXISTING_STOPPED",
    "CONSISTENT_INSTALLATION", "IDENTITY_UNVERIFIED", "DIAGNOSTIC_TIMEOUT", "DIAGNOSTIC_OUTPUT_LIMIT",
    "DIAGNOSTIC_TRUST", "DIAGNOSTIC_OWNER", "DIAGNOSTIC_JSON", "DIAGNOSTIC_UID", "DIAGNOSTIC_PLATFORM",
    "DIAGNOSTIC_PROCESS_OWNERSHIP", "DIAGNOSTIC_PROCESS_CLEANUP", "UNRECOGNIZED_REASON"}

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

COMMAND_DIAGNOSTIC_OUTCOMES = {"ACCEPTED", "WARNING", "BLOCKED", "ERROR", "INTERRUPTED", "PREPARATION_REQUIRED", "NO_CHANGE"}

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

RUNTIME_REASONS = frozenset({
    "RUNTIME_PLATFORM", "RUNTIME_EXPECTATIONS", "RUNTIME_TIMEOUT", "PROCESS_START",
    "PROCESS_OWNERSHIP", "PROCESS_CLEANUP", "PROCESS_TIMEOUT", "PROCESS_OUTPUT_LIMIT",
    "PROCESS_IO", "CLI_UTF8", "CLI_STDERR", "CLI_JSON", "CLI_SEMANTICS", "CLI_CHECKER",
    "BARE_OUTPUT", "BARE_EXIT", "PTY_PROMPT", "CONTROL_CALLBACK", "CONTROL_TIMEOUT",
    "CONTROL_PROJECTION", "CONTROL_CHANGED", "FILESYSTEM_PATH", "FILESYSTEM_PERMISSIONS",
    "FILESYSTEM_TYPE", "FILESYSTEM_LIMIT", "FILESYSTEM_CHANGED", "FILESYSTEM_MISSING",
    "FILESYSTEM_LAYOUT", "FILESYSTEM_READ", "FILESYSTEM_TIMEOUT", "UNEXPECTED_ERROR",
})

SEMANTIC_REASONS = frozenset({
    "INVALID_CONTEXT", "UNSUPPORTED_COMMAND", "CLI_ENVELOPE", "FIELD_SET", "FIELD_TYPE",
    "FIELD_BOUNDS", "UNRECOGNIZED_REASON", "UNEXPECTED_STATE", "INSTALLATION_IDENTITY",
    "RELEASE_PIN_MISMATCH", "SCHEMA_MISMATCH", "SNAPSHOT_MISMATCH", "OPERATION_MISMATCH",
    "MEASUREMENT_INCONSISTENT", "HELP_CONTRACT",
})

RUNNER_REASONS = frozenset({"BLOCKED_RUNNER_CONTEXT", "BLOCKED_RUNNER_REVISION", "BLOCKED_RUNNER_PATH",
    "BLOCKED_PROTECTED_PATH_ALIAS", "BLOCKED_RUNNER_PLATFORM", "BLOCKED_RUNNER_PRIVILEGE",
    "BLOCKED_MOUNT_IDENTITY", "BLOCKED_CLEANUP_DEADLINE", "BLOCKED_CLEANUP_ENTRY_LIMIT",
    "BLOCKED_SDK_NODE_TYPE", "BLOCKED_SDK_ROOT_TYPE", "BLOCKED_SDK_IDENTITY_CHANGED",
    "BLOCKED_SDK_MOUNT_ALIAS", "BLOCKED_SDK_HARDLINK", "BLOCKED_SDK_ROOT_PERMISSIONS",
    "BLOCKED_HOST_FREE_DISK", "BLOCKED_CLEANUP_IO"})

READ_COMMANDS = (
    "version", "status", "doctor", "disk", "disk usage", "disk health", "services",
    "services status", "update", "update check", "update plan", "update history",
    "backup status", "backup list", "backup verify", "backup schedule", "cloud status",
    "config show", "history", "logs", "logs update", "logs backup", "restore plan",
)

HELP_FORMS = (
    ("help", ("help",), ""), ("help-option", ("--help",), ""),
    ("help-update", ("help", "update"), "update"),
    ("update-help-option", ("update", "--help"), "update"),
    ("backup-help-option", ("backup", "--help"), "backup"),
)

COMMANDS = {
    "version": False, "status": False, "doctor": False, "disk": False,
    "disk usage": False, "disk health": False, "services": False,
    "services status": False, "update": False, "update check": False,
    "update plan": False, "update apply": True, "update history": False,
    "install": True, "backup status": False, "backup list": False,
    "backup create": True, "backup verify": False, "backup schedule": False,
    "backup schedule enable": True, "backup schedule disable": True,
    "cloud status": False, "cloud sync": True, "restore plan": False,
    "history": False, "logs": False, "logs update": False, "logs backup": False,
    "config show": False,
}

# These are source vocabularies, not runtime pins. Unknown private values never
# become output merely because they look like an uppercase code.
EXTRA_REASONS = frozenset({
    "PUBLIC_CLI_FAILED", "PUBLIC_CLI_JSON", "PUBLIC_CLI_RESULT",
    "APPLICATION_ACCEPTANCE", "APPLICATION_ORIGIN", "SETUP_RECEIPT_BINDING",
    "HARNESS_EXCEPTION", "INTERRUPTED", "DEPENDENCIES_NOT_PREPARED",
    "CANDIDATE_NOT_PUBLISHED_ATTESTED", "PUBLISHED_ACQUISITION_NOT_STARTED",
    "PUBLISHED_GUEST_PROOF", "BLOCKED_PUBLISHED_ACQUISITION_BUDGET",
    "BLOCKED_FAULT_HOST_DISK", "BLOCKED_CLOUD_FAULT_ADMISSION",
    "BLOCKED_HOST_FREE_DISK", "BLOCKED_HOST_RAM_CPU", "BLOCKED_DISPOSABLE_RUNNER_REQUIRED",
    "COMMAND", "COMMAND_TIMEOUT",
    "CONTROL_DATA_CHANGED", "CONTROL_BROWSER_BEFORE", "CONTROL_BROWSER_AFTER",
    "PERSISTENT_TIMER_NOT_RECOVERED", "GUEST_DID_NOT_REBOOT", "GUEST_DID_NOT_POWER_OFF",
    "SCHEDULED_OPERATION_NOT_STARTED", "SCHEDULED_OPERATION_NOT_COMPLETE",
    "ONEPANEL_DOCKER_CHANGED", "UPDATE_PREVIOUS_RUNTIME", "UPDATE_RETRY_DUPLICATE",
    "UPDATE_NO_CHANGE", "CLOUD_STATUS_MISREPRESENTED", "BACKUP_COUNT",
    "BACKUP_RETRY_DUPLICATE", "CLOUD_SYNC_REEXPORTED", "FIRST_BACKUP_RECEIPT",
    "DNS", "TLS_NETWORK", "NO_MEASURED_DURATION", "NEW_IMAGE_UNPACKED_BYTES_UNKNOWN",
    "EXACT_PLAN_REQUIRES_VERIFIED_MIGRATION_RUNTIME", "STORAGE_MEASUREMENT_UNAVAILABLE",
    "SPACE_MEASUREMENT_UNAVAILABLE", "SMART_UNAVAILABLE", "NO_PHYSICAL_SENSOR",
    "USE_DISK_HEALTH", "USE_UPDATE_CHECK", "BACKUP_EVIDENCE_MISSING",
    "NO_READ_ONLY_PROVIDER_PROBE", "P1_R3A_REQUIRED", "NOT_RESTORED", "READ_ONLY",
    "UNRECOGNIZED_REASON", "ALREADY_SUFFICIENT", "SPACE_READY",
})
KNOWN_REASONS = (COMMAND_DIAGNOSTIC_REASONS | RECEIPT_BACKUP_ERRORS |
    RECEIPT_BROWSER_REASONS | RUNTIME_REASONS | SEMANTIC_REASONS |
    RUNNER_REASONS | EXTRA_REASONS)
CASE_COMMANDS = {label: command for label, command in (
    *((label, "help") for label, _, _ in HELP_FORMS), ("bare-json", "status"),
    *((command.replace(" ", "-"), command) for command in READ_COMMANDS))}
CASE_ORDER = tuple(CASE_COMMANDS)
FAILED_CASES = frozenset(CASE_COMMANDS) | {
    "control-before", "filesystem-before", "command-trust", "bare-pipe", "bare-pty",
    "filesystem-after", "control-after",
}
ROW_STATES = RECEIPT_ROW_STATUSES | {"UNAVAILABLE", "UNRECOGNIZED"}
VALUE_STATES = {"UNAVAILABLE", "UNRECOGNIZED"}
PUBLIC_COMMANDS = frozenset("asa " + name for name in (*COMMANDS, "help"))
OBSERVATIONS = ("doctor", "disk-health", "cloud-status", "restore-plan",
    "backup-status", "backup-list", "backup-verify", "config-show", "history", "logs")


class ReportError(ValueError):
    def __init__(self, code):
        self.code = code if type(code) is str and code in ERRORS else "REPORT_ERROR"
        super().__init__(self.code)


def need(condition, code):
    if not condition:
        raise ReportError(code)


def obj(value):
    need(type(value) is dict, "FIELD_TYPE")
    return value


def exact(value, required, optional=()):
    obj(value)
    need(set(required) <= value.keys(), "FIELD_MISSING")
    need(value.keys() <= set(required) | set(optional), "FIELD_SET")
    return value


def enum(value, values):
    need(type(value) is str and value in values, "FIELD_ENUM")
    return value


def integer(value, minimum=0, maximum=MAX_INTEGER):
    need(type(value) is int, "FIELD_TYPE")
    need(minimum <= value <= maximum, "FIELD_BOUNDS")
    return value


def number(value, minimum=0, maximum=MAX_INTEGER):
    need(type(value) in (int, float), "FIELD_TYPE")
    need(math.isfinite(value) and minimum <= value <= maximum, "FIELD_BOUNDS")
    return value


def boolean(value):
    need(type(value) is bool, "FIELD_TYPE")
    return value


def patterned(value, pattern):
    need(type(value) is str and pattern.fullmatch(value) is not None, "FIELD_TYPE")
    return value


def array(value, maximum):
    need(type(value) is list, "FIELD_TYPE")
    need(len(value) <= maximum, "FIELD_BOUNDS")
    return value


def nullable(value, parser):
    return None if value is None else parser(value)


def unavailable(code="FIELD_MISSING"):
    return {"availability": "UNAVAILABLE", "reasonCode": code if code in ERRORS else "REPORT_ERROR"}


def section(parser, value=MISSING, *args):
    if value is MISSING:
        return {"availability": "NOT_RECORDED"}
    try:
        return {"availability": "RECORDED", "data": parser(value, *args)}
    except ReportError as error:
        return unavailable(error.code)


def fields(value, schema, *, required=()):
    """The schema's literal keys control output; never copy input dictionaries."""
    obj(value)
    need(set(required) <= value.keys(), "FIELD_MISSING")
    return {key: parser(value[key]) for key, parser in schema.items() if key in value}


def reason(value=MISSING, allowed=KNOWN_REASONS):
    if value is MISSING:
        return {"state": "MISSING"}
    if value is None:
        return {"state": "NULL"}
    if type(value) is not str:
        return {"state": "UNRECOGNIZED", "type": "NON_STRING"}
    if value not in allowed:
        return {"state": "UNRECOGNIZED", "type": "STRING"}
    return {"state": "RECOGNIZED", "code": value}


def projected_reason(value, allowed):
    obj(value)
    state = enum(value.get("state"), ("MISSING", "NULL", "RECOGNIZED", "UNRECOGNIZED"))
    if state in ("MISSING", "NULL"):
        exact(value, ("state",))
        return {"state": state}
    if state == "UNRECOGNIZED":
        exact(value, ("state",), ("type",))
        result = {"state": state}
        if "type" in value:
            result["type"] = enum(value["type"], ("STRING", "NON_STRING", "NON_OBJECT"))
        return result
    exact(value, ("state", "code"), ("httpStatus",))
    code = value["code"]
    if code == "API_STATUS" and "API_STATUS" in allowed:
        exact(value, ("state", "code", "httpStatus"))
        return {"state": state, "code": "API_STATUS", "httpStatus": integer(value["httpStatus"], 100, 599)}
    need("httpStatus" not in value, "FIELD_SET")
    return {"state": state, "code": enum(code, allowed)}


def release(value):
    obj(value)
    if value.get("status") == "NOT_CONFIRMED":
        exact(value, ("status",))
        return {"status": "NOT_CONFIRMED"}
    need("revision" in value and "schema" in value, "FIELD_MISSING")
    return fields(value, {
        "status": lambda v: enum(v, ("RECORDED", "CONFIRMED", "NOT_CONFIRMED")),
        "pin": lambda v: enum(v, ("previous", "current")),
        "revision": lambda v: patterned(v, SHA40),
        "schema": lambda v: integer(v, 1, 99999999),
        "deploymentDigest": lambda v: patterned(v, DIGEST),
        "manifestDigest": lambda v: patterned(v, DIGEST),
        "ci": lambda v: enum(v, ("VERIFIED",)),
    })


def database(value):
    return fields(value, {"status": lambda v: enum(v, ("OK", "UNAVAILABLE")),
        "schema": lambda v: integer(v, 1, 99999999), "bytes": integer}, required=("status",))


def snapshot(value):
    return fields(value, {
        "snapshotId": lambda v: patterned(v, SNAPSHOT), "operationId": lambda v: patterned(v, ID32),
        "bytes": integer, "sha256": lambda v: patterned(v, SHA64),
        "local": lambda v: enum(v, ("OK", "FAILED", "NOT_RUN")),
        "encryption": lambda v: enum(v, ("OK", "FAILED", "NOT_CONFIGURED")),
        "cloud": lambda v: enum(v, ("OK", "FAILED", "NOT_CONFIGURED")),
        "outcome": lambda v: enum(v, COMMAND_DIAGNOSTIC_OUTCOMES),
    }, required=("snapshotId",))


def public_actions(value):
    results = []
    for row in array(value, 128):
        obj(row)
        item = {"command": enum(row.get("command"), PUBLIC_COMMANDS),
                "exitCode": integer(row.get("exitCode"), -128, 255),
                "status": enum(row.get("status"), PUBLIC_STATES)}
        item["reasons"] = [reason(code, COMMAND_DIAGNOSTIC_REASONS) for code in array(row.get("reasonCodes"), 9)]
        if "operationOutcome" in row:
            item["operationOutcome"] = enum(row["operationOutcome"], COMMAND_DIAGNOSTIC_OUTCOMES)
        for key in ("operationId", "installationId"):
            if key in row:
                item[key] = patterned(row[key], ID32)
        results.append(item)
    return results


def receipt_browser(value):
    obj(value)
    binding = enum(value.get("binding"), ("UNAVAILABLE", "VERIFIED_PARENT_OPERATION"))
    if binding == "UNAVAILABLE":
        exact(value, ("binding",))
        return {"binding": binding}
    exact(value, ("binding", "runtimeProvenance", "status", "reason", "checks", "error"))
    checks = exact(value["checks"], RECEIPT_BROWSER_CHECKS)
    error = obj(value["error"])
    if "state" in error:
        exact(error, ("state",))
        error_result = {"state": enum(error["state"], ("MISSING", "NULL", "UNRECOGNIZED"))}
    else:
        exact(error, ("stage", "code"))
        error_result = {"stage": enum(error["stage"], RECEIPT_BROWSER_STAGES | VALUE_STATES),
                        "code": projected_reason(error["code"], RECEIPT_BROWSER_ERRORS | {"API_STATUS"})}
    status = enum(value["status"], {"passed", "failed", "incomplete", "environment_failed"} | VALUE_STATES)
    provenance = enum(value["runtimeProvenance"], ("PINNED_INVOCATION", "NOT_RECORDED"))
    states = [enum(checks[name], {"passed", "failed", "not_run"} | VALUE_STATES) for name in RECEIPT_BROWSER_CHECKS]
    if status in ("passed", "failed"):
        need(provenance == "PINNED_INVOCATION" and all(item in ("passed", "failed") for item in states)
             and ((status == "passed") == all(item == "passed" for item in states)), "RECEIPT_BINDING")
    else:
        need(not any(item in ("passed", "failed") for item in states), "RECEIPT_BINDING")
    return {"binding": binding,
        "runtimeProvenance": provenance, "status": status,
        "reason": projected_reason(value["reason"], RECEIPT_BROWSER_REASONS),
        "checks": {name: enum(checks[name], {"passed", "failed", "not_run"} | VALUE_STATES) for name in RECEIPT_BROWSER_CHECKS},
        "error": error_result}


def receipt_backup(value):
    obj(value)
    binding = enum(value.get("binding"), ("UNAVAILABLE", "VERIFIED_PARENT_OPERATION", "DECLARED_FIRST_BACKUP_CHILD"))
    if binding == "UNAVAILABLE":
        exact(value, ("binding",))
        return {"binding": binding}
    exact(value, ("binding", "policy", "outcome", "local", "encryption", "cloud", "errors"))
    result = {"binding": binding, "policy": enum(value["policy"], {"best-effort", "required"} | VALUE_STATES),
        "outcome": enum(value["outcome"], {"PENDING", "ACCEPTED", "WARNING", "BLOCKED", "ERROR"} | VALUE_STATES)}
    for name, allowed in (("local", {"PENDING", "OK", "FAILED", "NOT_RUN"}),
                          ("encryption", {"PENDING", "NOT_CONFIGURED", "PREPARED", "OK", "FAILED"}),
                          ("cloud", {"PENDING", "NOT_CONFIGURED", "OK", "FAILED"})):
        component = exact(value[name], ("status", "error", "reason"))
        result[name] = {"status": enum(component["status"], allowed | VALUE_STATES),
            "error": projected_reason(component["error"], RECEIPT_BACKUP_ERRORS),
            "reason": projected_reason(component["reason"], RECEIPT_BACKUP_ERRORS)}
    errors = obj(value["errors"])
    state = enum(errors.get("state"), ("OBSERVED", "UNAVAILABLE", "UNRECOGNIZED"))
    if state == "OBSERVED":
        exact(errors, ("state", "codes", "truncated"))
        result["errors"] = {"state": state,
            "codes": [projected_reason(item, RECEIPT_BACKUP_ERRORS) for item in array(errors["codes"], 16)],
            "truncated": boolean(errors["truncated"])}
    else:
        exact(errors, ("state",))
        result["errors"] = {"state": state}
    return result


def receipt_details(value, mode):
    exact(value, ("topReason", "rows", "browser", "backup"))
    rows = exact(value["rows"], RECEIPT_ROWS)
    if obj(value["backup"]).get("binding") == "DECLARED_FIRST_BACKUP_CHILD":
        need(mode == "install", "RECEIPT_BINDING")
    if obj(value["browser"]).get("binding") == "VERIFIED_PARENT_OPERATION":
        need(mode in ("install", "update"), "RECEIPT_BINDING")
    return {"topReason": projected_reason(value["topReason"], COMMAND_DIAGNOSTIC_REASONS),
        "rows": {name: enum(rows[name], ROW_STATES) for name in RECEIPT_ROWS},
        "browser": receipt_browser(value["browser"]), "backup": receipt_backup(value["backup"])}


def command_failure(value, actions):
    obj(value)
    if value.get("binding") != "VERIFIED":
        return {"binding": "UNAVAILABLE", "reason": reason(value.get("reasonCode", MISSING))}
    need(value.get("status") == "OBSERVED" and value.get("observation") == "AFTER_PUBLIC_FAILURE", "RECEIPT_BINDING")
    operation = patterned(value.get("operationId"), ID32)
    installation = patterned(value.get("installationId"), ID32)
    mode = enum(value.get("mode"), ("install", "update", "backup", "retry-cloud"))
    code = integer(value.get("publicExitCode"), -128, 255)
    action = {"install": "asa install", "update": "asa update apply",
              "backup": "asa backup create", "retry-cloud": "asa cloud sync"}[mode]
    need(any(item.get("operationId") == operation and item.get("installationId") == installation
             and item["command"] == action and item["exitCode"] == code
             and ("operationOutcome" not in item or item["operationOutcome"] == value.get("outcome")) for item in actions), "RECEIPT_BINDING")
    stages = obj(value.get("stages"))
    need(stages.keys() <= set(COMMAND_DIAGNOSTIC_STAGES), "FIELD_SET")
    acceptance = obj(value.get("acceptance"))
    result = {"status": "OBSERVED", "binding": "VERIFIED", "operationId": operation, "installationId": installation,
        "mode": mode, "publicExitCode": code, "managerExitCode": integer(value.get("managerExitCode"), -128, 255),
        "journalPhase": enum(value.get("journalPhase"), (*COMMAND_DIAGNOSTIC_STAGES, "UNRECOGNIZED_STAGE")),
        "receiptStage": enum(value.get("receiptStage"), (*COMMAND_DIAGNOSTIC_STAGES, "UNRECOGNIZED_STAGE")),
        "journalState": enum(value.get("journalState"), ("RUNNING", "TERMINAL", "VERIFY_ONLY", "RECOVERY_REQUIRED", "UNVERIFIED")),
        "outcome": enum(value.get("outcome"), COMMAND_DIAGNOSTIC_OUTCOMES | {"UNVERIFIED"}),
        "reason": reason(value.get("reasonCode", MISSING), COMMAND_DIAGNOSTIC_REASONS),
        "stages": {name: enum(stages[name], ("intent", "done", "failed", "UNRECOGNIZED_STATUS"))
                   for name in COMMAND_DIAGNOSTIC_STAGES if name in stages},
        "acceptance": {name: boolean(acceptance[name]) for name in ACCEPTANCE_FLAGS if name in acceptance},
        "unrecognizedStageCount": integer(value.get("unrecognizedStageCount"), 0, 50000),
        "selectedRelease": section(release, value.get("selectedRelease", MISSING)),
        "receiptDetails": section(receipt_details, value.get("receiptDetails", MISSING), mode)}
    return result



def optional_state(value):
    obj(value)
    result = {"status": enum(value.get("status"), PUBLIC_STATES)}
    if "reasonCode" in value:
        result["reason"] = reason(value["reasonCode"])
    return result


def backup_item(value):
    obj(value)
    result = fields(value, {"status": lambda v: enum(v, ("RECORDED",)),
        "snapshotId": lambda v: patterned(v, SNAPSHOT), "ageHours": lambda v: number(v, 0, 876000)},
        required=("status", "snapshotId"))
    for key in ("local", "encryption", "cloud"):
        component = obj(value.get(key))
        result[key] = fields(component, {
            "status": lambda v: enum(v, ("OK", "FAILED", "NOT_CONFIGURED", "UNAVAILABLE")),
            "bytes": lambda v: nullable(v, integer), "present": boolean, "deleted": boolean,
        }, required=("status",))
    return result


def backups(value):
    obj(value)
    result = {"status": enum(value.get("status"), ("RECORDED", "UNAVAILABLE"))}
    for name in ("lastAttempt", "lastLocalSuccess"):
        result[name] = section(backup_item, value.get(name, MISSING))
    result["lastCloudSuccess"] = section(optional_state, value.get("lastCloudSuccess", MISSING))
    if "items" in value:
        result["items"] = [backup_item(item) for item in array(value["items"], 100)]
    if "truncated" in value:
        result["truncated"] = boolean(value["truncated"])
    if "schedule" in value:
        result["schedule"] = section(schedule_summary, value["schedule"])
    return result


def schedule_summary(value):
    return fields(value, {
        "status": lambda v: enum(v, ("OK", "UNAVAILABLE", "NOT_CONFIGURED")),
        "enabled": boolean, "policy": lambda v: enum(v, ("best-effort", "required")),
        "persistent": boolean, "maxAgeHours": lambda v: number(v, 1, 876000),
    }, required=("status",))


def cloud_summary(value):
    obj(value)
    result = fields(value, {
        "status": lambda v: enum(v, ("UNAVAILABLE", "OK", "NOT_CONFIGURED")),
        "configured": boolean, "policy": lambda v: enum(v, ("best-effort", "required")),
    }, required=("status",))
    for name in ("transport", "remote", "lastDelivery"):
        if name in value:
            result[name] = section(optional_state, value[name])
    return result


def disk_health(value):
    obj(value)
    result = {"status": enum(value.get("status"), ("OK", "UNAVAILABLE", "WARNING", "FAILED"))}
    if "reasonCode" in value:
        result["reason"] = reason(value["reasonCode"], {"SMART_UNAVAILABLE", "NO_PHYSICAL_SENSOR"})
    if "devices" in value:
        # Device paths are deliberately absent from the exported summaries.
        result["deviceStatuses"] = [enum(obj(item).get("status"), ("OK", "UNAVAILABLE", "WARNING", "FAILED"))
                                   for item in array(value["devices"], 32)]
    return result


def disk_summary(value):
    obj(value)
    result = {"status": enum(value.get("status"), ("OK", "UNAVAILABLE"))}
    volumes = obj(value.get("filesystems"))
    need(set(FILESYSTEMS) <= volumes.keys(), "FIELD_MISSING")
    result["filesystems"] = {}
    for name in FILESYSTEMS:
        row = obj(volumes[name])
        result["filesystems"][name] = fields(row, {
            "status": lambda v: enum(v, ("OK", "UNAVAILABLE")), "totalBytes": integer,
            "freeBytes": integer, "usedBytes": integer, "freeInodes": integer, "totalInodes": integer,
        }, required=("status", "totalBytes", "freeBytes", "usedBytes", "freeInodes", "totalInodes"))
    result["database"] = section(database, value.get("database", MISSING))
    result["physicalHealth"] = section(optional_state, value.get("physicalHealth", MISSING))
    return result


def services_summary(value):
    obj(value)
    result = {"status": enum(value.get("status"), ("OK", "UNAVAILABLE", "WARNING", "FAILED"))}
    rows, seen = [], set()
    for item in array(value.get("containers"), 8):
        obj(item)
        service = enum(item.get("service"), SERVICES)
        need(service not in seen, "FIELD_SET")
        seen.add(service)
        rows.append({"service": service, "running": boolean(item.get("running")),
                     "health": nullable(item.get("health"), lambda v: enum(v, ("starting", "healthy", "unhealthy")))})
    result["containers"] = rows
    return result


def site_summary(value):
    obj(value)
    result = fields(value, {"status": lambda v: enum(v, ("OK", "UNAVAILABLE")),
        "https": lambda v: enum(v, ("OK", "UNAVAILABLE")), "revision": lambda v: patterned(v, SHA40),
        "reportedSchema": lambda v: integer(v, 1, 99999999)}, required=("status",))
    browser = obj(value.get("browserAcceptance"))
    result["browserAcceptance"] = optional_state(browser)
    if "historical" in browser:
        result["browserAcceptance"]["historical"] = fields(browser["historical"], {
            "status": lambda v: enum(v, ("RECORDED", "UNAVAILABLE")),
            "applicationAccepted": boolean, "operationId": lambda v: patterned(v, ID32),
        }, required=("status",))
    return result


def status_summary(value):
    obj(value)
    return {"installed": section(release, value.get("installed", MISSING)),
        "services": section(services_summary, value.get("services", MISSING)),
        "database": section(database, value.get("database", MISSING)),
        "site": section(site_summary, value.get("site", MISSING)),
        "backup": section(backups, value.get("backup", MISSING)),
        "updates": section(optional_state, value.get("updates", MISSING)),
        "access": enum(value.get("access"), ("OBSERVED",))}


def space_summary(value):
    obj(value)
    status = enum(value.get("status"), ("UNAVAILABLE", "MEASURED_BACKUP_BUDGET"))
    if status == "UNAVAILABLE":
        return {"status": status, "reason": reason(value.get("reasonCode", MISSING),
            {"STORAGE_MEASUREMENT_UNAVAILABLE", "SPACE_MEASUREMENT_UNAVAILABLE"})}
    need(value.get("imageBytes", MISSING) is None, "FIELD_TYPE")
    return fields(value, {
        "status": lambda v: enum(v, ("MEASURED_BACKUP_BUDGET",)),
        "scope": lambda v: enum(v, ("LOCAL_SNAPSHOT_TAR_CIPHERTEXT_READBACK_RESERVE",)),
        "observedSnapshotBytes": integer, "freeBytes": integer, "requiredBytes": integer,
        "freeInodes": integer, "requiredInodes": integer, "snapshotEntries": integer,
        "sufficient": boolean,
    }, required=("status", "scope", "observedSnapshotBytes", "freeBytes", "requiredBytes",
                 "freeInodes", "requiredInodes", "snapshotEntries", "sufficient")) | {"imageBytes": None}


def update_summary(value):
    obj(value)
    need(value.get("requiredSpaceBytes", MISSING) is None
         and value.get("estimatedDowntimeSeconds", MISSING) is None, "FIELD_TYPE")
    migrations = obj(value.get("migrations"))
    need(migrations.get("exactList", MISSING) is None, "FIELD_TYPE")
    return {
        "current": release(value.get("current")), "currentDatabase": database(value.get("currentDatabase")),
        "target": release(value.get("target")), "available": boolean(value.get("available")),
        "migrations": {
            "status": enum(migrations.get("status"), ("SCHEMA_RANGE_ONLY",)),
            "fromSchema": integer(migrations.get("fromSchema"), 1, 99999999),
            "toSchema": integer(migrations.get("toSchema"), 1, 99999999),
            "exactList": None, "reason": reason(migrations.get("reasonCode", MISSING),
                {"EXACT_PLAN_REQUIRES_VERIFIED_MIGRATION_RUNTIME"})},
        "requiredSpaceBytes": None, "estimatedDowntimeSeconds": None,
        "spaceReason": reason(value.get("spaceReasonCode", MISSING), {"NEW_IMAGE_UNPACKED_BYTES_UNKNOWN"}),
        "downtimeReason": reason(value.get("downtimeReasonCode", MISSING), {"NO_MEASURED_DURATION"}),
        "backupSpaceEstimate": section(space_summary, value.get("backupSpaceEstimate", MISSING)),
        "blockers": [reason(item, {"INSTALLED_RELEASE_UNAVAILABLE", "CURRENT_SCHEMA_UNAVAILABLE", "SCHEMA_DOWNGRADE",
            "BACKUP_POLICY_UNAVAILABLE", "REQUIRED_CLOUD_TRANSPORT_UNAVAILABLE", "BACKUP_SPACE"})
            for item in array(value.get("blockers"), 6)],
        "applyRechecksUnderLock": boolean(value.get("applyRechecksUnderLock")),
        "cloud": section(cloud_summary, value.get("cloud", MISSING)),
    }


def help_summary(value):
    obj(value)
    commands = []
    seen = set()
    for row in array(value.get("commands"), len(COMMANDS)):
        obj(row)
        name = enum(row.get("command"), PUBLIC_COMMANDS - {"asa help"})
        need(name not in seen, "FIELD_SET")
        seen.add(name)
        changes = boolean(row.get("changesData"))
        need(changes == COMMANDS[name[4:]], "FIELD_TYPE")
        commands.append({"command": name, "changesData": changes})
    codes = array(value.get("exitCodes"), 4)
    need(all(type(code) is int for code in codes) and codes == [0, 1, 2, 130], "FIELD_TYPE")
    return {"topic": enum(value.get("topic"), ("", "update", "backup")),
        "advertisedCommands": commands, "exitCodes": [0, 1, 2, 130]}


def cli_envelope(value, case):
    obj(value)
    need(value.get("format") == "asa-cli-result-v1" and value.get("command") == case["command"]
         and type(value.get("exitCode")) is int and value["exitCode"] == case["exitCode"]
         and value.get("status") == case["status"], "CASE_BINDING")
    return {"format": "asa-cli-result-v1", "command": case["command"],
            "exitCode": case["exitCode"], "status": case["status"]}


def cli_example(value, case):
    result = cli_envelope(value, case)
    parser = {"help": help_summary, "status": status_summary, "disk": disk_summary,
              "update check": update_summary}[case["command"]]
    result["projection"] = parser(value)
    return result


def cli_observation(value, case):
    result = cli_envelope(value, case)
    command = case["command"]
    if command == "doctor":
        result["diskHealth"] = section(disk_health, value.get("diskHealth", MISSING))
        result["cloud"] = section(cloud_summary, value.get("cloud", MISSING))
        result["optionalUnavailableChecks"] = [enum(item, ("diskHealth", "cloud", "cloud.transport", "cloud.remote"))
            for item in array(value.get("optionalUnavailableChecks"), 6)]
    elif command == "disk health":
        result["physicalHealth"] = disk_health(value)
    elif command == "cloud status":
        result["cloud"] = cloud_summary(value)
    elif command == "restore plan":
        result["reason"] = reason(value.get("reasonCode", MISSING), {"P1_R3A_REQUIRED"})
        result["applyAllowed"] = boolean(value.get("applyAllowed"))
        result["snapshotId"] = nullable(value.get("snapshotId"), lambda v: patterned(v, SNAPSHOT))
        result["restore"] = section(optional_state, value.get("restore", MISSING))
    elif command in ("backup status", "backup list"):
        result["backup"] = backups(value)
    elif command == "backup verify":
        result.update(fields(value, {"snapshotId": lambda v: patterned(v, SNAPSHOT),
            "local": lambda v: enum(v, ("VERIFIED",)), "files": lambda v: integer(v, 1, 10000),
            "bytes": integer, "restore": lambda v: enum(v, ("UNVERIFIED",))},
            required=("snapshotId", "local", "files", "bytes", "restore")))
    elif command == "config show":
        result.update(fields(value, {"configFormat": lambda v: enum(v, ("asa-setup-config-v1",)),
            "backupPolicy": lambda v: enum(v, ("best-effort", "required")), "cloudEnabled": boolean,
            "automaticUpdates": boolean, "secrets": lambda v: enum(v, ("OMITTED",))},
            required=("configFormat", "backupPolicy", "cloudEnabled", "automaticUpdates", "secrets")))
    elif command in ("history", "logs"):
        result.update(fields(value, {"historicalFailures": integer, "operationCount": integer,
            "truncated": boolean}))
    return result


def control_five(value):
    exact(value, ("databaseSha256", "databaseRows", "objectsSha256", "objectCount", "objectBytes"))
    return {key: patterned(value[key], SHA64) if key.endswith("Sha256") else integer(value[key])
            for key in ("databaseSha256", "databaseRows", "objectsSha256", "objectCount", "objectBytes")}


def filesystem_counts(value):
    exact(value, ("files", "directories", "absent", "sha256"))
    return {"files": integer(value["files"], 0, 1024), "directories": integer(value["directories"], 0, 8192),
            "absent": integer(value["absent"], 0, 8192), "sha256": patterned(value["sha256"], SHA64)}


def comparison(value, parser):
    obj(value)
    result = {"status": enum(value.get("status"), ("NOT_RUN", "UNAVAILABLE", "UNCHANGED", "CHANGED"))}
    if result["status"] in ("UNCHANGED", "CHANGED"):
        before, after = parser(value.get("before")), parser(value.get("after"))
        unchanged = boolean(value.get("unchanged"))
        need(unchanged == (result["status"] == "UNCHANGED") and unchanged == (before == after), "FIELD_TYPE")
        result.update(unchanged=unchanged, before=before, after=after)
    elif "reasonCode" in value:
        result["reason"] = reason(value["reasonCode"], RUNTIME_REASONS)
    return result


def bare_summary(value, mode):
    obj(value)
    need(value.get("mode") == mode, "CASE_BINDING")
    return fields(value, {"status": lambda v: enum(v, ("OK",)), "exitCode": lambda v: integer(v, 0, 0),
        "mode": lambda v: enum(v, (mode,)), "stdin": lambda v: enum(v, ("ENTER_AFTER_PROMPT",) if mode == "PTY" else ("CLOSED",)),
        "menuObserved": boolean, "revision": lambda v: patterned(v, SHA40), "schema": lambda v: integer(v, 1, 99999999),
        "healthyServices": lambda v: integer(v, 0, 8), "containers": lambda v: integer(v, 0, 8),
        "compactLines": lambda v: integer(v, 1, 16)},
        required=("status", "exitCode", "mode", "stdin", "menuObserved", "revision", "schema", "healthyServices", "containers", "compactLines"))


def cli_read(value, revision):
    obj(value)
    binding = obj(value.get("cliReadBinding"))
    need(binding.get("status") == "VERIFIED" and binding.get("sourceRevision") == revision, "SOURCE_BINDING")
    evidence = obj(value.get("cliReadEvidence"))
    need(evidence.get("format") == "asa-realhost-cli-runtime-v1", "FIELD_TYPE")
    cases, indexed = [], {}
    for index, row in enumerate(array(evidence.get("cases"), len(CASE_ORDER))):
        exact(row, ("case", "command", "status", "exitCode"))
        label = enum(row["case"], CASE_COMMANDS)
        need(label == CASE_ORDER[index] and row["command"] == CASE_COMMANDS[label], "CASE_BINDING")
        status = enum(row["status"], CLI_STATES)
        code = integer(row["exitCode"], 0, 2)
        need(code == (2 if status == "BLOCKED_PLAN" else 1 if status == "UNAVAILABLE" else 0), "CASE_BINDING")
        item = {"case": label, "command": row["command"], "status": status, "exitCode": code}
        cases.append(item)
        indexed[label] = item
    output = {"status": enum(evidence.get("status"), ("PASS", "FAIL")),
        "binding": {"status": "VERIFIED", "sourceRevision": revision},
        "cases": cases, "recordedJsonCases": len(cases),
        "notRecordedCases": [label for label in CASE_ORDER if label not in indexed],
        "examples": {}, "observations": {}, "bare": {},
        "filesystem": section(lambda v: comparison(v, filesystem_counts), evidence.get("filesystem", MISSING)),
        "control": section(lambda v: comparison(v, control_five), evidence.get("control", MISSING))}
    for key in ("reasonCode", "semanticCode"):
        if key in evidence:
            output[key] = reason(evidence[key], RUNTIME_REASONS if key == "reasonCode" else SEMANTIC_REASONS)
    if "failedCase" in evidence:
        output["failedCase"] = enum(evidence["failedCase"], FAILED_CASES)
    examples = obj(evidence.get("examples"))
    for name in ("help", "status", "disk", "update-check"):
        output["examples"][name] = (section(cli_example, examples.get(name, MISSING), indexed[name])
            if name in indexed else {"availability": "NOT_RECORDED"})
    observations = obj(evidence.get("observations"))
    for name in OBSERVATIONS:
        output["observations"][name] = (section(cli_observation, observations.get(name, MISSING), indexed[name])
            if name in indexed else {"availability": "NOT_RECORDED"})
    bare = obj(evidence.get("bare"))
    for name, mode in (("pipe", "PIPE"), ("pty", "PTY")):
        output["bare"][name] = section(bare_summary, bare.get(name, MISSING), mode)
    output["recordedBareModes"] = sum(output["bare"][name]["availability"] == "RECORDED" for name in ("pipe", "pty"))
    if "publicProcessCases" in value:
        output["declaredPublicProcessCases"] = integer(value["publicProcessCases"], 0, 31)
    return output



def process_summary(value):
    return fields(value, {"observedProcessCount": lambda v: integer(v, 0, 100000),
        "processIdentitiesSha256": lambda v: patterned(v, SHA64), "identityListTruncated": boolean,
        "allOwnedProcessesExited": boolean}, required=("allOwnedProcessesExited",))


def partial_snapshot(value):
    return fields(value, {
        "operationId": lambda v: patterned(v, ID32), "snapshotId": lambda v: patterned(v, SNAPSHOT),
        **{key: integer for key in ("files", "bytes", "databaseBytes", "globalsBytes", "objectBytes",
            "largestObjectFileBytes", "syntheticPartBytes")},
        "treeSha256": lambda v: patterned(v, SHA64),
        **{key: boolean for key in ("objectsDirectory", "manifestPresent", "finalPresent", "ciphertextPresent",
            "stableAfterQuiescence", "operationLockReleased")},
    }, required=("operationId", "snapshotId"))


def fault_receipt(value):
    obj(value)
    allowed = ("PENDING", "RUNNING", "UNKNOWN", "FAILED", "BLOCKED", "ERROR",
               "INTERRUPTED", "RECOVERY_REQUIRED", "TERMINAL", "NOT_RUN", "UNVERIFIED")
    result = fields(value, {key: lambda v: enum(v, allowed) for key in
        ("journalState", "outcome", "localStatus", "localExecutionStatus")})
    if "localReasonCode" in value:
        result["localReason"] = reason(value["localReasonCode"], {"COMMAND", "COMMAND_TIMEOUT", "BACKUP_RESUME_SNAPSHOT_MISSING",
            "BACKUP_INCOMPLETE", "OSError", "FileNotFoundError"})
    return result


def recovery_summary(value):
    obj(value)
    result = fields(value, {
        "publicExitCode": lambda v: integer(v, -128, 255),
        **{key: boolean for key in ("sameSnapshotAndPartialBytes", "holdRemainedBeforeSameIdCommand",
            "allOwnedProcessesExited", "exactOriginalWritersRestored", "lastLocalSuccessPreserved")},
    }, required=("publicExitCode",))
    result["receipt"] = section(fault_receipt, value.get("receipt", MISSING))
    result["control"] = section(control_observation, value.get("control", MISSING))
    return result


def backup_fault(value):
    obj(value)
    result = fields(value, {
        "injection": lambda v: enum(v, ("PER_CHILD_RLIMIT_FSIZE", "OWNED_PUBLIC_PROCESS_GROUP_SIGINT")),
        "realYandexFault": lambda v: enum(v, ("NOT_RUN",)),
        "operationId": lambda v: patterned(v, ID32), "publicExitCode": lambda v: integer(v, -128, 255),
        **{key: boolean for key in ("observedObjectFileLimitReached", "newOperationDistinct",
            "lastLocalSuccessAdvanced", "bothIncompleteSnapshotsPreserved")},
    }, required=("injection",))
    if "baseline" in value:
        result["baseline"] = fields(value["baseline"], {
            "lastLocalSuccessSha256": lambda v: patterned(v, SHA64),
            "authenticatedReadbackSha256": lambda v: patterned(v, SHA64),
            **{key: integer for key in ("completeSnapshots", "databaseBytes", "globalsBytes", "sourceMinioPartBytes",
                "fileSizeLimitBytes", "guestFreeBytesBeforeFixture", "authenticatedObjectBytes")},
        })
    if "observedInjection" in value:
        result["observedInjection"] = fields(value["observedInjection"], {
            "signal": lambda v: enum(v, ("SIGINT",)),
            "window": lambda v: enum(v, ("AFTER_DUMPS_BEFORE_OBJECTS_COMPLETE",)),
            **{key: boolean for key in ("precededByOwnedSIGSTOP", "actualDockerCopyObserved", "interruptedDuringCopy")},
            **{key: integer for key in ("objectBytesAtSignal", "databaseBytesAtSignal", "globalsBytesAtSignal")},
            "stoppedMilliseconds": lambda v: number(v, 0, 1800000),
        })
    for key in ("processes", "newBackupProcesses"):
        if key in value:
            result[key] = section(process_summary, value[key])
    for key in ("receipt", "receiptAfterQuiescence"):
        if key in value:
            result[key] = section(fault_receipt, value[key])
    if "partial" in value:
        result["partial"] = section(partial_snapshot, value["partial"])
    if "sameIdRecovery" in value:
        result["sameIdRecovery"] = section(recovery_summary, value["sameIdRecovery"])
    if "newSuccessfulBackup" in value:
        result["newSuccessfulBackup"] = section(snapshot, value["newSuccessfulBackup"])
    return result


def network_fault(value):
    obj(value)
    connection = obj(value.get("connectionFailure"))
    return {"connectionFailure": {
        "separateNetworkNamespace": boolean(connection.get("separateNetworkNamespace")),
        "publicCommand": enum(connection.get("publicCommand"), ("asa update check",)),
        "publicExitCode": integer(connection.get("publicExitCode"), -128, 255),
        "reason": reason(connection.get("reasonCode", MISSING), {"RELEASE_UNAVAILABLE"}),
        "scope": enum(connection.get("scope"), ("PUBLIC_RELEASE_LOOKUP",)),
        "realYandexFault": enum(connection.get("realYandexFault"), ("NOT_RUN",))},
        "parentNamespaceUnchanged": boolean(value.get("parentNamespaceUnchanged")),
        "controlPreserved": boolean(value.get("controlPreserved"))}


def virtualization(value):
    obj(value)
    kvm = exact(value.get("queryKvm"), ("enabled", "present"))
    return {"requested": enum(value.get("requested"), ("kvm", "tcg")),
        "queryKvm": {"enabled": boolean(kvm["enabled"]), "present": boolean(kvm["present"])},
        "cpus": integer(value.get("cpus"), 1, 65536), "memoryMiB": integer(value.get("memoryMiB"), 1, 2**31)}



def control_fingerprint(value):
    obj(value)
    rows = obj(value.get("rows"))
    need(rows.keys() <= set(TABLES), "FIELD_SET")
    result = {"rows": {name: fields(rows[name], {"rows": integer, "sha256": lambda v: patterned(v, SHA64)},
        required=("rows", "sha256")) for name in TABLES if name in rows}}
    for key in ("rolesSha256", "aclRlsSha256", "privateEnvironmentSha256", "storageIdentitySha256", "authenticatedS3Sha256"):
        result[key] = patterned(value.get(key), SHA64)
    return result


def browser_checks(value):
    obj(value)
    checks = exact(value.get("checks"), RECEIPT_BROWSER_CHECKS)
    # The old producer copied component pin strings without checking their
    # shape. Omit them: this reporter does not independently verify runtime pins.
    return {"status": enum(value.get("status"), ("PASS", "FAIL")),
            "checks": {name: boolean(checks[name]) for name in RECEIPT_BROWSER_CHECKS}}


def control_observation(value):
    obj(value)
    result = fields(value, {"preserved": boolean, "independentCohort": boolean,
        "runtimeRevision": lambda v: patterned(v, SHA40), "schema": lambda v: integer(v, 1, 99999999)})
    for key in ("fingerprint", "controlFingerprint"):
        if key in value:
            result[key] = section(control_fingerprint, value[key])
    if "browser" in value:
        result["browser"] = section(browser_checks, value["browser"])
    return result


def public_observation(value):
    return fields(value, {"revision": lambda v: patterned(v, SHA40), "schema": lambda v: integer(v, 1, 99999999),
        "status": lambda v: enum(v, ("OK",)), "services": lambda v: enum(v, ("OK",))},
        required=("revision", "schema", "status", "services"))


def lifecycle_receipt(value):
    obj(value)
    result = fields(value, {"operationId": lambda v: patterned(v, ID32), "installationId": lambda v: patterned(v, ID32),
        "outcome": lambda v: enum(v, COMMAND_DIAGNOSTIC_OUTCOMES),
        "mode": lambda v: enum(v, ("install", "update", "backup", "retry-cloud")),
        "applicationAccepted": boolean, "dataProtectionConfirmed": boolean,
        "technicalStatus": boolean, "browserStatus": boolean},
        required=("operationId", "installationId", "applicationAccepted", "dataProtectionConfirmed",
                  "technicalStatus", "browserStatus"))
    if "reasonCode" in value:
        result["reason"] = reason(value["reasonCode"], COMMAND_DIAGNOSTIC_REASONS)
    return result


def systemd_observation(value):
    return fields(value, {"result": lambda v: enum(v, ("success", "exit-code", "start-limit-hit",
        "exec-condition", "timeout", "signal", "unknown")), "autoRestartPending": boolean,
        "active": boolean, "completed": boolean, "execMainStatus": lambda v: integer(v, 0, 255),
        "nRestarts": integer, "startLimitBurst": integer}, required=("result",))


def cloud_snapshot(value):
    return fields(value, {"snapshotId": lambda v: patterned(v, SNAPSHOT), "sourceOperationId": lambda v: patterned(v, ID32),
        "manifestSha256": lambda v: patterned(v, SHA64), "ciphertextSha256": lambda v: patterned(v, SHA64),
        "ciphertextBytes": integer}, required=("snapshotId",))


def cloud_case(value):
    obj(value)
    output = fields(value, {"status": lambda v: enum(v, NATIVE_STATES),
        "operationId": lambda v: patterned(v, ID32), "observedPublicExitCode": lambda v: integer(v, -128, 255),
        "completeSnapshotsBefore": integer, "completeSnapshotsAfter": integer,
        "completeSnapshotsDelta": lambda v: integer(v, -1024, 1024), "noExportOnSync": boolean}, required=("status",))
    if "snapshot" in value:
        output["snapshot"] = section(cloud_snapshot, value["snapshot"])
    if "result" in value:
        raw = obj(value["result"])
        result = fields(raw, {
            "publicStatus": lambda v: enum(v, PUBLIC_STATES),
            "publicExitCode": lambda v: integer(v, -128, 255),
            "setupOutcome": lambda v: enum(v, COMMAND_DIAGNOSTIC_OUTCOMES | {"UNVERIFIED"}),
            "receiptOutcome": lambda v: enum(v, COMMAND_DIAGNOSTIC_OUTCOMES | {"UNVERIFIED"}),
            "journalState": lambda v: enum(v, ("RUNNING", "TERMINAL", "VERIFY_ONLY", "RECOVERY_REQUIRED", "UNVERIFIED")),
            "dataProtectionConfirmed": lambda v: nullable(v, boolean),
            "receiptProtectionConfirmed": lambda v: nullable(v, boolean),
            "local": lambda v: enum(v, ("OK", "FAILED", "NOT_RUN", "UNVERIFIED")),
            "encryption": lambda v: enum(v, ("OK", "FAILED", "NOT_CONFIGURED", "UNVERIFIED")),
            "cloud": lambda v: enum(v, ("OK", "FAILED", "NOT_CONFIGURED", "UNVERIFIED")),
        })
        for name, pattern in (("operationId", ID32), ("installationId", ID32),
                              ("sourceOperationId", ID32), ("snapshotId", SNAPSHOT)):
            if name in raw:
                result[name] = nullable(raw[name], lambda v, pattern=pattern: patterned(v, pattern))
        if "cloudReasonCode" in raw:
            result["cloudReason"] = reason(raw["cloudReasonCode"], RECEIPT_BACKUP_ERRORS | {"UNRECOGNIZED_REASON"})
        output["result"] = result
    if "transport" in value:
        output["transport"] = fields(value["transport"], {
            "status": lambda v: enum(v, ("OBSERVED", "UNAVAILABLE")),
            "command": lambda v: enum(v, ("PINNED_RCLONE_MKDIR",)),
            "exitCode": lambda v: integer(v, -128, 255),
            "completeCreateStartDie": boolean, "naturalCompletion": boolean, "healthExecutions": integer,
            "classification": lambda v: enum(v, ("TRANSPORT_FAILURE_UNDER_PROVEN_NO_EGRESS",)),
            "specificErrno": lambda v: enum(v, ("UNAVAILABLE",)),
        }, required=("status",))
    return output


def cloud_fault(value):
    obj(value)
    result = fields(value, {
        "status": lambda v: enum(v, NATIVE_STATES),
        "credentialKind": lambda v: enum(v, ("DUMMY_ONLY",)),
        "realProviderAuthentication": lambda v: enum(v, ("NOT_RUN",)),
        "realYandexUploadReadback": lambda v: enum(v, ("NOT_RUN",)),
        "specificProviderError": lambda v: enum(v, ("UNAVAILABLE",)),
        "phaseBudgetSeconds": lambda v: number(v, 0, 10500),
        "cleanupReserveSeconds": lambda v: number(v, 0, 10500),
    })
    if "sourceSnapshot" in value:
        result["sourceSnapshot"] = section(cloud_snapshot, value["sourceSnapshot"])
    if "cases" in value:
        cases = obj(value["cases"])
        result["cases"] = {policy: section(cloud_case, cases.get(policy, MISSING)) for policy in ("best-effort", "required")}
    if "isolatedNetwork" in value:
        result["isolatedNetwork"] = fields(value["isolatedNetwork"], {
            "differentFromGuest": boolean, "loopbackOnly": boolean, "externalIPv4Routes": integer, "externalIPv6Routes": integer})
    if "cleanup" in value:
        result["cleanup"] = fields(value["cleanup"], {
            "status": lambda v: enum(v, NATIVE_STATES),
            **{name: boolean for name in ("hostProcessesQuiescent", "containerExecsQuiescent",
                "containerDummyRemoved", "sourceDummyRemoved", "exactConfigurationBytesOwnerModeRestored",
                "controlDataPreserved", "ownedContainerRemoved", "ownedNetworkRemoved",
                "appNetworksAndDaemonPreserved", "egressRestored")},
        }, required=("status",))
    return result


def published_acquisition(value, revision):
    obj(value)
    result = {"status": enum(value.get("status"), NATIVE_STATES)}
    if "sourceRevision" in value:
        need(value["sourceRevision"] == revision, "SOURCE_BINDING")
        result["sourceRevision"] = revision
    if "reasonCode" in value:
        result["reason"] = reason(value["reasonCode"])
    result.update(fields(value, {name: boolean for name in
        ("manualCandidateStage", "beforeInstall", "allOwnedProcessesExited")}))
    if "steps" in value:
        steps = obj(value["steps"])
        names = ("gh-version", "gh-flags", "sudo-access", "helper-download", "helper-attestation",
                 "helper-execution", "independent-package-verification", "public-help")
        need(steps.keys() <= set(names), "FIELD_SET")
        result["steps"] = {name: enum(steps[name], ("PASS", "FAIL", "PENDING", "BLOCKED")) for name in names if name in steps}
    for key in ("helper", "archive", "publicHelp"):
        if key in value:
            result[key] = fields(value[key], {
                "sha256": lambda v: patterned(v, SHA64), "bytes": integer, "files": integer,
                "attestationVerified": boolean, "protectedSnapshot": boolean,
                "sourceOracleFilesMatch": boolean, "protectedHelperSnapshotObserved": boolean,
                "status": lambda v: enum(v, ("OK",)), "exitCode": lambda v: integer(v, 0, 0),
                "utf8": boolean, "noColor": boolean,
            })
    return result


def proof_fields(value):
    """Small facts common to lifecycle proofs; no generic scalar forwarding."""
    return fields(value, {name: boolean for name in (
        "defaultOperatorCreatedByPublicInstall", "externalPrivateOnboardingFixture", "sameInstallationIdRetried",
        "actualInstalledBytesVerified", "systemdPid1", "ntpSynchronized",
        "onePanelAndDockerPreserved", "schemaMigrationExercised", "sameOperationRetry", "noChangeWithoutNewBackup",
        "cloudSyncKeptCiphertext", "sameQemuProcess", "sameVirtualDisk", "clockChanged",
        "fixtureOnlyTimeSelection", "publicCliTimeSetterClaimed", "automaticUpdatesUnchanged",
        "persistentTimerRecoveredMissedSlot", "fourthStartRefusedOrSkipped", "publicDisableCompleted",
    )} | {
        "firstBootstrapBlock": lambda v: enum(v, ("OWNER_INPUT_REQUIRED",)),
        "cloudDelivery": lambda v: enum(v, ("NOT_CONFIGURED",)),
        "realProviderConnectionFailure": lambda v: enum(v, ("NOT_RUN",)),
        "followingPositiveBackup": lambda v: enum(v, ("REQUIRED_NEXT_PHASE",)),
        "beforeBootId": lambda v: patterned(v, UUID), "afterBootId": lambda v: patterned(v, UUID),
        "dueEpoch": integer, "poweredOffAtEpoch": number, "scheduledAttemptsBeforePoweroff": integer,
        "enableDisableEnable": lambda v: enum(v, ("PASS",)),
        "attemptsInDailySlot": lambda v: integer(v, 0, 3), "restartSecUnchanged": lambda v: integer(v, 0, 86400),
        "fourthStartExitCode": lambda v: integer(v, -128, 255),
        "budgetResult": lambda v: enum(v, ("start-limit-hit", "exec-condition")),
    })


def lifecycle_proof(value):
    obj(value)
    result = proof_fields(value)
    if "cliActions" in value:
        result["cliActions"] = section(public_actions, value["cliActions"])
    for name in ("from", "to", "runtime"):
        if name in value:
            result[name] = section(release, value[name])
    if "receipt" in value:
        result["receipt"] = section(lifecycle_receipt, value["receipt"])
    for name in ("firstBackup", "backup", "sameSnapshot"):
        if name in value:
            result[name] = section(snapshot, value[name])
    if "control" in value:
        result["control"] = section(control_observation, value["control"])
    if "publicObservation" in value:
        result["publicObservation"] = section(public_observation, value["publicObservation"])
    for name in ("systemd", "automaticRetry"):
        if name in value:
            result[name] = section(systemd_observation, value[name])
    if "unitProperties" in value:
        result["unitProperties"] = fields(value["unitProperties"], {
            "active": boolean, "enabled": boolean, "persistent": boolean,
            "timerSha256": lambda v: patterned(v, SHA64), "serviceSha256": lambda v: patterned(v, SHA64)})
    if "realFailure" in value:
        result["realFailure"] = section(systemd_observation, obj(value["realFailure"]).get("failed", MISSING))
    return result


def phase_projection(value, revision):
    obj(value)
    name = enum(value.get("name"), PHASES)
    output = {"name": name, "status": enum(value.get("status"), NATIVE_STATES)}
    if "reasonCode" in value:
        output["reason"] = reason(value["reasonCode"])
    if "evidence" not in value:
        output["details"] = {"availability": "NOT_RECORDED"}
        return output
    payload = obj(value["evidence"])
    output["details"] = section(lifecycle_proof, payload)
    if "commandFailureDiagnostic" in payload:
        actions = public_actions(payload.get("cliActions", []))
        output["commandFailureDiagnostic"] = section(command_failure, payload["commandFailureDiagnostic"], actions)
    if name == "installed_cli_read_acceptance":
        output["cliRead"] = section(cli_read, payload, revision)
    if name == "published_setup_acquisition":
        output["publishedSetupAcquisition"] = section(published_acquisition, payload.get("publishedSetupAcquisition", MISSING), revision)
    if name == "public_cloud_connection_policies":
        for key in ("cloudFault", "faultEvidence"):
            if key in payload:
                output[key] = section(cloud_fault, payload[key])
        if "ownedCleanupFailed" in payload:
            output["ownedCleanupFailed"] = boolean(payload["ownedCleanupFailed"])
    if name in ("public_partial_backup_failure", "public_backup_interrupt_recovery"):
        output["backupFault"] = section(backup_fault, payload.get("faultEvidence", payload))
    if name == "public_release_connection_failure":
        output["connectionFailure"] = section(network_fault, payload)
    if name == "real_guest_reboot":
        output["observation"] = section(lifecycle_proof, payload.get("observation", MISSING))
    if name == "real_persistent_timer":
        for key in ("fixtureSchedulePreparation", "persistentRecovery", "boundedRetry"):
            output[key] = section(lifecycle_proof, payload.get(key, MISSING))
    return output


def native_projection(value, revision):
    obj(value)
    need(value.get("format") == "asa-realhost-evidence-v1" and value.get("sourceRevision") == revision, "SOURCE_BINDING")
    result = {"sourceStatus": enum(value.get("status"), NATIVE_STATES), "sourceRevision": revision,
        "reason": reason(value.get("reasonCode", MISSING)),
        "acquisitionMode": enum(value.get("acquisitionMode"), ("candidate", "published")),
        "cleanup": enum(value.get("cleanup"), ("PASS", "FAIL", "NOT_RUN", "PENDING", "UNAVAILABLE")),
        "checks": {}, "phases": []}
    for key in ("publicHTTPS", "realYandexFromGuest", "productionRestore"):
        result[key] = enum(value.get(key), ("NOT_RUN",))
    result["publishedSetupAcquisition"] = section(published_acquisition, value.get("publishedSetupAcquisition", MISSING), revision)
    result["resources"] = section(lambda v: fields(v, {key: integer for key in (
        "initialFreeBytes", "minimumObservedFreeBytes", "requiredFreeBytes", "reserveBytes",
        "hostMemoryBytes", "hostCpus", "guestVirtualDiskGiB")}), value.get("resources", MISSING))
    result["virtualization"] = section(virtualization, value.get("virtualization", MISSING))
    checks = obj(value.get("checks"))
    need(checks.keys() <= set(CHECKS), "FIELD_SET")
    for name in CHECKS:
        result["checks"][name] = ({"availability": "RECORDED", "status": enum(checks[name], NATIVE_STATES)}
            if name in checks else {"availability": "NOT_RECORDED"})
    phases = array(value.get("phases"), len(PHASES))
    seen, order = set(), -1
    for row in phases:
        obj(row)
        name = enum(row.get("name"), PHASES)
        need(name not in seen and PHASES.index(name) > order, "FIELD_SET")
        seen.add(name)
        order = PHASES.index(name)
        result["phases"].append(section(phase_projection, row, revision))
    result["notRecordedPhases"] = [name for name in PHASES if name not in seen]
    return result


def runner_projection(value):
    obj(value)
    result = {"status": enum(value.get("status"), ("PASS", "BLOCKED")),
        "reason": reason(value.get("reasonCode", MISSING), RUNNER_REASONS | {"ALREADY_SUFFICIENT", "SPACE_READY"})}
    for key in ("requiredFreeBytes", "reserveBytes", "cleanupDeadlineSeconds"):
        result[key] = integer(value.get(key))
    for key in ("beforeFreeBytes", "afterFreeBytes"):
        result[key] = nullable(value.get(key), integer)
    result["elapsedSeconds"] = number(value.get("elapsedSeconds"), 0, 3600)
    targets = exact(value.get("targets"), ("android", "dotnet"))
    result["targets"] = {}
    for name in ("android", "dotnet"):
        result["targets"][name] = fields(targets[name], {
            "status": lambda v: enum(v, ("NOT_ATTEMPTED", "NOT_NEEDED", "ABSENT", "AUDITING", "REMOVING", "REMOVED", "PARTIAL", "BLOCKED")),
            "auditedEntries": integer, "auditedAllocatedBytes": integer, "symlinkEntries": integer, "removedEntries": integer,
        }, required=("status",))
    return result



def metadata(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
            info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def file_metadata(info, maximum):
    need(stat.S_ISREG(info.st_mode), "INPUT_TYPE")
    need(info.st_nlink == 1, "INPUT_LINK")
    # download-artifact normalizes files to 0644. Do not require live-private 0600.
    need(info.st_uid == os.geteuid() and not info.st_mode & 0o022, "INPUT_PERMISSIONS")
    need(0 < info.st_size <= maximum, "INPUT_SIZE")


def open_directory(path):
    need(sys.platform.startswith("linux") and hasattr(os, "O_NOFOLLOW"), "REPORT_PLATFORM")
    need(type(path) is str and 1 < len(path) <= 4096 and path.startswith("/")
         and PurePosixPath(path).anchor == "/" and str(PurePosixPath(path)) == path
         and ".." not in path.split("/") and not any(ord(char) < 32 for char in path), "INPUT_PATH")
    descriptor = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        for index, part in enumerate(PurePosixPath(path).parts[1:]):
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
            info = os.fstat(descriptor)
            need(stat.S_ISDIR(info.st_mode) and info.st_uid in (0, os.geteuid()), "INPUT_PERMISSIONS")
            # A root-owned sticky temporary ancestor may contain a private
            # runner directory. The final input directory must never be writable
            # by another principal; every component is pinned without symlinks.
            sticky_ancestor = index < len(PurePosixPath(path).parts) - 2 and info.st_uid == 0 and info.st_mode & stat.S_ISVTX
            need(not info.st_mode & 0o022 or sticky_ancestor, "INPUT_PERMISSIONS")
        info = os.fstat(descriptor)
        need(info.st_uid == os.geteuid() and not info.st_mode & 0o022, "INPUT_PERMISSIONS")
        answer, descriptor = descriptor, None
        return answer
    finally:
        if descriptor is not None:
            os.close(descriptor)


def read_file(directory, name, maximum):
    descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=directory)
    try:
        before = os.fstat(descriptor)
        file_metadata(before, maximum)
        chunks, remaining = [], before.st_size
        while remaining:
            block = os.read(descriptor, min(65536, remaining))
            need(block, "INPUT_CHANGED")
            chunks.append(block)
            remaining -= len(block)
        need(os.read(descriptor, 1) == b"", "INPUT_CHANGED")
        need(metadata(before) == metadata(os.fstat(descriptor)), "INPUT_CHANGED")
        raw = b"".join(chunks)
        return raw, {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    finally:
        os.close(descriptor)


def strict_json(raw, maximum):
    need(type(raw) is bytes and 0 < len(raw) <= maximum, "INPUT_SIZE")

    def pairs(items):
        result = {}
        for key, value in items:
            need(key not in result, "JSON_DUPLICATE")
            result[key] = value
        return result

    def invalid_constant(_):
        raise ReportError("JSON_INVALID")

    try:
        result = json.loads(raw.decode("utf-8"), object_pairs_hook=pairs, parse_constant=invalid_constant)
    except ReportError:
        raise
    except (ValueError, UnicodeError, RecursionError, OverflowError):
        raise ReportError("JSON_INVALID") from None
    need(type(result) is dict, "JSON_INVALID")
    pending, nodes = [(result, 0)], 0
    while pending:
        value, depth = pending.pop()
        nodes += 1
        need(depth <= MAX_DEPTH and nodes <= MAX_NODES, "JSON_LIMIT")
        if type(value) is dict:
            need(len(value) <= MAX_NODES, "JSON_LIMIT")
            nodes += len(value)  # Keys also consume the input budget.
            pending.extend((child, depth + 1) for child in value.values())
        elif type(value) is list:
            need(len(value) <= MAX_NODES, "JSON_LIMIT")
            pending.extend((child, depth + 1) for child in value)
        elif type(value) is float:
            need(math.isfinite(value), "JSON_INVALID")
    need(nodes <= MAX_NODES, "JSON_LIMIT")
    return result


def read_artifacts(path):
    documents, observations, descriptor = {}, {}, None
    try:
        descriptor = open_directory(path)
        before = metadata(os.fstat(descriptor))
        names = set()
        with os.scandir(descriptor) as iterator:
            for entry in iterator:
                need(len(names) < 2 and entry.name in {item[0] for item in FILES.values()}, "INPUT_LAYOUT")
                names.add(entry.name)
        for key, (name, maximum) in FILES.items():
            try:
                raw, counts = read_file(descriptor, name, maximum)
                documents[key] = strict_json(raw, maximum)
                observations[key] = {"availability": "RECORDED", **counts}
            except FileNotFoundError:
                observations[key] = unavailable("INPUT_MISSING")
            except ReportError as error:
                observations[key] = unavailable(error.code)
            except OSError:
                observations[key] = unavailable("INPUT_IO")
        need(before == metadata(os.fstat(descriptor)), "INPUT_CHANGED")
        return documents, observations
    except FileNotFoundError:
        return {}, {key: unavailable("INPUT_MISSING") for key in FILES}
    except ReportError as error:
        return {}, {key: unavailable(error.code) for key in FILES}
    except OSError:
        return {}, {key: unavailable("INPUT_IO") for key in FILES}
    finally:
        if descriptor is not None:
            os.close(descriptor)


def bind_runner(value, revision, run_id, run_attempt):
    need(value is not MISSING, "IDENTITY_MISSING")
    obj(value)
    need(value.get("format") == "asa-realhost-runner-preparation-v1", "SOURCE_BINDING")
    keys = ("runnerVerified", "sourceRevision", "runId", "runAttempt")
    need(all(key in value for key in keys), "IDENTITY_MISSING")
    need(value["runnerVerified"] is True and value["sourceRevision"] == revision, "SOURCE_BINDING")
    need(type(value["runId"]) is int and type(value["runAttempt"]) is int
         and value["runId"] == run_id and value["runAttempt"] == run_attempt, "ATTEMPT_BINDING")


def has_unavailable(value):
    if type(value) is dict:
        return value.get("availability") == "UNAVAILABLE" or any(has_unavailable(item) for item in value.values())
    if type(value) is list:
        return any(has_unavailable(item) for item in value)
    return False


def project_documents(native, runner, *, revision, run_id, run_attempt, native_conclusion):
    patterned(revision, SHA40)
    integer(run_id, 1)
    integer(run_attempt, 1)
    enum(native_conclusion, ("success", "failure", "cancelled", "skipped"))
    report = {"format": FORMAT, "reportStatus": "UNAVAILABLE", "binding": "UNAVAILABLE",
        "sourceRevision": revision, "runId": run_id, "runAttempt": run_attempt,
        "nativeConclusion": native_conclusion, "authority": "RECORDED_PRODUCER_OBSERVATIONS",
        "revalidatedRuntime": False, "runner": unavailable("IDENTITY_MISSING"),
        "native": unavailable("IDENTITY_MISSING")}
    try:
        bind_runner(runner, revision, run_id, run_attempt)
    except ReportError as error:
        report["reasonCode"] = error.code
        return report
    report["runner"] = section(runner_projection, runner)
    report["native"] = section(native_projection, native, revision) if native is not MISSING else unavailable("INPUT_MISSING")
    if report["native"]["availability"] != "RECORDED":
        report["reasonCode"] = report["native"].get("reasonCode", "INPUT_MISSING")
        return report
    report["binding"] = "SOURCE_RUN_ATTEMPT"
    report["reportStatus"] = "PARTIAL" if has_unavailable(report) else "AVAILABLE"
    return report


def expected_context(environment):
    need(sys.platform.startswith("linux"), "REPORT_PLATFORM")
    fixed = {"CI": "true", "GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "spikeal8-maker/asa-lab",
             "GITHUB_WORKFLOW": "ASA Real Host Acceptance", "GITHUB_JOB": "evidence_report"}
    need(all(environment.get(key) == value for key, value in fixed.items()), "REPORT_CONTEXT")
    revision = patterned(environment.get("SOURCE_REVISION"), SHA40)
    numbers = []
    for key in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"):
        value = environment.get(key)
        need(type(value) is str and re.fullmatch(r"[1-9][0-9]{0,18}", value) is not None, "REPORT_CONTEXT")
        numbers.append(integer(int(value), 1))
    conclusion = enum(environment.get("NATIVE_RESULT"), ("success", "failure", "cancelled", "skipped"))
    temporary = environment.get("RUNNER_TEMP")
    need(type(temporary) is str and 1 < len(temporary) <= 4000 and temporary.startswith("/")
         and PurePosixPath(temporary).anchor == "/" and str(PurePosixPath(temporary)) == temporary
         and ".." not in temporary.split("/") and not any(ord(char) < 32 for char in temporary), "INPUT_PATH")
    return {"revision": revision, "run_id": numbers[0], "run_attempt": numbers[1],
            "native_conclusion": conclusion}, temporary + "/" + DIRECTORY


def encoded_report(report):
    raw = json.dumps(report, ensure_ascii=True, allow_nan=False, indent=2, sort_keys=True).encode("ascii")
    need(len(raw) <= OUTPUT_LIMIT, "OUTPUT_LIMIT")
    return raw


def main():
    result = None
    try:
        need(len(sys.argv) == 1, "REPORT_CONTEXT")
        expected, path = expected_context(os.environ)
        documents, inputs = read_artifacts(path)
        result = project_documents(documents.get("native", MISSING), documents.get("runner", MISSING), **expected)
        result["inputs"] = inputs
        raw = encoded_report(result)
    except ReportError as error:
        result = {"format": FORMAT, "reportStatus": "UNAVAILABLE", "binding": "UNAVAILABLE", "reasonCode": error.code}
        raw = encoded_report(result)
    except Exception:
        result = {"format": FORMAT, "reportStatus": "UNAVAILABLE", "binding": "UNAVAILABLE", "reasonCode": "REPORT_ERROR"}
        raw = encoded_report(result)
    # All printable bytes are fixed syntax, finite vocabulary, bounded numbers,
    # or typed identifiers/hashes. No user message or raw exception is printed.
    print("ASA_REALHOST_REPORT_BEGIN")
    print(raw.decode("ascii"))
    print("ASA_REALHOST_REPORT_END")
    return 0 if result["reportStatus"] in ("AVAILABLE", "PARTIAL") else 2


if __name__ == "__main__":
    raise SystemExit(main())
