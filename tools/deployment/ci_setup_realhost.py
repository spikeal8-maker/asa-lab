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
REPOSITORY = "spikeal8-maker/asa-lab"
GUEST_HOME = Path("/opt/asa-realhost")
GUEST_PRIVATE = Path("/var/lib/asa-realhost")
INSTALL_ROOT = Path("/srv/asa-lab")
ORIGIN = "http://127.0.0.1:4610"
TABLES = ("accounts", "classrooms", "classroom_student_seats", "courses", "projects")
STATES = {"PASS", "FAIL", "BLOCKED", "NOT_RUN", "PENDING", "OK", "WARNING", "UNAVAILABLE",
          "UNVERIFIED", "ACCEPTED", "NO_CHANGE", "FAILED", "NOT_CONFIGURED", "BLOCKED_PLAN", "PLANNED", "RECORDED", "CONFIGURED", "READY"}
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
    "DIAGNOSTIC_TRUST", "DIAGNOSTIC_OWNER", "DIAGNOSTIC_JSON", "DIAGNOSTIC_UID", "UNRECOGNIZED_REASON"}
DIAGNOSTIC_PATHS = {"opt": "/opt", "bundleParent": "/opt/asa-setup", "bundle": ".", "tools": "tools",
    "setup": "tools/asa_setup.py", "launcher": "tools/asa_setup_launcher.py", "deployment": "tools/deployment",
    "package": "tools/deployment/__init__.py", "discovery": "tools/deployment/setup_discovery.py",
    "configuration": "tools/deployment/setup_config.py", "contracts": "tools/deployment/contracts.py"}


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
        self.context = {"format": "asa-realhost-context-v1", "sourceRevision": self.args.revision,
                        "nonce": uuid.uuid4().hex, "bundleSha256": proof["sha256"], "ageRecipient": recipient,
                        "pins": self.pins, "helperSha256": hash_file(self.source / "tools/deployment/ci_setup_smoke.py")}
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
                 "ci_setup_smoke.py": self.source / "tools/deployment/ci_setup_smoke.py"}
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
                    "/home/asa-ci/realhost-input/setup_bundle.py /home/asa-ci/realhost-input/ci_setup_smoke.py /opt/asa-realhost/ && "
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
                    self.phase("published_runtime_update", lambda: self.guest("update", timeout=2400))
                    self.phase("public_backup_and_retry", lambda: self.guest("backup", timeout=1200))
                    self.phase("real_guest_reboot", self.reboot)
                    self.phase("real_persistent_timer", self.missed_timer)
                    self.phase("final_control_browser", lambda: self.guest("final", timeout=900))
                    self.evidence["checks"].update(cleanUbuntuActual1Panel="PASS", publicCliLifecycle="PASS",
                                                   publishedRuntimeUpdate="PASS", realGuestReboot="PASS", persistentTimer="PASS")
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


def guest_guard():
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
    _, observed = Commands().run(["systemd-detect-virt", "--vm"])
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
    code, raw = Commands().run(command, timeout=timeout, environment=guest_environment(), allowed=(0, 1, 2, 130))
    try:
        result = json.loads(raw)
    except (ValueError, UnicodeError):
        raise Failure("PUBLIC_CLI_JSON") from None
    require(result.get("format") == "asa-cli-result-v1" and result.get("exitCode") == code, "PUBLIC_CLI_RESULT")
    reasons = [item for item in [result.get("reasonCode"), *result.get("reasonCodes", [])]
               if isinstance(item, str) and CODE.fullmatch(item)]
    record = {"command": "asa " + " ".join(words), "exitCode": code,
              "status": result.get("status") if result.get("status") in STATES else "UNVERIFIED", "reasonCodes": reasons}
    if isinstance(result.get("operationId"), str) and re.fullmatch(r"[a-f0-9]{32}", result["operationId"]):
        record["operationId"] = result["operationId"]
    if isinstance(result.get("operation"), dict) and result["operation"].get("outcome") in STATES:
        record["operationOutcome"] = result["operation"]["outcome"]
    CLI_ACTIONS.append(record)
    if code not in allowed:
        raise Failure(reasons[-1] if reasons else "PUBLIC_CLI_FAILED")
    return result


def candidate_bundle(context):
    return Path("/opt/asa-setup") / context["sourceRevision"]


def diagnostic_error(error):
    name = type(error).__name__
    return name if name in DIAGNOSTIC_ERRORS else "OtherError"


def diagnostic_command(args, *, timeout, environment, owner=None, own_group=True):
    """Bound both streams in memory and terminate only this probe's process group."""
    options = {} if owner is None else {"user": owner["uid"], "group": owner["gid"],
        "extra_groups": os.getgrouplist(owner["name"], owner["gid"])}
    result, output, errors = {}, bytearray(), bytearray()
    process = None
    try:
        process = subprocess.Popen([str(item) for item in args], cwd="/", env=environment,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=own_group,
            umask=0o077, **options)
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
            while selector.get_map() or process.poll() is None:
                require(time.monotonic() < deadline, "DIAGNOSTIC_TIMEOUT")
                for key, _ in selector.select(min(0.1, max(0, deadline - time.monotonic()))):
                    data = os.read(key.fd, 4096)
                    if not data:
                        selector.unregister(key.fileobj)
                        continue
                    require(len(output) + len(errors) + len(data) <= DIAGNOSTIC_LIMIT, "DIAGNOSTIC_OUTPUT_LIMIT")
                    key.data.extend(data)
        result["exitCode"] = process.wait(timeout=1)
        # Preserve only a known Python exception class, never a traceback line.
        for line in errors.decode("utf-8", "replace").splitlines():
            name = line.partition(":")[0]
            if name in DIAGNOSTIC_ERRORS:
                result["errorClass"] = name
    except BaseException as error:
        result.update(errorClass=diagnostic_error(error), reasonCode=getattr(error, "code", "UNRECOGNIZED_REASON"))
    finally:
        if process is not None:
            # Descendants may retain pipes even after the immediate child exits.
            try:
                os.killpg(process.pid, signal.SIGTERM) if own_group else process.terminate()
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass
            try:
                os.killpg(process.pid, signal.SIGKILL) if own_group else process.kill()
            except ProcessLookupError:
                pass
            process.wait(timeout=2)
            result.setdefault("exitCode", process.returncode)
            process.stdout.close()
            process.stderr.close()
    return result, bytes(output)


def diagnostic_command_projection(value):
    value = value if isinstance(value, dict) else {}
    result = {}
    for key, low, high in (("exitCode", -128, 255), ("actualUid", 1, 2**32 - 2)):
        if type(value.get(key)) is int and low <= value[key] <= high:
            result[key] = value[key]
    for key, allowed in (("reasonCode", DIAGNOSTIC_REASONS), ("errorClass", DIAGNOSTIC_ERRORS),
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
    if code or result.get("status") != "PASS":
        reason = result.get("reasonCode")
        raise Failure(reason if isinstance(reason, str) and CODE.fullmatch(reason) else "OWNER_PHASE_FAILED")
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
        raise Failure("UNKNOWN_OWNER_PHASE")
    require(os.geteuid() == 0, "GUEST_ROOT_REQUIRED")
    actions = {"bootstrap": bootstrap_guest, "install": install_guest, "update": update_guest, "backup": backup_guest,
               "schedule": schedule_guest, "timer-probe": timer_probe, "timer-retry": timer_retry}
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


def guest_main(phase):
    result = {"format": "asa-realhost-guest-v1", "phase": phase, "status": "FAIL"}
    try:
        context = guest_guard()
        proof = guest_phase(phase, context)
        require(isinstance(proof, dict) and proof.get("status", "PASS") in ("PASS", "PENDING", "FAIL", "BLOCKED"), "GUEST_PHASE_STATUS")
        result.update(proof, status=proof.get("status", "PASS"))
        return_code = 0 if result["status"] in ("PASS", "PENDING") else 2 if result["status"] == "BLOCKED" else 1
    except BaseException as error:
        result.update(status=getattr(error, "status", "FAIL"), reasonCode=safe_error(error))
        if hasattr(error, "post_failure_diagnostic"):
            result["postFailureDiagnostic"] = post_failure_projection(error.post_failure_diagnostic)
        return_code = 2 if result["status"] == "BLOCKED" else 1
    result["cliActions"] = CLI_ACTIONS
    print(json.dumps(result, sort_keys=True))
    return return_code


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision")
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--guest-phase", choices=("bootstrap", "install", "seed", "update", "backup", "post-reboot", "schedule",
                        "timer-probe", "timer-retry", "final", "owner-seed", "owner-observe", "owner-final", "owner-schedule-fixture", "owner-hold-lock",
                        "owner-diagnostic-paths", "owner-diagnostic-inventory"), help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.guest_phase:
        return guest_main(args.guest_phase)
    if not args.revision or not HEX40.fullmatch(args.revision):
        parser.error("--revision must be the exact checked-out source SHA")
    return HostRun(args).run()


if __name__ == "__main__":
    raise SystemExit(main())
