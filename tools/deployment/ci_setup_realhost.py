#!/usr/bin/env python3
"""Bounded real Ubuntu/1Panel VM acceptance; never a live-host deployment tool.

The host orchestrator requires a standard GitHub-hosted Ubuntu runner. Guest
actions require a root-owned cloud-init marker and QEMU/KVM virtualization.
Only evidence.json is public. Disks, SSH keys, CI token, installer output,
onboarding, browser fixtures and private CLI logs are never artifacts.
"""

import argparse
import datetime as dt
import hashlib
import importlib.util
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
    "LOCKED", "OPERATION_PENDING", "HEALTH", "TECHNICAL_ACCEPTANCE", "BROWSER_ACCEPTANCE", "INTERRUPTED", "CLI_UNAVAILABLE"}
COMMAND_DIAGNOSTIC_ERRORS = {"DIAGNOSTIC_PATH", "DIAGNOSTIC_PERMISSIONS", "DIAGNOSTIC_SIZE", "DIAGNOSTIC_CHANGED",
    "DIAGNOSTIC_BINDING", "DIAGNOSTIC_INVOCATION", "DIAGNOSTIC_LOG_BASELINE", "DIAGNOSTIC_JSON", "DIAGNOSTIC_TIMEOUT",
    "DIAGNOSTIC_INVENTORY", "DIAGNOSTIC_DOCKER_EXIT", "DIAGNOSTIC_OUTPUT_LIMIT", "DIAGNOSTIC_PLATFORM",
    "DIAGNOSTIC_PROCESS_OWNERSHIP", "DIAGNOSTIC_PROCESS_CLEANUP"}
COMMAND_DIAGNOSTIC_OUTCOMES = {"ACCEPTED", "WARNING", "BLOCKED", "ERROR", "INTERRUPTED", "PREPARATION_REQUIRED", "NO_CHANGE"}
# Ubuntu 24.04 ships /var/log root:syslog 0775; using it as an ancestor would
# violate diagnostic_open's intentionally strict no-group-write trust contract.
OPERATOR_LOG_ROOT = Path("/var/lib/asa-lab-operator")
CLI_READ_SECONDS = 900
CLI_CONTROL_SECONDS = 60
CLI_IMAGES = ("api", "web", "scratch", "minio", "search")
CLI_HELPERS = ("realhost_cli_checks.py", "realhost_cli_runtime.py", "setup_bundle.py")
CLI_RELEASE_PROGRAM = """import json, sys
sys.path.insert(0, sys.argv[1])
from deployment.release_readonly import resolve_release
pins = json.loads(sys.stdin.buffer.read(65536))
print(json.dumps({name: resolve_release(pins[name]["deploymentDigest"]) for name in ("previous", "current")}))
"""
SWITCH_SERVICES = ("postgres", "minio", "migration", "minio-init", "api", "search", "web", "scratch")
SWITCH_STATES = {"created", "running", "paused", "restarting", "removing", "exited", "dead"}
SWITCH_SQLSTATES = {"08001", "08006", "23502", "23503", "23505", "28000", "28P01", "3D000", "3F000",
    "42501", "42601", "42703", "42704", "42P01", "53100", "53200", "53300", "53400", "55P03", "57014", "XX000"}
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


def host_environment(environment, revision, actual_revision, *, free, memory, cpus, os_release):
    require(environment.get("GITHUB_ACTIONS") == "true" and environment.get("RUNNER_ENVIRONMENT") == "github-hosted"
            and environment.get("RUNNER_OS") == "Linux" and environment.get("GITHUB_REPOSITORY") == REPOSITORY,
            "BLOCKED_DISPOSABLE_RUNNER_REQUIRED", status="BLOCKED")
    require(HEX40.fullmatch(revision) and revision == actual_revision, "SOURCE_REVISION")
    require(os_release.get("ID") == "ubuntu" and os_release.get("VERSION_ID") == "24.04"
            and platform.machine() == "x86_64", "BLOCKED_RUNNER_PLATFORM", status="BLOCKED")
    require(free >= MIN_FREE, "BLOCKED_HOST_FREE_DISK", status="BLOCKED")
    require(memory >= 13 * GIB and cpus >= GUEST_CPUS + 1, "BLOCKED_HOST_RAM_CPU", status="BLOCKED")


def initial_evidence(revision):
    return {"format": "asa-realhost-evidence-v1", "status": "NOT_RUN", "sourceRevision": revision,
            "startedAt": now(), "scope": "Candidate CLI in a disposable real Ubuntu 24.04 VM with actual 1Panel",
            "publishedSetupAcquisition": {"status": "BLOCKED", "reasonCode": "CANDIDATE_NOT_PUBLISHED_ATTESTED"},
            "publicHTTPS": "NOT_RUN", "realYandexFromGuest": "NOT_RUN", "productionRestore": "NOT_RUN",
            "phases": [], "checks": {}, "cleanup": "NOT_RUN"}


class Commands:
    def __init__(self, *, guard=None):
        self.guard = guard or (lambda: None)

    def run(self, args, *, timeout=60, cwd=None, environment=None, source=None, allowed=(0,)):
        # Temporary raw output remains private and is never forwarded to CI.
        with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
            started_ns = time.time_ns()
            process = subprocess.Popen([str(arg) for arg in args], cwd=cwd, env=environment,
                                       stdin=subprocess.PIPE if source is not None else subprocess.DEVNULL,
                                       stdout=stdout, stderr=stderr, start_new_session=True)
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
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
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
        self.evidence = initial_evidence(args.revision)
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
        self.commands.run(["age-keygen", "-o", work / "age-private-key"], timeout=30)
        _, recipient = self.commands.run(["age-keygen", "-y", work / "age-private-key"], timeout=30)
        recipient = recipient.decode().strip()
        require(re.fullmatch(r"age1[a-z0-9]{58}", recipient), "AGE_RECIPIENT")
        _, selected = self.commands.run([sys.executable, "-I", "-B", "-c", CLI_RELEASE_PROGRAM, self.source / "tools"],
            source=json.dumps(self.pins).encode(), timeout=300)
        release_expectations = cli_release_expectations(json.loads(selected), self.pins)
        self.context = {"format": "asa-realhost-context-v1", "sourceRevision": self.args.revision,
                        "nonce": uuid.uuid4().hex, "bundleSha256": proof["sha256"], "ageRecipient": recipient,
                        "pins": self.pins, "helperSha256": hash_file(self.source / "tools/deployment/ci_setup_smoke.py"),
                        "cliHelperSha256": cli_helper_hashes(self.source, self.args.revision, self.commands),
                        "cliReleaseExpectations": release_expectations}
        write_json(work / "context.json", self.context)
        return {"ubuntu": image, "ubuntuSignature": "PASS", "onePanel": archive,
                "candidateBundle": {"sha256": proof["sha256"], "revision": self.args.revision, "attested": False}}

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
        self.vm.ssh("mkdir -m 700 /home/asa-ci/realhost-input")
        files = {"runner.py": Path(__file__), "context.json": work / "context.json", "candidate.tar.gz": work / "candidate.tar.gz",
                 "onepanel.tar.gz": work / "onepanel.tar.gz", "setup_bundle.py": self.source / "tools/deployment/setup_bundle.py",
                 "ci_setup_smoke.py": self.source / "tools/deployment/ci_setup_smoke.py",
                 **{name: self.source / "tools/deployment" / name for name in CLI_HELPERS}}
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
        return {"candidateStagedOnlyInsideGuest": True, "ephemeralTokenTransport": "private file; read permissions; no argv"}

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
                    self.phase("public_asa_install", lambda: self.guest("install", timeout=3000))
                    self.phase("independent_control_fixture", lambda: self.guest("seed", timeout=900))
                    self.phase("installed_cli_read_acceptance", lambda: self.guest("cli-read", timeout=1200))
                    self.phase("published_runtime_update", lambda: self.guest("update", timeout=2400))
                    self.phase("public_backup_and_retry", lambda: self.guest("backup", timeout=1200))
                    self.fault_deadline = min(self.deadline, time.monotonic() + FAULT_TOTAL_SECONDS)
                    try:
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
                                                   publicReleaseConnectionFailure="PASS", installedCliReadAcceptance="PASS")
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
        _, observed = Commands().run(["systemd-detect-virt", "--vm"])
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
        try:
            error.command_failure_diagnostic = command_failure_diagnostic(words, code, result, invocation)
        except BaseException as failure:
            error.command_failure_diagnostic = command_diagnostic_error(failure)
        if error.command_failure_diagnostic.get("binding") == "VERIFIED":
            record.update({key: error.command_failure_diagnostic[key] for key in ("operationId", "installationId")})
        raise error
    return result


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


def cli_candidate_binding(context, verifier):
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
    registry = json.loads(cli_trusted_bytes("/etc/asa-lab/commands.json"))
    require(registry == {"format": "asa-command-v1", "preparedBundle": str(bundle), "installations": [
        {"root": str(INSTALL_ROOT), "project": "asa-lab-dev", "profile": "production", "bundle": str(bundle)}]},
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


def cli_control_command(arguments, *, deadline, environment, cwd=None, source=None):
    """A bounded child in its owner's existing session; raw streams stay private."""
    require(source is None or type(source) is bytes and len(source) <= 65536, "CLI_CONTROL_INPUT")
    require(time.monotonic() < deadline, "CLI_CONTROL_TIMEOUT")
    with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors, tempfile.TemporaryFile() as incoming:
        if source is not None:
            incoming.write(source)
            incoming.seek(0)
        process = subprocess.Popen([str(item) for item in arguments], cwd=cwd, env=environment,
            stdin=incoming if source is not None else subprocess.DEVNULL, stdout=output, stderr=errors)
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


def cli_storage_observation(config, images, uid, *, deadline, environment, daemon_identity):
    """Independent Docker identities and paths, without consuming CLI observations."""
    def read(args):
        return cli_control_command(["docker", *args], deadline=min(deadline, time.monotonic() + 8), environment=environment)
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
        daemon_identity=daemon_identity)
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


def switch_log_projection(streams, service, invocation):
    """Parse each timestamped stream separately; never splice error-object fragments."""
    rules, sqlstates = set(), set()
    require(service in SWITCH_SERVICES and sum(len(item) for item in streams) <= DIAGNOSTIC_LIMIT, "DIAGNOSTIC_OUTPUT_LIMIT")
    for raw in streams:
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
    return {"status": "OBSERVED" if rules else "NO_MATCH", "ruleIds": sorted(rules), "sqlstates": sorted(sqlstates),
            "readBytes": sum(len(item) for item in streams), "scope": "BOUND_CONTAINER_INVOCATION_LOG", "causalProof": False}


def command_log_projection(path, base, uid, *, phase, offset=0, identity=None):
    raw, _, truncated = diagnostic_read(path, base, uid, maximum=64 * 1024**2, offset=offset,
                                        tail=128 * 1024, identity=identity)
    return {**command_log_classification(raw, phase), "readBytes": len(raw), "truncated": truncated}


def switch_expected_files(config, uid):
    require(config.get("profile") == "production", "DIAGNOSTIC_BINDING")
    files = ["compose.yaml", "compose.production.yaml"]
    for relative in (".asa/docker-networks.yaml", "compose.frp.yaml"):
        path = INSTALL_ROOT / relative
        try:
            info = path.lstat()
        except FileNotFoundError:
            continue
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == uid
                and not info.st_mode & 0o022, "DIAGNOSTIC_PERMISSIONS")
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
        if row and (row["health"] == "unhealthy" or row["oomKilled"] or row["error"] or
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
        raise Failure(reason if isinstance(reason, str) and CODE.fullmatch(reason) else "OWNER_PHASE_FAILED",
                      status="BLOCKED" if blocked else "FAIL")
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


def bootstrap_guest(context):
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
    bundle = candidate_bundle(context)
    bundle.parent.mkdir(mode=0o755, exist_ok=True)
    commands.run(["/usr/bin/python3", "-I", "-B", GUEST_HOME / "setup_bundle.py", "stage",
                  "--archive", GUEST_PRIVATE / "candidate.tar.gz", "--destination", bundle,
                  "--revision", context["sourceRevision"], "--sha256", context["bundleSha256"]], timeout=60)
    _, raw = commands.run(["/usr/bin/python3", "-I", "-B", bundle / "tools/asa_cli.py", "prepare", "--bundle", bundle, "--json"])
    require(json.loads(raw).get("status") == "OK" and Path("/usr/local/bin/asa").is_file(), "PUBLIC_CLI_PREPARATION")
    public_cli(["help"], timeout=30)
    return {"onePanelVersion": panel["version"], "officialInstallerSha256": panel["installerSha256"],
            "actualInstalledBytesVerified": True, "systemdPid1": True, "ntpSynchronized": True,
            "hostBaseline": baseline, "candidateStage": "manual trusted stage inside disposable guest only",
            "publishedAcquisition": "BLOCKED"}


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


def owner_installation(context):
    require(os.geteuid() != 0, "FIXTURE_MUST_BE_UNPRIVILEGED")
    config_module, acceptance, schedule, installation, helpers = product_modules(context)
    config = config_module.load_config(INSTALL_ROOT, os.geteuid())
    install = installation(INSTALL_ROOT, config["profile"])
    release = config_module.read_installed_release(INSTALL_ROOT)
    install.wait_ready(release["revision"], release["schema"])
    require(install.env.get("ASA_UPDATE_ENTRY_ORIGIN") == install.env.get("ASA_BLOCKS_PARENT_ORIGIN")
            == install.env.get("ASA_BLOCKS_RUNTIME_ORIGIN") == ORIGIN, "SAME_ORIGIN")
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
    return {"rows": rows, "rolesSha256": helpers.role_fingerprint(postgres, install.env["POSTGRES_USER"], install.env["POSTGRES_DB"]),
            "aclRlsSha256": canonical_hash(json.loads(privileges)), "privateEnvironmentSha256": canonical_hash(environment),
            "storageIdentitySha256": canonical_hash(acceptance.storage_identity(records)),
            "authenticatedS3Sha256": hashlib.sha256(actual_object.encode()).hexdigest()}


def owner_seed(context):
    config_module, acceptance, _, install, helpers, config, release = owner_installation(context)
    _, before_ids = control_rows(install, helpers)
    browser = {**config["browser"], "fixturePath": str(INSTALL_ROOT / ".asa/acceptance/realhost-control.json")}
    report = acceptance.browser_acceptance(install, release, uuid.uuid4().hex, browser)
    require(report["status"] == "passed", "CONTROL_BROWSER_BEFORE")
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
    require(current == saved["fingerprint"], "CONTROL_DATA_CHANGED")
    output = {"preserved": True, "runtimeRevision": release["revision"], "schema": release["schema"], "fingerprint": current}
    if browser:
        report = acceptance.browser_acceptance(install, release, uuid.uuid4().hex, saved["browser"])
        require(report["status"] == "passed", "CONTROL_BROWSER_AFTER")
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
    def __init__(self, command, *, environment, file_limit=False, deadline=None, owner=None):
        require(native_proc_namespace(), "BLOCKED_FAULT_PROC_NAMESPACE", status="BLOCKED")
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
        raise Failure("UNKNOWN_OWNER_PHASE")
    require(os.geteuid() == 0, "GUEST_ROOT_REQUIRED")
    actions = {"bootstrap": bootstrap_guest, "install": install_guest, "cli-read": installed_cli_read_guest,
               "update": update_guest, "backup": backup_guest,
               "schedule": schedule_guest, "timer-probe": timer_probe, "timer-retry": timer_retry,
               "partial-fault": partial_fault_guest, "interrupt-fault": interrupt_fault_guest,
               "network-fault": network_fault_guest, "network-fault-child": network_fault_child}
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
        if hasattr(error, "post_failure_diagnostic"):
            result["postFailureDiagnostic"] = post_failure_projection(error.post_failure_diagnostic)
        if hasattr(error, "command_failure_diagnostic"):
            result["commandFailureDiagnostic"] = error.command_failure_diagnostic
        if hasattr(error, "fault_evidence"):
            result["faultEvidence"] = error.fault_evidence
            result["ownedCleanupFailed"] = getattr(error, "owned_cleanup_failed", False) is True
        return_code = 2 if result["status"] == "BLOCKED" else 1
    result["cliActions"] = CLI_ACTIONS
    print(json.dumps(result, sort_keys=True))
    return return_code


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision")
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--guest-phase", choices=("bootstrap", "install", "seed", "cli-read", "owner-cli-control", "update", "backup", "post-reboot", "schedule",
                        "timer-probe", "timer-retry", "final", "owner-seed", "owner-observe", "owner-final", "owner-schedule-fixture", "owner-hold-lock",
                        "owner-diagnostic-paths", "owner-diagnostic-inventory", "owner-fault-prepare", "owner-fault-remove", "owner-fault-observe",
                        "partial-fault", "interrupt-fault", "network-fault", "network-fault-child"), help=argparse.SUPPRESS)
    parser.add_argument("--control-deadline", type=float, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.guest_phase:
        return guest_main(args.guest_phase, control_deadline=args.control_deadline)
    if not args.revision or not HEX40.fullmatch(args.revision):
        parser.error("--revision must be the exact checked-out source SHA")
    return HostRun(args).run()


if __name__ == "__main__":
    raise SystemExit(main())
