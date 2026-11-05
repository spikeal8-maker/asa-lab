"""Pure, closed evidence checks for an installed Ubuntu acceptance fixture.

The caller runs the CLI and independently supplies the approved release pins,
storage paths, snapshot IDs and fixture configuration. This module performs no
I/O, imports no product implementation, and never infers expected pins from the
answer being checked. It is deliberately not a validator for arbitrary hosts:
the supported fixture has a completed installation, best-effort backup policy,
disabled cloud and retained local snapshots. Unknown contracts fail closed.

Use ``check_read_result(command, document, returncode=..., expected=...)``.
Help needs only ``help_topic``. Returned dictionaries contain constructed,
allowlisted evidence; prose, command hints and raw logs are never returned.
These checks establish consistency of supplied observations, not that a command
was executed, that it was read-only, or that a VM acceptance run passed.
"""
from __future__ import annotations

from dataclasses import dataclass
import datetime as dt
import math
import re


ERROR_CODES = frozenset({
    "INVALID_CONTEXT", "UNSUPPORTED_COMMAND", "CLI_ENVELOPE", "FIELD_SET",
    "FIELD_TYPE", "FIELD_BOUNDS", "UNRECOGNIZED_REASON", "UNEXPECTED_STATE",
    "INSTALLATION_IDENTITY", "RELEASE_PIN_MISMATCH", "SCHEMA_MISMATCH",
    "SNAPSHOT_MISMATCH", "OPERATION_MISMATCH", "MEASUREMENT_INCONSISTENT",
    "HELP_CONTRACT",
})
IMAGE_SERVICES = ("api", "web", "scratch", "minio", "search")
RUNNING_SERVICES = ("api", "web", "postgres", "minio", "scratch", "search")
FILESYSTEMS = ("application", "backups", "docker", "postgres", "minio")
MAX_BYTES = 2 ** 63 - 1
SHA = re.compile(r"[a-f0-9]{40}\Z")
DIGEST = re.compile(r"sha256:[a-f0-9]{64}\Z")
OPERATION = re.compile(r"[a-f0-9]{32}\Z")
SNAPSHOT = re.compile(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8,32}\Z")
HISTORY_REASONS = frozenset({
    "NONE", "OWNER_INPUT_REQUIRED", "OPERATION_INTENT", "DOCKER_UNKNOWN",
    "DEPENDENCIES", "REGISTRY", "DNS", "TLS_NETWORK", "COMMAND",
    "INTERRUPTED", "BACKUP_REQUIRED",
})
EVENT_STAGES = frozenset({
    "start_existing", "handoff", "recovery", "recover_first_backup",
    "acceptance_preflight", "preflight", "release", "source", "environment",
    "settings", "images", "space", "migration_plan", "backup_preflight",
    "backup", "switch", "browser", "backup_continuation", "first_backup",
    "first_backup_space", "owner_registration", "owner_grant", "backup_recovery",
    "parent_receipt", "cloud_delivery", "retention", "configured",
})
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
HELP_PARAMETERS = (
    "--help", "--json", "--no-color", "--root ПУТЬ", "--snapshot-id ID",
    "--operation-id ID", "--deployment-digest sha256:HEX", "--config-file ПУТЬ",
    "--non-interactive",
)
ENVELOPE = frozenset({"format", "command", "exitCode"})
UPDATE_REJECTION_SECTIONS = frozenset({
    "UPDATE_ENVELOPE", "UPDATE_TARGET", "UPDATE_CURRENT", "UPDATE_CURRENT_DATABASE",
    "UPDATE_MIGRATIONS", "UPDATE_DISK", "UPDATE_SPACE", "UPDATE_BACKUP", "UPDATE_CLOUD",
})


class CLIReadCheckError(ValueError):
    """Only fixed codes escape, even when the input contains secrets."""

    def __init__(self, code):
        self.code = code if type(code) is str and code in ERROR_CODES else "FIELD_TYPE"
        self.section = None
        super().__init__(self.code)


@dataclass(frozen=True)
class ReleasePin:
    revision: str
    schema: int
    images: dict[str, str]


@dataclass(frozen=True)
class FixtureContext:
    root: str
    project: str
    origin: str
    installed: ReleasePin
    target: ReleasePin
    deployment_digest: str
    manifest_digest: str
    filesystem_paths: dict[str, str]
    ports: dict[str, int]
    schedule: dict
    snapshot_ids: tuple[str, ...]
    last_attempt: str
    last_local_success: str
    accepted_operation_id: str
    profile: str = "production"
    backup_policy: str = "best-effort"
    cloud_enabled: bool = False
    encryption_enabled: bool = True
    automatic_updates: bool = False
    accepted_mode: str = "install"
    restore_snapshot_id: str | None = None


def _need(condition, code="UNEXPECTED_STATE"):
    if not condition:
        raise CLIReadCheckError(code)


def _shape(value, required, optional=(), *, envelope=False):
    _need(type(value) is dict, "FIELD_TYPE")
    keys = set(required) | (ENVELOPE if envelope else set())
    _need(keys <= value.keys() and value.keys() <= keys | set(optional), "FIELD_SET")


def _equal(value, expected, code="UNEXPECTED_STATE"):
    _need(type(value) is type(expected) and value == expected, code)
    return value


def _text(value, maximum=256):
    _need(type(value) is str, "FIELD_TYPE")
    _need(0 < len(value) <= maximum and not any(ord(c) < 32 or ord(c) == 127 for c in value), "FIELD_BOUNDS")
    return value


def _pattern(value, pattern):
    _need(bool(pattern.fullmatch(_text(value, 512))), "FIELD_BOUNDS")
    return value


def _integer(value, minimum=0, maximum=MAX_BYTES):
    _need(type(value) is int, "FIELD_TYPE")
    _need(minimum <= value <= maximum, "FIELD_BOUNDS")
    return value


def _boolean(value):
    _need(type(value) is bool, "FIELD_TYPE")
    return value


def _enum(value, choices):
    _need(type(value) is str, "FIELD_TYPE")
    _need(value in choices)
    return value


def _reason(value, choices):
    _need(type(value) is str and value in choices, "UNRECOGNIZED_REASON")
    return value


def _array(value, maximum, minimum=0):
    _need(type(value) is list, "FIELD_TYPE")
    _need(minimum <= len(value) <= maximum, "FIELD_BOUNDS")
    return value


def _time(value):
    _text(value, 40)
    try:
        stamp = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise CLIReadCheckError("FIELD_BOUNDS") from None
    _need(stamp.tzinfo is not None and stamp.utcoffset() == dt.timedelta(0), "FIELD_BOUNDS")
    return stamp.isoformat()


def _path(value):
    _text(value, 512)
    _need(re.fullmatch(r"/[A-Za-z0-9_./-]+", value) is not None
          and all(part not in ("", ".", "..") for part in value.split("/")[1:]), "FIELD_BOUNDS")
    return value


def _unavailable(value, reasons):
    _shape(value, ("status", "reasonCode"))
    _equal(value["status"], "UNAVAILABLE")
    return {"status": "UNAVAILABLE", "reasonCode": _reason(value["reasonCode"], reasons)}


def _release_pin(pin):
    _need(type(pin) is ReleasePin, "INVALID_CONTEXT")
    _pattern(pin.revision, SHA)
    _integer(pin.schema, 1, 99999999)
    _shape(pin.images, IMAGE_SERVICES)
    for service in IMAGE_SERVICES:
        _pattern(pin.images[service], re.compile(
            r"ghcr\.io/spikeal8-maker/asa-lab/" + service + r"@sha256:[a-f0-9]{64}\Z"))


def _schedule_settings(value):
    _shape(value, ("enabled", "time", "timezone", "maxAgeHours"))
    return {
        "enabled": _boolean(value["enabled"]),
        "time": _pattern(value["time"], re.compile(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]\Z")),
        "timezone": _pattern(value["timezone"], re.compile(r"[A-Za-z0-9_+/-]{1,80}\Z")),
        "maxAgeHours": _integer(value["maxAgeHours"], 1, 8760),
    }


def _context(context):
    try:
        _need(type(context) is FixtureContext)
        _path(context.root)
        _pattern(context.project, re.compile(r"[a-z0-9][a-z0-9_-]{0,127}\Z"))
        _pattern(context.origin, re.compile(r"https?://[a-zA-Z0-9.-]+(?::[0-9]{1,5})?\Z"))
        _release_pin(context.installed)
        _release_pin(context.target)
        _pattern(context.deployment_digest, DIGEST)
        _pattern(context.manifest_digest, DIGEST)
        _shape(context.filesystem_paths, FILESYSTEMS)
        for name in FILESYSTEMS:
            _path(context.filesystem_paths[name])
        _equal(context.filesystem_paths["application"], context.root)
        _shape(context.ports, ("web", "api", "blocks"))
        for name in ("web", "api", "blocks"):
            _integer(context.ports[name], 1, 65535)
        _schedule_settings(context.schedule)
        _need(type(context.snapshot_ids) is tuple and 1 <= len(context.snapshot_ids) <= 100)
        for snapshot in context.snapshot_ids:
            _pattern(snapshot, SNAPSHOT)
        _need(len(set(context.snapshot_ids)) == len(context.snapshot_ids))
        _need(context.last_attempt in context.snapshot_ids and context.last_local_success in context.snapshot_ids)
        _pattern(context.accepted_operation_id, OPERATION)
        _enum(context.profile, ("production", "staging", "dev", "base"))
        _equal(context.backup_policy, "best-effort")
        _equal(context.cloud_enabled, False)
        _boolean(context.encryption_enabled)
        _boolean(context.automatic_updates)
        _enum(context.accepted_mode, ("install", "update"))
        if context.restore_snapshot_id is not None:
            _need(context.restore_snapshot_id in context.snapshot_ids)
    except CLIReadCheckError:
        raise CLIReadCheckError("INVALID_CONTEXT") from None


def _release(value, pin, *, target=False):
    fields = ("revision", "schema", "images") if target else ("status", "revision", "schema", "images")
    _shape(value, fields, ("deploymentDigest", "manifestDigest", "ci") if target else ())
    if not target:
        _equal(value["status"], "RECORDED")
    _equal(value["revision"], pin.revision, "RELEASE_PIN_MISMATCH")
    _equal(_integer(value["schema"], 1, 99999999), pin.schema, "SCHEMA_MISMATCH")
    _shape(value["images"], IMAGE_SERVICES)
    for service in IMAGE_SERVICES:
        _equal(value["images"][service], pin.images[service], "RELEASE_PIN_MISMATCH")
    # The fixed service list, not input dictionary keys, controls this projection.
    result = {"revision": pin.revision, "schema": pin.schema,
              "images": {service: pin.images[service] for service in IMAGE_SERVICES}}
    if not target:
        result["status"] = "RECORDED"
    return result


def _database(value, context):
    _shape(value, ("status", "schema", "bytes"))
    _equal(value["status"], "OK")
    _equal(_integer(value["schema"], 1, 99999999), context.installed.schema, "SCHEMA_MISMATCH")
    return {"status": "OK", "schema": context.installed.schema, "bytes": _integer(value["bytes"], 1)}


def _services(value, *, envelope=False):
    _shape(value, ("status", "docker", "compose", "containers", "reasonCode"), envelope=envelope)
    _equal(value["status"], "OK")
    _equal(value["reasonCode"], None)
    for tool in ("docker", "compose"):
        _shape(value[tool], ("status", "version"))
        _equal(value[tool]["status"], "OK")
        _pattern(value[tool]["version"], re.compile(r"[0-9][0-9A-Za-z.+_-]{0,63}\Z"))
    services = {}
    for item in _array(value["containers"], 64, len(RUNNING_SERVICES)):
        _shape(item, ("service", "running", "health"))
        name = _enum(item["service"], (*RUNNING_SERVICES, "migration", "minio-init"))
        _need(name not in services, "INSTALLATION_IDENTITY")
        running = _boolean(item["running"])
        _need(item["health"] in (None, "starting", "healthy", "unhealthy"))
        if name in RUNNING_SERVICES:
            _need(running and item["health"] == "healthy")
        # One-shot rows retain the observed health; an inherited server probe
        # does not establish job completion or the health of the live services.
        services[name] = {"service": name, "running": running, "health": item["health"]}
    _need(set(RUNNING_SERVICES) <= services.keys(), "INSTALLATION_IDENTITY")
    return {"status": "OK", "docker": "OK", "compose": "OK",
            "containers": [services[name] for name in sorted(services)]}


def _schedule(value, context, *, envelope=False):
    _shape(value, ("status", "configured", "installed", "active", "enabled", "nextRun", "lastRun"), envelope=envelope)
    _equal(value["status"], "OK")
    configured = _schedule_settings(value["configured"])
    _equal(configured, context.schedule, "INSTALLATION_IDENTITY")
    installed = _boolean(value["installed"])
    for key in ("active", "enabled"):
        if installed:
            _equal(_boolean(value[key]), configured["enabled"])
        else:
            _equal(value[key], None)
    _need(installed or not configured["enabled"])
    for key in ("nextRun", "lastRun"):
        if value[key] is not None:
            _text(value[key], 80)
    return {"status": "OK", "configured": configured, "installed": installed,
            "active": value["active"], "enabled": value["enabled"],
            "nextRunReported": value["nextRun"] is not None, "lastRunReported": value["lastRun"] is not None}


def _cloud_receipt(value):
    _shape(value, ("status", "verifiedAt", "evidenceScope", "deleted"))
    _equal(value["status"], "NOT_CONFIGURED")
    _equal(value["verifiedAt"], None)
    _equal(value["evidenceScope"], "RECORDED_DELIVERY")
    _equal(value["deleted"], False)
    return {"status": "NOT_CONFIGURED", "verifiedAt": None,
            "evidenceScope": "RECORDED_DELIVERY", "deleted": False}


def _backup_item(value, context, expected_id=None):
    _shape(value, ("status", "snapshotId", "snapshotAt", "ageHours", "local", "encryption", "cloud"))
    _equal(value["status"], "RECORDED")
    snapshot = _pattern(value["snapshotId"], SNAPSHOT)
    _need(snapshot in context.snapshot_ids and (expected_id is None or snapshot == expected_id), "SNAPSHOT_MISMATCH")
    stamp = _time(value["snapshotAt"])
    age = value["ageHours"]
    _need(type(age) in (int, float), "FIELD_TYPE")
    _need(0 <= age <= 876000 and math.isfinite(age), "FIELD_BOUNDS")
    local = value["local"]
    _shape(local, ("status", "deleted", "bytes", "present", "evidenceScope"))
    _equal(local["status"], "OK")
    _equal(local["deleted"], False)
    _equal(local["present"], True)
    _equal(local["evidenceScope"], "RECORDED_VERIFICATION")
    size = _integer(local["bytes"], 1)
    encryption = value["encryption"]
    _shape(encryption, ("status", "bytes"))
    _equal(encryption["status"], "OK" if context.encryption_enabled else "NOT_CONFIGURED")
    encrypted_size = _integer(encryption["bytes"], 1) if context.encryption_enabled else _equal(encryption["bytes"], None)
    return {"status": "RECORDED", "snapshotId": snapshot, "snapshotAt": stamp, "ageHours": age,
            "local": {"status": "OK", "bytes": size, "present": True, "deleted": False,
                      "evidenceScope": "RECORDED_VERIFICATION"},
            "encryption": {"status": encryption["status"], "bytes": encrypted_size},
            "cloud": _cloud_receipt(value["cloud"])}


def _same_snapshot(first, second):
    # ageHours is observed independently and can cross its rounding boundary
    # while the same receipt is projected twice in a single CLI invocation.
    _need(all(first[key] == second[key] for key in
              ("snapshotId", "snapshotAt", "local", "encryption", "cloud")), "SNAPSHOT_MISMATCH")


def _backups(value, context, *, listing=False, envelope=False):
    extra = ("items", "limit", "truncated") if listing else ("schedule",)
    _shape(value, ("status", "lastAttempt", "lastLocalSuccess", "lastCloudSuccess", *extra), envelope=envelope)
    _equal(value["status"], "RECORDED")
    attempt = _backup_item(value["lastAttempt"], context, context.last_attempt)
    local = _backup_item(value["lastLocalSuccess"], context, context.last_local_success)
    result = {"status": "RECORDED", "lastAttempt": attempt, "lastLocalSuccess": local,
              "lastCloudSuccess": _unavailable(value["lastCloudSuccess"], {"BACKUP_EVIDENCE_MISSING"})}
    if attempt["snapshotId"] == local["snapshotId"]:
        _same_snapshot(attempt, local)
    if listing:
        _equal(value["limit"], 100)
        _equal(value["truncated"], False)
        items = [_backup_item(item, context) for item in _array(value["items"], 100, 1)]
        _need(len(items) == len(context.snapshot_ids) and {item["snapshotId"] for item in items} == set(context.snapshot_ids), "SNAPSHOT_MISMATCH")
        indexed = {item["snapshotId"]: item for item in items}
        _same_snapshot(indexed[context.last_attempt], attempt)
        _same_snapshot(indexed[context.last_local_success], local)
        result["items"] = items
        result["truncated"] = False
    else:
        result["schedule"] = _schedule(value["schedule"], context)
    return result


def _cloud(value, context, *, envelope=False):
    _shape(value, ("status", "configured", "policy", "transport", "remote", "lastDelivery", "note"), envelope=envelope)
    _equal(value["status"], "UNAVAILABLE")
    _equal(value["configured"], context.cloud_enabled, "INSTALLATION_IDENTITY")
    _equal(value["policy"], context.backup_policy, "INSTALLATION_IDENTITY")
    _text(value["note"], 2048)  # Validate its budget; never persist this prose.
    return {"status": "UNAVAILABLE", "configured": False, "policy": "best-effort",
            "transport": _unavailable(value["transport"], {"CLOUD_NOT_CONFIGURED"}),
            "remote": _unavailable(value["remote"], {"NO_READ_ONLY_PROVIDER_PROBE"}),
            "lastDelivery": _unavailable(value["lastDelivery"], {"BACKUP_EVIDENCE_MISSING"})}


def _disk(value, context, *, envelope=False):
    _shape(value, ("status", "filesystems", "database", "physicalHealth"), envelope=envelope)
    _equal(value["status"], "OK")
    _shape(value["filesystems"], FILESYSTEMS)
    volumes = {}
    for name in FILESYSTEMS:
        row = value["filesystems"][name]
        _shape(row, ("status", "path", "totalBytes", "freeBytes", "usedBytes", "freeInodes", "totalInodes"))
        _equal(row["status"], "OK")
        _equal(row["path"], context.filesystem_paths[name], "INSTALLATION_IDENTITY")
        total = _integer(row["totalBytes"], 1)
        free, used = _integer(row["freeBytes"], 0, total), _integer(row["usedBytes"], 0, total)
        inodes = _integer(row["totalInodes"])
        available_inodes = _integer(row["freeInodes"], 0, inodes)
        _need(free + used <= total, "MEASUREMENT_INCONSISTENT")
        volumes[name] = {"status": "OK", "path": row["path"], "totalBytes": total,
                         "freeBytes": free, "usedBytes": used, "freeInodes": available_inodes, "totalInodes": inodes}
    return {"status": "OK", "filesystems": volumes, "database": _database(value["database"], context),
            "physicalHealth": _unavailable(value["physicalHealth"], {"USE_DISK_HEALTH"})}


def _disk_health(value, *, envelope=False):
    if type(value) is dict and "devices" not in value:
        _shape(value, ("status", "reasonCode"), envelope=envelope)
        _equal(value["status"], "UNAVAILABLE")
        return {"status": "UNAVAILABLE", "reasonCode": _reason(value["reasonCode"], {"SMART_UNAVAILABLE"})}
    _shape(value, ("status", "devices", "reasonCode"), envelope=envelope)
    devices = []
    names = set()
    for item in _array(value["devices"], 32):
        _shape(item, ("device", "status"))
        device = _pattern(item["device"], re.compile(r"/dev/(?:[shv]d[a-z]{1,3}|xvd[a-z]{1,3}|nvme[0-9]{1,4}n[0-9]{1,4})\Z"))
        _need(device not in names, "INSTALLATION_IDENTITY")
        names.add(device)
        # A known warning/failure is an acceptance failure even if masked above.
        state = _enum(item["status"], ("OK", "UNAVAILABLE"))
        devices.append({"device": device, "status": state})
    expected = "OK" if devices and all(item["status"] == "OK" for item in devices) else "UNAVAILABLE"
    _equal(value["status"], expected)
    if devices:
        _equal(value["reasonCode"], None)
    else:
        _reason(value["reasonCode"], {"NO_PHYSICAL_SENSOR"})
    return {"status": expected, "devices": devices, "reasonCode": value["reasonCode"]}


def _history_row(row, *, events=False):
    _shape(row, ("operationId", "mode", "startedAt", "updatedAt", "state", "outcome", "reasonCode"), ("events",) if events else ())
    identifier = _pattern(row["operationId"], OPERATION)
    mode = _enum(row["mode"], ("install", "update", "backup", "retry-cloud", "configure", "schedule", "repair-collector"))
    started, updated = _time(row["startedAt"]), _time(row["updatedAt"])
    _need(started <= updated, "OPERATION_MISMATCH")
    _equal(row["state"], "TERMINAL")
    outcome = _enum(row["outcome"], ("ACCEPTED", "WARNING", "NO_CHANGE", "CHECKED", "CONFIGURED", "STATUS", "PLANNED", "BLOCKED", "ERROR"))
    reason = _reason(row["reasonCode"], HISTORY_REASONS)
    return {"operationId": identifier, "mode": mode, "startedAt": started,
            "updatedAt": updated, "state": "TERMINAL", "outcome": outcome, "reasonCode": reason}


def _history(value, context, *, logs=False, backup_logs=False, update_only=False, envelope=False):
    _shape(value, ("status", "items", "scope" if logs else "truncated"), envelope=envelope)
    rows = _array(value["items"], 10 if logs else 100)
    if logs:
        _equal(value["scope"], "SANITIZED_OPERATION_EVENTS")
    else:
        _equal(value["truncated"], False)
    if backup_logs:
        # The accepted operation is install/update; its embedded first backup
        # does not create a separate backup/retry-cloud journal.
        _equal(value["status"], "UNAVAILABLE")
        _need(not rows, "OPERATION_MISMATCH")
        return {"status": "UNAVAILABLE", "scope": "SANITIZED_OPERATION_EVENTS", "records": 0}
    _equal(value["status"], "OK")
    projected, accepted, identifiers = [], None, set()
    for row in rows:
        item = _history_row(row, events=logs)
        if update_only:
            _need(item["mode"] in ("install", "update"), "OPERATION_MISMATCH")
        _need(item["operationId"] not in identifiers, "OPERATION_MISMATCH")
        identifiers.add(item["operationId"])
        if logs:
            _need("events" in row, "FIELD_SET")
            stage_states = {}
            for event in _array(row["events"], 100):
                _shape(event, ("at",), ("stage", "status", "phase"))
                # Every status needs the stage whose state is checked below.
                _need("status" not in event or "stage" in event, "FIELD_SET")
                _time(event["at"])
                if "stage" in event:
                    _enum(event["stage"], EVENT_STAGES)
                if "status" in event:
                    _enum(event["status"], ("intent", "done", "failed"))
                if "phase" in event:
                    _enum(event["phase"], EVENT_STAGES | {"created", "bootstrap"})
                if "stage" in event and "status" in event:
                    stage_states[event["stage"]] = event["status"]
            done = {stage for stage, state in stage_states.items() if state == "done"}
            item["events"] = len(row["events"])
            item["completedStages"] = sorted(done)
        if item["operationId"] == context.accepted_operation_id:
            _equal(item["mode"], context.accepted_mode, "OPERATION_MISMATCH")
            _equal(item["outcome"], "WARNING", "OPERATION_MISMATCH")
            _equal(item["reasonCode"], "NONE", "OPERATION_MISMATCH")
            if logs:
                backup_stage = "first_backup" if context.accepted_mode == "install" else "backup"
                _need({"release", "switch", "browser", backup_stage} <= done
                      and "failed" not in stage_states.values(), "OPERATION_MISMATCH")
            accepted = item
        projected.append(item)
    _need(accepted is not None, "OPERATION_MISMATCH")
    result = {"status": "OK", "records": len(projected), "acceptedOperation": accepted,
              "historicalFailures": sum(item["outcome"] in ("BLOCKED", "ERROR") for item in projected)}
    if logs:
        result["scope"] = "SANITIZED_OPERATION_EVENTS"
    else:
        result["truncated"] = False
    return result


def _site(value, context):
    _shape(value, ("status", "origin", "https", "revision", "reportedSchema", "editorEndpoint", "browserAcceptance"))
    _equal(value["status"], "OK")
    _equal(value["origin"], context.origin, "INSTALLATION_IDENTITY")
    _equal(value["https"], "OK" if context.origin.startswith("https://") else "UNAVAILABLE")
    _equal(value["revision"], context.installed.revision, "RELEASE_PIN_MISMATCH")
    _equal(_integer(value["reportedSchema"], 1, 99999999), context.installed.schema, "SCHEMA_MISMATCH")
    _shape(value["editorEndpoint"], ("status",))
    _equal(value["editorEndpoint"]["status"], "OK")
    browser = value["browserAcceptance"]
    _shape(browser, ("status", "reasonCode", "historical"))
    _equal(browser["status"], "NOT_RUN")
    _reason(browser["reasonCode"], {"READ_ONLY"})
    historical = browser["historical"]
    _shape(historical, ("status", "at", "applicationAccepted", "operationId"))
    _equal(historical["status"], "RECORDED")
    _equal(historical["applicationAccepted"], True)
    _equal(historical["operationId"], context.accepted_operation_id, "OPERATION_MISMATCH")
    return {"status": "OK", "origin": context.origin, "https": value["https"],
            "revision": context.installed.revision, "reportedSchema": context.installed.schema,
            "editorEndpoint": {"status": "OK"},
            "browserAcceptance": {"status": "NOT_RUN", "reasonCode": "READ_ONLY",
                "historical": {"status": "RECORDED", "at": _time(historical["at"]),
                               "applicationAccepted": True, "operationId": context.accepted_operation_id}}}


def _host(value):
    _shape(value, ("status", "os", "distribution", "version", "architecture", "cpuCount", "memoryBytes", "supportedSetupHost"))
    _equal(value["status"], "OK")
    _equal(value["os"], "Linux")
    _equal(value["distribution"], "ubuntu")
    _equal(value["version"], "24.04")
    architecture = _enum(value["architecture"], ("x86_64", "AMD64"))
    _equal(value["supportedSetupHost"], True)
    return {"status": "OK", "distribution": "ubuntu", "version": "24.04", "architecture": architecture,
            "cpuCount": _integer(value["cpuCount"], 1, 65536), "memoryBytes": _integer(value["memoryBytes"], 1)}


def _status(value, context, *, doctor=False):
    extra = ("host", "disk", "diskHealth", "cloud", "optionalUnavailableChecks") if doctor else ()
    _shape(value, ("status", "observedAt", "root", "installed", "services", "database", "site", "backup", "updates", "history", "access", *extra), envelope=True)
    _equal(value["status"], "OK")
    _equal(value["root"], context.root, "INSTALLATION_IDENTITY")
    _equal(value["access"], "OBSERVED")
    updates = value["updates"]
    _shape(updates, ("status", "checkedAt", "reasonCode"))
    _equal(updates["status"], "UNAVAILABLE")
    _equal(updates["checkedAt"], None)
    _reason(updates["reasonCode"], {"USE_UPDATE_CHECK"})
    result = {"status": "OK", "observedAt": _time(value["observedAt"]), "root": context.root,
              "installed": _release(value["installed"], context.installed),
              "services": _services(value["services"]), "database": _database(value["database"], context),
              "site": _site(value["site"], context), "backup": _backups(value["backup"], context),
              "updates": {"status": "UNAVAILABLE", "checkedAt": None, "reasonCode": "USE_UPDATE_CHECK"},
              "history": _history(value["history"], context), "access": "OBSERVED"}
    if doctor:
        result["host"] = _host(value["host"])
        result["disk"] = _disk(value["disk"], context)
        result["diskHealth"] = _disk_health(value["diskHealth"])
        result["cloud"] = _cloud(value["cloud"], context)
        names = _array(value["optionalUnavailableChecks"], 6)
        expected = (["diskHealth"] if result["diskHealth"]["status"] == "UNAVAILABLE" else []) + ["cloud", "cloud.transport", "cloud.remote"]
        _need(names == expected)
        result["optionalUnavailableChecks"] = expected
    return result


def _space(value, context, database, disk):
    if type(value) is dict and value.get("status") == "UNAVAILABLE":
        return _unavailable(value, {"STORAGE_MEASUREMENT_UNAVAILABLE", "SPACE_MEASUREMENT_UNAVAILABLE"})
    _shape(value, ("status", "scope", "observedSnapshotBytes", "imageBytes", "path", "freeBytes", "requiredBytes", "freeInodes", "requiredInodes", "snapshotEntries", "sufficient"))
    _equal(value["status"], "MEASURED_BACKUP_BUDGET")
    _equal(value["scope"], "LOCAL_SNAPSHOT_TAR_CIPHERTEXT_READBACK_RESERVE")
    _equal(value["imageBytes"], None)
    _equal(value["path"], context.filesystem_paths["backups"], "INSTALLATION_IDENTITY")
    observed = _integer(value["observedSnapshotBytes"], database["bytes"])
    entries = _integer(value["snapshotEntries"], 32)
    required = _integer(value["requiredBytes"], 1)
    required_inodes = _integer(value["requiredInodes"], 1024)
    _need(required == int(observed * 4 * 1.1) + 2 * 1024 ** 3
          and required_inodes == max(1024, (entries * 11 + 9) // 10 + 128), "MEASUREMENT_INCONSISTENT")
    volume = disk["filesystems"]["backups"]
    free = _integer(value["freeBytes"], 0, volume["totalBytes"])
    free_inodes = _integer(value["freeInodes"], 0, volume["totalInodes"])
    _equal(value["sufficient"], True)
    _need(free >= required and (volume["totalInodes"] == 0 or free_inodes >= required_inodes), "MEASUREMENT_INCONSISTENT")
    return {"status": "MEASURED_BACKUP_BUDGET", "scope": "LOCAL_SNAPSHOT_TAR_CIPHERTEXT_READBACK_RESERVE",
            "observedSnapshotBytes": observed, "imageBytes": None, "path": value["path"],
            "freeBytes": free, "requiredBytes": required, "freeInodes": free_inodes,
            "requiredInodes": required_inodes, "snapshotEntries": entries, "sufficient": True}


def _update_section(section, validator, *args, **kwargs):
    """Attach a fixed validator group, never a claim about an exact nested leaf."""
    try:
        return validator(*args, **kwargs)
    except CLIReadCheckError as error:
        error.section = section if type(section) is str and section in UPDATE_REJECTION_SECTIONS else None
        raise


def _update(value, context):
    _update_section("UPDATE_ENVELOPE", _shape, value, ("status", "checkedAt", "current", "currentDatabase", "target", "available", "migrations", "requiredSpaceBytes", "estimatedDowntimeSeconds", "backupSpaceEstimate", "downtimeReasonCode", "spaceReasonCode", "disk", "backup", "cloud", "blockers", "applyRechecksUnderLock", "apply"), envelope=True)
    _equal(value["status"], "PLANNED")
    target = value["target"]
    _update_section("UPDATE_TARGET", _shape, target, ("revision", "schema", "images", "deploymentDigest", "manifestDigest", "ci"))
    selected = _update_section("UPDATE_TARGET", _release, target, context.target, target=True)
    _equal(target["deploymentDigest"], context.deployment_digest, "RELEASE_PIN_MISMATCH")
    _equal(target["manifestDigest"], context.manifest_digest, "RELEASE_PIN_MISMATCH")
    _equal(target["ci"], "VERIFIED")
    selected["deploymentDigest"], selected["manifestDigest"], selected["ci"] = context.deployment_digest, context.manifest_digest, "VERIFIED"
    current = _update_section("UPDATE_CURRENT", _release, value["current"], context.installed)
    database = _update_section("UPDATE_CURRENT_DATABASE", _database, value["currentDatabase"], context)
    _need(context.target.schema >= context.installed.schema, "SCHEMA_MISMATCH")
    _equal(value["available"], context.target.revision != context.installed.revision)
    migrations = value["migrations"]
    _update_section("UPDATE_MIGRATIONS", _shape, migrations, ("status", "fromSchema", "toSchema", "exactList", "reasonCode"))
    _equal(migrations["status"], "SCHEMA_RANGE_ONLY")
    _equal(migrations["fromSchema"], context.installed.schema, "SCHEMA_MISMATCH")
    _equal(migrations["toSchema"], context.target.schema, "SCHEMA_MISMATCH")
    _equal(migrations["exactList"], None)
    _reason(migrations["reasonCode"], {"EXACT_PLAN_REQUIRES_VERIFIED_MIGRATION_RUNTIME"})
    _equal(value["requiredSpaceBytes"], None, "MEASUREMENT_INCONSISTENT")
    _equal(value["estimatedDowntimeSeconds"], None, "MEASUREMENT_INCONSISTENT")
    _reason(value["downtimeReasonCode"], {"NO_MEASURED_DURATION"})
    _reason(value["spaceReasonCode"], {"NEW_IMAGE_UNPACKED_BYTES_UNKNOWN"})
    blockers = _array(value["blockers"], 6)
    for blocker in blockers:
        _reason(blocker, {"INSTALLED_RELEASE_UNAVAILABLE", "CURRENT_SCHEMA_UNAVAILABLE", "SCHEMA_DOWNGRADE",
                          "BACKUP_POLICY_UNAVAILABLE", "REQUIRED_CLOUD_TRANSPORT_UNAVAILABLE", "BACKUP_SPACE"})
    _need(not blockers)
    _equal(value["applyRechecksUnderLock"], True)
    _text(value["apply"], 2048)  # An invocation hint is not evidence or executable input.
    disk = _update_section("UPDATE_DISK", _disk, value["disk"], context)
    return {"status": "PLANNED", "checkedAt": _time(value["checkedAt"]), "current": current,
            "currentDatabase": database, "target": selected, "available": value["available"],
            "migrations": {"status": "SCHEMA_RANGE_ONLY", "fromSchema": context.installed.schema,
                           "toSchema": context.target.schema, "exactList": None,
                           "reasonCode": "EXACT_PLAN_REQUIRES_VERIFIED_MIGRATION_RUNTIME"},
            "requiredSpaceBytes": None, "estimatedDowntimeSeconds": None,
            "spaceReasonCode": "NEW_IMAGE_UNPACKED_BYTES_UNKNOWN", "downtimeReasonCode": "NO_MEASURED_DURATION",
            "backupSpaceEstimate": _update_section("UPDATE_SPACE", _space, value["backupSpaceEstimate"], context, database, disk),
            "disk": disk, "backup": _update_section("UPDATE_BACKUP", _backups, value["backup"], context),
            "cloud": _update_section("UPDATE_CLOUD", _cloud, value["cloud"], context),
            "blockers": [], "applyRechecksUnderLock": True}


def _config(value, context):
    _shape(value, ("status", "configFormat", "root", "project", "profile", "ports", "backupPolicy", "cloudEnabled", "automaticUpdates", "schedule", "secrets"), envelope=True)
    _equal(value["status"], "OK")
    _equal(value["configFormat"], "asa-setup-config-v1", "CLI_ENVELOPE")
    for key in ("root", "project", "profile"):
        _equal(value[key], getattr(context, key), "INSTALLATION_IDENTITY")
    _shape(value["ports"], ("web", "api", "blocks"))
    ports = {}
    for key in ("web", "api", "blocks"):
        ports[key] = _integer(value["ports"][key], 1, 65535)
        _equal(ports[key], context.ports[key], "INSTALLATION_IDENTITY")
    _equal(value["backupPolicy"], context.backup_policy, "INSTALLATION_IDENTITY")
    _equal(value["cloudEnabled"], context.cloud_enabled, "INSTALLATION_IDENTITY")
    _equal(value["automaticUpdates"], context.automatic_updates, "INSTALLATION_IDENTITY")
    schedule = _schedule_settings(value["schedule"])
    _equal(schedule, context.schedule, "INSTALLATION_IDENTITY")
    _equal(value["secrets"], "OMITTED")
    return {"status": "OK", "configFormat": "asa-setup-config-v1", "root": context.root,
            "project": context.project, "profile": context.profile, "ports": ports,
            "backupPolicy": context.backup_policy, "cloudEnabled": False,
            "automaticUpdates": context.automatic_updates, "schedule": schedule, "secrets": "OMITTED"}


def _help(value, topic):
    _shape(value, ("status", "help"), envelope=True)
    _equal(value["status"], "OK")
    _need(type(topic) is str and (not topic or topic in COMMANDS or topic in {name.split()[0] for name in COMMANDS}), "HELP_CONTRACT")
    help_value = value["help"]
    _shape(help_value, ("title", "syntax", "commands", "parameters", "examples", "exitCodes", "notes"))
    _text(help_value["title"], 512)
    _equal(help_value["syntax"], "asa " + (topic + " " if topic else "[КОМАНДА] ") + "[ПАРАМЕТРЫ]", "HELP_CONTRACT")
    selected = {name: writes for name, writes in COMMANDS.items() if not topic or name == topic or name.startswith(topic + " ")}
    commands = []
    for item in _array(help_value["commands"], len(COMMANDS), 1):
        _shape(item, ("command", "purpose", "changesData", "privileges"))
        _text(item["purpose"], 512)
        name = item["command"]
        _need(type(name) is str and name.startswith("asa ") and name[4:] in selected, "HELP_CONTRACT")
        _equal(item["changesData"], selected[name[4:]], "HELP_CONTRACT")
        _equal(item["privileges"], "root через sudo; Ubuntu setup" if selected[name[4:]] else "Чтение; ограниченные права дают UNAVAILABLE", "HELP_CONTRACT")
        commands.append({"command": name, "changesData": selected[name[4:]]})
    _need(len(commands) == len(selected) and {row["command"][4:] for row in commands} == set(selected), "HELP_CONTRACT")
    _shape(help_value["parameters"], HELP_PARAMETERS)
    for parameter in HELP_PARAMETERS:
        _text(help_value["parameters"][parameter], 512)
    _shape(help_value["exitCodes"], ("0", "1", "2", "130"))
    for code in ("0", "1", "2", "130"):
        _text(help_value["exitCodes"][code], 256)
    examples = _array(help_value["examples"], 6, 6)
    _equal(examples, ["asa help update", "asa status --json", "asa disk health", "asa update plan", "sudo asa update apply", "sudo asa install --root /srv/asa-lab"], "HELP_CONTRACT")
    for note in _array(help_value["notes"], 4, 4):
        _text(note, 1024)
    return {"status": "OK", "topic": topic, "commands": commands,
            "parameters": list(HELP_PARAMETERS), "exitCodes": [0, 1, 2, 130]}


def check_read_result(command, document, *, returncode, expected=None, help_topic=""):
    """Validate one already captured result; raise a fixed-code error on failure.

    ``returncode`` is the subprocess exit code, not a value inferred from JSON.
    Changing stable requires a newly approved ``expected.target`` and digest
    pair. The context must originate outside this result. No input is mutated.
    """
    _need(type(command) is str and (command == "help" or command in COMMANDS and not COMMANDS[command]), "UNSUPPORTED_COMMAND")
    _need(type(document) is dict and ENVELOPE <= document.keys(), "CLI_ENVELOPE")
    _equal(document["format"], "asa-cli-result-v1", "CLI_ENVELOPE")
    _equal(document["command"], command, "CLI_ENVELOPE")
    _need(type(returncode) is int and returncode in (0, 1, 2), "CLI_ENVELOPE")
    _equal(document["exitCode"], returncode, "CLI_ENVELOPE")
    if command == "help":
        result = _help(document, help_topic)
    else:
        _context(expected)
        if command in ("status", "doctor"):
            result = _status(document, expected, doctor=command == "doctor")
        elif command in ("disk", "disk usage"):
            result = _disk(document, expected, envelope=True)
        elif command == "disk health":
            result = _disk_health(document, envelope=True)
        elif command in ("services", "services status"):
            result = _services(document, envelope=True)
        elif command in ("update", "update check", "update plan"):
            result = _update(document, expected)
        elif command in ("backup status", "backup list"):
            result = _backups(document, expected, listing=command == "backup list", envelope=True)
        elif command == "backup schedule":
            result = _schedule(document, expected, envelope=True)
        elif command == "cloud status":
            result = _cloud(document, expected, envelope=True)
        elif command in ("history", "update history", "logs", "logs update", "logs backup"):
            result = _history(document, expected, logs=command.startswith("logs"), backup_logs=command == "logs backup",
                              update_only=command in ("update history", "logs update"), envelope=True)
        elif command == "config show":
            result = _config(document, expected)
        elif command == "backup verify":
            _shape(document, ("status", "snapshotId", "local", "files", "bytes", "restore", "cloud"), envelope=True)
            _equal(document["status"], "OK")
            _equal(document["snapshotId"], expected.last_local_success, "SNAPSHOT_MISMATCH")
            _equal(document["local"], "VERIFIED")
            _equal(document["restore"], "UNVERIFIED")
            result = {"status": "OK", "snapshotId": expected.last_local_success, "local": "VERIFIED",
                      "files": _integer(document["files"], 1, 10000), "bytes": _integer(document["bytes"], 1),
                      "restore": "UNVERIFIED", "cloud": _cloud_receipt(document["cloud"])}
        elif command == "restore plan":
            _shape(document, ("status", "reasonCode", "applyAllowed", "snapshotId", "backup", "restore", "nextAction"), envelope=True)
            _equal(document["status"], "BLOCKED_PLAN")
            _reason(document["reasonCode"], {"P1_R3A_REQUIRED"})
            _equal(document["applyAllowed"], False)
            _equal(document["snapshotId"], expected.restore_snapshot_id, "SNAPSHOT_MISMATCH")
            _text(document["nextAction"], 2048)
            result = {"status": "BLOCKED_PLAN", "reasonCode": "P1_R3A_REQUIRED", "applyAllowed": False,
                      "snapshotId": expected.restore_snapshot_id, "backup": _backups(document["backup"], expected),
                      "restore": _unavailable(document["restore"], {"NOT_RESTORED"})}
        else:  # version
            _shape(document, ("status", "cli", "application", "database"), envelope=True)
            _equal(document["status"], "OK")
            _shape(document["cli"], ("version",))
            _equal(document["cli"]["version"], "1.0.0")
            result = {"status": "OK", "cli": {"version": "1.0.0"},
                      "application": _release(document["application"], expected.installed),
                      "database": _database(document["database"], expected)}
    expected_code = 2 if result["status"] == "BLOCKED_PLAN" else 1 if result["status"] == "UNAVAILABLE" else 0
    _equal(returncode, expected_code, "CLI_ENVELOPE")
    result["format"], result["command"], result["exitCode"] = "asa-cli-result-v1", command, returncode
    return result
